'use strict';
// 발주 제안 엔진
// 트리거: 오차 밴드 하한(추정 − 밴드)이 안전재고 이하 → 제안 생성
// 묶음: 트리거 SKU + 향후 lookahead_days 안에 트리거가 예상되는 SKU를 한 번에 채워 주 1회 배송에 맞춘다.
// 발송 규칙: 야간(21~09시) 생성분은 09시, 브레이크타임 선호 매장의 점심 피크 생성분은 15시, 검수 대상 매장은 운영자 확인 후.

const T = require('../time');
const tokens = require('../tokens');
const inv = require('./inventory');
const { logEvent } = require('./events');
const msg = require('./messages');

const OPEN = ['created', 'sent', 'payfail', 'paid', 'dispatched'];

function openProposal(db, storeId) {
  return db.get(`SELECT * FROM proposals WHERE store_id = ? AND status IN ('created','sent','payfail','paid','dispatched') ORDER BY id DESC LIMIT 1`, [storeId]);
}

function buildLines(store, items, trig, R) {
  const lines = [];
  for (const it of items) {
    const S = inv.safetyOf(it, R);
    const burn = inv.burnRate(it, store, R);
    const dtt = (it.est - it.band - S) / burn;
    const target = S + R.band_w0 + burn * R.cover_days;
    const q = Math.max(1, Math.ceil(target - it.est - 0.2));
    if (it.sku_id === trig.sku_id || dtt < R.lookahead_days) {
      lines.push({ sku_id: it.sku_id, qty: q, est: it.est, band: it.band, safety: S, trig: it.sku_id === trig.sku_id ? 1 : 0, price: it.price });
    }
  }
  lines.sort((a, b) => (b.trig - a.trig) || (b.qty * b.price - a.qty * a.price));
  return lines;
}

function computeSend(store, createdAt, R) {
  const mid = T.kstMidnight(createdAt), h = T.kstHour(createdAt);
  if (h >= R.nightStartH) return { rule: 'night', at: T.at(mid + T.DAY, R.nightEndH) };
  if (h < R.nightEndH) return { rule: 'night', at: T.at(mid, R.nightEndH) };
  if (store.send_pref === 'break' && h >= R.breakFromH && h < R.breakToH) return { rule: 'break', at: T.at(mid, R.breakSendH) };
  return { rule: 'auto', at: createdAt };
}

function nextCode(db, now) {
  const d = T.dateStr(now).replace(/-/g, '').slice(2);
  const mid = T.kstMidnight(now);
  const n = db.get('SELECT COUNT(*) AS c FROM proposals WHERE created_at >= ? AND created_at < ?', [mid, mid + T.DAY]).c + 1;
  let code = `PO-${d}-${String(n).padStart(3, '0')}`;
  for (let k = n + 1; db.get('SELECT 1 FROM proposals WHERE code = ?', [code]); k++) code = `PO-${d}-${String(k).padStart(3, '0')}`;
  return code;
}

function createProposal(ctx, store, items, trig, now, { manual = false, actor = 'system' } = {}) {
  const { db, R } = ctx;
  const lines = buildLines(store, items, trig, R);
  const amount = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const last = db.get("SELECT status, closed_at FROM proposals WHERE store_id = ? ORDER BY id DESC LIMIT 1", [store.id]);
  const reproposal = last && ['held', 'expired'].includes(last.status) && now - last.closed_at < 36 * T.HOUR ? 1 : 0;
  const send = computeSend(store, now, R);
  const review = store.review_required ? 1 : 0;
  const r = db.run(`INSERT INTO proposals (code, store_id, status, created_at, trigger_sku, reproposal, manual, review, send_rule, send_at, amount, token_nonce, created_by)
                    VALUES (?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [nextCode(db, now), store.id, now, trig.sku_id, reproposal, manual ? 1 : 0, review, send.rule, review ? null : send.at, amount, tokens.nonce(), actor]);
  const pid = Number(r.lastInsertRowid);
  for (const l of lines) {
    db.run('INSERT INTO proposal_lines (proposal_id, sku_id, qty, qty_orig, est, band, safety, trig, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [pid, l.sku_id, l.qty, l.qty, l.est, l.band, l.safety, l.trig, l.price]);
  }
  logEvent(db, { t: now, kind: '제안 생성', store_id: store.id, proposal_id: pid, region_id: store.region_id, actor, message: `${store.name} · ${trig.name} 하한 도달${manual ? ' (운영자 선제 제안)' : ''}${review ? ' · 검수 대기' : ''}` });
  return db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
}

/** 모든 매장의 트리거 점검 (스케줄러가 주기적으로 호출) */
function evaluateTriggers(ctx, now) {
  const { db, R } = ctx;
  const created = [];
  for (const store of db.all('SELECT * FROM stores WHERE active = 1')) {
    if (now < store.cooldown_until) continue;
    if (openProposal(db, store.id)) continue;
    const items = inv.carriedItems(db, store.id);
    if (!items.length || items.every((i) => i.last_count_at == null)) continue; // 초기 실사 전에는 제안하지 않음
    const trig = items.filter((i) => i.last_count_at != null && i.est - i.band <= inv.safetyOf(i, R))
      .sort((a, b) => (a.est - a.band - inv.safetyOf(a, R)) - (b.est - b.band - inv.safetyOf(b, R)))[0];
    if (trig) created.push(createProposal(ctx, store, items, trig, now));
  }
  return created;
}

/** 운영자 선제 제안 */
function proposeNow(ctx, storeId, actor, now) {
  const { db, R } = ctx;
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    if (openProposal(db, store.id)) throw new Error('이미 진행 중인 발주가 있습니다');
    const items = inv.carriedItems(db, store.id);
    if (!items.length) throw new Error('취급 SKU가 없습니다');
    const trig = items.slice().sort((a, b) => (a.est - a.band - inv.safetyOf(a, R)) / inv.burnRate(a, store, R) - (b.est - b.band - inv.safetyOf(b, R)) / inv.burnRate(b, store, R))[0];
    return createProposal(ctx, store, items, trig, now, { manual: true, actor });
  });
}

/** 발송 시각이 된 제안 발송 */
function sendDue(ctx, now) {
  const { db } = ctx;
  const due = db.all("SELECT * FROM proposals WHERE status = 'created' AND send_at IS NOT NULL AND send_at <= ?", [now]);
  for (const p of due) {
    db.run("UPDATE proposals SET status = 'sent', sent_at = ? WHERE id = ?", [now, p.id]);
    const store = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    msg.enqueue(ctx, { ...p, status: 'sent', sent_at: now }, 'propose', now);
    logEvent(db, { t: now, kind: '알림톡', store_id: p.store_id, proposal_id: p.id, region_id: store.region_id, message: `${store.name} · 발주 제안 발송` });
  }
  return due.length;
}

function sendNow(ctx, pid, actor, now) {
  const { db } = ctx;
  return db.tx(() => {
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
    if (!p || p.status !== 'created') throw new Error('발송 전 제안만 즉시 발송할 수 있습니다');
    db.run('UPDATE proposals SET send_at = ?, review = 0 WHERE id = ?', [now, pid]);
    logEvent(db, { t: now, kind: '검수 완료', store_id: p.store_id, proposal_id: pid, actor, message: `${p.code} 즉시 발송` });
    sendDue(ctx, now);
  });
}

function remind(ctx, pid, actor, now) {
  const { db } = ctx;
  return db.tx(() => {
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
    if (!p || p.status !== 'sent' || p.responded_at != null) throw new Error('응답 대기 중인 제안만 리마인드할 수 있습니다');
    db.run('UPDATE proposals SET reminded_at = ? WHERE id = ?', [now, pid]);
    msg.enqueue(ctx, p, 'remind', now);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '알림톡', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · 리마인드 발송` });
  });
}

/** 자동 리마인드 · 무응답 만료 */
function sweepPending(ctx, now) {
  const { db, R } = ctx;
  if (R.auto_remind_min > 0) {
    for (const p of db.all("SELECT * FROM proposals WHERE status = 'sent' AND responded_at IS NULL AND reminded_at IS NULL AND sent_at <= ?", [now - R.auto_remind_min * 60e3])) {
      if (now - p.sent_at >= R.expire_hours * T.HOUR) continue;
      db.run('UPDATE proposals SET reminded_at = ? WHERE id = ?', [now, p.id]);
      msg.enqueue(ctx, p, 'remind', now);
    }
  }
  for (const p of db.all("SELECT * FROM proposals WHERE status = 'sent' AND responded_at IS NULL AND sent_at <= ?", [now - R.expire_hours * T.HOUR])) {
    const retry = T.at(T.kstMidnight(now) + T.DAY, R.retryH);
    db.run("UPDATE proposals SET status = 'expired', response = 'none', closed_at = ? WHERE id = ?", [now, p.id]);
    db.run('UPDATE stores SET cooldown_until = ? WHERE id = ?', [retry, p.store_id]);
    msg.enqueue(ctx, p, 'expire', now);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '미응답', store_id: p.store_id, proposal_id: p.id, region_id: s.region_id, message: `${s.name} · ${R.expire_hours}시간 무응답으로 제안 만료` });
  }
}

module.exports = { OPEN, openProposal, buildLines, computeSend, createProposal, evaluateTriggers, proposeNow, sendDue, sendNow, remind, sweepPending };
