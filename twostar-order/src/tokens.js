'use strict';
// 서명 토큰: 발주서 링크(/o/…)와 관리자 로그인 쿠키에 사용. 비밀키 없이는 위조할 수 없다.

const crypto = require('node:crypto');

function make(secret) {
  const mac = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  return {
    sign(kind, id, ttlMs, now = Date.now()) {
      const body = `${kind}.${id}.${Math.floor((now + ttlMs) / 1000).toString(36)}`;
      return `${body}.${mac(body)}`;
    },
    verify(kind, token, now = Date.now()) {
      const parts = String(token || '').split('.');
      if (parts.length !== 4 || parts[0] !== kind) return null;
      const body = parts.slice(0, 3).join('.');
      const a = Buffer.from(mac(body));
      const b = Buffer.from(parts[3]);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      if (parseInt(parts[2], 36) * 1000 < now) return null;
      return parts[1];
    },
  };
}

module.exports = { make };
