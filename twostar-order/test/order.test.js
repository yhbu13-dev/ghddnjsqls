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
  // 담기 → 같은 캐러셀을 방금 누른 품목부터 다시 (대화 맨 아래에 새로 뜸)
  r = req(card.buttons[1].extra);
  assert.match(r.template.outputs[0].simpleText.text, /새우깡 5개 담았어요/);
  assert.equal(r.template.outputs[1].carousel.items[0].title, '✅ 새우깡');
  r = req(r.template.outputs[1].carousel.items[1].buttons[0].extra); // 양파링 +1
  assert.equal(r.template.outputs[1].carousel.items[0].title, '✅ 양파링');
  req({ s: 'add', i: ids.snack2, n: -999 });
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

test('엑셀 붙여넣기로 품목 한꺼번에 넣기', () => {
  const { db } = setup();
  const bad = O.importItems(db, '분류\t묶음\t품목명\t규격\t단위\t단가\n간식\t과자\t꼬북칩\t\t개\t1500');
  assert.equal(bad.added, 0);
  assert.match(bad.errors[0], /2번째 줄: 분류/);
  const r = O.importItems(db, [
    '분류\t묶음\t품목명\t규격\t단위\t단가',
    '스낵\t과자\t꼬북칩\t\t개\t1,500',
    '스낵\t과자\t새우깡\t\t개\t1300원', // 이미 있음 → 가격 수정
    '카페,시럽,헤이즐넛 시럽,1L,병,11000',
  ].join('\n'));
  assert.deepEqual([r.added, r.updated, r.errors], [2, 1, []]);
  assert.equal(db.get("SELECT price FROM items WHERE name = '새우깡'").price, 1300);
  assert.equal(db.get("SELECT unit FROM items WHERE name = '헤이즐넛 시럽'").unit, '병');
});

test('품목 사진: 올리기 · 발주서 표시 · 위조 파일 거절 · 예전 DB 업그레이드', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  // 예전 DB (image 칸 없음) → 열면 자동으로 칸이 생겨야 함
  const { DatabaseSync } = require('node:sqlite');
  const oldFile = path.join(dir, 'old.db');
  const raw = new DatabaseSync(oldFile);
  raw.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, category TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '기타', name TEXT NOT NULL, spec TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '개', price INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1)");
  raw.close();
  const up = open(oldFile);
  assert.equal(up.get('SELECT image FROM items LIMIT 1'), undefined);
  assert.ok(up.raw.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'image'));
  up.close();

  const { server, db } = createApp({
    port: 0, publicUrl: 'https://demo.example', adminPassword: 'pw', skillKey: 'k', blockId: 'B', minAmount: 0,
    guest: {}, dbFile: ':memory:', secret: 's', imageDir: path.join(dir, 'images'),
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const a = Number(db.run("INSERT INTO items (category, grp, name, price) VALUES ('snack', '과자', '새우깡', 1200)").lastInsertRowid);
    db.run("INSERT INTO items (category, grp, name, price) VALUES ('snack', '과자', '양파링', 1300)");
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
    assert.equal((await fetch(`${base}/img/..%2Fsecret`)).status, 404);

    // 발주서에 사진 이름이 실려 나가고, 카톡 카드는 글자 카드 그대로
    const s = O.createStore(db, { name: '사우나', biz: 'sauna' });
    const talk = (extra, u = '버튼') => fetch(`${base}/kakao/skill?key=k`, { method: 'POST', body: JSON.stringify({ userRequest: { user: { id: 'p' }, utterance: u }, action: { clientExtra: extra } }) }).then((x) => x.json());
    const link = (await talk({}, s.code)).template.outputs[1].textCard.buttons[0].webLinkUrl;
    const sheet = await (await fetch(link.replace('https://demo.example/o/', `${base}/api/o/`))).json();
    assert.equal(sheet.items.find((i) => i.id === a).image, img);
    assert.equal((await talk({ s: 'items', c: 'snack', g: '과자' })).template.outputs[1].carousel.type, 'textCard');

    r = await fetch(`${base}/api/admin/item-image`, { method: 'POST', headers: H, body: JSON.stringify({ id: a, remove: true }) });
    assert.equal((await r.json()).items.find((i) => i.id === a).image, '');
    assert.equal(fs.existsSync(path.join(dir, 'images', img)), false, '지운 사진 파일도 삭제');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('카톡 한 계정에 여러 지점: 새 코드 입력 → 그 지점 추가·전환, 매장 바꾸기, 예전 버튼은 그 지점으로', () => {
  const { db, ids, sauna } = setup();
  const cafe = O.createStore(db, { name: '카페 온도', biz: 'cafe' });
  const ctx = { db, blockId: 'B1', orderLink: (id) => `https://x/o/${id}`, minAmount: 0 };
  const req = (extra, utterance = '버튼') => skill(ctx, { userRequest: { user: { id: 'boss' }, utterance }, action: { clientExtra: extra } });
  const J = (x) => JSON.stringify(x);

  let r = req({}, sauna.code);
  assert.match(J(r), /해오름사우나 매장과 연결/);
  assert.ok(!J(r).includes('매장 바꾸기'), '한 곳만 연결되면 [매장 바꾸기] 없음');
  const saunaAdd = r.template.outputs[1].textCard.buttons[1].extra; // 장바구니 버튼 (st = 사우나)
  assert.equal(saunaAdd.st, sauna.id);

  r = req({}, `${cafe.code.slice(0, 3)} ${cafe.code.slice(3)}`); // 띄어 써도 OK
  assert.match(J(r), /카페 온도 매장과 연결/);
  assert.equal(O.storeByUser(db, 'boss').id, cafe.id);
  assert.match(J(r), /매장 바꾸기/);

  r = req({}, '999999');
  if (![sauna.code, cafe.code].includes('999999')) assert.match(J(r), /코드가 맞지 않아요/);
  assert.equal(O.storeByUser(db, 'boss').id, cafe.id, '틀린 코드는 지금 매장을 바꾸지 않음');

  r = req({ s: 'stores' });
  const pick = r.template.quickReplies.find((q) => q.label === '해오름사우나');
  r = req(pick.extra);
  assert.match(J(r), /해오름사우나 매장으로 바꿨어요/);
  assert.equal(O.storeByUser(db, 'boss').id, sauna.id);

  // 카페 화면에서 받은 버튼을 사우나로 바꾼 뒤 눌러도 → 카페 장바구니에 담김
  const cafeStore = O.storeOf(db, cafe.id);
  r = req({ s: 'add', i: ids.cafe, n: 2, st: cafe.id });
  assert.match(J(r), /바닐라 시럽 2개 담았어요/);
  assert.equal(O.cartOf(db, cafeStore).count, 1);
  assert.equal(O.cartOf(db, O.storeOf(db, sauna.id)).count, 0);

  // 연결 안 된 매장 번호를 억지로 넣어도 무시
  const other = O.createStore(db, { name: '남의 매장', biz: 'cafe' });
  r = req({ s: 'use', to: other.id });
  assert.match(J(r), /연결되지 않은 매장/);
  r = req({ s: 'cart', st: other.id });
  assert.ok(!J(r).includes('남의 매장'));
});

test('모든 카톡 화면이 오픈빌더 응답 규격을 지킨다 (42품목 사우나 · 여러 지점)', () => {
  const db = open(':memory:');
  let n = 0;
  for (const g of ['과자', '초콜릿·사탕', '빵·간식', '라면·컵', '음료', '아이스크림']) {
    for (let i = 0; i < 7; i++) db.run("INSERT INTO items (category, grp, name, spec, price, sort) VALUES ('snack', ?, ?, '1박스 24입 대용량 기획', 1200, ?)", [g, `아주긴이름의스낵품목${++n}호 오리지널 대용량`, n]);
  }
  db.run("INSERT INTO items (category, grp, name, price) VALUES ('cafe', '시럽', '바닐라 시럽', 11000)");
  const a = O.createStore(db, { name: '아주아주긴이름의해오름사우나본점', biz: 'sauna' });
  const b = O.createStore(db, { name: '카페 온도', biz: 'cafe' });
  const ctx = { db, blockId: 'B1', orderLink: (id) => `https://x.example/o/${id}`, minAmount: 0 };
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
  const say = (extra, u = '버튼') => check(skill(ctx, { userRequest: { user: { id: 'v' }, utterance: u }, action: { clientExtra: extra } }), JSON.stringify(extra) + u);
  say({}); say({ s: 'cart' });                       // 연결 전
  say({}, a.code); say({}, b.code);                  // 두 지점 연결
  say({ s: 'use', to: a.id });
  const steps = [{}, { s: 'home' }, { s: 'cats' }, { s: 'groups', c: 'snack' }, { s: 'cart' }, { s: 'reorder' }, { s: 'history' },
    { s: 'req' }, { s: 'stores' }, { s: 'confirm' }, { s: 'items', c: 'snack', g: '과자' }, { s: 'items', c: 'snack', g: '과자', o: 5 },
    { s: 'items', c: 'snack', g: '없는묶음' }, { s: 'add', i: 999, n: 1 }, { s: 'what' }];
  for (const x of steps) say(x);
  for (let i = 1; i <= 42; i++) say({ s: 'add', i, n: 3, c: 'snack', g: '과자', o: 0 });   // 42품목 모두 담기
  say({ s: 'cart' });                                  // 긴 장바구니 (1000자 넘으면 잘림)
  const c = say({ s: 'confirm' });
  say(c.template.outputs[0].textCard.buttons[0].extra); // 주문 확정
  say({ s: 'history' }); say({ s: 'reorder' }); say({ s: 'clear' });
  say({ s: 'reqgo', c: 'cafe' }); say({ s: 'reqgo', c: 'cafe' }); say({ s: 'reqgo', c: 'nope' });
  say({}, '123456'); say({ s: 'use', to: 99999 });
  assert.ok(seen.size > 20);
});

test('클라우드 설정: 고정 주소 · 첫 실행 샘플 · 접속자별 로그인 제한 · 매장 숨기기', async () => {
  const { config } = require('../src/server');
  const c = config({ RENDER_EXTERNAL_URL: 'https://twostar-order.onrender.com/', SECRET: 's', DATA_DIR: '/tmp/x', TRUST_PROXY: '1', SEED_SAMPLE: '1' });
  assert.equal(c.publicUrl, 'https://twostar-order.onrender.com');
  assert.equal(config({ PUBLIC_URL: 'https://a.example', RENDER_EXTERNAL_URL: 'https://b', SECRET: 's' }).publicUrl, 'https://a.example');
  const { server, db } = createApp({ ...c, port: 0, adminPassword: 'pw', skillKey: 'k', guest: {}, dbFile: ':memory:', imageDir: '/tmp/x/img' });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(db.get('SELECT COUNT(*) AS n FROM items').n, 69, '첫 실행에 샘플 품목');
    const login = (ip, password) => fetch(`${base}/admin/login`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify({ password }) });
    for (let i = 0; i < 10; i++) await login('1.1.1.1', 'no');
    assert.equal((await login('1.1.1.1', 'pw')).status, 429, '같은 접속자는 잠김');
    const ok = await login('2.2.2.2', 'pw');
    assert.equal(ok.status, 200, '다른 접속자는 영향 없음');
    assert.match(ok.headers.get('set-cookie'), /Secure/);
    const H = { cookie: ok.headers.get('set-cookie').split(';')[0], 'x-ts': '1' };
    const u = 'hidden-user';
    const s = db.get("SELECT * FROM stores WHERE name = '카페 온도'");
    O.linkUser(db, u, s.code);
    let r = await fetch(`${base}/api/admin/store-hide`, { method: 'POST', headers: H, body: JSON.stringify({ id: s.id }) });
    assert.ok(!(await r.json()).stores.some((x) => x.id === s.id));
    assert.equal(O.storeByUser(db, u), null, '숨긴 매장은 카톡에서도 빠짐');
    assert.equal(db.get('SELECT code FROM stores WHERE id = ?', [s.id]).code, null);
  } finally {
    server.close();
  }
});
