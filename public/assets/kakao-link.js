'use strict';
// 매장 연결 (/k/link) — 카카오톡 채널 챗봇·카카오 로그인 사용자를 매장에 묶는다.
// ?t= 챗봇 사용자 토큰 · ?l= 카카오 로그인 사용자 토큰(번호로 자동 연결 실패 시) · ?err= 오류 안내
(() => {
  const app = document.getElementById('app');
  const qs = new URLSearchParams(location.search);
  const t = qs.get('t') || '', l = qs.get('l') || '', err = qs.get('err') || '';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const head = '<div class="m-head"><span class="pf">B</span><div><b>BevFlow 매장 연결</b><small>처음 한 번만 연결하면 돼요</small></div></div>';

  function render(info) {
    if (!t && !l) {
      app.innerHTML = `${head}${err ? `<div class="alert-line bad">${esc(err)}</div>` : ''}
        <section class="m-card"><div class="m-lead">카카오톡 <b>BevFlow 채널</b>에서 [발주하기]를 눌러 시작해 주세요.</div>
        ${info.login ? '<a class="m-btn s-kakao" href="/k/login">카카오 로그인으로 시작하기</a>' : ''}</section>`;
      return;
    }
    app.innerHTML = `${head}${err ? `<div class="alert-line bad">${esc(err)}</div>` : ''}
      ${l ? '<div class="alert-line warn">카카오 계정의 휴대폰 번호와 등록된 사장님 번호가 달라 자동으로 연결하지 못했어요. 연결 코드를 입력해 주세요.</div>' : ''}
      <section class="m-card"><h2>연결 코드 6자리</h2><p class="m-note" style="margin:0">BevFlow 운영팀이 문자·전화로 알려 드린 숫자예요.</p>
        <input id="code" class="s-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="000000" aria-label="연결 코드 6자리">
        <div class="form-err" id="e"></div>
        <button class="m-btn pri" id="go">매장 연결하기</button></section>
      ${t && info.login ? `<section class="m-card"><div class="m-note" style="margin:0">연결 코드가 없나요? 사장님 휴대폰 번호로 가입한 카카오 계정이면 자동으로 연결돼요.</div>
        <a class="m-btn s-kakao" href="/k/login?t=${encodeURIComponent(t)}">카카오 로그인으로 연결</a></section>` : ''}`;
    const code = document.getElementById('code');
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); if (code.value.length === 6) go(); });
    document.getElementById('go').addEventListener('click', go);
    code.focus();
  }
  async function go() {
    const btn = document.getElementById('go'), e = document.getElementById('e');
    if (btn.disabled) return;
    btn.disabled = true; e.textContent = '';
    try {
      const r = await fetch('/api/kakao/link', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: JSON.stringify({ t, l, code: document.getElementById('code').value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '연결하지 못했어요');
      app.innerHTML = `${head}<section class="m-card m-done s-done"><div class="s-check">✓</div><div class="m-lead"><b>${esc(j.store)}</b><br>연결이 끝났어요</div>
        <p class="m-note">이제 카카오톡 채널에서 버튼만 눌러 발주할 수 있어요.</p><a class="m-btn pri s-linkbtn" href="${esc(j.orderUrl)}">지금 발주하기</a></section>`;
    } catch (ex) { e.textContent = ex.message; btn.disabled = false; }
  }
  fetch('/api/kakao/link-info').then((r) => r.json()).catch(() => ({})).then(render);
})();
