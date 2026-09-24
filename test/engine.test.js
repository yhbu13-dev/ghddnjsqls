'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../server/time');
const inv = require('../server/engine/inventory');
const props = require('../server/engine/proposals');
const orders = require('../server/engine/orders');
const delivery = require('../server/engine/delivery');
const settlement = require('../server/engine/settlement');
const jobs = require('../server/jobs');
const { fixture, at } = require('./helpers');

const store = (db, id) => db.get('SELECT * FROM stores WHERE id = ?', [id]);
const item = (db, id, sku) => db.get('SELECT * FROM store_skus WHERE store_id = ? AND sku_id = ?', [id, sku]);
const onboard = (ctx, id, t, vals = { CL125: 3, SD150: 3, WT200: 3 }) => inv.recordCount(ctx, id, vals, 'tester', t, true);

test('KST 규칙: 컷오프 전후 배송일, 일요일 건너뛰기', () => {
  const { ctx } = fixture();
  assert.equal(orders.deliverDate(at(11.9), ctx.R), '2026-03-10');
  assert.equal(orders.deliverDate(at(12.1), ctx.R), '2026-03-11');
  // 3/14 토요일 오후 승인 → 일요일 휴무 → 3/16 월요일
  assert.equal(orders.deliverDate(at(15, 4), ctx.R), '2026-03-16');
  assert.equal(T.fmtTime(at(14.5)), '14:30');
});

test('POS 판매는 매핑된 SKU 재고를 차감하고 밴드를 넓힌다 (중복 ext_id는 무시)', () => {
  const { ctx, db, s1 } = fixture();
  onboard(ctx, s1, at(9));
  const st = store(db, s1);
  inv.applySale(ctx, st, { ext_id: 'a1', sold_at: at(12), menu: '콜라 1.25L', qty: 6 }, at(12));
  const dup = inv.applySale(ctx, st, { ext_id: 'a1', sold_at: at(12), menu: '콜라 1.25L', qty: 6 }, at(12));
  assert.equal(dup.dup, true);
  const it = item(db, s1, 'CL125');
  assert.ok(Math.abs(it.est - 2.5) < 1e-9, 'est=' + it.est);
  assert.ok(it.band > ctx.R.band_w0);
  // 세트메뉴는 두 SKU를 동시에 차감
  inv.applySale(ctx, st, { ext_id: 'a2', sold_at: at(13), menu: '세트A', qty: 12 }, at(13));
  assert.ok(Math.abs(item(db, s1, 'SD150').est - 2) < 1e-9);
  // 매핑 없는 메뉴는 미매핑 목록으로
  inv.applySale(ctx, st, { ext_id: 'a3', sold_at: at(13), menu: '수제 레몬에이드', qty: 2 }, at(13));
  assert.equal(db.get('SELECT qty FROM unmapped_menu WHERE store_id = ?', [s1]).qty, 2);
  // 실사보다 먼저 팔린 판매가 늦게 도착하면 추정에 반영하지 않음
  inv.applyCount(ctx, store(db, s1), { CL125: 2 }, { source: 'ops' }, at(14));
  inv.applySale(ctx, store(db, s1), { ext_id: 'late', sold_at: at(13.5), menu: '콜라 1.25L', qty: 12 }, at(15));
  assert.equal(item(db, s1, 'CL125').est, 2);
});

test('실사로 누수율 α를 학습하고 추정·밴드를 리셋한다', () => {
  const { ctx, db, s1 } = fixture();
  onboard(ctx, s1, at(9), { CL125: 3, SD150: 3, WT200: 3 });
  let st = store(db, s1);
  for (let i = 0; i < 12; i++) inv.applySale(ctx, st, { ext_id: 'b' + i, sold_at: at(12 + i * 0.2), menu: '콜라 1.25L', qty: 1 }, at(12 + i * 0.2));
  // POS 1박스 판매, 실제 잔량 1.8 → 실제 소진 1.2 → 관측 누수 20%
  inv.applyCount(ctx, store(db, s1), { CL125: 1.8 }, { source: 'driver' }, at(20));
  st = store(db, s1);
  assert.ok(Math.abs(st.alpha - 0.35 * 0.2) < 1e-9, 'alpha=' + st.alpha);
  const it = item(db, s1, 'CL125');
  assert.equal(it.est, 1.8);
  assert.equal(it.band, ctx.R.band_w0);
  const c = db.get('SELECT * FROM counts WHERE store_id = ? AND source = ?', [s1, 'driver']);
  assert.ok(Math.abs(c.estimate - 2) < 1e-9 && c.actual === 1.8);
});

test('트리거 → 묶음 제안 → 야간 생성분 09시 발송 → 승인 → 배차 → 하차·실사 → 입고', async () => {
  const { ctx, db, s1 } = fixture();
  onboard(ctx, s1, at(9, -1), { CL125: 1.0, SD150: 1.1, WT200: 5 });
  // 22시에 하한 도달 → 다음 날 09시 발송 예약
  const created = props.evaluateTriggers(ctx, at(22, -1));
  assert.equal(created.length, 1);
  const p = created[0];
  assert.equal(p.send_rule, 'night');
  assert.equal(p.send_at, at(9));
  const lines = db.all('SELECT * FROM proposal_lines WHERE proposal_id = ? ORDER BY trig DESC', [p.id]);
  assert.equal(lines[0].trig, 1);
  assert.ok(lines.some((l) => l.sku_id === 'SD150'), '곧 소진될 사이다도 묶임');
  assert.ok(!lines.some((l) => l.sku_id === 'WT200'), '여유 있는 생수는 제외');
  // 진행 중 발주가 있으면 중복 제안하지 않음
  assert.equal(props.evaluateTriggers(ctx, at(23, -1)).length, 0);
  props.sendDue(ctx, at(8.9));
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [p.id]).status, 'created');
  props.sendDue(ctx, at(9));
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [p.id]).status, 'sent');
  assert.equal(db.get("SELECT COUNT(*) AS c FROM messages WHERE kind = 'propose'").c, 1);
  const body = db.get("SELECT body FROM messages WHERE kind = 'propose'").body;
  assert.match(body, /https:\/\/ops\.example\.com\/o\//);
  // 사장님 수량 수정 승인 (11시 → 오늘 배송)
  const q = await orders.approve(ctx, p.id, { qty: { CL125: lines[0].qty + 1 }, actor: 'owner' }, at(11));
  assert.equal(q.status, 'paid');
  assert.equal(q.deliver_date, '2026-03-10');
  assert.equal(q.modified, 1);
  assert.equal(q.pay_method, 'invoice');
  await assert.rejects(() => orders.approve(ctx, p.id, {}, at(11.1)), /이미 처리된/);
  // 13:30 배차
  await jobs.tick(ctx, at(13.5));
  const stop = db.get('SELECT * FROM stops WHERE proposal_id = ?', [p.id]);
  assert.ok(stop && stop.seq === 1 && stop.eta > at(13.5));
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [p.id]).status, 'dispatched');
  delivery.arrive(ctx, stop.id, {}, at(14));
  delivery.complete(ctx, stop.id, { counts: { CL125: 0.5, SD150: 0.9, WT200: 4.8 } }, at(14.12));
  const cl = item(db, s1, 'CL125');
  assert.equal(cl.est, 0.5 + lines[0].qty + 1);
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [p.id]).status, 'delivered');
  assert.equal(db.get('SELECT status FROM stops WHERE id = ?', [stop.id]).status, 'done');
  assert.ok(db.get("SELECT COUNT(*) AS c FROM messages WHERE kind = 'delivered'").c === 1);
});

test('컷오프 이후 승인은 다음 배송일, 보류는 다음 날 10시까지 재제안 없음, 무응답은 만료', async () => {
  const { ctx, db, s1, s2 } = fixture();
  onboard(ctx, s1, at(9), { CL125: 1.0, SD150: 3, WT200: 3 });
  onboard(ctx, s2, at(9), { CL125: 1.0, SD150: 3, WT200: 3 });
  const [a, b] = props.evaluateTriggers(ctx, at(12.5));
  props.sendDue(ctx, at(12.5));
  const pa = await orders.approve(ctx, a.id, {}, at(12.7));
  assert.equal(pa.deliver_date, '2026-03-11');
  orders.hold(ctx, b.id, {}, at(12.8));
  assert.equal(props.evaluateTriggers(ctx, at(20)).length, 0, '보류 매장은 쿨다운');
  assert.equal(store(db, s2).cooldown_until, at(10, 1));
  const [c] = props.evaluateTriggers(ctx, at(10.1, 1));
  assert.equal(c.store_id, s2);
  assert.equal(c.reproposal, 1);
  props.sendDue(ctx, at(10.1, 1));
  props.sweepPending(ctx, at(11.2, 1));
  assert.ok(db.get('SELECT reminded_at FROM proposals WHERE id = ?', [c.id]).reminded_at, '60분 경과 자동 리마인드');
  props.sweepPending(ctx, at(13.2, 1));
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [c.id]).status, 'expired');
});

test('브레이크타임 선호 매장은 15시 발송, 검수 대상 매장은 운영자 발송 전까지 대기', () => {
  const { ctx, db, s1, s2 } = fixture();
  db.run("UPDATE stores SET send_pref = 'break' WHERE id = ?", [s1]);
  db.run('UPDATE stores SET review_required = 1 WHERE id = ?', [s2]);
  onboard(ctx, s1, at(9), { CL125: 1.0, SD150: 3, WT200: 3 });
  onboard(ctx, s2, at(9), { CL125: 1.0, SD150: 3, WT200: 3 });
  const [a, b] = props.evaluateTriggers(ctx, at(12));
  assert.equal(a.send_rule, 'break');
  assert.equal(a.send_at, at(15));
  assert.equal(b.review, 1);
  assert.equal(b.send_at, null);
  props.sendDue(ctx, at(20));
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [b.id]).status, 'created');
  props.sendNow(ctx, b.id, 'ops', at(20.1));
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [b.id]).status, 'sent');
});

test('카드 결제 실패 → 재결제, 배송 실패 → 다음 배송일 재배차', async () => {
  const { ctx, db, s1 } = fixture({ pay_method: 'sandbox_card' });
  db.run('UPDATE stores SET pay_test_fail = 1 WHERE id = ?', [s1]);
  onboard(ctx, s1, at(8), { CL125: 1.0, SD150: 3, WT200: 3 });
  const [p] = props.evaluateTriggers(ctx, at(9.5));
  props.sendDue(ctx, at(9.5));
  const f = await orders.approve(ctx, p.id, {}, at(10));
  assert.equal(f.status, 'payfail');
  db.run('UPDATE stores SET pay_test_fail = 0 WHERE id = ?', [s1]);
  const ok = await orders.retryPayment(ctx, p.id, 'ops', at(10.5));
  assert.equal(ok.status, 'paid');
  delivery.dispatch(ctx, T.kstMidnight(at(13.5)), at(13.5));
  const stop = db.get('SELECT * FROM stops WHERE proposal_id = ?', [p.id]);
  delivery.fail(ctx, stop.id, { reason: '매장 휴무' }, at(15));
  const q = db.get('SELECT * FROM proposals WHERE id = ?', [p.id]);
  assert.equal(q.status, 'paid');
  assert.equal(q.deliver_date, '2026-03-11');
});

test('정산: 주차별 GMV와 수수료 3%, 취소 제외, CSV 수식 주입 방지', async () => {
  const { ctx, db, s1, s2 } = fixture();
  onboard(ctx, s1, at(8), { CL125: 1.0, SD150: 3, WT200: 3 });
  onboard(ctx, s2, at(8), { CL125: 1.0, SD150: 3, WT200: 3 });
  const [a, b] = props.evaluateTriggers(ctx, at(9.5));
  props.sendDue(ctx, at(9.5));
  const pa = await orders.approve(ctx, a.id, {}, at(10));
  const pb = await orders.approve(ctx, b.id, {}, at(10));
  orders.cancel(ctx, pb.id, 'ops', at(10.2));
  const w = settlement.weeks(ctx, at(12));
  const wk2 = w.find((x) => x.start === '2026-03-09');
  assert.equal(wk2.orders, 1);
  assert.equal(wk2.gmv, pa.amount);
  assert.equal(wk2.fee, Math.round(pa.amount * 0.03));
  assert.equal(wk2.status, 'open');
  assert.equal(w[0].status, 'closed');
  db.run("UPDATE stores SET name = '=HYPERLINK(\"x\")' WHERE id = ?", [s1]);
  const csv = settlement.csv(ctx, '2026-03-09');
  assert.match(csv, /'=HYPERLINK/);
});
