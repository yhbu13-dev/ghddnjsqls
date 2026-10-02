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
  link_ver INTEGER NOT NULL DEFAULT 0,    -- 발주서 링크 버전. 올리면 예전 링크는 모두 무효
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
CREATE TABLE IF NOT EXISTS statements (   -- 실물 거래명세서 사진 (관리자가 올리고 점주가 봄)
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL,
  order_id INTEGER,                       -- 연결된 주문 (없으면 매장 전체용)
  title TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '',        -- 사진 이름들 (쉼표로 구분). /img/ 로는 열리지 않고 명세서 링크로만
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS statements_store ON statements (store_id, created_at);
CREATE INDEX IF NOT EXISTS statements_order ON statements (order_id);
CREATE TABLE IF NOT EXISTS notices (      -- 점주 카톡 알림 (주문 확인·출고 등). 카톡을 열면 보여 주고 seen=1
  id INTEGER PRIMARY KEY,
  user_key TEXT NOT NULL,
  store_id INTEGER NOT NULL,
  order_id INTEGER,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notices_user ON notices (user_key, seen);
CREATE TABLE IF NOT EXISTS meta (         -- 서버가 스스로 만든 값 (서명 비밀키·스킬 키·관리자 설정)
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
`;

// 주석을 지우고 문장 단위로 나눈다 (D1 은 한 번에 한 문장씩 실행)
const STATEMENTS = SCHEMA.split(';')
  .map((s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').trim())
  .filter(Boolean);

// 구조가 바뀌면 이 값이 바뀐다 → 이미 준비된 DB 는 확인 한 번으로 건너뜀 (클라우드는 서버가 자주 새로 켜져서 중요)
const VERSION = `${require('node:crypto').createHash('sha256').update(SCHEMA).digest('hex').slice(0, 12)}-m3`;

/** 테이블 만들기 + 예전 버전 DB 업그레이드. 여러 번 불러도 안전 */
async function migrate(db) {
  try {
    const row = await db.get("SELECT value FROM meta WHERE key = 'schema'");
    if (row && row.value === VERSION) return;
  } catch { /* 처음: meta 테이블이 아직 없음 */ }
  await db.batch(STATEMENTS.map((s) => [s, []]));
  const cols = await db.all('PRAGMA table_info(items)');
  if (!cols.some((c) => c.name === 'image')) await db.run("ALTER TABLE items ADD COLUMN image TEXT NOT NULL DEFAULT ''");
  const scols = await db.all('PRAGMA table_info(stores)');
  if (!scols.some((c) => c.name === 'link_ver')) await db.run('ALTER TABLE stores ADD COLUMN link_ver INTEGER NOT NULL DEFAULT 0');
  await db.run('INSERT OR IGNORE INTO user_stores (user_key, store_id, linked_at) SELECT user_key, store_id, linked_at FROM links');
  await db.run("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [VERSION]);
}

/** 서버가 스스로 만들어 보관하는 값 (없으면 만들어 저장) */
async function metaValue(db, key, make) {
  const row = await db.get('SELECT value FROM meta WHERE key = ?', [key]);
  if (row) return row.value;
  await db.run('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)', [key, make()]);
  return (await db.get('SELECT value FROM meta WHERE key = ?', [key])).value;
}

module.exports = { SCHEMA, STATEMENTS, migrate, metaValue };
