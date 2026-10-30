'use strict';
// 지점 담당자 (공급사 직원). 점주가 발주하면 그 매장 담당자 카톡으로 발주 목록이 간다.
//   관리자 [매장] → 담당자 추가 → 연결 코드 8자리 → 담당자가 같은 카톡 채널 채팅창에 입력하면 연결
//   매장마다 담당자 한 명을 고른다 (한 담당자가 여러 매장 가능)

const crypto = require('node:crypto');
const O = require('./order');

async function newCode(db) {
  for (let i = 0; i < 30; i++) {
    const code = String(crypto.randomInt(0, 1e8)).padStart(8, '0');
    if (!(await db.get('SELECT 1 AS x FROM staff WHERE code = ?', [code]))) return code;
  }
  throw new Error('연결 코드를 만들지 못했습니다');
}

async function create(db, { name, phone = '' }, now = Date.now()) {
  name = String(name || '').trim();
  if (!name || name.length > 20) throw new O.UserError('담당자 이름을 1~20자로 입력해 주세요');
  const code = await newCode(db);
  const r = await db.run('INSERT INTO staff (name, phone, code, created_at) VALUES (?, ?, ?, ?)',
    [name, String(phone).trim().slice(0, 20), code, now]);
  return { id: r.lastRowId, code };
}

const get = async (db, id) => (await db.get('SELECT * FROM staff WHERE id = ?', [id])) || null;

async function reissue(db, id) {
  if (!(await get(db, id))) throw new O.UserError('담당자를 찾을 수 없습니다');
  const code = await newCode(db);
  await db.run('UPDATE staff SET code = ? WHERE id = ?', [code, id]);
  return code;
}

/** 담당자 카톡 연결 (코드는 한 번 쓰면 사라짐). 연결된 담당자 또는 null */
async function link(db, userKey, code, now = Date.now()) {
  const s = await db.get('SELECT * FROM staff WHERE code = ?', [code]);
  if (!s) return null;
  await db.run('UPDATE staff SET code = NULL, user_key = ?, linked_at = ? WHERE id = ? AND code = ?', [userKey, now, s.id, code]);
  return { ...s, user_key: userKey };
}

const byUser = async (db, userKey) => (userKey ? (await db.get('SELECT * FROM staff WHERE user_key = ?', [userKey])) || null : null);

async function unlink(db, id) {
  await db.run('UPDATE staff SET user_key = NULL, linked_at = NULL WHERE id = ?', [id]);
}

async function remove(db, id) {
  await db.batch([
    ['UPDATE stores SET staff_id = NULL WHERE staff_id = ?', [id]],
    ['DELETE FROM staff WHERE id = ?', [id]],
  ]);
}

/** 매장 담당자 지정 (staffId 가 없으면 해제) */
async function assign(db, storeId, staffId) {
  const sid = staffId ? Number(staffId) : null;
  if (sid && !(await get(db, sid))) throw new O.UserError('담당자를 찾을 수 없습니다');
  const r = await db.run('UPDATE stores SET staff_id = ? WHERE id = ?', [sid, storeId]);
  if (!r.changes) throw new O.UserError('매장을 찾을 수 없습니다');
}

async function list(db) {
  return db.all(`SELECT t.id, t.name, t.phone, t.code, t.linked_at, t.user_key IS NOT NULL AS linked,
                        (SELECT COUNT(*) FROM stores s WHERE s.staff_id = t.id AND s.active = 1) AS stores
                 FROM staff t ORDER BY t.id`);
}

/** 매장 담당자 (카톡 연결된 경우만) */
async function ofStore(db, storeId) {
  return (await db.get(`SELECT t.* FROM stores s JOIN staff t ON t.id = s.staff_id
                        WHERE s.id = ? AND t.user_key IS NOT NULL`, [storeId])) || null;
}

module.exports = { create, reissue, link, byUser, unlink, remove, assign, list, ofStore, get };
