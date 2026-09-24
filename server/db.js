'use strict';
// SQLite 저장소 (Node.js 내장 node:sqlite). 파일 하나로 운영하고 WAL 모드로 동시 읽기를 허용한다.
// 파일럿 규모(매장 수백 곳)까지 충분하며, 규모가 커지면 이 모듈만 Postgres로 바꾸면 된다.

const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  // v1 — 초기 스키마
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','ops','viewer')), pw_hash TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT
  );

  CREATE TABLE regions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT NOT NULL DEFAULT '', hub_name TEXT NOT NULL DEFAULT '',
    hub_lat REAL, hub_lng REAL, radius_km REAL NOT NULL DEFAULT 3, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE drivers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', region_id TEXT REFERENCES regions(id),
    vehicle TEXT NOT NULL DEFAULT '', capacity INTEGER NOT NULL DEFAULT 60, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE skus (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, pack INTEGER NOT NULL CHECK (pack > 0), unit TEXT NOT NULL DEFAULT '병',
    price INTEGER NOT NULL CHECK (price >= 0), active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE stores (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id),
    type TEXT NOT NULL DEFAULT 'L' CHECK (type IN ('L','D')),
    owner_name TEXT NOT NULL DEFAULT '', owner_phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
    lat REAL, lng REAL, pos_store_id TEXT UNIQUE,
    send_pref TEXT NOT NULL DEFAULT 'immediate' CHECK (send_pref IN ('immediate','break')),
    review_required INTEGER NOT NULL DEFAULT 0, pay_test_fail INTEGER NOT NULL DEFAULT 0,
    alpha REAL NOT NULL DEFAULT 0, beta REAL,
    cooldown_until INTEGER NOT NULL DEFAULT 0, last_pos_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE store_skus (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, sku_id TEXT NOT NULL REFERENCES skus(id),
    carried INTEGER NOT NULL DEFAULT 1,
    est REAL NOT NULL DEFAULT 0, band REAL NOT NULL DEFAULT 0.08,
    cum_est REAL NOT NULL DEFAULT 0, cum_pos REAL NOT NULL DEFAULT 0,
    base_qty REAL NOT NULL DEFAULT 0, in_since REAL NOT NULL DEFAULT 0,
    rate REAL, rate_manual REAL, safety_override REAL,
    last_count_at INTEGER, last_count_est REAL, last_count_actual REAL, last_count_band REAL,
    last_in_at INTEGER, last_in_qty INTEGER,
    PRIMARY KEY (store_id, sku_id)
  );
  CREATE TABLE menu_map (
    id INTEGER PRIMARY KEY, store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    menu_name TEXT NOT NULL, sku_id TEXT NOT NULL REFERENCES skus(id), units REAL NOT NULL CHECK (units > 0)
  );
  CREATE UNIQUE INDEX menu_map_uq ON menu_map (COALESCE(store_id, 0), menu_name, sku_id);
  CREATE TABLE unmapped_menu (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, menu_name TEXT NOT NULL,
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, menu_name)
  );

  CREATE TABLE pos_sales (
    id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, ext_id TEXT NOT NULL,
    sold_at INTEGER NOT NULL, menu_name TEXT NOT NULL, qty INTEGER NOT NULL, mapped INTEGER NOT NULL DEFAULT 0, received_at INTEGER NOT NULL,
    UNIQUE (store_id, ext_id)
  );
  CREATE INDEX pos_sales_t ON pos_sales (store_id, sold_at);
  CREATE TABLE pos_sale_items (
    sale_id INTEGER NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE, store_id INTEGER NOT NULL, sku_id TEXT NOT NULL,
    sold_at INTEGER NOT NULL, boxes REAL NOT NULL
  );
  CREATE INDEX pos_sale_items_t ON pos_sale_items (store_id, sold_at);

  CREATE TABLE inv_snapshots (
    store_id INTEGER NOT NULL, sku_id TEXT NOT NULL, t INTEGER NOT NULL, est REAL NOT NULL, band REAL NOT NULL,
    PRIMARY KEY (store_id, sku_id, t)
  ) WITHOUT ROWID;
  CREATE TABLE counts (
    id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, sku_id TEXT NOT NULL,
    t INTEGER NOT NULL, estimate REAL NOT NULL, actual REAL NOT NULL, band REAL NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('driver','ops','onboarding')), stop_id INTEGER, actor TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX counts_t ON counts (t);

  CREATE TABLE proposals (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, store_id INTEGER NOT NULL REFERENCES stores(id),
    status TEXT NOT NULL CHECK (status IN ('created','sent','payfail','paid','dispatched','delivered','held','expired','cancelled')),
    created_at INTEGER NOT NULL, trigger_sku TEXT, reproposal INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0,
    review INTEGER NOT NULL DEFAULT 0, send_rule TEXT NOT NULL DEFAULT 'auto', send_at INTEGER,
    sent_at INTEGER, opened_at INTEGER, reminded_at INTEGER, responded_at INTEGER, response TEXT, responder TEXT,
    closed_at INTEGER, modified INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL DEFAULT 0,
    pay_method TEXT, paid_at INTEGER, pay_ref TEXT, pay_failed_at INTEGER, pay_fail_reason TEXT,
    deliver_date TEXT, delivered_at INTEGER, token_nonce TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system'
  );
  CREATE INDEX proposals_store ON proposals (store_id, created_at);
  CREATE INDEX proposals_status ON proposals (status);
  CREATE TABLE proposal_lines (
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE, sku_id TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty >= 0), qty_orig INTEGER NOT NULL, est REAL NOT NULL, band REAL NOT NULL, safety REAL NOT NULL,
    trig INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL,
    PRIMARY KEY (proposal_id, sku_id)
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY, proposal_id INTEGER REFERENCES proposals(id), store_id INTEGER, kind TEXT NOT NULL,
    channel TEXT NOT NULL, to_phone TEXT NOT NULL DEFAULT '', template TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, provider_id TEXT, error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
  );
  CREATE INDEX messages_status ON messages (status);

  CREATE TABLE routes (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id), driver_id INTEGER REFERENCES drivers(id),
    dispatched_at INTEGER NOT NULL, token_nonce TEXT NOT NULL, UNIQUE (date, region_id)
  );
  CREATE TABLE stops (
    id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id), store_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    eta INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','arrived','done','failed')),
    arrived_at INTEGER, departed_at INTEGER, boxes INTEGER NOT NULL, fail_reason TEXT
  );
  CREATE INDEX stops_route ON stops (route_id);

  CREATE TABLE settlements (
    week_start TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','paid')),
    paid_at INTEGER, paid_by TEXT
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY, t INTEGER NOT NULL, kind TEXT NOT NULL, store_id INTEGER, proposal_id INTEGER, region_id TEXT,
    actor TEXT NOT NULL DEFAULT 'system', message TEXT NOT NULL
  );
  CREATE INDEX events_t ON events (t);
  `,
];

class Db {
  constructor(file) {
    this.file = file;
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.cache = new Map();
    this.depth = 0;
    this.version = 0; // 쓰기마다 증가 → 콘솔 스냅샷 ETag
    this.migrate();
  }
  migrate() {
    const cur = this.raw.prepare('PRAGMA user_version').get().user_version;
    for (let v = cur; v < MIGRATIONS.length; v++) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
        this.raw.exec('COMMIT');
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      }
    }
  }
  st(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  static args(p) {
    if (p == null) return [];
    if (Array.isArray(p)) return p.map(norm);
    const o = {};
    for (const k of Object.keys(p)) o[k] = norm(p[k]);
    return [o];
  }
  all(sql, p) { return this.st(sql).all(...Db.args(p)); }
  get(sql, p) { return this.st(sql).get(...Db.args(p)); }
  run(sql, p) { this.version++; return this.st(sql).run(...Db.args(p)); }
  exec(sql) { this.version++; this.raw.exec(sql); }
  /** 중첩 가능한 트랜잭션 (SAVEPOINT) */
  tx(fn) {
    const name = 'sp' + this.depth;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const r = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      this.version++;
      return r;
    } catch (e) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw e;
    }
  }
  close() { this.raw.close(); }
}
function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

module.exports = { Db };
