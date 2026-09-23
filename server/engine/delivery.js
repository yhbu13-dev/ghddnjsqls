'use strict';
// 출고·배차와 기사 작업
// 배차: 배송일이 된 결제 완료 발주를 권역별 라우트로 묶고, 거점에서 가까운 순(최근접 이웃)으로 정차 순서를 정한다.
// 하차: 기사가 도착 → 잔량 확인(실사) → 하차 완료. 실사값은 추정 엔진에 바로 반영된다.

const T = require('../time');
const tokens = require('../tokens');
const inv = require('./inventory');
const msg = require('./messages');
const { logEvent } = require('./events');

const dist = (a, b) => (a.lat == null || b.lat == null ? null : Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88.2));

function orderStops(start, stores) {
  const left = stores.slice();
  const out = [];
  let cur = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => {
      const d = dist(cur, s);
      const dd = d == null ? 1e6 + i : d;
      if (dd < bd) { bd = dd; bi = i; }
    });
    cur = left.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

/** 배차 실행 (멱등: 아직 배차되지 않은 건만 추가) */
function dispatch(ctx, dateMid, now, actor = 'system') {
  const { db, R } = ctx;
  const date = T.dateStr(dateMid + T.HOUR);
  const startAt = Math.max(now, T.at(dateMid, R.dispatchH));
  const result = [];
  db.tx(() => {
    for (const rg of db.all('SELECT * FROM regions ORDER BY sort, id')) {
      const orders = db.all(`SELECT p.*, s.lat, s.lng, s.name AS store_name FROM proposals p JOIN stores s ON s.id = p.store_id
                             WHERE p.status = 'paid' AND p.deliver_date <= ? AND s.region_id = ? ORDER BY p.paid_at`, [date, rg.id]);
      if (!orders.length) continue;
      let route = db.get('SELECT * FROM routes WHERE date = ? AND region_id = ?', [date, rg.id]);
      if (!route) {
        const driver = db.get('SELECT * FROM drivers WHERE region_id = ? AND active = 1 ORDER BY id LIMIT 1', [rg.id]);
        const r = db.run('INSERT INTO routes (date, region_id, driver_id, dispatched_at, token_nonce) VALUES (?, ?, ?, ?, ?)',
          [date, rg.id, driver ? driver.id : null, now, tokens.nonce()]);
        route = db.get('SELECT * FROM routes WHERE id = ?', [Number(r.lastInsertRowid)]);
      }
      const last = db.get(`SELECT s.seq, s.eta, st.lat, st.lng FROM stops s JOIN stores st ON st.id = s.store_id WHERE s.route_id = ? ORDER BY s.seq DESC LIMIT 1`, [route.id]);
      const start = last ? { lat: last.lat, lng: last.lng } : { lat: rg.hub_lat, lng: rg.hub_lng };
      let seq = last ? last.seq : 0;
      let clock = last && last.eta ? Math.max(last.eta + R.stop_min * 60e3, startAt) : startAt;
      for (const o of orderStops(start, orders)) {
        clock += R.drive_min * 60e3;
        const boxes = db.get('SELECT COALESCE(SUM(qty), 0) AS b FROM proposal_lines WHERE proposal_id = ?', [o.id]).b;
        db.run('INSERT INTO stops (route_id, proposal_id, store_id, seq, eta, boxes) VALUES (?, ?, ?, ?, ?, ?)', [route.id, o.id, o.store_id, ++seq, clock, boxes]);
        db.run("UPDATE proposals SET status = 'dispatched' WHERE id = ?", [o.id]);
        clock += R.stop_min * 60e3;
      }
      logEvent(db, { t: now, kind: '출고', region_id: rg.id, actor, message: `${rg.name} ${orders.length}건 출고 · 배차` });
      result.push({ region: rg.id, route: route.id, added: orders.length });
    }
  });
  return result;
}

function driverLink(ctx, route) {
  const exp = T.parseDate(route.date) + 2 * T.DAY;
  return ctx.R.public_base_url + '/d/' + tokens.sign(ctx.secret, { k: 'd', id: route.id, n: route.token_nonce, e: exp });
}

function loadStop(db, stopId, routeId) {
  const s = db.get('SELECT * FROM stops WHERE id = ?', [stopId]);
  if (!s || (routeId != null && s.route_id !== routeId)) throw new Error('정차 정보를 찾을 수 없습니다');
  return s;
}

function arrive(ctx, stopId, { routeId = null, actor = 'driver' } = {}, now = Date.now()) {
  const { db } = ctx;
  return db.tx(() => {
    const s = loadStop(db, stopId, routeId);
    if (s.status !== 'pending') throw new Error('이미 도착 처리된 정차입니다');
    db.run("UPDATE stops SET status = 'arrived', arrived_at = ? WHERE id = ?", [now, stopId]);
    const st = db.get('SELECT name, region_id FROM stores WHERE id = ?', [s.store_id]);
    logEvent(db, { t: now, kind: '도착', store_id: s.store_id, proposal_id: s.proposal_id, region_id: st.region_id, actor, message: `${st.name} · ${s.seq}번째 정차 도착` });
  });
}

/**
 * 하차 완료. counts = { skuId: 하차 전 잔량(박스) } — 기사 실사
 */
function complete(ctx, stopId, { counts = null, routeId = null, actor = 'driver' } = {}, now = Date.now()) {
  const { db } = ctx;
  return db.tx(() => {
    const s = loadStop(db, stopId, routeId);
    if (!['pending', 'arrived'].includes(s.status)) throw new Error('이미 처리된 정차입니다');
    const store = db.get('SELECT * FROM stores WHERE id = ?', [s.store_id]);
    const arrivedAt = s.arrived_at || now;
    if (counts && Object.keys(counts).length) inv.applyCount(ctx, store, counts, { source: 'driver', stopId, actor }, now);
    for (const l of db.all('SELECT sku_id, qty FROM proposal_lines WHERE proposal_id = ? AND qty > 0', [s.proposal_id])) {
      db.run('INSERT OR IGNORE INTO store_skus (store_id, sku_id) VALUES (?, ?)', [store.id, l.sku_id]);
      inv.applyReceipt(ctx, store, l.sku_id, l.qty, now);
    }
    db.run("UPDATE stops SET status = 'done', arrived_at = ?, departed_at = ? WHERE id = ?", [arrivedAt, now, stopId]);
    db.run("UPDATE proposals SET status = 'delivered', delivered_at = ? WHERE id = ?", [now, s.proposal_id]);
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [s.proposal_id]);
    msg.enqueue(ctx, p, 'delivered', now);
    logEvent(db, { t: now, kind: '배송 완료', store_id: store.id, proposal_id: p.id, region_id: store.region_id, actor, message: `${store.name} · 하차 ${s.boxes}박스 · 정차 ${((now - arrivedAt) / 60e3).toFixed(1)}분` });
  });
}

function fail(ctx, stopId, { reason = '', routeId = null, actor = 'driver' } = {}, now = Date.now()) {
  const { db, R } = ctx;
  return db.tx(() => {
    const s = loadStop(db, stopId, routeId);
    if (!['pending', 'arrived'].includes(s.status)) throw new Error('이미 처리된 정차입니다');
    const next = T.dateStr(T.nextDeliveryDay(T.kstMidnight(now), R.days, false) + T.HOUR);
    db.run("UPDATE stops SET status = 'failed', fail_reason = ?, departed_at = ? WHERE id = ?", [String(reason || '사유 미입력').slice(0, 200), now, stopId]);
    db.run("UPDATE proposals SET status = 'paid', deliver_date = ? WHERE id = ?", [next, s.proposal_id]);
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [s.proposal_id]);
    msg.enqueue(ctx, p, 'delivery_failed', now);
    const st = db.get('SELECT name, region_id FROM stores WHERE id = ?', [s.store_id]);
    logEvent(db, { t: now, kind: '배송 실패', store_id: s.store_id, proposal_id: p.id, region_id: st.region_id, actor, message: `${st.name} · ${reason || '사유 미입력'} → ${next} 재배송` });
  });
}

module.exports = { dispatch, driverLink, arrive, complete, fail, orderStops };
