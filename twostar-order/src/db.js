'use strict';
// 저장소: Node 내장 SQLite 파일 하나 (data/order.db). 별도 DB 서버 설치가 필요 없다.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  biz TEXT NOT NULL CHECK (biz IN ('cafe','sauna','restaurant')),
  owner TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  code TEXT UNIQUE,                       -- 카톡 연결 코드 (6자리, 한 번 쓰면 사라짐)
  cart_rev INTEGER NOT NULL DEFAULT 0,    -- 장바구니가 바뀔 때마다 +1 (중복 주문 방지)
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS links (        -- 카카오 챗봇 사용자 ↔ 매장
  user_key TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  linked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('cafe','snack','beverage')),
  grp TEXT NOT NULL DEFAULT '기타',        -- 진열대·분류 (예: 과자, 음료, 시럽)
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',          -- 규격 (예: 1박스 20입)
  unit TEXT NOT NULL DEFAULT '개',
  price INTEGER NOT NULL CHECK (price >= 0),
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS access (       -- 기본 품목 외 추가 품목 이용 신청·승인
  store_id INTEGER NOT NULL REFERENCES stores(id),
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  PRIMARY KEY (store_id, category)
);
CREATE TABLE IF NOT EXISTS cart (
  store_id INTEGER NOT NULL REFERENCES stores(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (store_id, item_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,                -- 주문번호 (예: 0926-003)
  store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL CHECK (status IN ('received','confirmed','shipped','done','canceled')),
  total INTEGER NOT NULL,
  via TEXT NOT NULL,                      -- chat / web
  ref TEXT NOT NULL UNIQUE,               -- 매장·장바구니 버전 (같은 주문 두 번 접수 방지)
  memo TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_lines (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  item_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  unit TEXT NOT NULL,
  price INTEGER NOT NULL,
  qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_store ON orders (store_id, created_at);
CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS lines_order ON order_lines (order_id);
`;

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec(SCHEMA);

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  return {
    raw,
    get: (sql, p = []) => stmt(sql).get(...p),
    all: (sql, p = []) => stmt(sql).all(...p),
    run: (sql, p = []) => stmt(sql).run(...p),
    /** 묶음 실행: 중간에 실패하면 전부 되돌림 */
    tx(fn) {
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    close: () => raw.close(),
  };
}

module.exports = { open };
