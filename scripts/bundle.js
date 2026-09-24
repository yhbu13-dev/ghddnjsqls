'use strict';
// 단일 실행 파일 만들기: server/ · scripts/ · public/ 전체를 dist/bevflow.js 하나로 묶는다.
//   npm run bundle [-- --out dist/bevflow.js]
// 결과 파일은 외부 패키지 없이 `node bevflow.js`로 실행된다. 데이터는 그 파일 옆 data/ 에 쌓인다.

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const COMMANDS = {
  start: ['server/index.js', '운영 서버 실행 (기본)'],
  'seed-sample': ['scripts/seed-sample.js', '샘플 데이터 생성  [--weeks 6] [--force] [--db 경로]'],
  backup: ['scripts/backup.js', 'DB 온라인 백업  [--db 경로] [--out 폴더]'],
  'create-admin': ['scripts/create-admin.js', '관리자 추가·비밀번호 재설정  <이메일> [이름]'],
};

function walk(dir, filter) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out.push(...walk(rel, filter));
    else if (filter(rel)) out.push(rel);
  }
  return out.sort();
}

function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const modules = [...walk('server', (f) => f.endsWith('.js')), ...Object.values(COMMANDS).map(([f]) => f).filter((f) => f.startsWith('scripts/'))];
  const assets = walk('public', (f) => /\.(html|js|css|svg|txt|json|webmanifest)$/.test(f));

  const moduleSrc = modules.map((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^#!.*\n/, '');
    return `// ── ${f} ${'─'.repeat(Math.max(4, 70 - f.length))}\n${JSON.stringify(f)}: function (exports, require, module, __filename, __dirname) {\n${src.trimEnd()}\n},`;
  }).join('\n\n');
  const assetSrc = assets.map((f) => {
    const rel = f.slice('public/'.length);
    return `${JSON.stringify(rel)}: ${JSON.stringify(fs.readFileSync(path.join(ROOT, f), 'utf8'))},`;
  }).join('\n');
  const help = Object.entries(COMMANDS).map(([k, [, d]]) => `  node bevflow.js ${k.padEnd(13)} ${d}`).join('\\n');

  return `#!/usr/bin/env node
'use strict';
// BevFlow 운영 관제 v${pkg.version} — 단일 실행 파일 (외부 패키지 없음, Node.js 22.13 이상)
//
${Object.entries(COMMANDS).map(([k, [, d]]) => `//   node bevflow.js ${k.padEnd(13)} ${d}`).join('\n')}
//
// 데이터는 이 파일 옆 data/bevflow.db 에 저장됩니다 (BEVFLOW_DB로 변경).
// 환경 변수: PORT, HOST, BEVFLOW_DB, BEVFLOW_TRUST_PROXY, BEVFLOW_ADMIN_EMAIL, BEVFLOW_ADMIN_PASSWORD,
//            BEVFLOW_LINK_SECRET, BEVFLOW_INGEST_SECRET, BEVFLOW_WEBHOOK_SECRET
//
// 이 파일은 scripts/bundle.js 가 소스(server/ · scripts/ · public/)로부터 만든 결과물입니다.
// 고칠 때는 소스를 고친 뒤 \`npm run bundle\`로 다시 만드세요.

const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number);
if (NODE_MAJOR < 22 || (NODE_MAJOR === 22 && NODE_MINOR < 13)) {
  console.error('BevFlow는 Node.js 22.13 이상이 필요합니다 (현재 ' + process.version + ')');
  process.exit(1);
}

// node:sqlite 실험 기능 경고만 숨기고 나머지 경고는 그대로 보여 줍니다
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w.name + ': ' + w.message); });

const __path = require('node:path');
const __BASE = __dirname;
globalThis.__BEVFLOW_CLI__ = 'node ' + __path.basename(__filename);

globalThis.__BEVFLOW_ASSETS__ = {
${assetSrc}
};

const __MODULES = {
${moduleSrc}
};

const __cache = {};
function __load(id) {
  if (__cache[id]) return __cache[id].exports;
  const fn = __MODULES[id];
  if (!fn) throw new Error('모듈을 찾을 수 없습니다: ' + id);
  const module = { exports: {}, id };
  __cache[id] = module;
  const dir = __path.posix.dirname(id);
  fn.call(module.exports, module.exports, (req) => __require(dir, req), module, __path.join(__BASE, id), __path.join(__BASE, dir));
  return module.exports;
}
function __require(fromDir, req) {
  if (!req.startsWith('.')) return require(req);
  const base = __path.posix.join(fromDir, req);
  for (const id of [base, base + '.js', base + '/index.js']) if (__MODULES[id]) return __load(id);
  throw new Error('모듈을 찾을 수 없습니다: ' + req + ' (' + fromDir + ')');
}

const __COMMANDS = ${JSON.stringify(Object.fromEntries(Object.entries(COMMANDS).map(([k, [f]]) => [k, f])))};
const __cmd = process.argv[2];
if (__cmd === 'help' || __cmd === '--help' || __cmd === '-h') {
  console.log('BevFlow 운영 관제 v${pkg.version}\\n\\n${help}');
} else if (__cmd && !__COMMANDS[__cmd]) {
  console.error('알 수 없는 명령: ' + __cmd + '\\n\\n${help}');
  process.exit(1);
} else {
  if (__cmd) process.argv.splice(2, 1);
  __load(__COMMANDS[__cmd || 'start']);
}
`;
}

module.exports = { build };

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const out = path.resolve(i >= 0 ? args[i + 1] : path.join(ROOT, 'dist', 'bevflow.js'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const code = build();
  fs.writeFileSync(out, code, { mode: 0o755 });
  console.log(`단일 파일 생성: ${path.relative(process.cwd(), out) || out} (${(code.length / 1024).toFixed(0)}KB)`);
}
