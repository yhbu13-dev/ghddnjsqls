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
  const names = o.lines.slice(0, 3).map((l) => `${l.name}${l.loose ? '(낱개)' : ''} ${l.qty}${l.unit}`).join(', ');
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
    case 'statement':
      return { title: '🧾 명세서가 올라왔어요', text: `${o.store.name} · 주문번호 ${o.no}\n[발주 확인서]에서 [실물 명세서]를 눌러 보세요.` };
    case 'test':
      return { title: '🔔 알림 테스트', text: `${o.store.name}\n투스타글로벌 발주 알림이 이 카톡으로 옵니다.` };
    default:
      return null;
  }
}

/**
 * 담당자에게 가는 새 발주 알림: 품목 전체 목록 (카톡 말풍선 1,000자 안에서, 넘치면 '외 N품목')
 * o = orderWithStore(...)
 */
function staffOrderMessage(o, now = Date.now()) {
  const when = O.kstText(o.created_at || now);
  const head = `${o.store.name} · 주문번호 ${o.no}\n${when} · ${o.via === 'chat' ? '카톡 주문' : '발주서 주문'}`;
  const tail = `\n\n합계 ${O.won(o.total)} (부가세 별도)${o.memo ? `\n요청: ${o.memo}` : ''}`;
  const lines = o.lines.map((l) => `· ${l.name}${l.loose ? ' (낱개)' : ''} ${l.qty}${l.unit}`);
  let body = '';
  let shown = 0;
  for (const l of lines) {
    if (head.length + body.length + l.length + tail.length + 40 > 950) break;
    body += `\n${l}`;
    shown++;
  }
  const more = lines.length > shown ? `\n… 외 ${lines.length - shown}품목 (전체는 발주 확인서)` : '';
  return { title: `🛒 새 발주 · ${o.store.name}`, text: `${head}\n${body}${more}${tail}`, count: lines.length };
}

/**
 * userKeys 에게 이벤트 발송. 결과: { configured, sent, error }
 * settings: { kakaoBotId, kakaoRestKey, kakaoEvent }
 */
async function sendEvent(settings, userKeys, _text, fetchImpl = globalThis.fetch) { // _text: 예전 호출 호환용 (보내지 않음)
  if (!settings.kakaoBotId || !settings.kakaoRestKey) return { configured: false, sent: 0, error: '' };
  if (!userKeys.length) return { configured: true, sent: 0, error: '' };
  // 한 번 보내기. 실패하면 카카오가 돌려준 설명을 그대로 담아 던진다 (관리자 화면에서 원인을 볼 수 있게)
  const post = async (ids) => {
    const r = await fetchImpl(`${API}/${encodeURIComponent(settings.kakaoBotId)}/talk`, {
      method: 'POST',
      headers: { authorization: `KakaoAK ${settings.kakaoRestKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        // 카카오 문서 예시와 같은 최소 형식: 이벤트 이름 + 받을 사용자. 알림 내용은 알림 블록이 서버에 쌓인 알림을 읽어 보여 준다
        event: { name: settings.kakaoEvent || 'order_notice' },
        user: ids.map((id) => ({ type: 'botUserKey', id })),
      }),
      signal: AbortSignal.timeout(6000),
    });
    const raw = await r.text().catch(() => '');
    let j = {};
    try { j = JSON.parse(raw); } catch { /* JSON 이 아닌 응답 */ }
    if (!r.ok || /FAIL|ERROR/i.test(String(j.status || ''))) {
      const why = j.message || j.msg || j.error || raw.replace(/\s+/g, ' ').slice(0, 200);
      const err = new Error(`카카오 응답 ${r.status}${j.status ? ` ${j.status}` : ''}${j.code != null ? ` (code ${j.code})` : ''}${why ? ` · ${why}` : ''}`);
      err.status = r.status;
      throw err;
    }
  };
  let sent = 0;
  const errors = [];
  const why = (e) => (e.name === 'TimeoutError' ? '카카오 서버가 응답하지 않아요' : String(e.message || e));
  for (let i = 0; i < userKeys.length; i += 100) { // 한 번에 100명까지
    const chunk = userKeys.slice(i, i + 100);
    try {
      await post(chunk);
      sent += chunk.length;
    } catch (e) {
      // 여러 명 중 한 명(예: 봇 테스트 사용자·채널 차단)이 잘못돼 통째로 거절될 수 있어 한 명씩 다시 보낸다
      if (e.status === 400 && chunk.length > 1) {
        for (const id of chunk) {
          try { await post([id]); sent++; } catch (e2) { errors.push(why(e2)); }
        }
      } else errors.push(why(e));
    }
  }
  return { configured: true, sent, error: errors.length ? `${errors[0]}${errors.length > 1 ? ` (외 ${errors.length - 1}건)` : ''}` : '' };
}

module.exports = { sendEvent, orderMessage, staffOrderMessage };
