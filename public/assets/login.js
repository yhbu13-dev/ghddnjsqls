'use strict';
// 로그인 · 비밀번호 변경
(() => {
  const $ = (s) => document.querySelector(s);
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '요청에 실패했습니다');
    return j;
  };
  const showChange = () => { $('#loginForm').hidden = true; $('#changeForm').hidden = false; $('#cur').focus(); };
  if (new URLSearchParams(location.search).get('change') === '1') {
    fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? showChange() : null));
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#err').textContent = '';
    try {
      const j = await post('/api/auth/login', { email: $('#email').value.trim(), password: $('#password').value });
      if (j.user.must_change) { $('#cur').value = $('#password').value; showChange(); return; }
      const next = new URLSearchParams(location.search).get('next') || '';
      location.href = /^\/[a-z]{0,10}$/.test(next) ? next : '/'; // 관리자 카톡 알림 버튼(/a)에서 온 경우 되돌아간다
    } catch (err) { $('#err').textContent = err.message; }
  });
  $('#changeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#err2').textContent = '';
    if ($('#next').value !== $('#next2').value) { $('#err2').textContent = '새 비밀번호가 서로 다릅니다'; return; }
    try {
      await post('/api/auth/password', { current: $('#cur').value, next: $('#next').value });
      $('#changeForm').hidden = true; $('#loginForm').hidden = false;
      $('#err').textContent = '비밀번호를 바꿨습니다. 새 비밀번호로 로그인하세요.';
      $('#password').value = ''; $('#password').focus();
    } catch (err) { $('#err2').textContent = err.message; }
  });
  $('#email').focus();
})();
