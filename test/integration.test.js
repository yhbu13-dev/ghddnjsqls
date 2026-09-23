'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const snapshot = require('../server/api/snapshot');
const props = require('../server/engine/proposals');
const inv = require('../server/engine/inventory');
const orders = require('../server/engine/orders');
const { fixture, at } = require('./helpers');

test('스냅샷: 파일럿 주차 집계 · 당일배송 달성률 · 매장 이력', async () => {
  const { ctx, db, s1 } = fixture();
  inv.recordCount(ctx, s1, { CL125: 1, SD150: 3, WT200: 3 }, 't', at(8), true);
  const [p] = props.evaluateTriggers(ctx, at(9.5));
  props.sendDue(ctx, at(9.5));
  await orders.approve(ctx, p.id, {}, at(10));
  const snap = snapshot.build(ctx, { role: 'admin' }, at(20));
  const wk = snap.pilot.weeks[snap.pilot.weeks.length - 1];
  assert.equal(wk.decided, 1);
  assert.equal(wk.approved, 1);
  assert.equal(snap.pilot.orders, 1);
  assert.ok(snap.proposals.some((x) => x.pid === p.id && x.status === 'paid'));
  const h = snapshot.storeHistory(ctx, s1, 'CL125', 14, at(20));
  assert.equal(h.proposals.length, 1);
  assert.ok(Array.isArray(h.points));
  assert.equal(db.get('SELECT COUNT(*) AS c FROM events').c > 0, true);
});

test('샘플 데이터 생성기가 실제 엔진으로 1주 파일럿을 끝까지 돌린다', () => {
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'seed-sample.js'), '--db', ':memory:', '--weeks', '1'], { encoding: 'utf8', timeout: 120000 });
  const m = /매장 (\d+) · POS 판매 (\d+) · 발주 (\d+) · 배송 (\d+) · 실사 (\d+)/.exec(out);
  assert.ok(m, out);
  assert.equal(+m[1], 50);
  assert.ok(+m[2] > 1000, 'POS 판매 ' + m[2]);
  assert.ok(+m[3] > 20, '발주 ' + m[3]);
  assert.ok(+m[4] > 10, '배송 ' + m[4]);
});
