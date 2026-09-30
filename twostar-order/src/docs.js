'use strict';
// 인쇄용 문서: 발주 확인서(주문 1건) · 거래명세서(주문 1건 또는 기간)
// 화면에서 [인쇄 · PDF 저장] → 프린터 또는 'PDF로 저장'. 스타일은 /assets/doc.css

const O = require('./order');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n).toLocaleString('ko-KR');
const when = (ms) => O.kstText(ms);
const day = (ms) => O.kstText(ms, false);

/** 금액을 한글로: 123000 → 일십이만삼천 */
function korean(n) {
  n = Math.trunc(Math.abs(Number(n) || 0));
  if (!n) return '영';
  const D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const S = ['', '십', '백', '천'];
  const B = ['', '만', '억', '조'];
  let out = '';
  for (let b = 0; n > 0; b++, n = Math.floor(n / 10000)) {
    const part = n % 10000;
    if (!part) continue;
    let s = '';
    for (let i = 3; i >= 0; i--) {
      const d = Math.floor(part / 10 ** i) % 10;
      if (d) s += D[d] + S[i];
    }
    out = s + B[b] + out;
  }
  return out;
}

/** 금액 → { supply 공급가액, tax 세액, total 합계 } (settings.vat 기준) */
function vatSplit(amount, vat) {
  if (vat === 'excluded') { const tax = Math.round(amount * 0.1); return { supply: amount, tax, total: amount + tax }; }
  if (vat === 'none') return { supply: amount, tax: 0, total: amount };
  const supply = Math.round(amount / 1.1);
  return { supply, tax: amount - supply, total: amount };
}
const VAT_NOTE = { included: '단가는 부가세 포함 금액입니다.', excluded: '단가는 부가세 별도 금액입니다.', none: '면세 품목입니다.' };

function page(title, body, { back } = {}) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/doc.css">
<script src="/assets/doc.js" defer></script></head>
<body><div class="toolbar noprint">
${back ? `<a class="tbtn" href="${esc(back)}">← 관리자</a>` : ''}
<button class="tbtn primary" type="button" data-print>인쇄 · PDF 저장</button></div>
${body}
</body></html>`;
}

function supplierRows(s) {
  return [
    ['등록번호', s.bizNo], ['상호', s.company], ['대표', s.ceo], ['주소', s.address], ['업태 · 종목', [s.bizType, s.bizItem].filter(Boolean).join(' · ')], ['연락처', s.tel],
  ].filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('');
}
function buyerRows(store) {
  return [['상호', store.name], ['업종', O.BIZ[store.biz]?.label], ['대표', store.owner], ['연락처', store.phone]]
    .filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('');
}
const parties = (settings, store, a = '공급자', b = '공급받는자') => `
<div class="parties">
  <section><h3>${a}</h3><table>${supplierRows(settings)}</table></section>
  <section><h3>${b}</h3><table>${buyerRows(store)}</table></section>
</div>`;

/** 발주 확인서: order = orderWithStore(...) */
function orderDoc(order, settings, { back } = {}) {
  const store = order.store;
  const base = order.status === 'received' ? order.created_at : order.updated_at;
  const e = O.eta(base, settings);
  // 줄마다 공급가액·부가세(10%)를 계산하고 그 합으로 합계 (명세서와 같은 방식이라 1원도 안 어긋남)
  const lv = order.lines.map((l) => vatSplit(l.price * l.qty, settings.vat));
  const v = lv.reduce((a, x) => ({ supply: a.supply + x.supply, tax: a.tax + x.tax, total: a.total + x.total }), { supply: 0, tax: 0, total: 0 });
  const canceled = order.status === 'canceled';
  const rows = order.lines.map((l, i) => `<tr><td class="c hide-m">${i + 1}</td><td>${esc(l.name)}${l.spec ? `<div class="muted show-m">${esc(l.spec)}</div>` : ''}</td><td class="hide-m">${esc(l.spec)}</td>
    <td class="n">${num(l.qty)}${esc(l.unit)}</td><td class="n">${num(l.price)}</td><td class="n">${num(lv[i].supply)}</td><td class="n">${num(lv[i].tax)}</td></tr>`).join('');
  const body = `<article class="doc${canceled ? ' void' : ''}">
<header class="dh"><div><h1>발주 확인서</h1><div class="sub">주문번호 <b>${esc(order.no)}</b></div></div>
<div class="stamp st-${esc(order.status)}">${esc(O.STATUS[order.status])}</div></header>
${parties(settings, store, '공급처', '발주처')}
<dl class="facts">
  <div><dt>주문 일시</dt><dd>${when(order.created_at)}</dd></div>
  <div><dt>접수 경로</dt><dd>${order.via === 'chat' ? '카카오톡' : '발주서'}</dd></div>
  <div><dt>품목 수</dt><dd>${order.lines.length}품목</dd></div>
  <div><dt>배송 예정</dt><dd>${canceled ? '-' : `${esc(e.range)} <span class="muted">(${esc(e.days)}${settings.skipWeekend ? ', 주말 제외' : ''})</span>`}</dd></div>
</dl>
<table class="lines"><thead><tr><th class="c hide-m">No</th><th>품목</th><th class="hide-m">규격</th><th class="n">수량</th><th class="n">단가</th><th class="n">공급가액</th><th class="n">부가세(10%)</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="sum">
  ${settings.vat === 'none' ? '' : `<div><span>공급가액</span><b>${num(v.supply)}원</b></div><div><span>부가세</span><b>${num(v.tax)}원</b></div>`}
  <div class="grand"><span>합계</span><b>${num(v.total)}원</b></div>
</div>
${order.memo ? `<p class="memo"><b>요청 사항</b> ${esc(order.memo)}</p>` : ''}
<p class="fine">${VAT_NOTE[settings.vat]} ${canceled ? '이 주문은 취소되었습니다.' : '위와 같이 발주를 확인합니다.'}</p>
<footer class="sign">${day(Date.now())}<br><b>${esc(settings.company)}</b>${settings.tel ? ` · ${esc(settings.tel)}` : ''}</footer>
</article>`;
  return page(`발주 확인서 ${order.no} · ${store.name}`, body, { back });
}

/**
 * 거래명세서: orders = 품목 줄이 붙은 주문들 (취소 제외), period = '2026-09-01 ~ 2026-09-30' 또는 주문번호
 */
function statementDoc(store, orders, settings, period, { back } = {}) {
  let supplyAll = 0; let taxAll = 0; let totalAll = 0;
  const rows = [];
  for (const o of orders) {
    o.lines.forEach((l, i) => {
      const v = vatSplit(l.price * l.qty, settings.vat);
      supplyAll += v.supply; taxAll += v.tax; totalAll += v.total;
      rows.push(`<tr${i === 0 ? ' class="first"' : ''}><td>${i === 0 ? `${esc(O.kstYmd(o.created_at).slice(5).replace('-', '/'))}<div class="muted">${esc(o.no)}</div>` : ''}</td>
        <td>${esc(l.name)}${l.spec ? `<div class="muted show-m">${esc(l.spec)}</div>` : ''}</td><td class="hide-m">${esc(l.spec)}</td><td class="n">${num(l.qty)}${esc(l.unit)}</td><td class="n">${num(l.price)}</td>
        <td class="n">${num(v.supply)}</td>${settings.vat === 'none' ? '' : `<td class="n">${num(v.tax)}</td>`}</tr>`);
    });
  }
  const body = `<article class="doc">
<header class="dh"><div><h1>거래명세서</h1><div class="sub">${esc(period)}</div></div></header>
${parties(settings, store)}
<div class="amount">합계 금액 <b>금 ${korean(totalAll)}원정</b> <span>(₩${num(totalAll)})</span></div>
<table class="lines"><thead><tr><th>일자</th><th>품목</th><th class="hide-m">규격</th><th class="n">수량</th><th class="n">단가</th><th class="n">공급가액</th>${settings.vat === 'none' ? '' : '<th class="n">세액</th>'}</tr></thead>
<tbody>${rows.join('') || `<tr><td colspan="7" class="c muted">이 기간에 발주가 없습니다.</td></tr>`}</tbody></table>
<div class="sum">
  <div><span>주문 ${orders.length}건</span><b></b></div>
  ${settings.vat === 'none' ? '' : `<div><span>공급가액</span><b>${num(supplyAll)}원</b></div><div><span>세액</span><b>${num(taxAll)}원</b></div>`}
  <div class="grand"><span>합계</span><b>${num(totalAll)}원</b></div>
</div>
${settings.account ? `<p class="memo"><b>입금 계좌</b> ${esc(settings.account)}</p>` : ''}
<p class="fine">${VAT_NOTE[settings.vat]} 취소된 주문은 포함하지 않습니다.</p>
<footer class="sign">${day(Date.now())}<br><b>${esc(settings.company)}</b>${settings.tel ? ` · ${esc(settings.tel)}` : ''}</footer>
</article>`;
  return page(`거래명세서 ${store.name} ${period}`, body, { back });
}

module.exports = { orderDoc, statementDoc, korean, vatSplit, esc };
