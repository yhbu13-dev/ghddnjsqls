'use strict';
// 결제 어댑터
// - invoice: 후불 청구. 승인 즉시 주문 확정, 월말에 매장별로 청구 (파일럿 기본값 — PG 계약 전에도 운영 가능)
// - sandbox_card: 카드 자동결제 흐름 테스트용. 매장의 '결제 실패 테스트'를 켜면 승인 거절을 돌려준다.
// TODO: PG 결제 API 연동 — 빌링키 자동결제(예: 카드 등록 후 정기 결제)는 여기에 모드를 추가한다.

function createPayment({ getRules }) {
  return {
    async charge({ proposal, store }) {
      const R = getRules();
      if (R.pay_method === 'invoice') return { ok: true, method: 'invoice', ref: 'INV-' + proposal.code };
      if (store.pay_test_fail) return { ok: false, method: 'sandbox_card', reason: '카드 승인 거절 (샌드박스 테스트)' };
      return { ok: true, method: 'sandbox_card', ref: 'SBX-' + proposal.code + '-' + Date.now().toString(36) };
    },
  };
}

module.exports = { createPayment };
