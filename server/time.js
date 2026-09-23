'use strict';
// 한국 표준시(KST, UTC+9, 서머타임 없음) 기준 시간 계산 도우미
// 모든 타임스탬프는 epoch 밀리초로 저장하고, 운영 규칙(컷오프·배차·야간 발송)은 KST로 판단한다.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;

/** ts가 속한 KST 날짜의 0시 (epoch ms) */
function kstMidnight(ts) {
  return Math.floor((ts + KST) / DAY) * DAY - KST;
}

/** KST 기준 시각을 소수 시간으로 (예: 14:30 → 14.5) */
function kstHour(ts) {
  return (ts - kstMidnight(ts)) / HOUR;
}

/** KST 요일 (0=일 … 6=토) */
function kstDow(ts) {
  return new Date(ts + KST).getUTCDay();
}

/** 'YYYY-MM-DD' (KST) */
function dateStr(ts) {
  const d = new Date(ts + KST);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/** 'YYYY-MM-DD' → 그날 KST 0시 */
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw new Error('날짜 형식은 YYYY-MM-DD 입니다: ' + s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - KST;
}

/** 'HH:MM' → 소수 시간 */
function hhmm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) throw new Error('시각 형식은 HH:MM 입니다: ' + s);
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59) throw new Error('잘못된 시각: ' + s);
  return h + mi / 60;
}

/** 특정 KST 날짜(0시 ts)의 hour시 */
function at(midnight, hour) {
  return midnight + hour * HOUR;
}

/** 'HH:MM' 표기 (KST) */
function fmtTime(ts) {
  const m = Math.floor(kstHour(ts) * 60 + 1e-6);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** 배송 요일 집합 (예: '1,2,3,4,5,6' = 월~토) */
function parseDays(s) {
  const set = new Set(String(s || '').split(',').map((x) => +x.trim()).filter((x) => x >= 0 && x <= 6));
  if (!set.size) throw new Error('배송 요일이 비어 있습니다');
  return set;
}

/** fromMidnight 이후(포함 여부 선택) 첫 배송일의 0시 */
function nextDeliveryDay(fromMidnight, days, includeSelf) {
  let d = includeSelf ? fromMidnight : fromMidnight + DAY;
  for (let i = 0; i < 8; i++) {
    if (days.has(kstDow(d + HOUR))) return d;
    d += DAY;
  }
  return d;
}

module.exports = { HOUR, DAY, KST, kstMidnight, kstHour, kstDow, dateStr, parseDate, hhmm, at, fmtTime, parseDays, nextDeliveryDay };
