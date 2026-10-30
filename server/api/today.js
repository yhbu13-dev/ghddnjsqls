'use strict';
// 관리자 모바일 내역 (/a) — 하루치 발주 요약 · 출고 집계(품목별·권역별) · 발주 내역 · 미확정 발주서
// 관리자 카톡 알림의 버튼이 이 화면으로 연결된다.

const T = require('../time');
const { maskPhone } = require('./snapshot');

const SRC = { auto: '자동 제안', web: '발주서·화면', chat: '카톡 채팅' };

function build(ctx, user, at, now) {
  const { db } = ctx;
  const viewer = user.role === 'viewer';
  const mid = T.kstMidnight(at), end = mid + T.DAY, date = T.dateStr(at);
  const regions = db.all('SELECT id, name FROM regions ORDER BY sort, id');
  const rgName = Object.fromEntries(regions.map((r) => [r.id, r.name]));

  // 오늘 확정(결제 완료 이후 단계)된 발주
  const P = db.all(`SELECT p.*, s.name AS store_name, s.biz, s.region_id FROM proposals p JOIN stores s ON s.id = p.store_id
                    WHERE p.paid_at >= ? AND p.paid_at < ? AND p.status IN ('paid','dispatched','delivered') ORDER BY p.paid_at DESC`, [mid, end]);
  const lineStmt = (pid) => db.all(`SELECT l.sku_id AS sku, l.qty, l.price, k.name, k.pack, k.unit FROM proposal_lines l JOIN skus k ON k.id = l.sku_id
                                   WHERE l.proposal_id = ? AND l.qty > 0 ORDER BY l.qty * l.price DESC`, [pid]);
  const u = (k) => (k.pack === 1 ? k.unit : '박스');
  const orders = P.map((p) => {
    const lines = lineStmt(p.id);
    return { id: p.id, code: p.code, paidAt: p.paid_at, store: p.store_name, biz: p.biz, region: rgName[p.region_id] || p.region_id, source: p.source, sourceText: SRC[p.source] || p.source,
      status: p.status, deliverDate: p.deliver_date, amount: p.amount, n: lines.length, lines: lines.map((l) => ({ name: l.name, qty: l.qty, u: u(l), amount: l.qty * l.price })) };
  });

  // 오늘 출고분 품목 합계 (배송일이 오늘인 결제 완료 이후 발주) — 창고 피킹 리스트
  const pick = new Map();
  for (const r of db.all(`SELECT l.sku_id, k.name, k.pack, k.unit, k.category, k.grp, s.region_id, SUM(l.qty) AS q FROM proposal_lines l
                          JOIN proposals p ON p.id = l.proposal_id JOIN stores s ON s.id = p.store_id JOIN skus k ON k.id = l.sku_id
                          WHERE p.deliver_date = ? AND p.status IN ('paid','dispatched','delivered') AND l.qty > 0
                          GROUP BY l.sku_id, s.region_id`, [date])) {
    if (!pick.has(r.sku_id)) pick.set(r.sku_id, { sku: r.sku_id, name: r.name, u: u(r), category: r.category, grp: r.grp, qty: 0, byRegion: {} });
    const x = pick.get(r.sku_id);
    x.qty += r.q;
    x.byRegion[r.region_id] = (x.byRegion[r.region_id] || 0) + r.q;
  }
  const pickList = [...pick.values()].sort((a, b) => b.qty - a.qty);
  const outStores = db.get(`SELECT COUNT(DISTINCT store_id) AS c, COALESCE(SUM(amount), 0) AS a FROM proposals WHERE deliver_date = ? AND status IN ('paid','dispatched','delivered')`, [date]);

  // 오늘 발주서를 받았는데 아직 확정하지 않은 매장
  const waiting = db.all(`SELECT s.id, s.name, s.owner_phone, s.sheet_at, s.sheet_seen_at, (SELECT COUNT(*) FROM carts c WHERE c.store_id = s.id) AS n FROM stores s
                          WHERE s.active = 1 AND s.sheet_at >= ? AND s.sheet_at < ?
                            AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.store_id = s.id AND p.source != 'auto' AND p.created_at >= s.sheet_at AND p.status != 'cancelled')
                          ORDER BY s.name`, [mid, end])
    .map((s) => ({ id: s.id, store: s.name, phone: viewer ? maskPhone(s.owner_phone) : s.owner_phone, lines: s.n, seenAt: s.sheet_seen_at }));

  const stops = db.all(`SELECT st.status, st.fail_reason, s.name FROM stops st JOIN routes r ON r.id = st.route_id JOIN stores s ON s.id = st.store_id WHERE r.date = ?`, [date]);
  const bySource = {};
  for (const o of orders) bySource[o.sourceText] = (bySource[o.sourceText] || 0) + 1;

  return {
    date, now, regions,
    summary: {
      orders: orders.length, amount: orders.reduce((a, o) => a + o.amount, 0),
      outStores: outStores.c, outAmount: outStores.a, outQty: pickList.reduce((a, p) => a + p.qty, 0), outKinds: pickList.length,
      waiting: waiting.length, accessPending: db.get("SELECT COUNT(*) AS c FROM store_categories WHERE status = 'pending'").c,
      delivered: stops.filter((s) => s.status === 'done').length, failed: stops.filter((s) => s.status === 'failed').map((s) => ({ store: s.name, reason: s.fail_reason })),
      bySource,
    },
    waiting, pick: pickList, orders,
  };
}

module.exports = { build };
