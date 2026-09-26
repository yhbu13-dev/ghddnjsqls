'use strict';
// 정기 발주서(사우나) · 관리자 카톡 알림(나에게 보내기) · 관리자 모바일 내역 · 챗봇 발주서 흐름
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server/app');
const auth = require('../server/auth');
const shop = require('../server/engine/shop');
const catalog = require('../server/engine/catalog');
const standing = require('../server/engine/standing');
const adminNotify = require('../server/adminNotify');
const kakao = require('../server/kakao');
const today = require('../server/api/today');
const delivery = require('../server/engine/delivery');
const T = require('../server/time');
const { fixture, at } = require('./helpers');

// 2026-03-10은 화요일 → 정기 발주 요일을 '2'(화)로 둔다
function setup(patch = {}) {
  const f = fixture({ kakao_block_id: 'aaaabbbbccccddddeeeeffff', kakao_rest_key: 'restkey123', order_min_amount: 10000, ...patch });
  const { db } = f;
  const snack = [['EGG', '맥반석 구운란', '온장고'], ['SIK', '식혜 캔', '냉장고'], ['CHP', '감자칩', '과자 매대'], ['JLY', '젤리', '과자 매대'], ['CUP', '종이컵', '소모품']];
  snack.forEach(([id, name, grp], i) => db.run("INSERT INTO skus (id, name, pack, unit, price, sort, category, grp) VALUES (?, ?, 30, '개', 20000, ?, 'snack', ?)", [id, name, 50 + i, grp]));
  const r = db.run(`INSERT INTO stores (code, name, region_id, biz, standing_days, owner_name, owner_phone, lat, lng, created_at) VALUES ('GN-S1', '강남 테스트사우나', 'GN', 'sauna', '2', '박사장', '010-7777-0001', 37.503, 127.04, ?)`, [at(-7 * 24)]);
  f.sauna = Number(r.lastInsertRowid);
  f.uid = auth.createUser(db, { email: 'ops@test.kr', name: '박운영', role: 'ops', password: 'ops-pass-12345' });
  kakao._attempts.clear();
  auth._attempts.clear();
  return f;
}
const link = (db, uid, prefs = {}) => db.run(`INSERT INTO admin_kakao (user_id, kakao_id, nickname, access_token, access_exp, refresh_token, refresh_exp, prefs, linked_at)
  VALUES (?, '5001', '박운영', 'tok-1', ?, 'ref-1', ?, ?, ?)`, [uid, Date.now() + 3600e3, Date.now() + 60 * 864e5, JSON.stringify(prefs), Date.now()]);

async function firstOrder(ctx, sid, now) {
  return shop.submit(ctx, sid, { items: { EGG: 3, SIK: 2, CHP: 1, JLY: 1 }, source: 'web' }, now);
}

test('정기 발주서: 요일 아침에 지난번 수량으로 채우고 알림톡 · 하루 한 번 · 비교 기준 · 발주서 모드', async () => {
  const { ctx, db, sauna } = setup();
  assert.throws(() => shop.prepareSheet(ctx, sauna, at(8)), /지난 발주 내역이 없어/);
  await firstOrder(ctx, sauna, at(-7 * 24 + 10)); // 지난주 화요일 발주
  standing.tick(ctx, at(8.5));
  assert.equal(shop.cart(db, sauna).count, 0, '09:00 전에는 준비하지 않음');
  standing.tick(ctx, at(9));
  const c = shop.cart(db, sauna);
  assert.deepEqual(c.lines.map((l) => [l.sku, l.qty]).sort(), [['CHP', 1], ['EGG', 3], ['JLY', 1], ['SIK', 2]]);
  const m = db.get("SELECT * FROM messages WHERE kind = 'sheet_ready'");
  assert.equal(m.template, 'BF_SHEET_01');
  assert.match(m.body, /화 정기 발주서가 준비됐어요/);
  assert.equal(JSON.parse(m.payload).buttons[0].name, '발주서 확인하기');
  standing.tick(ctx, at(9.5));
  assert.equal(db.get("SELECT COUNT(*) AS c FROM messages WHERE kind = 'sheet_ready'").c, 1, '같은 날 두 번 보내지 않음');
  // 지난 확정보다 오래된 장바구니 찌꺼기는 버리고 새로 채운다
  db.run('UPDATE carts SET qty = 9, updated_at = ? WHERE store_id = ? AND sku_id = ?', [at(-7 * 24 + 9), sauna, 'CUP']);
  db.run('INSERT OR REPLACE INTO carts (store_id, sku_id, qty, updated_at) VALUES (?, ?, 9, ?)', [sauna, 'CUP', at(-7 * 24 + 9)]);
  db.run('DELETE FROM carts WHERE store_id = ? AND sku_id != ?', [sauna, 'CUP']);
  shop.prepareSheet(ctx, sauna, at(9.6));
  assert.deepEqual(shop.cart(db, sauna).lines.map((l) => l.sku).sort(), ['CHP', 'EGG', 'JLY', 'SIK']);

  const v = shop.view(ctx, db.get('SELECT * FROM stores WHERE id = ?', [sauna]), at(9.5));
  assert.equal(v.mode, 'sheet');
  assert.deepEqual(v.sheet.base, { EGG: 3, SIK: 2, CHP: 1, JLY: 1 });
  assert.equal(v.sheet.standing, '화');
  assert.equal(v.products.find((p) => p.id === 'EGG').grp, '온장고');
  const cafeView = shop.view(ctx, db.get('SELECT * FROM stores WHERE id = ?', [f2(db)]), at(9.5));
  assert.equal(cafeView.mode, 'pick', '식당·카페는 고르기 방식');
});
const f2 = (db) => db.get("SELECT id FROM stores WHERE code = 'GN-01'").id;

test('관리자 카톡 알림: 켠 종류만 적재 · 피드 카드 5줄/버튼 2개 · 401이면 토큰 갱신 후 재발송', async () => {
  const { ctx, db, sauna, uid } = setup();
  link(db, uid, { access: false });
  await firstOrder(ctx, sauna, at(10));
  const n = db.get("SELECT * FROM admin_notices WHERE kind = 'order'");
  assert.ok(n, '발주 확정 알림 적재');
  const tpl = JSON.parse(n.payload);
  assert.equal(tpl.object_type, 'feed');
  assert.ok(tpl.item_content.items.length <= 5);
  assert.ok(tpl.buttons.length <= 2);
  assert.match(tpl.buttons[0].link.web_url, /^https:\/\/ops\.example\.com\/a#order-\d+$/);
  catalog.requestAccess(ctx, sauna, 'cafe', { via: 'chat' }, at(10.2));
  assert.equal(db.get("SELECT COUNT(*) AS c FROM admin_notices WHERE kind = 'access'").c, 0, '끈 알림은 쌓이지 않음');

  const calls = [];
  let first = true;
  ctx.fetch = async (url, opt) => {
    calls.push(String(url));
    if (String(url).endsWith('/v2/api/talk/memo/default/send')) {
      if (first) { first = false; return new Response('{"msg":"this access token does not exist"}', { status: 401 }); }
      assert.equal(opt.headers.authorization, 'Bearer tok-2');
      assert.ok(new URLSearchParams(opt.body).get('template_object'));
      return new Response('{"result_code":0}', { status: 200 });
    }
    if (String(url).endsWith('/oauth/token')) {
      assert.equal(new URLSearchParams(opt.body).get('grant_type'), 'refresh_token');
      return new Response(JSON.stringify({ access_token: 'tok-2', expires_in: 21599 }), { status: 200 });
    }
    throw new Error('unexpected ' + url);
  };
  await adminNotify.flush(ctx, at(10.3));
  assert.equal(db.get('SELECT status FROM admin_notices WHERE id = ?', [n.id]).status, 'sent');
  assert.equal(db.get('SELECT access_token FROM admin_kakao WHERE user_id = ?', [uid]).access_token, 'tok-2');
  assert.equal(calls.filter((u) => u.endsWith('/oauth/token')).length, 1);
});

test('마감 전 미확정 발주서 · 출고 합계 · 배송 결과 알림은 하루 한 번', async () => {
  const { ctx, db, sauna, uid, s1 } = setup();
  link(db, uid);
  await firstOrder(ctx, sauna, at(-7 * 24 + 10));
  await shop.submit(ctx, s1, { items: { CL125: 2 }, source: 'chat' }, at(10)); // 식당 직접 발주 (오늘 배송)
  db.run('DELETE FROM admin_notices');
  standing.tick(ctx, at(9));        // 사우나 발주서 준비 → 발송 현황 알림
  assert.equal(db.get("SELECT COUNT(*) AS c FROM admin_notices WHERE kind = 'sheets'").c, 1);
  shop.markSheetSeen(ctx, db.get('SELECT * FROM stores WHERE id = ?', [sauna]), at(10));
  standing.tick(ctx, at(11.5));
  const un = db.get("SELECT payload FROM admin_notices WHERE kind = 'unconfirmed'");
  assert.ok(un, '확정하지 않은 사우나가 있으면 알림');
  assert.match(un.payload, /미확정 발주서 1곳/);
  assert.match(un.payload, /010-7777-0001/);
  standing.tick(ctx, at(11.6));
  assert.equal(db.get("SELECT COUNT(*) AS c FROM admin_notices WHERE kind = 'unconfirmed'").c, 1, '하루 한 번');
  standing.tick(ctx, at(11.9));
  const pick = JSON.parse(db.get("SELECT payload FROM admin_notices WHERE kind = 'pick'").payload);
  assert.match(pick.content.title, /출고 합계/);
  assert.deepEqual(pick.item_content.items[0], { item: '콜라 1.25L', item_op: '2박스' });
  const t = today.build(ctx, { role: 'viewer' }, at(12), at(12));
  assert.equal(t.summary.waiting, 1);
  assert.match(t.waiting[0].phone, /\*\*\*\*/, '열람 권한에는 연락처 가림');
  assert.ok(t.waiting[0].seenAt, '발주서를 열어 봤는지 표시');
  assert.equal(t.pick.find((p) => p.sku === 'CL125').qty, 2);
  delivery.dispatch(ctx, T.kstMidnight(at(13.5)), at(13.5));
  const stop = db.get('SELECT id FROM stops LIMIT 1');
  delivery.fail(ctx, stop.id, { reason: '매장 휴무' }, at(15));
  standing.tick(ctx, at(18));
  assert.match(db.get("SELECT payload FROM admin_notices WHERE kind = 'delivery'").payload, /매장 휴무/);

});

test('챗봇: 사우나 발주서 홈 · 지난번 그대로 확정 · 매대별로 이것만 추가', async () => {
  const { ctx, db, sauna } = setup();
  await firstOrder(ctx, sauna, at(-7 * 24 + 10));
  const code = kakao.issueLinkCode(ctx, sauna);
  const say = (extra, utter = '') => kakao.skill(ctx, { userRequest: { user: { id: 'bot-s' }, utterance: utter }, action: { clientExtra: extra || {} } }, at(10));
  await say(null, code);
  let r = await say({ s: 'home' });
  const card = r.template.outputs[0].textCard;
  assert.match(card.title, /발주서/);
  assert.deepEqual(card.buttons.map((b) => b.label), ['📋 발주서 확인하기', '✅ 지난번 그대로 확정', '➕ 이것만 추가']);
  r = await say({ s: 'groups' });
  assert.deepEqual(r.template.quickReplies.map((q) => q.label), ['온장고', '냉장고', '과자 매대', '소모품'], '품목 정렬(매대) 순서대로');
  r = await say(r.template.quickReplies[2].extra);
  assert.equal(r.template.outputs[1].carousel.items.length, 2, '과자 매대 품목만');
  r = await say({ s: 'same' });
  const ok = r.template.outputs[0].textCard;
  assert.match(ok.description, /맥반석 구운란 3박스/);
  r = await say(ok.buttons[0].extra);
  assert.match(r.template.outputs[0].textCard.title, /발주 완료/);
});

test('HTTP: /a는 로그인 필요 · 관리자 카톡 연결(동의) 콜백 · 내 알림 설정 · 알림톡 권유 링크 발송 없음', async () => {
  const f = setup();
  const { ctx, db, sauna, uid } = f;
  ctx.fetch = async (url, opt) => {
    if (String(url).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'adm-tok', expires_in: 21599, refresh_token: 'adm-ref', refresh_token_expires_in: 5183999, scope: 'talk_message profile_nickname' }), { status: 200 });
    if (String(url).endsWith('/v2/user/me')) return new Response(JSON.stringify({ id: 777, properties: { nickname: '박운영' } }), { status: 200 });
    if (String(url).endsWith('/memo/default/send')) return new Response('{"result_code":0}', { status: 200 });
    throw new Error('unexpected ' + url);
  };
  const server = createServer(ctx, { log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, cookie } = {}) => {
    const res = await fetch(base + p, { method, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-bevflow': '1', ...(cookie ? { cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  try {
    const a = await fetch(base + '/a', { redirect: 'manual' });
    assert.equal(a.status, 302);
    assert.equal(a.headers.get('location'), '/login?next=%2Fa');
    const login = await call('POST', '/api/auth/login', { body: { email: 'ops@test.kr', password: 'ops-pass-12345' } });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/a', { headers: { cookie } })).status, 200);
    assert.equal((await call('GET', '/api/admin/today', { cookie })).status, 200);

    const st = await fetch(base + '/k/admin-login', { redirect: 'manual', headers: { cookie } });
    const loc = new URL(st.headers.get('location'));
    assert.equal(loc.searchParams.get('scope'), 'talk_message');
    const ks = st.headers.get('set-cookie').split(';')[0];
    const cb = await fetch(`${base}/k/callback?code=c1&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual', headers: { cookie: `${cookie}; ${ks}` } });
    assert.equal(cb.headers.get('location'), '/?kakao=ok');
    assert.equal(db.get('SELECT refresh_token FROM admin_kakao WHERE user_id = ?', [uid]).refresh_token, 'adm-ref');
    let me = await call('GET', '/api/me/kakao', { cookie });
    assert.equal(me.json.linked, true);
    assert.equal(me.json.prefs.order, true);
    me = await call('PUT', '/api/me/kakao', { cookie, body: { prefs: { order: false } } });
    assert.equal(me.json.prefs.order, false);
    assert.equal((await call('POST', '/api/me/kakao/test', { cookie, body: {} })).status, 200);

    const ol = await call('POST', `/api/admin/stores/${sauna}/order-link`, { cookie, body: { send: true } });
    assert.match(ol.json.url, /\/m\//);
    assert.equal(db.get("SELECT COUNT(*) AS c FROM messages WHERE store_id = ?", [sauna]).c, 0, '발주 권유 알림톡은 보내지 않음');
    assert.equal((await call('PUT', `/api/admin/stores/${sauna}`, { cookie, body: { standing_days: '1,4,x' } })).status, 400);
    assert.equal((await call('PUT', `/api/admin/stores/${sauna}`, { cookie, body: { standing_days: '4,1' } })).status, 200);
    assert.equal(db.get('SELECT standing_days FROM stores WHERE id = ?', [sauna]).standing_days, '1,4');
  } finally { await new Promise((r) => { server.closeAllConnections(); server.close(r); }); }
});
