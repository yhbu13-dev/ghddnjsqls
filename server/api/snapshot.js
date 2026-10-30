'use strict';
// 콘솔 스냅샷 — 운영 콘솔이 한 번에 받아 그리는 데이터 묶음 (최근 45일 + 진행 중 건)

const T = require('../time');
const inv = require('../engine/inventory');
const settlement = require('../engine/settlement');

// 판매 이력이 부족한 매장의 기본 시간대 분포 (L=점심 중심, D=저녁 중심)
const DEFAULT_PROFILE = {
  L: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, .02, .14, .20, .12, .04, .02, .03, .10, .14, .11, .06, .02, 0, 0],
  D: [.03, .01, 0, 0, 0, 0, 0, 0, 0, 0, 0, .02, .04, .02, 0, 0, .02, .07, .13, .17, .17, .14, .10, .08],
};

const r4 = (x) => (x == null ? x : Math.round(x * 1e4) / 1e4);
const maskPhone = (p) => String(p || '').replace(/(\d{2,3})[- ]?(\d{3,4})[- ]?(\d{4})/, '$1-****-$3');

/** 파일럿 전체 기간의 주차별 3대 지표 · 매장별 성과 · 정차 시간 분포 */
function pilot(ctx, now) {
  const { db, R } = ctx;
  const ps = R.pilotStart, WK = 7 * T.DAY;
  const n = Math.max(1, Math.floor((now - ps) / WK) + 1);
  const weeks = Array.from({ length: n }, (_, i) => ({ week: i + 1, start: ps + i * WK, decided: 0, approved: 0, counts: 0, errSum: 0, hits: 0, stops: 0, stopSum: 0 }));
  const at = (w) => weeks[Math.max(0, Math.min(n - 1, w))];
  for (const r of db.all(`SELECT CAST((created_at - ?) / ? AS INTEGER) AS w, SUM(response = 'approve') AS a, SUM(response IN ('approve','hold','none')) AS d
                          FROM proposals WHERE created_at >= ? AND status != 'cancelled' AND source = 'auto' GROUP BY w`, [ps, WK, ps])) { at(r.w).approved += r.a; at(r.w).decided += r.d; }
  for (const r of db.all(`SELECT CAST((t - ?) / ? AS INTEGER) AS w, COUNT(*) AS c, SUM(ABS(estimate - actual) / MAX(actual, 0.5)) AS e, SUM(ABS(estimate - actual) <= band) AS h
                          FROM counts WHERE source != 'onboarding' AND t >= ? GROUP BY w`, [ps, WK, ps])) { at(r.w).counts += r.c; at(r.w).errSum += r.e; at(r.w).hits += r.h; }
  for (const r of db.all(`SELECT CAST((departed_at - ?) / ? AS INTEGER) AS w, COUNT(*) AS c, SUM((departed_at - arrived_at) / 60000.0) AS s
                          FROM stops WHERE status = 'done' AND departed_at >= ? AND arrived_at IS NOT NULL GROUP BY w`, [ps, WK, ps])) { at(r.w).stops += r.c; at(r.w).stopSum += r.s; }
  const hist = db.all(`SELECT MIN(12, MAX(3, CAST((departed_at - arrived_at) / 60000.0 AS INTEGER))) AS b, COUNT(*) AS c FROM stops
                       WHERE status = 'done' AND arrived_at IS NOT NULL AND departed_at >= ? GROUP BY b`, [ps]);
  const perf = new Map();
  for (const r of db.all(`SELECT store_id, response, sent_at, responded_at FROM proposals WHERE created_at >= ? AND response IN ('approve','hold','none') AND status != 'cancelled' AND source = 'auto'`, [ps])) {
    if (!perf.has(r.store_id)) perf.set(r.store_id, { store: r.store_id, decided: 0, approved: 0, holds: 0, nones: 0, resp: [] });
    const x = perf.get(r.store_id);
    x.decided++;
    if (r.response === 'approve') x.approved++;
    if (r.response === 'hold') x.holds++;
    if (r.response === 'none') x.nones++;
    if (r.responded_at && r.sent_at) x.resp.push((r.responded_at - r.sent_at) / 60e3);
  }
  const storePerf = [...perf.values()].map((x) => { x.resp.sort((a, b) => a - b); return { store: x.store, decided: x.decided, approved: x.approved, holds: x.holds, nones: x.nones, medResp: x.resp.length ? x.resp[Math.floor(x.resp.length / 2)] : null }; });
  const paid = db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS g, COALESCE(SUM((SELECT SUM(qty) FROM proposal_lines l WHERE l.proposal_id = p.id)), 0) AS b,
                         MIN(paid_at) AS f FROM proposals p WHERE paid_at >= ? AND status != 'cancelled'`, [ps]);
  const activeStores = db.get('SELECT COUNT(*) AS c FROM stores WHERE active = 1').c;
  // 당일배송 달성률: 배송 요일에 컷오프 전 결제된 발주 중 결제일에 도착한 비율 (오늘 결제분 제외)
  const today = T.kstMidnight(now);
  const sd = (from) => db.get(`SELECT COUNT(*) AS n, SUM(status = 'delivered' AND CAST((delivered_at + 32400000) / 86400000 AS INTEGER) = CAST((paid_at + 32400000) / 86400000 AS INTEGER)) AS ok
                               FROM proposals WHERE paid_at >= ? AND paid_at < ? AND status != 'cancelled' AND ((paid_at + 32400000) % 86400000) < ?
                                 AND ((CAST((paid_at + 32400000) / 86400000 AS INTEGER) + 4) % 7) IN (${[...R.days].map(Number).join(',')})`, [from, today, R.cutoffH * T.HOUR]);
  const all = sd(ps), last7 = sd(today - 7 * T.DAY);
  const gmv14 = db.get("SELECT COALESCE(SUM(amount), 0) AS g FROM proposals WHERE paid_at >= ? AND paid_at < ? AND status != 'cancelled'", [today - 14 * T.DAY, today]).g / 14;
  return { weeks, hist, storePerf, orders: paid.n, gmv: paid.g, boxes: paid.b, firstPaidAt: paid.f, activeStores,
    sameDay: { n: all.n, ok: all.ok || 0, n7: last7.n, ok7: last7.ok || 0 }, gmv14 };
}

function mapProposal(p, lines) {
  return {
    pid: p.id, id: p.code, store: p.store_id, status: p.status, createdAt: p.created_at, sendAt: p.send_at, sentAt: p.sent_at,
    openAt: p.opened_at, remindedAt: p.reminded_at, respondAt: p.responded_at, response: p.response, responder: p.responder,
    closeAt: p.closed_at, paidAt: p.paid_at, payFailAt: p.pay_failed_at, payFailReason: p.pay_fail_reason, payMethod: p.pay_method, payRef: p.pay_ref,
    deliverDate: p.deliver_date, deliveredAt: p.delivered_at, amount: p.amount, reproposal: !!p.reproposal, manual: !!p.manual,
    review: !!p.review, sendRule: p.send_rule, modify: !!p.modified, createdBy: p.created_by, source: p.source,
    lines: (lines || []).sort((a, b) => (b.trig - a.trig) || (b.qty * b.price - a.qty * a.price)),
  };
}
const mapLine = (l) => ({ sku: l.sku_id, qty: l.qty, qtyOrig: l.qty_orig, E: r4(l.est), w: r4(l.band), S: l.safety, trig: !!l.trig, price: l.price });
const mapStop = (s) => ({ sid: s.id, route: s.route_id, date: s.date, region: s.region_id, driver: s.driver_id, proposal: s.proposal_id, store: s.store_id, seq: s.seq, eta: s.eta, status: s.status, arrivedAt: s.arrived_at, departedAt: s.departed_at, boxes: s.boxes, failReason: s.fail_reason });

/** 재고 차트용 매장 이력 (스냅샷 + 실사 + 제안 + 배송, 최근 N일) */
function storeHistory(ctx, storeId, sku, days, now) {
  const { db } = ctx;
  const since = now - days * T.DAY;
  const P = db.all('SELECT * FROM proposals WHERE store_id = ? AND created_at >= ? ORDER BY id', [storeId, since]);
  const lines = new Map();
  for (const l of db.all('SELECT l.* FROM proposal_lines l JOIN proposals p ON p.id = l.proposal_id WHERE p.store_id = ? AND p.created_at >= ?', [storeId, since])) {
    if (!lines.has(l.proposal_id)) lines.set(l.proposal_id, []);
    lines.get(l.proposal_id).push(mapLine(l));
  }
  return {
    points: db.all('SELECT t, est AS E, band AS w FROM inv_snapshots WHERE store_id = ? AND sku_id = ? AND t >= ? ORDER BY t', [storeId, sku, since]).map((x) => ({ t: x.t, E: r4(x.E), w: r4(x.w) })),
    counts: db.all("SELECT sku_id, t, estimate, actual, band, source, stop_id FROM counts WHERE store_id = ? AND t >= ? AND source != 'onboarding' ORDER BY t", [storeId, since])
      .map((c) => ({ sku: c.sku_id, t: c.t, E: r4(c.estimate), T: r4(c.actual), w: r4(c.band), source: c.source, stop: c.stop_id })),
    proposals: P.map((p) => mapProposal(p, lines.get(p.id))),
    stops: db.all('SELECT s.*, r.date, r.region_id, r.driver_id FROM stops s JOIN routes r ON r.id = s.route_id WHERE s.store_id = ? AND r.date >= ? ORDER BY s.id', [storeId, T.dateStr(since)]).map(mapStop),
  };
}

function build(ctx, user, now) {
  const { db, R } = ctx;
  const since = now - 3 * T.DAY;                       // 칸반·알림톡 모니터용 최근 제안
  const sinceDate = T.dateStr(now - 14 * T.DAY);       // 정차 시간 분포(최근 2주)용 배송
  const viewer = user.role === 'viewer';

  const pos7 = new Map(db.all('SELECT store_id, sku_id, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, sku_id', [now - 7 * T.DAY])
    .map((r) => [r.store_id + '|' + r.sku_id, r.b / 7]));
  const prof = new Map();
  for (const r of db.all(`SELECT store_id, ((sold_at + 32400000) / 3600000) % 24 AS h, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, h`, [now - 14 * T.DAY])) {
    if (!prof.has(r.store_id)) prof.set(r.store_id, new Array(24).fill(0));
    prof.get(r.store_id)[r.h] = r.b;
  }
  const itemsBy = new Map();
  for (const it of db.all(`SELECT ss.*, k.pack, k.price FROM store_skus ss JOIN skus k ON k.id = ss.sku_id WHERE ss.carried = 1 AND k.active = 1 AND k.category = 'beverage' ORDER BY k.sort, k.id`)) {
    if (!itemsBy.has(it.store_id)) itemsBy.set(it.store_id, []);
    itemsBy.get(it.store_id).push({
      sku: it.sku_id, E: r4(it.est), w: r4(it.band), S: inv.safetyOf(it, R), r: r4(inv.rateOf(it, R)), rateSource: it.rate != null ? 'pos' : it.rate_manual != null ? 'manual' : 'default',
      pos7: r4(pos7.get(it.store_id + '|' + it.sku_id) || 0),
      lastCount: it.last_count_at != null ? { t: it.last_count_at, E: it.last_count_est, T: it.last_count_actual, w: it.last_count_band } : null,
      lastIn: it.last_in_at != null ? { t: it.last_in_at, q: it.last_in_qty } : null,
    });
  }
  const stores = db.all('SELECT * FROM stores ORDER BY region_id, code').map((s) => {
    let p = prof.get(s.id);
    const tot = p ? p.reduce((a, b) => a + b, 0) : 0;
    p = tot > 1 ? p.map((x) => r4(x / tot)) : DEFAULT_PROFILE[s.type];
    return {
      idx: s.id, id: s.code, name: s.name, region: s.region_id, type: s.type, biz: s.biz, alpha: s.alpha, beta: s.beta != null ? s.beta : R.band_beta,
      breakPref: s.send_pref === 'break', exception: !!s.review_required, active: !!s.active,
      lat: s.lat, lng: s.lng, address: s.address, owner: s.owner_name, phone: viewer ? maskPhone(s.owner_phone) : s.owner_phone,
      lastPosAt: s.last_pos_at, cooldownUntil: s.cooldown_until, profile: p, items: itemsBy.get(s.id) || [],
      onboarded: (itemsBy.get(s.id) || []).some((i) => i.lastCount),
    };
  });

  const P = db.all(`SELECT * FROM proposals WHERE created_at >= ? OR status IN ('created','sent','payfail','paid','dispatched') ORDER BY id`, [since]);
  const ids = new Set(P.map((p) => p.id));
  const lines = new Map();
  for (const l of db.all('SELECT l.* FROM proposal_lines l JOIN proposals p ON p.id = l.proposal_id WHERE p.created_at >= ? OR p.status IN (\'created\',\'sent\',\'payfail\',\'paid\',\'dispatched\')', [since])) {
    if (!ids.has(l.proposal_id)) continue;
    if (!lines.has(l.proposal_id)) lines.set(l.proposal_id, []);
    lines.get(l.proposal_id).push(mapLine(l));
  }
  const proposals = P.map((p) => mapProposal(p, lines.get(p.id)));

  const stops = db.all(`SELECT s.*, r.date, r.region_id, r.driver_id FROM stops s JOIN routes r ON r.id = s.route_id WHERE r.date >= ? ORDER BY r.date, r.region_id, s.seq`, [sinceDate])
    .map(mapStop);
  const messages = db.all('SELECT id, proposal_id, store_id, kind, channel, to_phone, template, body, status, attempts, error, created_at, sent_at FROM messages WHERE created_at >= ? ORDER BY id DESC LIMIT 400', [now - 3 * T.DAY])
    .map((m) => ({ ...m, to_phone: viewer ? maskPhone(m.to_phone) : m.to_phone }));
  const events = db.all('SELECT * FROM events WHERE t >= ? ORDER BY id DESC LIMIT 300', [now - 36 * T.HOUR]);

  return {
    version: db.version, now, user,
    settings: {
      cutoff: R.cutoffH, dispatch: R.dispatchH, deliveryDays: [...R.days], expireHours: R.expire_hours, pilotStart: R.pilotStart,
      feeRate: R.fee_rate, driverCapacity: R.driver_capacity, targets: { approval: R.target_approval, stop: R.target_stop, error: R.target_error },
      payMethod: R.pay_method, notifier: R.notifier, sampleData: !!R.sample_data, orderLinkHours: R.order_link_hours, coverDays: R.cover_days, bandW0: R.band_w0, retryAt: R.retryH,
    },
    regions: db.all('SELECT * FROM regions ORDER BY sort, id'),
    drivers: db.all('SELECT id, name, phone, region_id, vehicle, capacity, active FROM drivers ORDER BY id').map((d) => ({ ...d, phone: viewer ? maskPhone(d.phone) : d.phone })),
    skus: db.all('SELECT * FROM skus ORDER BY sort, id'),
    stores, proposals, stops, messages, events,
    routes: db.all('SELECT id, date, region_id, driver_id, dispatched_at FROM routes WHERE date >= ?', [T.dateStr(now - 2 * T.DAY)]),
    settlements: settlement.weeks(ctx, now),
    pilot: pilot(ctx, now),
    unmapped: db.get('SELECT COUNT(*) AS c FROM unmapped_menu').c,
    outboxFailed: db.get("SELECT COUNT(*) AS c FROM messages WHERE status = 'failed'").c,
    accessPending: db.get("SELECT COUNT(*) AS c FROM store_categories WHERE status = 'pending'").c,
  };
}

module.exports = { build, storeHistory, DEFAULT_PROFILE, maskPhone };
