'use strict';
// 사장님 발주 확인 페이지 — 알림톡 버튼으로 여는 링크 (로그인 없음, 서명 토큰으로 본인 발주만 조회)
(() => {
  const app = document.getElementById('app');
  const token = location.pathname.split('/o/')[1] || '';
  const preview = location.hash === '#preview';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const KST = 9 * 3600e3;
  const hm = (ts) => { const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
  const dayWord = (dateStr) => {
    const now = new Date(Date.now() + KST);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const [y, m, d] = dateStr.split('-').map(Number);
    const diff = Math.round((Date.UTC(y, m - 1, d) - today) / 864e5);
    return diff === 0 ? '오늘' : diff === 1 ? '내일' : `${m}월 ${d}일`;
  };
  let V = null, qty = {};

  async function call(method, path, body) {
    const r = await fetch('/api/owner/' + encodeURIComponent(token) + path + (preview && method === 'GET' ? '?preview=1' : ''), {
      method, headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '처리하지 못했습니다');
    return j;
  }
  const total = () => V.lines.reduce((a, l) => a + (qty[l.sku] ?? l.qty) * l.price, 0);

  function render() {
    const v = V;
    const head = `<div class="m-head"><span class="pf">B</span><div><b>BevFlow 발주 확인</b><small>${esc(v.store)}${v.owner ? ' · ' + esc(v.owner) + ' 사장님' : ''}</small></div></div>`;
    const l0 = v.lines.find((l) => l.trig) || v.lines[0];
    if (!v.canAct) {
      const s = v.status;
      const msg = s === 'paid' || s === 'dispatched' ? `✓ 발주가 확정됐어요<br><b>${v.eta ? dayWord(new Date(v.eta + KST).toISOString().slice(0, 10)) + ' ' + hm(v.eta) + '경' : v.deliverDate ? dayWord(v.deliverDate) + ' 오후(13~17시)' : ''}</b> 도착 예정이에요`
        : s === 'delivered' ? `✓ 배송이 완료됐어요${v.deliveredAt ? ` (${hm(v.deliveredAt)})` : ''}`
          : s === 'payfail' ? `결제가 완료되지 않았어요<br><span class="m-note">${esc(v.payFailReason || '')} — BevFlow 운영팀이 곧 연락드릴게요</span>`
            : s === 'held' ? '보류했어요. 내일 오전에 재고를 다시 확인해 안내드릴게요.'
              : s === 'expired' ? '응답 시간이 지나 이번 제안은 만료됐어요. 내일 오전에 다시 안내드릴게요.'
                : s === 'cancelled' ? '이 발주는 취소됐어요.' : '발송 준비 중인 제안이에요.';
      app.innerHTML = `${head}<div class="m-card m-done"><div class="m-lead">${msg}</div><div class="m-note">${esc(v.code)} · 합계 ${won(v.amount)}${v.payMethod === 'invoice' ? ' (월말 청구)' : ''}</div></div>${linesCard(false)}`;
      return;
    }
    app.innerHTML = `${head}
      <div class="m-card"><div class="m-lead">${l0 ? `<b>${esc(l0.name)}</b> 재고가 약 <b>${l0.est}박스(±${l0.band})</b> 남은 것으로 보여요.` : ''}<br>발주를 진행할까요?</div>
        <div class="m-note">${v.sameDay ? `${esc(v.cutoff)} 전에 승인하시면 <b>오늘 오후</b> 도착해요.` : `지금 승인하시면 <b>다음 배송일 오후</b> 도착해요.`}${v.expiresAt ? ` · ${hm(v.expiresAt)}까지 응답이 없으면 제안이 만료돼요.` : ''}</div></div>
      ${linesCard(true)}
      <div class="m-btns"><button class="m-btn pri" id="ok">이대로 발주하기 · ${won(total())}</button><button class="m-btn" id="hold">이번엔 보류</button></div>
      <p class="m-note">수량은 − / + 로 바꿀 수 있어요. 필요 없는 품목은 0으로 두세요. 결제는 ${v.payMethod === 'sandbox_card' ? '등록 카드로 자동 결제' : '월말 청구'}됩니다.${preview ? '<br><b>운영자 미리보기</b> — 이 화면을 연 것은 열람으로 기록되지 않습니다.' : ''}</p>`;
    document.getElementById('ok').onclick = () => act('approve');
    document.getElementById('hold').onclick = () => act('hold');
    app.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
      const sku = b.dataset.sku, l = v.lines.find((x) => x.sku === sku);
      qty[sku] = Math.max(0, Math.min(200, (qty[sku] ?? l.qty) + Number(b.dataset.d)));
      render();
    }));
  }
  function linesCard(editable) {
    return `<div class="m-card"><h2 style="font-size:14px">발주 품목</h2>${V.lines.map((l) => {
      const q = qty[l.sku] ?? l.qty;
      return `<div class="m-line"><div class="nm">${esc(l.name)}${l.trig ? ' <span class="badge b-bad nodot">재고 부족</span>' : ''}<small>${won(l.price)}/박스${l.qtyOrig !== l.qty ? ` · 제안 ${l.qtyOrig}박스` : ''}</small></div>
        ${editable ? `<div class="qty-step"><button data-sku="${esc(l.sku)}" data-d="-1" aria-label="${esc(l.name)} 한 박스 빼기">−</button><input readonly value="${q}" aria-label="${esc(l.name)} 수량"><button data-sku="${esc(l.sku)}" data-d="1" aria-label="${esc(l.name)} 한 박스 더하기">+</button></div>` : `<b>${q}박스</b>`}</div>`;
    }).join('')}<div class="m-total"><span>합계</span><span>${won(editable ? total() : V.amount)}</span></div></div>`;
  }
  async function act(kind) {
    if (preview) { alertBox('미리보기에서는 승인·보류할 수 없어요.'); return; }
    const btns = app.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
    try {
      const changed = {}; V.lines.forEach((l) => { if (qty[l.sku] != null && qty[l.sku] !== l.qty) changed[l.sku] = qty[l.sku]; });
      V = await call('POST', '/' + kind, kind === 'approve' ? { qty: Object.keys(changed).length ? changed : null } : {});
      qty = {};
      render();
    } catch (e) { btns.forEach((b) => { b.disabled = false; }); alertBox(e.message); }
  }
  function alertBox(m) {
    const d = document.createElement('div'); d.className = 'alert-line bad'; d.textContent = m;
    app.prepend(d); setTimeout(() => d.remove(), 5000);
  }
  call('GET', '').then((v) => { V = v; render(); }).catch((e) => {
    app.innerHTML = `<div class="m-card m-done"><div class="m-lead">${esc(e.message)}</div><p class="m-note">BevFlow 운영팀에 문의해 주세요.</p></div>`;
  });
})();
