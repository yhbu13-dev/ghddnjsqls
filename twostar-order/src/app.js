'use strict';
// 투스타 발주 — 요청 처리 (웹 표준 Request → Response)
// 내 컴퓨터 서버(src/server.js)와 Cloudflare Workers(src/worker.mjs)가 이 코드를 그대로 쓴다.
//   /kakao/skill?key=…   카카오 오픈빌더 스킬 (점주 카톡 발주)
//   /o/<토큰>            점주 발주서 (전체 품목을 한 화면에서)
//   /admin               관리자 화면 (주문 · 출고 집계 · 품목 승인 · 매장 · 품목)

const crypto = require('node:crypto');
const O = require('./order');
const { skill } = require('./kakao');
const tokens = require('./tokens');
const images = require('./images');
const { migrate, metaValue } = require('./schema');
const { seed } = require('./sample');

// 발주서 링크: 홈 화면에 붙여 두고 오래 쓰도록 1년. 잃어버리면 관리자가 [링크 바꾸기]로 예전 링크를 모두 무효화
const LINK_TTL = 365 * 24 * 3600e3;
const SESSION_TTL = 12 * 3600e3;

const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// 화면 파일: 주소 → [public/ 안의 파일, 형식]
const FILES = {
  '/assets/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/assets/order.js': ['order.js', 'text/javascript; charset=utf-8'],
  '/assets/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
  '/assets/icon-192.png': ['icon-192.png', 'image/png'],
  '/assets/icon-512.png': ['icon-512.png', 'image/png'],
};
const PAGES = { order: 'order.html', admin: 'admin.html', login: 'login.html' };

function reply(status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = body instanceof Uint8Array || typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : data, { status, headers: { ...HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra } });
}
const json = (status, body, extra) => reply(status, body, undefined, extra);
const html = (status, body) => reply(status, body, 'text/html; charset=utf-8');
const redirect = (to) => reply(302, '', 'text/plain', { location: to });

async function readJson(request, limit = 256 * 1024) {
  const text = await request.text();
  if (Buffer.byteLength(text) > limit) throw new O.UserError('요청이 너무 큽니다');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new O.UserError('잘못된 요청입니다'); }
}

function cookies(request) {
  const out = {};
  for (const p of String(request.headers.get('cookie') || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}

function safeEq(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

const randomKey = (n) => () => crypto.randomBytes(n).toString('base64url');

/**
 * cfg: { publicUrl?, adminPassword, skillKey?, secret?, blockId, minAmount, guest, seedSample }
 *   publicUrl 이 없으면 요청 주소로, skillKey·secret 이 없으면 DB 에 만들어 둔 값으로.
 * assets(file) → 파일 내용 (Uint8Array | string) 또는 null
 */
function createHandler({ db, cfg, assets, log = console.log }) {
  let setup = null;
  // 처음 요청 때 한 번: 테이블 준비 · 샘플 · 비밀키/스킬 키
  const init = () => (setup ??= (async () => {
    await migrate(db);
    if (cfg.seedSample) await seed(db, (m) => log(`[샘플] ${m}`));
    const secret = cfg.secret || await metaValue(db, 'secret', randomKey(32));
    const skillKey = cfg.skillKey || await metaValue(db, 'skill_key', randomKey(18));
    return { tk: tokens.make(secret), skillKey };
  })().catch((e) => { setup = null; throw e; }));

  async function route(request, info, S) {
    const url = new URL(request.url);
    const p = url.pathname;
    const m = request.method;
    const base = cfg.publicUrl || url.origin;
    const { tk } = S;
    // store = { id, link_ver } — 토큰에 '매장번호-링크버전'을 담는다
    const orderLink = (store) => `${base}/o/${tk.sign('o', `${store.id}-${store.link_ver || 0}`, LINK_TTL)}`;
    const skillUrl = `${base}/kakao/skill?key=${S.skillKey}`;
    const hooks = {
      async onOrder(order, dup) {
        if (dup) return;
        const s = await O.storeOf(db, order.store_id);
        await O.note(db, 'order', `새 주문 ${order.no} · ${s ? s.name : ''} · ${O.won(order.total)}`);
      },
      async onAccess(store, category) { await O.note(db, 'access', `품목 신청 · ${store.name} · ${O.CATEGORIES[category]}`); },
    };
    const file = async (name) => assets(name);
    const page = async (name) => html(200, await file(PAGES[name]));

    if (m === 'GET' && FILES[p]) {
      const [name, type] = FILES[p];
      const body = await file(name);
      return body == null ? json(404, { error: 'not found' }) : reply(200, body, type);
    }
    if (m === 'GET' && p === '/') return redirect('/admin');
    if (m === 'GET' && p === '/health') return json(200, { ok: true });
    if (m === 'GET' && p.startsWith('/img/')) {
      const img = await images.read(db, p.slice(5));
      return img ? reply(200, img.body, img.type, { 'cache-control': 'public, max-age=31536000, immutable' }) : reply(404, 'not found', 'text/plain');
    }

    // ── 카카오 스킬 ──
    if (p === '/kakao/skill') {
      if (m !== 'POST') return json(405, { error: 'POST only' });
      if (!safeEq(url.searchParams.get('key') || '', S.skillKey)) return json(403, { error: 'forbidden' });
      const body = await readJson(request).catch(() => ({}));
      // 한 줄 기록: 카톡에서 무엇을 눌렀는지 (사용자는 짧은 별칭으로만, 연결 코드는 가림)
      const who = crypto.createHash('sha256').update(String(body?.userRequest?.user?.id || '')).digest('hex').slice(0, 6);
      const ex = body?.action?.clientExtra || {};
      const what = ex.s ? `버튼 ${ex.s}` : `입력 "${String(body?.userRequest?.utterance || '').slice(0, 20).replace(/\d{6}/, '******')}"`;
      log(`[카톡 ${new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}] 사용자 ${who} · ${what}`);
      let out;
      try {
        out = await skill({ db, blockId: cfg.blockId, orderLink, minAmount: cfg.minAmount, guest: cfg.guest, ...hooks }, body);
      } catch (e) {
        // 어떤 오류가 나도 카카오에는 규격에 맞는 답을 보낸다 (500을 보내면 '스킬 응답 오류'로 끝남)
        console.error(`[카톡 오류] ${what}:`, e);
        out = { version: '2.0', template: { outputs: [{ simpleText: { text: '⚠️ 잠시 문제가 생겼어요. [처음으로]를 눌러 다시 시도해 주세요.' } }],
          quickReplies: cfg.blockId ? [{ label: '처음으로', action: 'block', blockId: cfg.blockId, messageText: '처음으로', extra: { s: 'home' } }] : [] } };
      }
      return json(200, out);
    }

    // ── 점주 발주서 ──
    const storeFromToken = async (token) => {
      const v = tk.verify('o', token);
      const m2 = /^(\d+)(?:-(\d+))?$/.exec(v || '');
      if (!m2) return null;
      const store = await O.storeOf(db, Number(m2[1]));
      return store && (store.link_ver || 0) === Number(m2[2] || 0) ? store : null;
    };
    let mm = p.match(/^\/o\/([\w.-]{10,200})$/);
    if (mm && m === 'GET') {
      if (!(await storeFromToken(mm[1]))) return reply(404, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/app.css"><p class="pad24">사용할 수 없는 발주서 링크예요. 카카오톡 채널의 [발주서 링크]나 담당자에게 새 링크를 받아 주세요.</p>', 'text/html; charset=utf-8');
      const raw = await file(PAGES.order);
      const tpl = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      return html(200, tpl.replaceAll('{{TOKEN}}', mm[1])); // 토큰은 [\w.-] 만 허용되어 그대로 넣어도 안전
    }
    // 홈 화면에 추가할 때 앱 이름·아이콘·시작 주소
    mm = p.match(/^\/o\/([\w.-]{10,200})\/manifest\.webmanifest$/);
    if (mm && m === 'GET') {
      const store = await storeFromToken(mm[1]);
      if (!store) return json(404, { error: 'not found' });
      return reply(200, JSON.stringify({
        name: `투스타 발주 · ${store.name}`, short_name: '투스타 발주', start_url: `/o/${mm[1]}`, scope: `/o/${mm[1]}`,
        display: 'standalone', background_color: '#f4f5f7', theme_color: '#fee500',
        icons: [{ src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' }],
      }), 'application/manifest+json; charset=utf-8');
    }
    mm = p.match(/^\/api\/o\/([\w.-]{10,200})(?:\/(cart|submit|reorder|request))?$/);
    if (mm) {
      const store = await storeFromToken(mm[1]);
      if (!store) return json(404, { error: '링크가 만료되었어요. 카카오톡에서 다시 열어 주세요' });
      if (m !== 'GET' && request.headers.get('x-ts') !== '1') return json(403, { error: 'forbidden' });
      const act = mm[2];
      if (!act && m === 'GET') return json(200, await sheetView(store, url.searchParams.get('fresh') === '1'));
      const b = await readJson(request);
      if (act === 'cart' && m === 'PUT') { await O.replaceCart(db, store, b.cart); return json(200, await sheetView(store)); }
      if (act === 'reorder' && m === 'POST') { await O.reorder(db, store); return json(200, await sheetView(store)); }
      if (act === 'request' && m === 'POST') {
        const r = await O.requestAccess(db, store, String(b.category || ''));
        if (r === 'requested') await hooks.onAccess(store, b.category);
        return json(200, await sheetView(store));
      }
      if (act === 'submit' && m === 'POST') {
        const { order, duplicate } = await O.submit(db, store, b.rev, { via: 'web', memo: b.memo, minAmount: cfg.minAmount });
        await hooks.onOrder(order, duplicate);
        return json(200, { no: order.no, total: order.total, duplicate, view: await sheetView(store) });
      }
      return json(404, { error: 'not found' });
    }

    // ── 관리자 ──
    const isAdmin = () => tk.verify('admin', cookies(request).ts_admin) === 'a';
    if (p === '/admin/login') {
      if (m === 'GET') return page('login');
      if (m === 'POST') {
        const key = `login:${info.ip || 'unknown'}`;
        if ((await db.get('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?', [key, Date.now() - 15 * 60e3])).n >= 10) {
          return json(429, { error: '잠시 후 다시 시도해 주세요' });
        }
        const b = await readJson(request);
        if (!cfg.adminPassword || !safeEq(b.password || '', cfg.adminPassword)) {
          await O.limited(db, key, 10, 15 * 60e3);
          return json(401, { error: '비밀번호가 맞지 않습니다' });
        }
        await O.clearAttempts(db, key);
        const secure = base.startsWith('https:') ? '; Secure' : '';
        return json(200, { ok: true }, {
          'set-cookie': `ts_admin=${tk.sign('admin', 'a', SESSION_TTL)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure}`,
        });
      }
    }
    if (p === '/admin/logout' && m === 'POST') {
      return json(200, { ok: true }, { 'set-cookie': 'ts_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }
    if (p === '/admin' && m === 'GET') {
      if (!isAdmin()) return redirect('/admin/login');
      return page('admin');
    }
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin()) return json(401, { error: '다시 로그인해 주세요' });
      if (m !== 'GET' && request.headers.get('x-ts') !== '1') return json(403, { error: 'forbidden' });
      const sub = p.slice('/api/admin/'.length);
      const data = async () => adminData(skillUrl);
      if (sub === 'data' && m === 'GET') return json(200, await data());
      const b = m === 'GET' ? {} : await readJson(request, sub === 'item-image' ? 3 * 1024 * 1024 : undefined);
      if (sub === 'status' && m === 'POST') await O.setStatus(db, Number(b.id), String(b.status));
      else if (sub === 'access' && m === 'POST') await O.decideAccess(db, Number(b.store_id), String(b.category), String(b.decision));
      else if (sub === 'stores' && m === 'POST') {
        const r = await O.createStore(db, b);
        return json(200, { ...r, link: orderLink({ id: r.id, link_ver: 0 }) });
      } else if (sub === 'code' && m === 'POST') {
        if (!(await O.storeOf(db, Number(b.id)))) throw new O.UserError('매장을 찾을 수 없습니다');
        return json(200, { code: await O.reissueCode(db, Number(b.id)) });
      } else if (sub === 'link' && m === 'POST') {
        const s = await O.storeOf(db, Number(b.id));
        if (!s) throw new O.UserError('매장을 찾을 수 없습니다');
        return json(200, { link: orderLink(s) });
      } else if (sub === 'link-reset' && m === 'POST') {
        // 링크 바꾸기: 버전을 올려 지금까지 나간 발주서 링크(홈 화면 아이콘 포함)를 모두 무효화
        await db.run('UPDATE stores SET link_ver = link_ver + 1 WHERE id = ? AND active = 1', [Number(b.id)]);
        const s = await O.storeOf(db, Number(b.id));
        if (!s) throw new O.UserError('매장을 찾을 수 없습니다');
        return json(200, { link: orderLink(s) });
      } else if (sub === 'items-bulk' && m === 'POST') {
        const r = await O.importItems(db, b.text);
        return json(200, { ...r, data: await data() });
      } else if (sub === 'items' && m === 'POST') await saveItem(b);
      else if (sub === 'item-image' && m === 'POST') {
        const it = await db.get('SELECT id, image FROM items WHERE id = ?', [Number(b.id)]);
        if (!it) throw new O.UserError('품목을 찾을 수 없습니다');
        const name = b.remove ? '' : await images.save(db, it.id, b.data);
        await db.run('UPDATE items SET image = ? WHERE id = ?', [name, it.id]);
        await images.remove(db, it.image);
      } else if (sub === 'store-hide' && m === 'POST') {
        // 매장 숨기기: 주문 기록은 남기고 목록·카톡 연결에서만 뺀다
        const r = await db.run('UPDATE stores SET active = 0, code = NULL WHERE id = ? AND active = 1', [Number(b.id)]);
        if (!r.changes) throw new O.UserError('매장을 찾을 수 없습니다');
      } else if ((sub === 'item-delete' || sub === 'items-delete-inactive') && m === 'POST') {
        const r = await O.deleteItems(db, sub === 'item-delete' ? [Number(b.id)] : null);
        if (sub === 'item-delete' && !r.deleted) throw new O.UserError('품목을 찾을 수 없습니다');
        for (const name of r.images) await images.remove(db, name);
        return json(200, { deleted: r.deleted, data: await data() });
      } else if (sub === 'item-active' && m === 'POST') await db.run('UPDATE items SET active = ? WHERE id = ?', [b.active ? 1 : 0, Number(b.id)]);
      else return json(404, { error: 'not found' });
      return json(200, await data());
    }

    return json(404, { error: 'not found' });
  }

  async function sheetView(store, prefill = false) {
    let cart = await O.cartOf(db, store);
    let prefilled = false;
    // 사우나: 품목이 많아 매번 지난 발주를 채운 발주서로 시작 (빈 장바구니일 때만)
    if (prefill && store.biz === 'sauna' && !cart.count && (await O.lastOrder(db, store))) {
      await O.reorder(db, store);
      cart = await O.cartOf(db, store);
      prefilled = cart.count > 0;
    }
    const last = await O.lastOrder(db, store);
    const lastQty = {};
    if (last) for (const l of last.lines) lastQty[l.item_id] = l.qty;
    const cats = await O.categoriesOf(db, store);
    const items = (await O.itemsFor(db, store, null, cats)).map((i) => ({
      id: i.id, category: i.category, grp: i.grp, name: i.name, spec: i.spec, unit: i.unit, price: i.price, image: i.image, last: lastQty[i.id] || 0,
    }));
    return {
      store: { name: store.name, biz: O.BIZ[store.biz].label },
      categories: cats.map((c) => ({ id: c, label: O.CATEGORIES[c] })),
      access: await O.accessStates(db, store),
      items,
      cart: Object.fromEntries(cart.lines.map((l) => [l.item_id, l.qty])),
      rev: cart.rev,
      prefilled,
      minAmount: cfg.minAmount,
      last: last ? { no: last.no, at: last.created_at, total: last.total } : null,
      orders: (await O.ordersOf(db, store, 5)).map((o) => ({ no: o.no, status: O.STATUS[o.status], total: o.total, at: o.created_at })),
    };
  }

  async function adminData(skillUrl) {
    const orders = await db.all(`SELECT o.*, s.name AS store_name, s.biz FROM orders o JOIN stores s ON s.id = o.store_id
                                 ORDER BY o.id DESC LIMIT 200`);
    const lines = orders.length
      ? await db.all('SELECT * FROM order_lines WHERE order_id >= ? ORDER BY rowid', [orders[orders.length - 1].id])
      : [];
    const byOrder = new Map();
    for (const l of lines) (byOrder.get(l.order_id) || byOrder.set(l.order_id, []).get(l.order_id)).push(l);
    return {
      orders: orders.map((o) => ({ ...o, status_label: O.STATUS[o.status], next: O.FLOW[o.status], lines: byOrder.get(o.id) || [] })),
      // 출고 집계: 접수·확인 상태 주문의 품목별 합계
      pick: await db.all(`SELECT l.name, l.spec, l.unit, SUM(l.qty) AS qty, COUNT(DISTINCT o.id) AS stores
                          FROM order_lines l JOIN orders o ON o.id = l.order_id
                          WHERE o.status IN ('received','confirmed') GROUP BY l.item_id, l.name, l.spec, l.unit ORDER BY l.name`),
      requests: await db.all(`SELECT a.*, s.name AS store_name, s.biz FROM access a JOIN stores s ON s.id = a.store_id
                              WHERE a.status = 'pending' AND s.active = 1 ORDER BY a.requested_at`),
      stores: await db.all(`SELECT s.*, (SELECT COUNT(*) FROM user_stores l WHERE l.store_id = s.id) AS kakao,
                              (SELECT GROUP_CONCAT(category) FROM access a WHERE a.store_id = s.id AND a.status = 'approved') AS extra
                            FROM stores s WHERE s.active = 1 ORDER BY s.id`),
      items: await db.all('SELECT * FROM items ORDER BY category, sort, id'),
      events: (await db.all('SELECT at, kind, text FROM events ORDER BY id DESC LIMIT 30')).reverse(),
      skillUrl,
      labels: { categories: O.CATEGORIES, biz: Object.fromEntries(Object.entries(O.BIZ).map(([k, v]) => [k, v.label])), status: O.STATUS },
    };
  }

  async function saveItem(b) {
    const cat = String(b.category || '');
    if (!O.CATEGORIES[cat]) throw new O.UserError('분류를 골라 주세요');
    const name = String(b.name || '').trim();
    if (!name || name.length > 40) throw new O.UserError('품목 이름을 1~40자로 입력해 주세요');
    const price = Math.trunc(Number(b.price));
    if (!Number.isFinite(price) || price < 0 || price > 10_000_000) throw new O.UserError('가격을 확인해 주세요');
    const vals = [cat, String(b.grp || '기타').trim().slice(0, 20) || '기타', name, String(b.spec || '').trim().slice(0, 40),
      String(b.unit || '개').trim().slice(0, 4) || '개', price, Math.trunc(Number(b.sort) || 0)];
    if (b.id) {
      const r = await db.run('UPDATE items SET category=?, grp=?, name=?, spec=?, unit=?, price=?, sort=? WHERE id=?', [...vals, Number(b.id)]);
      if (!r.changes) throw new O.UserError('품목을 찾을 수 없습니다');
    } else {
      await db.run('INSERT INTO items (category, grp, name, spec, unit, price, sort) VALUES (?, ?, ?, ?, ?, ?, ?)', vals);
    }
  }

  /** info = { ip } (로그인 시도 횟수를 접속자별로 세기 위함) */
  async function handle(request, info = {}) {
    try {
      const S = await init();
      return await route(request, info, S);
    } catch (e) {
      if (e instanceof O.UserError) return json(400, { error: e.message });
      console.error(e);
      return json(500, { error: '서버 오류가 났어요. 잠시 후 다시 시도해 주세요' });
    }
  }
  handle.ready = init; // 테이블 준비가 끝나길 기다릴 때 (테스트·서버 시작 안내)
  return handle;
}

/** 스킬 URL 을 바깥(서버 시작 안내 등)에서 알고 싶을 때 */
async function skillKeyOf(db, cfg) {
  await migrate(db);
  return cfg.skillKey || metaValue(db, 'skill_key', randomKey(18));
}

module.exports = { createHandler, skillKeyOf, FILES, PAGES };
