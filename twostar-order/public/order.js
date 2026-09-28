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
    if (!r.ok) throw new Error(j.error || `서버에 연결되지 않아요 (${r.status}). 카카오톡에서 발주서를 다시 열어 주세요`);
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
      row.querySelector('.q').textContent = q;
    }
    renderBar();
    scheduleSave();
  }

  function renderBar() {
    const bar = document.getElementById('bar');
    if (!bar) return;
    const t = totals();
    bar.replaceChildren(h('button', { class: 'btn cta', disabled: !t.count, onclick: confirmSheet },
      t.count ? [h('span', { class: 'cnt' }, t.count), `${won(t.total)} 주문하기`] : '품목을 담아 주세요'));
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
    const multi = V.categories.length > 1;
    app.replaceChildren(...[
      h('div', { class: 'hero' },
        h('div', { class: 'cap' }, `${V.store.name} · ${V.store.biz}`),
        h('h1', null, V.prefilled ? '지난번처럼 채워 뒀어요' : '필요한 만큼 담아 주세요')),
      V.prefilled ? h('div', { class: 'note blue' }, h('span', null, '📋'), h('span', null, h('b', null, '지난 발주 수량이 들어가 있어요.'), h('br'), '바뀐 것만 고치고 주문하세요.')) : null,
      homeTip(),
      multi ? h('div', { class: 'tabs' }, V.categories.map((c) => h('button', {
        class: c.id === cat ? 'on' : null, onclick: () => { cat = c.id; render(); window.scrollTo(0, 0); },
      }, c.label))) : null,
      groups.length > 1 ? h('div', { class: `chips${multi ? ' under' : ''}` }, groups.map((g, i) => h('button', {
        onclick: () => document.getElementById(gid(i)).scrollIntoView({ behavior: 'smooth' }),
      }, g.name, h('span', { class: 'n' }, g.items.length)))) : null,
      groups.map((g, i) => h('section', { class: 'group', id: gid(i) },
        h('h2', null, g.name, h('span', { class: 'muted' }, g.items.length)),
        g.items.map((it) => {
          const q = qty[it.id] || 0;
          return h('div', { class: `row${q ? ' on' : ''}`, 'data-id': it.id },
            it.image ? h('img', { class: 'thumb', src: `/img/${it.image}`, alt: '', loading: 'lazy' }) : null,
            h('div', { class: 'info' },
              h('div', { class: 'name' }, it.name),
              h('div', { class: 'desc' }, h('span', { class: 'price' }, won(it.price)), it.spec ? ` · ${it.spec}` : ''),
              it.last ? h('div', { class: 'was' }, `지난번 ${it.last}${it.unit}`) : null),
            h('div', { class: 'step' },
              h('button', { class: 'minus', 'aria-label': '빼기', onclick: () => setQ(it.id, (qty[it.id] || 0) - 1) }, '−'),
              h('span', { class: 'q' }, q),
              h('button', { class: 'plus', 'aria-label': '더하기', onclick: () => setQ(it.id, (qty[it.id] || 0) + 1) }, '+')));
        }))),
      extras(),
      h('div', { class: 'pad' }),
      h('div', { class: 'bar', id: 'bar' }),
    ].flat().filter(Boolean));
    renderBar();
  }

  // 홈 화면에 붙여 두기 안내 (이미 홈 화면 아이콘으로 열었거나 [닫기]를 눌렀으면 숨김)
  function homeTip() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    let off = false;
    try { off = localStorage.getItem('ts_tip_off') === '1'; } catch { /* 저장 안 되는 브라우저 */ }
    if (standalone || off) return null;
    const ua = navigator.userAgent;
    const how = /KAKAOTALK/i.test(ua)
      ? '⋯ 메뉴 → [다른 브라우저로 열기] → [홈 화면에 추가]'
      : /iPhone|iPad/i.test(ua) ? '아래쪽 공유 버튼(□↑) → [홈 화면에 추가]' : '오른쪽 위 ⋮ 메뉴 → [홈 화면에 추가]';
    const box = h('div', { class: 'note' }, h('span', null, '📌'),
      h('span', null, h('b', null, '홈 화면에 두면 앱처럼 열려요'), h('br'), how),
      h('button', { class: 'x', onclick: () => { try { localStorage.setItem('ts_tip_off', '1'); } catch { /* 무시 */ } box.remove(); } }, '닫기'));
    return box;
  }

  const cell = (label, sub, right, onclick, attrs = {}) => h(onclick ? 'button' : 'div', { class: 'cell', onclick, ...attrs },
    h('span', { class: 'l' }, label, sub ? h('small', null, sub) : null),
    h('span', { class: 'r' }, right, onclick || attrs.href ? h('span', { class: 'chev' }, '›') : null));

  function extras() {
    const more = V.access.filter((a) => a.state !== 'base');
    const label = { none: '신청하기', pending: '승인 대기 중', approved: '이용 중', rejected: '다시 신청' };
    const date = (ms) => new Date(ms).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });
    return [
      h('section', { class: 'block' },
        h('h3', null, '빠르게 채우기'),
        cell('지난 발주 그대로 불러오기', V.last ? `${V.last.no} · ${won(V.last.total)}` : '지난 발주가 없어요', null, V.last ? loadLast : null),
        cell('모두 0으로 비우기', null, null, () => { for (const k of Object.keys(qty)) delete qty[k]; render(); scheduleSave(); })),
      V.orders.length ? h('section', { class: 'block' },
        h('h3', null, '최근 발주'),
        V.orders.map((o) => h(o.doc ? 'a' : 'div', { class: 'cell', href: o.doc },
          h('span', { class: 'l' }, `${won(o.total)}`, h('small', null, `${date(o.at)} · ${o.no}`)),
          h('span', { class: 'r' }, h('span', { class: 'tag' }, o.status), o.doc ? h('span', { class: 'chev' }, '›') : null)))) : null,
      more.length ? h('section', { class: 'block' },
        h('h3', null, '다른 품목도 발주하기'),
        h('p', { class: 'sub' }, '신청하면 담당자 승인 후 이 발주서에 나타나요.'),
        more.map((a) => (a.state === 'none' || a.state === 'rejected'
          ? cell(a.label, a.state === 'rejected' ? '반려되었어요' : null, h('span', { class: 'btn soft small' }, label[a.state]), () => request(a.category))
          : cell(a.label, null, label[a.state])))) : null,
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
    if (V.minAmount && t.total < V.minAmount) return toast(`최소 발주 금액은 ${won(V.minAmount)}이에요`);
    const chosen = V.items.filter((i) => qty[i.id] > 0);
    const diff = (it) => {
      if (!V.last) return null;
      if (!it.last) return h('span', { class: 'diff new' }, '새로 추가');
      const d = qty[it.id] - it.last;
      return d ? h('span', { class: `diff ${d > 0 ? 'up' : 'down'}` }, `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`) : null;
    };
    const dropped = V.last ? V.items.filter((i) => i.last && !qty[i.id]) : [];
    const box = h('div', { class: 'box' },
      h('div', { class: 'grab' }),
      h('h2', null, `${t.count}품목을 주문할까요?`),
      h('div', { class: 'muted small' }, V.store.name),
      h('div', { class: 'lines' }, chosen.map((it) => h('div', null,
        h('span', null, it.name, h('b', null, `${qty[it.id]}${it.unit}`), diff(it)),
        h('span', { class: 'amt' }, won(qty[it.id] * it.price))))),
      dropped.length ? h('p', { class: 'dropped' }, `지난번엔 있었는데 빠진 품목: ${dropped.map((i) => i.name).join(', ')}`) : null,
      h('div', { class: 'total' }, h('span', null, '합계'), h('b', null, won(t.total))),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', onclick: () => sheet.remove() }, '더 고치기'),
        h('button', { class: 'btn cta', onclick: (e) => submit(e.currentTarget) }, '주문 확정')));
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
        h('div', { class: 'check' }, '✓'),
        h('h2', null, r.duplicate ? '이미 접수된 발주예요' : '발주가 접수되었어요'),
        h('p', { class: 'lead' }, '담당자가 확인하면 카카오톡으로 알려 드려요'),
        h('div', { class: 'kv' },
          h('div', null, h('span', null, '주문번호'), h('b', null, r.no)),
          h('div', null, h('span', null, '합계'), h('b', null, won(r.total))),
          r.eta ? h('div', null, h('span', null, '도착 예정'), h('b', { class: 'hl' }, r.eta.range, h('br'), h('span', { class: 'small' }, `확인 후 ${r.eta.days}`))) : null),
        // 카카오톡 인앱 브라우저 닫기 (카톡 밖에서 열었으면 아무 일 없음)
        h('a', { class: 'btn cta big', href: 'kakaotalk://inappbrowser/close' }, '카카오톡으로 돌아가기'),
        r.doc ? h('a', { class: 'btn big', href: r.doc }, '발주 확인서 보기') : null,
        h('button', { class: 'link', onclick: render }, '발주서 다시 보기')));
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
