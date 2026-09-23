'use strict';
// BevFlow 운영 서버 진입점
//   node --disable-warning=ExperimentalWarning server/index.js
// 환경 변수: PORT, BEVFLOW_DB, BEVFLOW_TRUST_PROXY, BEVFLOW_ADMIN_EMAIL, BEVFLOW_ADMIN_PASSWORD,
//            BEVFLOW_LINK_SECRET, BEVFLOW_INGEST_SECRET, BEVFLOW_WEBHOOK_SECRET

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createContext } = require('./context');
const { createServer } = require('./app');
const auth = require('./auth');
const jobs = require('./jobs');

const env = process.env;
const file = env.BEVFLOW_DB || path.join(__dirname, '..', 'data', 'bevflow.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const ctx = createContext({ file, env });

// 첫 실행: 관리자 계정 생성
if (!ctx.db.get('SELECT 1 FROM users LIMIT 1')) {
  const email = env.BEVFLOW_ADMIN_EMAIL || 'admin@bevflow.local';
  const password = env.BEVFLOW_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  auth.createUser(ctx.db, { email, name: '관리자', role: 'admin', password, mustChange: !env.BEVFLOW_ADMIN_PASSWORD });
  console.log('────────────────────────────────────────────');
  console.log(' 관리자 계정이 생성되었습니다');
  console.log('   이메일  :', email);
  if (!env.BEVFLOW_ADMIN_PASSWORD) console.log('   임시 비밀번호:', password, ' (첫 로그인 시 변경)');
  console.log('────────────────────────────────────────────');
}

const port = Number(env.PORT || 8080);
const server = createServer(ctx, { trustProxy: env.BEVFLOW_TRUST_PROXY === '1' });
server.listen(port, () => {
  console.log(`BevFlow 운영 서버 실행 중 → http://localhost:${port}  (DB: ${file})`);
  console.log(`외부 접속 주소 설정값: ${ctx.R.public_base_url} — 사장님·기사 링크가 이 주소로 만들어집니다`);
});
const stopJobs = jobs.start(ctx);

const shutdown = () => {
  console.log('종료 중…');
  stopJobs();
  server.close(() => { ctx.db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
