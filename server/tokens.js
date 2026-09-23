'use strict';
// 서명 링크 토큰 — 로그인 없이 쓰는 사장님 승인 링크(/o/…)와 기사 배송 링크(/d/…)
// 형식: base64url(JSON) + '.' + base64url(HMAC-SHA256). DB의 nonce와 대조하므로 재발급하면 이전 링크는 무효.

const crypto = require('node:crypto');

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function sign(secret, payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest();
  return body + '.' + b64(mac);
}

/** 서명·만료를 확인한 payload, 아니면 null */
function verify(secret, token, kind, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', secret).update(body).digest();
  let given;
  try { given = Buffer.from(mac, 'base64url'); } catch { return null; }
  if (given.length !== expect.length || !crypto.timingSafeEqual(given, expect)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.k !== kind || typeof p.id !== 'number' || typeof p.e !== 'number' || p.e < now) return null;
  return p;
}

const nonce = () => crypto.randomBytes(9).toString('base64url');

module.exports = { sign, verify, nonce };
