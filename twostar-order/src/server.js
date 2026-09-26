'use strict';
// 투스타 발주 서버
//   /kakao/skill?key=…   카카오 오픈빌더 스킬 (점주 카톡 발주)
//   /o/<토큰>            점주 발주서 (품목이 많은 매장용 한 장짜리 화면)
//   /admin               관리자 화면 (주문 · 출고 집계 · 품목 승인 · 매장 · 품목)
//
// 설정 (환경 변수)
//   PORT=8080  PUBLIC_URL=https://…  ADMIN_PASSWORD=…  SKILL_KEY=…  BLOCK_ID=…
//   MIN_ORDER=0  GUEST_URL=…  DB_FILE=data/order.db

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const O = require('./order');
const { skill } = require('./kakao');
const { open } = require('./db');
const tokens = require('./tokens');

const ROOT = path.join(__dirname, '..');
const LINK_TTL = 30 * 24 * 3600e3; // 발주서 링크 30일
const SESSION_TTL = 12 * 3600e3;

function loadSecret(file) {
  if (process.env.SECRET) return process.env.SECRET;
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* 처음 실행 */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

function config(env = process.env) {
  const dataDir = env.DATA_DIR || path.join(ROOT, 'data');
  return {
    port: Number(env.PORT || 8080),
    publicUrl: String(env.PUBLIC_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/+$/, ''),
    adminPassword: env.ADMIN_PASSWORD || '',
    skillKey: env.SKILL_KEY || '',
    blockId: env.BLOCK_ID || '',
    minAmount: Number(env.MIN_ORDER || 0),
    guest: { label: env.GUEST_LABEL || '쇼핑몰 문의하기', url: env.GUEST_URL || '' },
    dbFile: env.DB_FILE || path.join(dataDir, 'order.db'),
    secret: env.SECRET || loadSecret(path.join(dataDir, 'secret')),
  };
}

// ── 공통 ────────────────────────────────────────────
const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { ...HEADERS, 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', ...extra });
  res.end(buf);
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new O.UserError('요청이 너무 큽니다')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new O.UserError('잘못된 요청입니다')); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}

const STATIC = {
  '/assets/app.css': ['public/app.css', 'text/css; charset=utf-8'],
  '/assets/order.js': ['public/order.js', 'text/javascript; charset=utf-8'],
  '/assets/admin.js': ['public/admin.js', 'text/javascript; charset=utf-8'],
};
const PAGES = {
  order: path.join(ROOT, 'public/order.html'),
  admin: path.join(ROOT, 'public/admin.html'),
  login: path.join(ROOT, 'public/login.html'),
};
const page = (name) => fs.readFileSync(PAGES[name]);

function safeEq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// ── 앱 ──────────────────────────────────────────────
function createApp(cfg) {
  const db = open(cfg.dbFile);
  const tk = tokens.make(cfg.secret);
  const orderLink = (storeId) => `${cfg.publicUrl}/o/${tk.sign('o', storeId, LINK_TTL)}`;
  const events = []; // 관리자 화면 새 소식 (새 주문·승인 요청)
  const note = (kind, text) => {
    events.push({ at: Date.now(), kind, text });
    if (events.length > 200) events.shift();
  };
  const hooks = {
    onOrder(order, dup) {
      if (dup) return;
      const s = O.storeOf(db, order.store_id);
      note('order', `새 주문 ${order.no} · ${s ? s.name : ''} · ${O.won(order.total)}`);
    },
    onAccess(store, category) { note('access', `품목 신청 · ${store.name} · ${O.CATEGORIES[category]}`); },
  };
  const loginFails = new Map();

  function storeFromToken(token) {
    const id = tk.verify('o', token);
    return id ? O.storeOf(db, Number(id)) : null;
  }

  function sheetView(store, prefill = false) {
    let cart = O.cartOf(db, store);
    let prefilled = false;
    // 사우나: 품목이 많아 매번 지난 발주를 채운 발주서로 시작 (빈 장바구니일 때만)
    if (prefill && store.biz === 'sauna' && !cart.count && O.lastOrder(db, store)) {
      O.reorder(db, store);
      cart = O.cartOf(db, store);
      prefilled = cart.count > 0;
    }
    const last = O.lastOrder(db, store);
    const lastQty = {};
    if (last) for (const l of last.lines) lastQty[l.item_id] = l.qty;
    const items = O.itemsFor(db, store).map((i) => ({
      id: i.id, category: i.category, grp: i.grp, name: i.name, spec: i.spec, unit: i.unit, price: i.price, last: lastQty[i.id] || 0,
    }));
    return {
      store: { name: store.name, biz: O.BIZ[store.biz].label },
      categories: O.categoriesOf(db, store).map((c) => ({ id: c, label: O.CATEGORIES[c] })),
      access: O.accessStates(db, store),
      items,
      cart: Object.fromEntries(cart.lines.map((l) => [l.item_id, l.qty])),
      rev: cart.rev,
      prefilled,
      minAmount: cfg.minAmount,
      last: last ? { no: last.no, at: last.created_at, total: last.total } : null,
      orders: O.ordersOf(db, store, 5).map((o) => ({ no: o.no, status: O.STATUS[o.status], total: o.total, at: o.created_at })),
    };
  }

  function isAdmin(req) {
    return tk.verify('admin', cookies(req).ts_admin) === 'a';
  }

  function adminData() {
    const orders = db.all(`SELECT o.*, s.name AS store_name, s.biz FROM orders o JOIN stores s ON s.id = o.store_id
                           ORDER BY o.id DESC LIMIT 200`);
    const lines = orders.length
      ? db.all(`SELECT * FROM order_lines WHERE order_id >= ? ORDER BY rowid`, [orders[orders.length - 1].id])
      : [];
    const byOrder = new Map();
    for (const l of lines) (byOrder.get(l.order_id) || byOrder.set(l.order_id, []).get(l.order_id)).push(l);
    // 출고 집계: 접수·확인 상태 주문의 품목별 합계
    const pick = db.all(`SELECT l.name, l.spec, l.unit, SUM(l.qty) AS qty, COUNT(DISTINCT o.id) AS stores
                         FROM order_lines l JOIN orders o ON o.id = l.order_id
                         WHERE o.status IN ('received','confirmed') GROUP BY l.item_id, l.name, l.spec, l.unit ORDER BY l.name`);
    return {
      orders: orders.map((o) => ({ ...o, status_label: O.STATUS[o.status], next: O.FLOW[o.status], lines: byOrder.get(o.id) || [] })),
      pick,
      requests: db.all(`SELECT a.*, s.name AS store_name, s.biz FROM access a JOIN stores s ON s.id = a.store_id
                        WHERE a.status = 'pending' ORDER BY a.requested_at`),
      stores: db.all(`SELECT s.*, (SELECT COUNT(*) FROM links l WHERE l.store_id = s.id) AS kakao,
                        (SELECT GROUP_CONCAT(category) FROM access a WHERE a.store_id = s.id AND a.status = 'approved') AS extra
                      FROM stores s WHERE s.active = 1 ORDER BY s.id`),
      items: db.all('SELECT * FROM items ORDER BY category, sort, id'),
      events: events.slice(-30),
      labels: { categories: O.CATEGORIES, biz: Object.fromEntries(Object.entries(O.BIZ).map(([k, v]) => [k, v.label])), status: O.STATUS },
    };
  }

  function saveItem(b) {
    const cat = String(b.category || '');
    if (!O.CATEGORIES[cat]) throw new O.UserError('분류를 골라 주세요');
    const name = String(b.name || '').trim();
    if (!name || name.length > 40) throw new O.UserError('품목 이름을 1~40자로 입력해 주세요');
    const price = Math.trunc(Number(b.price));
    if (!Number.isFinite(price) || price < 0 || price > 10_000_000) throw new O.UserError('가격을 확인해 주세요');
    const vals = [cat, String(b.grp || '기타').trim().slice(0, 20) || '기타', name, String(b.spec || '').trim().slice(0, 40),
      String(b.unit || '개').trim().slice(0, 4) || '개', price, Math.trunc(Number(b.sort) || 0)];
    if (b.id) {
      const r = db.run('UPDATE items SET category=?, grp=?, name=?, spec=?, unit=?, price=?, sort=? WHERE id=?', [...vals, Number(b.id)]);
      if (!r.changes) throw new O.UserError('품목을 찾을 수 없습니다');
    } else {
      db.run('INSERT INTO items (category, grp, name, spec, unit, price, sort) VALUES (?, ?, ?, ?, ?, ?, ?)', vals);
    }
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;

    if (m === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      return send(res, 200, fs.readFileSync(path.join(ROOT, file)), type);
    }
    if (m === 'GET' && p === '/') return send(res, 302, '', 'text/plain', { location: '/admin' });
    if (m === 'GET' && p === '/health') return send(res, 200, { ok: true });

    // ── 카카오 스킬 ──
    if (p === '/kakao/skill') {
      if (m !== 'POST') return send(res, 405, { error: 'POST only' });
      if (!cfg.skillKey || !safeEq(url.searchParams.get('key') || '', cfg.skillKey)) return send(res, 403, { error: 'forbidden' });
      const body = await readJson(req);
      const out = skill({ db, blockId: cfg.blockId, orderLink, minAmount: cfg.minAmount, guest: cfg.guest, ...hooks }, body);
      return send(res, 200, out);
    }

    // ── 점주 발주서 ──
    let mm = p.match(/^\/o\/([\w.-]{10,200})$/);
    if (mm && m === 'GET') {
      if (!storeFromToken(mm[1])) return send(res, 404, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/app.css"><p class="pad24">링크가 만료되었어요. 카카오톡 채널에서 [발주서 열기]를 다시 눌러 주세요.</p>', 'text/html; charset=utf-8');
      return send(res, 200, page('order'), 'text/html; charset=utf-8');
    }
    mm = p.match(/^\/api\/o\/([\w.-]{10,200})(?:\/(cart|submit|reorder|request))?$/);
    if (mm) {
      const store = storeFromToken(mm[1]);
      if (!store) return send(res, 404, { error: '링크가 만료되었어요. 카카오톡에서 다시 열어 주세요' });
      if (m !== 'GET' && req.headers['x-ts'] !== '1') return send(res, 403, { error: 'forbidden' });
      const act = mm[2];
      if (!act && m === 'GET') return send(res, 200, sheetView(store, url.searchParams.get('fresh') === '1'));
      const b = await readJson(req);
      if (act === 'cart' && m === 'PUT') { O.replaceCart(db, store, b.cart); return send(res, 200, sheetView(store)); }
      if (act === 'reorder' && m === 'POST') { O.reorder(db, store); return send(res, 200, sheetView(store)); }
      if (act === 'request' && m === 'POST') {
        const r = O.requestAccess(db, store, String(b.category || ''));
        if (r === 'requested') hooks.onAccess(store, b.category);
        return send(res, 200, sheetView(store));
      }
      if (act === 'submit' && m === 'POST') {
        const { order, duplicate } = O.submit(db, store, b.rev, { via: 'web', memo: b.memo, minAmount: cfg.minAmount });
        hooks.onOrder(order, duplicate);
        return send(res, 200, { no: order.no, total: order.total, duplicate, view: sheetView(store) });
      }
      return send(res, 404, { error: 'not found' });
    }

    // ── 관리자 ──
    if (p === '/admin/login') {
      if (m === 'GET') return send(res, 200, page('login'), 'text/html; charset=utf-8');
      if (m === 'POST') {
        const ip = req.socket.remoteAddress || '';
        const fails = (loginFails.get(ip) || []).filter((t) => Date.now() - t < 15 * 60e3);
        if (fails.length >= 10) return send(res, 429, { error: '잠시 후 다시 시도해 주세요' });
        const b = await readJson(req);
        if (!cfg.adminPassword || !safeEq(b.password || '', cfg.adminPassword)) {
          fails.push(Date.now());
          loginFails.set(ip, fails);
          return send(res, 401, { error: '비밀번호가 맞지 않습니다' });
        }
        const secure = cfg.publicUrl.startsWith('https:') ? '; Secure' : '';
        return send(res, 200, { ok: true }, undefined, {
          'set-cookie': `ts_admin=${tk.sign('admin', 'a', SESSION_TTL)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure}`,
        });
      }
    }
    if (p === '/admin/logout' && m === 'POST') {
      return send(res, 200, { ok: true }, undefined, { 'set-cookie': 'ts_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }
    if (p === '/admin' && m === 'GET') {
      if (!isAdmin(req)) return send(res, 302, '', 'text/plain', { location: '/admin/login' });
      return send(res, 200, page('admin'), 'text/html; charset=utf-8');
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: '다시 로그인해 주세요' });
      if (m !== 'GET' && req.headers['x-ts'] !== '1') return send(res, 403, { error: 'forbidden' });
      const sub = p.slice('/api/admin/'.length);
      if (sub === 'data' && m === 'GET') return send(res, 200, adminData());
      const b = m === 'GET' ? {} : await readJson(req);
      if (sub === 'status' && m === 'POST') O.setStatus(db, Number(b.id), String(b.status));
      else if (sub === 'access' && m === 'POST') O.decideAccess(db, Number(b.store_id), String(b.category), String(b.decision));
      else if (sub === 'stores' && m === 'POST') {
        const r = O.createStore(db, b);
        return send(res, 200, { ...r, link: orderLink(r.id) });
      } else if (sub === 'code' && m === 'POST') {
        if (!O.storeOf(db, Number(b.id))) throw new O.UserError('매장을 찾을 수 없습니다');
        return send(res, 200, { code: O.reissueCode(db, Number(b.id)) });
      } else if (sub === 'link' && m === 'POST') {
        if (!O.storeOf(db, Number(b.id))) throw new O.UserError('매장을 찾을 수 없습니다');
        return send(res, 200, { link: orderLink(Number(b.id)) });
      } else if (sub === 'items-bulk' && m === 'POST') {
        const r = O.importItems(db, b.text);
        return send(res, 200, { ...r, data: adminData() });
      } else if (sub === 'items' && m === 'POST') saveItem(b);
      else if (sub === 'item-active' && m === 'POST') db.run('UPDATE items SET active = ? WHERE id = ?', [b.active ? 1 : 0, Number(b.id)]);
      else return send(res, 404, { error: 'not found' });
      return send(res, 200, adminData());
    }

    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e instanceof O.UserError) return send(res, 400, { error: e.message });
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: '서버 오류가 났어요. 잠시 후 다시 시도해 주세요' });
    });
  });
  return { server, db, orderLink, tk };
}

if (require.main === module) {
  const cfg = config();
  if (!cfg.adminPassword) {
    cfg.adminPassword = crypto.randomBytes(6).toString('base64url');
    console.log(`⚠️  ADMIN_PASSWORD 가 없어 임시 비밀번호를 만들었습니다: ${cfg.adminPassword}`);
  }
  if (!cfg.skillKey) console.log('⚠️  SKILL_KEY 가 없어 카카오 스킬(/kakao/skill)이 꺼져 있습니다.');
  if (!cfg.blockId) console.log('⚠️  BLOCK_ID 가 없어 챗봇 버튼이 "말하기" 방식으로 동작합니다.');
  const { server } = createApp(cfg);
  server.listen(cfg.port, () => {
    console.log(`투스타 발주 서버: http://localhost:${cfg.port}/admin`);
    if (cfg.skillKey) console.log(`카카오 스킬 URL: ${cfg.publicUrl}/kakao/skill?key=${cfg.skillKey}`);
  });
}

module.exports = { createApp, config };
