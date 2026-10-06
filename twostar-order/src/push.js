'use strict';
// 휴대폰 알림 (웹 푸시) — 무료. 점주가 발주서에서 [알림 켜기]를 누른 휴대폰으로
// "발주가 확인되었어요" 같은 알림을 즉시 보낸다. 카카오 Event API(유료) 대신 쓰는 방법.
//   표준: VAPID(RFC 8292) 서명 + 내용 암호화 aes128gcm(RFC 8291). 크롬·삼성인터넷·사파리(홈 화면 앱) 공통.
//   서버 키(VAPID)는 처음 쓸 때 만들어 DB(meta)에 보관 — 따로 설정할 것 없음.

const { metaValue } = require('./schema');

const { subtle } = globalThis.crypto;
const te = new TextEncoder();

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(String(s), 'base64url'));
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

// 알림 서버 주소만 허용 (아무 주소로나 요청을 보내지 않도록)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
function validEndpoint(endpoint) {
  try {
    const u = new URL(String(endpoint));
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && String(endpoint).length <= 1000;
  } catch { return false; }
}

/** 서버 키 { publicKey(b64url 65바이트), jwk(비밀키) } — 없으면 만들어 저장 */
async function vapidKeys(db) {
  const make = async () => {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    return JSON.stringify({ publicKey: b64u(await subtle.exportKey('raw', kp.publicKey)), jwk: await subtle.exportKey('jwk', kp.privateKey) });
  };
  let v = await db.get("SELECT value FROM meta WHERE key = 'vapid'");
  if (!v) {
    const value = await make();
    await metaValue(db, 'vapid', () => value);
    v = await db.get("SELECT value FROM meta WHERE key = 'vapid'");
  }
  return JSON.parse(v.value);
}

async function hmac(key, data) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}

/** 알림 내용 암호화 (RFC 8291 aes128gcm). sub.keys = { p256dh, auth } */
async function encrypt(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const local = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await subtle.exportKey('raw', local.publicKey));
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hmac(await hmac(authSecret, shared), concat(te.encode('WebPush: info\0'), uaPublic, asPublic, [1]));
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const key = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(te.encode(payload), [2])));
  const rs = [0, 0, 16, 0]; // 4096
  return concat(salt, rs, [asPublic.length], asPublic, body);
}

/** VAPID 서명 헤더 */
async function vapidAuth(keys, endpoint, contact) {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact })));
  const k = await subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, te.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** 점주 휴대폰 등록 (같은 휴대폰은 한 번만) */
async function subscribe(db, storeId, sub, now = Date.now()) {
  if (!sub || !validEndpoint(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
  if (unb64u(sub.keys.p256dh).length !== 65 || unb64u(sub.keys.auth).length !== 16) return false;
  await db.run(`INSERT INTO push_subs (endpoint, store_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (endpoint) DO UPDATE SET store_id = excluded.store_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  [sub.endpoint, storeId, sub.keys.p256dh, sub.keys.auth, now]);
  return true;
}

async function unsubscribe(db, endpoint) {
  await db.run('DELETE FROM push_subs WHERE endpoint = ?', [String(endpoint || '')]);
}

const countOf = async (db, storeId) => (await db.get('SELECT COUNT(*) AS n FROM push_subs WHERE store_id = ?', [storeId])).n;

/**
 * 매장에 등록된 휴대폰 모두에게 알림. msg = { title, body, url }
 * 결과: { phones, sent, error }. 없어진 휴대폰(404·410)은 목록에서 지운다.
 */
async function sendToStore(db, storeId, msg, { contact, fetchImpl = globalThis.fetch } = {}) {
  const subs = await db.all('SELECT * FROM push_subs WHERE store_id = ?', [storeId]);
  if (!subs.length) return { phones: 0, sent: 0, error: '' };
  const keys = await vapidKeys(db);
  const payload = JSON.stringify({ title: msg.title, body: String(msg.body || '').slice(0, 300), url: msg.url || '', tag: msg.tag || '' });
  let sent = 0; let error = '';
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetchImpl(s.endpoint, {
        method: 'POST',
        headers: {
          authorization: await vapidAuth(keys, s.endpoint, contact),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: String(3 * 86400), // 휴대폰이 꺼져 있으면 3일까지 기다렸다가 전달
          urgency: 'high',
        },
        body: await encrypt({ keys: { p256dh: s.p256dh, auth: s.auth } }, payload),
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 404 || r.status === 410) await unsubscribe(db, s.endpoint);
      else if (r.ok) sent++;
      else error = `알림 서버 응답 ${r.status}`;
    } catch (e) {
      error = e.name === 'TimeoutError' ? '알림 서버가 응답하지 않아요' : String(e.message || e);
    }
  }));
  return { phones: subs.length, sent, error };
}

module.exports = { vapidKeys, subscribe, unsubscribe, sendToStore, countOf, validEndpoint, encrypt };
