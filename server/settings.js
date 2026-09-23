'use strict';
// 운영 설정 — DB에 저장되고 콘솔 [운영 설정]에서 바꾼다. 값마다 검증 규칙을 둔다.

const T = require('./time');

const SPEC = {
  // 운영 시간 규칙
  cutoff: { def: '12:00', type: 'time', label: '당일배송 컷오프' },
  dispatch: { def: '13:30', type: 'time', label: '출고·배차 시각' },
  delivery_days: { def: '1,2,3,4,5,6', type: 'days', label: '배송 요일 (0=일 … 6=토)' },
  night_start: { def: '21:00', type: 'time', label: '야간 발송 제한 시작' },
  night_end: { def: '09:00', type: 'time', label: '야간 발송 제한 종료 (이때 일괄 발송)' },
  break_from: { def: '11:00', type: 'time', label: '브레이크타임 예약 대상 시작' },
  break_to: { def: '14:30', type: 'time', label: '브레이크타임 예약 대상 종료' },
  break_send: { def: '15:00', type: 'time', label: '브레이크타임 발송 시각' },
  expire_hours: { def: 3, type: 'num', min: 0.5, max: 24, label: '무응답 만료 (시간)' },
  auto_remind_min: { def: 60, type: 'num', min: 0, max: 600, label: '자동 리마인드 (분, 0=끔)' },
  retry_at: { def: '10:00', type: 'time', label: '보류·만료 후 재제안 가능 시각 (다음 날)' },
  // 추정·발주 모델
  cover_days: { def: 7.6, type: 'num', min: 1, max: 30, label: '1회 발주로 채우는 기간 (일)' },
  lookahead_days: { def: 8, type: 'num', min: 0, max: 30, label: '묶음 발주 포함 기준 (N일 내 트리거 예상 SKU)' },
  safety_days: { def: 2.2, type: 'num', min: 0.5, max: 14, label: '안전재고 (일 판매량 × N일)' },
  band_w0: { def: 0.08, type: 'num', min: 0, max: 2, label: '오차 밴드 기본 폭 (박스)' },
  band_beta: { def: 0.10, type: 'num', min: 0, max: 1, label: '오차 밴드 증가율 (실사 후 판매량 대비)' },
  alpha_lr: { def: 0.35, type: 'num', min: 0, max: 1, label: '누수 보정 학습률' },
  default_rate: { def: 0.15, type: 'num', min: 0, max: 20, label: '판매 이력이 없을 때 기본 일 판매량 (박스)' },
  // 배송
  driver_capacity: { def: 60, type: 'num', min: 1, max: 500, label: '기사 1인 1일 설계 용량 (곳)' },
  drive_min: { def: 12, type: 'num', min: 1, max: 120, label: 'ETA 계산용 정차 간 이동 (분)' },
  stop_min: { def: 7, type: 'num', min: 1, max: 60, label: 'ETA 계산용 정차 시간 (분)' },
  // 정산
  fee_rate: { def: 0.03, type: 'num', min: 0, max: 0.5, label: '티오더 수수료율' },
  settle_lag_days: { def: 7, type: 'num', min: 0, max: 60, label: '주간 마감 후 지급까지 (일)' },
  pilot_start: { def: '', type: 'date', label: '파일럿 시작일' },
  // 지표 목표
  target_approval: { def: 85, type: 'num', min: 0, max: 100, label: '목표 승인율 (%)' },
  target_stop: { def: 7, type: 'num', min: 0, max: 60, label: '목표 평균 정차 (분)' },
  target_error: { def: 10, type: 'num', min: 0, max: 100, label: '목표 재고 추정 오차 (%)' },
  // 연동
  pay_method: { def: 'invoice', type: 'enum', values: ['invoice', 'sandbox_card'], label: '결제 방식' },
  notifier: { def: 'console', type: 'enum', values: ['console', 'webhook'], label: '알림 발송 방식' },
  webhook_url: { def: '', type: 'url', label: '알림 웹훅 URL (webhook 방식)' },
  public_base_url: { def: 'http://localhost:8080', type: 'url', label: '외부 접속 주소 (사장님·기사 링크)' },
  sample_data: { def: 0, type: 'num', min: 0, max: 1, label: '샘플 데이터 여부' },
};

function validate(key, v) {
  const s = SPEC[key];
  if (!s) throw new Error('알 수 없는 설정: ' + key);
  switch (s.type) {
    case 'time': T.hhmm(v); return String(v);
    case 'days': T.parseDays(v); return String(v);
    case 'date': if (v !== '') T.parseDate(v); return String(v);
    case 'num': {
      const n = Number(v);
      if (!Number.isFinite(n) || n < s.min || n > s.max) throw new Error(`${s.label}: ${s.min}~${s.max} 범위의 숫자여야 합니다`);
      return n;
    }
    case 'enum': if (!s.values.includes(v)) throw new Error(`${s.label}: ${s.values.join(', ')} 중 하나`); return v;
    case 'url': if (v !== '' && !/^https?:\/\/[^\s]+$/.test(String(v))) throw new Error(`${s.label}: http(s):// 로 시작하는 주소`); return String(v).replace(/\/+$/, '');
    default: return v;
  }
}

function load(db) {
  const out = {};
  for (const [k, s] of Object.entries(SPEC)) out[k] = s.def;
  for (const r of db.all('SELECT key, value FROM settings')) {
    if (SPEC[r.key]) out[r.key] = JSON.parse(r.value);
  }
  if (!out.pilot_start) out.pilot_start = T.dateStr(Date.now());
  return out;
}

function save(db, patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) clean[k] = validate(k, v);
  db.tx(() => {
    for (const [k, v] of Object.entries(clean)) {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
    }
  });
  return load(db);
}

/** 계산에 쓰기 좋게 파싱한 규칙 묶음 */
function rules(s) {
  return {
    ...s,
    cutoffH: T.hhmm(s.cutoff), dispatchH: T.hhmm(s.dispatch), days: T.parseDays(s.delivery_days),
    nightStartH: T.hhmm(s.night_start), nightEndH: T.hhmm(s.night_end),
    breakFromH: T.hhmm(s.break_from), breakToH: T.hhmm(s.break_to), breakSendH: T.hhmm(s.break_send),
    retryH: T.hhmm(s.retry_at), pilotStart: T.parseDate(s.pilot_start),
  };
}

module.exports = { SPEC, load, save, rules, validate };
