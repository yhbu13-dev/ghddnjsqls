'use strict';
// 품목 사진: 관리자 화면에서 600×600 JPEG로 줄여 올리면 DB(images 테이블)에 저장.
// 내 컴퓨터든 클라우드든 파일 저장소 없이 DB 하나로 끝난다. 관리자 품목 목록과 점주 발주서에 쓰인다.

const crypto = require('node:crypto');
const { UserError } = require('./order');

const MAX_BYTES = 2 * 1024 * 1024;
const NAME = /^\d{1,9}-[0-9a-f]{8}\.(jpg|png|webp)$/;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** data URL(base64)을 확인해 저장하고 사진 이름을 돌려줌 */
async function save(db, itemId, dataUrl, now = Date.now()) {
  const m = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new UserError('사진 파일을 읽지 못했어요');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new UserError('사진이 너무 큽니다 (2MB 이하)');
  const ext = sniff(buf);
  if (!ext) throw new UserError('JPG·PNG·WEBP 사진만 올릴 수 있어요');
  const name = `${Number(itemId)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await db.run('INSERT INTO images (name, type, data, created_at) VALUES (?, ?, ?, ?)', [name, TYPES[ext], buf.toString('base64'), now]);
  return name;
}

// ── 실물 명세서 사진: 이름이 품목 사진과 달라 /img/ 로는 열리지 않는다 (명세서 링크로만) ──
const DOC_NAME = /^s\d{1,9}-\d{1,2}-[0-9a-f]{16}\.(jpg|png|webp)$/;

async function saveDoc(db, stmtId, n, dataUrl, now = Date.now()) {
  const m = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new UserError('명세서 사진을 읽지 못했어요');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new UserError('명세서 사진이 너무 큽니다 (한 장 2MB 이하)');
  const ext = sniff(buf);
  if (!ext) throw new UserError('JPG·PNG·WEBP 사진만 올릴 수 있어요');
  const name = `s${Number(stmtId)}-${n}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await db.run('INSERT INTO images (name, type, data, created_at) VALUES (?, ?, ?, ?)', [name, TYPES[ext], buf.toString('base64'), now]);
  return name;
}

async function readDoc(db, name) {
  if (!DOC_NAME.test(name)) return null;
  const row = await db.get('SELECT type, data FROM images WHERE name = ?', [name]);
  return row ? { type: row.type, body: new Uint8Array(Buffer.from(row.data, 'base64')) } : null;
}

async function remove(db, name) {
  if (name && DOC_NAME.test(name)) return db.run('DELETE FROM images WHERE name = ?', [name]);
  if (name && NAME.test(name)) await db.run('DELETE FROM images WHERE name = ?', [name]);
}

/** { type, body(Uint8Array) } 또는 null */
async function read(db, name) {
  if (!NAME.test(name)) return null;
  const row = await db.get('SELECT type, data FROM images WHERE name = ?', [name]);
  return row ? { type: row.type, body: new Uint8Array(Buffer.from(row.data, 'base64')) } : null;
}

module.exports = { save, remove, read, NAME, saveDoc, readDoc };
