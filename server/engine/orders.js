'use strict';
// 승인 · 보류 · 결제 · 취소
// 결제 어댑터가 비동기(PG)일 수 있으므로 응답 기록과 결제 결과 반영을 두 트랜잭션으로 나눈다.

const T = require('../time');
const msg = require('./messages');
const { logEvent } = require('./events');

/** 결제 시각 기준 배송일: 컷오프 전이면 그날(배송 요일일 때), 아니면 다음 배송일 */
function deliverDate(paidAt, R) {
  const mid = T.kstMidnight(paidAt);
  const d = T.kstHour(paidAt) < R.cutoffH ? T.nextDeliveryDay(mid, R.days, true) : T.nextDeliveryDay(mid, R.days, false);
  return T.dateStr(d + T.HOUR);
}

function load(db, pid) {
  const p = db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
  if (!p) throw new Error('발주를 찾을 수 없습니다');
  return p;
}

/**
 * 승인 (사장님 링크 또는 운영자 대리 승인)
 * @param qty { skuId: 수량 } — 수량 수정 시
 */
async function approve(ctx, pid, { qty = null, actor = 'owner', note = '' } = {}, now = Date.now()) {
  const { db } = ctx;
  const p = db.tx(() => {
    const p = load(db, pid);
    if (!['created', 'sent'].includes(p.status) || p.responded_at != null) throw new Error('이미 처리된 발주입니다');
    let modified = 0;
    if (qty && typeof qty === 'object') {
      for (const [sku, raw] of Object.entries(qty)) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 200) throw new Error('수량은 0~200 사이 정수입니다');
        const l = db.get('SELECT * FROM proposal_lines WHERE proposal_id = ? AND sku_id = ?', [pid, sku]);
        if (!l) throw new Error('제안에 없는 SKU입니다: ' + sku);
        if (l.qty !== n) { db.run('UPDATE proposal_lines SET qty = ? WHERE proposal_id = ? AND sku_id = ?', [n, pid, sku]); modified = 1; }
      }
    }
    const amount = db.get('SELECT COALESCE(SUM(qty * price), 0) AS a FROM proposal_lines WHERE proposal_id = ?', [pid]).a;
    if (amount <= 0) throw new Error('수량이 모두 0입니다. 보류를 이용해 주세요');
    db.run(`UPDATE proposals SET responded_at = ?, response = 'approve', responder = ?, modified = ?, amount = ?,
              opened_at = COALESCE(opened_at, ?), sent_at = COALESCE(sent_at, ?), status = 'sent' WHERE id = ?`,
    [now, actor, modified, amount, now, p.status === 'created' ? null : p.sent_at, pid]);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '발주 승인', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · ${Math.round(amount).toLocaleString('ko-KR')}원${modified ? ' · 수량 수정' : ''}${note ? ' · ' + note : ''}` });
    return load(db, pid);
  });
  return charge(ctx, p, actor, now);
}

async function charge(ctx, p, actor, now) {
  const { db } = ctx;
  const store = db.get('SELECT * FROM stores WHERE id = ?', [p.store_id]);
  let res;
  try { res = await ctx.payment.charge({ proposal: p, store }); } catch (e) { res = { ok: false, reason: String(e && e.message || e) }; }
  return db.tx(() => {
    if (res.ok) {
      const dd = deliverDate(now, ctx.R);
      db.run(`UPDATE proposals SET status = 'paid', paid_at = ?, pay_ref = ?, pay_method = ?, deliver_date = ?, pay_fail_reason = NULL WHERE id = ?`,
        [now, res.ref || null, res.method || ctx.R.pay_method, dd, p.id]);
      const q = load(db, p.id);
      msg.enqueue(ctx, q, 'confirm', now);
      logEvent(db, { t: now, kind: '결제 완료', store_id: p.store_id, proposal_id: p.id, region_id: store.region_id, actor, message: `${store.name} · ${res.method === 'invoice' ? '후불 청구 확정' : '자동결제'} · ${dd} 배송` });
      return q;
    }
    db.run("UPDATE proposals SET status = 'payfail', pay_failed_at = ?, pay_fail_reason = ? WHERE id = ?", [now, String(res.reason || '결제 실패').slice(0, 200), p.id]);
    const q = load(db, p.id);
    msg.enqueue(ctx, q, 'payfail', now);
    logEvent(db, { t: now, kind: '결제 실패', store_id: p.store_id, proposal_id: p.id, region_id: store.region_id, actor, message: `${store.name} · ${q.pay_fail_reason}` });
    return q;
  });
}

async function retryPayment(ctx, pid, actor, now = Date.now()) {
  const p = load(ctx.db, pid);
  if (p.status !== 'payfail') throw new Error('결제 실패 건만 재결제할 수 있습니다');
  return charge(ctx, p, actor, now);
}

function hold(ctx, pid, { actor = 'owner' } = {}, now = Date.now()) {
  const { db, R } = ctx;
  return db.tx(() => {
    const p = load(db, pid);
    if (!['created', 'sent'].includes(p.status) || p.responded_at != null) throw new Error('이미 처리된 발주입니다');
    db.run(`UPDATE proposals SET status = 'held', responded_at = ?, response = 'hold', responder = ?, closed_at = ?, opened_at = COALESCE(opened_at, ?) WHERE id = ?`, [now, actor, now, now, pid]);
    db.run('UPDATE stores SET cooldown_until = ? WHERE id = ?', [T.at(T.kstMidnight(now) + T.DAY, R.retryH), p.store_id]);
    msg.enqueue(ctx, p, 'hold_ack', now);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '보류', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · 보류 → 내일 재확인` });
    return load(db, pid);
  });
}

function cancel(ctx, pid, actor, now = Date.now()) {
  const { db } = ctx;
  return db.tx(() => {
    const p = load(db, pid);
    if (!['created', 'sent', 'payfail', 'paid'].includes(p.status)) throw new Error('배차 전 발주만 취소할 수 있습니다');
    db.run("UPDATE proposals SET status = 'cancelled', closed_at = ? WHERE id = ?", [now, pid]);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '취소', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · ${p.code} 취소` });
    return load(db, pid);
  });
}

function markOpened(ctx, pid, now) {
  ctx.db.run('UPDATE proposals SET opened_at = ? WHERE id = ? AND opened_at IS NULL AND sent_at IS NOT NULL', [now, pid]);
}

module.exports = { deliverDate, approve, retryPayment, hold, cancel, markOpened };
