'use strict';
// 클라우드용 저장소: Cloudflare D1 (SQLite). src/db.js 와 같은 모양의 함수.

function d1(DB) {
  const prep = (sql, p = []) => DB.prepare(sql).bind(...p.map((v) => (v === undefined ? null : v)));
  const meta = (r) => ({ changes: r.meta?.changes ?? 0, lastRowId: r.meta?.last_row_id ?? 0 });
  return {
    get: async (sql, p) => (await prep(sql, p).first()) ?? undefined,
    all: async (sql, p) => (await prep(sql, p).all()).results,
    run: async (sql, p) => meta(await prep(sql, p).run()),
    batch: async (list) => (list.length ? (await DB.batch(list.map(([sql, p]) => prep(sql, p || [])))).map(meta) : []),
  };
}

module.exports = { d1 };
