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

const maskPhone = (p) => String(p || '').replace(/(\d{2,3})[- ]?(\d{3,4})[- ]?(\d{4})/, '$1-****-$3');

function build(ctx, user, now) {
  const { db, R } = ctx;
  const since = now - 45 * T.DAY;
  const sinceDate = T.dateStr(since);
  const viewer = user.role === 'viewer';

  const pos7 = new Map(db.all('SELECT store_id, sku_id, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, sku_id', [now - 7 * T.DAY])
    .map((r) => [r.store_id + '|' + r.sku_id, r.b / 7]));
  const prof = new Map();
  for (const r of db.all(`SELECT store_id, ((sold_at + 32400000) / 3600000) % 24 AS h, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, h`, [now - 14 * T.DAY])) {
    if (!prof.has(r.store_id)) prof.set(r.store_id, new Array(24).fill(0));
    prof.get(r.store_id)[r.h] = r.b;
  }
  const itemsBy = new Map();
  for (const it of db.all(`SELECT ss.*, k.pack, k.price FROM store_skus ss JOIN skus k ON k.id = ss.sku_id WHERE ss.carried = 1 AND k.active = 1 ORDER BY k.sort, k.id`)) {
    if (!itemsBy.has(it.store_id)) itemsBy.set(it.store_id, []);
    itemsBy.get(it.store_id).push({
      sku: it.sku_id, E: it.est, w: it.band, S: inv.safetyOf(it, R), r: inv.rateOf(it, R), rateSource: it.rate != null ? 'pos' : it.rate_manual != null ? 'manual' : 'default',
      pos7: pos7.get(it.store_id + '|' + it.sku_id) || 0,
      lastCount: it.last_count_at != null ? { t: it.last_count_at, E: it.last_count_est, T: it.last_count_actual, w: it.last_count_band } : null,
      lastIn: it.last_in_at != null ? { t: it.last_in_at, q: it.last_in_qty } : null,
    });
  }
  const stores = db.all('SELECT * FROM stores ORDER BY region_id, code').map((s) => {
    let p = prof.get(s.id);
    const tot = p ? p.reduce((a, b) => a + b, 0) : 0;
    p = tot > 1 ? p.map((x) => x / tot) : DEFAULT_PROFILE[s.type];
    return {
      idx: s.id, id: s.code, name: s.name, region: s.region_id, type: s.type, alpha: s.alpha, beta: s.beta != null ? s.beta : R.band_beta,
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
    lines.get(l.proposal_id).push({ sku: l.sku_id, qty: l.qty, qtyOrig: l.qty_orig, E: l.est, w: l.band, S: l.safety, trig: !!l.trig, price: l.price });
  }
  const proposals = P.map((p) => ({
    pid: p.id, id: p.code, store: p.store_id, status: p.status, createdAt: p.created_at, sendAt: p.send_at, sentAt: p.sent_at,
    openAt: p.opened_at, remindedAt: p.reminded_at, respondAt: p.responded_at, response: p.response, responder: p.responder,
    closeAt: p.closed_at, paidAt: p.paid_at, payFailAt: p.pay_failed_at, payFailReason: p.pay_fail_reason, payMethod: p.pay_method, payRef: p.pay_ref,
    deliverDate: p.deliver_date, deliveredAt: p.delivered_at, amount: p.amount, reproposal: !!p.reproposal, manual: !!p.manual,
    review: !!p.review, sendRule: p.send_rule, modify: !!p.modified, createdBy: p.created_by,
    lines: (lines.get(p.id) || []).sort((a, b) => (b.trig - a.trig) || (b.qty * b.price - a.qty * a.price)),
  }));

  const stops = db.all(`SELECT s.*, r.date, r.region_id, r.driver_id FROM stops s JOIN routes r ON r.id = s.route_id WHERE r.date >= ? ORDER BY r.date, r.region_id, s.seq`, [sinceDate])
    .map((s) => ({ sid: s.id, route: s.route_id, date: s.date, region: s.region_id, driver: s.driver_id, proposal: s.proposal_id, store: s.store_id, seq: s.seq, eta: s.eta, status: s.status, arrivedAt: s.arrived_at, departedAt: s.departed_at, boxes: s.boxes, failReason: s.fail_reason }));
  const counts = db.all('SELECT store_id, sku_id, t, estimate, actual, band, source FROM counts WHERE t >= ? AND source != \'onboarding\'', [since])
    .map((c) => ({ store: c.store_id, sku: c.sku_id, t: c.t, E: c.estimate, T: c.actual, w: c.band, err: Math.abs(c.estimate - c.actual), hit: Math.abs(c.estimate - c.actual) <= c.band, source: c.source }));
  const messages = db.all('SELECT id, proposal_id, store_id, kind, channel, to_phone, template, body, status, attempts, error, created_at, sent_at FROM messages WHERE created_at >= ? ORDER BY id DESC LIMIT 400', [now - 3 * T.DAY])
    .map((m) => ({ ...m, to_phone: viewer ? maskPhone(m.to_phone) : m.to_phone }));
  const events = db.all('SELECT * FROM events WHERE t >= ? ORDER BY id DESC LIMIT 300', [now - 36 * T.HOUR]);

  return {
    version: db.version, now, user,
    settings: {
      cutoff: R.cutoffH, dispatch: R.dispatchH, deliveryDays: [...R.days], expireHours: R.expire_hours, pilotStart: R.pilotStart,
      feeRate: R.fee_rate, driverCapacity: R.driver_capacity, targets: { approval: R.target_approval, stop: R.target_stop, error: R.target_error },
      payMethod: R.pay_method, notifier: R.notifier, sampleData: !!R.sample_data, coverDays: R.cover_days, bandW0: R.band_w0, retryAt: R.retryH,
    },
    regions: db.all('SELECT * FROM regions ORDER BY sort, id'),
    drivers: db.all('SELECT id, name, phone, region_id, vehicle, capacity, active FROM drivers ORDER BY id').map((d) => ({ ...d, phone: viewer ? maskPhone(d.phone) : d.phone })),
    skus: db.all('SELECT * FROM skus ORDER BY sort, id'),
    stores, proposals, stops, counts, messages, events,
    routes: db.all('SELECT id, date, region_id, driver_id, dispatched_at FROM routes WHERE date >= ?', [T.dateStr(now - 2 * T.DAY)]),
    settlements: settlement.weeks(ctx, now),
    unmapped: db.get('SELECT COUNT(*) AS c FROM unmapped_menu').c,
    outboxFailed: db.get("SELECT COUNT(*) AS c FROM messages WHERE status = 'failed'").c,
  };
}

module.exports = { build, DEFAULT_PROFILE, maskPhone };
