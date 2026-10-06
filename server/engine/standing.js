'use strict';
// 정기 발주와 하루 일정 알림 (스케줄러가 1분마다 호출)
// - 정기 발주 요일 아침(sheet_time): 지난 발주 수량으로 발주서를 채우고 점주에게 알림톡, 관리자에게 발송 현황
// - 마감 전(alert_unconfirmed): 발주서를 받고도 확정하지 않은 매장 → 관리자
// - 출고 전(alert_pick): 오늘 출고 품목 합계 → 관리자
// - 저녁(alert_delivery): 오늘 배송 결과 → 관리자

const T = require('../time');
const shop = require('./shop');
const adminNotify = require('../adminNotify');
const today = require('../api/today');

const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

/** 하루에 한 번만: 처음 표시하면 true */
function once(db, day, kind, now) {
  return db.run('INSERT OR IGNORE INTO daily_marks (day, kind, t) VALUES (?, ?, ?)', [day, kind, now]).changes === 1;
}

function tick(ctx, now) {
  const { db, R } = ctx;
  const h = T.kstHour(now), day = T.dateStr(now), mid = T.kstMidnight(now), dow = String(T.kstDow(now));
  const out = { sheets: 0 };

  // 1) 정기 발주서
  if (h >= R.sheetH && h < R.cutoffH) {
    const due = db.all("SELECT * FROM stores WHERE active = 1 AND standing_days != '' AND (sheet_at IS NULL OR sheet_at < ?)", [mid])
      .filter((s) => s.standing_days.split(',').includes(dow));
    const made = [];
    for (const s of due) {
      try { made.push({ store: s, ...shop.prepareSheet(ctx, s.id, now, { notify: true }) }); } catch { db.run('UPDATE stores SET sheet_at = ? WHERE id = ?', [now, s.id]); } // 지난 발주가 없으면 오늘은 건너뜀
    }
    out.sheets = made.length;
    if (made.length) {
      const items = (made.length > 5 ? made.slice(0, 4) : made).map((m) => [m.store.name, `${m.count}품목`]);
      if (made.length > 5) items.push([`외 ${made.length - 4}곳`, `${made.slice(4).reduce((a, m) => a + m.count, 0)}품목`]);
      adminNotify.notify(ctx, 'sheets', `${day}:${now}`, adminNotify.feed(ctx, {
        profile: 'BevFlow 정기 발주서', title: `📋 정기 발주서 ${made.length}곳 발송`, desc: `${R.cutoff} 마감 · ${R.alert_unconfirmed}에 미확정 매장을 알려 드려요`,
        items, sum: ['예상 합계', won(made.reduce((a, m) => a + m.amount, 0))], buttons: [['발주서 현황', '/a#sum']],
      }), now);
    }
  }

  // 2) 미확정 발주서 (마감 전)
  if (h >= R.unconfirmedH && h < R.cutoffH && db.get('SELECT 1 FROM stores WHERE sheet_at >= ?', [mid]) && once(db, day, 'unconfirmed', now)) {
    const w = today.build(ctx, { role: 'admin' }, now, now).waiting;
    if (w.length) {
      const items = (w.length > 5 ? w.slice(0, 4) : w).map((x) => [x.store, x.phone || (x.seenAt ? '열어 봄' : '안 열어 봄')]);
      if (w.length > 5) items.push([`외 ${w.length - 4}곳`, '']);
      adminNotify.notify(ctx, 'unconfirmed', day, adminNotify.feed(ctx, {
        profile: 'BevFlow 마감 전 확인', title: `⏰ 미확정 발주서 ${w.length}곳`, desc: `${R.cutoff}이 지나면 다음 배송일로 넘어가요`, items, buttons: [['미확정 목록', '/a#sum']],
      }), now);
    }
  }

  // 3) 오늘 출고 합계
  if (h >= R.pickH && R.days.has(T.kstDow(now)) && once(db, day, 'pick', now)) {
    const t = today.build(ctx, { role: 'admin' }, now, now);
    if (t.pick.length) {
      const items = t.pick.slice(0, 4).map((p) => [p.name, `${p.qty}${p.u}`]);
      if (t.pick.length > 4) items.push([`외 ${t.pick.length - 4}품목`, `${t.pick.slice(4).reduce((a, p) => a + p.qty, 0)}개`]);
      adminNotify.notify(ctx, 'pick', day, adminNotify.feed(ctx, {
        profile: 'BevFlow 출고 준비', title: `🚚 오늘 ${R.dispatch} 출고 합계`, desc: `${t.summary.outStores}곳 · ${t.pick.length}품목`,
        items, sum: [`${t.summary.outQty}개`, won(t.summary.outAmount)], buttons: [['출고 집계 전체', '/a#pick'], ['발주 내역', '/a#list']],
      }), now);
    }
  }

  // 4) 배송 결과
  if (h >= R.deliveryAlertH && once(db, day, 'delivery', now)) {
    const s = today.build(ctx, { role: 'admin' }, now, now).summary;
    if (s.delivered || s.failed.length) {
      adminNotify.notify(ctx, 'delivery', day, adminNotify.feed(ctx, {
        profile: 'BevFlow 배송 결과', title: `📦 배송 ${s.delivered}곳 완료${s.failed.length ? ` · ${s.failed.length}곳 실패` : ''}`,
        desc: s.failed.length ? '실패한 매장은 다음 배송일로 다시 배차됐어요' : '오늘 배송을 모두 마쳤어요',
        items: s.failed.slice(0, 5).map((f) => [f.store, f.reason || '사유 없음']), buttons: [['오늘 요약', '/a#sum']],
      }), now);
    }
  }
  return out;
}

module.exports = { tick, once };
