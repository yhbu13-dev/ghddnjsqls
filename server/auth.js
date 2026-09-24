'use strict';
// 운영팀 계정 · 세션 · 로그인 시도 제한
// 비밀번호: scrypt(N=16384) + 무작위 솔트. 세션: 32바이트 무작위 ID, HttpOnly 쿠키, 12시간.

const crypto = require('node:crypto');
const { HttpError } = require('./http');

const SESSION_HOURS = 12;
const ROLES = { viewer: 1, ops: 2, admin: 3 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'base64url'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'base64url');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, '비밀번호는 10자 이상이어야 합니다');
  if (pw.length > 200) throw new HttpError(400, '비밀번호가 너무 깁니다');
}

function createUser(db, { email, name, role, password, mustChange = false }, now = Date.now()) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw new HttpError(400, '이메일 형식이 올바르지 않습니다');
  if (!ROLES[role]) throw new HttpError(400, '권한은 admin, ops, viewer 중 하나입니다');
  if (!String(name || '').trim()) throw new HttpError(400, '이름을 입력해 주세요');
  checkPasswordPolicy(password);
  if (db.get('SELECT 1 FROM users WHERE email = ?', [email])) throw new HttpError(409, '이미 등록된 이메일입니다');
  const r = db.run('INSERT INTO users (email, name, role, pw_hash, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [String(email).trim(), String(name).trim(), role, hashPassword(password), mustChange ? 1 : 0, now]);
  return Number(r.lastInsertRowid);
}

// 로그인 시도 제한: IP·이메일별 15분에 10회
const attempts = new Map();
function limited(key, now) {
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(key, a);
  return a.length >= 10;
}
function recordFail(key, now) { (attempts.get(key) || attempts.set(key, []).get(key)).push(now); }

function login(db, email, password, ip, now = Date.now()) {
  const keys = ['ip:' + ip, 'em:' + String(email).toLowerCase()];
  if (keys.some((k) => limited(k, now))) throw new HttpError(429, '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요');
  const u = db.get('SELECT * FROM users WHERE email = ?', [String(email || '')]);
  const ok = u && !u.disabled && verifyPassword(String(password || ''), u.pw_hash);
  if (!ok) { keys.forEach((k) => recordFail(k, now)); throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다'); }
  keys.forEach((k) => attempts.delete(k));
  const sid = crypto.randomBytes(32).toString('base64url');
  db.run('INSERT INTO sessions (id, user_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)', [sid, u.id, now, now + SESSION_HOURS * 3600e3, ip]);
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, u.id]);
  return { sid, user: publicUser(u) };
}

function sessionUser(db, sid, now = Date.now()) {
  if (!sid || sid.length > 100) return null;
  const r = db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`, [sid, now]);
  return r ? publicUser(r) : null;
}

function logout(db, sid) { if (sid) db.run('DELETE FROM sessions WHERE id = ?', [sid]); }

function publicUser(u) { return { id: u.id, email: u.email, name: u.name, role: u.role, must_change: !!u.must_change }; }

function requireRole(user, role) {
  if (!user) throw new HttpError(401, '로그인이 필요합니다');
  if (ROLES[user.role] < ROLES[role]) throw new HttpError(403, '권한이 없습니다');
}

function changePassword(db, userId, current, next) {
  const u = db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!u || !verifyPassword(String(current || ''), u.pw_hash)) throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다');
  checkPasswordPolicy(next);
  db.run('UPDATE users SET pw_hash = ?, must_change = 0 WHERE id = ?', [hashPassword(next), userId]);
  db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

function cookieHeader(sid, secure, maxAgeSec = SESSION_HOURS * 3600) {
  return `bf_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

module.exports = { hashPassword, verifyPassword, createUser, login, sessionUser, logout, requireRole, changePassword, cookieHeader, checkPasswordPolicy, ROLES, _attempts: attempts };
