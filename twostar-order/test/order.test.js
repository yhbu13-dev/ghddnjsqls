'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { open } = require('../src/db');
const { d1 } = require('../src/d1');
const { migrate } = require('../src/schema');
const O = require('../src/order');
const { skill } = require('../src/kakao');
const { createApp, config } = require('../src/server');
const { createHandler } = require('../src/app');

async function setup() {
  const db = open(':memory:');
  await migrate(db);
  const add = async (category, grp, name, price) => (await db.run('INSERT INTO items (category, grp, name, price) VALUES (?, ?, ?, ?)', [category, grp, name, price])).lastRowId;
  const ids = {
    snack: await add('snack', '과자', '새우깡', 1200),
    snack2: await add('snack', '과자', '양파링', 1300),
    cafe: await add('cafe', '시럽', '바닐라 시럽', 11000),
    bev: await add('beverage', '탄산', '콜라 24입', 19000),
  };
  const sauna = await O.createStore(db, { name: '해오름사우나', biz: 'sauna' });
  return { db, ids, sauna, store: await O.storeOf(db, sauna.id) };
}

async function startApp(extra = {}) {
  const app = createApp({
    port: 0, publicUrl: 'http://localhost', adminPassword: 'pw1234', skillKey: 'k1', blockId: 'B', minAmount: 0,
    guest: {}, dbFile: ':memory:', secret: 'test-secret', ...extra,
  });
  await app.ready();
  await new Promise((r) => app.server.listen(0, r));
  app.base = `http://127.0.0.1:${app.server.address().port}`;
  return app;
}

test('업종 기본 품목만 보이고, 승인해야 다른 품목이 열린다', async () => {
  const { db, ids, store } = await setup();
  assert.deepEqual(await O.categoriesOf(db, store), ['snack']);
  await assert.rejects(O.setQty(db, store, ids.cafe, 1), /발주할 수 없는/);
  assert.equal(await O.requestAccess(db, store, 'cafe'), 'requested');
  assert.equal(await O.requestAccess(db, store, 'cafe'), 'pending');
  await assert.rejects(O.requestAccess(db, store, 'snack'), /이미/);
  await O.decideAccess(db, store.id, 'cafe', 'approve');
  assert.deepEqual(await O.categoriesOf(db, store), ['cafe', 'snack']);
  await O.setQty(db, store, ids.cafe, 2);
  await O.decideAccess(db, store.id, 'cafe', 'revoke');
  assert.equal((await O.cartOf(db, store)).count, 0, '승인 해제 시 장바구니에서 빠짐');
  await assert.rejects(O.decideAccess(db, store.id, 'snack', 'reject'), /바꿀 수 없는/);
});

test('주문: 버전 확인 · 중복 방지 · 최소 금액 · 지난 발주 불러오기', async () => {
  const { db, ids, store } = await setup();
  await O.addQty(db, store, ids.snack, 3);
  await O.addQty(db, store, ids.snack2, 2);
  const cart = await O.cartOf(db, store);
  assert.equal(cart.total, 3 * 1200 + 2 * 1300);
  await assert.rejects(O.submit(db, store, cart.rev, { minAmount: 100000 }), /최소 발주/);
  await assert.rejects(O.submit(db, store, cart.rev - 1), /바뀌었/);
  const a = await O.submit(db, store, cart.rev);
  const b = await O.submit(db, store, cart.rev);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(a.order.id, b.order.id);
  assert.match(a.order.no, /^\d{4}-001$/);
  assert.equal((await db.all('SELECT * FROM order_lines WHERE order_id = ?', [a.order.id])).length, 2);
  assert.equal((await O.cartOf(db, store)).count, 0);
  assert.equal(await O.reorder(db, store), 2);
  assert.equal((await O.cartOf(db, store)).total, cart.total);
  // 두 번째 주문은 002
  const c2 = await O.cartOf(db, store);
  assert.match((await O.submit(db, store, c2.rev)).order.no, /^\d{4}-002$/);
  await O.setStatus(db, a.order.id, 'confirmed');
  await assert.rejects(O.setStatus(db, a.order.id, 'received'), /바꿀 수 없/);
});

test('카카오 스킬: 연결 코드 → 버튼으로 담고 주문', async () => {
  const { db, ids, sauna } = await setup();
  const ctx = { db, blockId: 'B1', orderLink: (st) => `https://x/o/${st.id}`, minAmount: 0 };
  const req = (extra, utterance = '버튼') => skill(ctx, { userRequest: { user: { id: 'u1' }, utterance }, action: { clientExtra: extra } });

  let r = await req({});
  assert.match(JSON.stringify(r), /연결 코드 6자리/);
  r = await req({}, '000000');
  if (sauna.code !== '000000') assert.match(JSON.stringify(r), /맞지 않아요/);
  r = await req({}, sauna.code);
  assert.match(JSON.stringify(r), /연결되었어요/);
  assert.equal(r.template.outputs[1].textCard.buttons[0].action, 'webLink');

  r = await req({ s: 'cats' }); // 기본 분류 하나뿐 → 바로 묶음 목록
  assert.ok(r.template.outputs[1].carousel.items.some((c) => c.title === '과자'));
  r = await req({ s: 'items', c: 'snack', g: '과자' });
  const card = r.template.outputs[1].carousel.items[0];
  assert.equal(card.buttons.length, 3);
  assert.ok(card.buttons.every((b) => b.label.length <= 14 && b.blockId === 'B1'));
  // 담기 → 같은 캐러셀을 방금 누른 품목부터 다시 (대화 맨 아래에 새로 뜸)
  r = await req(card.buttons[1].extra);
  assert.match(r.template.outputs[0].simpleText.text, /새우깡 5개 담았어요/);
  assert.equal(r.template.outputs[1].carousel.items[0].title, '✅ 새우깡');
  r = await req(r.template.outputs[1].carousel.items[1].buttons[0].extra); // 양파링 +1
  assert.equal(r.template.outputs[1].carousel.items[0].title, '✅ 양파링');
  await req({ s: 'add', i: ids.snack2, n: -999 });
  r = await req({ s: 'add', i: ids.cafe, n: 1 });
  assert.match(JSON.stringify(r), /발주할 수 없는/);
  r = await req({ s: 'confirm' });
  const ok = r.template.outputs[0].textCard.buttons[0];
  r = await req(ok.extra);
  assert.match(JSON.stringify(r), /발주가 접수되었어요/);
  r = await req(ok.extra);
  assert.match(JSON.stringify(r), /이미 접수된/);
  r = await req({ s: 'history' });
  assert.match(JSON.stringify(r), /접수/);
  r = await req({ s: 'reqgo', c: 'cafe' });
  assert.match(JSON.stringify(r), /신청했어요/);

  // 연결 코드 대입: 10분에 5번까지
  for (let i = 0; i < 5; i++) await skill(ctx, { userRequest: { user: { id: 'bad' }, utterance: '000001' } });
  r = await skill(ctx, { userRequest: { user: { id: 'bad' }, utterance: '000002' } });
  assert.match(JSON.stringify(r), /입력 횟수를 넘었어요/);
});

test('HTTP: 스킬 키 · 발주서 링크 · 관리자 로그인 · 새 소식', async () => {
  const { server, db, orderLink, base } = await startApp();
  try {
    await db.run("INSERT INTO items (category, grp, name, price) VALUES ('snack', '과자', '새우깡', 1200)");
    const s = await O.createStore(db, { name: '테스트사우나', biz: 'sauna' });

    let r = await fetch(`${base}/kakao/skill?key=nope`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 403);
    r = await fetch(`${base}/kakao/skill?key=k1`, { method: 'POST', body: JSON.stringify({ userRequest: { user: { id: 'u' }, utterance: '안녕' } }) });
    assert.equal((await r.json()).version, '2.0');
    r = await fetch(`${base}/kakao/skill?key=k1`, { method: 'POST', body: 'not json' });
    assert.equal((await r.json()).version, '2.0', '깨진 요청에도 규격에 맞는 답');

    r = await fetch(`${base}/assets/app.css`);
    assert.match(r.headers.get('content-type'), /text\/css/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);

    const page = orderLink(s.id).replace('http://localhost', base);
    r = await fetch(page);
    assert.match(await r.text(), /<script src="\/assets\/order.js">/);
    const link = page.replace('/o/', '/api/o/');
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
    r = await fetch(`${base}/admin`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    r = await fetch(`${base}/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'wrong' }) });
    assert.equal(r.status, 401);
    r = await fetch(`${base}/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'pw1234' }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    r = await fetch(`${base}/api/admin/data`, { headers: { cookie } });
    const d = await r.json();
    assert.equal(d.orders.length, 1);
    assert.equal(d.pick[0].qty, 4);
    assert.match(d.events.at(-1).text, /새 주문/);
    assert.equal(d.skillUrl, 'http://localhost/kakao/skill?key=k1');
    r = await fetch(`${base}/api/admin/status`, { method: 'POST', headers: { cookie, 'x-ts': '1' }, body: JSON.stringify({ id: d.orders[0].id, status: 'confirmed' }) });
    assert.equal((await r.json()).orders[0].status, 'confirmed');
  } finally {
    server.close();
  }
});

test('엑셀 붙여넣기로 품목 한꺼번에 넣기', async () => {
  const { db } = await setup();
  const bad = await O.importItems(db, '분류\t묶음\t품목명\t규격\t단위\t단가\n간식\t과자\t꼬북칩\t\t개\t1500');
  assert.equal(bad.added, 0);
  assert.match(bad.errors[0], /2번째 줄: 분류/);
  const r = await O.importItems(db, [
    '분류\t묶음\t품목명\t규격\t단위\t단가',
    '스낵\t과자\t꼬북칩\t\t개\t1,500',
    '스낵\t과자\t새우깡\t\t개\t1300원', // 이미 있음 → 가격 수정
    '카페,시럽,헤이즐넛 시럽,1L,병,11000',
  ].join('\n'));
  assert.deepEqual([r.added, r.updated, r.errors], [2, 1, []]);
  assert.equal((await db.get("SELECT price FROM items WHERE name = '새우깡'")).price, 1300);
  assert.equal((await db.get("SELECT unit FROM items WHERE name = '헤이즐넛 시럽'")).unit, '병');
});

test('품목 사진: 올리기 · 발주서 표시 · 위조 파일 거절 · 예전 DB 업그레이드', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  // 예전 DB (image 칸·user_stores 없음) → migrate 하면 칸이 생기고 연결 정보가 옮겨짐
  const oldFile = path.join(dir, 'old.db');
  const raw = new DatabaseSync(oldFile);
  raw.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, category TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '기타', name TEXT NOT NULL, spec TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '개', price INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)");
  raw.exec("CREATE TABLE stores (id INTEGER PRIMARY KEY, name TEXT NOT NULL, biz TEXT NOT NULL, owner TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', code TEXT UNIQUE, cart_rev INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)");
  raw.exec("CREATE TABLE links (user_key TEXT PRIMARY KEY, store_id INTEGER NOT NULL, linked_at INTEGER NOT NULL)");
  raw.exec("INSERT INTO stores (name, biz, created_at) VALUES ('옛매장', 'cafe', 1); INSERT INTO links VALUES ('old-user', 1, 1)");
  raw.close();
  const up = open(oldFile);
  await migrate(up);
  await migrate(up); // 두 번 해도 안전
  assert.ok((await up.all('PRAGMA table_info(items)')).some((c) => c.name === 'image'));
  assert.equal((await O.storesOfUser(up, 'old-user')).length, 1);
  up.close();

  const { server, db, base } = await startApp({ publicUrl: 'https://demo.example', adminPassword: 'pw', skillKey: 'k' });
  try {
    const a = (await db.run("INSERT INTO items (category, grp, name, price) VALUES ('snack', '과자', '새우깡', 1200)")).lastRowId;
    await db.run("INSERT INTO items (category, grp, name, price) VALUES ('snack', '과자', '양파링', 1300)");
    let r = await fetch(`${base}/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
    const H = { cookie: r.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
    r = await fetch(`${base}/api/admin/item-image`, { method: 'POST', headers: H, body: JSON.stringify({ id: a, data: `data:image/jpeg;base64,${Buffer.from('<svg onload=x>').toString('base64')}` }) });
    assert.equal(r.status, 400, '사진이 아닌 파일은 거절');
    r = await fetch(`${base}/api/admin/item-image`, { method: 'POST', headers: H, body: JSON.stringify({ id: a, data: `data:image/jpeg;base64,${jpg.toString('base64')}` }) });
    const img = (await r.json()).items.find((i) => i.id === a).image;
    assert.match(img, /^\d+-[0-9a-f]{8}\.jpg$/);
    r = await fetch(`${base}/img/${img}`);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), jpg);
    assert.equal((await fetch(`${base}/img/..%2Fsecret`)).status, 404);

    // 발주서에 사진 이름이 실려 나가고, 카톡 카드는 글자 카드 그대로
    const s = await O.createStore(db, { name: '사우나', biz: 'sauna' });
    const talk = (extra, u = '버튼') => fetch(`${base}/kakao/skill?key=k`, { method: 'POST', body: JSON.stringify({ userRequest: { user: { id: 'p' }, utterance: u }, action: { clientExtra: extra } }) }).then((x) => x.json());
    const link = (await talk({}, s.code)).template.outputs[1].textCard.buttons[0].webLinkUrl;
    const sheet = await (await fetch(link.replace('https://demo.example/o/', `${base}/api/o/`))).json();
    assert.equal(sheet.items.find((i) => i.id === a).image, img);
    assert.equal((await talk({ s: 'items', c: 'snack', g: '과자' })).template.outputs[1].carousel.type, 'textCard');

    r = await fetch(`${base}/api/admin/item-image`, { method: 'POST', headers: H, body: JSON.stringify({ id: a, remove: true }) });
    assert.equal((await r.json()).items.find((i) => i.id === a).image, '');
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM images')).n, 0, '지운 사진도 삭제');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('카톡 한 계정에 여러 지점: 새 코드 입력 → 그 지점 추가·전환, 매장 바꾸기, 예전 버튼은 그 지점으로', async () => {
  const { db, ids, sauna } = await setup();
  const cafe = await O.createStore(db, { name: '카페 온도', biz: 'cafe' });
  const ctx = { db, blockId: 'B1', orderLink: (st) => `https://x/o/${st.id}`, minAmount: 0 };
  const req = (extra, utterance = '버튼') => skill(ctx, { userRequest: { user: { id: 'boss' }, utterance }, action: { clientExtra: extra } });
  const J = (x) => JSON.stringify(x);

  let r = await req({}, sauna.code);
  assert.match(J(r), /해오름사우나 매장과 연결/);
  assert.ok(!J(r).includes('매장 바꾸기'), '한 곳만 연결되면 [매장 바꾸기] 없음');
  assert.equal(r.template.outputs[1].textCard.buttons[1].extra.st, sauna.id);

  r = await req({}, `${cafe.code.slice(0, 3)} ${cafe.code.slice(3)}`); // 띄어 써도 OK
  assert.match(J(r), /카페 온도 매장과 연결/);
  assert.equal((await O.storeByUser(db, 'boss')).id, cafe.id);
  assert.match(J(r), /매장 바꾸기/);

  r = await req({}, '999999');
  if (![sauna.code, cafe.code].includes('999999')) assert.match(J(r), /코드가 맞지 않아요/);
  assert.equal((await O.storeByUser(db, 'boss')).id, cafe.id, '틀린 코드는 지금 매장을 바꾸지 않음');

  r = await req({ s: 'stores' });
  const pick = r.template.quickReplies.find((q) => q.label === '해오름사우나');
  r = await req(pick.extra);
  assert.match(J(r), /해오름사우나 매장으로 바꿨어요/);
  assert.equal((await O.storeByUser(db, 'boss')).id, sauna.id);

  // 카페 화면에서 받은 버튼을 사우나로 바꾼 뒤 눌러도 → 카페 장바구니에 담김
  r = await req({ s: 'add', i: ids.cafe, n: 2, st: cafe.id });
  assert.match(J(r), /바닐라 시럽 2개 담았어요/);
  assert.equal((await O.cartOf(db, await O.storeOf(db, cafe.id))).count, 1);
  assert.equal((await O.cartOf(db, await O.storeOf(db, sauna.id))).count, 0);

  // 연결 안 된 매장 번호를 억지로 넣어도 무시
  const other = await O.createStore(db, { name: '남의 매장', biz: 'cafe' });
  r = await req({ s: 'use', to: other.id });
  assert.match(J(r), /연결되지 않은 매장/);
  r = await req({ s: 'cart', st: other.id });
  assert.ok(!J(r).includes('남의 매장'));
});

test('모든 카톡 화면이 오픈빌더 응답 규격을 지킨다 (42품목 사우나 · 여러 지점)', async () => {
  const db = open(':memory:');
  await migrate(db);
  let n = 0;
  for (const g of ['과자', '초콜릿·사탕', '빵·간식', '라면·컵', '음료', '아이스크림']) {
    for (let i = 0; i < 7; i++) await db.run("INSERT INTO items (category, grp, name, spec, price, sort) VALUES ('snack', ?, ?, '1박스 24입 대용량 기획', 1200, ?)", [g, `아주긴이름의스낵품목${++n}호 오리지널 대용량`, n]);
  }
  await db.run("INSERT INTO items (category, grp, name, price) VALUES ('cafe', '시럽', '바닐라 시럽', 11000)");
  const a = await O.createStore(db, { name: '아주아주긴이름의해오름사우나본점', biz: 'sauna' });
  const b = await O.createStore(db, { name: '카페 온도', biz: 'cafe' });
  const ctx = { db, blockId: 'B1', orderLink: (st) => `https://x.example/o/${st.id}`, minAmount: 0 };
  const len = (s) => [...String(s)].length;
  const seen = new Set();
  function check(r, where) {
    assert.equal(r.version, '2.0', where);
    const t = r.template;
    assert.ok(t.outputs.length >= 1 && t.outputs.length <= 3, where);
    assert.ok(t.quickReplies.length <= 10, where);
    const btn = (x, quick) => {
      assert.ok(len(x.label) >= 1 && len(x.label) <= 14, `${where}: 버튼 글자 ${x.label}`);
      assert.ok((quick ? ['block', 'message'] : ['block', 'message', 'webLink']).includes(x.action), `${where}: ${x.action}`);
      if (x.action === 'block') { assert.equal(x.blockId, 'B1'); assert.equal(typeof x.extra, 'object'); seen.add(JSON.stringify(x.extra)); }
      if (x.action === 'webLink') assert.match(x.webLinkUrl, /^https:\/\//);
    };
    t.quickReplies.forEach((q) => btn(q, true));
    const card = (c) => {
      assert.ok(len(c.title || '') <= 50, `${where}: 제목 ${c.title}`);
      assert.ok(len(c.description || '') <= 400, `${where}: 설명`);
      assert.ok((c.buttons || []).length <= 3, where);
      (c.buttons || []).forEach((x) => btn(x, false));
    };
    for (const o of t.outputs) {
      const keys = Object.keys(o);
      assert.equal(keys.length, 1, where);
      if (o.simpleText) assert.ok(len(o.simpleText.text) >= 1 && len(o.simpleText.text) <= 1000, `${where}: 글자수`);
      else if (o.textCard) card(o.textCard);
      else if (o.carousel) {
        assert.equal(o.carousel.type, 'textCard', where);
        assert.ok(o.carousel.items.length >= 1 && o.carousel.items.length <= 10, where);
        o.carousel.items.forEach(card);
      } else assert.fail(`${where}: 모르는 출력 ${keys}`);
    }
    return r;
  }
  const say = async (extra, u = '버튼') => check(await skill(ctx, { userRequest: { user: { id: 'v' }, utterance: u }, action: { clientExtra: extra } }), JSON.stringify(extra) + u);
  await say({}); await say({ s: 'cart' });               // 연결 전
  await say({}, a.code); await say({}, b.code);          // 두 지점 연결
  await say({ s: 'use', to: a.id });
  const steps = [{}, { s: 'home' }, { s: 'cats' }, { s: 'groups', c: 'snack' }, { s: 'cart' }, { s: 'reorder' }, { s: 'history' },
    { s: 'req' }, { s: 'stores' }, { s: 'confirm' }, { s: 'items', c: 'snack', g: '과자' }, { s: 'items', c: 'snack', g: '과자', o: 5 },
    { s: 'items', c: 'snack', g: '없는묶음' }, { s: 'add', i: 999, n: 1 }, { s: 'what' }];
  for (const x of steps) await say(x);
  for (let i = 1; i <= 42; i++) await say({ s: 'add', i, n: 3, c: 'snack', g: '과자', o: 0 }); // 42품목 모두 담기
  await say({ s: 'cart' });                              // 긴 장바구니 (1000자 넘으면 잘림)
  const c = await say({ s: 'confirm' });
  await say(c.template.outputs[0].textCard.buttons[0].extra); // 주문 확정
  await say({ s: 'history' }); await say({ s: 'reorder' }); await say({ s: 'clear' });
  await say({ s: 'reqgo', c: 'cafe' }); await say({ s: 'reqgo', c: 'cafe' }); await say({ s: 'reqgo', c: 'nope' });
  await say({}, '123456'); await say({ s: 'use', to: 99999 });
  assert.ok(seen.size > 20);
});

test('클라우드 설정: 고정 주소 · 첫 실행 샘플 · 접속자별 로그인 제한 · 매장 숨기기', async () => {
  const c = config({ RENDER_EXTERNAL_URL: 'https://twostar-order.onrender.com/', SECRET: 's', DATA_DIR: '/tmp/x', TRUST_PROXY: '1', SEED_SAMPLE: '1' });
  assert.equal(c.publicUrl, 'https://twostar-order.onrender.com');
  assert.equal(config({ PUBLIC_URL: 'https://a.example', RENDER_EXTERNAL_URL: 'https://b', SECRET: 's' }).publicUrl, 'https://a.example');
  const { server, db, base } = await startApp({ ...c, port: 0, adminPassword: 'pw', skillKey: 'k', guest: {}, dbFile: ':memory:' });
  try {
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM items')).n, 69, '첫 실행에 샘플 품목');
    const login = (ip, password) => fetch(`${base}/admin/login`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ password }) });
    for (let i = 0; i < 10; i++) await login('1.1.1.1', 'no');
    assert.equal((await login('1.1.1.1', 'pw')).status, 429, '같은 접속자는 잠김');
    const ok = await login('2.2.2.2', 'pw');
    assert.equal(ok.status, 200, '다른 접속자는 영향 없음');
    assert.match(ok.headers.get('set-cookie'), /Secure/);
    const H = { cookie: ok.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
    const u = 'hidden-user';
    const s = await db.get("SELECT * FROM stores WHERE name = '카페 온도'");
    await O.linkUser(db, u, s.code);
    const r = await fetch(`${base}/api/admin/store-hide`, { method: 'POST', headers: H, body: JSON.stringify({ id: s.id }) });
    assert.ok(!(await r.json()).stores.some((x) => x.id === s.id));
    assert.equal(await O.storeByUser(db, u), null, '숨긴 매장은 카톡에서도 빠짐');
    assert.equal((await db.get('SELECT code FROM stores WHERE id = ?', [s.id])).code, null);
  } finally {
    server.close();
  }
});

// Cloudflare D1 과 같은 모양의 가짜 DB (속은 Node SQLite) — src/d1.js 변환이 맞는지 확인
function fakeD1() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const stmt = (sql, args = []) => {
    for (const a of args) if (a === undefined) throw new Error('D1_TYPE_ERROR: undefined');
    const q = () => raw.prepare(sql); // D1 처럼 실행할 때 문장을 확인
    const s = { get: (...a) => q().get(...a), all: (...a) => q().all(...a), run: (...a) => q().run(...a) };
    return {
      first: async () => s.get(...args) ?? null,
      all: async () => ({ results: s.all(...args) }),
      run: async () => { const r = s.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      _run: () => { const r = s.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };
  };
  return {
    prepare: (sql) => ({ bind: (...args) => stmt(sql, args) }),
    async batch(list) {
      raw.exec('BEGIN');
      try { const out = list.map((s) => s._run()); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw new Error(`D1_ERROR: ${e.message}`); }
    },
  };
}

test('Cloudflare(D1) 모드: 스킬 키·서명 키 자동 생성 · 카톡 발주 · 관리자', async () => {
  const db = d1(fakeD1());
  const files = { 'app.css': 'body{}', 'order.js': '', 'admin.js': '', 'order.html': '<html>order</html>', 'admin.html': '<html>admin</html>', 'login.html': '<html>login</html>' };
  const handle = createHandler({
    db, cfg: { adminPassword: 'pw', blockId: 'B', minAmount: 0, guest: {}, seedSample: true }, log: () => {},
    assets: async (n) => files[n] ?? null,
  });
  const base = 'https://twostar-order.demo.workers.dev';
  const call = (path, init, ip = '9.9.9.9') => handle(new Request(base + path, init), { ip });

  let r = await call('/admin/login', { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
  assert.equal(r.status, 200);
  const H = { cookie: r.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
  const d = await (await call('/api/admin/data', { headers: H })).json();
  assert.equal(d.items.length, 69);
  const key = new URL(d.skillUrl).searchParams.get('key');
  assert.match(d.skillUrl, /^https:\/\/twostar-order\.demo\.workers\.dev\/kakao\/skill\?key=[\w-]{20,}$/);
  const again = await (await call('/api/admin/data', { headers: H })).json();
  assert.equal(again.skillUrl, d.skillUrl, '스킬 키는 한 번 만들면 그대로');

  const code = d.stores.find((s) => s.name === '해오름사우나').code;
  const talk = async (extra, u = '버튼') => (await call(`/kakao/skill?key=${key}`, { method: 'POST', body: JSON.stringify({ userRequest: { user: { id: 'cf' }, utterance: u }, action: { clientExtra: extra } }) })).json();
  let t = await talk({}, code);
  assert.match(JSON.stringify(t), /연결되었어요/);
  const link = t.template.outputs[1].textCard.buttons[0].webLinkUrl;
  assert.ok(link.startsWith(`${base}/o/`));
  r = await call(new URL(link).pathname);
  assert.equal(await r.text(), '<html>order</html>');
  t = await talk({ s: 'items', c: 'snack', g: '과자' });
  await talk(t.template.outputs[1].carousel.items[0].buttons[2].extra); // +10
  t = await talk({ s: 'confirm' });
  t = await talk(t.template.outputs[0].textCard.buttons[0].extra);
  assert.match(JSON.stringify(t), /발주가 접수되었어요/);
  const after = await (await call('/api/admin/data', { headers: H })).json();
  assert.equal(after.orders.length, 1);
  assert.equal(after.orders[0].lines.length, 1);
  assert.match(after.events.at(-1).text, /새 주문/);
  assert.equal((await call('/kakao/skill?key=wrong', { method: 'POST', body: '{}' })).status, 403);
});

test('발주서 링크를 글자로 받기 · 링크점검', async () => {
  const { db, sauna } = await setup();
  const ctx = { db, blockId: 'B1', orderLink: (st) => `https://x.example/o/tok${st.id}`, minAmount: 0 };
  const req = (extra, u = '버튼') => skill(ctx, { userRequest: { user: { id: 'lk' }, utterance: u }, action: { clientExtra: extra } });
  let r = await req({}, '링크점검');
  assert.equal(r.template.outputs[0].textCard.buttons.length, 2, '연결 전: 네이버·서버 점검');
  assert.match(r.template.outputs[1].simpleText.text, /https:\/\/x\.example\/health/);
  r = await req({}, sauna.code);
  assert.equal(r.template.quickReplies[0].label, '발주서 링크');
  r = await req(r.template.quickReplies[0].extra);
  assert.match(r.template.outputs[0].simpleText.text, new RegExp(`https://x\\.example/o/tok${sauna.id}`));
  r = await req({}, '링크 점검');
  assert.deepEqual(r.template.outputs[0].textCard.buttons.map((b) => b.label), ['① 네이버', '② 서버 점검', '③ 발주서']);
});

test('발주서 링크: 1년짜리 · 링크 바꾸면 예전 링크 막힘 · 홈 화면 아이콘', async () => {
  const { server, db, base } = await startApp();
  try {
    const s = await O.createStore(db, { name: '홈화면사우나', biz: 'sauna' });
    let r = await fetch(`${base}/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'pw1234' }) });
    const H = { cookie: r.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
    const old = (await (await fetch(`${base}/api/admin/link`, { method: 'POST', headers: H, body: JSON.stringify({ id: s.id }) })).json()).link;
    const oldPath = new URL(old).pathname;
    const exp = parseInt(oldPath.split('.')[2], 36) * 1000;
    assert.ok(exp - Date.now() > 360 * 24 * 3600e3, '1년 가까이 유효');
    r = await fetch(base + oldPath);
    const page = await r.text();
    assert.match(page, new RegExp(`/o/${oldPath.slice(3).replace(/\./g, '\\.')}/manifest\.webmanifest`));
    assert.match(page, /apple-touch-icon/);
    const mf = await (await fetch(`${base}${oldPath}/manifest.webmanifest`)).json();
    assert.equal(mf.start_url, oldPath);
    assert.equal(mf.display, 'standalone');
    assert.equal((await fetch(`${base}/assets/icon-192.png`)).headers.get('content-type'), 'image/png');

    const fresh = (await (await fetch(`${base}/api/admin/link-reset`, { method: 'POST', headers: H, body: JSON.stringify({ id: s.id }) })).json()).link;
    assert.notEqual(fresh, old);
    assert.equal((await fetch(base + oldPath)).status, 404, '예전 링크는 막힘');
    assert.equal((await fetch(`${base}/api/o/${oldPath.slice(3)}`)).status, 404);
    assert.equal((await fetch(base + new URL(fresh).pathname)).status, 200, '새 링크는 열림');
  } finally {
    server.close();
  }
});

test('품목 삭제: 하나씩 · 판매 중지 품목 모두 · 지난 주문·장바구니 영향', async () => {
  const { server, db, base } = await startApp();
  try {
    const add = async (name) => (await db.run("INSERT INTO items (category, grp, name, price) VALUES ('snack', '과자', ?, 1000)", [name])).lastRowId;
    const a = await add('지울과자'); const b = await add('중지과자1'); const c = await add('중지과자2'); const keep = await add('남길과자');
    const s = await O.createStore(db, { name: '삭제사우나', biz: 'sauna' });
    const st = await O.storeOf(db, s.id);
    await O.setQty(db, st, a, 3);
    const order = (await O.submit(db, st, (await O.cartOf(db, st)).rev)).order;
    await O.setQty(db, st, b, 2); // 장바구니에 담긴 채로 삭제될 품목
    let r = await fetch(`${base}/admin/login`, { method: 'POST', body: JSON.stringify({ password: 'pw1234' }) });
    const H = { cookie: r.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
    r = await (await fetch(`${base}/api/admin/item-delete`, { method: 'POST', headers: H, body: JSON.stringify({ id: a }) })).json();
    assert.equal(r.deleted, 1);
    assert.ok(!r.data.items.some((i) => i.id === a));
    assert.equal(r.data.orders.find((o) => o.id === order.id).lines[0].name, '지울과자', '지난 주문 내역은 그대로');
    await db.run('UPDATE items SET active = 0 WHERE id IN (?, ?)', [b, c]);
    r = await (await fetch(`${base}/api/admin/items-delete-inactive`, { method: 'POST', headers: H, body: '{}' })).json();
    assert.equal(r.deleted, 2);
    assert.deepEqual(r.data.items.map((i) => i.id), [keep]);
    assert.equal((await O.cartOf(db, st)).count, 0, '장바구니에서도 빠짐');
    assert.equal((await fetch(`${base}/api/admin/item-delete`, { method: 'POST', headers: H, body: JSON.stringify({ id: 9999 }) })).status, 400);
  } finally {
    server.close();
  }
});

test('카톡 링크 확인용 HEAD 요청: 발주서·서버 점검은 200, 잘못된 링크는 404', async () => {
  const { server, db, base, orderLink } = await startApp();
  try {
    const s = await O.createStore(db, { name: 'HEAD사우나', biz: 'sauna' });
    const page = orderLink(s.id).replace('http://localhost', base);
    let r = await fetch(page, { method: 'HEAD' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.equal((await r.text()), '');
    assert.equal((await fetch(`${base}/health`, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(page.replace(/\.[^.]+$/, '.forged'), { method: 'HEAD' })).status, 404);
    const html = await (await fetch(page)).text();
    assert.match(html, /og:title/);
    assert.ok(!html.includes('{{'), '자리표시가 모두 채워짐');
  } finally {
    server.close();
  }
});

test('카톡 연결 끊기: 카톡에서 연결해제 · 남은 지점으로 전환 · 관리자 일괄 해제', async () => {
  const { db, sauna } = await setup();
  const cafe = await O.createStore(db, { name: '카페 온도', biz: 'cafe' });
  const ctx = { db, blockId: 'B1', orderLink: (st) => `https://x/o/${st.id}`, minAmount: 0 };
  const req = (u, extra, utter = '버튼') => skill(ctx, { userRequest: { user: { id: u }, utterance: utter }, action: { clientExtra: extra } });
  const J = (x) => JSON.stringify(x);
  await req('me', {}, sauna.code);
  await req('me', {}, cafe.code); // 지금 매장: 카페
  let r = await req('me', {}, '연결 해제');
  assert.match(J(r), /카페 온도 연결을 끊을까요/);
  r = await req('me', r.template.outputs[0].textCard.buttons[0].extra);
  assert.match(J(r), /카페 온도 매장과 연결을 끊었어요/);
  assert.match(J(r), /지금 매장: 해오름사우나/);
  assert.equal((await O.storeByUser(db, 'me')).id, sauna.id);
  r = await req('me', { s: 'stores' });
  assert.ok(r.template.quickReplies.some((q) => q.label === '이 매장 연결 끊기'));
  r = await req('me', { s: 'unlink2', to: sauna.id });
  assert.match(J(r), /연결 코드 6자리를 입력해/);
  assert.equal(await O.storeByUser(db, 'me'), null);
  assert.match(J(await req('me', {})), /처음 오셨네요/);
  // 관리자: 매장에 연결된 계정 모두 끊기
  const code2 = await O.reissueCode(db, sauna.id);
  await req('a', {}, code2);
  const code3 = await O.reissueCode(db, sauna.id);
  await req('b', {}, code3);
  assert.equal(await O.unlinkStore(db, sauna.id), 2);
  assert.equal(await O.storeByUser(db, 'a'), null);
  assert.equal(await O.storeByUser(db, 'b'), null);
});

test('주문 확인 → 카톡 알림(Event API · 채팅방) · 발주 확인서 · 거래명세서 · 매장별 발주 내역 · 설정', async () => {
  const db = open(':memory:');
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push({ url, init }); return new Response(JSON.stringify({ taskId: 't1', status: 'SUCCESS' }), { status: 200 }); };
  const handle = createHandler({
    db, cfg: { adminPassword: 'pw', skillKey: 'k', blockId: 'B', minAmount: 0, guest: {}, secret: 's' }, log: () => {},
    assets: async (n) => (n === 'admin.html' ? '<html>admin</html>' : null), fetch: fakeFetch,
  });
  const base = 'https://order.example.com';
  const call = (path, init) => handle(new Request(base + path, init), { ip: '1.1.1.1' });
  let r = await call('/admin/login', { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
  const H = { cookie: r.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
  const post = async (sub, body) => (await call(`/api/admin/${sub}`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
  await post('items', { category: 'snack', grp: '과자', name: '새우깡 <b>', unit: '개', price: 1100 });
  const st = await post('stores', { name: '해오름사우나', biz: 'sauna', owner: '김사장', phone: '010-1' });
  const talk = async (extra, u = '버튼') => (await call('/kakao/skill?key=k', { method: 'POST', body: JSON.stringify({ userRequest: { user: { id: 'owner1' }, utterance: u }, action: { clientExtra: extra } }) })).json();
  await talk({}, st.code);
  const item = (await (await call('/api/admin/data', { headers: H })).json()).items[0];
  await talk({ s: 'add', i: item.id, n: 10 });
  let t = await talk({ s: 'confirm' });
  t = await talk(t.template.outputs[0].textCard.buttons[0].extra);
  const J = JSON.stringify(t);
  assert.match(J, /배송은 확인 후 2~3일/);
  const docUrl = t.template.outputs[0].textCard.buttons[0].webLinkUrl;
  assert.ok(docUrl.startsWith(`${base}/d/`));

  // 점주용 확인서 링크: 로그인 없이 열리고, 품목 이름은 HTML 이스케이프
  r = await call(new URL(docUrl).pathname);
  assert.equal(r.status, 200);
  let html = await r.text();
  assert.match(html, /발주 확인서/);
  assert.match(html, /새우깡 &lt;b&gt;/);
  assert.match(html, /11,000원/);
  assert.match(html, /<h1>발주 확인서<\/h1>/);
  assert.match(html, /12,100원/);
  assert.equal((await call('/d/d.1.xxxxxx.forgedforgedforged')).status, 404);

  // 설정 전: 확인 처리 → 알림은 DB 에 쌓이고, 점주가 채팅방을 열면 맨 위에 보임
  const d = await (await call('/api/admin/data', { headers: H })).json();
  const order = d.orders[0];
  let res = await post('status', { id: order.id, status: 'confirmed' });
  assert.deepEqual({ users: res.notify.users, configured: res.notify.configured }, { users: 1, configured: false });
  assert.equal(sent.length, 0);
  t = await talk({}, '아무 말');
  assert.equal(t.template.outputs[0].textCard.title, '✅ 발주가 확인되었어요');
  assert.match(t.template.outputs[0].textCard.description, /도착 예정/);
  assert.equal(t.template.outputs[0].textCard.buttons[0].label, '📄 발주 확인서');
  t = await talk({}, '아무 말');
  assert.notEqual(t.template.outputs[0].textCard.title, '✅ 발주가 확인되었어요', '한 번 보여 준 알림은 다시 안 나옴');

  // 설정: 잘못된 값 거절 · REST 키는 화면에 안 보냄
  res = await call('/api/admin/settings', { method: 'POST', headers: H, body: JSON.stringify({ deliveryMin: 5, deliveryMax: 2 }) });
  assert.equal(res.status, 400);
  res = await post('settings', { kakaoBotId: 'bot123abc', kakaoRestKey: 'restkey1234567890', company: '투스타글로벌(주)', bizNo: '123-45-67890', account: '국민 000-000' });
  assert.equal(res.settings.kakaoRestKey, '');
  assert.equal(res.settings.kakaoKeySet, true);

  // 설정 후: 출고 처리 → Event API 호출
  res = await post('status', { id: order.id, status: 'shipped' });
  assert.equal(res.notify.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://bot-api.kakao.com/v2/bots/bot123abc/talk');
  assert.equal(sent[0].init.headers.authorization, 'KakaoAK restkey1234567890');
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.event.name, 'order_notice');
  assert.deepEqual(body.user, [{ type: 'botUserKey', id: 'owner1' }]);
  assert.match(body.event.data.text, /출고/);
  // 테스트 알림
  res = await post('notify-test', { id: st.id });
  assert.equal(res.sent, 1);
  // 발송 실패는 '새 소식'에 남음
  sent.length = 0;
  const failing = createHandler({
    db, cfg: { adminPassword: 'pw', skillKey: 'k', blockId: 'B', minAmount: 0, guest: {}, secret: 's' }, log: () => {}, assets: async () => null,
    fetch: async () => new Response('{"status":"FAIL","message":"no friend"}', { status: 200 }),
  });
  r = await failing(new Request(`${base}/api/admin/status`, { method: 'POST', headers: H, body: JSON.stringify({ id: order.id, status: 'done' }) }));
  assert.equal(r.status, 200); // 납품완료는 알림 없음
  r = await failing(new Request(`${base}/api/admin/notify-test`, { method: 'POST', headers: H, body: JSON.stringify({ id: st.id }) }));
  assert.match((await r.json()).error, /FAIL · no friend/);

  // 관리자 문서
  r = await call(`/admin/doc/order/${order.id}`, { headers: H });
  html = await r.text();
  assert.match(html, /123-45-67890/);
  assert.match(html, /김사장/);
  r = await call(`/admin/doc/statement?order=${order.id}`, { headers: H });
  html = await r.text();
  assert.match(html, /거래명세서/);
  assert.match(html, /금 일만이천일백원정/); // 부가세 별도: 11,000 + 1,100
  assert.match(html, /₩1,100/);
  assert.match(html, /부가세 별도 금액입니다/);
  assert.match(html, /국민 000-000/);
  const today = O.kstYmd(Date.now());
  r = await call(`/admin/doc/statement?store=${st.id}&from=${today.slice(0, 8)}01&to=${today}`, { headers: H });
  assert.match(await r.text(), /주문 1건/);
  assert.equal((await call(`/admin/doc/order/${order.id}`)).status, 302, '로그인 없이는 관리자 문서 안 열림');

  // 매장 상세: 월별 합계 + 이 달 주문
  const sd = await (await call(`/api/admin/store?id=${st.id}`, { headers: H })).json();
  assert.equal(sd.months.length, 1);
  assert.equal(sd.months[0].total, 11000);
  assert.equal(sd.orders.length, 1);
  assert.equal(sd.orders[0].lines.length, 1);
  assert.equal(sd.store.kakao, 1);
});

test('배송 예정일 · 금액 한글 · 부가세 나누기', () => {
  const docs = require('../src/docs');
  // 2026-09-25(금) 10시 KST → 주말 빼고 2~3일 = 9/29(화)~9/30(수)
  const fri = Date.UTC(2026, 8, 25, 1);
  assert.equal(O.eta(fri, { deliveryMin: 2, deliveryMax: 3, skipWeekend: true }).range, '9/29(화)~9/30(수)');
  assert.equal(O.eta(fri, { deliveryMin: 2, deliveryMax: 3, skipWeekend: false }).range, '9/27(일)~9/28(월)');
  assert.equal(docs.korean(123000), '일십이만삼천');
  assert.equal(docs.korean(100010000), '일억일만');
  assert.deepEqual(docs.vatSplit(11000, 'included'), { supply: 10000, tax: 1000, total: 11000 });
  assert.deepEqual(docs.vatSplit(10000, 'excluded'), { supply: 10000, tax: 1000, total: 11000 });
});

test('주문 마감 시각 · 부가세 별도 고정 · 발주서 규칙', async () => {
  // 2026-09-28(월) 15:59 KST 는 오늘 접수, 16:00 은 다음 날 접수 → 2~3일(주말 제외)
  const s = { deliveryMin: 2, deliveryMax: 3, skipWeekend: true, cutoffHour: 16 };
  assert.equal(O.eta(Date.UTC(2026, 8, 28, 6, 59), s).range, '9/30(수)~10/1(목)');
  assert.equal(O.eta(Date.UTC(2026, 8, 28, 7, 0), s).range, '10/1(목)~10/2(금)');
  assert.equal(O.eta(Date.UTC(2026, 8, 26, 1), s).range, '9/30(수)~10/1(목)', '토요일 주문은 월요일 접수');

  const db = open(':memory:');
  const handle = createHandler({ db, cfg: { adminPassword: 'pw', skillKey: 'k', blockId: 'B', minAmount: 0, guest: {}, secret: 's' }, log: () => {}, assets: async () => null });
  const call = (path, init) => handle(new Request(`https://x.com${path}`, init), { ip: '1' });
  let r = await call('/admin/login', { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
  const H = { cookie: r.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
  const post = async (sub, body) => call(`/api/admin/${sub}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  await post('items', { category: 'cafe', grp: '시럽', name: '바닐라', price: 30000 });
  const st = await (await post('stores', { name: '카페', biz: 'cafe' })).json();
  assert.equal((await post('settings', { cutoffHour: 24 })).status, 400);
  await post('settings', { cutoffHour: 15, vat: 'included' });
  const tk = new URL(st.link).pathname.split('/').pop();
  const v = await (await call(`/api/o/${tk}?fresh=1`)).json();
  assert.equal(v.rules.cutoffHour, 15);
  assert.equal(v.minAmount, 0);
  assert.equal(v.items[0].was, undefined);
  const d = await (await call('/api/admin/data', { headers: H })).json();
  assert.equal(d.settings.vat, 'excluded', '부가세는 항상 별도');
});

test('실물 명세서: 관리자 업로드 → 점주 확인서·발주서·카톡에서 보기, 사진은 명세서 링크로만', async () => {
  const db = open(':memory:');
  const handle = createHandler({ db, cfg: { adminPassword: 'pw', skillKey: 'k', blockId: 'B', minAmount: 0, guest: {}, secret: 's' }, log: () => {}, assets: async () => null });
  const call = (path, init) => handle(new Request(`https://x.com${path}`, init), { ip: '1' });
  let r = await call('/admin/login', { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
  const H = { cookie: r.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
  const post = async (sub, body) => call(`/api/admin/${sub}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  await post('items', { category: 'cafe', grp: '시럽', name: '바닐라', price: 10000 });
  const st = await (await post('stores', { name: '카페', biz: 'cafe' })).json();
  const other = await (await post('stores', { name: '다른 매장', biz: 'cafe' })).json();
  const talk = async (extra, u = '버튼') => (await call('/kakao/skill?key=k', { method: 'POST', body: JSON.stringify({ userRequest: { user: { id: 'u1' }, utterance: u }, action: { clientExtra: extra } }) })).json();
  await talk({}, st.code);
  const item = (await (await call('/api/admin/data', { headers: H })).json()).items[0];
  await talk({ s: 'add', i: item.id, n: 2 });
  let t = await talk({ s: 'confirm' });
  await talk(t.template.outputs[0].textCard.buttons[0].extra);
  const order = (await (await call('/api/admin/data', { headers: H })).json()).orders[0];
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`;

  assert.equal((await post('statement', { store_id: other.id, order_id: order.id, images: [png] })).status, 400, '다른 매장 주문에는 못 붙임');
  assert.equal((await post('statement', { store_id: st.id, images: [] })).status, 400);
  r = await post('statement', { store_id: st.id, order_id: order.id, title: '9월 거래명세서', images: [png, png] });
  const up = await r.json();
  assert.equal(up.pages, 2);
  assert.equal(up.data.orders[0].stmts, 1);

  // 점주 카톡: 알림 카드 → 발주 내역에 [실물 명세서] 버튼
  t = await talk({}, '안녕');
  assert.equal(t.template.outputs[0].textCard.title, '🧾 명세서가 올라왔어요');
  t = await talk({ s: 'history' });
  const btns = t.template.outputs[1].carousel.items[0].buttons;
  assert.equal(btns[1].label, '🧾 실물 명세서');
  const stUrl = new URL(btns[1].webLinkUrl);
  r = await call(stUrl.pathname);
  const page = await r.text();
  assert.match(page, /9월 거래명세서/);
  assert.match(page, /발주 확인서/);
  r = await call(`${stUrl.pathname}/1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal((await call(`${stUrl.pathname}/5`)).status, 404);
  assert.equal((await call('/st/st.1.xxxxxx.forgedforgedforged')).status, 404);
  // 사진 이름을 알아도 /img/ 로는 안 열림
  const name = (await db.get('SELECT images FROM statements')).images.split(',')[0];
  assert.equal((await call(`/img/${name}`)).status, 404);
  // 발주 확인서 위쪽에 [실물 명세서] 버튼
  const docUrl = new URL(btns[0].webLinkUrl);
  assert.match(await (await call(docUrl.pathname)).text(), /실물 명세서/);
  // 발주서 목록에도
  const tk = new URL(st.link).pathname.split('/').pop();
  const v = await (await call(`/api/o/${tk}`)).json();
  assert.equal(v.statements.length, 1);
  assert.equal(v.statements[0].pages, 2);
  // 매장 상세 · 삭제
  const sd = await (await call(`/api/admin/store?id=${st.id}`, { headers: H })).json();
  assert.equal(sd.statements.length, 1);
  assert.equal((await call(`/admin/doc/st/${up.id}/0`, { headers: H })).status, 200);
  await post('statement-delete', { id: up.id });
  assert.equal((await call(stUrl.pathname)).status, 404);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM images WHERE name LIKE 's%'")).n, 0);
});

test('엑셀 올리기: 따옴표가 든 이름 · 7번째 칸 "중지" · 틀린 줄 번호', async () => {
  const { db } = await setup();
  const r = O.parseItems('분류\t묶음\t품목명\t규격\t단위\t단가\n스낵\t과자\t포카칩 & "오리지널"\t66g\t봉\t1500\n\n음료\t탄산\t"펩시"\t\t캔\t850\t중지\n스낵\t과자\t오류\t\t개\tabc');
  assert.deepEqual(r.errors, ['5번째 줄: 단가가 숫자가 아닙니다 ("abc")']);
  const ok = await O.importItems(db, '스낵\t과자\t포카칩 & "오리지널"\t66g\t봉\t1500\n음료\t탄산\t"펩시"\t\t캔\t850\t중지');
  assert.equal(ok.added, 2);
  const rows = await db.all("SELECT name, active FROM items WHERE name IN ('포카칩 & \"오리지널\"', '펩시') ORDER BY name");
  assert.deepEqual(rows.map((x) => [x.name, x.active]), [['펩시', 0], ['포카칩 & "오리지널"', 1]]);
});
