'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createServer } = require('../server/app');
const auth = require('../server/auth');
const props = require('../server/engine/proposals');
const inv = require('../server/engine/inventory');
const delivery = require('../server/engine/delivery');
const T = require('../server/time');
const { fixture } = require('./helpers');

async function boot() {
  const f = fixture();
  auth.createUser(f.db, { email: 'admin@test.kr', name: '관리자', role: 'admin', password: 'admin-pass-1234' });
  auth.createUser(f.db, { email: 'view@test.kr', name: '열람', role: 'viewer', password: 'viewer-pass-1234' });
  auth._attempts.clear();
  const server = createServer(f.ctx, { log: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, cookie, csrf = true, headers = {}, raw } = {}) => {
    const res = await fetch(base + p, {
      method, redirect: 'manual',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(csrf ? { 'x-bevflow': '1' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const login = async (email, password) => {
    const r = await call('POST', '/api/auth/login', { body: { email, password } });
    assert.equal(r.status, 200, r.text);
    return r.headers.get('set-cookie').split(';')[0];
  };
  return { ...f, server, base, call, login, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

test('인증: 로그인 필요, CSRF 헤더 필수, 뷰어는 쓰기 불가, 보안 헤더', async () => {
  const b = await boot();
  try {
    assert.equal((await b.call('GET', '/api/console/snapshot')).status, 401);
    const page = await fetch(b.base + '/', { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal((await b.call('POST', '/api/auth/login', { body: { email: 'admin@test.kr', password: 'wrong' } })).status, 401);
    const cookie = await b.login('admin@test.kr', 'admin-pass-1234');
    const snap = await b.call('GET', '/api/console/snapshot', { cookie });
    assert.equal(snap.status, 200);
    assert.equal(snap.json.stores.length, 2);
    assert.match(snap.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(snap.headers.get('referrer-policy'), 'no-referrer');
    const again = await fetch(b.base + '/api/console/snapshot', { headers: { cookie, 'if-none-match': snap.headers.get('etag') } });
    assert.equal(again.status, 304);
    assert.equal((await b.call('POST', `/api/stores/${b.s1}/propose`, { cookie, csrf: false, body: {} })).status, 403);
    const vcookie = await b.login('view@test.kr', 'viewer-pass-1234');
    assert.equal((await b.call('POST', `/api/stores/${b.s1}/propose`, { cookie: vcookie, body: {} })).status, 403);
    const vs = await b.call('GET', '/api/console/snapshot', { cookie: vcookie });
    assert.match(vs.json.stores[0].phone, /\*\*\*\*/, '뷰어에게는 연락처 마스킹');
  } finally { await b.close(); }
});

test('POS 수신: HMAC 서명·타임스탬프 검증, 멱등, 미매핑 집계', async () => {
  const b = await boot();
  try {
    inv.recordCount(b.ctx, b.s1, { CL125: 3, SD150: 3, WT200: 3 }, 't', Date.now() - 3600e3, true);
    const secret = b.ctx.getSecret('ingest');
    const payload = JSON.stringify({ store: 'POS-GN-01', sales: [
      { id: 's-1', sold_at: new Date(Date.now() - 60e3).toISOString(), menu: '콜라 1.25L', qty: 3 },
      { id: 's-2', sold_at: Date.now() - 30e3, menu: '하이볼', qty: 1 },
      { id: 's-3', store: 'POS-UNKNOWN', sold_at: Date.now(), menu: '콜라 1.25L', qty: 1 },
    ] });
    const ts = Date.now();
    const sig = crypto.createHmac('sha256', secret).update(ts + '.' + payload).digest('hex');
    const post = (s, t = ts) => b.call('POST', '/api/ingest/pos', { raw: payload, csrf: false, headers: { 'content-type': 'application/json', 'x-bevflow-timestamp': String(t), 'x-bevflow-signature': 'sha256=' + s } });
    assert.equal((await post('00'.repeat(32))).status, 401);
    assert.equal((await post(sig, ts - 10 * 60e3)).status, 401);
    const ok = await post(sig);
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json, { accepted: 2, duplicates: 0, unmapped: 1, unknownStore: 1, invalid: 0 });
    const again = await post(sig);
    assert.equal(again.json.duplicates, 2);
    const it = b.db.get("SELECT est FROM store_skus WHERE store_id = ? AND sku_id = 'CL125'", [b.s1]);
    assert.ok(Math.abs(it.est - 2.75) < 1e-9);
  } finally { await b.close(); }
});

test('사장님 링크: 열람 기록 → 수량 수정 승인 → 재사용 불가, 위조 토큰 거부', async () => {
  const b = await boot();
  try {
    inv.recordCount(b.ctx, b.s1, { CL125: 1, SD150: 3, WT200: 3 }, 't', Date.now() - 3600e3, true);
    const now = Date.now();
    const p = props.proposeNow(b.ctx, b.s1, 'test', now);
    props.sendNow(b.ctx, p.id, 'test', now);
    const body = b.db.get("SELECT body FROM messages WHERE kind = 'propose'").body;
    const token = /\/o\/([^\s]+)/.exec(body)[1];
    const page = await fetch(b.base + '/o/' + token);
    assert.equal(page.status, 200);
    const pv = await b.call('GET', '/api/owner/' + token + '?preview=1', { csrf: false });
    assert.equal(pv.status, 200);
    assert.equal(b.db.get('SELECT opened_at FROM proposals WHERE id = ?', [p.id]).opened_at, null, '운영자 미리보기는 열람으로 기록하지 않음');
    const view = await b.call('GET', '/api/owner/' + token, { csrf: false });
    assert.equal(view.status, 200);
    assert.equal(view.json.canAct, true);
    assert.ok(b.db.get('SELECT opened_at FROM proposals WHERE id = ?', [p.id]).opened_at);
    const tampered = token.slice(0, -3) + (token.endsWith('AAA') ? 'BBB' : 'AAA');
    assert.equal((await b.call('GET', '/api/owner/' + tampered, { csrf: false })).status, 404);
    const qty = { [view.json.lines[0].sku]: view.json.lines[0].qty + 2 };
    const ap = await b.call('POST', `/api/owner/${token}/approve`, { body: { qty } });
    assert.equal(ap.status, 200, ap.text);
    assert.equal(ap.json.status, 'paid');
    assert.equal(ap.json.canAct, false);
    assert.equal((await b.call('POST', `/api/owner/${token}/hold`, { body: {} })).status, 409);
  } finally { await b.close(); }
});

test('기사 링크: 도착 → 잔량 입력 → 하차 완료, 다른 라우트의 정차는 거부', async () => {
  const b = await boot();
  try {
    const cookie = await b.login('admin@test.kr', 'admin-pass-1234');
    const now = Date.now();
    inv.recordCount(b.ctx, b.s1, { CL125: 1, SD150: 3, WT200: 3 }, 't', now - 3600e3, true);
    const p = props.proposeNow(b.ctx, b.s1, 'test', now);
    const ap = await b.call('POST', `/api/proposals/${p.id}/approve`, { cookie, body: { note: '사장님 통화 확인' } });
    assert.equal(ap.status, 200, ap.text);
    b.db.run("UPDATE proposals SET deliver_date = ? WHERE id = ?", [T.dateStr(now), p.id]);
    const d = await b.call('POST', '/api/dispatch', { cookie, body: {} });
    assert.equal(d.status, 200, d.text);
    const route = b.db.get('SELECT * FROM routes LIMIT 1');
    const link = (await b.call('GET', `/api/routes/${route.id}/link`, { cookie })).json.url;
    const token = link.split('/d/')[1];
    const view = await b.call('GET', '/api/driver/' + token, { csrf: false });
    assert.equal(view.status, 200);
    const stop = view.json.stops[0];
    assert.ok(stop.count.length >= 3);
    assert.equal((await b.call('POST', `/api/driver/${token}/stops/99999/arrive`, { body: {} })).status, 409);
    assert.equal((await b.call('POST', `/api/driver/${token}/stops/${stop.id}/arrive`, { body: {} })).status, 200);
    const done = await b.call('POST', `/api/driver/${token}/stops/${stop.id}/complete`, { body: { counts: { CL125: 0.5, SD150: 2.5, WT200: 3 } } });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.json.stops[0].status, 'done');
    assert.equal(b.db.get('SELECT status FROM proposals WHERE id = ?', [p.id]).status, 'delivered');
    assert.equal(b.db.get("SELECT COUNT(*) AS c FROM counts WHERE source = 'driver'").c, 3);
    // 대리 승인은 사유가 필요
    const p2 = props.proposeNow(b.ctx, b.s2, 'test', now);
    assert.equal((await b.call('POST', `/api/proposals/${p2.id}/approve`, { cookie, body: {} })).status, 400);
  } finally { await b.close(); }
});

test('관리: 매장 등록·검증, CSV 가져오기, 설정 검증, 계정 생성 시 임시 비밀번호 변경 강제', async () => {
  const b = await boot();
  try {
    const cookie = await b.login('admin@test.kr', 'admin-pass-1234');
    const bad = await b.call('POST', '/api/admin/stores', { cookie, body: { code: 'GN 03', name: 'x', region_id: 'GN' } });
    assert.equal(bad.status, 400);
    const ok = await b.call('POST', '/api/admin/stores', { cookie, body: { code: 'GN-03', name: '선릉 새매장', region_id: 'GN', owner_phone: '010-2222-3333', skus: ['CL125', 'SD150'] } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(b.db.get('SELECT COUNT(*) AS c FROM store_skus WHERE store_id = ?', [ok.json.id]).c, 2);
    const csv = 'code,name,region_id,type,owner_phone,pos_store_id,skus\nGN-04,논현 새매장,GN,D,010-1111-2222,POS-GN-04,CL125;WT200\nGN-05,,GN,L,,,\n';
    const imp = await b.call('POST', '/api/admin/import/stores', { cookie, raw: csv, headers: { 'content-type': 'text/csv' } });
    assert.equal(imp.status, 200, imp.text);
    assert.equal(imp.json.ok, 1);
    assert.equal(imp.json.errorCount, 1);
    assert.equal((await b.call('PUT', '/api/admin/settings', { cookie, body: { cutoff: '25:00' } })).status, 400);
    const s = await b.call('PUT', '/api/admin/settings', { cookie, body: { cutoff: '11:30', fee_rate: 0.025 } });
    assert.equal(s.status, 200);
    assert.equal(b.ctx.R.cutoffH, 11.5);
    const u = await b.call('POST', '/api/admin/users', { cookie, body: { email: 'ops@test.kr', name: '운영', role: 'ops' } });
    assert.equal(u.status, 200);
    const oc = await b.login('ops@test.kr', u.json.tempPassword);
    assert.equal((await b.call('GET', '/api/console/snapshot', { cookie: oc })).status, 403, '비밀번호 변경 전 차단');
    assert.equal((await b.call('POST', '/api/auth/password', { cookie: oc, body: { current: u.json.tempPassword, next: 'new-password-123' } })).status, 200);
    const oc2 = await b.login('ops@test.kr', 'new-password-123');
    assert.equal((await b.call('GET', '/api/console/snapshot', { cookie: oc2 })).status, 200);
    assert.equal((await b.call('PUT', '/api/admin/settings', { cookie: oc2, body: { cutoff: '12:00' } })).status, 403, '운영자는 설정 변경 불가');
    const csvRes = await fetch(b.base + '/api/settlements/2026-03-02/csv', { headers: { cookie } });
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get('content-disposition'), /attachment/);
  } finally { await b.close(); }
});

test('로그인 시도 제한', async () => {
  const b = await boot();
  try {
    for (let i = 0; i < 10; i++) await b.call('POST', '/api/auth/login', { body: { email: 'admin@test.kr', password: 'nope' } });
    const r = await b.call('POST', '/api/auth/login', { body: { email: 'admin@test.kr', password: 'admin-pass-1234' } });
    assert.equal(r.status, 429);
  } finally { await b.close(); }
});
