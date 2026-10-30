'use strict';
// 모든 화면 맨 아래 사업자 정보 (전자상거래법 표시 사항). 관리자 [설정] → 회사 정보에서 고친다.
//   window.siteFooter(info) → 하단 요소. body 에 data-foot 가 있으면 /api/company 를 읽어 자동으로 붙인다.
(() => {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function siteFooter(c) {
    if (!c || !c.company) return null;
    const f = el('footer', 'sitefoot');
    f.append(el('div', 'sf-name', c.company));
    const items = [
      ['대표', c.ceo], ['사업자등록번호', c.bizNo], ['통신판매업신고', c.mailOrderNo],
      ['주소', c.address], ['전화', c.tel], ['이메일', c.email],
    ].filter(([, v]) => v);
    const list = el('div', 'sf-list');
    for (const [k, v] of items) {
      const s = el('span', 'sf-i');
      s.append(el('b', null, k), ` ${v}`);
      list.append(s);
    }
    // 사업자등록번호 10자리면 공정거래위원회 사업자정보 확인 링크
    const no = String(c.bizNo || '').replace(/\D/g, '');
    if (no.length === 10) {
      const a = el('a', 'sf-chk', '사업자정보 확인');
      a.href = `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${no}`;
      a.target = '_blank'; a.rel = 'noopener';
      list.append(a);
    }
    if (items.length) f.append(list);
    f.append(el('div', 'sf-copy', `© ${new Date().getFullYear()} ${c.company}. All rights reserved.`));
    return f;
  }
  window.siteFooter = siteFooter;
  if (document.body && document.body.dataset.foot != null) {
    fetch('/api/company').then((r) => (r.ok ? r.json() : null)).then((c) => {
      const f = siteFooter(c);
      if (!f) return;
      const at = document.querySelector(document.body.dataset.foot || 'body');
      (at || document.body).append(f);
    }).catch(() => {});
  }
})();
