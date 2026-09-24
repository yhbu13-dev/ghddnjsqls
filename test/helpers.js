'use strict';
// 테스트용 소형 픽스처: 권역 1개, 기사 1명, 매장 2곳, SKU 3종

const { createContext } = require('../server/context');
const settings = require('../server/settings');
const T = require('../server/time');

/** 2026-03-10(화) 기준 KST 시각 */
const day = T.parseDate('2026-03-10');
const at = (h, dayOffset = 0) => day + dayOffset * T.DAY + h * T.HOUR;

function fixture(patch = {}) {
  const ctx = createContext({ file: ':memory:', env: {} });
  settings.save(ctx.db, { pilot_start: '2026-03-02', public_base_url: 'https://ops.example.com', ...patch });
  ctx.reload();
  const { db } = ctx;
  db.run("INSERT INTO regions (id, name, area, hub_name, hub_lat, hub_lng, sort) VALUES ('GN', '강남권', '강남·역삼', '역삼 거점', 37.500, 127.036, 1)");
  db.run("INSERT INTO drivers (name, phone, region_id, vehicle) VALUES ('김기사', '010-0000-0001', 'GN', '1톤')");
  const skus = [['CL125', '콜라 1.25L', 12, 22800], ['SD150', '사이다 1.5L', 12, 22200], ['WT200', '생수 2L', 12, 11400]];
  skus.forEach(([id, name, pack, price], i) => db.run('INSERT INTO skus (id, name, pack, unit, price, sort) VALUES (?, ?, ?, ?, ?, ?)', [id, name, pack, '병', price, i]));
  const mk = (code, name, extra = {}) => {
    const r = db.run(`INSERT INTO stores (code, name, region_id, type, owner_name, owner_phone, lat, lng, pos_store_id, send_pref, review_required, created_at)
                      VALUES (?, ?, 'GN', 'D', '홍사장', '010-1234-5678', ?, ?, ?, ?, ?, ?)`,
    [code, name, extra.lat ?? 37.501, extra.lng ?? 127.037, 'POS-' + code, extra.send_pref || 'immediate', extra.review ? 1 : 0, at(0)]);
    const id = Number(r.lastInsertRowid);
    for (const [sku] of skus) db.run('INSERT INTO store_skus (store_id, sku_id, rate_manual) VALUES (?, ?, ?)', [id, sku, sku === 'CL125' ? 0.4 : 0.2]);
    return id;
  };
  const s1 = mk('GN-01', '역삼 테스트포차');
  const s2 = mk('GN-02', '강남 테스트식당', { lat: 37.51, lng: 127.05 });
  db.run("INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (NULL, '콜라 1.25L', 'CL125', 1)");
  db.run("INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (NULL, '사이다', 'SD150', 1)");
  db.run("INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (NULL, '세트A', 'CL125', 1)");
  db.run("INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (NULL, '세트A', 'SD150', 1)");
  return { ctx, db, s1, s2, at, day };
}

module.exports = { fixture, at, day };
