'use strict';
// API 라우트 — 운영 콘솔(로그인) · 관리(관리자/운영자) · 외부(POS 수신, 사장님·기사 링크)

const crypto = require('node:crypto');
const T = require('./time');
const auth = require('./auth');
const settings = require('./settings');
const tokens = require('./tokens');
const snapshot = require('./api/snapshot');
const inv = require('./engine/inventory');
const props = require('./engine/proposals');
const orders = require('./engine/orders');
const delivery = require('./engine/delivery');
const settlement = require('./engine/settlement');
const msg = require('./engine/messages');
const { logEvent } = require('./engine/events');
const { parseCsv } = require('./csv');
const { HttpError, createRouter, readJson, readBody } = require('./http');

// ── 입력 검증 도우미 ─────────────────────────────────────────
const str = (v, label, { max = 200, required = true, re = null } = {}) => {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${label}을(를) 입력해 주세요`);
  if (s.length > max) throw new HttpError(400, `${label}은(는) ${max}자 이하여야 합니다`);
  if (s && re && !re.test(s)) throw new HttpError(400, `${label} 형식이 올바르지 않습니다`);
  return s;
};
const num = (v, label, { min = -Infinity, max = Infinity, nullable = false, int = false } = {}) => {
  if ((v === '' || v == null) && nullable) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new HttpError(400, `${label}: ${min}~${max} 범위의 ${int ? '정수' : '숫자'}여야 합니다`);
  return n;
};
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, '잘못된 ID'); return n; };
const PHONE = /^[0-9+\- ]{8,20}$/;
const SKU_ID = /^[A-Z0-9_]{2,20}$/;
const CODE = /^[A-Za-z0-9_-]{2,30}$/;

function parseTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v || '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return T.parseDate(m[1]) + ((+m[2]) * 3600 + (+m[3]) * 60 + (+(m[4] || 0))) * 1000; // 시간대 없는 값은 KST로 간주
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new HttpError(400, '판매 시각 형식이 올바르지 않습니다: ' + s);
  return t;
}

const STORE_INSERT = `INSERT INTO stores (code, name, region_id, type, owner_name, owner_phone, address, lat, lng, pos_store_id, send_pref, review_required, pay_test_fail, active, beta, memo, created_at)
  VALUES ($code, $name, $region_id, $type, $owner_name, $owner_phone, $address, $lat, $lng, $pos_store_id, $send_pref, $review_required, $pay_test_fail, $active, $beta, $memo, $now)`;
const STORE_UPDATE = `UPDATE stores SET code=$code, name=$name, region_id=$region_id, type=$type, owner_name=$owner_name, owner_phone=$owner_phone, address=$address,
  lat=$lat, lng=$lng, pos_store_id=$pos_store_id, send_pref=$send_pref, review_required=$review_required, pay_test_fail=$pay_test_fail,
  active=$active, beta=$beta, memo=$memo WHERE id=$id`;

function buildRoutes(ctx) {
  const r = createRouter();
  const { db } = ctx;

  // ── 인증 ────────────────────────────────────────────────
  r.post('/api/auth/login', async (req) => {
    const b = await readJson(req);
    const { sid, user } = auth.login(db, b.email, b.password, req.ip);
    req.setCookie = auth.cookieHeader(sid, req.secure);
    return { user };
  }, { public: true });
  r.post('/api/auth/logout', async (req) => {
    auth.logout(db, req.sid);
    req.setCookie = auth.cookieHeader('', req.secure, 0);
    return { ok: true };
  }, { public: true });
  r.get('/api/me', async (req) => ({ user: req.user }), { role: 'viewer' });
  r.post('/api/auth/password', async (req) => {
    const b = await readJson(req);
    auth.changePassword(db, req.user.id, b.current, b.next);
    req.setCookie = auth.cookieHeader('', req.secure, 0);
    return { ok: true };
  }, { role: 'viewer' });

  // ── 운영 콘솔 ────────────────────────────────────────────
  r.get('/api/console/snapshot', async (req) => snapshot.build(ctx, req.user, Date.now()), { role: 'viewer', etag: true });
  r.get('/api/stores/:id/series', async (req, p, url) => {
    const days = num(url.searchParams.get('days') || 14, '기간', { min: 1, max: 60 });
    const sku = str(url.searchParams.get('sku'), 'SKU', { re: SKU_ID });
    const since = Date.now() - days * T.DAY;
    return { points: db.all('SELECT t, est AS E, band AS w FROM inv_snapshots WHERE store_id = ? AND sku_id = ? AND t >= ? ORDER BY t', [id(p.id), sku, since]) };
  }, { role: 'viewer' });

  const act = (fn) => async (req, p) => {
    const b = await readJson(req);
    try { return { ok: true, result: await fn(id(p.id), b, req.user.email, Date.now()) }; } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(409, e.message);
    }
  };
  r.post('/api/proposals/:id/approve', act((pid, b, who, now) => {
    const note = str(b.note, '대리 승인 사유 (예: 사장님 통화 확인)', { max: 100 });
    return orders.approve(ctx, pid, { qty: b.qty || null, actor: 'ops:' + who, note }, now);
  }), { role: 'ops' });
  r.post('/api/proposals/:id/hold', act((pid, b, who, now) => orders.hold(ctx, pid, { actor: 'ops:' + who }, now)), { role: 'ops' });
  r.post('/api/proposals/:id/remind', act((pid, b, who, now) => props.remind(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/proposals/:id/send-now', act((pid, b, who, now) => props.sendNow(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/proposals/:id/cancel', act((pid, b, who, now) => orders.cancel(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/proposals/:id/retry-payment', act((pid, b, who, now) => orders.retryPayment(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.get('/api/proposals/:id/link', async (req, p) => {
    const pr = db.get('SELECT * FROM proposals WHERE id = ?', [id(p.id)]);
    if (!pr) throw new HttpError(404, '발주를 찾을 수 없습니다');
    return { url: msg.ownerLink(ctx, pr), text: db.get("SELECT body FROM messages WHERE proposal_id = ? AND kind = 'propose' ORDER BY id DESC LIMIT 1", [pr.id])?.body || null };
  }, { role: 'ops' });
  r.post('/api/stores/:id/propose', act((sid, b, who, now) => props.proposeNow(ctx, sid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/stores/:id/counts', act((sid, b, who, now) => {
    if (!b.counts || typeof b.counts !== 'object') throw new HttpError(400, '잔량을 입력해 주세요');
    return inv.recordCount(ctx, sid, b.counts, 'ops:' + who, now, !!b.onboarding);
  }), { role: 'ops' });
  r.post('/api/dispatch', async (req) => {
    const b = await readJson(req);
    const now = Date.now();
    const mid = b.date ? T.parseDate(b.date) : T.kstMidnight(now);
    return { ok: true, result: delivery.dispatch(ctx, mid, now, 'ops:' + req.user.email) };
  }, { role: 'ops' });
  const stopAct = (fn) => act((sid, b, who, now) => fn(sid, b, 'ops:' + who, now));
  r.post('/api/stops/:id/arrive', stopAct((sid, b, who, now) => delivery.arrive(ctx, sid, { actor: who }, now)), { role: 'ops' });
  r.post('/api/stops/:id/complete', stopAct((sid, b, who, now) => delivery.complete(ctx, sid, { counts: b.counts || null, actor: who }, now)), { role: 'ops' });
  r.post('/api/stops/:id/fail', stopAct((sid, b, who, now) => delivery.fail(ctx, sid, { reason: str(b.reason, '실패 사유', { max: 100 }), actor: who }, now)), { role: 'ops' });
  r.get('/api/routes/:id/link', async (req, p) => {
    const route = db.get('SELECT * FROM routes WHERE id = ?', [id(p.id)]);
    if (!route) throw new HttpError(404, '라우트를 찾을 수 없습니다');
    return { url: delivery.driverLink(ctx, route) };
  }, { role: 'ops' });
  r.get('/api/settlements/:week/csv', async (req, p) => {
    T.parseDate(p.week);
    return { __raw: settlement.csv(ctx, p.week), type: 'text/csv; charset=utf-8', filename: `bevflow-settlement-${p.week}.csv` };
  }, { role: 'viewer' });
  r.post('/api/settlements/:week/paid', async (req, p) => {
    settlement.markPaid(ctx, p.week, req.user.email, Date.now());
    logEvent(db, { t: Date.now(), kind: '정산', actor: req.user.email, message: `${p.week} 주차 지급 완료 처리` });
    return { ok: true };
  }, { role: 'admin' });

  // ── 관리 ────────────────────────────────────────────────
  r.get('/api/admin/data', async (req) => {
    const admin = req.user.role === 'admin';
    return {
      stores: db.all('SELECT * FROM stores ORDER BY region_id, code'),
      storeSkus: db.all('SELECT store_id, sku_id, carried, rate, rate_manual, safety_override, last_count_at FROM store_skus'),
      skus: db.all('SELECT * FROM skus ORDER BY sort, id'),
      menuMap: db.all('SELECT m.*, s.name AS store_name FROM menu_map m LEFT JOIN stores s ON s.id = m.store_id ORDER BY m.menu_name'),
      unmapped: db.all('SELECT u.*, s.name AS store_name, s.code AS store_code FROM unmapped_menu u JOIN stores s ON s.id = u.store_id ORDER BY u.qty DESC LIMIT 200'),
      drivers: db.all('SELECT * FROM drivers ORDER BY id'),
      regions: db.all('SELECT * FROM regions ORDER BY sort, id'),
      users: admin ? db.all('SELECT id, email, name, role, disabled, must_change, created_at, last_login_at FROM users ORDER BY id') : [],
      settings: { values: ctx.settings, spec: settings.SPEC },
      ingest: admin ? { endpoint: ctx.R.public_base_url + '/api/ingest/pos', secret: ctx.getSecret('ingest'), webhookSecret: ctx.getSecret('webhook') } : null,
      outbox: db.all("SELECT id, kind, status, attempts, error, created_at FROM messages WHERE status != 'sent' ORDER BY id DESC LIMIT 50"),
    };
  }, { role: 'ops' });

  const storeFields = (b, cur = {}) => {
    const o = {
      code: str(b.code ?? cur.code, '매장 코드', { max: 30, re: CODE }),
      name: str(b.name ?? cur.name, '매장명', { max: 60 }),
      region_id: str(b.region_id ?? cur.region_id, '권역', { max: 20 }),
      type: (b.type ?? cur.type) === 'D' ? 'D' : 'L',
      owner_name: str(b.owner_name ?? cur.owner_name, '사장님 성함', { max: 30, required: false }),
      owner_phone: str(b.owner_phone ?? cur.owner_phone, '사장님 연락처', { max: 20, required: false, re: PHONE }),
      address: str(b.address ?? cur.address, '주소', { max: 200, required: false }),
      lat: num(b.lat ?? cur.lat, '위도', { min: 33, max: 39, nullable: true }),
      lng: num(b.lng ?? cur.lng, '경도', { min: 124, max: 132, nullable: true }),
      pos_store_id: str(b.pos_store_id ?? cur.pos_store_id, '티오더 매장 ID', { max: 60, required: false }) || null,
      send_pref: (b.send_pref ?? cur.send_pref) === 'break' ? 'break' : 'immediate',
      review_required: bool(b.review_required ?? cur.review_required),
      pay_test_fail: bool(b.pay_test_fail ?? cur.pay_test_fail),
      active: b.active === undefined ? (cur.active ?? 1) : bool(b.active),
      beta: num(b.beta === undefined ? cur.beta : b.beta, '밴드 증가율', { min: 0, max: 1, nullable: true }),
      memo: str(b.memo ?? cur.memo, '메모', { max: 500, required: false }),
    };
    if (!db.get('SELECT 1 FROM regions WHERE id = ?', [o.region_id])) throw new HttpError(400, '존재하지 않는 권역입니다');
    return o;
  };
  const uniq = (fn) => { try { return fn(); } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, '이미 사용 중인 코드 또는 티오더 매장 ID입니다'); throw e; } };
  r.post('/api/admin/stores', async (req) => {
    const b = await readJson(req);
    const o = storeFields(b);
    const now = Date.now();
    const sid = uniq(() => db.tx(() => {
      const res = db.run(STORE_INSERT, { ...o, now });
      const newId = Number(res.lastInsertRowid);
      for (const sku of Array.isArray(b.skus) ? b.skus : []) {
        if (db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) db.run('INSERT OR IGNORE INTO store_skus (store_id, sku_id) VALUES (?, ?)', [newId, sku]);
      }
      logEvent(db, { t: now, kind: '매장 등록', store_id: newId, region_id: o.region_id, actor: req.user.email, message: `${o.name} (${o.code}) 등록` });
      return newId;
    }));
    return { id: sid };
  }, { role: 'ops' });
  r.put('/api/admin/stores/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM stores WHERE id = ?', [id(p.id)]);
    if (!cur) throw new HttpError(404, '매장을 찾을 수 없습니다');
    const o = storeFields(await readJson(req), cur);
    uniq(() => db.run(STORE_UPDATE, { ...o, id: cur.id }));
    logEvent(db, { t: Date.now(), kind: '매장 수정', store_id: cur.id, region_id: o.region_id, actor: req.user.email, message: `${o.name} 정보 수정` });
    return { ok: true };
  }, { role: 'ops' });
  r.put('/api/admin/stores/:id/skus', async (req, p) => {
    const sid = id(p.id);
    if (!db.get('SELECT 1 FROM stores WHERE id = ?', [sid])) throw new HttpError(404, '매장을 찾을 수 없습니다');
    const b = await readJson(req);
    if (!Array.isArray(b.items)) throw new HttpError(400, 'items 배열이 필요합니다');
    db.tx(() => {
      for (const it of b.items) {
        const sku = str(it.sku_id, 'SKU', { re: SKU_ID });
        if (!db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) throw new HttpError(400, '없는 SKU: ' + sku);
        db.run(`INSERT INTO store_skus (store_id, sku_id, carried, rate_manual, safety_override) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (store_id, sku_id) DO UPDATE SET carried = excluded.carried, rate_manual = excluded.rate_manual, safety_override = excluded.safety_override`,
        [sid, sku, bool(it.carried), num(it.rate_manual, '예상 일 판매량', { min: 0, max: 50, nullable: true }), num(it.safety_override, '안전재고', { min: 0, max: 100, nullable: true })]);
      }
    });
    return { ok: true };
  }, { role: 'ops' });

  const skuFields = (b, cur = {}) => ({
    name: str(b.name ?? cur.name, 'SKU명', { max: 60 }),
    pack: num(b.pack ?? cur.pack, '입수', { min: 1, max: 500, int: true }),
    unit: str(b.unit ?? cur.unit ?? '병', '단위', { max: 10 }),
    price: num(b.price ?? cur.price, '박스 단가', { min: 0, max: 10000000, int: true }),
    active: b.active === undefined ? (cur.active ?? 1) : bool(b.active),
    sort: num(b.sort ?? cur.sort ?? 0, '정렬', { min: 0, max: 9999, int: true }),
  });
  r.post('/api/admin/skus', async (req) => {
    const b = await readJson(req);
    const skuId = str(b.id, 'SKU 코드', { re: SKU_ID });
    const o = skuFields(b);
    uniq(() => db.run('INSERT INTO skus (id, name, pack, unit, price, active, sort) VALUES ($id, $name, $pack, $unit, $price, $active, $sort)', { ...o, id: skuId }));
    return { ok: true };
  }, { role: 'ops' });
  r.put('/api/admin/skus/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM skus WHERE id = ?', [p.id]);
    if (!cur) throw new HttpError(404, 'SKU를 찾을 수 없습니다');
    const o = skuFields(await readJson(req), cur);
    db.run('UPDATE skus SET name=$name, pack=$pack, unit=$unit, price=$price, active=$active, sort=$sort WHERE id=$id', { ...o, id: cur.id });
    return { ok: true };
  }, { role: 'ops' });

  r.post('/api/admin/menu-map', async (req) => {
    const b = await readJson(req);
    const storeId = b.store_id ? id(b.store_id) : null;
    const menu = str(b.menu_name, 'POS 메뉴명', { max: 100 });
    const sku = str(b.sku_id, 'SKU', { re: SKU_ID });
    if (!db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) throw new HttpError(400, '없는 SKU입니다');
    const units = num(b.units, '메뉴 1개당 수량', { min: 0.01, max: 100 });
    uniq(() => db.run('INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (?, ?, ?, ?)', [storeId, menu, sku, units]));
    db.run('DELETE FROM unmapped_menu WHERE menu_name = ?' + (storeId ? ' AND store_id = ?' : ''), storeId ? [menu, storeId] : [menu]);
    return { ok: true };
  }, { role: 'ops' });
  r.del('/api/admin/menu-map/:id', async (req, p) => { db.run('DELETE FROM menu_map WHERE id = ?', [id(p.id)]); return { ok: true }; }, { role: 'ops' });

  const driverFields = (b, cur = {}) => ({
    name: str(b.name ?? cur.name, '기사 이름', { max: 30 }),
    phone: str(b.phone ?? cur.phone, '연락처', { max: 20, required: false, re: PHONE }),
    region_id: str(b.region_id ?? cur.region_id, '권역', { max: 20 }),
    vehicle: str(b.vehicle ?? cur.vehicle, '차량', { max: 60, required: false }),
    capacity: num(b.capacity ?? cur.capacity ?? 60, '일 용량', { min: 1, max: 500, int: true }),
    active: b.active === undefined ? (cur.active ?? 1) : bool(b.active),
  });
  r.post('/api/admin/drivers', async (req) => {
    const o = driverFields(await readJson(req));
    db.run('INSERT INTO drivers (name, phone, region_id, vehicle, capacity, active) VALUES ($name, $phone, $region_id, $vehicle, $capacity, $active)', o);
    return { ok: true };
  }, { role: 'ops' });
  r.put('/api/admin/drivers/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM drivers WHERE id = ?', [id(p.id)]);
    if (!cur) throw new HttpError(404, '기사를 찾을 수 없습니다');
    db.run('UPDATE drivers SET name=$name, phone=$phone, region_id=$region_id, vehicle=$vehicle, capacity=$capacity, active=$active WHERE id=$id', { ...driverFields(await readJson(req), cur), id: cur.id });
    return { ok: true };
  }, { role: 'ops' });
  const regionFields = (b, cur = {}) => ({
    name: str(b.name ?? cur.name, '권역명', { max: 30 }),
    area: str(b.area ?? cur.area, '지역', { max: 100, required: false }),
    hub_name: str(b.hub_name ?? cur.hub_name, '거점명', { max: 40, required: false }),
    hub_lat: num(b.hub_lat ?? cur.hub_lat, '거점 위도', { min: 33, max: 39, nullable: true }),
    hub_lng: num(b.hub_lng ?? cur.hub_lng, '거점 경도', { min: 124, max: 132, nullable: true }),
    radius_km: num(b.radius_km ?? cur.radius_km ?? 3, '반경', { min: 0.5, max: 50 }),
    sort: num(b.sort ?? cur.sort ?? 0, '정렬', { min: 0, max: 999, int: true }),
  });
  r.post('/api/admin/regions', async (req) => {
    const b = await readJson(req);
    const rid = str(b.id, '권역 코드', { max: 20, re: /^[A-Z0-9_]{2,20}$/ });
    uniq(() => db.run('INSERT INTO regions (id, name, area, hub_name, hub_lat, hub_lng, radius_km, sort) VALUES ($id, $name, $area, $hub_name, $hub_lat, $hub_lng, $radius_km, $sort)', { ...regionFields(b), id: rid }));
    return { ok: true };
  }, { role: 'admin' });
  r.put('/api/admin/regions/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM regions WHERE id = ?', [p.id]);
    if (!cur) throw new HttpError(404, '권역을 찾을 수 없습니다');
    db.run('UPDATE regions SET name=$name, area=$area, hub_name=$hub_name, hub_lat=$hub_lat, hub_lng=$hub_lng, radius_km=$radius_km, sort=$sort WHERE id=$id', { ...regionFields(await readJson(req), cur), id: cur.id });
    return { ok: true };
  }, { role: 'admin' });

  r.post('/api/admin/users', async (req) => {
    const b = await readJson(req);
    const temp = crypto.randomBytes(9).toString('base64url');
    const uid = auth.createUser(db, { email: b.email, name: b.name, role: b.role, password: temp, mustChange: true });
    logEvent(db, { t: Date.now(), kind: '계정', actor: req.user.email, message: `${b.email} 계정 생성 (${b.role})` });
    return { id: uid, tempPassword: temp };
  }, { role: 'admin' });
  r.put('/api/admin/users/:id', async (req, p) => {
    const uid = id(p.id);
    const b = await readJson(req);
    const cur = db.get('SELECT * FROM users WHERE id = ?', [uid]);
    if (!cur) throw new HttpError(404, '계정을 찾을 수 없습니다');
    if (uid === req.user.id && (b.disabled || (b.role && b.role !== 'admin'))) throw new HttpError(400, '자기 계정의 관리자 권한은 해제할 수 없습니다');
    if (b.role && !auth.ROLES[b.role]) throw new HttpError(400, '잘못된 권한');
    let temp = null;
    db.tx(() => {
      if (b.role) db.run('UPDATE users SET role = ? WHERE id = ?', [b.role, uid]);
      if (b.disabled !== undefined) { db.run('UPDATE users SET disabled = ? WHERE id = ?', [bool(b.disabled), uid]); if (bool(b.disabled)) db.run('DELETE FROM sessions WHERE user_id = ?', [uid]); }
      if (b.resetPassword) {
        temp = crypto.randomBytes(9).toString('base64url');
        db.run('UPDATE users SET pw_hash = ?, must_change = 1 WHERE id = ?', [auth.hashPassword(temp), uid]);
        db.run('DELETE FROM sessions WHERE user_id = ?', [uid]);
      }
    });
    logEvent(db, { t: Date.now(), kind: '계정', actor: req.user.email, message: `${cur.email} 계정 변경` });
    return { ok: true, tempPassword: temp };
  }, { role: 'admin' });

  r.put('/api/admin/settings', async (req) => {
    const b = await readJson(req);
    try { settings.save(db, b); } catch (e) { throw new HttpError(400, e.message); }
    ctx.reload();
    logEvent(db, { t: Date.now(), kind: '설정', actor: req.user.email, message: `운영 설정 변경: ${Object.keys(b).join(', ')}` });
    return { ok: true, settings: ctx.settings };
  }, { role: 'admin' });
  r.post('/api/admin/secrets/:name/rotate', async (req, p) => {
    if (!['ingest', 'webhook', 'link'].includes(p.name)) throw new HttpError(400, '알 수 없는 키');
    ctx.rotateSecret(p.name);
    logEvent(db, { t: Date.now(), kind: '보안', actor: req.user.email, message: `${p.name} 키 재발급` });
    return { ok: true };
  }, { role: 'admin' });
  r.post('/api/admin/sample/clear', async (req) => {
    const b = await readJson(req);
    if (b.confirm !== '샘플 삭제') throw new HttpError(400, "확인 문구 '샘플 삭제'를 입력해 주세요");
    db.tx(() => {
      for (const t of ['events', 'stops', 'routes', 'messages', 'proposal_lines', 'proposals', 'counts', 'inv_snapshots', 'pos_sale_items', 'pos_sales', 'unmapped_menu', 'menu_map', 'store_skus', 'stores', 'drivers', 'regions', 'skus', 'settlements']) db.run(`DELETE FROM ${t}`);
    });
    settings.save(db, { sample_data: 0 });
    ctx.reload();
    logEvent(db, { t: Date.now(), kind: '데이터', actor: req.user.email, message: '샘플 데이터 전체 삭제' });
    return { ok: true };
  }, { role: 'admin' });

  // CSV 일괄 가져오기
  r.post('/api/admin/import/:kind', async (req, p) => {
    const text = (await readBody(req, 8 << 20)).toString('utf8');
    const rows = parseCsv(text);
    if (!rows.length) throw new HttpError(400, 'CSV에 데이터 행이 없습니다');
    const now = Date.now();
    const errors = [];
    let ok = 0;
    const each = (fn) => rows.forEach((row) => { try { db.tx(() => fn(row)); ok++; } catch (e) { errors.push(`${row._line}행: ${e.message}`); } });
    if (p.kind === 'stores') {
      each((row) => {
        const cur = db.get('SELECT * FROM stores WHERE code = ?', [row.code]) || {};
        const o = storeFields({ ...row, review_required: row.review_required, active: row.active === '' ? undefined : row.active }, cur);
        if (cur.id) db.run(STORE_UPDATE, { ...o, id: cur.id });
        else db.run(STORE_INSERT, { ...o, now });
        const sid = db.get('SELECT id FROM stores WHERE code = ?', [o.code]).id;
        for (const sku of String(row.skus || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
          if (!db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) throw new Error('없는 SKU: ' + sku);
          db.run('INSERT OR IGNORE INTO store_skus (store_id, sku_id) VALUES (?, ?)', [sid, sku]);
        }
      });
    } else if (p.kind === 'menu-map') {
      each((row) => {
        const store = row.store_code ? db.get('SELECT id FROM stores WHERE code = ?', [row.store_code]) : null;
        if (row.store_code && !store) throw new Error('없는 매장 코드: ' + row.store_code);
        if (!db.get('SELECT 1 FROM skus WHERE id = ?', [row.sku_id])) throw new Error('없는 SKU: ' + row.sku_id);
        const units = num(row.units || 1, 'units', { min: 0.01, max: 100 });
        db.run(`INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (?, ?, ?, ?)
                ON CONFLICT DO UPDATE SET units = excluded.units`, [store ? store.id : null, str(row.menu_name, 'menu_name', { max: 100 }), row.sku_id, units]);
      });
    } else if (p.kind === 'pos-sales') {
      each((row) => {
        const store = db.get('SELECT * FROM stores WHERE pos_store_id = ? OR code = ?', [row.store || row.pos_store_id || '', row.store_code || row.store || '']);
        if (!store) throw new Error('매장을 찾을 수 없습니다: ' + (row.store || row.store_code));
        inv.applySale(ctx, store, { ext_id: str(row.sale_id || row.id, 'sale_id', { max: 100 }), sold_at: parseTime(row.sold_at), menu: str(row.menu, 'menu', { max: 100 }), qty: num(row.qty, 'qty', { min: 1, max: 1000, int: true }) }, now);
      });
    } else throw new HttpError(404, '지원하지 않는 가져오기 종류입니다');
    logEvent(db, { t: now, kind: '가져오기', actor: req.user.email, message: `${p.kind} CSV ${ok}건 반영${errors.length ? `, 오류 ${errors.length}건` : ''}` });
    return { ok, errors: errors.slice(0, 50), errorCount: errors.length };
  }, { role: 'ops' });

  // ── 외부: 티오더 POS 판매 로그 수신 ─────────────────────────
  // TODO: 티오더 API 연동 — 티오더가 이 주소로 판매 로그를 푸시하도록 협의 (서명 방식은 docs/INTEGRATIONS.md)
  r.post('/api/ingest/pos', async (req) => {
    const raw = await readBody(req, 4 << 20);
    const ts = Number(req.headers['x-bevflow-timestamp']);
    const sig = String(req.headers['x-bevflow-signature'] || '').replace(/^sha256=/, '');
    const now = Date.now();
    if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60e3) throw new HttpError(401, '타임스탬프가 없거나 5분 이상 차이납니다');
    const want = crypto.createHmac('sha256', ctx.getSecret('ingest')).update(ts + '.' + raw.toString('utf8')).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw new HttpError(401, '서명이 올바르지 않습니다');
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON 형식이 올바르지 않습니다'); }
    const sales = Array.isArray(body.sales) ? body.sales : [];
    if (sales.length > 5000) throw new HttpError(413, '한 번에 5,000건까지 보낼 수 있습니다');
    const out = { accepted: 0, duplicates: 0, unmapped: 0, unknownStore: 0, invalid: 0 };
    db.tx(() => {
      for (const s of sales) {
        const posId = String(s.store ?? body.store ?? '');
        const store = db.get('SELECT * FROM stores WHERE pos_store_id = ? AND active = 1', [posId]);
        if (!store) { out.unknownStore++; continue; }
        let sale;
        try { sale = { ext_id: str(s.id, 'id', { max: 100 }), sold_at: parseTime(s.sold_at), menu: str(s.menu, 'menu', { max: 100 }), qty: num(s.qty, 'qty', { min: 1, max: 1000, int: true }) }; } catch { out.invalid++; continue; }
        if (sale.sold_at > now + 10 * 60e3) { out.invalid++; continue; }
        const res = inv.applySale(ctx, store, sale, now);
        if (res.dup) out.duplicates++; else { out.accepted++; if (!res.mapped) out.unmapped++; }
      }
    });
    return out;
  }, { public: true, noCsrf: true });

  // ── 외부: 사장님 승인 링크 ─────────────────────────────────
  const ownerProposal = (token) => {
    const t = tokens.verify(ctx.secret, token, 'o');
    if (!t) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [t.id]);
    if (!p || p.token_nonce !== t.n) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    return p;
  };
  const ownerView = (p, now) => {
    const store = db.get('SELECT name, owner_name FROM stores WHERE id = ?', [p.store_id]);
    const lines = msg.linesOf(db, p.id);
    const canAct = ['sent', 'created'].includes(p.status) && p.responded_at == null && (p.status === 'sent' || p.send_at != null);
    const stop = db.get('SELECT eta, status, departed_at FROM stops WHERE proposal_id = ? ORDER BY id DESC LIMIT 1', [p.id]);
    return {
      code: p.code, store: store.name, owner: store.owner_name, status: p.status, canAct, amount: p.amount,
      sameDay: T.kstHour(now) < ctx.R.cutoffH, cutoff: ctx.settings.cutoff, expiresAt: p.sent_at ? p.sent_at + ctx.R.expire_hours * T.HOUR : null,
      lines: lines.map((l) => ({ sku: l.sku_id, name: l.name, qty: l.qty, qtyOrig: l.qty_orig, price: l.price, est: Math.round(l.est * 10) / 10, band: Math.round(l.band * 10) / 10, trig: !!l.trig })),
      deliverDate: p.deliver_date, eta: stop ? stop.eta : null, deliveredAt: stop && stop.status === 'done' ? stop.departed_at : null,
      payMethod: p.pay_method, payFailReason: p.status === 'payfail' ? p.pay_fail_reason : null,
    };
  };
  r.get('/api/owner/:token', async (req, p) => {
    const pr = ownerProposal(p.token);
    const now = Date.now();
    orders.markOpened(ctx, pr.id, now);
    return ownerView(db.get('SELECT * FROM proposals WHERE id = ?', [pr.id]), now);
  }, { public: true });
  r.post('/api/owner/:token/approve', async (req, p) => {
    const pr = ownerProposal(p.token);
    const b = await readJson(req);
    try { await orders.approve(ctx, pr.id, { qty: b.qty || null, actor: 'owner' }, Date.now()); } catch (e) { throw new HttpError(409, e.message); }
    return ownerView(db.get('SELECT * FROM proposals WHERE id = ?', [pr.id]), Date.now());
  }, { public: true });
  r.post('/api/owner/:token/hold', async (req, p) => {
    const pr = ownerProposal(p.token);
    try { orders.hold(ctx, pr.id, { actor: 'owner' }, Date.now()); } catch (e) { throw new HttpError(409, e.message); }
    return ownerView(db.get('SELECT * FROM proposals WHERE id = ?', [pr.id]), Date.now());
  }, { public: true });

  // ── 외부: 기사 배송 링크 ───────────────────────────────────
  const driverRoute = (token) => {
    const t = tokens.verify(ctx.secret, token, 'd');
    if (!t) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    const route = db.get('SELECT * FROM routes WHERE id = ?', [t.id]);
    if (!route || route.token_nonce !== t.n) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    return route;
  };
  const routeView = (route) => {
    const rg = db.get('SELECT * FROM regions WHERE id = ?', [route.region_id]);
    const drv = route.driver_id ? db.get('SELECT name FROM drivers WHERE id = ?', [route.driver_id]) : null;
    const stops = db.all(`SELECT s.*, st.name, st.address, st.owner_phone, st.lat, st.lng FROM stops s JOIN stores st ON st.id = s.store_id WHERE s.route_id = ? ORDER BY s.seq`, [route.id]);
    return {
      date: route.date, region: rg ? rg.name : route.region_id, hub: rg ? rg.hub_name : '', driver: drv ? drv.name : '',
      stops: stops.map((s) => ({
        id: s.id, seq: s.seq, status: s.status, eta: s.eta, arrivedAt: s.arrived_at, departedAt: s.departed_at, boxes: s.boxes, failReason: s.fail_reason,
        store: s.name, address: s.address, phone: s.owner_phone, lat: s.lat, lng: s.lng,
        unload: db.all('SELECT l.sku_id AS sku, k.name, l.qty FROM proposal_lines l JOIN skus k ON k.id = l.sku_id WHERE l.proposal_id = ? AND l.qty > 0 ORDER BY k.sort', [s.proposal_id]),
        count: db.all('SELECT ss.sku_id AS sku, k.name, k.pack, k.unit FROM store_skus ss JOIN skus k ON k.id = ss.sku_id WHERE ss.store_id = ? AND ss.carried = 1 AND k.active = 1 ORDER BY k.sort', [s.store_id]),
      })),
    };
  };
  r.get('/api/driver/:token', async (req, p) => routeView(driverRoute(p.token)), { public: true });
  const drvAct = (fn) => async (req, p) => {
    const route = driverRoute(p.token);
    const b = await readJson(req);
    try { fn(id(p.id), route, b, Date.now()); } catch (e) { throw new HttpError(409, e.message); }
    return routeView(route);
  };
  r.post('/api/driver/:token/stops/:id/arrive', drvAct((sid, route, b, now) => delivery.arrive(ctx, sid, { routeId: route.id, actor: 'driver' }, now)), { public: true });
  r.post('/api/driver/:token/stops/:id/complete', drvAct((sid, route, b, now) => delivery.complete(ctx, sid, { counts: b.counts || null, routeId: route.id, actor: 'driver' }, now)), { public: true });
  r.post('/api/driver/:token/stops/:id/fail', drvAct((sid, route, b, now) => delivery.fail(ctx, sid, { reason: str(b.reason, '실패 사유', { max: 100 }), routeId: route.id, actor: 'driver' }, now)), { public: true });

  r.get('/healthz', async () => ({ ok: true, version: db.version }), { public: true });
  return r;
}

module.exports = { buildRoutes, parseTime };
