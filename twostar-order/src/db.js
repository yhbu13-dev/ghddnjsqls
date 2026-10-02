'use strict';
// 내 컴퓨터용 저장소: Node 내장 SQLite 파일 하나 (data/order.db).
// 클라우드(Cloudflare D1, src/d1.js)와 똑같은 모양의 비동기 함수를 제공한다.
//   get(sql, params) → 한 줄 | undefined      all(sql, params) → 여러 줄
//   run(sql, params) → { changes, lastRowId }  batch([[sql, params], …]) → 전부 성공하거나 전부 취소

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const runSync = (sql, p = []) => {
    const r = stmt(sql).run(...p);
    return { changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) };
  };
  return {
    raw,
    get: async (sql, p = []) => stmt(sql).get(...p),
    all: async (sql, p = []) => stmt(sql).all(...p),
    run: async (sql, p = []) => runSync(sql, p),
    async batch(list) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = list.map(([sql, p]) => runSync(sql, p || []));
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => raw.close(),
  };
}

module.exports = { open };
