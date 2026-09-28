'use strict';
// 발주 규칙: 업종별 기본 품목 · 추가 품목 승인 · 장바구니 · 주문 접수
// 모든 함수는 비동기 (내 컴퓨터 SQLite 와 클라우드 D1 이 같은 코드를 쓴다).
// 여러 줄을 한꺼번에 바꿀 때는 db.batch 로 묶어 전부 성공하거나 전부 취소되게 한다.

const crypto = require('node:crypto');

const CATEGORIES = {
  cafe: '카페 품목',
  snack: '사우나 스낵',
  beverage: '식당 음료',
};
const BIZ = {
  cafe: { label: '카페', base: 'cafe' },
  sauna: { label: '사우나', base: 'snack' },
  restaurant: { label: '식당', base: 'beverage' },
};
const STATUS = {
  received: '접수',
  confirmed: '확인',
  shipped: '출고',
  done: '납품완료',
  canceled: '취소',
};

class UserError extends Error {}

const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;

// ── 시도 횟수 제한 (연결 코드 대입·로그인) ────────────────
/** key 로 windowMs 안에 max 번 넘게 시도했으면 true. 아니면 이번 시도를 기록하고 false */
async function limited(db, key, max, windowMs, now = Date.now()) {
  const n = (await db.get('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND at > ?', [key, now - windowMs])).n;
  if (n >= max) return true;
  await db.run('INSERT INTO attempts (key, at) VALUES (?, ?)', [key, now]);
  if (Math.random() < 0.05) await db.run('DELETE FROM attempts WHERE at < ?', [now - 24 * 3600e3]);
  return false;
}

async function clearAttempts(db, key) {
  await db.run('DELETE FROM attempts WHERE key = ?', [key]);
}

// ── 관리자 '새 소식' ─────────────────────────────────
async function note(db, kind, text, now = Date.now()) {
  await db.run('INSERT INTO events (at, kind, text) VALUES (?, ?, ?)', [now, kind, text]);
  if (Math.random() < 0.05) await db.run('DELETE FROM events WHERE id < (SELECT MAX(id) - 200 FROM events)');
}

// ── 매장 ─────────────────────────────────────────────
async function newCode(db) {
  for (let i = 0; i < 30; i++) {
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    if (!(await db.get('SELECT 1 AS x FROM stores WHERE code = ?', [code]))) return code;
  }
  throw new Error('연결 코드를 만들지 못했습니다');
}

async function createStore(db, { name, biz, owner = '', phone = '' }, now = Date.now()) {
  name = String(name || '').trim();
  if (!name || name.length > 40) throw new UserError('매장 이름을 1~40자로 입력해 주세요');
  if (!BIZ[biz]) throw new UserError('업종은 카페·사우나·식당 중에서 골라 주세요');
  const code = await newCode(db);
  const r = await db.run('INSERT INTO stores (name, biz, owner, phone, code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name, biz, String(owner).trim().slice(0, 20), String(phone).trim().slice(0, 20), code, now]);
  return { id: r.lastRowId, code };
}

async function reissueCode(db, storeId) {
  const code = await newCode(db);
  await db.run('UPDATE stores SET code = ? WHERE id = ?', [code, storeId]);
  return code;
}

async function storeOf(db, id) {
  return (await db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [id])) || null;
}

/** 이 카톡 사용자가 연결한 매장 목록 */
async function storesOfUser(db, userKey) {
  return db.all(`SELECT s.* FROM user_stores u JOIN stores s ON s.id = u.store_id
                 WHERE u.user_key = ? AND s.active = 1 ORDER BY u.linked_at`, [userKey]);
}

/** 연결된 매장 중 하나로 바꾸기. 연결 안 된 매장이면 null */
async function useStore(db, userKey, storeId, now = Date.now()) {
  const ok = await db.get(`SELECT s.* FROM user_stores u JOIN stores s ON s.id = u.store_id
                           WHERE u.user_key = ? AND u.store_id = ? AND s.active = 1`, [userKey, storeId]);
  if (!ok) return null;
  await db.run(`INSERT INTO links (user_key, store_id, linked_at) VALUES (?, ?, ?)
                ON CONFLICT (user_key) DO UPDATE SET store_id = excluded.store_id`, [userKey, storeId, now]);
  return ok;
}

async function storeByUser(db, userKey) {
  const l = await db.get('SELECT store_id FROM links WHERE user_key = ?', [userKey]);
  return l ? storeOf(db, l.store_id) : null;
}

/** 연결 코드로 카톡 사용자를 매장에 연결(추가)하고 그 매장으로 바꾼다. 코드는 한 번 쓰면 사라진다. */
async function linkUser(db, userKey, code, now = Date.now()) {
  const s = await db.get('SELECT * FROM stores WHERE code = ? AND active = 1', [code]);
  if (!s) return null;
  await db.batch([
    ['UPDATE stores SET code = NULL WHERE id = ? AND code = ?', [s.id, code]],
    [`INSERT INTO links (user_key, store_id, linked_at) VALUES (?, ?, ?)
      ON CONFLICT (user_key) DO UPDATE SET store_id = excluded.store_id, linked_at = excluded.linked_at`, [userKey, s.id, now]],
    [`INSERT INTO user_stores (user_key, store_id, linked_at) VALUES (?, ?, ?)
      ON CONFLICT (user_key, store_id) DO UPDATE SET linked_at = excluded.linked_at`, [userKey, s.id, now]],
  ]);
  return s;
}

// ── 품목 이용 권한 ───────────────────────────────────
/** 매장이 발주할 수 있는 분류: 업종 기본 분류 + 승인된 분류 */
async function categoriesOf(db, store) {
  const set = new Set([BIZ[store.biz].base]);
  for (const r of await db.all("SELECT category FROM access WHERE store_id = ? AND status = 'approved'", [store.id])) set.add(r.category);
  return Object.keys(CATEGORIES).filter((c) => set.has(c));
}

/** 분류별 상태: base / approved / pending / rejected / none */
async function accessStates(db, store) {
  const base = BIZ[store.biz].base;
  const rows = new Map((await db.all('SELECT category, status FROM access WHERE store_id = ?', [store.id])).map((r) => [r.category, r.status]));
  return Object.keys(CATEGORIES).map((c) => ({
    category: c,
    label: CATEGORIES[c],
    state: c === base ? 'base' : rows.get(c) || 'none',
  }));
}

async function requestAccess(db, store, category, now = Date.now()) {
  if (!CATEGORIES[category]) throw new UserError('없는 분류입니다');
  if (category === BIZ[store.biz].base) throw new UserError('이미 발주할 수 있는 품목입니다');
  const cur = await db.get('SELECT status FROM access WHERE store_id = ? AND category = ?', [store.id, category]);
  if (cur && cur.status === 'approved') throw new UserError('이미 승인된 품목입니다');
  if (cur && cur.status === 'pending') return 'pending';
  await db.run(`INSERT INTO access (store_id, category, status, requested_at) VALUES (?, ?, 'pending', ?)
                ON CONFLICT (store_id, category) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at, decided_at = NULL`,
  [store.id, category, now]);
  return 'requested';
}

/** 관리자 결정: approve / reject / revoke(승인 취소) */
async function decideAccess(db, storeId, category, decision, now = Date.now()) {
  const map = { approve: 'approved', reject: 'rejected', revoke: 'rejected' };
  if (!map[decision]) throw new UserError('잘못된 결정입니다');
  const store = await storeOf(db, storeId);
  if (!store) throw new UserError('매장을 찾을 수 없습니다');
  if (!CATEGORIES[category] || category === BIZ[store.biz].base) throw new UserError('바꿀 수 없는 분류입니다');
  const list = [[`INSERT INTO access (store_id, category, status, requested_at, decided_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT (store_id, category) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at`,
  [storeId, category, map[decision], now, now]]];
  // 승인이 풀리면 그 분류 품목은 장바구니에서 뺀다
  if (map[decision] !== 'approved') {
    list.push(['DELETE FROM cart WHERE store_id = ? AND item_id IN (SELECT id FROM items WHERE category = ?)', [storeId, category]]);
    list.push(bumpSql(storeId));
  }
  await db.batch(list);
}

// ── 품목 ─────────────────────────────────────────────
async function itemsFor(db, store, category, cats) {
  cats = cats || await categoriesOf(db, store);
  const list = category ? cats.filter((c) => c === category) : cats;
  if (!list.length) return [];
  return db.all(`SELECT * FROM items WHERE active = 1 AND category IN (${list.map(() => '?').join(',')})
                 ORDER BY category, sort, id`, list);
}

async function groupsFor(db, store, category) {
  const out = [];
  for (const it of await itemsFor(db, store, category)) {
    const g = out.find((x) => x.name === it.grp);
    if (g) g.count++;
    else out.push({ name: it.grp, count: 1 });
  }
  return out;
}

async function orderableItem(db, store, itemId, cats) {
  const it = await db.get('SELECT * FROM items WHERE id = ? AND active = 1', [itemId]);
  if (!it || !(cats || await categoriesOf(db, store)).includes(it.category)) return null;
  return it;
}

// ── 품목 한꺼번에 넣기 (엑셀에서 복사해 붙여넣기) ────────────
// 한 줄에 한 품목: 분류 | 묶음 | 품목명 | 규격 | 단위 | 단가  (엑셀 복사 = 탭 구분, 쉼표도 가능)
// 같은 분류에 같은 이름이 있으면 고치고, 없으면 새로 넣는다. 한 줄이라도 틀리면 아무것도 넣지 않는다.
const CAT_ALIAS = {
  cafe: 'cafe', '카페': 'cafe', '카페품목': 'cafe',
  snack: 'snack', '스낵': 'snack', '사우나': 'snack', '사우나스낵': 'snack',
  beverage: 'beverage', '음료': 'beverage', '식당': 'beverage', '식당음료': 'beverage',
};

function parseItems(text) {
  const rows = [];
  const errors = [];
  String(text || '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cols = (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim().replace(/^"|"$/g, ''));
    const [catRaw = '', grp = '', name = '', spec = '', unit = '', priceRaw = ''] = cols;
    const category = CAT_ALIAS[catRaw.replace(/\s/g, '').toLowerCase()];
    const price = Number(String(priceRaw).replace(/[,원\s]/g, ''));
    if (!category && i === 0 && !Number.isFinite(price)) return; // 제목 줄
    const n = i + 1;
    if (!category) return errors.push(`${n}번째 줄: 분류는 카페·스낵·음료 중 하나로 적어 주세요 ("${catRaw}")`);
    if (!name || name.length > 40) return errors.push(`${n}번째 줄: 품목명을 1~40자로 적어 주세요`);
    if (priceRaw === '' || !Number.isInteger(price) || price < 0 || price > 10_000_000) return errors.push(`${n}번째 줄: 단가가 숫자가 아닙니다 ("${priceRaw}")`);
    rows.push({ category, grp: grp.slice(0, 20) || '기타', name, spec: spec.slice(0, 40), unit: unit.slice(0, 4) || '개', price });
  });
  if (rows.length > 2000) errors.push('한 번에 2000줄까지 넣을 수 있어요');
  return { rows, errors };
}

async function importItems(db, text) {
  const { rows, errors } = parseItems(text);
  if (errors.length) return { added: 0, updated: 0, errors };
  if (!rows.length) return { added: 0, updated: 0, errors: ['붙여넣은 내용이 없어요'] };
  const existing = new Map((await db.all('SELECT id, category, name FROM items')).map((r) => [`${r.category}\u0000${r.name}`, r.id]));
  let sort = (await db.get('SELECT COALESCE(MAX(sort), 0) AS s FROM items')).s;
  let added = 0;
  let updated = 0;
  const list = [];
  for (const r of rows) {
    const key = `${r.category}\u0000${r.name}`;
    const id = existing.get(key);
    if (id) {
      list.push(['UPDATE items SET grp = ?, spec = ?, unit = ?, price = ?, active = 1 WHERE id = ?', [r.grp, r.spec, r.unit, r.price, id]]);
      updated++;
    } else {
      list.push(['INSERT INTO items (category, grp, name, spec, unit, price, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [r.category, r.grp, r.name, r.spec, r.unit, r.price, sort += 10]]);
      existing.set(key, -1); // 같은 붙여넣기 안에 같은 이름이 두 번 있으면 한 번만 추가
      added++;
    }
  }
  await db.batch(list);
  return { added, updated, errors: [] };
}

/**
 * 품목 삭제. 지난 주문은 이름·규격·가격을 따로 저장해 두어 영향 없음.
 * ids 가 없으면 판매 중지한 품목 전부. 지운 개수와 지울 사진 이름들을 돌려준다.
 */
async function deleteItems(db, ids) {
  const rows = ids
    ? await db.all(`SELECT id, image FROM items WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'})`, ids.map(Number))
    : await db.all('SELECT id, image FROM items WHERE active = 0');
  if (!rows.length) return { deleted: 0, images: [] };
  const idList = rows.map((r) => r.id);
  const qs = idList.map(() => '?').join(',');
  await db.batch([
    // 담아 둔 매장은 장바구니 버전을 올려 확인 중이던 주문이 옛 내용으로 접수되지 않게
    [`UPDATE stores SET cart_rev = cart_rev + 1 WHERE id IN (SELECT DISTINCT store_id FROM cart WHERE item_id IN (${qs}))`, idList],
    [`DELETE FROM cart WHERE item_id IN (${qs})`, idList],
    [`DELETE FROM items WHERE id IN (${qs})`, idList],
  ]);
  return { deleted: rows.length, images: rows.map((r) => r.image).filter(Boolean) };
}

// ── 장바구니 ─────────────────────────────────────────
const bumpSql = (storeId) => ['UPDATE stores SET cart_rev = cart_rev + 1 WHERE id = ?', [storeId]];

async function cartOf(db, store, cats) {
  const lines = await db.all(`SELECT c.item_id, c.qty, i.name, i.spec, i.unit, i.price, i.category, i.grp
                              FROM cart c JOIN items i ON i.id = c.item_id
                              WHERE c.store_id = ? AND i.active = 1 ORDER BY i.category, i.sort, i.id`, [store.id]);
  cats = cats || await categoriesOf(db, store);
  const ok = lines.filter((l) => cats.includes(l.category));
  const rev = (await db.get('SELECT cart_rev FROM stores WHERE id = ?', [store.id])).cart_rev;
  return {
    rev,
    lines: ok,
    count: ok.length,
    total: ok.reduce((s, l) => s + l.price * l.qty, 0),
  };
}

const MAX_QTY = 999;

async function setQty(db, store, itemId, qty) {
  qty = Math.trunc(Number(qty));
  if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) throw new UserError(`수량은 0~${MAX_QTY} 사이로 넣어 주세요`);
  if (!(await orderableItem(db, store, itemId))) throw new UserError('발주할 수 없는 품목입니다');
  await db.batch([
    qty === 0
      ? ['DELETE FROM cart WHERE store_id = ? AND item_id = ?', [store.id, itemId]]
      : [`INSERT INTO cart (store_id, item_id, qty) VALUES (?, ?, ?)
          ON CONFLICT (store_id, item_id) DO UPDATE SET qty = excluded.qty`, [store.id, itemId, qty]],
    bumpSql(store.id),
  ]);
  return qty;
}

async function addQty(db, store, itemId, n) {
  const cur = await db.get('SELECT qty FROM cart WHERE store_id = ? AND item_id = ?', [store.id, itemId]);
  return setQty(db, store, itemId, Math.min(MAX_QTY, Math.max(0, (cur ? cur.qty : 0) + n)));
}

/** 발주서 화면에서 한 번에 저장: { itemId: qty } 전체를 장바구니로 */
async function replaceCart(db, store, map) {
  const cats = await categoriesOf(db, store);
  const ok = new Map((await db.all('SELECT id, category FROM items WHERE active = 1')).map((r) => [r.id, r.category]));
  const list = [['DELETE FROM cart WHERE store_id = ?', [store.id]]];
  for (const [id, q] of Object.entries(map || {}).slice(0, 500)) {
    const qty = Math.trunc(Number(q));
    if (!qty) continue;
    if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) throw new UserError(`수량은 0~${MAX_QTY} 사이로 넣어 주세요`);
    const cat = ok.get(Number(id));
    if (!cat || !cats.includes(cat)) continue; // 판매 중지·미승인 품목은 조용히 제외
    list.push(['INSERT INTO cart (store_id, item_id, qty) VALUES (?, ?, ?)', [store.id, Number(id), qty]]);
  }
  list.push(bumpSql(store.id));
  await db.batch(list);
}

async function clearCart(db, store) {
  await db.batch([['DELETE FROM cart WHERE store_id = ?', [store.id]], bumpSql(store.id)]);
}

async function lastOrder(db, store) {
  const o = await db.get("SELECT * FROM orders WHERE store_id = ? AND status != 'canceled' ORDER BY id DESC LIMIT 1", [store.id]);
  if (!o) return null;
  o.lines = await db.all('SELECT * FROM order_lines WHERE order_id = ?', [o.id]);
  return o;
}

/** 지난 발주를 장바구니로 (지금 발주할 수 있는 품목만). 담긴 품목 수를 돌려줌 */
async function reorder(db, store) {
  const o = await lastOrder(db, store);
  if (!o) return 0;
  const map = {};
  for (const l of o.lines) map[l.item_id] = l.qty;
  await replaceCart(db, store, map);
  return (await db.get('SELECT COUNT(*) AS n FROM cart WHERE store_id = ?', [store.id])).n;
}

// ── 주문 ─────────────────────────────────────────────
function kstDay(ms) {
  const d = new Date(ms + 9 * 3600e3);
  return { mmdd: `${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`, start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 9 * 3600e3 };
}

/**
 * 장바구니를 주문으로. rev = 점주가 확인한 장바구니 버전.
 * 같은 버전을 두 번 보내면(버튼 두 번 누름·카카오 재시도) 처음 주문을 그대로 돌려준다.
 */
async function submit(db, store, rev, { via = 'chat', memo = '', minAmount = 0 } = {}, now = Date.now()) {
  rev = Number(rev);
  const ref = `${store.id}:${rev}`;
  const byRef = () => db.get('SELECT * FROM orders WHERE ref = ?', [ref]);
  const dup = await byRef();
  if (dup) return { order: dup, duplicate: true };
  const cart = await cartOf(db, store);
  if (cart.rev !== rev) throw new UserError('장바구니가 바뀌었어요. 다시 확인해 주세요');
  if (!cart.count) throw new UserError('장바구니가 비어 있어요');
  if (cart.total < minAmount) throw new UserError(`최소 발주 금액은 ${won(minAmount)}입니다 (현재 ${won(cart.total)})`);
  const day = kstDay(now);
  for (let attempt = 0; attempt < 5; attempt++) {
    const seq = (await db.get('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?', [day.start])).n + 1 + attempt;
    const no = `${day.mmdd}-${String(seq).padStart(3, '0')}`;
    try {
      await db.batch([
        [`INSERT INTO orders (no, store_id, status, total, via, ref, memo, created_at, updated_at)
          VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?)`, [no, store.id, cart.total, via, ref, String(memo || '').slice(0, 200), now, now]],
        ...cart.lines.map((l) => [`INSERT INTO order_lines (order_id, item_id, name, spec, unit, price, qty)
          SELECT id, ?, ?, ?, ?, ?, ? FROM orders WHERE ref = ?`, [l.item_id, l.name, l.spec, l.unit, l.price, l.qty, ref]]),
        ['DELETE FROM cart WHERE store_id = ?', [store.id]],
        bumpSql(store.id),
      ]);
      return { order: await byRef(), duplicate: false };
    } catch (e) {
      const msg = String(e && e.message);
      if (/orders\.ref/.test(msg)) return { order: await byRef(), duplicate: true }; // 같은 주문이 동시에 들어옴
      if (/orders\.no/.test(msg)) continue; // 주문번호가 겹침 → 다음 번호로
      throw e;
    }
  }
  throw new Error('주문번호를 만들지 못했습니다');
}

async function ordersOf(db, store, limit = 5) {
  return db.all('SELECT * FROM orders WHERE store_id = ? ORDER BY id DESC LIMIT ?', [store.id, limit]);
}

const FLOW = { received: ['confirmed', 'canceled'], confirmed: ['shipped', 'canceled'], shipped: ['done'], done: [], canceled: [] };

async function setStatus(db, orderId, status, now = Date.now()) {
  const o = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!o) throw new UserError('주문을 찾을 수 없습니다');
  if (!FLOW[o.status].includes(status)) throw new UserError(`${STATUS[o.status]} → ${STATUS[status] || status} 로 바꿀 수 없습니다`);
  const r = await db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?', [status, now, orderId, o.status]);
  if (!r.changes) throw new UserError('다른 곳에서 먼저 바뀌었어요. 새로고침해 주세요');
}

module.exports = {
  CATEGORIES, BIZ, STATUS, FLOW, MAX_QTY, UserError, won,
  limited, clearAttempts, note,
  createStore, reissueCode, storeOf, storeByUser, storesOfUser, useStore, linkUser,
  categoriesOf, accessStates, requestAccess, decideAccess,
  itemsFor, groupsFor, orderableItem, parseItems, importItems, deleteItems,
  cartOf, setQty, addQty, replaceCart, clearCart, lastOrder, reorder,
  submit, ordersOf, setStatus, kstDay,
};
