'use strict';
// 단일 실행 파일(dist/bevflow.js): 소스와 일치하는지, 그 파일 하나로 서버가 뜨는지
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { build } = require('../scripts/bundle');

const DIST = path.join(__dirname, '..', 'dist', 'bevflow.js');

test('dist/bevflow.js가 현재 소스로 만든 결과와 같다 (다르면 npm run bundle)', () => {
  assert.ok(fs.existsSync(DIST), 'dist/bevflow.js 없음 — npm run bundle');
  assert.ok(fs.readFileSync(DIST, 'utf8') === build(), 'dist/bevflow.js가 소스보다 오래됨 — npm run bundle');
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('단일 파일만 복사해도 서버·화면·명령이 동작한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bevflow-single-'));
  const file = path.join(dir, 'bevflow.js');
  fs.writeFileSync(file, build());
  try {
    assert.match(execFileSync(process.execPath, [file, 'help'], { encoding: 'utf8' }), /create-admin/);
    const port = await freePort();
    const child = spawn(process.execPath, [file], { cwd: dir, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BEVFLOW_DB: '', BEVFLOW_ADMIN_PASSWORD: 'bundle-test-pw-1' } });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    try {
      const base = `http://127.0.0.1:${port}`;
      let health;
      for (let i = 0; i < 50 && !health; i++) {
        health = await fetch(base + '/healthz').then((r) => r.json()).catch(() => null);
        if (!health) await new Promise((r) => setTimeout(r, 100));
      }
      assert.strictEqual(health && health.ok, true);
      const login = await fetch(base + '/login');
      assert.match(login.headers.get('content-type'), /text\/html/);
      const js = await fetch(base + '/assets/console.js');
      assert.strictEqual(js.status, 200);
      assert.strictEqual(await js.text(), fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'console.js'), 'utf8'));
      assert.ok(fs.existsSync(path.join(dir, 'data', 'bevflow.db')), '파일 옆 data/에 DB 생성');
      assert.doesNotMatch(stderr, /ExperimentalWarning/);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
