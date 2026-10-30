'use strict';
// 관리자 모바일 내역 (/a) — 카톡 알림 버튼으로 여는 화면. 오늘 요약 · 출고 집계 · 발주 내역
// 주소 끝 #sum · #pick · #list · #order-123 으로 바로 해당 화면을 연다.
(() => {
  const app = document.getElementById('app');
  const sheetRoot = document.getElementById('sheet');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const KST = 9 * 3600e3;
  const hm = (ts) => { const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const dayLabel = (s) => { const [y, m, d] = s.split('-').map(Number); return `${m}/${d} (${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; };
  const shift = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
  const BIZ = { cafe: '카페', sauna: '사우나', restaurant: '식당' };

  let V = null, tab = 'sum', rg = 'ALL', biz = 'ALL', sel = null, date = null;

  function fromHash() {
    const h = location.hash.slice(1);
    const m = /^order-(\d+)$/.exec(h);
    if (m) { tab = 'list'; sel = Number(m[1]); } else if (['sum', 'pick', 'list'].includes(h)) { tab = h; sel = null; }
  }
  async function load() {
    const r = await fetch('/api/admin/today' + (date ? '?date=' + date : ''), { credentials: 'same-origin' });
    if (r.status === 401) { location.href = '/login?next=%2Fa'; return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '불러오지 못했어요');
    V = j; date = j.date; render();
  }

  function render() {
    const s = V.summary;
    const head = `<header class="s-head"><span class="pf">B</span><div class="s-who"><b>발주 · ${dayLabel(V.date)}</b><small>BevFlow 운영 · ${hm(V.now)} 기준</small></div>
      <div style="display:flex;gap:4px"><button class="s-hbtn" data-day="-1" aria-label="전날">‹</button><button class="s-hbtn" data-day="1" aria-label="다음 날">›</button></div></header>
      <nav class="s-tabs" aria-label="보기">${[['sum', '📋', '오늘 요약'], ['pick', '🚚', '출고 집계'], ['list', '🧾', '발주 내역']].map(([k, i, l]) => `<button class="s-tab ${tab === k ? 'on' : ''}" data-tab="${k}"><span class="s-ti">${i}</span><span>${l}</span></button>`).join('')}</nav>`;
    let body = '';
    if (tab === 'sum') {
      body = `<div class="a-tiles">
          <button class="a-tile" data-tab="list"><small>확정 발주</small><b>${s.orders}건</b><span>${won(s.amount)}</span></button>
          <button class="a-tile" data-tab="pick"><small>오늘 출고</small><b>${s.outQty}개</b><span>${s.outStores}곳 · ${s.outKinds}품목</span></button>
          <div class="a-tile ${s.waiting ? 'warn' : ''}"><small>미확정 발주서</small><b>${s.waiting}곳</b><span>마감 전에 확인</span></div>
          <div class="a-tile ${s.accessPending ? 'warn' : ''}"><small>품목 이용 신청</small><b>${s.accessPending}건</b><span>콘솔에서 승인</span></div></div>
        ${V.waiting.length ? `<section class="m-card"><h2>⏰ 미확정 발주서</h2>${V.waiting.map((w) => `<div class="m-line"><div class="nm">${esc(w.store)}<small>${w.lines}품목 발주서 · ${w.seenAt ? hm(w.seenAt) + ' 열어 봄' : '아직 안 열어 봄'}</small></div><b class="a-num">${esc(w.phone || '')}</b></div>`).join('')}</section>` : ''}
        <section class="m-card"><h2>접수 경로</h2>${Object.keys(s.bySource).length ? Object.entries(s.bySource).map(([k, n]) => `<div class="m-line"><div class="nm">${esc(k)}<div class="a-bar"><i style="width:${n / Math.max(1, s.orders) * 100}%"></i></div></div><b>${n}건</b></div>`).join('') : '<p class="m-note" style="margin:0">아직 확정된 발주가 없어요</p>'}</section>
        ${s.delivered || s.failed.length ? `<section class="m-card"><h2>📦 배송</h2><div class="m-line"><div class="nm">완료</div><b>${s.delivered}곳</b></div>${s.failed.map((f) => `<div class="m-line"><div class="nm">${esc(f.store)}<small>${esc(f.reason || '')} → 다음 배송일 재배차</small></div><b style="color:var(--danger)">실패</b></div>`).join('')}</section>` : ''}`;
    } else if (tab === 'pick') {
      const regions = [['ALL', '전체'], ...V.regions.map((r) => [r.id, r.name])];
      const rows = V.pick.map((p) => ({ ...p, q: rg === 'ALL' ? p.qty : (p.byRegion[rg] || 0) })).filter((p) => p.q > 0);
      body = `<div class="s-quick">${regions.map(([id, n]) => `<button class="s-chip ${rg === id ? 'on' : ''}" data-rg="${esc(id)}">${esc(n)}</button>`).join('')}</div>
        <section class="m-card"><h2>품목별 출고 수량 <small class="muted" style="font-weight:400;font-size:12px">${rows.reduce((a, p) => a + p.q, 0)}개 · ${rows.length}품목</small></h2>
        ${rows.length ? rows.map((p) => `<div class="m-line"><div class="nm">${esc(p.name)}<small>${esc(p.grp || '')}</small></div><b class="a-num">${p.q}${esc(p.u)}</b></div>`).join('') : '<p class="m-note" style="margin:0">이 날 출고할 발주가 없어요</p>'}</section>
        <p class="m-note">배송일이 이 날인 확정 발주를 모두 더한 수량이에요. 마감(발주 확정) 전에는 늘어날 수 있어요.</p>`;
    } else {
      const bizes = [['ALL', '전체'], ['sauna', '사우나'], ['cafe', '카페'], ['restaurant', '식당']];
      const list = V.orders.filter((o) => biz === 'ALL' || o.biz === biz);
      body = `<div class="s-quick">${bizes.map(([id, n]) => `<button class="s-chip ${biz === id ? 'on' : ''}" data-biz="${id}">${n}</button>`).join('')}</div>
        <section class="m-card" style="gap:0">${list.length ? list.map((o) => `<button class="a-row" data-order="${o.id}"><div class="nm"><b>${esc(o.store)}</b><small>${hm(o.paidAt)} · ${esc(o.sourceText)} · ${o.n}품목 · ${esc(o.region)}</small></div><div class="a-amt"><b>${won(o.amount)}</b><small>${o.status === 'delivered' ? '배송 완료' : o.status === 'dispatched' ? '배송 중' : '출고 대기'}</small></div></button>`).join('') : '<p class="m-note" style="margin:0">확정된 발주가 없어요</p>'}</section>
        <p class="m-note">기간·매장별 검색과 엑셀 내려받기는 PC 운영 콘솔에서 할 수 있어요.</p>`;
    }
    app.innerHTML = head + body;
    const o = sel && V.orders.find((x) => x.id === sel);
    sheetRoot.innerHTML = o ? `<div class="s-sheet-bg" data-close="1"><div class="s-sheet" role="dialog" aria-modal="true"><div class="s-sh"><h2>${esc(o.store)}</h2><button class="xbtn" data-close="1" aria-label="닫기">✕</button></div>
      <div class="s-sb"><p class="m-note" style="margin:0">${esc(o.code)} · ${hm(o.paidAt)} 확정 · ${esc(o.sourceText)} · ${esc(BIZ[o.biz] || '')} · ${esc(o.region)}</p>
      ${o.lines.map((l) => `<div class="m-line"><div class="nm">${esc(l.name)}<small>${l.qty}${esc(l.u)}</small></div><b class="a-num">${won(l.amount)}</b></div>`).join('')}
      <div class="m-total"><span>합계 · ${o.n}품목</span><span>${won(o.amount)}</span></div>
      <div class="s-arrive">🚚 ${esc(o.deliverDate || '')} 배송</div></div></div></div>` : '';
    document.body.classList.toggle('lock', !!o);
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('button, [data-close]');
    if (!el || !V) return;
    const d = el.dataset;
    if (d.close && (ev.target === el || el.classList.contains('xbtn'))) { sel = null; history.replaceState(null, '', '#list'); render(); return; }
    if (d.tab) { tab = d.tab; sel = null; history.replaceState(null, '', '#' + tab); render(); window.scrollTo(0, 0); return; }
    if (d.rg) { rg = d.rg; render(); return; }
    if (d.biz) { biz = d.biz; render(); return; }
    if (d.order) { sel = Number(d.order); history.replaceState(null, '', '#order-' + sel); render(); return; }
    if (d.day) { date = shift(date, Number(d.day)); sel = null; load().catch((e) => alertLine(e.message)); }
  });
  window.addEventListener('hashchange', () => { fromHash(); if (V) render(); });
  function alertLine(m) { app.innerHTML = `<div class="m-card m-done"><div class="m-lead">${esc(m)}</div></div>`; }
  fromHash();
  load().catch((e) => alertLine(e.message));
  setInterval(() => { if (document.visibilityState === 'visible' && !sel) load().catch(() => {}); }, 60e3);
})();
