'use strict';
// 품목 사진: 관리자 화면에서 600×600 JPEG로 줄여 올리면 data/images/ 에 파일로 저장
// 카카오 카드 썸네일과 발주서 목록에 쓰인다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { UserError } = require('./order');

const MAX_BYTES = 2 * 1024 * 1024;
const NAME = /^\d{1,9}-[0-9a-f]{8}\.(jpg|png|webp)$/;

function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** data URL(base64)을 파일로 저장하고 파일 이름을 돌려줌 */
function save(dir, itemId, dataUrl) {
  const m = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new UserError('사진 파일을 읽지 못했어요');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new UserError('사진이 너무 큽니다 (2MB 이하)');
  const ext = sniff(buf);
  if (!ext) throw new UserError('JPG·PNG·WEBP 사진만 올릴 수 있어요');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Number(itemId)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

function remove(dir, name) {
  if (name && NAME.test(name)) fs.rmSync(path.join(dir, name), { force: true });
}

function read(dir, name) {
  if (!NAME.test(name)) return null;
  try { return fs.readFileSync(path.join(dir, name)); } catch { return null; }
}

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const typeOf = (name) => TYPES[name.split('.').pop()];

// 사진 없는 품목용 기본 그림 (연회색 정사각형 PNG) — 카카오 사진 카드는 썸네일이 꼭 있어야 함
function solidPng(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const PLACEHOLDER = solidPng(600, 600, [241, 242, 244]);

module.exports = { save, remove, read, typeOf, PLACEHOLDER, NAME };
