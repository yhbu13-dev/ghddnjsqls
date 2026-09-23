'use strict';
// 운영 DB 온라인 백업 (서버 실행 중에도 안전: SQLite VACUUM INTO)
//   npm run backup [-- --db data/bevflow.db --out backups]
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = opt('db', process.env.BEVFLOW_DB || path.join(__dirname, '..', 'data', 'bevflow.db'));
const outDir = opt('out', path.join(__dirname, '..', 'backups'));
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
const out = path.join(outDir, `bevflow-${stamp}.db`);
const db = new DatabaseSync(file);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
// 30일 넘은 백업 정리
for (const f of fs.readdirSync(outDir)) {
  const p = path.join(outDir, f);
  if (/^bevflow-.*\.db$/.test(f) && Date.now() - fs.statSync(p).mtimeMs > 30 * 864e5) fs.unlinkSync(p);
}
console.log('백업 완료:', out);
