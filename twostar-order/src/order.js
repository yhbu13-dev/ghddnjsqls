'use strict';
// 발주 규칙: 업종별 기본 품목 · 추가 품목 승인 · 장바구니 · 주문 접수

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

// ── 매장 ─────────────────────────────────────────────
function newCode(db) {
  for (let i = 0; i < 30; i++) {
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    if (!db.get('SELECT 1 FROM stores WHERE code = ?', [code])) return code;
  }
  throw new Error('연결 코드를 만들지 못했습니다');
}

function createStore(db, { name, biz, owner = '', phone = '' }, now = Date.now()) {
  name = String(name || '').trim();
  if (!name || name.length > 40) throw new UserError('매장 이름을 1~40자로 입력해 주세요');
  if (!BIZ[biz]) throw new UserError('업종은 카페·사우나·식당 중에서 골라 주세요');
  const code = newCode(db);
  const r = db.run('INSERT INTO stores (name, biz, owner, phone, code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [name, biz, String(owner).trim().slice(0, 20), String(phone).trim().slice(0, 20), code, now]);
  return { id: Number(r.lastInsertRowid), code };
}

function reissueCode(db, storeId) {
  const code = newCode(db);
  db.run('UPDATE stores SET code = ? WHERE id = ?', [code, storeId]);
  return code;
}

function storeOf(db, id) {
  return db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [id]) || null;
}

function storeByUser(db, userKey) {
  const l = db.get('SELECT store_id FROM links WHERE user_key = ?', [userKey]);
  return l ? storeOf(db, l.store_id) : null;
}

/** 연결 코드로 카톡 사용자를 매장에 연결. 코드는 한 번 쓰면 사라진다. */
function linkUser(db, userKey, code, now = Date.now()) {
  return db.tx(() => {
    const s = db.get('SELECT * FROM stores WHERE code = ? AND active = 1', [code]);
    if (!s) return null;
    db.run(`INSERT INTO links (user_key, store_id, linked_at) VALUES (?, ?, ?)
            ON CONFLICT (user_key) DO UPDATE SET store_id = excluded.store_id, linked_at = excluded.linked_at`,
    [userKey, s.id, now]);
    db.run('UPDATE stores SET code = NULL WHERE id = ?', [s.id]);
    return s;
  });
}

// ── 품목 이용 권한 ───────────────────────────────────
/** 매장이 발주할 수 있는 분류: 업종 기본 분류 + 승인된 분류 */
function categoriesOf(db, store) {
  const set = new Set([BIZ[store.biz].base]);
  for (const r of db.all("SELECT category FROM access WHERE store_id = ? AND status = 'approved'", [store.id])) set.add(r.category);
  return Object.keys(CATEGORIES).filter((c) => set.has(c));
}

/** 분류별 상태: base / approved / pending / rejected / none */
function accessStates(db, store) {
  const base = BIZ[store.biz].base;
  const rows = new Map(db.all('SELECT category, status FROM access WHERE store_id = ?', [store.id]).map((r) => [r.category, r.status]));
  return Object.keys(CATEGORIES).map((c) => ({
    category: c,
    label: CATEGORIES[c],
    state: c === base ? 'base' : rows.get(c) || 'none',
  }));
}

function requestAccess(db, store, category, now = Date.now()) {
  if (!CATEGORIES[category]) throw new UserError('없는 분류입니다');
  if (category === BIZ[store.biz].base) throw new UserError('이미 발주할 수 있는 품목입니다');
  const cur = db.get('SELECT status FROM access WHERE store_id = ? AND category = ?', [store.id, category]);
  if (cur && cur.status === 'approved') throw new UserError('이미 승인된 품목입니다');
  if (cur && cur.status === 'pending') return 'pending';
  db.run(`INSERT INTO access (store_id, category, status, requested_at) VALUES (?, ?, 'pending', ?)
          ON CONFLICT (store_id, category) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at, decided_at = NULL`,
  [store.id, category, now]);
  return 'requested';
}

/** 관리자 결정: approve / reject / revoke(승인 취소) */
function decideAccess(db, storeId, category, decision, now = Date.now()) {
  const map = { approve: 'approved', reject: 'rejected', revoke: 'rejected' };
  if (!map[decision]) throw new UserError('잘못된 결정입니다');
  const store = storeOf(db, storeId);
  if (!store) throw new UserError('매장을 찾을 수 없습니다');
  if (!CATEGORIES[category] || category === BIZ[store.biz].base) throw new UserError('바꿀 수 없는 분류입니다');
  db.tx(() => {
    db.run(`INSERT INTO access (store_id, category, status, requested_at, decided_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (store_id, category) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at`,
    [storeId, category, map[decision], now, now]);
    // 승인이 풀리면 그 분류 품목은 장바구니에서 뺀다
    if (map[decision] !== 'approved') {
      const r = db.run('DELETE FROM cart WHERE store_id = ? AND item_id IN (SELECT id FROM items WHERE category = ?)', [storeId, category]);
      if (r.changes) bump(db, storeId);
    }
  });
}

// ── 품목 ─────────────────────────────────────────────
function itemsFor(db, store, category) {
  const cats = categoriesOf(db, store);
  const list = category ? cats.filter((c) => c === category) : cats;
  if (!list.length) return [];
  return db.all(`SELECT * FROM items WHERE active = 1 AND category IN (${list.map(() => '?').join(',')})
                 ORDER BY category, sort, id`, list);
}

function groupsFor(db, store, category) {
  const out = [];
  for (const it of itemsFor(db, store, category)) {
    const g = out.find((x) => x.name === it.grp);
    if (g) g.count++;
    else out.push({ name: it.grp, count: 1 });
  }
  return out;
}

function orderableItem(db, store, itemId) {
  const it = db.get('SELECT * FROM items WHERE id = ? AND active = 1', [itemId]);
  if (!it || !categoriesOf(db, store).includes(it.category)) return null;
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

function importItems(db, text) {
  const { rows, errors } = parseItems(text);
  if (errors.length) return { added: 0, updated: 0, errors };
  if (!rows.length) return { added: 0, updated: 0, errors: ['붙여넣은 내용이 없어요'] };
  let added = 0;
  let updated = 0;
  db.tx(() => {
    let sort = db.get('SELECT COALESCE(MAX(sort), 0) AS s FROM items').s;
    for (const r of rows) {
      const cur = db.get('SELECT id FROM items WHERE category = ? AND name = ?', [r.category, r.name]);
      if (cur) {
        db.run('UPDATE items SET grp = ?, spec = ?, unit = ?, price = ?, active = 1 WHERE id = ?', [r.grp, r.spec, r.unit, r.price, cur.id]);
        updated++;
      } else {
        db.run('INSERT INTO items (category, grp, name, spec, unit, price, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [r.category, r.grp, r.name, r.spec, r.unit, r.price, sort += 10]);
        added++;
      }
    }
  });
  return { added, updated, errors: [] };
}

// ── 장바구니 ─────────────────────────────────────────
function bump(db, storeId) {
  db.run('UPDATE stores SET cart_rev = cart_rev + 1 WHERE id = ?', [storeId]);
}

function cartOf(db, store) {
  const lines = db.all(`SELECT c.item_id, c.qty, i.name, i.spec, i.unit, i.price, i.category, i.grp
                        FROM cart c JOIN items i ON i.id = c.item_id
                        WHERE c.store_id = ? AND i.active = 1 ORDER BY i.category, i.sort, i.id`, [store.id]);
  const cats = categoriesOf(db, store);
  const ok = lines.filter((l) => cats.includes(l.category));
  const rev = db.get('SELECT cart_rev FROM stores WHERE id = ?', [store.id]).cart_rev;
  return {
    rev,
    lines: ok,
    count: ok.length,
    total: ok.reduce((s, l) => s + l.price * l.qty, 0),
  };
}

const MAX_QTY = 999;

function setQty(db, store, itemId, qty) {
  qty = Math.trunc(Number(qty));
  if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) throw new UserError(`수량은 0~${MAX_QTY} 사이로 넣어 주세요`);
  if (!orderableItem(db, store, itemId)) throw new UserError('발주할 수 없는 품목입니다');
  db.tx(() => {
    if (qty === 0) db.run('DELETE FROM cart WHERE store_id = ? AND item_id = ?', [store.id, itemId]);
    else db.run(`INSERT INTO cart (store_id, item_id, qty) VALUES (?, ?, ?)
                 ON CONFLICT (store_id, item_id) DO UPDATE SET qty = excluded.qty`, [store.id, itemId, qty]);
    bump(db, store.id);
  });
  return qty;
}

function addQty(db, store, itemId, n) {
  const cur = db.get('SELECT qty FROM cart WHERE store_id = ? AND item_id = ?', [store.id, itemId]);
  return setQty(db, store, itemId, Math.min(MAX_QTY, Math.max(0, (cur ? cur.qty : 0) + n)));
}

/** 발주서 화면에서 한 번에 저장: { itemId: qty } 전체를 장바구니로 */
function replaceCart(db, store, map) {
  const cats = categoriesOf(db, store);
  const entries = Object.entries(map || {}).slice(0, 500);
  db.tx(() => {
    db.run('DELETE FROM cart WHERE store_id = ?', [store.id]);
    for (const [id, q] of entries) {
      const qty = Math.trunc(Number(q));
      if (!qty) continue;
      if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) throw new UserError(`수량은 0~${MAX_QTY} 사이로 넣어 주세요`);
      const it = db.get('SELECT category FROM items WHERE id = ? AND active = 1', [Number(id)]);
      if (!it || !cats.includes(it.category)) continue; // 판매 중지·미승인 품목은 조용히 제외
      db.run('INSERT INTO cart (store_id, item_id, qty) VALUES (?, ?, ?)', [store.id, Number(id), qty]);
    }
    bump(db, store.id);
  });
}

function clearCart(db, store) {
  db.tx(() => {
    db.run('DELETE FROM cart WHERE store_id = ?', [store.id]);
    bump(db, store.id);
  });
}

function lastOrder(db, store) {
  const o = db.get("SELECT * FROM orders WHERE store_id = ? AND status != 'canceled' ORDER BY id DESC LIMIT 1", [store.id]);
  if (!o) return null;
  o.lines = db.all('SELECT * FROM order_lines WHERE order_id = ?', [o.id]);
  return o;
}

/** 지난 발주를 장바구니로 (지금 발주할 수 있는 품목만). 담긴 품목 수를 돌려줌 */
function reorder(db, store) {
  const o = lastOrder(db, store);
  if (!o) return 0;
  const map = {};
  for (const l of o.lines) if (orderableItem(db, store, l.item_id)) map[l.item_id] = l.qty;
  replaceCart(db, store, map);
  return Object.keys(map).length;
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
function submit(db, store, rev, { via = 'chat', memo = '', minAmount = 0 } = {}, now = Date.now()) {
  rev = Number(rev);
  const ref = `${store.id}:${rev}`;
  return db.tx(() => {
    const dup = db.get('SELECT * FROM orders WHERE ref = ?', [ref]);
    if (dup) return { order: dup, duplicate: true };
    const cart = cartOf(db, store);
    if (cart.rev !== rev) throw new UserError('장바구니가 바뀌었어요. 다시 확인해 주세요');
    if (!cart.count) throw new UserError('장바구니가 비어 있어요');
    if (cart.total < minAmount) throw new UserError(`최소 발주 금액은 ${won(minAmount)}입니다 (현재 ${won(cart.total)})`);
    const day = kstDay(now);
    const seq = db.get('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?', [day.start]).n + 1;
    const no = `${day.mmdd}-${String(seq).padStart(3, '0')}`;
    const r = db.run(`INSERT INTO orders (no, store_id, status, total, via, ref, memo, created_at, updated_at)
                      VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?)`,
    [no, store.id, cart.total, via, ref, String(memo).slice(0, 200), now, now]);
    const id = Number(r.lastInsertRowid);
    for (const l of cart.lines) {
      db.run('INSERT INTO order_lines (order_id, item_id, name, spec, unit, price, qty) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, l.item_id, l.name, l.spec, l.unit, l.price, l.qty]);
    }
    db.run('DELETE FROM cart WHERE store_id = ?', [store.id]);
    bump(db, store.id);
    return { order: db.get('SELECT * FROM orders WHERE id = ?', [id]), duplicate: false };
  });
}

function ordersOf(db, store, limit = 5) {
  return db.all('SELECT * FROM orders WHERE store_id = ? ORDER BY id DESC LIMIT ?', [store.id, limit]);
}

const FLOW = { received: ['confirmed', 'canceled'], confirmed: ['shipped', 'canceled'], shipped: ['done'], done: [], canceled: [] };

function setStatus(db, orderId, status, now = Date.now()) {
  const o = db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!o) throw new UserError('주문을 찾을 수 없습니다');
  if (!FLOW[o.status].includes(status)) throw new UserError(`${STATUS[o.status]} → ${STATUS[status] || status} 로 바꿀 수 없습니다`);
  db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', [status, now, orderId]);
}

module.exports = {
  CATEGORIES, BIZ, STATUS, FLOW, MAX_QTY, UserError, won,
  createStore, reissueCode, storeOf, storeByUser, linkUser,
  categoriesOf, accessStates, requestAccess, decideAccess,
  itemsFor, groupsFor, orderableItem, parseItems, importItems,
  cartOf, setQty, addQty, replaceCart, clearCart, lastOrder, reorder,
  submit, ordersOf, setStatus, kstDay,
};
