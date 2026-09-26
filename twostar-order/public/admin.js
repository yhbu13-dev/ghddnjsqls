'use strict';
// 관리자 화면: 주문 · 출고 집계 · 품목 승인 · 매장 · 품목
(() => {
  const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
  const time = (ms) => new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  async function call(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json', 'x-ts': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.includes('login')) { location.href = '/admin/login'; throw new Error('로그인이 필요합니다'); }
    if (!r.ok) throw new Error(j.error || '오류가 났어요');
    return j;
  }

  // ── 로그인 화면 ──
  const f = document.getElementById('f');
  if (f) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await call('/admin/login', { password: document.getElementById('pw').value }); location.href = '/admin'; } catch (err) { document.getElementById('err').textContent = err.message; }
    });
    return;
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v; // CSP: 속성 대신 CSSOM
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
    return el;
  }
  function toast(msg) {
    const t = h('div', { class: 'toast' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }

  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  let D = null;
  let tab = 'orders';
  let filter = 'open';
  let lastEvent = 0;
  let flash = null; // 방금 만든 매장 코드·링크

  const TABS = [
    ['orders', '주문'], ['pick', '출고 집계'], ['requests', '품목 승인'], ['stores', '매장'], ['items', '품목'],
  ];

  async function act(path, body, msg) {
    try { D = await call(path, body); if (msg) toast(msg); render(); return true; } catch (e) { toast(e.message); return false; }
  }

  function render() {
    const open = D.orders.filter((o) => o.status === 'received').length;
    nav.replaceChildren(...TABS.map(([k, label]) => {
      const n = k === 'orders' ? open : k === 'requests' ? D.requests.length : 0;
      return h('button', { class: `chip${tab === k ? ' on' : ''}`, onclick: () => { tab = k; render(); } }, label, n ? h('span', { class: 'badge' }, n) : null);
    }));
    document.title = open ? `(${open}) 투스타 발주 관리자` : '투스타 발주 관리자';
    main.replaceChildren(...[].concat(({ orders, pick, requests, stores, items })[tab]()).flat().filter(Boolean));
  }

  // ── 주문 ──
  function orders() {
    const F = { open: ['received', 'confirmed'], shipped: ['shipped'], all: null };
    const list = D.orders.filter((o) => !F[filter] || F[filter].includes(o.status));
    const L = D.labels;
    return [
      D.events.length ? h('div', { class: 'panel events' }, h('h2', null, '새 소식'),
        D.events.slice().reverse().slice(0, 5).map((e) => h('div', null, `${time(e.at)} · ${e.text}`))) : null,
      h('div', { class: 'panel' },
        h('div', { class: 'filters' }, [['open', '처리할 주문'], ['shipped', '출고됨'], ['all', '전체']].map(([k, l]) => h('button', {
          class: `chip${filter === k ? ' on' : ''}`, onclick: () => { filter = k; render(); },
        }, l))),
        list.length ? list.map((o) => h('div', { class: 'ord' },
          h('div', { class: 'hd' },
            h('b', null, o.store_name), h('span', { class: `tag ${o.status}` }, o.status_label),
            h('span', { class: 'small muted' }, `${o.no} · ${time(o.created_at)} · ${L.biz[o.biz]} · ${o.via === 'chat' ? '카톡' : '발주서'}`),
            h('b', { style: 'margin-left:auto' }, won(o.total))),
          h('div', { class: 'ls' }, o.lines.map((l) => h('div', null, `${l.name} ${l.qty}${l.unit}`))),
          o.next.length ? h('div', { class: 'acts noprint' }, o.next.map((s) => h('button', {
            class: `btn ${s === 'canceled' ? 'bad' : 'primary'}`,
            onclick: () => { if (s !== 'canceled' || confirm(`${o.store_name} ${o.no} 주문을 취소할까요?`)) act('/api/admin/status', { id: o.id, status: s }); },
          }, s === 'canceled' ? '취소' : `${L.status[s]} 처리`))) : null))
          : h('p', { class: 'muted' }, '주문이 없습니다.')),
    ];
  }

  // ── 출고 집계 ──
  function pick() {
    return h('div', { class: 'panel' },
      h('h2', null, '출고 집계 (접수·확인 주문 합계)'),
      h('button', { class: 'btn noprint', onclick: () => window.print() }, '인쇄'),
      D.pick.length ? h('table', null,
        h('tr', null, h('th', null, '품목'), h('th', null, '규격'), h('th', { class: 'num' }, '수량'), h('th', { class: 'num' }, '매장 수')),
        D.pick.map((p) => h('tr', null, h('td', null, p.name), h('td', null, p.spec), h('td', { class: 'num' }, `${p.qty}${p.unit}`), h('td', { class: 'num' }, p.stores))))
        : h('p', { class: 'muted' }, '출고할 주문이 없습니다.'));
  }

  // ── 품목 승인 ──
  function requests() {
    const L = D.labels;
    return h('div', { class: 'panel' },
      h('h2', null, '추가 품목 이용 신청'),
      D.requests.length ? h('table', null,
        h('tr', null, h('th', null, '매장'), h('th', null, '업종'), h('th', null, '신청 품목'), h('th', null, '신청 시각'), h('th', null, '')),
        D.requests.map((r) => h('tr', null,
          h('td', null, r.store_name), h('td', null, L.biz[r.biz]), h('td', null, L.categories[r.category]), h('td', null, time(r.requested_at)),
          h('td', null,
            h('button', { class: 'btn ok', onclick: () => act('/api/admin/access', { store_id: r.store_id, category: r.category, decision: 'approve' }, '승인했습니다') }, '승인'), ' ',
            h('button', { class: 'btn bad', onclick: () => act('/api/admin/access', { store_id: r.store_id, category: r.category, decision: 'reject' }, '반려했습니다') }, '반려')))))
        : h('p', { class: 'muted' }, '대기 중인 신청이 없습니다.'));
  }

  // ── 매장 ──
  function stores() {
    const L = D.labels;
    const name = h('input', { placeholder: '예: 해오름사우나 본점' });
    const biz = h('select', null, Object.entries(L.biz).map(([k, v]) => h('option', { value: k }, v)));
    const owner = h('input', { placeholder: '홍길동' });
    const phone = h('input', { placeholder: '010-0000-0000' });
    const create = async () => {
      try {
        const r = await call('/api/admin/stores', { name: name.value, biz: biz.value, owner: owner.value, phone: phone.value });
        flash = { name: name.value, code: r.code, link: r.link };
        D = await call('/api/admin/data');
        render();
      } catch (e) { toast(e.message); }
    };
    const showCode = async (s) => {
      try { const r = await call('/api/admin/code', { id: s.id }); flash = { name: s.name, code: r.code }; render(); } catch (e) { toast(e.message); }
    };
    const copyLink = async (s) => {
      try {
        const r = await call('/api/admin/link', { id: s.id });
        await navigator.clipboard.writeText(r.link).catch(() => { flash = { name: s.name, link: r.link }; render(); });
        toast('발주서 링크를 복사했어요');
      } catch (e) { toast(e.message); }
    };
    return [
      flash ? h('div', { class: 'panel', style: 'border:2px solid #fee500' },
        h('h2', null, `${flash.name} — 점주에게 전달하세요`),
        flash.code ? [h('div', null, '카톡 연결 코드 (한 번만 사용)'), h('div', { class: 'codebox' }, flash.code),
          h('p', { class: 'small muted' }, '점주가 "투스타글로벌(발주)" 채널을 추가하고 채팅창에 이 6자리를 보내면 매장과 연결됩니다.')] : null,
        flash.link ? h('p', { class: 'small', style: 'word-break:break-all' }, `발주서 링크: ${flash.link}`) : null,
        h('button', { class: 'btn', onclick: () => { flash = null; render(); } }, '닫기')) : null,
      h('div', { class: 'panel' }, h('h2', null, '매장 추가'),
        h('div', { class: 'form' },
          h('label', null, '매장 이름', name), h('label', null, '업종', biz), h('label', null, '점주', owner), h('label', null, '연락처', phone),
          h('button', { class: 'btn primary', onclick: create }, '추가하고 연결 코드 받기'))),
      h('div', { class: 'panel' }, h('h2', null, `매장 ${D.stores.length}곳`),
        h('table', null,
          h('tr', null, h('th', null, '매장'), h('th', null, '업종'), h('th', null, '추가 승인 품목'), h('th', null, '카톡'), h('th', null, '')),
          D.stores.map((s) => h('tr', null,
            h('td', null, s.name, h('div', { class: 'small muted' }, [s.owner, s.phone].filter(Boolean).join(' · '))),
            h('td', null, L.biz[s.biz]),
            h('td', null, (s.extra || '').split(',').filter(Boolean).map((c) => L.categories[c]).join(', ') || '-'),
            h('td', null, s.kakao ? `연결됨${s.kakao > 1 ? ` (${s.kakao}명)` : ''}` : s.code ? `코드 ${s.code}` : '미연결'),
            h('td', null,
              h('button', { class: 'btn', onclick: () => showCode(s) }, '연결 코드'), ' ',
              h('button', { class: 'btn', onclick: () => copyLink(s) }, '발주서 링크'),
              (s.extra || '').split(',').filter(Boolean).map((c) => [' ', h('button', {
                class: 'btn bad', onclick: () => confirm(`${s.name}의 ${L.categories[c]} 승인을 취소할까요?`) && act('/api/admin/access', { store_id: s.id, category: c, decision: 'revoke' }, '승인을 취소했습니다'),
              }, `${L.categories[c]} 해제`)])))))),
    ];
  }

  // ── 품목 ──
  let editing = null;
  function items() {
    const L = D.labels;
    const e = editing || { category: 'snack', grp: '', name: '', spec: '', unit: '개', price: '', sort: 0 };
    const F = {
      category: h('select', null, Object.entries(L.categories).map(([k, v]) => h('option', { value: k, selected: k === e.category }, v))),
      grp: h('input', { value: e.grp, placeholder: '예: 과자' }),
      name: h('input', { value: e.name, placeholder: '예: 새우깡' }),
      spec: h('input', { value: e.spec, placeholder: '예: 1박스 20입' }),
      unit: h('input', { value: e.unit }),
      price: h('input', { value: e.price, inputmode: 'numeric' }),
      sort: h('input', { value: e.sort, inputmode: 'numeric' }),
    };
    const saveItem = async () => {
      const body = Object.fromEntries(Object.entries(F).map(([k, el]) => [k, el.value]));
      if (editing) body.id = editing.id;
      const was = editing;
      editing = null;
      if (!(await act('/api/admin/items', body, was ? '수정했습니다' : '추가했습니다'))) editing = was;
    };
    const byCat = Object.keys(L.categories).map((c) => [c, D.items.filter((i) => i.category === c)]);
    return [
      h('div', { class: 'panel' }, h('h2', null, editing ? `품목 수정 — ${editing.name}` : '품목 추가'),
        h('div', { class: 'form' },
          h('label', null, '분류', F.category), h('label', null, '진열대·묶음', F.grp), h('label', null, '품목 이름', F.name),
          h('label', null, '규격', F.spec), h('label', null, '단위', F.unit), h('label', null, '단가(원)', F.price), h('label', null, '순서', F.sort),
          h('button', { class: 'btn primary', onclick: saveItem }, editing ? '저장' : '추가'),
          editing ? h('button', { class: 'btn', onclick: () => { editing = null; render(); } }, '취소') : null)),
      byCat.map(([c, list]) => h('div', { class: 'panel' }, h('h2', null, `${L.categories[c]} (${list.length})`),
        h('table', null,
          h('tr', null, h('th', null, '묶음'), h('th', null, '품목'), h('th', null, '규격'), h('th', { class: 'num' }, '단가'), h('th', null, '')),
          list.map((i) => h('tr', { style: i.active ? null : 'opacity:.45' },
            h('td', null, i.grp), h('td', null, i.name), h('td', null, i.spec), h('td', { class: 'num' }, won(i.price)),
            h('td', null,
              h('button', { class: 'btn', onclick: () => { editing = i; render(); window.scrollTo(0, 0); } }, '수정'), ' ',
              h('button', { class: 'btn', onclick: () => act('/api/admin/item-active', { id: i.id, active: !i.active }) }, i.active ? '판매 중지' : '다시 판매'))))))),
    ];
  }

  async function refresh(first) {
    try {
      const d = await call('/api/admin/data');
      const fresh = d.events.filter((e) => e.at > lastEvent);
      if (!first && fresh.length) toast(fresh[fresh.length - 1].text);
      if (d.events.length) lastEvent = d.events[d.events.length - 1].at;
      D = d;
      // 입력 중이면 화면을 다시 그리지 않는다
      const typing = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
      if (first || !typing) render();
    } catch (e) { if (first) main.replaceChildren(h('p', null, e.message)); }
  }

  document.getElementById('logout').addEventListener('click', async () => { await call('/admin/logout', {}); location.href = '/admin/login'; });
  setInterval(() => { document.getElementById('clock').textContent = new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }); }, 1000);
  refresh(true);
  setInterval(() => refresh(false), 20000);
})();
