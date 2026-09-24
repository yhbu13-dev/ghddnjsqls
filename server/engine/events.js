'use strict';
// 운영 이벤트 로그 (감사 기록 겸 콘솔 실시간 스트림)

function logEvent(db, e) {
  db.run('INSERT INTO events (t, kind, store_id, proposal_id, region_id, actor, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [e.t, e.kind, e.store_id ?? null, e.proposal_id ?? null, e.region_id ?? null, e.actor || 'system', e.message]);
}

module.exports = { logEvent };
