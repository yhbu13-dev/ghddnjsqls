'use strict';
// 품목 카테고리와 매장별 이용 권한
// - 업종마다 기본 품목이 정해져 있다: 카페 → 카페 품목, 사우나 → 스낵 품목, 식당 → 음료 품목
// - 다른 품목은 점주가 신청하고(카카오톡·발주 화면) 운영자가 승인해야 발주 화면에 나타난다.

const { logEvent } = require('./events');
const adminNotify = require('../adminNotify');

const CATEGORIES = {
  cafe: { label: '카페 품목', short: '카페', icon: '☕' },
  snack: { label: '스낵 품목', short: '스낵', icon: '🍪' },
  beverage: { label: '음료 품목', short: '음료', icon: '🥤' },
};
const BIZ = {
  cafe: { label: '카페', category: 'cafe' },
  sauna: { label: '사우나', category: 'snack' },
  restaurant: { label: '식당', category: 'beverage' },
};
const CAT_IDS = Object.keys(CATEGORIES);

/** 업종 기본 품목을 승인 상태로 둔다 (매장 등록·업종 변경 때) */
function ensureDefault(db, store, actor, now) {
  const cat = BIZ[store.biz].category;
  const cur = db.get('SELECT status FROM store_categories WHERE store_id = ? AND category = ?', [store.id, cat]);
  if (cur && cur.status === 'approved') return;
  db.run(`INSERT INTO store_categories (store_id, category, status, requested_at, requested_via, decided_at, decided_by, decide_note)
          VALUES (?, ?, 'approved', ?, 'ops', ?, ?, '업종 기본 품목')
          ON CONFLICT (store_id, category) DO UPDATE SET status = 'approved', decided_at = excluded.decided_at, decided_by = excluded.decided_by, decide_note = excluded.decide_note`,
  [store.id, cat, now, now, actor]);
}

/** 매장의 카테고리별 상태 [{ id, label, icon, status: approved|pending|rejected|none, isDefault }] */
function storeCategories(db, store) {
  const rows = new Map(db.all('SELECT * FROM store_categories WHERE store_id = ?', [store.id]).map((r) => [r.category, r]));
  const def = BIZ[store.biz].category;
  return CAT_IDS.map((id) => {
    const r = rows.get(id);
    return { id, ...CATEGORIES[id], status: id === def ? 'approved' : r ? r.status : 'none', isDefault: id === def, decideNote: r ? r.decide_note : '', requestedAt: r ? r.requested_at : null };
  }).sort((a, b) => (b.isDefault - a.isDefault) || (a.status === 'approved' ? -1 : 0) - (b.status === 'approved' ? -1 : 0));
}

/** 발주할 수 있는 카테고리 (업종 기본 품목은 항상 포함) */
function approvedSet(db, storeId) {
  const st = db.get('SELECT biz FROM stores WHERE id = ?', [storeId]);
  if (!st) return new Set();
  const set = new Set(db.all("SELECT category FROM store_categories WHERE store_id = ? AND status = 'approved'", [storeId]).map((r) => r.category));
  set.add(BIZ[st.biz].category);
  return set;
}

/** 점주의 품목 이용 신청 */
function requestAccess(ctx, storeId, category, { via = 'web', note = '' } = {}, now = Date.now()) {
  const { db } = ctx;
  if (!CATEGORIES[category]) throw new Error('알 수 없는 품목입니다');
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    const cur = db.get('SELECT * FROM store_categories WHERE store_id = ? AND category = ?', [storeId, category]);
    if (BIZ[store.biz].category === category || (cur && cur.status === 'approved')) throw new Error('이미 이용 중인 품목입니다');
    if (cur && cur.status === 'pending') return { status: 'pending', already: true };
    db.run(`INSERT INTO store_categories (store_id, category, status, requested_at, requested_via, request_note)
            VALUES (?, ?, 'pending', ?, ?, ?)
            ON CONFLICT (store_id, category) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at, requested_via = excluded.requested_via,
              request_note = excluded.request_note, decided_at = NULL, decided_by = NULL, decide_note = ''`,
    [storeId, category, now, via, String(note || '').slice(0, 200)]);
    logEvent(db, { t: now, kind: '품목 신청', store_id: storeId, region_id: store.region_id, actor: 'owner:' + via, message: `${store.name} · ${CATEGORIES[category].label} 이용 신청` });
    adminNotify.accessRequest(ctx, store, CATEGORIES[category].label, String(note || '').slice(0, 60), now);
    return { status: 'pending' };
  });
}

/** 운영자 결정: approve · reject · revoke(승인 취소) */
function decide(ctx, storeId, category, action, { actor, note = '' }, now = Date.now()) {
  const { db } = ctx;
  if (!CATEGORIES[category]) throw new Error('알 수 없는 품목입니다');
  if (!['approve', 'reject', 'revoke'].includes(action)) throw new Error('알 수 없는 처리입니다');
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    if (action !== 'approve' && BIZ[store.biz].category === category) throw new Error('업종 기본 품목은 거절·해제할 수 없습니다. 업종을 먼저 바꿔 주세요');
    const status = action === 'approve' ? 'approved' : 'rejected';
    db.run(`INSERT INTO store_categories (store_id, category, status, requested_at, requested_via, decided_at, decided_by, decide_note)
            VALUES (?, ?, ?, ?, 'ops', ?, ?, ?)
            ON CONFLICT (store_id, category) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at, decided_by = excluded.decided_by, decide_note = excluded.decide_note`,
    [storeId, category, status, now, now, actor, String(note || '').slice(0, 200)]);
    if (status !== 'approved') db.run('DELETE FROM carts WHERE store_id = ? AND sku_id IN (SELECT id FROM skus WHERE category = ?)', [storeId, category]);
    const word = { approve: '승인', reject: '거절', revoke: '이용 해제' }[action];
    logEvent(db, { t: now, kind: '품목 ' + word, store_id: storeId, region_id: store.region_id, actor, message: `${store.name} · ${CATEGORIES[category].label} ${word}${note ? ' · ' + note : ''}` });
    return { status };
  });
}

module.exports = { CATEGORIES, BIZ, CAT_IDS, ensureDefault, storeCategories, approvedSet, requestAccess, decide };
