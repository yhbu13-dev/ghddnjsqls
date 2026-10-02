'use strict';
// 실물 거래명세서: 관리자가 회사 프로그램에서 뽑은 명세서를 사진으로 올리면 점주가 발주 확인서·발주서·카톡에서 본다.

const { UserError } = require('./order');
const images = require('./images');

const MAX_PAGES = 5;

/** 명세서 올리기: images = data URL 목록 (1~5장). 새 명세서를 돌려준다 */
async function create(db, { storeId, orderId = null, title = '', images: pics = [] }, now = Date.now()) {
  const store = await db.get('SELECT id FROM stores WHERE id = ?', [storeId]);
  if (!store) throw new UserError('매장을 찾을 수 없습니다');
  if (orderId) {
    const o = await db.get('SELECT id FROM orders WHERE id = ? AND store_id = ?', [orderId, storeId]);
    if (!o) throw new UserError('이 매장의 주문이 아니에요');
  }
  if (!Array.isArray(pics) || !pics.length) throw new UserError('명세서 사진을 골라 주세요');
  if (pics.length > MAX_PAGES) throw new UserError(`명세서 사진은 한 번에 ${MAX_PAGES}장까지 올릴 수 있어요`);
  const r = await db.run('INSERT INTO statements (store_id, order_id, title, images, created_at) VALUES (?, ?, ?, ?, ?)',
    [storeId, orderId || null, String(title || '').trim().slice(0, 60), '', now]);
  const id = r.lastRowId;
  const names = [];
  try {
    for (let i = 0; i < pics.length; i++) names.push(await images.saveDoc(db, id, i, pics[i], now));
  } catch (e) {
    for (const n of names) await images.remove(db, n);
    await db.run('DELETE FROM statements WHERE id = ?', [id]);
    throw e;
  }
  await db.run('UPDATE statements SET images = ? WHERE id = ?', [names.join(','), id]);
  return get(db, id);
}

const shape = (s) => (s ? { ...s, images: s.images ? s.images.split(',') : [] } : null);

async function get(db, id) {
  return shape(await db.get('SELECT * FROM statements WHERE id = ?', [id]));
}

async function ofStore(db, storeId, limit = 50) {
  return (await db.all('SELECT * FROM statements WHERE store_id = ? ORDER BY id DESC LIMIT ?', [storeId, limit])).map(shape);
}

async function ofOrder(db, orderId) {
  return (await db.all('SELECT * FROM statements WHERE order_id = ? ORDER BY id', [orderId])).map(shape);
}

/** 주문 번호들 → { orderId: 명세서 수 } */
async function countByOrders(db, orderIds) {
  if (!orderIds.length) return {};
  const rows = await db.all(`SELECT order_id, COUNT(*) AS n FROM statements WHERE order_id IN (${orderIds.map(() => '?').join(',')}) GROUP BY order_id`, orderIds);
  return Object.fromEntries(rows.map((r) => [r.order_id, r.n]));
}

async function remove(db, id) {
  const s = await get(db, id);
  if (!s) throw new UserError('명세서를 찾을 수 없습니다');
  for (const n of s.images) await images.remove(db, n);
  await db.run('DELETE FROM statements WHERE id = ?', [id]);
  return s;
}

module.exports = { create, get, ofStore, ofOrder, countByOrders, remove, MAX_PAGES };
