'use strict';
// 카카오 연동
// 1) 카카오톡 채널 챗봇 (카카오 i 오픈빌더 스킬 서버) — 점주가 글자를 치지 않고 버튼만 눌러 발주
//    POST /api/kakao/skill?key=<스킬 키>  · 응답 형식: 오픈빌더 SkillResponse v2.0
// 2) 카카오 로그인 (Kakao Developers REST API) — 발주 화면 로그인 · 휴대폰 번호로 매장 자동 연결
//    GET /k/login → kauth.kakao.com 인가 → GET /k/callback
// 3) 매장 연결 — 운영자가 발급한 6자리 연결 코드로 카카오 계정(챗봇 사용자·로그인 사용자)을 매장에 묶는다.

const crypto = require('node:crypto');
const T = require('./time');
const tokens = require('./tokens');
const catalog = require('./engine/catalog');
const shop = require('./engine/shop');
const { logEvent } = require('./engine/events');

const won = shop.won;
const PAGE = 9; // 캐러셀 최대 10장 = 품목 9장 + [다음 품목]

// ── 매장 연결 ──────────────────────────────────────────────
const attempts = new Map(); // 연결 코드 대입 방지: key → [시각…]
function limited(key, now, max = 5, windowMs = 10 * 60e3) {
  const arr = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  attempts.set(key, arr);
  if (attempts.size > 5000) for (const k of attempts.keys()) { attempts.delete(k); if (attempts.size < 2500) break; }
  if (arr.length >= max) return true;
  arr.push(now);
  return false;
}

/** 새 연결 코드 (6자리 숫자, 한 번 쓰면 사라짐) */
function issueLinkCode(ctx, storeId) {
  const { db } = ctx;
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    if (db.get('SELECT 1 FROM stores WHERE link_code = ?', [code])) continue;
    db.run('UPDATE stores SET link_code = ? WHERE id = ?', [code, storeId]);
    return code;
  }
  throw new Error('연결 코드를 만들지 못했습니다. 다시 시도해 주세요');
}

function linkedStore(db, kind, userKey, now) {
  const l = db.get('SELECT * FROM kakao_links WHERE kind = ? AND user_key = ?', [kind, userKey]);
  if (!l) return null;
  const s = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [l.store_id]);
  if (s && now) db.run('UPDATE kakao_links SET last_seen_at = ? WHERE id = ?', [now, l.id]);
  return s || null;
}

function saveLink(db, storeId, kind, userKey, nickname, now) {
  db.run(`INSERT INTO kakao_links (store_id, kind, user_key, nickname, linked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (kind, user_key) DO UPDATE SET store_id = excluded.store_id, nickname = excluded.nickname, linked_at = excluded.linked_at`,
  [storeId, kind, String(userKey).slice(0, 128), String(nickname || '').slice(0, 40), now, now]);
}

/**
 * 연결 코드로 매장 연결. who = [{ kind, key, nickname }] (챗봇 사용자·로그인 사용자를 한 번에 묶을 수 있음)
 */
function linkByCode(ctx, code, who, rateKey, now = Date.now()) {
  const { db } = ctx;
  if (limited('code:' + rateKey, now)) throw new Error('시도 횟수가 많습니다. 10분 뒤 다시 시도해 주세요');
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) throw new Error('연결 코드 6자리를 입력해 주세요');
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE link_code = ? AND active = 1', [c]);
    if (!store) throw new Error('연결 코드가 올바르지 않습니다. BevFlow 운영팀에 확인해 주세요');
    for (const w of who) saveLink(db, store.id, w.kind, w.key, w.nickname, now);
    db.run('UPDATE stores SET link_code = NULL WHERE id = ?', [store.id]);
    logEvent(db, { t: now, kind: '카카오 연결', store_id: store.id, region_id: store.region_id, actor: 'owner', message: `${store.name} · 카카오 계정 연결 (${who.map((w) => (w.kind === 'chatbot' ? '채널 챗봇' : '카카오 로그인')).join('·')})` });
    return store;
  });
}

const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('82')) d = '0' + d.slice(2);
  return d;
};

/** 카카오 계정 휴대폰 번호와 사장님 연락처가 정확히 한 매장과 일치하면 그 매장 */
function storeByPhone(db, phone) {
  const want = normPhone(phone);
  if (want.length < 10) return null;
  const hit = db.all('SELECT * FROM stores WHERE active = 1 AND owner_phone != \'\'').filter((s) => normPhone(s.owner_phone) === want);
  return hit.length === 1 ? hit[0] : null;
}

// ── 오픈빌더 응답 조립 ─────────────────────────────────────────
function ui(ctx) {
  const blockId = ctx.R.kakao_block_id;
  const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  // 블록 버튼: 같은 스킬 블록으로 되돌아오며 extra로 다음 단계를 전달한다. 블록 ID가 없으면 말풍선 문구로 대신한다.
  const btn = (label, extra, text) => (blockId
    ? { label: cut(label, 14), action: 'block', blockId, extra, messageText: text || label }
    : { label: cut(label, 14), action: 'message', messageText: text || label });
  const link = (label, url) => ({ label: cut(label, 14), action: 'webLink', webLinkUrl: url });
  const qr = (label, extra, text) => btn(label, extra, text);
  const res = (outputs, quickReplies = []) => ({ version: '2.0', template: { outputs, quickReplies: quickReplies.slice(0, 10) } });
  const text = (t) => ({ simpleText: { text: cut(t, 1000) } });
  const card = (title, description, buttons = []) => ({ textCard: { title: cut(title, 50), description: cut(description, 400), buttons: buttons.slice(0, 3) } });
  const carousel = (cards) => ({ carousel: { type: 'textCard', items: cards.slice(0, 10).map((c) => c.textCard) } });
  const list = (header, items, buttons = []) => ({ listCard: { header: { title: cut(header, 40) }, items: items.slice(0, 5), buttons: buttons.slice(0, 2) } });
  return { btn, link, qr, res, text, card, carousel, list, chat: !!blockId };
}

// ── 스킬 처리 ──────────────────────────────────────────────
const UTTER = [
  [/장바구니|카트/, { s: 'cart' }],
  [/현황|내역|배송|언제/, { s: 'status' }],
  [/지난|똑같이|재주문|다시/, { s: 'reorder' }],
  [/신청|추가 품목|다른 품목/, { s: 'request' }],
  [/확정|주문하기|발주하기/, { s: 'confirm' }],
  [/카페|커피|원두/, { s: 'items', c: 'cafe' }],
  [/스낵|과자|간식/, { s: 'items', c: 'snack' }],
  [/음료|콜라|사이다/, { s: 'items', c: 'beverage' }],
];

function cartHash(c) {
  return crypto.createHash('sha256').update(c.lines.map((l) => l.sku + ':' + l.qty).join(',')).digest('base64url').slice(0, 10);
}

/**
 * 오픈빌더 스킬 요청 처리 → SkillResponse
 * @param body 오픈빌더가 보낸 JSON
 */
async function skill(ctx, body, now = Date.now()) {
  const { db, R } = ctx;
  const U = ui(ctx);
  const user = (body && body.userRequest && body.userRequest.user) || {};
  const userKey = String(user.id || '');
  if (!userKey) return U.res([U.text('사용자 정보를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')]);
  const utter = String((body.userRequest && body.userRequest.utterance) || '').trim();
  const rawExtra = (body.action && body.action.clientExtra) || {};
  let x = rawExtra && typeof rawExtra.s === 'string' ? rawExtra : null;

  let store = linkedStore(db, 'chatbot', userKey, now);
  // 채널이 카카오 앱과 연결돼 있으면 appUserId가 온다 → 카카오 로그인으로 연결된 매장을 그대로 쓴다
  const appUserId = user.properties && user.properties.appUserId ? String(user.properties.appUserId) : '';
  if (!store && appUserId) {
    const viaLogin = linkedStore(db, 'login', appUserId, now);
    if (viaLogin) { saveLink(db, viaLogin.id, 'chatbot', userKey, '', now); store = viaLogin; }
  }
  if (!store) {
    // 채팅창에 연결 코드 6자리만 보내도 연결된다
    if (/^\d{6}$/.test(utter.replace(/\s/g, ''))) {
      try {
        store = linkByCode(ctx, utter, [{ kind: 'chatbot', key: userKey }], 'bot:' + userKey, now);
        return home(ctx, U, store, now, `✅ ${store.name} 매장과 연결됐어요. 이제 버튼만 눌러 발주하세요.`);
      } catch (e) { return U.res([U.text(e.message)]); }
    }
    const t = tokens.sign(ctx.secret, { k: 'kl', id: 0, u: userKey, e: now + 30 * 60e3 });
    return U.res([U.card('매장 연결이 필요해요', '처음 한 번만 매장을 연결하면 그다음부터는 버튼만 눌러 발주할 수 있어요.\n\n운영팀이 알려 드린 연결 코드 6자리를 이 채팅방에 보내거나, 아래 버튼을 눌러 주세요.',
      [U.link('매장 연결하기', `${R.public_base_url}/k/link?t=${encodeURIComponent(t)}`)])]);
  }

  if (!x) x = (UTTER.find(([re]) => re.test(utter)) || [null, { s: 'home' }])[1];
  try {
    return await step(ctx, U, store, x, userKey, now);
  } catch (e) {
    return U.res([U.text('⚠️ ' + e.message)], [U.qr('🛒 장바구니', { s: 'cart' }), U.qr('처음으로', { s: 'home' })]);
  }
}

function catLabel(c) { const k = catalog.CATEGORIES[c]; return k ? `${k.icon} ${k.short}` : c; }

/** 매대·소분류 목록 (발주 가능한 품목 기준, 정렬 순서대로) */
function groupsOf(ctx, store) {
  const seen = new Map();
  for (const k of shop.orderable(ctx.db, store.id)) if (k.grp && !seen.has(k.grp)) seen.set(k.grp, k.category);
  return [...seen.entries()].map(([g, c]) => ({ g, c }));
}

/** 발주서 방식 매장(사우나)의 첫 화면: 버튼 세 개만 */
function sheetHome(ctx, U, store, now, notice) {
  const { db, R } = ctx;
  const c = shop.cart(db, store.id);
  const base = shop.sheetBase(db, store);
  const d = shop.deliveryPreview(R, now);
  const today = store.sheet_at && store.sheet_at >= T.kstMidnight(now);
  const desc = (c.count ? `${base ? `지난번(${base.date.slice(5).replace('-', '/')}) 기준 ` : ''}${c.count}품목 · ${won(c.amount)}` : '아직 채워진 발주서가 없어요')
    + `\n${R.cutoff}까지 확정하면 ${d.word} 오후 도착`;
  const buttons = [U.link('📋 발주서 확인하기', shop.orderLink(ctx, store.id, now))];
  if (U.chat) buttons.push(U.btn('✅ 지난번 그대로 확정', { s: 'same' }, '지난번 그대로 확정'), U.btn('➕ 이것만 추가', { s: 'groups' }, '이것만 추가'));
  const out = notice ? [U.text(notice)] : [];
  out.push(U.card(today ? '📋 오늘 정기 발주서' : `📋 ${store.name} 발주서`, desc, buttons));
  return U.res(out, [U.qr('📦 발주 현황', { s: 'status' }, '발주 현황'), U.qr('➕ 품목 추가 신청', { s: 'request' }, '품목 추가 신청')]);
}

function home(ctx, U, store, now, notice) {
  const { db } = ctx;
  if (shop.sheetMode(store) && shop.lastOrder(db, store.id)) return sheetHome(ctx, U, store, now, notice);
  const cats = catalog.storeCategories(db, store).filter((c) => c.status === 'approved');
  const c = shop.cart(db, store.id);
  const d = shop.deliveryPreview(ctx.R, now);
  const desc = `이용 품목 ${cats.map((k) => k.icon + k.short).join(' · ')}\n지금 발주하면 ${d.word} 도착 (당일배송 ${d.cutoff} 마감)`
    + (c.count ? `\n\n🛒 장바구니 ${c.count}품목 · ${won(c.amount)}` : '');
  const buttons = [U.link('📋 한눈에 발주하기', shop.orderLink(ctx, store.id, now))];
  if (U.chat) buttons.push(U.btn('💬 채팅으로 고르기', { s: 'cats' }), U.btn('🔁 지난번과 똑같이', { s: 'reorder' }));
  const out = [];
  if (notice) out.push(U.text(notice));
  out.push(U.card(`${store.name} 발주`, desc, buttons));
  return U.res(out, [
    ...(c.count ? [U.qr(`🛒 장바구니 ${c.count}`, { s: 'cart' }, '장바구니')] : []),
    ...cats.map((k) => U.qr(`${k.icon} ${k.short}`, { s: 'items', c: k.id }, k.short + ' 품목')),
    U.qr('📦 발주 현황', { s: 'status' }, '발주 현황'),
    U.qr('➕ 품목 추가 신청', { s: 'request' }, '품목 추가 신청'),
  ]);
}

function cartOut(ctx, U, store, now, notice) {
  const c = shop.cart(ctx.db, store.id);
  const out = notice ? [U.text(notice)] : [];
  if (!c.count) {
    out.push(U.text('🛒 장바구니가 비어 있어요.'));
    return U.res(out, [U.qr('💬 품목 고르기', { s: 'cats' }), U.qr('🔁 지난번과 똑같이', { s: 'reorder' }), U.qr('처음으로', { s: 'home' })]);
  }
  const shown = c.lines.length > 5 ? c.lines.slice(0, 4) : c.lines;
  const items = shown.map((l) => ({ title: l.name, description: `${l.qty}${l.u} · ${won(l.qty * l.price)}`, ...(U.chat ? { action: 'block', blockId: ctx.R.kakao_block_id, extra: { s: 'item', k: l.sku }, messageText: l.name + ' 수량 변경' } : {}) }));
  if (c.lines.length > 5) items.push({ title: `외 ${c.lines.length - 4}품목`, description: '전체 보기는 발주 화면에서', action: 'webLink', webLinkUrl: shop.orderLink(ctx, store.id, now) });
  out.push(U.list(`🛒 장바구니 · ${c.count}품목 · ${won(c.amount)}`, items, [U.btn('✅ 발주하기', { s: 'confirm' }, '발주하기'), U.link('✏️ 화면에서 수정', shop.orderLink(ctx, store.id, now))]));
  return U.res(out, [U.qr('계속 고르기', { s: 'cats' }), U.qr('🗑 비우기', { s: 'clear' }, '장바구니 비우기'), U.qr('처음으로', { s: 'home' })]);
}

async function step(ctx, U, store, x, userKey, now) {
  const { db, R } = ctx;
  const approved = catalog.storeCategories(db, store).filter((c) => c.status === 'approved');
  switch (x.s) {
    case 'home': return home(ctx, U, store, now);
    case 'cats': {
      if (approved.length === 1) return step(ctx, U, store, { s: 'items', c: approved[0].id }, userKey, now);
      return U.res([U.text('어떤 품목을 발주할까요?')], approved.map((k) => U.qr(`${k.icon} ${k.short}`, { s: 'items', c: k.id }, k.short + ' 품목')));
    }
    case 'same': {
      if (!shop.cart(db, store.id).count) shop.prepareSheet(ctx, store.id, now);
      return step(ctx, U, store, { s: 'confirm' }, userKey, now);
    }
    case 'groups': {
      const gs = groupsOf(ctx, store);
      if (!gs.length) return step(ctx, U, store, { s: 'cats' }, userKey, now);
      return U.res([U.text('어느 매대 품목을 더할까요?')], gs.slice(0, 10).map(({ g, c }) => U.qr(g, { s: 'items', c, g }, g)));
    }
    case 'items': {
      const cat = String(x.c || '');
      if (!approved.some((k) => k.id === cat)) {
        return U.res([U.text(`${catLabel(cat)} 품목은 아직 이용 승인 전이에요. 신청하면 운영팀 확인 후 열어 드려요.`)], [U.qr('➕ 이용 신청', { s: 'req', c: cat }, catalog.CATEGORIES[cat] ? catalog.CATEGORIES[cat].short + ' 이용 신청' : '이용 신청'), U.qr('처음으로', { s: 'home' })]);
      }
      const view = shop.view(ctx, store, now);
      const inCart = new Map(view.cart.lines.map((l) => [l.sku, l.qty]));
      const grp = x.g ? String(x.g) : '';
      const all = view.products.filter((p) => p.category === cat && (!grp || p.grp === grp)).sort((a, b) => (b.freq - a.freq) || 0);
      const gs = groupsOf(ctx, store).filter((v) => v.c === cat);
      // 품목이 많고 매대·소분류가 있으면: 처음엔 자주 시키는 품목만, 나머지는 소분류 버튼으로
      const favOnly = !grp && gs.length > 1 && all.length > PAGE;
      const list = favOnly ? all.slice(0, PAGE) : all;
      if (!list.length) return U.res([U.text('지금 발주할 수 있는 품목이 없어요.')], [U.qr('처음으로', { s: 'home' })]);
      const page = Math.max(0, Number(x.p) || 0);
      const slice = list.slice(page * PAGE, page * PAGE + PAGE);
      const cards = slice.map((p) => {
        const q = inCart.get(p.id) || 0;
        return U.card(`${catalog.CATEGORIES[p.category].icon} ${p.name}`,
          `${p.spec || `${p.pack}${p.unit} / 박스`}\n${won(p.price)} / ${p.u}${q ? `\n🛒 담은 수량 ${q}${p.u}` : p.lastQty ? `\n지난번 ${p.lastQty}${p.u}` : ''}`,
          [U.btn('+1' + p.u, { s: 'add', k: p.id, q: 1, c: cat, g: grp || undefined }, `${p.name} 1${p.u} 담기`), U.btn('+5' + p.u, { s: 'add', k: p.id, q: 5, c: cat, g: grp || undefined }, `${p.name} 5${p.u} 담기`),
            q ? U.btn('−1' + p.u, { s: 'add', k: p.id, q: -1, c: cat, g: grp || undefined }, `${p.name} 1${p.u} 빼기`) : U.btn('+10' + p.u, { s: 'add', k: p.id, q: 10, c: cat, g: grp || undefined }, `${p.name} 10${p.u} 담기`)]);
      });
      if (favOnly) cards.push(U.card('다른 품목 찾기', `${catLabel(cat)} 품목은 모두 ${all.length}가지예요.\n아래 분류 버튼을 누르거나 발주 화면에서 한 번에 보세요.`, [U.link('📋 발주 화면에서 보기', shop.orderLink(ctx, store.id, now))]));
      else if (list.length > (page + 1) * PAGE) cards.push(U.card('다음 품목 보기', `${list.length - (page + 1) * PAGE}개 품목이 더 있어요`, [U.btn('다음 ▶', { s: 'items', c: cat, g: grp || undefined, p: page + 1 }, '다음 품목')]));
      const cartQr = U.qr(view.cart.count ? `🛒 장바구니 ${view.cart.count}` : '🛒 장바구니', { s: 'cart' }, '장바구니');
      if (gs.length > 1) {
        return U.res([U.text(grp ? `${grp} ${all.length}가지` : `⭐ 자주 시키는 ${catLabel(cat)} 품목이에요. 다른 품목은 분류 버튼으로 찾아 주세요.`), U.carousel(cards)],
          [cartQr, U.qr('✅ 발주하기', { s: 'confirm' }, '발주하기'), ...gs.filter((v) => v.g !== grp).slice(0, 8).map((v) => U.qr(v.g, { s: 'items', c: cat, g: v.g }, v.g))]);
      }
      return U.res([U.text(`${catLabel(cat)} 품목 — 버튼으로 담아 주세요`), U.carousel(cards)],
        [cartQr, U.qr('✅ 발주하기', { s: 'confirm' }, '발주하기'),
          ...approved.filter((k) => k.id !== cat).map((k) => U.qr(`${k.icon} ${k.short}`, { s: 'items', c: k.id }, k.short + ' 품목')), U.qr('처음으로', { s: 'home' })]);
    }
    case 'add': case 'set': {
      const sku = String(x.k || '');
      const c = x.s === 'set' ? shop.setCart(ctx, store.id, sku, Number(x.q) || 0, now) : shop.addCart(ctx, store.id, sku, Math.trunc(Number(x.q) || 0), now);
      const line = c.lines.find((l) => l.sku === sku);
      const name = line ? line.name : (db.get('SELECT name FROM skus WHERE id = ?', [sku]) || {}).name || sku;
      const msg = line ? `✓ ${name} ${line.qty}${line.u} 담았어요` : `✓ ${name}을(를) 뺐어요`;
      return U.res([U.text(`${msg}\n🛒 ${c.count}품목 · ${won(c.amount)}`)], [
        ...(x.c ? [U.qr('계속 고르기', { s: 'items', c: x.c, g: x.g })] : []),
        U.qr(`${name.slice(0, 6)} +1`, { s: 'add', k: sku, q: 1, c: x.c, g: x.g }, `${name} 하나 더`),
        U.qr('🛒 장바구니', { s: 'cart' }, '장바구니'), U.qr('✅ 발주하기', { s: 'confirm' }, '발주하기'),
      ]);
    }
    case 'item': {
      const c = shop.cart(db, store.id);
      const l = c.lines.find((v) => v.sku === x.k);
      if (!l) return cartOut(ctx, U, store, now);
      return U.res([U.card(l.name, `지금 ${l.qty}${l.u} · ${won(l.qty * l.price)}`, [U.btn('+1' + l.u, { s: 'add', k: l.sku, q: 1 }), U.btn('−1' + l.u, { s: 'add', k: l.sku, q: -1 }), U.btn('삭제', { s: 'set', k: l.sku, q: 0 }, l.name + ' 삭제')])],
        [U.qr('🛒 장바구니', { s: 'cart' }, '장바구니')]);
    }
    case 'cart': return cartOut(ctx, U, store, now);
    case 'clear': shop.clearCart(ctx, store.id); return cartOut(ctx, U, store, now, '장바구니를 비웠어요.');
    case 'reorder': {
      const r = shop.reorderToCart(ctx, store.id, now);
      return cartOut(ctx, U, store, now, `🔁 지난 발주(${r.from})와 같은 품목을 담았어요. 확인 후 [발주하기]를 눌러 주세요.`);
    }
    case 'confirm': {
      const c = shop.cart(db, store.id);
      if (!c.count) return cartOut(ctx, U, store, now);
      if (c.amount < R.order_min_amount) return cartOut(ctx, U, store, now, `최소 발주 금액은 ${won(R.order_min_amount)}이에요. ${won(R.order_min_amount - c.amount)}어치 더 담아 주세요.`);
      const d = shop.deliveryPreview(R, now);
      const lines = (c.lines.length > 8 ? c.lines.slice(0, 7) : c.lines).map((l) => `· ${l.name} ${l.qty}${l.u}`).join('\n') + (c.lines.length > 8 ? `\n· 외 ${c.lines.length - 7}품목` : '');
      const ref = 'chat-' + crypto.randomBytes(6).toString('base64url');
      return U.res([U.card('발주 내용을 확인해 주세요', `${lines}\n\n합계 ${won(c.amount)}${R.pay_method === 'invoice' ? ' (월말 청구)' : ''}\n${d.word} 도착 예정`,
        U.chat ? [U.btn('✅ 발주 확정', { s: 'submit', ref, h: cartHash(c) }, '발주 확정'), U.btn('✏️ 수정하기', { s: 'cart' }, '장바구니')] : [U.link('✅ 화면에서 확정', shop.orderLink(ctx, store.id, now))])]);
    }
    case 'submit': {
      const c = shop.cart(db, store.id);
      if (!c.count) {
        const done = x.ref ? db.get('SELECT * FROM proposals WHERE store_id = ? AND client_ref = ?', [store.id, String(x.ref)]) : null;
        if (done) return U.res([U.text(`이미 접수된 발주예요 (${done.code} · ${shop.statusText(done, now)}).`)], [U.qr('📦 발주 현황', { s: 'status' }, '발주 현황')]);
        return cartOut(ctx, U, store, now);
      }
      if (x.h !== cartHash(c)) return step(ctx, U, store, { s: 'confirm' }, userKey, now); // 확인 뒤 장바구니가 바뀌면 다시 확인
      const items = Object.fromEntries(c.lines.map((l) => [l.sku, l.qty]));
      const { proposal: p } = await shop.submit(ctx, store.id, { items, source: 'chat', ref: x.ref ? String(x.ref) : null }, now);
      const ok = p.status === 'paid';
      return U.res([U.card(ok ? `✅ 발주 완료 · ${p.code}` : `⚠️ 결제 확인 필요 · ${p.code}`,
        ok ? `${shop.statusText(p, now)}\n합계 ${won(p.amount)}${p.pay_method === 'invoice' ? ' (월말 청구)' : ''}\n\n배송 출발·도착도 카카오톡으로 알려 드릴게요.` : `${p.pay_fail_reason || '결제가 완료되지 않았어요'}\n운영팀이 곧 연락드릴게요.`,
        [U.link('발주 내역 보기', shop.orderLink(ctx, store.id, now))])], [U.qr('처음으로', { s: 'home' })]);
    }
    case 'status': {
      const list = shop.recentOrders(db, store.id, now, 5);
      if (!list.length) return U.res([U.text('아직 발주 내역이 없어요.')], [U.qr('💬 품목 고르기', { s: 'cats' }), U.qr('처음으로', { s: 'home' })]);
      return U.res([U.list('📦 최근 발주', list.map((o) => ({
        title: `${o.code} · ${o.statusText}`,
        description: `${o.lines.slice(0, 2).map((l) => `${l.name} ${l.qty}${l.u}`).join(', ')}${o.lines.length > 2 ? ` 외 ${o.lines.length - 2}` : ''} · ${won(o.amount)}`,
      })), [U.link('전체 보기', shop.orderLink(ctx, store.id, now))])], [U.qr('🔁 지난번과 똑같이', { s: 'reorder' }), U.qr('처음으로', { s: 'home' })]);
    }
    case 'request': {
      const cats = catalog.storeCategories(db, store).filter((c) => c.status !== 'approved');
      if (!cats.length) return U.res([U.text('모든 품목을 이용 중이에요.')], [U.qr('처음으로', { s: 'home' })]);
      const pend = cats.filter((c) => c.status === 'pending');
      return U.res([U.text('추가로 발주하고 싶은 품목을 골라 주세요. 운영팀이 확인 후 열어 드려요.' + (pend.length ? `\n\n⏳ 승인 대기: ${pend.map((c) => c.short).join(', ')}` : ''))],
        [...cats.filter((c) => c.status !== 'pending').map((c) => U.qr(`${c.icon} ${c.short} 신청`, { s: 'req', c: c.id }, `${c.short} 품목 이용 신청`)), U.qr('처음으로', { s: 'home' })]);
    }
    case 'req': {
      const r = catalog.requestAccess(ctx, store.id, String(x.c || ''), { via: 'chat' }, now);
      return U.res([U.text(r.already ? '이미 신청해 두셨어요. 승인되면 카카오톡으로 알려 드릴게요.' : `✅ ${catLabel(x.c)} 품목 이용을 신청했어요.\n운영팀이 확인하면 카카오톡으로 알려 드릴게요.`)], [U.qr('처음으로', { s: 'home' })]);
    }
    default: return home(ctx, U, store, now);
  }
}

function checkSkillKey(ctx, given) {
  const want = ctx.getSecret('kakao');
  const a = Buffer.from(String(given || '')), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── 카카오 로그인 ─────────────────────────────────────────────
const KAUTH = 'https://kauth.kakao.com';
const KAPI = 'https://kapi.kakao.com';
const redirectUri = (ctx) => ctx.R.public_base_url + '/k/callback';

/** 인가 요청 주소 + 로그인 CSRF 방지용 쿠키 값 */
function loginStart(ctx, botToken, now = Date.now()) {
  if (!ctx.R.kakao_rest_key) throw new Error('카카오 로그인이 설정되지 않았습니다');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const bot = botToken ? tokens.verify(ctx.secret, botToken, 'kl', now) : null;
  const state = tokens.sign(ctx.secret, { k: 'ks', id: 0, r: nonce, u: bot ? bot.u : '', e: now + 10 * 60e3 });
  const q = new URLSearchParams({ response_type: 'code', client_id: ctx.R.kakao_rest_key, redirect_uri: redirectUri(ctx), state });
  return { url: `${KAUTH}/oauth/authorize?${q}`, nonce };
}

/**
 * 인가 코드 → 토큰 → 사용자 정보 → 매장 찾기
 * @returns {{ store?, pendingToken? }} 매장을 못 찾으면 연결 코드 입력용 토큰
 */
/** 인가 코드 → 토큰 → 사용자 정보 */
async function exchange(ctx, code) {
  const { R } = ctx;
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: R.kakao_rest_key, redirect_uri: redirectUri(ctx), code });
  if (ctx.env.BEVFLOW_KAKAO_CLIENT_SECRET) form.set('client_secret', ctx.env.BEVFLOW_KAKAO_CLIENT_SECRET);
  const tr = await ctx.fetch(`${KAUTH}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form.toString(), signal: AbortSignal.timeout(8000) });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) throw new Error('카카오 로그인에 실패했어요 (' + (tj.error_description || tj.error || tr.status) + ')');
  const ur = await ctx.fetch(`${KAPI}/v2/user/me`, { headers: { authorization: 'Bearer ' + tj.access_token }, signal: AbortSignal.timeout(8000) });
  const me = await ur.json().catch(() => ({}));
  if (!ur.ok || me.id == null) throw new Error('카카오 사용자 정보를 받지 못했어요');
  return { tj, me };
}

/** 관리자 카톡 알림 연결 시작: 카카오톡 메시지 전송(talk_message) 동의를 받는다 */
function adminLoginStart(ctx, userId, now = Date.now()) {
  if (!ctx.R.kakao_rest_key) throw new Error('카카오 REST API 키를 먼저 운영 설정에 넣어 주세요');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const state = tokens.sign(ctx.secret, { k: 'ka', id: userId, r: nonce, e: now + 10 * 60e3 });
  const q = new URLSearchParams({ response_type: 'code', client_id: ctx.R.kakao_rest_key, redirect_uri: redirectUri(ctx), state, scope: 'talk_message' });
  return { url: `${KAUTH}/oauth/authorize?${q}`, nonce };
}

async function loginCallback(ctx, { code, state, cookieNonce, sessionUser = null }, now = Date.now()) {
  const { db } = ctx;
  const adm = tokens.verify(ctx.secret, state, 'ka', now);
  if (adm) {
    if (!cookieNonce || adm.r !== cookieNonce || !sessionUser || sessionUser.id !== adm.id) throw new Error('연결 요청이 만료됐어요. 콘솔에서 다시 시도해 주세요');
    if (!code) throw new Error('카카오 연결을 취소했어요');
    const { tj, me } = await exchange(ctx, code);
    const scopes = String(tj.scope || '').split(/[ ,]+/);
    if (tj.scope && !scopes.includes('talk_message')) throw new Error('카카오톡 메시지 전송에 동의해야 알림을 받을 수 있어요');
    const nick = (me.kakao_account && me.kakao_account.profile && me.kakao_account.profile.nickname) || (me.properties && me.properties.nickname) || '';
    db.run(`INSERT INTO admin_kakao (user_id, kakao_id, nickname, access_token, access_exp, refresh_token, refresh_exp, linked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET kakao_id = excluded.kakao_id, nickname = excluded.nickname, access_token = excluded.access_token, access_exp = excluded.access_exp,
              refresh_token = excluded.refresh_token, refresh_exp = excluded.refresh_exp, linked_at = excluded.linked_at, last_error = NULL`,
    [adm.id, String(me.id), nick.slice(0, 40), tj.access_token, now + (Number(tj.expires_in) || 21599) * 1000, tj.refresh_token || '', tj.refresh_token_expires_in ? now + Number(tj.refresh_token_expires_in) * 1000 : null, now]);
    logEvent(db, { t: now, kind: '카카오 연결', actor: sessionUser.email, message: '관리자 카톡 알림 연결' });
    return { admin: true };
  }
  const st = tokens.verify(ctx.secret, state, 'ks', now);
  if (!st || !cookieNonce || st.r !== cookieNonce) throw new Error('로그인 요청이 만료됐어요. 처음부터 다시 시도해 주세요');
  if (!code) throw new Error('카카오 로그인을 취소했어요');
  const { me } = await exchange(ctx, code);
  const kakaoId = String(me.id);
  const acct = me.kakao_account || {};
  const nickname = (acct.profile && acct.profile.nickname) || (me.properties && me.properties.nickname) || '';
  let store = linkedStore(db, 'login', kakaoId, now);
  if (!store && acct.phone_number) {
    store = storeByPhone(db, acct.phone_number);
    if (store) {
      saveLink(db, store.id, 'login', kakaoId, nickname, now);
      logEvent(db, { t: now, kind: '카카오 연결', store_id: store.id, region_id: store.region_id, actor: 'owner', message: `${store.name} · 카카오 로그인 (휴대폰 번호 일치로 자동 연결)` });
    }
  }
  if (store && st.u) saveLink(db, store.id, 'chatbot', st.u, nickname, now);
  if (store) return { store };
  return { pendingToken: tokens.sign(ctx.secret, { k: 'kk', id: 0, u: kakaoId, nk: nickname.slice(0, 20), b: st.u || '', e: now + 30 * 60e3 }) };
}

/** 연결 화면(/k/link)에서 코드 입력 → 연결 */
function linkFromPage(ctx, { t, l, code }, ip, now = Date.now()) {
  const who = [];
  const bot = t ? tokens.verify(ctx.secret, t, 'kl', now) : null;
  const login = l ? tokens.verify(ctx.secret, l, 'kk', now) : null;
  if (bot) who.push({ kind: 'chatbot', key: bot.u });
  if (login) {
    who.push({ kind: 'login', key: login.u, nickname: login.nk });
    if (login.b) who.push({ kind: 'chatbot', key: login.b });
  }
  if (!who.length) throw new Error('연결 링크가 만료됐어요. 카카오톡 채널에서 다시 시작해 주세요');
  const store = linkByCode(ctx, code, who, 'ip:' + ip, now);
  return { store: store.name, orderUrl: shop.orderLink(ctx, store.id, now) };
}

module.exports = { skill, checkSkillKey, issueLinkCode, linkByCode, linkFromPage, loginStart, adminLoginStart, loginCallback, storeByPhone, normPhone, _attempts: attempts };
