'use strict';
// 스케줄러 — 1분마다 운영 규칙을 돌린다. now를 주입받아 테스트·샘플 데이터 생성에서도 같은 코드를 쓴다.

const T = require('./time');
const inv = require('./engine/inventory');
const props = require('./engine/proposals');
const delivery = require('./engine/delivery');
const msg = require('./engine/messages');
const standing = require('./engine/standing');
const adminNotify = require('./adminNotify');

async function tick(ctx, now, { flush = true } = {}) {
  const { db, R } = ctx;
  const st = ctx.jobState || (ctx.jobState = { snapHour: 0, rateHour: 0, dispatchDay: 0 });
  db.tx(() => {
    const hourTs = Math.floor(now / T.HOUR) * T.HOUR;
    if (st.rateHour !== hourTs) { inv.refreshRates(ctx, now); st.rateHour = hourTs; }
    props.evaluateTriggers(ctx, now);
    props.sendDue(ctx, now);
    props.sweepPending(ctx, now);
    // 출고·배차: 배송 요일의 배차 시각 이후 (늦게 결제된 오늘 배송분도 이어서 추가)
    const mid = T.kstMidnight(now);
    if (R.days.has(T.kstDow(now)) && T.kstHour(now) >= R.dispatchH) {
      const pending = db.get(`SELECT COUNT(*) AS c FROM proposals WHERE status = 'paid' AND deliver_date <= ?`, [T.dateStr(now)]).c;
      if (pending) delivery.dispatch(ctx, mid, now);
      st.dispatchDay = mid;
    }
    if (st.snapHour !== hourTs) { inv.snapshot(ctx, now); st.snapHour = hourTs; }
    standing.tick(ctx, now);
  });
  if (flush) {
    await msg.flushOutbox(ctx, now);
    await adminNotify.flush(ctx, now);
  }
}

/** 오래된 세션·스냅샷 정리 (하루 1회 정도) */
function housekeeping(ctx, now) {
  const { db } = ctx;
  db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  db.run('DELETE FROM inv_snapshots WHERE t < ?', [now - 90 * T.DAY]);
  db.run("DELETE FROM admin_notices WHERE created_at < ? AND status != 'queued'", [now - 30 * T.DAY]);
  db.run('DELETE FROM daily_marks WHERE t < ?', [now - 30 * T.DAY]);
}

function start(ctx, { intervalMs = 60e3, log = console } = {}) {
  let running = false;
  let lastHk = 0;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      await tick(ctx, now);
      if (now - lastHk > 6 * T.HOUR) { housekeeping(ctx, now); lastHk = now; }
    } catch (e) {
      log.error('[스케줄러] 오류:', e);
    } finally {
      running = false;
    }
  };
  run();
  const h = setInterval(run, intervalMs);
  return () => clearInterval(h);
}

module.exports = { tick, start, housekeeping };
