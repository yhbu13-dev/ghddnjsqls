'use strict';
// 테이블 구조와 업그레이드. 내 컴퓨터(Node SQLite)와 클라우드(Cloudflare D1)가 똑같이 쓴다.

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
CREATE TABLE IF NOT EXISTS links (        -- 카카오 챗봇 사용자 → 지금 보고 있는 매장
  user_key TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  linked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_stores (  -- 카카오 챗봇 사용자가 연결한 매장들 (여러 지점 가능)
  user_key TEXT NOT NULL,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (user_key, store_id)
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('cafe','snack','beverage')),
  grp TEXT NOT NULL DEFAULT '기타',        -- 진열대·분류 (예: 과자, 음료, 시럽)
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',          -- 규격 (예: 1박스 20입)
  unit TEXT NOT NULL DEFAULT '개',
  price INTEGER NOT NULL CHECK (price >= 0),
  image TEXT NOT NULL DEFAULT '',          -- 품목 사진 파일 이름 (data/images/)
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
CREATE TABLE IF NOT EXISTS images (       -- 품목 사진 (base64). 클라우드에서도 파일 저장소 없이 DB 하나로
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (       -- 관리자 화면 '새 소식' (새 주문·품목 신청)
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (     -- 연결 코드·로그인 시도 횟수 제한
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attempts_key ON attempts (key, at);
CREATE TABLE IF NOT EXISTS meta (         -- 서버가 스스로 만든 값 (서명 비밀키·스킬 키 등)
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
`;

// 주석을 지우고 문장 단위로 나눈다 (D1 은 한 번에 한 문장씩 실행)
const STATEMENTS = SCHEMA.split(';')
  .map((s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').trim())
  .filter(Boolean);

/** 테이블 만들기 + 예전 버전 DB 업그레이드. 여러 번 불러도 안전 */
async function migrate(db) {
  await db.batch(STATEMENTS.map((s) => [s, []]));
  const cols = await db.all('PRAGMA table_info(items)');
  if (!cols.some((c) => c.name === 'image')) await db.run("ALTER TABLE items ADD COLUMN image TEXT NOT NULL DEFAULT ''");
  await db.run('INSERT OR IGNORE INTO user_stores (user_key, store_id, linked_at) SELECT user_key, store_id, linked_at FROM links');
}

/** 서버가 스스로 만들어 보관하는 값 (없으면 만들어 저장) */
async function metaValue(db, key, make) {
  const row = await db.get('SELECT value FROM meta WHERE key = ?', [key]);
  if (row) return row.value;
  await db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [key, make()]);
  return (await db.get('SELECT value FROM meta WHERE key = ?', [key])).value;
}

module.exports = { SCHEMA, STATEMENTS, migrate, metaValue };
