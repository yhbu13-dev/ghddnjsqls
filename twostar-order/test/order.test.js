'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const O = require('../src/order');
const { skill } = require('../src/kakao');
const { createApp } = require('../src/server');

function setup() {
  const db = open(':memory:');
  const add = (category, grp, name, price) => Number(db.run('INSERT INTO items (category, grp, name, price) VALUES (?, ?, ?, ?)', [category, grp, name, price]).lastInsertRowid);
  const ids = {
    snack: add('snack', '과자', '새우깡', 1200),
    snack2: add('snack', '과자', '양파링', 1300),
    cafe: add('cafe', '시럽', '바닐라 시럽', 11000),
    bev: add('beverage', '탄산', '콜라 24입', 19000),
  };
  const sauna = O.createStore(db, { name: '해오름사우나', biz: 'sauna' });
  return { db, ids, sauna, store: O.storeOf(db, sauna.id) };
}

test('업종 기본 품목만 보이고, 승인해야 다른 품목이 열린다', () => {
  const { db, ids, store } = setup();
  assert.deepEqual(O.categoriesOf(db, store), ['snack']);
  assert.throws(() => O.setQty(db, store, ids.cafe, 1), /발주할 수 없는/);
  assert.equal(O.requestAccess(db, store, 'cafe'), 'requested');
  assert.equal(O.requestAccess(db, store, 'cafe'), 'pending');
  assert.throws(() => O.requestAccess(db, store, 'snack'), /이미/);
  O.decideAccess(db, store.id, 'cafe', 'approve');
  assert.deepEqual(O.categoriesOf(db, store), ['cafe', 'snack']);
  O.setQty(db, store, ids.cafe, 2);
  O.decideAccess(db, store.id, 'cafe', 'revoke');
  assert.equal(O.cartOf(db, store).count, 0, '승인 해제 시 장바구니에서 빠짐');
  assert.throws(() => O.decideAccess(db, store.id, 'snack', 'reject'), /바꿀 수 없는/);
});

test('주문: 버전 확인 · 중복 방지 · 최소 금액 · 지난 발주 불러오기', () => {
  const { db, ids, store } = setup();
  O.addQty(db, store, ids.snack, 3);
  O.addQty(db, store, ids.snack2, 2);
  const cart = O.cartOf(db, store);
  assert.equal(cart.total, 3 * 1200 + 2 * 1300);
  assert.throws(() => O.submit(db, store, cart.rev, { minAmount: 100000 }), /최소 발주/);
  assert.throws(() => O.submit(db, store, cart.rev - 1), /바뀌었/);
  const a = O.submit(db, store, cart.rev);
  const b = O.submit(db, store, cart.rev);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(a.order.id, b.order.id);
  assert.match(a.order.no, /^\d{4}-001$/);
  assert.equal(O.cartOf(db, store).count, 0);
  assert.equal(O.reorder(db, store), 2);
  assert.equal(O.cartOf(db, store).total, cart.total);
  O.setStatus(db, a.order.id, 'confirmed');
  assert.throws(() => O.setStatus(db, a.order.id, 'received'), /바꿀 수 없/);
});

test('카카오 스킬: 연결 코드 → 버튼으로 담고 주문', () => {
  const { db, ids, sauna } = setup();
  const ctx = { db, blockId: 'B1', orderLink: (id) => `https://x/o/${id}`, minAmount: 0 };
  const req = (extra, utterance = '버튼') => skill(ctx, { userRequest: { user: { id: 'u1' }, utterance }, action: { clientExtra: extra } });

  let r = req({});
  assert.match(JSON.stringify(r), /연결 코드 6자리/);
  r = req({}, '000000');
  if (sauna.code !== '000000') assert.match(JSON.stringify(r), /맞지 않아요/);
  r = req({}, sauna.code);
  assert.match(JSON.stringify(r), /연결되었어요/);
  assert.equal(r.template.outputs[1].textCard.buttons[0].action, 'webLink');

  r = req({ s: 'cats' }); // 기본 분류 하나뿐 → 바로 묶음 목록
  assert.ok(r.template.outputs[1].carousel.items.some((c) => c.title === '과자'));
  r = req({ s: 'items', c: 'snack', g: '과자' });
  const card = r.template.outputs[1].carousel.items[0];
  assert.equal(card.buttons.length, 3);
  assert.ok(card.buttons.every((b) => b.label.length <= 14 && b.blockId === 'B1'));
  req({ s: 'add', i: ids.snack, n: 5 });
  r = req({ s: 'add', i: ids.cafe, n: 1 });
  assert.match(JSON.stringify(r), /발주할 수 없는/);
  r = req({ s: 'confirm' });
  const ok = r.template.outputs[0].textCard.buttons[0];
  r = req(ok.extra);
  assert.match(JSON.stringify(r), /주문이 접수되었어요/);
  r = req(ok.extra);
  assert.match(JSON.stringify(r), /이미 접수된/);
  r = req({ s: 'history' });
  assert.match(JSON.stringify(r), /접수/);
  r = req({ s: 'reqgo', c: 'cafe' });
  assert.match(JSON.stringify(r), /신청했어요/);
  // 모든 응답은 오픈빌더 제한 안에 있어야 함
  for (const x of [{}, { s: 'cart' }, { s: 'req' }, { s: 'groups', c: 'snack' }]) {
    const out = req(x);
    assert.equal(out.version, '2.0');
    assert.ok(out.template.quickReplies.length <= 10);
    for (const o of out.template.outputs) if (o.carousel) assert.ok(o.carousel.items.length <= 10);
  }
});

test('HTTP: 스킬 키 · 발주서 링크 · 관리자 로그인', async () => {
  const { server, db, orderLink } = createApp({
    port: 0, publicUrl: 'http://localhost', adminPassword: 'pw1234', skillKey: 'k1', blockId: 'B', minAmount: 0,
    guest: {}, dbFile: ':memory:', secret: 'test-secret',
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    db.run("INSERT INTO items (category, grp, name, price) VALUES ('snack', '과자', '새우깡', 1200)");
    const s = O.createStore(db, { name: '테스트사우나', biz: 'sauna' });

    let r = await fetch(`${base}/kakao/skill?key=nope`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 403);
    r = await fetch(`${base}/kakao/skill?key=k1`, { method: 'POST', body: JSON.stringify({ userRequest: { user: { id: 'u' }, utterance: '안녕' } }) });
    assert.equal((await r.json()).version, '2.0');

    const link = orderLink(s.id).replace('http://localhost', base).replace('/o/', '/api/o/');
    r = await fetch(link);
    const v = await r.json();
    assert.equal(v.items.length, 1);
    r = await fetch(`${link}/cart`, { method: 'PUT', body: JSON.stringify({ cart: { [v.items[0].id]: 4 } }) });
    assert.equal(r.status, 403, 'x-ts 헤더 없으면 거절');
    r = await fetch(`${link}/cart`, { method: 'PUT', headers: { 'x-ts': '1' }, body: JSON.stringify({ cart: { [v.items[0].id]: 4 } }) });
    const v2 = await r.json();
    r = await fetch(`${link}/submit`, { method: 'POST', headers: { 'x-ts': '1' }, body: JSON.stringify({ rev: v2.rev }) });
    assert.equal((await r.json()).total, 4800);
    r = await fetch(link.replace(/\.[^.]+$/, '.forged'));
    assert.equal(r.status, 404);

    r = await fetch(`${base}/api/admin/data`);
    assert.equal(r.status, 401);
    r = await fetch(`${base}/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
    assert.equal(r.status, 401);
    r = await fetch(`${base}/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'pw1234' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    r = await fetch(`${base}/api/admin/data`, { headers: { cookie } });
    const d = await r.json();
    assert.equal(d.orders.length, 1);
    assert.equal(d.pick[0].qty, 4);
    r = await fetch(`${base}/api/admin/status`, { method: 'POST', headers: { cookie, 'x-ts': '1' }, body: JSON.stringify({ id: d.orders[0].id, status: 'confirmed' }) });
    assert.equal((await r.json()).orders[0].status, 'confirmed');
  } finally {
    server.close();
  }
});
