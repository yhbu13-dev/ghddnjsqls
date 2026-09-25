'use strict';
// 점주 발주 화면 (/m/…) — 카카오톡 채널 버튼·카카오 로그인으로 여는 링크. 글자 입력 없이 누르기만으로 발주한다.
// 장바구니는 서버에 저장돼 카카오톡 채팅에서 담은 품목과 이어진다.
(() => {
  const app = document.getElementById('app');
  const sheetRoot = document.getElementById('sheet');
  const token = location.pathname.split('/m/')[1] || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const KST = 9 * 3600e3;
  const hm = (ts) => { const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const md = (ts) => { const d = new Date(ts + KST); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
  const ICON = { cafe: '☕', snack: '🍪', beverage: '🥤' };

  let V = null;                 // 서버 화면 데이터
  let qty = {};                 // 장바구니 수량 (화면 기준)
  let tab = null;               // 선택한 품목 탭
  let view = 'shop';            // shop | orders | done
  let quick = 'all';            // all | fav
  let q = '';                   // 검색어
  let done = null;              // 방금 접수된 발주
  let ref = null;               // 중복 접수 방지 키
  let busy = false;
  const timers = {};
  const saving = new Set();     // 서버에 아직 저장되지 않은 수량 변경

  async function call(method, path, body) {
    const r = await fetch('/api/shop/' + encodeURIComponent(token) + path, {
      method, headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '처리하지 못했어요');
    return j;
  }
  function load(v) {
    V = v;
    qty = Object.fromEntries(v.cart.lines.map((l) => [l.sku, l.qty]));
    const ok = v.categories.filter((c) => c.status === 'approved');
    if (!tab || !ok.some((c) => c.id === tab)) tab = ok[0] ? ok[0].id : null;
  }
  const P = (id) => V.products.find((p) => p.id === id);
  const cartLines = () => Object.entries(qty).filter(([id, n]) => n > 0 && P(id)).map(([id, n]) => ({ ...P(id), qty: n }));
  const totals = () => { const l = cartLines(); return { count: l.length, amount: l.reduce((a, x) => a + x.qty * x.price, 0) }; };

  // 수량 변경 → 화면 즉시 반영, 서버 장바구니는 잠시 뒤 저장 (카톡 채팅과 공유)
  function setQty(id, n) {
    n = Math.max(0, Math.min(200, n));
    qty[id] = n;
    clearTimeout(timers[id]);
    saving.add(id);
    timers[id] = setTimeout(() => { call('PUT', '/cart', { sku: id, qty: n }).catch(() => {}).finally(() => saving.delete(id)); }, 450);
  }

  // ── 그리기 ──────────────────────────────────────────────
  function render() {
    if (view === 'done') return renderDone();
    const t = totals();
    const d = V.delivery;
    const head = `<header class="s-head">
      <span class="pf">B</span><div class="s-who"><b>${esc(V.store.name)}</b><small>${esc(V.store.bizLabel)}${V.store.owner ? ' · ' + esc(V.store.owner) + ' 사장님' : ''}</small></div>
      <button class="s-hbtn" data-view="${view === 'orders' ? 'shop' : 'orders'}">${view === 'orders' ? '← 발주하기' : '📦 발주 내역'}</button>
    </header>`;
    if (view === 'orders') { app.innerHTML = head + ordersHtml(); return; }

    const cats = V.categories;
    const tabs = `<nav class="s-tabs" aria-label="품목">${cats.map((c) => {
      const ok = c.status === 'approved';
      const n = ok ? cartLines().filter((l) => l.category === c.id).length : 0;
      return `<button class="s-tab ${c.id === tab ? 'on' : ''} ${ok ? '' : 'lock'}" data-tab="${c.id}" ${c.id === tab ? 'aria-current="true"' : ''}>
        <span class="s-ti">${c.icon}</span><span>${esc(c.short)}</span>${ok ? (n ? `<i class="s-dot">${n}</i>` : '') : `<em>${c.status === 'pending' ? '승인 대기' : '🔒 신청'}</em>`}</button>`;
    }).join('')}</nav>`;

    const banner = `<div class="s-banner ${d.sameDay ? '' : 'next'}"><span class="s-bi">🚚</span><div>지금 발주하면 <b>${esc(d.word)} 오후</b> 도착<small>${d.sameDay ? `당일배송은 ${esc(d.cutoff)}까지 발주 · 결제는 ${V.payMethod === 'invoice' ? '월말 청구' : '등록 카드'}` : `당일배송 마감(${esc(d.cutoff)})이 지나 다음 배송일에 도착해요`}</small></div></div>`;
    const notice = V.pendingProposal ? `<div class="alert-line warn">재고 기반 발주 제안(${esc(V.pendingProposal)})이 승인을 기다리고 있어요. 알림톡의 [발주 확인하기]에서 함께 처리해 주세요.</div>` : '';
    const quickRow = `<div class="s-quick">
      ${V.hasLastOrder ? '<button class="s-chip" data-act="reorder">🔁 지난번과 똑같이</button>' : ''}
      <button class="s-chip ${quick === 'fav' ? 'on' : ''}" data-quick="${quick === 'fav' ? 'all' : 'fav'}">⭐ 자주 시키는 품목</button>
      <label class="s-search"><span aria-hidden="true">🔍</span><input id="q" type="search" placeholder="품목 찾기" value="${esc(q)}" aria-label="품목 찾기"></label>
    </div>`;

    let body;
    const cur = cats.find((c) => c.id === tab);
    if (!cur) body = '<div class="empty">발주할 수 있는 품목이 없어요. 운영팀에 문의해 주세요.</div>';
    else {
      let list = V.products.filter((p) => p.category === tab);
      if (quick === 'fav') list = list.filter((p) => p.freq > 0).sort((a, b) => b.freq - a.freq);
      if (q.trim()) list = list.filter((p) => (p.name + ' ' + p.spec).toLowerCase().includes(q.trim().toLowerCase()));
      body = list.length ? `<div class="s-list">${list.map(itemHtml).join('')}</div>`
        : `<div class="empty">${quick === 'fav' ? '아직 자주 시킨 품목이 없어요' : '찾는 품목이 없어요'}</div>`;
    }
    const lockInfo = cats.filter((c) => c.status !== 'approved');
    const more = lockInfo.length ? `<button class="s-more" data-act="access">➕ 다른 품목도 발주하고 싶어요 <small>${lockInfo.map((c) => `${c.icon} ${esc(c.short)}${c.status === 'pending' ? ' (승인 대기)' : ''}`).join(' · ')}</small></button>` : '';

    const short = Math.max(0, V.minAmount - t.amount);
    const bar = t.count ? `<div class="s-bar"><div class="s-bar-in">
        <button class="s-cartsum" data-act="cart"><b>🛒 ${t.count}품목 담음</b><span>${won(t.amount)}</span>${short ? `<small>최소 발주까지 ${won(short)}</small>` : ''}</button>
        <button class="s-go" data-act="cart" ${short ? 'disabled' : ''}>발주하기</button></div></div>` : '';

    app.innerHTML = head + banner + notice + tabs + quickRow + body + more + (V.channelChatUrl ? `<p class="m-note s-foot">문의는 <a href="${esc(V.channelChatUrl)}" target="_blank" rel="noopener">카카오톡 채널 채팅</a>으로 보내 주세요.</p>` : '') + bar;
    app.classList.toggle('has-bar', !!t.count);
  }

  function itemHtml(p) {
    const n = qty[p.id] || 0;
    return `<div class="s-item ${n ? 'in' : ''}">
      <div class="s-ico" aria-hidden="true">${ICON[p.category] || '📦'}</div>
      <div class="s-info"><b>${esc(p.name)}</b><small>${esc(p.spec || `${p.pack}${p.unit} / 박스`)}</small>
        <span class="s-price">${won(p.price)}<i>/${esc(p.u)}</i></span>${p.lastQty && !n ? `<button class="s-last" data-set="${esc(p.id)}" data-n="${p.lastQty}">지난번 ${p.lastQty}${esc(p.u)} 담기</button>` : ''}</div>
      ${n ? `<div class="s-step" role="group" aria-label="${esc(p.name)} 수량">
          <button data-d="-1" data-id="${esc(p.id)}" aria-label="하나 빼기">−</button><output>${n}</output><button data-d="1" data-id="${esc(p.id)}" aria-label="하나 더하기">+</button></div>`
        : `<button class="s-add" data-d="1" data-id="${esc(p.id)}" aria-label="${esc(p.name)} 담기">담기</button>`}
    </div>`;
  }

  function ordersHtml() {
    if (!V.orders.length) return '<div class="m-card m-done"><div class="m-lead">아직 발주 내역이 없어요</div></div>';
    const steps = (o) => {
      const i = { created: 0, sent: 0, payfail: 1, paid: 1, dispatched: 2, delivered: 3 }[o.status];
      if (i == null) return '';
      return `<ol class="s-steps">${['접수', '확정', '배송 중', '도착'].map((s, k) => `<li class="${k < i ? 'ok' : k === i ? (o.status === 'payfail' ? 'bad' : 'cur') : ''}">${s}</li>`).join('')}</ol>`;
    };
    return V.orders.map((o) => `<section class="m-card s-order">
      <div class="s-oh"><b>${esc(o.code)}</b><span class="s-pill st-${esc(o.status)}">${esc(o.statusText)}</span></div>
      <small class="muted">${md(o.createdAt)} ${hm(o.createdAt)} · ${o.source === 'chat' ? '카카오톡' : o.source === 'web' ? '발주 화면' : '재고 기반 제안'}${o.eta && o.status === 'dispatched' ? ` · ${hm(o.eta)}경 도착 예정` : ''}${o.deliveredAt ? ` · ${hm(o.deliveredAt)} 도착` : ''}</small>
      ${steps(o)}
      <div>${o.lines.map((l) => `<div class="m-line"><div class="nm">${esc(l.name)}</div><b>${l.qty}${esc(l.u)}</b></div>`).join('')}</div>
      <div class="m-total"><span>합계</span><span>${won(o.amount)}</span></div></section>`).join('')
      + (V.hasLastOrder ? '<button class="m-btn" data-act="reorder">🔁 지난번과 똑같이 담기</button>' : '');
  }

  function renderDone() {
    const o = done;
    const ok = o.status === 'paid';
    app.classList.remove('has-bar');
    app.innerHTML = `<section class="m-card m-done s-done">
      <div class="s-check ${ok ? '' : 'bad'}">${ok ? '✓' : '!'}</div>
      <div class="m-lead"><b>${ok ? '발주가 완료됐어요' : '결제 확인이 필요해요'}</b></div>
      <div class="m-note">${esc(o.code)} · ${won(o.amount)}${o.payMethod === 'invoice' ? ' (월말 청구)' : ''}</div>
      <div class="s-arrive">${ok ? `🚚 <b>${esc(o.statusText)}</b>` : esc(o.payFailReason || '운영팀이 곧 연락드릴게요')}</div>
      <p class="m-note">확정·배송 소식은 카카오톡 알림톡으로 보내 드려요.</p>
      <div class="m-btns"><button class="m-btn pri" data-view="shop">계속 발주하기</button><button class="m-btn" data-view="orders">발주 내역 보기</button>
      ${V.channelChatUrl ? `<a class="m-btn s-linkbtn" href="${esc(V.channelChatUrl)}">카카오톡 채널로 돌아가기</a>` : ''}</div></section>`;
  }

  // ── 시트 (장바구니 확인 · 품목 신청) ─────────────────────────────
  function sheet(html) {
    sheetRoot.innerHTML = `<div class="s-sheet-bg" data-close="1"><div class="s-sheet" role="dialog" aria-modal="true">${html}</div></div>`;
    document.body.classList.add('lock');
  }
  function closeSheet() { sheetRoot.innerHTML = ''; document.body.classList.remove('lock'); }

  function cartSheet() {
    const lines = cartLines();
    if (!lines.length) return closeSheet();
    const t = totals();
    const short = Math.max(0, V.minAmount - t.amount);
    if (!ref) ref = 'web-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const byCat = {};
    lines.forEach((l) => { (byCat[l.category] = byCat[l.category] || []).push(l); });
    sheet(`<div class="s-sh"><h2>발주 확인</h2><button class="xbtn" data-close="1" aria-label="닫기">✕</button></div>
      <div class="s-sb">${Object.entries(byCat).map(([c, ls]) => `<div class="sec-h">${ICON[c]} ${esc((V.categories.find((x) => x.id === c) || {}).short || '')}</div>${ls.map((l) => `
        <div class="m-line"><div class="nm">${esc(l.name)}<small>${won(l.price)} × ${l.qty} = ${won(l.price * l.qty)}</small></div>
        <div class="s-step sm"><button data-d="-1" data-id="${esc(l.id)}" aria-label="하나 빼기">−</button><output>${l.qty}</output><button data-d="1" data-id="${esc(l.id)}" aria-label="하나 더하기">+</button></div></div>`).join('')}`).join('')}
        <div class="m-total"><span>합계 · ${t.count}품목</span><span>${won(t.amount)}</span></div>
        <div class="s-arrive">🚚 <b>${esc(V.delivery.word)} 오후</b> 도착 예정 · ${V.payMethod === 'invoice' ? '월말 청구' : '등록 카드 결제'}</div>
        ${short ? `<div class="alert-line warn">최소 발주 금액은 ${won(V.minAmount)}이에요. ${won(short)}어치 더 담아 주세요.</div>` : ''}
        <div class="form-err" id="err"></div></div>
      <div class="s-sf"><button class="m-btn pri" data-act="submit" ${short || busy ? 'disabled' : ''}>${won(t.amount)} 발주 확정</button></div>`);
  }

  function accessSheet(pre) {
    const list = V.categories.filter((c) => c.status !== 'approved');
    sheet(`<div class="s-sh"><h2>다른 품목 이용 신청</h2><button class="xbtn" data-close="1" aria-label="닫기">✕</button></div>
      <div class="s-sb"><p class="m-note" style="margin:0">신청하시면 운영팀이 확인 후 열어 드려요. 승인되면 카카오톡으로 알려 드려요.</p>
      ${list.map((c) => `<label class="s-opt ${c.status === 'pending' ? 'dis' : ''}"><input type="radio" name="cat" value="${c.id}" ${c.status === 'pending' ? 'disabled' : ''} ${c.id === pre ? 'checked' : ''}>
        <span class="s-ti">${c.icon}</span><span><b>${esc(c.label)}</b><small>${c.status === 'pending' ? '승인 대기 중' : c.status === 'rejected' ? `지난 신청 미승인${c.decideNote ? ' · ' + esc(c.decideNote) : ''} — 다시 신청할 수 있어요` : '신청 가능'}</small></span></label>`).join('')}
      <label class="fld"><span>하고 싶은 말 (선택)</span><input id="note" maxlength="200" placeholder="예: 매점에 커피도 들이려고요"></label>
      <div class="form-err" id="err"></div></div>
      <div class="s-sf"><button class="m-btn pri" data-act="request">이용 신청하기</button></div>`);
  }

  // ── 동작 ────────────────────────────────────────────────
  function toast(m, bad) {
    const d = document.createElement('div'); d.className = 's-toast' + (bad ? ' bad' : ''); d.textContent = m;
    document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
  }
  async function act(a, el) {
    if (a === 'cart') return cartSheet();
    if (a === 'access') return accessSheet();
    if (a === 'reorder') {
      try { load(await call('POST', '/reorder', {})); view = 'shop'; render(); toast('지난 발주 품목을 담았어요'); cartSheet(); } catch (e) { toast(e.message, true); }
      return;
    }
    if (a === 'request') {
      const pick = sheetRoot.querySelector('input[name=cat]:checked');
      if (!pick) { sheetRoot.querySelector('#err').textContent = '신청할 품목을 골라 주세요'; return; }
      el.disabled = true;
      try { load(await call('POST', '/access', { category: pick.value, note: sheetRoot.querySelector('#note').value })); closeSheet(); render(); toast('신청했어요. 승인되면 카카오톡으로 알려 드릴게요'); } catch (e) { sheetRoot.querySelector('#err').textContent = e.message; el.disabled = false; }
      return;
    }
    if (a === 'submit') {
      if (busy) return;
      busy = true; el.disabled = true; el.textContent = '접수 중…';
      Object.values(timers).forEach(clearTimeout);
      saving.clear();
      const items = Object.fromEntries(cartLines().map((l) => [l.id, l.qty]));
      try {
        const r = await call('POST', '/order', { items, ref });
        done = r.order; ref = null; load(r.view); closeSheet(); view = 'done'; render(); window.scrollTo(0, 0);
      } catch (e) {
        const err = sheetRoot.querySelector('#err'); if (err) err.textContent = e.message;
        el.disabled = false; el.textContent = '다시 시도';
      } finally { busy = false; }
    }
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('button, [data-close], a');
    if (!el || !V) return;
    const d = el.dataset;
    if (d.close && (ev.target === el || el.classList.contains('xbtn'))) return closeSheet();
    if (d.view) { view = d.view; closeSheet(); render(); window.scrollTo(0, 0); return; }
    if (d.tab) {
      const c = V.categories.find((x) => x.id === d.tab);
      if (c.status !== 'approved') return accessSheet(c.status === 'pending' ? null : c.id);
      tab = d.tab; render(); return;
    }
    if (d.quick) { quick = d.quick; render(); return; }
    if (d.d) { setQty(d.id, (qty[d.id] || 0) + Number(d.d)); render(); if (sheetRoot.innerHTML) cartSheet(); return; }
    if (d.set) { setQty(d.set, Number(d.n)); render(); return; }
    if (d.act) act(d.act, el);
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id !== 'q') return;
    q = ev.target.value; const pos = ev.target.selectionStart; render();
    const i = document.getElementById('q'); if (i) { i.focus(); i.setSelectionRange(pos, pos); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && sheetRoot.innerHTML) closeSheet(); });
  // 다른 곳(카카오톡 채팅)에서 담은 품목을 반영: 화면으로 돌아올 때 새로 불러오기
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !V || sheetRoot.innerHTML || view === 'done' || saving.size || busy) return;
    call('GET', '').then((v) => { load(v); render(); }).catch(() => {});
  });

  call('GET', '').then((v) => { load(v); render(); }).catch((e) => {
    app.innerHTML = `<div class="m-card m-done"><div class="m-lead">${esc(e.message)}</div><p class="m-note">BevFlow 카카오톡 채널에서 [발주하기]를 눌러 새 링크로 열어 주세요.</p></div>`;
  });
})();
