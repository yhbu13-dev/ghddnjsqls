'use strict';
// 기사 배송 페이지 — 배차 때 발급되는 라우트 링크 (로그인 없음)
// 순서: [도착] → 하차 전 잔량 입력(박스·낱개) → [하차 완료]. 잔량은 재고 추정 보정에 바로 쓰인다.
(() => {
  const app = document.getElementById('app');
  const token = location.pathname.split('/d/')[1] || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KST = 9 * 3600e3;
  const hm = (ts) => { if (!ts) return '—'; const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  let V = null, openStop = null, draft = {};
  try { draft = JSON.parse(localStorage.getItem('bf.drv.' + token.slice(-12)) || '{}'); } catch { draft = {}; }
  const saveDraft = () => { try { localStorage.setItem('bf.drv.' + token.slice(-12), JSON.stringify(draft)); } catch { /* 저장 불가 */ } };

  async function call(method, path, body) {
    const r = await fetch('/api/driver/' + encodeURIComponent(token) + path, { method, headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '처리하지 못했습니다');
    return j;
  }
  function render() {
    const done = V.stops.filter((s) => s.status === 'done').length;
    const cur = V.stops.find((s) => s.status === 'arrived') || V.stops.find((s) => s.status === 'pending');
    if (openStop == null && cur) openStop = cur.id;
    app.innerHTML = `<div class="m-head"><span class="pf">B</span><div><b>${esc(V.driver || '기사')}님 · ${esc(V.region)}</b><small>${esc(V.date)} · ${esc(V.hub)} 출발 · 완료 ${done}/${V.stops.length}</small></div></div>
      ${V.stops.map(stopCard).join('')}
      ${done === V.stops.length ? '<div class="m-card m-done"><div class="m-lead">✓ 오늘 배송을 모두 마쳤어요. 수고하셨습니다!</div></div>' : ''}
      <p class="m-note">문제가 있으면 [배송 실패]로 사유를 남기면 다음 배송일에 다시 배차됩니다.</p>`;
  }
  function stopCard(s) {
    const cls = s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : s.id === openStop ? 'cur' : '';
    const status = { pending: '대기', arrived: '하차 중', done: `완료 ${hm(s.departedAt)}`, failed: '실패 · ' + esc(s.failReason || '') }[s.status];
    const map = s.address ? `<a href="https://map.kakao.com/link/search/${encodeURIComponent(s.address)}" target="_blank" rel="noopener noreferrer">지도</a>` : '';
    const tel = s.phone ? `<a href="tel:${esc(s.phone.replace(/[^0-9+]/g, ''))}">${esc(s.phone)}</a>` : '';
    let body = '';
    if (s.id === openStop && (s.status === 'pending' || s.status === 'arrived')) {
      body = `<div class="m-row"><b>하차</b> ${s.unload.map((u) => `${esc(u.name)} ${u.qty}박스`).join(' · ')}</div>`;
      if (s.status === 'pending') body += `<div class="m-btns"><button class="m-btn pri" data-arrive="${s.id}">도착</button><button class="m-btn bad" data-fail="${s.id}">배송 실패</button></div>`;
      else {
        const dv = draft[s.id] || {};
        body += `<div class="m-note">하차하기 <b>전에</b> 매장에 남은 음료를 세어 주세요. 없으면 0.</div>
          <div class="cnt-grid"><span></span><span class="h">박스</span><span class="h">낱개</span>${s.count.map((c) => `<span>${esc(c.name)}<br><small class="muted">${c.pack}${esc(c.unit)}/박스</small></span><input type="number" min="0" inputmode="numeric" data-b="${esc(c.sku)}" value="${esc(dv[c.sku + ':b'] ?? '')}" aria-label="${esc(c.name)} 박스"><input type="number" min="0" inputmode="numeric" data-u="${esc(c.sku)}" value="${esc(dv[c.sku + ':u'] ?? '')}" aria-label="${esc(c.name)} 낱개">`).join('')}</div>
          <div class="m-btns"><button class="m-btn pri" data-done="${s.id}">잔량 저장 · 하차 완료</button><button class="m-btn bad" data-fail="${s.id}">배송 실패</button></div>`;
      }
    }
    return `<section class="m-card m-stop ${cls}" data-open="${s.id}">
      <div class="m-row" style="justify-content:space-between"><b style="font-size:15px">${s.seq}. ${esc(s.store)}</b><span class="badge ${s.status === 'done' ? 'b-ok' : s.status === 'failed' ? 'b-bad' : s.status === 'arrived' ? 'b-warn' : 'b-mute'}">${status}</span></div>
      <div class="m-row"><span class="muted">예정 ${hm(s.eta)}</span><span class="muted">·</span><span>${s.boxes}박스</span>${map ? '<span class="muted">·</span>' + map : ''}${tel ? '<span class="muted">·</span>' + tel : ''}</div>
      ${s.address ? `<div class="m-note">${esc(s.address)}</div>` : ''}${body}</section>`;
  }
  app.addEventListener('input', (e) => {
    const t = e.target; const sid = openStop;
    if (!sid || !(t.dataset.b || t.dataset.u)) return;
    draft[sid] = draft[sid] || {};
    draft[sid][(t.dataset.b || t.dataset.u) + (t.dataset.b ? ':b' : ':u')] = t.value;
    saveDraft();
  });
  app.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    const card = e.target.closest('[data-open]');
    if (!b && card && !e.target.closest('a, input')) { openStop = +card.dataset.open; render(); return; }
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.arrive) V = await call('POST', `/stops/${b.dataset.arrive}/arrive`, {});
      if (b.dataset.done) {
        const s = V.stops.find((x) => x.id === +b.dataset.done);
        const counts = {};
        for (const c of s.count) {
          const bx = app.querySelector(`[data-b="${c.sku}"]`).value, un = app.querySelector(`[data-u="${c.sku}"]`).value;
          if (bx === '' && un === '') throw new Error(`${c.name} 잔량을 입력해 주세요 (없으면 0)`);
          counts[c.sku] = (Number(bx) || 0) + (Number(un) || 0) / c.pack;
        }
        V = await call('POST', `/stops/${s.id}/complete`, { counts });
        delete draft[s.id]; saveDraft(); openStop = null;
      }
      if (b.dataset.fail) {
        const reason = await askReason();
        if (!reason) { b.disabled = false; return; }
        V = await call('POST', `/stops/${b.dataset.fail}/fail`, { reason });
        openStop = null;
      }
      render();
    } catch (err) {
      b.disabled = false;
      const d = document.createElement('div'); d.className = 'alert-line bad'; d.textContent = err.message;
      app.prepend(d); setTimeout(() => d.remove(), 5000);
    }
  });
  function askReason() {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-bg';
      wrap.innerHTML = `<div class="modal sm"><div class="modal-h"><h2 style="font-size:16px">배송 실패 사유</h2></div><div class="modal-b m-btns">${['매장 휴무', '사장님 부재 · 연락 두절', '주차 불가', '차량 문제', '기타'].map((r) => `<button class="m-btn" data-r="${r}">${r}</button>`).join('')}<button class="m-btn" data-r="">취소</button></div></div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', (e) => { const x = e.target.closest('[data-r]'); if (!x) return; wrap.remove(); resolve(x.dataset.r); });
    });
  }
  const load = () => call('GET', '').then((v) => { V = v; render(); }).catch((e) => { app.innerHTML = `<div class="m-card m-done"><div class="m-lead">${esc(e.message)}</div><p class="m-note">운영팀에 새 링크를 요청하세요.</p></div>`; });
  load();
  setInterval(() => { if (document.visibilityState === 'visible' && !app.querySelector('input:focus')) call('GET', '').then((v) => { V = v; render(); }).catch(() => {}); }, 60000);
})();
