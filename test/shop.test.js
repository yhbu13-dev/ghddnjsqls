'use strict';
// 업종별 품목 · 품목 이용 승인 · 점주 직접 발주(발주 화면·카카오톡 챗봇) · 카카오 로그인
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server/app');
const auth = require('../server/auth');
const catalog = require('../server/engine/catalog');
const shop = require('../server/engine/shop');
const props = require('../server/engine/proposals');
const delivery = require('../server/engine/delivery');
const kakao = require('../server/kakao');
const T = require('../server/time');
const { fixture, at } = require('./helpers');

const BLOCK = 'aaaabbbbccccddddeeeeffff';

function setup(patch = {}) {
  const f = fixture({ kakao_block_id: BLOCK, order_min_amount: 30000, ...patch });
  const { db } = f;
  db.run("INSERT INTO skus (id, name, pack, unit, price, sort, category, spec) VALUES ('BEAN1', '원두 1kg', 1, '봉', 26000, 10, 'cafe', '1kg × 1봉')");
  db.run("INSERT INTO skus (id, name, pack, unit, price, sort, category, spec) VALUES ('MILK1', '우유 1L', 12, '팩', 30000, 11, 'cafe', '')");
  db.run("INSERT INTO skus (id, name, pack, unit, price, sort, category, spec) VALUES ('EGG30', '구운란 30구', 30, '개', 15000, 20, 'snack', '')");
  const r = db.run(`INSERT INTO stores (code, name, region_id, biz, owner_name, owner_phone, lat, lng, created_at) VALUES ('GN-C1', '역삼 테스트카페', 'GN', 'cafe', '김사장', '010-5555-7777', 37.502, 127.038, ?)`, [at(0)]);
  f.cafe = Number(r.lastInsertRowid);
  kakao._attempts.clear();
  return f;
}

const bot = (ctx, now, extra, utter = '', user = 'bot-1', props2 = {}) =>
  kakao.skill(ctx, { userRequest: { user: { id: user, properties: props2 }, utterance: utter }, action: { clientExtra: extra || {} } }, now);

test('업종 기본 품목만 발주 가능 · 다른 품목은 신청 → 승인 후 열림 · 알림톡 안내', async () => {
  const { ctx, db, cafe, s1 } = setup();
  const now = at(9);
  assert.deepEqual([...catalog.approvedSet(db, cafe)], ['cafe']);
  assert.deepEqual([...catalog.approvedSet(db, s1)], ['beverage'], '기존 식당은 음료');
  assert.deepEqual(shop.orderable(db, cafe).map((k) => k.id), ['BEAN1', 'MILK1']);
  assert.throws(() => shop.setCart(ctx, cafe, 'EGG30', 1, now), /발주할 수 없는 품목/);
  await assert.rejects(shop.submit(ctx, cafe, { items: { EGG30: 3 } }, now), /발주할 수 없는 품목/);

  assert.equal(catalog.requestAccess(ctx, cafe, 'snack', { via: 'web', note: '매점용' }, now).status, 'pending');
  assert.equal(catalog.requestAccess(ctx, cafe, 'snack', { via: 'chat' }, now).already, true, '중복 신청은 그대로 대기');
  assert.throws(() => catalog.requestAccess(ctx, cafe, 'cafe', {}, now), /이미 이용 중/);
  assert.throws(() => catalog.decide(ctx, cafe, 'cafe', 'reject', { actor: 'ops' }, now), /기본 품목/);
  catalog.decide(ctx, cafe, 'snack', 'approve', { actor: 'ops@test' }, now);
  assert.ok(shop.orderable(db, cafe).some((k) => k.id === 'EGG30'));
  shop.setCart(ctx, cafe, 'EGG30', 2, now);
  catalog.decide(ctx, cafe, 'snack', 'revoke', { actor: 'ops@test' }, now);
  assert.equal(shop.cart(db, cafe).count, 0, '해제하면 장바구니에서도 빠진다');
  const v = shop.view(ctx, db.get('SELECT * FROM stores WHERE id = ?', [cafe]), now);
  assert.equal(v.categories.find((c) => c.id === 'snack').status, 'rejected');
  assert.equal(v.categories[0].id, 'cafe', '기본 품목이 첫 탭');
});

test('점주 발주: 최소 금액 · 중복 접수 방지 · 결제 → 배차 → 배송 (음료 외 품목은 재고 추정 제외)', async () => {
  const { ctx, db, cafe } = setup();
  const now = at(10);
  await assert.rejects(shop.submit(ctx, cafe, { items: { BEAN1: 1 } }, now), /최소 발주 금액/);
  await assert.rejects(shop.submit(ctx, cafe, { items: { BEAN1: 1.5 } }, now), /정수/);
  shop.setCart(ctx, cafe, 'BEAN1', 2, now);
  shop.setCart(ctx, cafe, 'MILK1', 1, now);
  const r = await shop.submit(ctx, cafe, { items: { BEAN1: 2, MILK1: 1 }, source: 'web', ref: 'web-abc' }, now);
  assert.equal(r.proposal.status, 'paid');
  assert.equal(r.proposal.source, 'web');
  assert.equal(r.proposal.amount, 82000);
  assert.equal(r.proposal.deliver_date, '2026-03-10', '컷오프 전이면 당일 배송');
  assert.equal(shop.cart(db, cafe).count, 0, '발주한 품목은 장바구니에서 빠진다');
  const again = await shop.submit(ctx, cafe, { items: { BEAN1: 2, MILK1: 1 }, source: 'web', ref: 'web-abc' }, now + 1000);
  assert.equal(again.duplicate, true);
  assert.equal(db.get("SELECT COUNT(*) AS c FROM proposals WHERE store_id = ?", [cafe]).c, 1);
  assert.equal(db.get("SELECT kind FROM messages WHERE proposal_id = ?", [r.proposal.id]).kind, 'confirm');

  // 진행 중인 점주 발주가 있으면 자동 제안이 겹치지 않고, 배차 · 배송 완료까지 같은 흐름
  delivery.dispatch(ctx, T.kstMidnight(at(13.5)), at(13.5));
  const stop = db.get('SELECT * FROM stops WHERE proposal_id = ?', [r.proposal.id]);
  assert.ok(stop, '점주 발주도 배차된다');
  delivery.complete(ctx, stop.id, {}, at(15));
  assert.equal(db.get('SELECT status FROM proposals WHERE id = ?', [r.proposal.id]).status, 'delivered');
  assert.equal(db.get('SELECT COUNT(*) AS c FROM store_skus WHERE store_id = ?', [cafe]).c, 0, '카페 품목은 재고 추정 대상이 아님');

  const re = shop.reorderToCart(ctx, cafe, at(16));
  assert.equal(re.from, r.proposal.code);
  assert.deepEqual(re.cart.lines.map((l) => [l.sku, l.qty]), [['BEAN1', 2], ['MILK1', 1]]);
  assert.equal(shop.recentOrders(db, cafe, at(16))[0].statusText, '배송 완료');
});

test('자동 제안 엔진은 식당 음료만 다룬다', () => {
  const { ctx, db, s1 } = setup();
  db.run("INSERT INTO store_skus (store_id, sku_id, rate_manual) VALUES (?, 'BEAN1', 1)", [s1]);
  const p = props.proposeNow(ctx, s1, 'ops:t', at(9));
  const lines = db.all('SELECT sku_id FROM proposal_lines WHERE proposal_id = ?', [p.id]).map((l) => l.sku_id);
  assert.ok(!lines.includes('BEAN1'));
});

test('카카오톡 챗봇: 연결 코드 → 버튼만으로 담기 → 확인 → 확정 (중복 탭 방지)', async () => {
  const { ctx, db, cafe } = setup();
  const now = at(10);
  let r = await bot(ctx, now);
  assert.equal(r.version, '2.0');
  assert.match(r.template.outputs[0].textCard.title, /매장 연결/);
  assert.match(r.template.outputs[0].textCard.buttons[0].webLinkUrl, /^https:\/\/ops\.example\.com\/k\/link\?t=/);
  assert.equal(r.template.outputs[0].textCard.buttons.length, 1, '고객용 주소가 없으면 연결 버튼만');
  require('../server/settings').save(db, { kakao_guest_url: 'https://mall.example.com/board' }); ctx.reload();
  r = await bot(ctx, now, null, '', 'guest-1');
  assert.match(r.template.outputs[0].textCard.description, /일반 주문·배송 문의/);
  assert.deepEqual(r.template.outputs[0].textCard.buttons[1], { label: '쇼핑몰 문의하기', action: 'webLink', webLinkUrl: 'https://mall.example.com/board' });

  r = await bot(ctx, now, null, '123456');
  assert.match(r.template.outputs[0].simpleText.text, /올바르지 않습니다/);
  const code = kakao.issueLinkCode(ctx, cafe);
  r = await bot(ctx, now, null, code);
  assert.match(r.template.outputs[0].simpleText.text, /역삼 테스트카페 매장과 연결/);
  assert.equal(db.get('SELECT link_code FROM stores WHERE id = ?', [cafe]).link_code, null, '연결 코드는 한 번만');
  const homeCard = r.template.outputs[1].textCard;
  assert.match(homeCard.buttons[0].webLinkUrl, /\/m\//, '한눈에 발주 화면 링크');
  assert.ok(r.template.quickReplies.every((q) => q.action === 'block' && q.blockId === BLOCK), '바로가기 버튼은 같은 스킬 블록으로');

  // 카테고리가 하나면 곧바로 품목 캐러셀
  r = await bot(ctx, now, { s: 'cats' });
  const cards = r.template.outputs[1].carousel.items;
  assert.equal(cards.length, 2);
  const plus1 = cards.find((c) => c.title.includes('원두')).buttons[0];
  assert.equal(plus1.label, '+1봉');
  r = await bot(ctx, now, plus1.extra);
  assert.match(r.template.outputs[0].simpleText.text, /원두 1kg 1봉 담았어요/);
  await bot(ctx, now, { s: 'add', k: 'MILK1', q: 1, c: 'cafe' });
  // 승인 안 된 품목은 신청으로 안내
  r = await bot(ctx, now, { s: 'items', c: 'snack' });
  assert.match(r.template.outputs[0].simpleText.text, /승인 전/);
  r = await bot(ctx, now, { s: 'add', k: 'EGG30', q: 1 });
  assert.match(r.template.outputs[0].simpleText.text, /발주할 수 없는 품목/);

  r = await bot(ctx, now, { s: 'confirm' });
  const ok = r.template.outputs[0].textCard.buttons[0];
  assert.equal(ok.extra.s, 'submit');
  // 확인 뒤 장바구니가 바뀌면 다시 확인
  await bot(ctx, now, { s: 'add', k: 'MILK1', q: 1 });
  r = await bot(ctx, now, ok.extra);
  assert.match(r.template.outputs[0].textCard.title, /확인해 주세요/);
  const ok2 = r.template.outputs[0].textCard.buttons[0];
  r = await bot(ctx, now, ok2.extra);
  assert.match(r.template.outputs[0].textCard.title, /발주 완료 · PO-/);
  r = await bot(ctx, now, ok2.extra);
  assert.match(r.template.outputs[0].simpleText.text, /이미 접수된 발주/);
  const p = db.get('SELECT * FROM proposals WHERE store_id = ?', [cafe]);
  assert.equal(p.source, 'chat');
  assert.equal(p.amount, 26000 + 60000);

  r = await bot(ctx, now, null, '발주 현황');
  assert.match(r.template.outputs[0].listCard.items[0].title, /오늘 배송 예정/);
  r = await bot(ctx, now, { s: 'req', c: 'snack' });
  assert.match(r.template.outputs[0].simpleText.text, /신청했어요/);
  assert.equal(db.get("SELECT status FROM store_categories WHERE store_id = ? AND category = 'snack'", [cafe]).status, 'pending');
});

test('카카오톡 챗봇: 블록 ID가 없으면 말풍선 버튼으로 대체 · 연결 코드 대입 제한', async () => {
  const { ctx, cafe } = setup({ kakao_block_id: '' });
  const code = kakao.issueLinkCode(ctx, cafe);
  let r = await bot(ctx, at(10), null, code, 'bot-2');
  assert.ok(r.template.quickReplies.every((q) => q.action === 'message'));
  r = await bot(ctx, at(10), null, '장바구니', 'bot-2');
  assert.match(r.template.outputs[0].simpleText.text, /비어 있어요/);
  for (let i = 0; i < 5; i++) await bot(ctx, at(10), null, '000000', 'bot-x');
  r = await bot(ctx, at(10), null, '000001', 'bot-x');
  assert.match(r.template.outputs[0].simpleText.text, /시도 횟수/);
});

test('HTTP: 스킬 키 · 발주 화면 API · 관리자 품목 승인 · 카카오 로그인 콜백', async () => {
  const f = setup({ kakao_rest_key: 'restkey123' });
  const { ctx, db, cafe } = f;
  auth.createUser(db, { email: 'admin@test.kr', name: '관리자', role: 'admin', password: 'admin-pass-1234' });
  auth._attempts.clear();
  // 카카오 API 대역
  ctx.fetch = async (url, opt) => {
    if (String(url).endsWith('/oauth/token')) {
      assert.match(opt.body, /code=good-code/);
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    }
    if (String(url).endsWith('/v2/user/me')) return new Response(JSON.stringify({ id: 9001, kakao_account: { phone_number: '+82 10-5555-7777', profile: { nickname: '김사장' } } }), { status: 200 });
    throw new Error('unexpected ' + url);
  };
  const server = createServer(ctx, { log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, cookie, headers = {} } = {}) => {
    const res = await fetch(base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-bevflow': '1', ...(cookie ? { cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  try {
    // 스킬: 키 없으면 401, 헤더·쿼리 둘 다 허용
    const skillBody = { userRequest: { user: { id: 'u1' }, utterance: '발주' }, action: { clientExtra: {} } };
    assert.equal((await call('POST', '/api/kakao/skill', { body: skillBody, headers: { 'x-bevflow': '' } })).status, 401);
    const key = ctx.getSecret('kakao');
    const sk = await call('POST', '/api/kakao/skill?key=' + encodeURIComponent(key), { body: skillBody, headers: { 'x-bevflow': '' } });
    assert.equal(sk.status, 200);
    assert.equal(sk.json.version, '2.0');

    // 발주 화면
    const link = shop.orderLink(ctx, cafe, Date.now());
    const token = link.split('/m/')[1];
    const page = await fetch(base + '/m/' + token);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /shop\.js/);
    assert.equal((await call('GET', '/api/shop/bad.token')).status, 404);
    let v = await call('GET', '/api/shop/' + token);
    assert.equal(v.status, 200);
    assert.equal(v.json.store.bizLabel, '카페');
    assert.deepEqual(v.json.products.map((p) => [p.id, p.u]), [['BEAN1', '봉'], ['MILK1', '박스']]);
    v = await call('PUT', `/api/shop/${token}/cart`, { body: { sku: 'MILK1', qty: 2 } });
    assert.equal(v.json.cart.amount, 60000);
    assert.equal((await call('PUT', `/api/shop/${token}/cart`, { body: { sku: 'EGG30', qty: 1 } })).status, 409);
    const o = await call('POST', `/api/shop/${token}/order`, { body: { items: { MILK1: 2 }, ref: 'r-1' } });
    assert.equal(o.status, 200, o.text);
    assert.equal(o.json.order.status, 'paid');
    assert.equal(o.json.view.orders[0].source, 'web');
    v = await call('POST', `/api/shop/${token}/access`, { body: { category: 'snack', note: '매점' } });
    assert.equal(v.json.categories.find((c) => c.id === 'snack').status, 'pending');

    // 관리자: 신청 승인 → 알림톡(발주 화면 버튼) 적재
    const login = await call('POST', '/api/auth/login', { body: { email: 'admin@test.kr', password: 'admin-pass-1234' } });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const adm = await call('GET', '/api/admin/data', { cookie });
    assert.equal(adm.json.storeCategories.filter((r) => r.status === 'pending').length, 1);
    assert.match(adm.json.kakao.skillUrl, /\/api\/kakao\/skill\?key=/);
    assert.equal((await call('GET', '/api/console/snapshot', { cookie })).json.accessPending, 1);
    assert.equal((await call('POST', `/api/admin/access/${cafe}/snack`, { cookie, body: { action: 'approve' } })).status, 200);
    const m = db.get("SELECT * FROM messages WHERE kind = 'access_ok'");
    assert.match(m.body, /스낵 품목 이용이 승인/);
    assert.match(JSON.parse(m.payload).buttons[0].url, /\/m\//);
    // 링크 초기화하면 이전 발주 링크는 무효
    await call('POST', `/api/admin/stores/${cafe}/revoke-links`, { cookie, body: {} });
    assert.equal((await call('GET', '/api/shop/' + token)).status, 404);
    // 매장 편집: 업종을 사우나로 바꾸면 스낵이 기본 품목
    assert.equal((await call('PUT', `/api/admin/stores/${cafe}`, { cookie, body: { biz: 'sauna' } })).status, 200);
    assert.deepEqual([...catalog.approvedSet(db, cafe)].sort(), ['cafe', 'snack'], '이전 기본(카페)은 승인 기록으로 유지');

    // 카카오 로그인: 인가 요청 → 콜백 → 휴대폰 번호 일치로 자동 연결 → 발주 화면으로
    const start = await fetch(base + '/k/login', { redirect: 'manual' });
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get('location'));
    assert.equal(loc.origin, 'https://kauth.kakao.com');
    assert.equal(loc.searchParams.get('client_id'), 'restkey123');
    assert.equal(loc.searchParams.get('redirect_uri'), 'https://ops.example.com/k/callback');
    const ks = start.headers.get('set-cookie').split(';')[0];
    const noCookie = await fetch(`${base}/k/callback?code=good-code&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual' });
    assert.match(decodeURIComponent(noCookie.headers.get('location')), /만료/, '쿠키 없는 콜백은 거부 (로그인 CSRF)');
    const cb = await fetch(`${base}/k/callback?code=good-code&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie: ks } });
    assert.equal(cb.status, 302);
    assert.match(cb.headers.get('location'), /^https:\/\/ops\.example\.com\/m\//);
    assert.equal(db.get("SELECT store_id FROM kakao_links WHERE kind = 'login' AND user_key = '9001'").store_id, cafe);
    // 로그인으로 연결된 계정은 채널 챗봇에서도 appUserId로 바로 인식
    const r2 = await kakao.skill(ctx, { userRequest: { user: { id: 'bot-new', properties: { appUserId: '9001' } }, utterance: '' }, action: {} }, Date.now());
    assert.match(r2.template.outputs[0].textCard.title, /역삼 테스트카페 발주/);

    // 연결 화면: 번호가 안 맞는 로그인 사용자는 연결 코드로
    const lt = require('../server/tokens').sign(ctx.secret, { k: 'kk', id: 0, u: '9002', nk: '직원', b: '', e: Date.now() + 60e3 });
    const code = kakao.issueLinkCode(ctx, cafe);
    const lk = await call('POST', '/api/kakao/link', { body: { l: lt, code } });
    assert.equal(lk.status, 200, lk.text);
    assert.match(lk.json.orderUrl, /\/m\//);
    assert.equal((await fetch(base + '/k/link')).status, 200);
  } finally { await new Promise((r) => { server.closeAllConnections(); server.close(r); }); }
});

test('휴대폰 번호 정규화 · 매장 찾기는 정확히 한 곳일 때만', () => {
  const { db } = setup();
  assert.equal(kakao.normPhone('+82 10-5555-7777'), '01055557777');
  assert.equal(kakao.storeByPhone(db, '+82 10-5555-7777').code, 'GN-C1');
  assert.equal(kakao.storeByPhone(db, '+82 10-1234-5678'), null, '두 매장이 같은 번호면 자동 연결하지 않음');
});
