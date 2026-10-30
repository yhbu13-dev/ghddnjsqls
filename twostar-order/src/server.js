'use strict';
// 투스타 발주 — 내 컴퓨터(Windows·Mac)·Render 용 서버. 요청 처리는 src/app.js 가 한다.
//
// 설정 (환경 변수)
//   PORT=8080  HOST=127.0.0.1  PUBLIC_URL=https://…  ADMIN_PASSWORD=…  SKILL_KEY=…  BLOCK_ID=…
//   MIN_ORDER=0  GUEST_URL=…  DATA_DIR=data  TRUST_PROXY=1  SEED_SAMPLE=1

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open } = require('./db');
const { createHandler, skillKeyOf } = require('./app');
const tokens = require('./tokens');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const MAX_BODY = 12 * 1024 * 1024; // 명세서 사진 여러 장

function loadSecret(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* 처음 실행 */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

function config(env = process.env) {
  const dataDir = env.DATA_DIR || path.join(ROOT, 'data');
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || undefined, // 127.0.0.1 이면 이 컴퓨터 안에서만 접속 (터널이 대신 외부 연결)
    // Render 는 RENDER_EXTERNAL_URL 에 고정 주소(https://….onrender.com)를 넣어 준다
    publicUrl: String(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 8080}`).replace(/\/+$/, ''),
    trustProxy: env.TRUST_PROXY === '1', // 앞단 프록시(Render·터널)가 넣어 주는 X-Forwarded-For 로 접속자 구분
    seedSample: env.SEED_SAMPLE === '1',
    adminPassword: env.ADMIN_PASSWORD || '',
    skillKey: env.SKILL_KEY || '',
    blockId: env.BLOCK_ID || '',
    minAmount: Number(env.MIN_ORDER || 0),
    guest: { label: env.GUEST_LABEL || '쇼핑몰 문의하기', url: env.GUEST_URL || '' },
    dbFile: env.DB_FILE || path.join(dataDir, 'order.db'),
    secret: env.SECRET || loadSecret(path.join(dataDir, 'secret')),
  };
}

/** public/ 안의 화면 파일 읽기 */
async function assets(name) {
  try { return new Uint8Array(await fs.promises.readFile(path.join(PUBLIC, path.basename(name)))); } catch { return null; }
}

/** Node 요청 → 웹 표준 Request */
function toRequest(req, body) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'].includes(k)) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  const origin = `http://${req.headers.host || 'localhost'}`;
  return new Request(new URL(req.url, origin), { method: req.method, headers, body: body && body.length ? body : undefined });
}

function createApp(cfg) {
  const db = open(cfg.dbFile);
  const handle = createHandler({ db, cfg, assets });
  const tk = tokens.make(cfg.secret);
  const orderLink = (storeId, ver = 0) => `${cfg.publicUrl}/o/${tk.sign('o', `${storeId}-${ver}`, 365 * 24 * 3600e3)}`;

  const server = http.createServer((req, res) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { res.writeHead(413, { 'content-type': 'application/json' }).end('{"error":"요청이 너무 큽니다"}'); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      try {
        const ip = (cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
        const out = await handle(toRequest(req, Buffer.concat(chunks)), { ip });
        const headers = {};
        out.headers.forEach((v, k) => { headers[k] = v; });
        const body = Buffer.from(await out.arrayBuffer());
        res.writeHead(out.status, { ...headers, 'content-length': body.length });
        res.end(body);
      } catch (e) {
        console.error(e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"서버 오류"}');
      }
    });
  });
  return { server, db, handle, orderLink, tk, ready: handle.ready };
}

if (require.main === module) {
  const cfg = config();
  if (!cfg.adminPassword) {
    cfg.adminPassword = crypto.randomBytes(6).toString('base64url');
    console.log(`⚠️  ADMIN_PASSWORD 가 없어 임시 비밀번호를 만들었습니다: ${cfg.adminPassword}`);
  }
  if (!cfg.blockId) console.log('⚠️  BLOCK_ID 가 없어 챗봇 버튼이 "말하기" 방식으로 동작합니다.');
  const { server, db, ready } = createApp(cfg);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n⚠️  ${cfg.port} 번 포트를 이미 다른 프로그램(먼저 켠 투스타 발주 서버일 수 있음)이 쓰고 있습니다.`);
      console.error('   먼저 켜 둔 서버 창을 찾아 Ctrl+C 로 끄거나, 작업 관리자에서 node.exe 를 끝낸 뒤 다시 실행해 주세요.\n');
      process.exit(1);
    }
    throw e;
  });
  ready().then(async () => {
    const key = await skillKeyOf(db, cfg);
    server.listen(cfg.port, cfg.host, () => {
      console.log(`투스타 발주 서버: http://localhost:${cfg.port}/admin`);
      console.log(`카카오 스킬 URL: ${cfg.publicUrl}/kakao/skill?key=${key}`);
    });
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { createApp, config };
