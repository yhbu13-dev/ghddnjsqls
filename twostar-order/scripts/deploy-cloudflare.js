'use strict';
// 투스타 발주 — Cloudflare 에 올리기
//   Windows: deploy-cloudflare.bat 더블클릭 (이 파일을 실행)   Mac: node scripts/deploy-cloudflare.js
// 하는 일: Cloudflare 로그인 → D1 데이터베이스 만들기(있으면 그대로) → 배포 → 관리자 비밀번호 → 스킬 URL 복사
// 코드를 고친 뒤 다시 올릴 때도 같은 파일을 실행하면 됩니다 (데이터는 그대로 유지).
// PowerShell 대신 Node 로 만들어 인자가 글자 그대로 wrangler 에 전달된다.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ROOT = path.join(__dirname, '..');
const DB_NAME = 'twostar-order';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const WIN = process.platform === 'win32';

const C = { cyan: '\x1b[36m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', gray: '\x1b[90m', off: '\x1b[0m' };
const say = (m) => console.log(`\n${C.cyan}${m}${C.off}`);
function fail(m) { console.log(`\n${C.red}${m}${C.off}\n`); process.exit(1); }

// npx 를 셸 없이 직접 실행 (Windows 는 Node 옆에 설치된 npm 의 npx-cli.js)
function npxCommand() {
  const beside = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  ].find((p) => fs.existsSync(p));
  if (process.env.TS_NPX) return [process.env.TS_NPX, []]; // 시험용
  if (beside) return [process.execPath, [beside]];
  return [WIN ? 'npx.cmd' : 'npx', []];
}
const [NPX, NPX_PRE] = npxCommand();

/** wrangler 실행. show=true 면 화면에 보여 주고, 결과 글자(표준출력+오류출력)를 돌려준다 */
function wrangler(args, { show = false, input } = {}) {
  const r = spawnSync(NPX, [...NPX_PRE, '--yes', 'wrangler@4', ...args], {
    cwd: ROOT,
    input: input ?? '', // 입력을 넘겨 질문 없이 진행
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: NPX.endsWith('.cmd'),
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) fail(`wrangler 를 실행하지 못했습니다: ${r.error.message}`);
  const out = `${r.stdout || ''}${r.stderr ? `\n${r.stderr}` : ''}`;
  if (show) console.log(out.trim());
  return { out, stdout: r.stdout || '', code: r.status };
}

/** 로그인은 브라우저를 열어야 해서 화면과 키보드를 그대로 연결 */
function wranglerLogin() {
  const r = spawnSync(NPX, [...NPX_PRE, '--yes', 'wrangler@4', 'login'], { cwd: ROOT, stdio: 'inherit', shell: NPX.endsWith('.cmd') });
  if (r.error) fail(`wrangler 를 실행하지 못했습니다: ${r.error.message}`);
}

const loggedIn = () => /"loggedIn"\s*:\s*true/.test(wrangler(['whoami', '--json']).stdout);

function findDbId() {
  const info = wrangler(['d1', 'info', DB_NAME, '--json']).stdout;
  let m = info.match(new RegExp(`"uuid"\\s*:\\s*"(${UUID.source})"`, 'i'));
  if (m) return { id: m[1] };
  const list = wrangler(['d1', 'list', '--json']).stdout;
  try {
    const arr = JSON.parse(list.slice(list.indexOf('[')));
    const db = arr.find((d) => d.name === DB_NAME);
    if (db && db.uuid) return { id: db.uuid };
  } catch { /* 아래에서 원문 표시 */ }
  return { id: null, raw: `[d1 info]\n${info}\n[d1 list]\n${list}` };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else if (s !== '\r\n' && s !== '\n') rl.output.write('*'); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

function copy(text) {
  try {
    if (WIN) spawnSync('clip', { input: text });
    else if (process.platform === 'darwin') spawnSync('pbcopy', { input: text });
    else return false;
    return true;
  } catch { return false; }
}

async function skillUrlOf(url, password) {
  for (let i = 0; i < 6; i++) {
    try {
      await new Promise((r) => setTimeout(r, 3000)); // 새 비밀번호가 반영될 때까지 잠깐
      const lr = await fetch(`${url}/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!lr.ok) continue;
      const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
      const d = await (await fetch(`${url}/api/admin/data`, { headers: { cookie } })).json();
      if (d.skillUrl) return d.skillUrl;
    } catch { /* 다시 시도 */ }
  }
  return null;
}

(async () => {
  // 1) 로그인
  say('1/5  Cloudflare 로그인 확인 중… (처음에는 wrangler 를 내려받느라 1~2분 걸립니다)');
  if (!loggedIn()) {
    say('브라우저가 열리면 Cloudflare 에 로그인하고 [Allow] 를 눌러 주세요. (끝나면 브라우저는 닫고 이 창으로 돌아오세요)');
    wranglerLogin();
    if (!loggedIn()) fail('로그인이 되지 않았습니다. 이 창을 닫고 deploy-cloudflare.bat 을 다시 실행해 주세요.');
  }
  console.log('로그인 확인 완료');

  // 2) D1 데이터베이스
  say('2/5  데이터베이스(D1) 확인 중…');
  let { id, raw } = findDbId();
  if (!id) {
    console.log('데이터베이스를 새로 만듭니다 (아시아 지역).');
    const created = wrangler(['d1', 'create', DB_NAME, '--location', 'apac'], { show: true }).out;
    const m = created.match(new RegExp(`database_id\\s*=\\s*"(${UUID.source})"`, 'i'));
    if (m) id = m[1];
    if (!id) { await new Promise((r) => setTimeout(r, 3000)); ({ id, raw } = findDbId()); }
    if (!id) { console.log(`${C.gray}${raw}${C.off}`); fail('데이터베이스 번호를 찾지 못했습니다. 위 메시지 전체를 캡처해서 보내 주세요.'); }
  }
  console.log(`데이터베이스: ${DB_NAME} (${id})`);
  const tomlPath = path.join(ROOT, 'wrangler.toml');
  fs.writeFileSync(tomlPath, fs.readFileSync(tomlPath, 'utf8').replace(/database_id = "[^"]*"/, `database_id = "${id}"`));

  // 3) 배포
  say('3/5  Cloudflare 에 올리는 중… (1~2분)');
  const dep = wrangler(['deploy'], { show: true }).out;
  const um = dep.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
  if (!um) fail('배포에 실패했거나 주소를 찾지 못했습니다. 위 메시지를 캡처해서 보내 주세요.');
  const devUrl = um[0];
  // wrangler.toml 에 회사 주소(PUBLIC_URL)가 있으면 그 주소를 쓴다 (없으면 workers.dev)
  const pm = fs.readFileSync(tomlPath, 'utf8').match(/^PUBLIC_URL\s*=\s*"(https:\/\/[^"]+)"/m);
  const url = pm ? pm[1].replace(/\/+$/, '') : devUrl;

  // 4) 관리자 비밀번호
  say('4/5  관리자 비밀번호');
  const hasPw = /"ADMIN_PASSWORD"/.test(wrangler(['secret', 'list', '--format', 'json']).stdout);
  let password = process.env.TS_ADMIN_PASSWORD || '';
  let setPw = !hasPw;
  if (hasPw && !password) {
    const a = await ask('관리자 비밀번호가 이미 있습니다. 바꿀까요? (y = 바꾸기, 엔터 = 그대로): ');
    setPw = /^[yYㅛ]/.test(a);
  }
  if (setPw) {
    while (!password || password.length < 8) {
      if (password) console.log(`${C.yellow}8자 이상으로 입력해 주세요.${C.off}`);
      password = await ask('새 관리자 비밀번호 (8자 이상): ', { hidden: true });
    }
    const put = wrangler(['secret', 'put', 'ADMIN_PASSWORD'], { input: `${password}\n`, show: true }).out;
    if (!/success/i.test(put)) fail('비밀번호를 저장하지 못했습니다. 위 메시지를 캡처해서 보내 주세요.');
  } else if (!password) {
    password = await ask('스킬 URL 을 가져오려면 지금 관리자 비밀번호를 입력해 주세요 (건너뛰려면 엔터): ', { hidden: true });
  }

  // 5) 스킬 URL
  say('5/5  오픈빌더 스킬 URL 가져오는 중…');
  // 회사 주소는 처음 붙일 때 인증서 발급에 몇 분 걸릴 수 있어 workers.dev 로도 시도
  const skillUrl = password ? (await skillUrlOf(url, password)) || (url !== devUrl ? await skillUrlOf(devUrl, password) : null) : null;
  const copied = skillUrl && copy(skillUrl);

  const bar = '─'.repeat(62);
  console.log(`\n${C.green}┌${bar}\n│ ✅ Cloudflare 에 올렸습니다 (주소는 앞으로 바뀌지 않습니다)${C.off}`);
  console.log('│');
  console.log(`│ 관리자 화면 : ${url}/admin`);
  console.log('│');
  if (skillUrl) {
    console.log(`│ 오픈빌더 스킬 URL${copied ? ' (클립보드에 복사됨 — 붙여넣기만 하세요)' : ''}`);
    console.log(`│   ${C.yellow}${skillUrl}${C.off}`);
  } else {
    console.log('│ 오픈빌더 스킬 URL: 관리자 화면 → [매장] 탭 맨 위에서 복사하세요');
  }
  console.log('│');
  console.log('│ ※ 이제 PC 를 꺼도 챗봇이 동작합니다. (예전 검은 창 서버는 꺼도 됩니다)');
  console.log('│ ※ 코드를 새로 받은 뒤 이 파일을 다시 실행하면 업데이트됩니다. 데이터는 그대로입니다.');
  console.log(`${C.green}└${bar}${C.off}\n`);
})().catch((e) => fail(`예상하지 못한 오류: ${e && e.stack || e}`));
