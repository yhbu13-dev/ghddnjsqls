'use strict';
// 샘플 품목·매장 넣기 (데모용). 이미 품목이 있으면 건너뜀.
//   npm run seed
// 클라우드에서는 SEED_SAMPLE=1 이면 서버가 처음 켜질 때 자동으로 넣는다.

const path = require('node:path');
const { open } = require('../src/db');
const { migrate } = require('../src/schema');
const { seed } = require('../src/sample');

(async () => {
  const file = process.env.DB_FILE || path.join(process.env.DATA_DIR || path.join(__dirname, '../data'), 'order.db');
  const db = open(file);
  await migrate(db);
  await seed(db);
})().catch((e) => { console.error(e); process.exit(1); });
