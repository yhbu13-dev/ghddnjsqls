'use strict';
// 재고 추정 엔진
// - POS 판매 → 박스 환산 × (1 + 누수 보정 α) 만큼 추정 재고 차감
// - 오차 밴드: w = w0 + β × (마지막 실사 이후 추정 소진량)
// - 실사(기사 하차 전 잔량 확인 또는 운영자 입력) → 편차 기록, α 학습, 추정·밴드 리셋

const T = require('../time');
const { logEvent } = require('./events');

const rateOf = (item, R) => (item.rate != null ? item.rate : item.rate_manual != null ? item.rate_manual : R.default_rate);
const betaOf = (store, R) => (store.beta != null ? store.beta : R.band_beta);
function safetyOf(item, R) {
  if (item.safety_override != null) return item.safety_override;
  return Math.max(0.25, Math.ceil(rateOf(item, R) * R.safety_days * 4) / 4);
}
/** 밴드를 포함한 소진 속도 (박스/일) */
const burnRate = (item, store, R) => Math.max(1e-6, rateOf(item, R) * (1 + store.alpha) * (1 + betaOf(store, R)));

function carriedItems(db, storeId) {
  return db.all(`SELECT ss.*, k.name, k.pack, k.unit, k.price FROM store_skus ss JOIN skus k ON k.id = ss.sku_id
                 WHERE ss.store_id = ? AND ss.carried = 1 AND k.active = 1 ORDER BY k.sort, k.id`, [storeId]);
}

/** POS 메뉴명 → SKU 매핑 (매장별 매핑이 있으면 우선, 없으면 공통 매핑) */
function mapMenu(db, storeId, menu) {
  const own = db.all('SELECT sku_id, units FROM menu_map WHERE store_id = ? AND menu_name = ?', [storeId, menu]);
  if (own.length) return own;
  return db.all('SELECT sku_id, units FROM menu_map WHERE store_id IS NULL AND menu_name = ?', [menu]);
}

/**
 * 판매 1건 반영. 같은 ext_id는 한 번만 처리(멱등).
 * @returns {{dup?:boolean, mapped:boolean}}
 */
function applySale(ctx, store, sale, now) {
  const { db, R } = ctx;
  const ins = db.run(`INSERT INTO pos_sales (store_id, ext_id, sold_at, menu_name, qty, mapped, received_at)
                      VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT (store_id, ext_id) DO NOTHING`,
  [store.id, sale.ext_id, sale.sold_at, sale.menu, sale.qty, now]);
  if (!ins.changes) return { dup: true, mapped: false };
  const saleId = Number(ins.lastInsertRowid);
  db.run('UPDATE stores SET last_pos_at = MAX(COALESCE(last_pos_at, 0), ?) WHERE id = ?', [now, store.id]);
  const maps = mapMenu(db, store.id, sale.menu);
  if (!maps.length) {
    db.run(`INSERT INTO unmapped_menu (store_id, menu_name, first_seen, last_seen, qty) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (store_id, menu_name) DO UPDATE SET last_seen = excluded.last_seen, qty = qty + excluded.qty`,
    [store.id, sale.menu, sale.sold_at, sale.sold_at, sale.qty]);
    return { mapped: false };
  }
  db.run('UPDATE pos_sales SET mapped = 1 WHERE id = ?', [saleId]);
  const beta = betaOf(store, R);
  for (const m of maps) {
    const sku = db.get('SELECT pack FROM skus WHERE id = ?', [m.sku_id]);
    if (!sku) continue;
    const boxes = (m.units * sale.qty) / sku.pack;
    db.run('INSERT INTO pos_sale_items (sale_id, store_id, sku_id, sold_at, boxes) VALUES (?, ?, ?, ?, ?)', [saleId, store.id, m.sku_id, sale.sold_at, boxes]);
    const item = db.get('SELECT * FROM store_skus WHERE store_id = ? AND sku_id = ? AND carried = 1', [store.id, m.sku_id]);
    // 실사 이전에 팔린 건이 늦게 도착하면 이미 실사값에 반영돼 있으므로 추정에서 빼지 않는다
    if (!item || (item.last_count_at != null && sale.sold_at < item.last_count_at)) continue;
    const est = boxes * (1 + store.alpha);
    const cumEst = item.cum_est + est;
    db.run(`UPDATE store_skus SET est = est - ?, cum_est = ?, cum_pos = cum_pos + ?, band = ? WHERE store_id = ? AND sku_id = ?`,
      [est, cumEst, boxes, R.band_w0 + beta * cumEst, store.id, m.sku_id]);
  }
  return { mapped: true };
}

/**
 * 실사 반영. counts = { skuId: 실제 잔량(박스) }
 * 직전 실사 이후의 실제 소진(= 기준량 + 입고 − 잔량)과 POS 판매를 비교해 매장 누수율 α를 학습한다.
 */
function applyCount(ctx, store, counts, { source, stopId = null, actor = '' }, now) {
  const { db, R } = ctx;
  const rows = [];
  let cumTrue = 0, cumPos = 0, learnable = false;
  for (const [skuId, actualRaw] of Object.entries(counts)) {
    const actual = Number(actualRaw);
    if (!Number.isFinite(actual) || actual < 0 || actual > 10000) throw new Error(`잔량 값이 올바르지 않습니다 (${skuId}: ${actualRaw})`);
    const item = db.get('SELECT * FROM store_skus WHERE store_id = ? AND sku_id = ?', [store.id, skuId]);
    if (!item) throw new Error(`매장에 등록되지 않은 SKU: ${skuId}`);
    rows.push({ item, actual });
    if (item.last_count_at != null && source !== 'onboarding') {
      learnable = true;
      cumTrue += item.base_qty + item.in_since - actual;
      cumPos += item.cum_pos;
    }
  }
  if (learnable && cumPos > 0.3) {
    const obs = Math.max(-0.3, Math.min(1.5, cumTrue / cumPos - 1));
    const alpha = Math.max(-0.2, Math.min(0.8, store.alpha + R.alpha_lr * (obs - store.alpha)));
    db.run('UPDATE stores SET alpha = ? WHERE id = ?', [alpha, store.id]);
    store.alpha = alpha;
  }
  for (const { item, actual } of rows) {
    db.run(`INSERT INTO counts (store_id, sku_id, t, estimate, actual, band, source, stop_id, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [store.id, item.sku_id, now, item.est, actual, item.band, source, stopId, actor]);
    db.run(`UPDATE store_skus SET est = ?, band = ?, cum_est = 0, cum_pos = 0, base_qty = ?, in_since = 0,
              last_count_at = ?, last_count_est = ?, last_count_actual = ?, last_count_band = ?, carried = 1
            WHERE store_id = ? AND sku_id = ?`,
    [actual, R.band_w0, actual, now, item.est, actual, item.band, store.id, item.sku_id]);
  }
  return rows.length;
}

/** 입고 반영 (배송 완료 시) */
function applyReceipt(ctx, store, skuId, qty, now) {
  ctx.db.run(`UPDATE store_skus SET est = est + ?, in_since = in_since + ?, last_in_at = ?, last_in_qty = ?
              WHERE store_id = ? AND sku_id = ?`, [qty, qty, now, qty, store.id, skuId]);
}

/** 시간 단위 스냅샷 (재고 차트용) */
function snapshot(ctx, now) {
  const hourTs = Math.floor(now / T.HOUR) * T.HOUR;
  ctx.db.run(`INSERT OR REPLACE INTO inv_snapshots (store_id, sku_id, t, est, band)
              SELECT ss.store_id, ss.sku_id, ?, ss.est, ss.band FROM store_skus ss JOIN stores s ON s.id = ss.store_id
              WHERE ss.carried = 1 AND s.active = 1`, [hourTs]);
  return hourTs;
}

/** 최근 14일 POS 기반 판매 속도 갱신 (판매 이력 3일 미만이면 수동값/기본값 사용) */
function refreshRates(ctx, now) {
  const { db } = ctx;
  const since = now - 14 * T.DAY;
  const firsts = new Map(db.all('SELECT store_id, MIN(sold_at) AS f FROM pos_sales GROUP BY store_id').map((r) => [r.store_id, r.f]));
  const sums = new Map(db.all('SELECT store_id, sku_id, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, sku_id', [since])
    .map((r) => [r.store_id + '|' + r.sku_id, r.b]));
  for (const it of db.all('SELECT store_id, sku_id FROM store_skus')) {
    const f = firsts.get(it.store_id);
    const days = f == null ? 0 : Math.min(14, (now - Math.max(f, since)) / T.DAY);
    const rate = days >= 3 ? (sums.get(it.store_id + '|' + it.sku_id) || 0) / days : null;
    db.run('UPDATE store_skus SET rate = ? WHERE store_id = ? AND sku_id = ?', [rate, it.store_id, it.sku_id]);
  }
}

/** 운영자 실사 입력 (온보딩 포함) */
function recordCount(ctx, storeId, counts, actor, now, onboarding) {
  const store = ctx.db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
  if (!store) throw new Error('매장을 찾을 수 없습니다');
  return ctx.db.tx(() => {
    const n = applyCount(ctx, store, counts, { source: onboarding ? 'onboarding' : 'ops', actor }, now);
    logEvent(ctx.db, { t: now, kind: onboarding ? '초기 실사' : '실사', store_id: store.id, region_id: store.region_id, actor, message: `${store.name} · ${n}개 SKU 잔량 입력` });
    return n;
  });
}

module.exports = { rateOf, betaOf, safetyOf, burnRate, carriedItems, applySale, applyCount, applyReceipt, snapshot, refreshRates, recordCount, mapMenu };
