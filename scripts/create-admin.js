'use strict';
// 관리자 계정 추가 / 비밀번호 분실 시 재설정
//   npm run create-admin -- <이메일> <이름>   → 임시 비밀번호 출력 (첫 로그인 때 변경)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createContext } = require('../server/context');
const auth = require('../server/auth');
const [email, name = '관리자'] = process.argv.slice(2);
const cli = globalThis.__BEVFLOW_CLI__ ? globalThis.__BEVFLOW_CLI__ + ' create-admin' : 'npm run create-admin --';
if (!email) { console.error(`사용법: ${cli} <이메일> [이름]`); process.exit(1); }
const file = process.env.BEVFLOW_DB || path.join(__dirname, '..', 'data', 'bevflow.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
const ctx = createContext({ file });
const temp = crypto.randomBytes(9).toString('base64url');
const cur = ctx.db.get('SELECT id FROM users WHERE email = ?', [email]);
if (cur) {
  ctx.db.run("UPDATE users SET pw_hash = ?, must_change = 1, disabled = 0, role = 'admin' WHERE id = ?", [auth.hashPassword(temp), cur.id]);
  ctx.db.run('DELETE FROM sessions WHERE user_id = ?', [cur.id]);
  console.log('기존 계정을 관리자로 재설정했습니다:', email);
} else {
  auth.createUser(ctx.db, { email, name, role: 'admin', password: temp, mustChange: true });
  console.log('관리자 계정을 만들었습니다:', email);
}
console.log('임시 비밀번호:', temp, '(첫 로그인 때 변경)');
