'use strict';
// 티오더 정산 — 파일럿 시작일부터 7일 단위 주차로 결제 완료 GMV를 집계하고 수수료를 계산한다.
// 취소된 발주는 제외. 주차가 끝나면 '마감', 지급을 확인하면 '지급 완료'로 표시한다.

const T = require('../time');

function weeks(ctx, now) {
  const { db, R } = ctx;
  const start = R.pilotStart;
  const out = [];
  const marks = new Map(db.all('SELECT * FROM settlements').map((r) => [r.week_start, r]));
  for (let k = 0, ws = start; ws <= now; k++, ws += 7 * T.DAY) {
    const we = ws + 7 * T.DAY;
    const agg = db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS gmv FROM proposals
                        WHERE paid_at >= ? AND paid_at < ? AND status NOT IN ('cancelled')`, [ws, we]);
    const key = T.dateStr(ws);
    const mark = marks.get(key);
    const ended = now >= we;
    out.push({
      week: k + 1, start: key, end: T.dateStr(we - T.HOUR), orders: agg.n, gmv: agg.gmv,
      fee: Math.round(agg.gmv * R.fee_rate), fee_rate: R.fee_rate,
      pay_date: T.dateStr(we - T.HOUR + R.settle_lag_days * T.DAY),
      status: !ended ? 'open' : mark && mark.status === 'paid' ? 'paid' : 'closed', paid_at: mark ? mark.paid_at : null,
    });
  }
  return out;
}

function markPaid(ctx, weekStart, actor, now) {
  T.parseDate(weekStart);
  ctx.db.run(`INSERT INTO settlements (week_start, status, paid_at, paid_by) VALUES (?, 'paid', ?, ?)
              ON CONFLICT (week_start) DO UPDATE SET status = 'paid', paid_at = excluded.paid_at, paid_by = excluded.paid_by`, [weekStart, now, actor]);
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 스프레드시트 수식 주입 방지
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** 주차 정산 내역서 CSV (엑셀 호환 UTF-8 BOM) */
function csv(ctx, weekStart) {
  const { db, R } = ctx;
  const ws = T.parseDate(weekStart), we = ws + 7 * T.DAY;
  const rows = db.all(`SELECT p.code, p.paid_at, p.amount, p.pay_method, p.status, s.code AS store_code, s.name AS store_name, s.pos_store_id,
                         (SELECT COALESCE(SUM(qty), 0) FROM proposal_lines l WHERE l.proposal_id = p.id) AS boxes
                       FROM proposals p JOIN stores s ON s.id = p.store_id
                       WHERE p.paid_at >= ? AND p.paid_at < ? AND p.status NOT IN ('cancelled') ORDER BY p.paid_at`, [ws, we]);
  const head = ['발주번호', '결제일시(KST)', '매장코드', '매장명', '티오더 매장ID', '박스', '결제금액', `수수료(${(R.fee_rate * 100).toFixed(1)}%)`, '결제방식', '상태'];
  const lines = [head.map(csvCell).join(',')];
  let g = 0, f = 0;
  for (const r of rows) {
    const fee = Math.round(r.amount * R.fee_rate);
    g += r.amount; f += fee;
    lines.push([r.code, T.dateStr(r.paid_at) + ' ' + T.fmtTime(r.paid_at), r.store_code, r.store_name, r.pos_store_id || '', r.boxes, r.amount, fee, r.pay_method === 'invoice' ? '후불 청구' : '카드', r.status].map(csvCell).join(','));
  }
  lines.push(['합계', '', '', '', '', '', g, f, '', ''].map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { weeks, markPaid, csv, csvCell };
