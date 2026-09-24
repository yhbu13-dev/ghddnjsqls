'use strict';
// 알림 발송 어댑터
// - console: 외부로 보내지 않고 콘솔 [알림톡 모니터]에만 기록 (파일럿 초기: 운영자가 링크를 복사해 카카오톡으로 전달)
// - webhook: 설정한 URL로 JSON POST. 알림톡 대행사(비즈메시지) 연동 서버나 자동화 도구에서 받아 실제 발송한다.
//   본문 서명: X-BevFlow-Signature: sha256=<HMAC(웹훅 시크릿, 본문)>
// TODO: 알림톡 API 연동 — 대행사 API를 직접 호출하려면 이 파일에 모드를 하나 추가하면 된다.

const crypto = require('node:crypto');

function createNotifier({ getRules, getSecret }) {
  return {
    async deliver(m) {
      const R = getRules();
      if (m.channel === 'console' || R.notifier === 'console') return { ok: true, id: 'console-' + m.id };
      if (!R.webhook_url) return { ok: false, error: '웹훅 URL이 설정되지 않았습니다' };
      const payload = JSON.parse(m.payload || '{}');
      const body = JSON.stringify({
        id: m.id, kind: m.kind, template: m.template, to: m.to_phone, text: m.body,
        variables: payload.variables || {}, buttons: payload.buttons || [], created_at: m.created_at,
      });
      const sig = crypto.createHmac('sha256', getSecret('webhook')).update(body).digest('hex');
      const res = await fetch(R.webhook_url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-bevflow-signature': 'sha256=' + sig }, body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: false, error: `웹훅 응답 ${res.status}` };
      let id = null;
      try { const j = await res.json(); id = j && (j.id || j.message_id) ? String(j.id || j.message_id) : null; } catch { /* 본문 없음 */ }
      return { ok: true, id };
    },
  };
}

module.exports = { createNotifier };
