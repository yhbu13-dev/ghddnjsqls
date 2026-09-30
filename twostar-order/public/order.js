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

  let tab = null; // 'usual' 자주 시키는 품목 · 'all' 전체 상품
  function take(v) {
    V = v;
    qty = { ...v.cart };
    if (!cat || !v.categories.some((c) => c.id === cat)) cat = v.categories[0] ? v.categories[0].id : null;
    if (!tab) tab = usual().length ? 'usual' : 'all';
    if (tab === 'usual' && !usual().length) tab = 'all';
  }
  const usual = () => V.items.filter((i) => i.last > 0);

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

  // 부가세 10%: 품목 줄마다 계산해 더함 (확인서·명세서와 같은 방식). items 는 { price, q|qty[id] }
  const vatOf = (items) => items.reduce((a, i) => a + Math.round(i.price * (i.q ?? qty[i.id]) * 0.1), 0);

  const totals = () => {
    let count = 0; let total = 0;
    for (const it of V.items) {
      const q = qty[it.id] || 0;
      if (q > 0) { count++; total += q * it.price; }
    }
    return { count, total };
  };

  // ── 마감 · 도착 예정 (한국 시간 기준, 서버 [설정]의 마감 시각·배송 기간) ──
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const kst = (ms) => new Date(ms + 9 * 3600e3); // getUTC* 로 읽으면 한국 날짜·시각
  const md = (d) => `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${DOW[d.getUTCDay()]})`;
  const hourText = (hh) => (hh === 12 ? '낮 12시' : hh > 12 ? `오후 ${hh - 12}시` : `오전 ${hh}시`);
  function addDays(ms, n) {
    const d = kst(ms);
    for (let left = n; left > 0;) {
      d.setUTCDate(d.getUTCDate() + 1);
      const w = d.getUTCDay();
      if (V.rules.skipWeekend && (w === 0 || w === 6)) continue;
      left--;
    }
    return d;
  }
  function deadline() {
    const R = V.rules;
    const now = Date.now();
    const d = kst(now);
    const w = d.getUTCDay();
    const off = R.skipWeekend && (w === 0 || w === 6);
    const left = R.cutoffHour > 0 ? R.cutoffHour * 60 - (d.getUTCHours() * 60 + d.getUTCMinutes()) : null;
    const open = left == null || (!off && left > 0);
    let base = now; // 접수일: 마감 전 평일이면 오늘, 아니면 다음 영업일
    if (!open) {
      const isOff = (t) => { const x = kst(t).getUTCDay(); return R.skipWeekend && (x === 0 || x === 6); };
      do base += 86400e3; while (isOff(base));
    }
    const a = addDays(base, R.deliveryMin);
    const b = addDays(base, R.deliveryMax);
    const range = R.deliveryMin === R.deliveryMax ? md(a) : `${md(a)}~${md(b).replace(/^\d+월 /, a.getUTCMonth() === b.getUTCMonth() ? '' : '$&')}`;
    const cta = R.deliveryMin === R.deliveryMax ? `${md(a)}에 받기` : '주문하기';
    if (left == null) return { title: '필요한 만큼 담아 주세요', sub: `지금 주문하면 ${range}에 받아요`, range, cta };
    if (open) {
      return {
        title: left >= 60 ? `마감까지 ${Math.floor(left / 60)}시간 ${left % 60}분` : `마감까지 ${left}분`,
        sub: `오늘 ${hourText(R.cutoffHour)}까지 주문하면 ${range}에 받아요`, range, cta, soon: left < 60,
      };
    }
    return { title: off ? '오늘은 쉬는 날이에요' : '오늘 마감 지났어요', sub: `지금 주문하면 ${range}에 받아요`, range, cta };
  }
  let tick = null;
  function startTick() {
    clearInterval(tick);
    tick = setInterval(() => {
      const t = document.getElementById('dl-title');
      if (!t) return clearInterval(tick);
      const D = deadline();
      t.textContent = D.title;
      t.classList.toggle('soon', !!D.soon);
      document.getElementById('dl-sub').textContent = D.sub;
      renderBar();
    }, 30000);
  }

  function setQ(id, q) {
    q = Math.max(0, Math.min(999, q));
    if (q) qty[id] = q; else delete qty[id];
    for (const row of document.querySelectorAll(`[data-id="${id}"]`)) {
      row.classList.toggle('on', q > 0);
      row.querySelector('.q').textContent = q;
      row.querySelector('.minus').disabled = !q;
    }
    renderBar();
    scheduleSave();
  }

  // 하단 고정: 담은 품목 · 합계 · 안내 한 줄 + 큰 버튼 (최소 금액 미달이면 잠김)
  function renderBar() {
    const bar = document.getElementById('bar');
    if (!bar) return;
    const t = totals();
    const D = deadline();
    const note = h('div', { class: 'note-l' }, `부가세 별도 · ${D.range} 도착 예정`);
    bar.replaceChildren(
      h('div', { class: 'acc' },
        h('div', { class: 'sumline' }, h('span', null, t.count ? `${t.count}개 품목` : '담은 품목 없음'), h('b', null, won(t.total))),
        note),
      h('button', { class: 'btn cta', disabled: !t.count, onclick: confirmSheet }, t.count ? D.cta : '품목을 담아 주세요'));
  }

  function row(it) {
    const q = qty[it.id] || 0;
    return h('div', { class: `row${q ? ' on' : ''}`, 'data-id': it.id },
      it.image ? h('img', { class: 'thumb', src: `/img/${it.image}`, alt: '', loading: 'lazy' }) : null,
      h('div', { class: 'info' },
        h('div', { class: 'name' }, it.name),
        h('div', { class: 'desc' }, [it.spec, won(it.price)].filter(Boolean).join(', ')),
        tab === 'all' && it.last ? h('div', { class: 'was' }, `지난번 ${it.last}${it.unit}`) : null),
      h('div', { class: 'step' },
        h('button', { class: 'minus', disabled: !q, 'aria-label': `${it.name} 수량 줄이기`, onclick: () => setQ(it.id, (qty[it.id] || 0) - 1) }, '−'),
        h('span', { class: 'q', 'aria-live': 'polite' }, q),
        h('button', { class: 'plus', 'aria-label': `${it.name} 수량 늘리기`, onclick: () => setQ(it.id, (qty[it.id] || 0) + 1) }, '+')));
  }

  function render() {
    const D = deadline();
    const vat = h('span', { class: 'vat' }, '*부가세 별도');
    const body = [];
    if (tab === 'usual') {
      body.push(h('section', { class: 'group' }, h('h2', null, '자주 시키는 품목', h('span', { class: 'muted' }, usual().length), vat), usual().map(row)));
    } else {
      const items = V.items.filter((i) => i.category === cat);
      const groups = [];
      for (const it of items) {
        let g = groups.find((x) => x.name === it.grp);
        if (!g) groups.push(g = { name: it.grp, items: [] });
        g.items.push(it);
      }
      const gid = (i) => `g${i}`;
      if (V.categories.length > 1) {
        body.push(h('div', { class: 'tabs' }, V.categories.map((c) => h('button', {
          class: c.id === cat ? 'on' : null, onclick: () => { cat = c.id; render(); },
        }, c.label))));
      }
      if (groups.length > 1) {
        body.push(h('div', { class: `chips${V.categories.length > 1 ? ' under' : ''}` }, groups.map((g, i) => h('button', {
          onclick: () => document.getElementById(gid(i)).scrollIntoView({ behavior: 'smooth' }),
        }, g.name, h('span', { class: 'n' }, g.items.length)))));
      }
      groups.forEach((g, i) => body.push(h('section', { class: 'group', id: gid(i) },
        h('h2', null, g.name, h('span', { class: 'muted' }, g.items.length), vat.cloneNode(true)), g.items.map(row))));
    }
    app.replaceChildren(...[
      h('div', { class: 'hero' },
        h('div', { class: 'cap' }, V.store.name),
        h('h1', { id: 'dl-title', class: D.soon ? 'soon' : null }, D.title),
        h('p', { id: 'dl-sub', class: 'sub' }, D.sub)),
      homeTip(),
      usual().length ? h('div', { class: 'seg2' }, [['usual', '자주 시키는 품목'], ['all', '전체 상품']].map(([k, l]) => h('button', {
        class: tab === k ? 'on' : null, 'aria-pressed': tab === k ? 'true' : 'false', onclick: () => { tab = k; render(); window.scrollTo(0, 0); },
      }, l))) : null,
      body,
      extras(),
      h('div', { class: 'pad' }),
      h('div', { class: 'bar', id: 'bar' }),
    ].flat().filter(Boolean));
    renderBar();
    startTick();
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

  const cell = (label, sub, right, onclick) => h(onclick ? 'button' : 'div', { class: 'cell', onclick },
    h('span', { class: 'l' }, label, sub ? h('small', null, sub) : null),
    h('span', { class: 'r' }, right, onclick ? h('span', { class: 'chev' }, '›') : null));

  function extras() {
    const more = V.access.filter((a) => a.state !== 'base');
    const label = { none: '신청하기', pending: '승인 대기 중', approved: '이용 중', rejected: '다시 신청' };
    const date = (ms) => { const d = kst(ms); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
    return [
      h('section', { class: 'block' },
        h('h3', null, '빠르게 채우기'),
        cell('지난 발주 그대로 불러오기', V.last ? `${V.last.no} · ${won(V.last.total)}` : '지난 발주가 없어요', null, V.last ? loadLast : null),
        cell('모두 0으로 비우기', null, null, () => { for (const k of Object.keys(qty)) delete qty[k]; render(); scheduleSave(); })),
      V.orders.length ? h('section', { class: 'block' },
        h('h3', null, '최근 발주'),
        V.orders.map((o) => h(o.doc ? 'a' : 'div', { class: 'cell', href: o.doc },
          h('span', { class: 'l' }, won(o.total), h('small', null, `${date(o.at)} · ${o.no}`)),
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
    const same = usual().every((i) => (qty[i.id] || 0) === i.last) && Object.keys(qty).every((id) => V.items.find((i) => i.id === Number(id))?.last);
    if (same) return toast('이미 지난번과 똑같아요');
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
      h('div', { class: 'vats' },
        h('div', null, h('span', null, '공급가액'), h('span', null, won(t.total))),
        h('div', null, h('span', null, '부가세 (10%)'), h('span', null, won(vatOf(chosen))))),
      h('div', { class: 'total' }, h('span', null, '합계 (부가세 포함)'), h('b', null, won(t.total + vatOf(chosen)))),
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
      const chosen = V.items.filter((i) => qty[i.id] > 0).map((i) => ({ ...i, q: qty[i.id] }));
      const r = await api('/submit', 'POST', { rev: V.rev });
      document.querySelector('.sheet')?.remove();
      take(r.view);
      clearInterval(tick);
      app.replaceChildren(h('div', { class: 'done2' },
        h('div', { class: 'hero' },
          h('div', { class: 'check' }, '✓'),
          h('h1', null, r.duplicate ? '이미 주문했어요' : '주문했어요'),
          h('p', { class: 'sub' }, r.eta ? `${r.eta.range.replace(/(\d+)\/(\d+)/g, '$1월 $2일')}에 도착해요` : '담당자가 확인하면 카카오톡으로 알려 드려요'),
          h('div', { class: 'lower' },
            r.doc ? h('a', { class: 'btn soft small', href: r.doc }, '발주 확인서 보기') : null,
            h('button', { class: 'btn small', onclick: render }, '발주서 다시 보기'))),
        h('div', { class: 'meta-l' }, `주문번호 ${r.no} · 담당자가 확인하면 카카오톡으로 알려 드려요`),
        h('section', { class: 'group' }, chosen.map((i) => h('div', { class: 'row' },
          h('div', { class: 'info' }, h('div', { class: 'name' }, i.name), h('div', { class: 'desc' }, `${i.q}${i.unit}`)),
          h('b', { class: 'amt' }, won(i.q * i.price))))),
        h('div', { class: 'pad' }),
        h('div', { class: 'bar' },
          h('div', { class: 'acc' }, h('div', { class: 'sumline' }, h('span', null, '합계 (부가세 포함)'), h('b', null, won(r.total + vatOf(chosen))))),
          // 카카오톡 인앱 브라우저 닫기 (카톡 밖에서 열었으면 아무 일 없음)
          h('a', { class: 'btn cta', href: 'kakaotalk://inappbrowser/close' }, '확인'))));
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
