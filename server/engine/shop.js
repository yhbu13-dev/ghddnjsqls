'use strict';
// 점주 직접 발주 — 카카오톡 채팅(버튼 선택)과 모바일 발주 화면이 같은 장바구니·같은 발주 흐름을 쓴다.
// 접수된 발주는 자동 제안과 같은 proposals 테이블에 들어가 결제 → 배차 → 배송 → 정산을 그대로 탄다.

const T = require('../time');
const tokens = require('../tokens');
const catalog = require('./catalog');
const orders = require('./orders');
const props = require('./proposals');
const { logEvent } = require('./events');

const MAX_QTY = 200;
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
/** 발주 단위: 낱개로 파는 품목(입수 1)은 그 단위(봉·병), 나머지는 박스 */
const unitOf = (k) => (k.pack === 1 ? k.unit : '박스');

// ── 발주 화면 링크 (/m/…) ─────────────────────────────────────
function orderLink(ctx, storeId, now = Date.now(), hours = ctx.R.order_link_hours) {
  const { db } = ctx;
  let s = db.get('SELECT id, order_nonce FROM stores WHERE id = ?', [storeId]);
  if (!s) throw new Error('매장을 찾을 수 없습니다');
  if (!s.order_nonce) {
    db.run("UPDATE stores SET order_nonce = ? WHERE id = ? AND order_nonce = ''", [tokens.nonce(), storeId]);
    s = db.get('SELECT id, order_nonce FROM stores WHERE id = ?', [storeId]);
  }
  return ctx.R.public_base_url + '/m/' + tokens.sign(ctx.secret, { k: 'm', id: s.id, n: s.order_nonce, e: now + hours * T.HOUR });
}

/** 발주 화면 토큰 → 매장 (없거나 만료면 null) */
function storeFromToken(ctx, token, now = Date.now()) {
  const t = tokens.verify(ctx.secret, token, 'm', now);
  if (!t) return null;
  const s = ctx.db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [t.id]);
  return s && s.order_nonce && s.order_nonce === t.n ? s : null;
}

/** 매장의 모든 발주 링크 무효화 (분실·점주 변경 시) */
function revokeLinks(ctx, storeId) {
  ctx.db.run('UPDATE stores SET order_nonce = ? WHERE id = ?', [tokens.nonce(), storeId]);
}

// ── 품목 ───────────────────────────────────────────────────
function orderable(db, storeId) {
  const cats = catalog.approvedSet(db, storeId);
  if (!cats.size) return [];
  return db.all(`SELECT id, name, spec, pack, unit, price, category, sort FROM skus WHERE active = 1 AND category IN (${[...cats].map(() => '?').join(',')}) ORDER BY sort, id`, [...cats]);
}

function orderableMap(db, storeId) { return new Map(orderable(db, storeId).map((k) => [k.id, k])); }

/** 최근 90일 SKU별 발주 횟수·마지막 수량 (자주 시키는 품목을 위로) */
function history(db, storeId, now) {
  const out = new Map();
  for (const r of db.all(`SELECT l.sku_id, COUNT(*) AS n, MAX(p.id) AS last_id FROM proposal_lines l JOIN proposals p ON p.id = l.proposal_id
                          WHERE p.store_id = ? AND p.created_at >= ? AND l.qty > 0 AND p.status NOT IN ('cancelled','held','expired') GROUP BY l.sku_id`, [storeId, now - 90 * T.DAY])) {
    const last = db.get('SELECT qty FROM proposal_lines WHERE proposal_id = ? AND sku_id = ?', [r.last_id, r.sku_id]);
    out.set(r.sku_id, { n: r.n, lastQty: last ? last.qty : 0 });
  }
  return out;
}

// ── 장바구니 (채팅·화면 공용, 매장 단위) ─────────────────────────
function cart(db, storeId) {
  const items = db.all(`SELECT c.sku_id AS sku, c.qty, k.name, k.price, k.category, k.pack, k.unit FROM carts c JOIN skus k ON k.id = c.sku_id
                        WHERE c.store_id = ? ORDER BY k.category, k.sort, k.id`, [storeId]);
  const ok = orderableMap(db, storeId);
  const lines = items.filter((i) => ok.has(i.sku)).map((i) => ({ ...i, u: unitOf(i) }));
  return { lines, count: lines.length, boxes: lines.reduce((a, l) => a + l.qty, 0), amount: lines.reduce((a, l) => a + l.qty * l.price, 0) };
}

function setCart(ctx, storeId, sku, qty, now = Date.now()) {
  const { db } = ctx;
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw new Error(`수량은 0~${MAX_QTY} 사이 정수입니다`);
  if (!orderableMap(db, storeId).has(sku)) throw new Error('발주할 수 없는 품목입니다');
  if (n === 0) db.run('DELETE FROM carts WHERE store_id = ? AND sku_id = ?', [storeId, sku]);
  else db.run(`INSERT INTO carts (store_id, sku_id, qty, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (store_id, sku_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at`, [storeId, sku, n, now]);
  return cart(db, storeId);
}

function addCart(ctx, storeId, sku, delta, now = Date.now()) {
  const cur = ctx.db.get('SELECT qty FROM carts WHERE store_id = ? AND sku_id = ?', [storeId, sku]);
  return setCart(ctx, storeId, sku, Math.max(0, Math.min(MAX_QTY, (cur ? cur.qty : 0) + delta)), now);
}

function clearCart(ctx, storeId) { ctx.db.run('DELETE FROM carts WHERE store_id = ?', [storeId]); }

/** 지난 발주와 똑같이 → 장바구니 (지금 발주할 수 있는 품목만) */
function reorderToCart(ctx, storeId, now = Date.now()) {
  const { db } = ctx;
  const last = db.get(`SELECT id, code FROM proposals WHERE store_id = ? AND status IN ('paid','dispatched','delivered') ORDER BY id DESC LIMIT 1`, [storeId]);
  if (!last) throw new Error('지난 발주 내역이 없습니다');
  const ok = orderableMap(db, storeId);
  let n = 0;
  db.tx(() => {
    db.run('DELETE FROM carts WHERE store_id = ?', [storeId]);
    for (const l of db.all('SELECT sku_id, qty FROM proposal_lines WHERE proposal_id = ? AND qty > 0', [last.id])) {
      if (!ok.has(l.sku_id)) continue;
      db.run('INSERT INTO carts (store_id, sku_id, qty, updated_at) VALUES (?, ?, ?, ?)', [storeId, l.sku_id, Math.min(MAX_QTY, l.qty), now]);
      n++;
    }
  });
  if (!n) throw new Error('지난 발주 품목 중 지금 발주할 수 있는 품목이 없습니다');
  return { from: last.code, cart: cart(db, storeId) };
}

// ── 발주 접수 ──────────────────────────────────────────────
/**
 * 점주 발주. items = { skuId: 수량 }. ref: 중복 접수 방지 키(같은 ref는 한 번만 접수).
 * 접수 즉시 승인·결제까지 진행하고 확정 알림톡을 보낸다.
 */
async function submit(ctx, storeId, { items, source = 'web', ref = null }, now = Date.now()) {
  const { db, R } = ctx;
  if (!['web', 'chat'].includes(source)) throw new Error('알 수 없는 접수 경로');
  const cleanRef = ref == null ? null : String(ref).slice(0, 64);
  if (cleanRef) {
    const dup = db.get('SELECT * FROM proposals WHERE store_id = ? AND client_ref = ?', [storeId, cleanRef]);
    if (dup) return { proposal: dup, duplicate: true };
  }
  const pid = db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    const ok = orderableMap(db, storeId);
    const lines = [];
    for (const [sku, raw] of Object.entries(items || {})) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw new Error(`수량은 0~${MAX_QTY} 사이 정수입니다`);
      if (n === 0) continue;
      const k = ok.get(sku);
      if (!k) throw new Error('발주할 수 없는 품목이 있습니다. 화면을 새로고침해 주세요');
      lines.push({ ...k, qty: n });
    }
    if (!lines.length) throw new Error('발주할 품목을 골라 주세요');
    const amount = lines.reduce((a, l) => a + l.qty * l.price, 0);
    if (amount < R.order_min_amount) throw new Error(`최소 발주 금액은 ${won(R.order_min_amount)}입니다 (현재 ${won(amount)})`);
    lines.sort((a, b) => b.qty * b.price - a.qty * a.price);
    const r = db.run(`INSERT INTO proposals (code, store_id, status, created_at, trigger_sku, send_rule, amount, token_nonce, created_by, source, client_ref)
                      VALUES (?, ?, 'created', ?, ?, 'owner', ?, ?, ?, ?, ?)`,
    [props.nextCode(db, now), storeId, now, lines[0].id, amount, tokens.nonce(), 'owner:' + source, source, cleanRef]);
    const id = Number(r.lastInsertRowid);
    for (const l of lines) {
      db.run('INSERT INTO proposal_lines (proposal_id, sku_id, qty, qty_orig, est, band, safety, trig, price) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)', [id, l.id, l.qty, l.qty, l.price]);
      db.run('DELETE FROM carts WHERE store_id = ? AND sku_id = ?', [storeId, l.id]);
    }
    const cats = [...new Set(lines.map((l) => catalog.CATEGORIES[l.category].short))].join('·');
    logEvent(db, { t: now, kind: '점주 발주', store_id: storeId, proposal_id: id, region_id: store.region_id, actor: 'owner:' + source,
      message: `${store.name} · ${source === 'chat' ? '카카오톡' : '발주 화면'} · ${cats} ${lines.length}품목 ${won(amount)}` });
    return id;
  });
  try {
    return { proposal: await orders.approve(ctx, pid, { actor: 'owner:' + source }, now), duplicate: false };
  } catch (e) {
    orders.cancel(ctx, pid, 'system', now); // 접수만 되고 승인되지 않은 건이 남지 않게
    throw e;
  }
}

// ── 조회 ───────────────────────────────────────────────────
function statusText(p, now) {
  switch (p.status) {
    case 'created': case 'sent': return p.source === 'auto' ? '승인 대기' : '접수 중';
    case 'payfail': return '결제 확인 필요';
    case 'paid': return deliverWord(p.deliver_date, now) + ' 배송 예정';
    case 'dispatched': return '배송 중';
    case 'delivered': return '배송 완료';
    case 'held': return '보류';
    case 'expired': return '만료';
    case 'cancelled': return '취소';
    default: return p.status;
  }
}
function deliverWord(date, now) {
  if (!date) return '';
  const d = Math.round((T.parseDate(date) - T.kstMidnight(now)) / T.DAY);
  return d === 0 ? '오늘' : d === 1 ? '내일' : date.slice(5).replace('-', '/');
}

function recentOrders(db, storeId, now, limit = 5) {
  return db.all(`SELECT * FROM proposals WHERE store_id = ? AND (source != 'auto' OR response = 'approve' OR status IN ('created','sent'))
                 ORDER BY id DESC LIMIT ?`, [storeId, limit]).map((p) => {
    const lines = db.all('SELECT l.sku_id AS sku, l.qty, l.price, k.name, k.pack, k.unit FROM proposal_lines l JOIN skus k ON k.id = l.sku_id WHERE l.proposal_id = ? AND l.qty > 0 ORDER BY l.qty * l.price DESC', [p.id]);
    const stop = db.get('SELECT eta FROM stops WHERE proposal_id = ? ORDER BY id DESC LIMIT 1', [p.id]);
    return { id: p.id, code: p.code, status: p.status, statusText: statusText(p, now), source: p.source, createdAt: p.created_at, amount: p.amount,
      deliverDate: p.deliver_date, eta: stop ? stop.eta : null, deliveredAt: p.delivered_at, lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, price: l.price, name: l.name, u: unitOf(l) })) };
  });
}

/** 지금 발주하면 언제 오는지 */
function deliveryPreview(R, now) {
  const date = orders.deliverDate(now, R);
  return { date, word: deliverWord(date, now), sameDay: date === T.dateStr(now), cutoff: R.cutoff };
}

/** 모바일 발주 화면 전체 데이터 */
function view(ctx, store, now = Date.now()) {
  const { db, R } = ctx;
  const hist = history(db, store.id, now);
  const products = orderable(db, store.id).map((k) => {
    const h = hist.get(k.id);
    return { id: k.id, name: k.name, spec: k.spec, pack: k.pack, unit: k.unit, u: unitOf(k), price: k.price, category: k.category, freq: h ? h.n : 0, lastQty: h ? h.lastQty : 0 };
  });
  const pending = db.get("SELECT code FROM proposals WHERE store_id = ? AND source = 'auto' AND status IN ('created','sent') AND responded_at IS NULL AND send_at IS NOT NULL ORDER BY id DESC LIMIT 1", [store.id]);
  return {
    store: { name: store.name, owner: store.owner_name, biz: store.biz, bizLabel: catalog.BIZ[store.biz].label },
    categories: catalog.storeCategories(db, store),
    products,
    cart: cart(db, store.id),
    orders: recentOrders(db, store.id, now),
    delivery: deliveryPreview(R, now),
    minAmount: R.order_min_amount,
    payMethod: R.pay_method,
    channelChatUrl: R.kakao_channel_id ? `https://pf.kakao.com/${R.kakao_channel_id}/chat` : null,
    pendingProposal: pending ? pending.code : null,
    hasLastOrder: !!db.get("SELECT 1 FROM proposals WHERE store_id = ? AND status IN ('paid','dispatched','delivered')", [store.id]),
  };
}

module.exports = { MAX_QTY, unitOf, orderLink, storeFromToken, revokeLinks, orderable, cart, setCart, addCart, clearCart, reorderToCart, submit, recentOrders, statusText, deliveryPreview, view, won };
