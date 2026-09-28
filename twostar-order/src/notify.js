'use strict';
// 점주 카톡 알림: 카카오 챗봇 Event API 로 "주문 확인 · 출고" 등을 먼저 보낸다.
//   POST https://bot-api.kakao.com/v2/bots/{봇 ID}/talk   Authorization: KakaoAK {REST API 키}
//   → 오픈빌더에서 같은 이벤트 이름을 가진 블록이 불리고, 그 블록이 스킬(발주서버)을 부르면
//     스킬이 쌓아 둔 알림(notices)을 카드로 보여 준다.
// 설정이 없거나 발송에 실패해도 알림은 DB 에 남아, 점주가 채팅방을 열고 버튼을 누르면 보인다.

const O = require('./order');

const API = 'https://bot-api.kakao.com/v2/bots';

/** 주문 알림 문구. o = orderWithStore(...), kind = 바뀐 상태. 보낼 게 없으면 null */
function orderMessage(o, kind, s, now = Date.now()) {
  const names = o.lines.slice(0, 3).map((l) => `${l.name} ${l.qty}${l.unit}`).join(', ');
  const more = o.lines.length > 3 ? ` 외 ${o.lines.length - 3}품목` : '';
  const head = `${o.store.name} · 주문번호 ${o.no}\n${names}${more}\n합계 ${O.won(o.total)}`;
  const e = O.eta(now, s);
  switch (kind) {
    case 'received':
      return { title: '📥 발주가 접수되었어요', text: `${head}\n\n담당자가 확인하면 다시 알려 드릴게요.\n🚚 배송은 확인 후 ${e.days}${s.skipWeekend ? '(주말 제외)' : ''} 걸려요.` };
    case 'confirmed':
      return { title: '✅ 발주가 확인되었어요', text: `${head}\n\n🚚 ${e.text}` };
    case 'shipped':
      return { title: '🚚 상품이 출고되었어요', text: `${head}\n\n곧 도착합니다. 받으신 뒤 수량을 확인해 주세요.` };
    case 'canceled':
      return { title: '❌ 발주가 취소되었어요', text: `${head}\n\n궁금한 점은 투스타글로벌 담당자에게 문의해 주세요.` };
    case 'test':
      return { title: '🔔 알림 테스트', text: `${o.store.name}\n투스타글로벌 발주 알림이 이 카톡으로 옵니다.` };
    default:
      return null;
  }
}

/**
 * userKeys 에게 이벤트 발송. 결과: { configured, sent, error }
 * settings: { kakaoBotId, kakaoRestKey, kakaoEvent }
 */
async function sendEvent(settings, userKeys, text, fetchImpl = globalThis.fetch) {
  if (!settings.kakaoBotId || !settings.kakaoRestKey) return { configured: false, sent: 0, error: '' };
  if (!userKeys.length) return { configured: true, sent: 0, error: '' };
  let sent = 0;
  try {
    for (let i = 0; i < userKeys.length; i += 100) { // 한 번에 100명까지
      const chunk = userKeys.slice(i, i + 100);
      const r = await fetchImpl(`${API}/${encodeURIComponent(settings.kakaoBotId)}/talk`, {
        method: 'POST',
        headers: { authorization: `KakaoAK ${settings.kakaoRestKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          event: { name: settings.kakaoEvent || 'order_notice', data: { text: String(text).slice(0, 400) } },
          user: chunk.map((id) => ({ type: 'botUserKey', id })),
        }),
        signal: AbortSignal.timeout(6000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || /FAIL|ERROR/i.test(String(j.status || ''))) {
        throw new Error(`카카오 응답 ${r.status}${j.status ? ` ${j.status}` : ''}${j.message ? ` · ${j.message}` : ''}`);
      }
      sent += chunk.length;
    }
    return { configured: true, sent, error: '' };
  } catch (e) {
    return { configured: true, sent, error: e.name === 'TimeoutError' ? '카카오 서버가 응답하지 않아요' : String(e.message || e) };
  }
}

module.exports = { sendEvent, orderMessage };
