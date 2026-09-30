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

function page(title, body, { back, file = 'twostar', links = [] } = {}) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/doc.css">
<script src="/assets/doc.js" defer></script></head>
<body><div class="toolbar noprint">
${back ? `<a class="tbtn" href="${esc(back)}">← 관리자</a>` : ''}
${links.map((l) => `<a class="tbtn ${l.on ? 'on' : ''}" href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}
<button class="tbtn primary" type="button" data-pdf="${esc(file.replace(/[^\w.-]+/g, '_'))}">PDF 저장</button></div>
<div id="pdfout" class="pdfout noprint" hidden></div>
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
/** 발주 확인서: 종이 거래명세표 양식 (파란 선 칸) — order = orderWithStore(...) */
function orderDoc(order, settings, { back, links } = {}) {
  const store = order.store;
  const base = order.status === 'received' ? order.created_at : order.updated_at;
  const e = O.eta(base, settings);
  // 줄마다 공급가액·세액(10%)을 계산하고 그 합으로 합계 (명세서와 같은 방식이라 1원도 안 어긋남)
  const lv = order.lines.map((l) => vatSplit(l.price * l.qty, settings.vat));
  const v = lv.reduce((a, x) => ({ supply: a.supply + x.supply, tax: a.tax + x.tax, total: a.total + x.total }), { supply: 0, tax: 0, total: 0 });
  const canceled = order.status === 'canceled';
  const d = new Date(order.created_at + 9 * 3600e3);
  const ymd = `${d.getUTCFullYear()}년 ${String(d.getUTCMonth() + 1).padStart(2, '0')}월 ${String(d.getUTCDate()).padStart(2, '0')}일`;
  const vert = (t) => [...t].join('<br>');
  const cell = (x) => esc(x || '');
  const rows = order.lines.map((l, i) => `<tr><td class="nm">${esc(l.name)}${l.spec ? ` / ${esc(l.spec)}` : ''}</td><td class="c">${esc(l.unit)}</td>
    <td class="n">${num(l.qty)}</td><td class="n">${num(l.price)}</td><td class="n">${num(lv[i].supply)}</td><td class="n">${num(lv[i].tax)}</td></tr>`);
  rows.push('<tr><td class="blank-end">===== 이 &nbsp;&nbsp; 하 &nbsp;&nbsp; 여 &nbsp;&nbsp; 백 =====</td><td></td><td></td><td></td><td></td><td></td></tr>');
  while (rows.length < 14) rows.push('<tr class="empty"><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
  const notes = [
    `주문번호 ${esc(order.no)} · ${order.via === 'chat' ? '카카오톡' : '발주서'} 접수 · 상태: ${esc(O.STATUS[order.status])}`,
    canceled ? '이 주문은 취소되었습니다.' : `배송 예정: ${esc(e.range)} (${esc(e.days)}${settings.skipWeekend ? ', 주말 제외' : ''})`,
    order.memo ? `요청 사항: ${esc(order.memo)}` : '',
    '단가는 부가세 별도 금액입니다.',
  ].filter(Boolean).join('<br>');
  const body = `<div class="fwrap"><article class="fdoc${canceled ? ' void' : ''}" id="fdoc">
<table class="ftop"><tr>
  <th class="lb">일 자</th><td class="dt">${ymd} &nbsp; ${esc(order.no)}</td>
  <td class="ttl"><span>발 주 확 인 서</span></td>
  <td class="rt">[${esc(O.STATUS[order.status])}]</td>
</tr></table>
<table class="fparty">
<colgroup><col class="cv"><col class="ck"><col><col class="ck"><col class="cn"><col class="cv"><col class="ck"><col><col class="ck"><col class="cn"></colgroup>
<tr><th rowspan="4" class="v">${vert('공급자')}</th><th>등록<br>번호</th><td colspan="3" class="big">${cell(settings.bizNo)}</td>
    <th rowspan="4" class="v">${vert('공급받는자')}</th><th>등록<br>번호</th><td colspan="3" class="big"></td></tr>
<tr><th>상호</th><td>${cell(settings.company)}</td><th>성명</th><td>${cell(settings.ceo)}</td>
    <th>상호</th><td>${cell(store.name)}</td><th>성명</th><td>${cell(store.owner)}</td></tr>
<tr><th>주소</th><td colspan="3">${cell(settings.address)}</td>
    <th>연락처</th><td colspan="3">${cell(store.phone)}</td></tr>
<tr><th>업태</th><td>${cell(settings.bizType)}</td><th>종목</th><td>${cell(settings.bizItem)}</td>
    <th>업종</th><td>${cell(O.BIZ[store.biz]?.label)}</td><th>종목</th><td></td></tr>
</table>
<table class="flines">
<colgroup><col><col class="w-u"><col class="w-q"><col class="w-p"><col class="w-a"><col class="w-t"></colgroup>
<thead><tr><th>품 목 / 규 격</th><th>단위</th><th>수 량</th><th>단 가</th><th>금 액</th><th>세 액</th></tr></thead>
<tbody>${rows.join('')}</tbody></table>
<table class="fnote"><tr><th class="v">${vert('비고')}</th><td>${notes}</td></tr></table>
<table class="fsum"><tr>
  <th>공급<br>가액</th><td class="n">₩${num(v.supply)}</td>
  <th>세액</th><td class="n">₩${num(v.tax)}</td>
  <th>합계</th><td class="n grand">₩${num(v.total)}</td>
  <th>인수자</th><td class="sig"></td>
</tr></table>
<p class="fconfirm">위와 같이 발주를 확인합니다. &nbsp; ${day(Date.now())} &nbsp; <b>${esc(settings.company)}</b>${settings.tel ? ` · ${esc(settings.tel)}` : ''}</p>
</article></div>`;
  // 파일 이름은 영문·숫자로 (휴대폰마다 한글 파일 이름이 깨지는 경우가 있음)
  return page(`발주 확인서 ${order.no} · ${store.name}`, body, { back, links, file: `twostar_order_${order.no}` });
}

/** 실물 명세서 보기: srcs = 사진 주소들, links = 위쪽 이동 버튼 */
function statementView(stmt, store, srcs, { back, links } = {}) {
  const t = stmt.title || '거래명세서';
  const body = `<article class="doc stview">
<header class="dh"><div><h1>${esc(t)}</h1><div class="sub">${esc(store.name)} · ${day(stmt.created_at)} 올림</div></div></header>
${srcs.map((src, i) => `<img src="${esc(src)}" alt="명세서 ${i + 1}쪽">`).join('')}
<p class="fine">사진을 길게 누르면 휴대폰에 저장할 수 있어요.</p>
</article>`;
  return page(`${t} · ${store.name}`, body, { back, links, file: `twostar_statement_${stmt.id}` });
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
  return page(`거래명세서 ${store.name} ${period}`, body, { back, file: `twostar_statement_${store.id}_${String(period).replace(/[^\d]+/g, '-').replace(/^-|-$/g, '')}` });
}

module.exports = { orderDoc, statementDoc, statementView, korean, vatSplit, esc };
