'use strict';
// 점주 발주서: 품목 전체를 한 장에서 +/- 로 고르고 한 번에 주문
(() => {
  const token = location.pathname.split('/').pop();
  const API = `/api/o/${token}`;
  const app = document.getElementById('app');
  const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
  let V = null; // 서버에서 받은 발주서
  let qty = {}; // 화면의 수량
  let cat = null; // 보고 있는 분류
  let saveTimer = null;
  let saving = null;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v; // CSP: 속성 대신 CSSOM
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  }

  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2400);
  }

  async function api(path, method = 'GET', body) {
    const r = await fetch(API + path, {
      method,
      headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-ts': '1' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '잠시 후 다시 시도해 주세요');
    return j;
  }

  function take(v) {
    V = v;
    qty = { ...v.cart };
    if (!cat || !v.categories.some((c) => c.id === cat)) cat = v.categories[0] ? v.categories[0].id : null;
  }

  // 수량을 바꾸면 0.6초 뒤 장바구니에 저장 (카톡 장바구니와 같은 것)
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const run = (saving || Promise.resolve()).then(() => api('/cart', 'PUT', { cart: qty }))
      .then((v) => { V.rev = v.rev; V.cart = v.cart; })
      .catch((e) => toast(e.message));
    saving = run;
    return run;
  }

  const totals = () => {
    let count = 0; let total = 0;
    for (const it of V.items) {
      const q = qty[it.id] || 0;
      if (q > 0) { count++; total += q * it.price; }
    }
    return { count, total };
  };

  function setQ(id, q) {
    q = Math.max(0, Math.min(999, q));
    if (q) qty[id] = q; else delete qty[id];
    const row = document.querySelector(`[data-id="${id}"]`);
    if (row) {
      row.classList.toggle('on', q > 0);
      const el = row.querySelector('.q');
      el.textContent = q;
      el.classList.toggle('zero', !q);
    }
    renderBar();
    scheduleSave();
  }

  function renderBar() {
    const bar = document.getElementById('bar');
    if (!bar) return;
    const t = totals();
    bar.replaceChildren(
      h('div', { class: 'sum' }, h('span', { class: 'small muted' }, `${t.count}품목`), h('b', null, won(t.total))),
      h('button', { class: 'btn yellow', disabled: !t.count, onclick: confirmSheet }, '주문하기'),
    );
  }

  function render() {
    const items = V.items.filter((i) => i.category === cat);
    const groups = [];
    for (const it of items) {
      let g = groups.find((x) => x.name === it.grp);
      if (!g) groups.push(g = { name: it.grp, items: [] });
      g.items.push(it);
    }
    const gid = (i) => `g${i}`;
    app.replaceChildren(...[
      h('div', { class: 'top' },
        h('h1', null, `${V.store.name}`),
        h('div', { class: 'meta' }, `${V.store.biz} · 발주서`, V.last ? ` · 지난 주문 ${V.last.no}` : '')),
      V.prefilled ? h('div', { class: 'banner' }, '📋 지난 발주 수량을 채워 두었어요. 바뀐 것만 고치고 [주문하기]를 누르세요.') : null,
      V.categories.length > 1 ? h('div', { class: 'tabs' }, V.categories.map((c) => h('button', {
        class: `chip${c.id === cat ? ' on' : ''}`, onclick: () => { cat = c.id; render(); window.scrollTo(0, 0); },
      }, c.label))) : null,
      groups.length > 1 ? h('div', { class: 'tabs', style: V.categories.length > 1 ? 'top:52px' : null }, groups.map((g, i) => h('button', {
        class: 'chip', onclick: () => document.getElementById(gid(i)).scrollIntoView({ behavior: 'smooth' }),
      }, g.name, h('span', { class: 'n' }, g.items.length)))) : null,
      groups.map((g, i) => h('div', { class: 'group', id: gid(i) },
        h('h2', null, g.name, h('span', { class: 'small muted' }, `${g.items.length}개`)),
        g.items.map((it) => {
          const q = qty[it.id] || 0;
          return h('div', { class: `row${q ? ' on' : ''}`, 'data-id': it.id },
            it.image ? h('img', { class: 'thumb', src: `/img/${it.image}`, alt: '', loading: 'lazy' }) : null,
            h('div', { class: 'info' },
              h('div', { class: 'name' }, it.name),
              h('div', { class: 'desc' }, [it.spec, won(it.price)].filter(Boolean).join(' · ')),
              it.last ? h('div', { class: 'was' }, `지난번 ${it.last}${it.unit}`) : null),
            h('div', { class: 'step' },
              h('button', { 'aria-label': '빼기', onclick: () => setQ(it.id, (qty[it.id] || 0) - 1) }, '−'),
              h('span', { class: `q${q ? '' : ' zero'}` }, q),
              h('button', { class: 'plus', 'aria-label': '더하기', onclick: () => setQ(it.id, (qty[it.id] || 0) + 1) }, '+')));
        }))),
      extras(),
      h('div', { class: 'pad' }),
      h('div', { class: 'bar', id: 'bar' }),
    ].flat().filter(Boolean));
    renderBar();
  }

  function extras() {
    const more = V.access.filter((a) => a.state !== 'base');
    const label = { none: '', pending: '⏳ 승인 대기', approved: '✅ 이용 중', rejected: '반려됨' };
    return [
      h('div', { class: 'section' },
        h('h3', null, '빠른 작업'),
        h('button', { class: 'btn', onclick: loadLast, disabled: !V.last }, '지난 발주 그대로 불러오기'), ' ',
        h('button', { class: 'btn', onclick: () => { for (const k of Object.keys(qty)) delete qty[k]; render(); scheduleSave(); } }, '모두 0으로')),
      h('div', { class: 'section' },
        h('h3', null, '다른 품목도 발주하기'),
        h('p', { class: 'small muted', style: 'margin:0 0 6px' }, '신청하면 담당자 승인 후 이 발주서에 나타납니다.'),
        more.map((a) => h('div', { class: 'acc' },
          h('span', null, a.label),
          a.state === 'none' || a.state === 'rejected'
            ? h('button', { class: 'btn', onclick: () => request(a.category) }, a.state === 'rejected' ? '다시 신청' : '신청')
            : h('span', { class: 'small muted' }, label[a.state])))),
      V.orders.length ? h('div', { class: 'section' },
        h('h3', null, '최근 발주'),
        V.orders.map((o) => h('div', { class: 'acc' }, h('span', null, `${o.no} · ${won(o.total)}`), h('span', { class: 'small muted' }, o.status)))) : null,
    ];
  }

  async function loadLast() {
    if (Object.keys(qty).length && !window.confirm('지금 고른 수량을 지우고 지난 발주로 바꿀까요?')) return;
    try { await saving; take(await api('/reorder', 'POST')); render(); toast('지난 발주를 불러왔어요'); } catch (e) { toast(e.message); }
  }

  async function request(category) {
    try { take(await api('/request', 'POST', { category })); render(); toast('신청했어요. 승인되면 알려 드릴게요'); } catch (e) { toast(e.message); }
  }

  function confirmSheet() {
    const t = totals();
    if (V.minAmount && t.total < V.minAmount) return toast(`최소 발주 금액은 ${won(V.minAmount)}입니다`);
    const chosen = V.items.filter((i) => qty[i.id] > 0);
    const diff = (it) => {
      if (!V.last) return null;
      if (!it.last) return h('span', { class: 'diff new' }, '새로 추가');
      const d = qty[it.id] - it.last;
      return d ? h('span', { class: `diff ${d > 0 ? 'up' : 'down'}` }, `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`) : null;
    };
    const dropped = V.last ? V.items.filter((i) => i.last && !qty[i.id]) : [];
    const box = h('div', { class: 'box' },
      h('h2', null, '이대로 주문할까요?'),
      h('div', { class: 'lines' }, chosen.map((it) => h('div', null,
        h('span', null, `${it.name} `, h('b', null, `${qty[it.id]}${it.unit}`), diff(it)),
        h('span', null, won(qty[it.id] * it.price))))),
      dropped.length ? h('p', { class: 'small down' }, `지난번엔 있었지만 이번엔 뺀 품목: ${dropped.map((i) => i.name).join(', ')}`) : null,
      h('div', { class: 'total' }, h('span', null, `${t.count}품목`), h('span', null, won(t.total))),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', onclick: () => sheet.remove() }, '더 고치기'),
        h('button', { class: 'btn yellow', onclick: (e) => submit(e.target) }, '주문 확정')));
    const sheet = h('div', { class: 'sheet', onclick: (e) => { if (e.target === sheet) sheet.remove(); } }, box);
    document.body.append(sheet);
  }

  async function submit(btn) {
    btn.disabled = true;
    try {
      if (saveTimer) save();
      await saving;
      const r = await api('/submit', 'POST', { rev: V.rev });
      document.querySelector('.sheet')?.remove();
      take(r.view);
      app.replaceChildren(h('div', { class: 'done' },
        h('div', { class: 'big' }, '✅'),
        h('h2', null, r.duplicate ? '이미 접수된 주문이에요' : '주문이 접수되었어요'),
        h('p', null, `주문번호 ${r.no}`, h('br'), `합계 ${won(r.total)}`),
        h('p', { class: 'muted small' }, '카카오톡 채팅방에서 [발주 내역]으로 상태를 볼 수 있어요.'),
        // 카카오톡 인앱 브라우저 닫기 (카톡 밖에서 열었으면 아무 일 없음)
        h('a', { class: 'btn yellow wide', href: 'kakaotalk://inappbrowser/close' }, '카카오톡으로 돌아가기'),
        h('p', null, h('button', { class: 'btn', onclick: render }, '발주서 다시 보기'))));
      window.scrollTo(0, 0);
    } catch (e) {
      btn.disabled = false;
      toast(e.message);
      if (/바뀌었/.test(e.message)) { take(await api('')); document.querySelector('.sheet')?.remove(); render(); }
    }
  }

  api('?fresh=1').then((v) => { take(v); render(); })
    .catch((e) => app.replaceChildren(h('p', { class: 'pad24' }, e.message)));
})();
