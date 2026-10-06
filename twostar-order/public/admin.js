'use strict';
// 관리자 화면: 주문 · 출고 집계 · 품목 승인 · 매장(매장별 발주 내역·명세서) · 품목 · 설정
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
    if (!r.ok) throw new Error(j.error || `서버가 응답하지 않아요 (${r.status}). 서버 창(검은 창)이 켜져 있는지 확인해 주세요`);
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
    ['orders', '주문'], ['pick', '출고 집계'], ['requests', '품목 승인'], ['stores', '매장'], ['items', '품목'], ['settings', '설정'],
  ];
  let storeView = null; // 매장 상세 { id, data }

  async function act(path, body, msg) {
    try { D = await call(path, body); if (msg) toast(msg); render(); return true; } catch (e) { toast(e.message); return false; }
  }

  function render() {
    const open = D.orders.filter((o) => o.status === 'received').length;
    nav.replaceChildren(...TABS.map(([k, label]) => {
      const n = k === 'orders' ? open : k === 'requests' ? D.requests.length : 0;
      return h('button', { class: tab === k ? 'on' : null, onclick: () => { tab = k; if (k === 'stores') storeView = null; render(); window.scrollTo(0, 0); } },
        label, n ? h('span', { class: 'badge' }, n) : null);
    }));
    document.title = open ? `(${open}) 투스타 발주 관리자` : '투스타 발주 관리자';
    main.replaceChildren(...[].concat(({ orders, pick, requests, stores, items, settings })[tab]()).flat().filter(Boolean));
  }

  const title = (t, sub, ...right) => h('div', { class: 'pagetitle' }, h('div', null, h('h1', null, t), sub ? h('p', null, sub) : null), right.length ? h('div', null, ...right) : null);
  const kpi = (label, value, sub, hot) => h('div', { class: `kpi${hot ? ' hot' : ''}` }, h('span', null, label), h('b', null, value), sub ? h('small', null, sub) : null);
  const empty = (t) => h('p', { class: 'empty' }, t);
  const kst = (ms) => new Date(ms + 9 * 3600e3).toISOString();

  // ── 주문 ──
  function orders() {
    const F = { open: ['received', 'confirmed'], shipped: ['shipped'], all: null };
    const list = D.orders.filter((o) => !F[filter] || F[filter].includes(o.status));
    const live = D.orders.filter((o) => o.status !== 'canceled');
    const today = kst(Date.now()).slice(0, 10);
    const month = today.slice(0, 7);
    const todays = live.filter((o) => kst(o.created_at).startsWith(today));
    const months = live.filter((o) => kst(o.created_at).startsWith(month));
    const nRecv = D.orders.filter((o) => o.status === 'received').length;
    const nConf = D.orders.filter((o) => o.status === 'confirmed').length;
    return [
      title('주문', '들어온 발주를 확인하고 출고까지 처리해요'),
      h('div', { class: 'kpis' },
        kpi('확인 기다리는 주문', `${nRecv}건`, nRecv ? '확인하면 점주에게 카톡이 가요' : '모두 확인했어요', nRecv > 0),
        kpi('출고 기다리는 주문', `${nConf}건`),
        kpi('오늘 발주', won(todays.reduce((a, o) => a + o.total, 0)), `${todays.length}건`),
        kpi('이번 달 발주', won(months.reduce((a, o) => a + o.total, 0)), `${months.length}건`)),
      D.events.length ? h('div', { class: 'panel events' }, h('h2', null, '새 소식'),
        D.events.slice().reverse().slice(0, 5).map((e) => h('div', null, h('time', null, time(e.at)), h('span', null, e.text)))) : null,
      h('div', { class: 'panel' },
        h('div', { class: 'seg' }, [['open', '처리할 주문'], ['shipped', '출고됨'], ['all', '전체']].map(([k, l]) => h('button', {
          class: filter === k ? 'on' : null, onclick: () => { filter = k; render(); },
        }, l))),
        list.length ? list.map((o) => orderCard(o)) : empty(filter === 'open' ? '처리할 주문이 없어요 👍' : '주문이 없어요')),
    ];
  }

  // 상태를 바꾸면 점주 카톡으로 알림이 간다 → 결과를 알려 줌
  //   휴대폰 알림(무료·즉시)을 먼저, 카톡은 다음에 채팅방을 열면 보임
  const notifyMsg = (n) => {
    if (!n) return '';
    const p = n.push || {};
    const parts = [];
    if (p.sent) parts.push(`휴대폰 알림 ${p.sent}대에 바로 보냈어요`);
    else if (p.phones) parts.push(`휴대폰 알림 실패${p.error ? ` (${p.error})` : ''}`);
    if (n.users) parts.push(n.configured && !n.error && n.sent ? `카톡 ${n.sent}명에게 보냈어요` : '카톡은 점주가 채팅방을 열면 보여요');
    if (!parts.length) parts.push('알림 받을 휴대폰·카톡이 없어요');
    return ` · ${parts.join(' · ')}`;
  };
  async function changeStatus(o, s) {
    if (s === 'canceled' && !confirm(`${o.store_name || ''} ${o.no} 주문을 취소할까요?\n점주에게 취소 알림이 갑니다.`)) return;
    try {
      const r = await call('/api/admin/status', { id: o.id, status: s });
      D = r;
      toast(`${o.no} ${D.labels.status[s]} 처리${notifyMsg(r.notify)}`);
      if (storeView) await openStore(storeView.id, storeView.data.month);
      render();
    } catch (e) { toast(e.message); }
  }
  // ── 실물 명세서 사진 올리기: 휴대폰 사진·스캔 파일을 긴 변 2000px JPEG 로 줄여서 (한 장 2MB 이하) ──
  function shrinkDoc(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('사진 파일을 읽지 못했어요'));
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 2000 / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          const g = cv.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
          g.drawImage(img, 0, 0, cv.width, cv.height);
          let q = 0.88; let url = cv.toDataURL('image/jpeg', q);
          while (url.length > 2.6e6 && q > 0.4) { q -= 0.12; url = cv.toDataURL('image/jpeg', q); }
          resolve(url);
        };
        img.onerror = () => reject(new Error('이 사진 형식은 열 수 없어요 (JPG·PNG 권장. PDF는 캡처해서 사진으로 올려 주세요)'));
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function uploadStatement({ storeId, orderId, title }, after) {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden' });
    input.addEventListener('change', async () => {
      const files = [...input.files].slice(0, 5);
      if (!files.length) return;
      if (input.files.length > 5) toast('한 번에 5장까지만 올라가요');
      toast('명세서를 올리는 중…');
      try {
        const images = [];
        for (const f of files) images.push(await shrinkDoc(f));
        const r = await call('/api/admin/statement', { store_id: storeId, order_id: orderId || null, title, images });
        D = r.data;
        toast(`명세서 ${r.pages}장을 올렸어요${orderId ? notifyMsg(r.notify) : ''}`);
        if (after) await after(); else render();
      } catch (e) { toast(e.message); }
      input.remove();
    });
    document.body.append(input);
    input.click();
  }
  const docBtns = (o) => [
    h('a', { class: 'btn small', href: `/admin/doc/order/${o.id}`, target: '_blank', rel: 'noopener' }, o.stmts ? `확인서 · 실물 명세서 ${o.stmts}` : '확인서'),
    h('a', { class: 'btn small', href: `/admin/doc/statement?order=${o.id}`, target: '_blank', rel: 'noopener' }, '거래명세서'),
    h('button', {
      class: 'btn small soft',
      onclick: () => uploadStatement({ storeId: o.store_id, orderId: o.id, title: `${o.no} 거래명세서` }, storeView ? () => openStore(storeView.id, storeView.data.month) : null),
    }, '실물 명세서 올리기'),
  ];
  function orderCard(o, inStore) {
    const L = D.labels;
    return h('div', { class: 'ord' },
      h('div', { class: 'hd' },
        inStore ? null : h('a', { class: 'who', href: '#', onclick: (e) => { e.preventDefault(); tab = 'stores'; openStore(o.store_id); } }, o.store_name),
        h('span', { class: `tag ${o.status}` }, o.status_label),
        h('span', { class: 'meta' }, `${o.no} · ${time(o.created_at)}${o.biz ? ` · ${L.biz[o.biz]}` : ''} · ${o.via === 'chat' ? '카톡' : '발주서'}`),
        h('span', { class: 'amt' }, won(o.total))),
      h('div', { class: 'ls' }, o.lines.map((l) => h('span', null, l.name, h('b', null, `${l.qty}${l.unit}`)))),
      o.memo ? h('p', { class: 'small muted' }, `요청 사항: ${o.memo}`) : null,
      h('div', { class: 'acts noprint' },
        o.next.filter((s) => s !== 'canceled').map((s) => h('button', { class: 'btn primary small', onclick: () => changeStatus(o, s) },
          s === 'confirmed' ? '확인하고 카톡 알림' : s === 'shipped' ? '출고 처리' : `${L.status[s]} 처리`)),
        docBtns(o),
        h('span', { class: 'sp' }),
        o.next.includes('canceled') ? h('button', { class: 'btn bad small', onclick: () => changeStatus(o, 'canceled') }, '주문 취소') : null));
  }

  // ── 매장 상세: 월별 발주 내역 · 거래명세서 ──
  async function openStore(id, month) {
    try {
      const data = await call(`/api/admin/store?id=${id}${month ? `&month=${month}` : ''}`);
      storeView = { id, data };
      render();
      window.scrollTo(0, 0);
    } catch (e) { toast(e.message); }
  }
  function storeDetail() {
    const { store: s, months, month, from, to, orders: list } = storeView.data;
    const L = D.labels;
    const live = list.filter((o) => o.status !== 'canceled');
    const sum = live.reduce((a, o) => a + o.total, 0);
    const all = months.reduce((a, m) => a + m.total, 0);
    const pf = h('input', { type: 'date', value: from });
    const pt = h('input', { type: 'date', value: to });
    const ym = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
    const test = async () => {
      try {
        const r = await call('/api/admin/notify-test', { id: s.id });
        toast(`테스트 알림${notifyMsg(r)}`);
      } catch (e) { toast(e.message); }
    };
    const unlink = async () => {
      if (!confirm(`${s.name}에 연결된 카톡 ${s.kakao}명의 연결을 모두 끊을까요?`)) return;
      try { const r = await call('/api/admin/unlink', { id: s.id }); D = r.data; toast(`카톡 ${r.unlinked}명 연결을 끊었어요`); await openStore(s.id, month); } catch (e) { toast(e.message); }
    };
    return [
      h('button', { class: 'back', onclick: () => { storeView = null; render(); } }, '‹ 매장 목록'),
      h('div', { class: 'panel' },
        h('div', { class: 'storehead' },
          h('div', { class: 'av' }, s.name.slice(0, 1)),
          h('div', null, h('h1', null, s.name), h('p', null, [L.biz[s.biz], s.owner, s.phone].filter(Boolean).join(' · '))),
          h('div', { class: 'acts' },
            h('span', { class: 'stat' }, h('span', { class: `dot${s.kakao ? ' on' : ''}` }), s.kakao ? `카톡 연결 ${s.kakao}명` : '카톡 미연결'),
            h('span', { class: 'stat' }, h('span', { class: `dot${s.phones ? ' on' : ''}` }), s.phones ? `휴대폰 알림 ${s.phones}대` : '휴대폰 알림 꺼짐'),
            s.kakao || s.phones ? h('button', { class: 'btn small', onclick: test }, '알림 테스트') : null,
            s.kakao ? h('button', { class: 'btn small bad', onclick: unlink }, '연결 해제') : null))),
      h('div', { class: 'kpis' },
        kpi(`${ym(month)} 발주`, won(sum), `${live.length}건`),
        kpi('누적 발주', won(all), `${months.reduce((a, m) => a + m.count, 0)}건 · ${months.length}개월`),
        kpi('평균 발주 금액', live.length ? won(Math.round(sum / live.length)) : '-', ym(month))),
      h('div', { class: 'panel' },
        h('h2', null, '기간 거래명세서', h('span', { class: 'small muted' }, '발주 기록으로 자동으로 만들어요')),
        h('div', { class: 'form' },
          h('label', null, '시작일', pf), h('label', null, '종료일', pt),
          h('button', { class: 'btn primary', onclick: () => window.open(`/admin/doc/statement?store=${s.id}&from=${pf.value}&to=${pt.value}`, '_blank', 'noopener') }, '명세서 만들기'))),
      h('div', { class: 'panel' },
        h('h2', null, '실물 명세서', h('span', { class: 'small muted' }, '회사 프로그램에서 뽑은 명세서 사진 · 점주가 발주서·확인서·카톡에서 봐요')),
        (() => {
          const t = h('input', { placeholder: `예: ${ym(month)} 거래명세서`, value: `${ym(month)} 거래명세서` });
          const sel = h('select', null, h('option', { value: '' }, '주문 연결 안 함 (매장 전체)'),
            list.map((o) => h('option', { value: o.id }, `${o.no} · ${won(o.total)}`)));
          return h('div', { class: 'form' },
            h('label', null, '제목', t), h('label', null, '연결할 주문', sel),
            h('button', { class: 'btn primary', onclick: () => uploadStatement({ storeId: s.id, orderId: sel.value ? Number(sel.value) : null, title: t.value }, () => openStore(s.id, month)) }, '사진 골라 올리기 (5장까지)'));
        })(),
        storeView.data.statements.length ? h('div', { class: 'tbl', style: 'margin-top:12px' }, h('table', null,
          h('tr', null, h('th', null, '명세서'), h('th', null, '연결 주문'), h('th', null, '올린 날'), h('th', null, '')),
          storeView.data.statements.map((x) => h('tr', null,
            h('td', null, h('b', null, x.title || '거래명세서'), h('div', { class: 'small muted' }, `${x.pages}장`)),
            h('td', { class: 'muted' }, x.order_id ? (list.find((o) => o.id === x.order_id)?.no || `주문 #${x.order_id}`) : '매장 전체'),
            h('td', { class: 'muted' }, time(x.created_at)),
            h('td', null, h('div', { class: 'acts' },
              h('a', { class: 'btn small', href: `/admin/doc/st/${x.id}`, target: '_blank', rel: 'noopener' }, '보기'),
              h('button', {
                class: 'btn small bad',
                onclick: async () => {
                  if (!confirm(`'${x.title || '거래명세서'}'를 삭제할까요? 점주도 더 이상 볼 수 없어요.`)) return;
                  try { const r = await call('/api/admin/statement-delete', { id: x.id }); D = r.data; toast('명세서를 삭제했어요'); await openStore(s.id, month); } catch (e) { toast(e.message); }
                },
              }, '삭제'))))))) : h('p', { class: 'small muted', style: 'margin-top:10px' }, '아직 올린 명세서가 없어요.')),
      h('div', { class: 'panel' },
        h('h2', null, '발주 내역'),
        months.length ? h('div', { class: 'filters' }, months.map((m) => h('button', {
          class: `chip${m.month === month ? ' on' : ''}`, onclick: () => openStore(s.id, m.month),
        }, `${ym(m.month)} · ${m.count}건`))) : null,
        list.length ? list.map((o) => orderCard(o, true)) : empty('이 달에는 발주가 없어요')),
    ];
  }

  // ── 출고 집계 ──
  function pick() {
    return [
      title('출고 집계', '확인 전·출고 전 주문의 품목별 합계예요', h('button', { class: 'btn noprint', onclick: () => window.print() }, '인쇄')),
      h('div', { class: 'panel' },
        D.pick.length ? h('div', { class: 'tbl' }, h('table', null,
          h('tr', null, h('th', null, '품목'), h('th', null, '규격'), h('th', { class: 'num' }, '수량'), h('th', { class: 'num' }, '주문 수')),
          D.pick.map((p) => h('tr', null, h('td', null, h('b', null, p.name)), h('td', { class: 'muted' }, p.spec), h('td', { class: 'num' }, h('b', null, `${p.qty}${p.unit}`)), h('td', { class: 'num muted' }, `${p.stores}건`)))))
          : empty('출고할 주문이 없어요')),
    ];
  }

  // ── 품목 승인 ──
  function requests() {
    const L = D.labels;
    return [
      title('품목 승인', '기본 품목 외 다른 분류를 발주하려는 신청이에요'),
      h('div', { class: 'panel' },
        D.requests.length ? h('div', { class: 'tbl' }, h('table', null,
          h('tr', null, h('th', null, '매장'), h('th', null, '신청 품목'), h('th', null, '신청 시각'), h('th', null, '')),
          D.requests.map((r) => h('tr', null,
            h('td', null, h('b', null, r.store_name), h('div', { class: 'small muted' }, L.biz[r.biz])), h('td', null, L.categories[r.category]), h('td', { class: 'muted' }, time(r.requested_at)),
            h('td', null, h('div', { class: 'acts' },
              h('button', { class: 'btn primary small', onclick: () => act('/api/admin/access', { store_id: r.store_id, category: r.category, decision: 'approve' }, '승인했어요') }, '승인'),
              h('button', { class: 'btn small', onclick: () => act('/api/admin/access', { store_id: r.store_id, category: r.category, decision: 'reject' }, '반려했어요') }, '반려')))))))
          : empty('기다리는 신청이 없어요')),
    ];
  }

  // ── 매장 ──
  function stores() {
    if (storeView) return storeDetail();
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
      try { const r = await call('/api/admin/code', { id: s.id }); flash = { name: s.name, code: r.code }; render(); window.scrollTo(0, 0); } catch (e) { toast(e.message); }
    };
    const copyLink = async (s, reset) => {
      if (reset && !confirm(`${s.name} 발주서 링크를 바꿀까요?\n지금까지 보낸 링크와 점주 홈 화면 아이콘은 더 이상 열리지 않습니다.`)) return;
      try {
        const r = await call(reset ? '/api/admin/link-reset' : '/api/admin/link', { id: s.id });
        flash = { name: s.name, link: r.link, store: s };
        render();
        window.scrollTo(0, 0);
        await navigator.clipboard.writeText(r.link).then(() => toast(reset ? '새 링크를 만들고 복사했어요' : '발주서 링크를 복사했어요'), () => {});
      } catch (e) { toast(e.message); }
    };
    const copy = (text, msg) => navigator.clipboard.writeText(text).then(() => toast(msg), () => toast('복사하지 못했어요. 주소를 직접 선택해 복사해 주세요'));
    return [
      title('매장', `${D.stores.length}곳 · 매장 이름을 누르면 발주 내역과 명세서를 볼 수 있어요`),
      flash ? h('div', { class: 'panel hl' },
        h('h2', null, `${flash.name} — 점주에게 전달하세요`),
        flash.code ? [h('div', { class: 'small muted' }, '카톡 연결 코드 · 한 번만 사용'), h('div', { class: 'codebox' }, flash.code),
          h('p', { class: 'small muted' }, '점주가 "투스타글로벌(발주)" 채널을 추가하고 채팅창에 이 6자리를 보내면 매장과 연결돼요.')] : null,
        flash.link ? [
          h('div', { class: 'small muted' }, '발주서 링크 · 1년 동안 사용'),
          h('div', { class: 'url' }, flash.link),
          h('p', { class: 'small muted' }, '점주에게 카톡이나 문자로 보내 주세요. 휴대폰 크롬·사파리에서 [홈 화면에 추가] 하면 아이콘으로 바로 열려요.'),
        ] : null,
        h('div', { class: 'acts', style: 'display:flex;gap:6px;flex-wrap:wrap' },
          flash.link ? h('button', { class: 'btn primary', onclick: () => copy(flash.link, '복사했어요') }, '링크 복사') : null,
          flash.store ? h('button', { class: 'btn bad', onclick: () => copyLink(flash.store, true) }, '링크 바꾸기 (예전 링크 막기)') : null,
          h('button', { class: 'btn', onclick: () => { flash = null; render(); } }, '닫기'))) : null,
      h('div', { class: 'panel' },
        D.stores.length ? h('div', { class: 'tbl' }, h('table', null,
          h('tr', null, h('th', null, '매장'), h('th', null, '카톡'), h('th', null, '추가 승인 품목'), h('th', null, '')),
          D.stores.map((s) => h('tr', null,
            h('td', null, h('a', { href: '#', onclick: (e) => { e.preventDefault(); openStore(s.id); } }, h('b', null, s.name)),
              h('div', { class: 'small muted' }, [L.biz[s.biz], s.owner, s.phone].filter(Boolean).join(' · '))),
            h('td', null, s.kakao
              ? [h('span', { class: 'stat' }, h('span', { class: 'dot on' }), `연결됨${s.kakao > 1 ? ` ${s.kakao}명` : ''}`), ' ',
                h('button', {
                  class: 'btn small bad',
                  onclick: async () => {
                    if (!confirm(`${s.name}에 연결된 카톡 ${s.kakao}명의 연결을 모두 끊을까요?\n다시 연결하려면 새 연결 코드를 받아 입력해야 합니다.`)) return;
                    try { const r = await call('/api/admin/unlink', { id: s.id }); D = r.data; toast(`카톡 ${r.unlinked}명 연결을 끊었어요`); render(); } catch (e) { toast(e.message); }
                  },
                }, '해제')]
              : h('span', { class: 'stat muted' }, h('span', { class: 'dot' }), s.code ? `코드 ${s.code}` : '미연결')),
            h('td', null, (s.extra || '').split(',').filter(Boolean).map((c) => h('button', {
              class: 'btn small', title: '누르면 승인 취소',
              onclick: () => confirm(`${s.name}의 ${L.categories[c]} 승인을 취소할까요?`) && act('/api/admin/access', { store_id: s.id, category: c, decision: 'revoke' }, '승인을 취소했어요'),
            }, `${L.categories[c]} ✕`)), (s.extra || '') ? null : h('span', { class: 'muted' }, '-')),
            h('td', null, h('div', { class: 'acts' },
              h('button', { class: 'btn primary small', onclick: () => openStore(s.id) }, '발주 내역'),
              h('button', { class: 'btn small', onclick: () => showCode(s) }, '연결 코드'),
              h('button', { class: 'btn small', onclick: () => copyLink(s) }, '발주서 링크'),
              h('button', { class: 'btn small bad', onclick: () => confirm(`${s.name} 매장을 숨길까요?\n(주문 기록은 남고, 목록과 카톡 연결에서 빠집니다)`) && act('/api/admin/store-hide', { id: s.id }, '매장을 숨겼어요') }, '숨기기')))))))
          : empty('아직 매장이 없어요')),
      h('div', { class: 'panel' }, h('h2', null, '매장 추가'),
        h('div', { class: 'form' },
          h('label', null, '매장 이름', name), h('label', null, '업종', biz), h('label', null, '점주', owner), h('label', null, '연락처', phone),
          h('button', { class: 'btn primary', onclick: create }, '추가하고 연결 코드 받기'))),
      D.skillUrl ? h('div', { class: 'panel' },
        h('h2', null, '카카오 오픈빌더 스킬 URL'),
        h('p', { class: 'small muted' }, '오픈빌더 → 스킬 → 발주서버 의 URL 칸에 이 주소를 넣고 저장·배포하세요.'),
        h('div', { class: 'url' }, D.skillUrl),
        h('button', { class: 'btn', onclick: () => copy(D.skillUrl, '스킬 URL 을 복사했어요') }, '복사')) : null,
    ];
  }

  // ── 품목 ──
  let editing = null;
  // 품목 삭제 (item = null 이면 판매 중지한 품목 전부)
  async function removeItems(item) {
    const n = D.items.filter((i) => !i.active).length;
    const msg = item ? `'${item.name}' 품목을 삭제할까요?\n지난 주문 내역은 그대로 남습니다.` : `판매 중지한 품목 ${n}개를 모두 삭제할까요?\n지난 주문 내역은 그대로 남습니다.`;
    if (!confirm(msg)) return;
    try {
      const r = await call(item ? '/api/admin/item-delete' : '/api/admin/items-delete-inactive', item ? { id: item.id } : {});
      D = r.data;
      if (editing && item && editing.id === item.id) editing = null;
      toast(`품목 ${r.deleted}개를 삭제했어요`);
      render();
    } catch (e) { toast(e.message); }
  }
  // 사진: 브라우저에서 600×600 JPEG로 줄여서 올림 (휴대폰 원본 사진도 OK)
  function shrink(file) {
    return new Promise((resolve, reject) => {
      // blob: 주소는 보안 정책(CSP)에 막히므로 data: 로 읽는다
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('사진 파일을 읽지 못했어요'));
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const S = 600;
          const cv = document.createElement('canvas');
          cv.width = S; cv.height = S;
          const g = cv.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
          const k = Math.min(S / img.width, S / img.height);
          const w = img.width * k; const hh = img.height * k;
          g.drawImage(img, (S - w) / 2, (S - hh) / 2, w, hh);
          resolve(cv.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('이 사진 형식은 열 수 없어요 (JPG·PNG 권장)'));
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function photoCell(i) {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try { await act('/api/admin/item-image', { id: i.id, data: await shrink(f) }, `${i.name} 사진을 올렸어요`); } catch (e) { toast(e.message); }
    });
    return h('div', { class: 'photo' },
      i.image ? h('img', { class: 'thumb', src: `/img/${i.image}`, alt: '' }) : h('span', { class: 'thumb empty' }, '사진 없음'),
      h('div', null,
        h('button', { class: 'btn small', onclick: () => input.click() }, i.image ? '바꾸기' : '사진 올리기'),
        i.image ? h('button', { class: 'btn small', onclick: () => confirm(`${i.name} 사진을 지울까요?`) && act('/api/admin/item-image', { id: i.id, remove: true }, '사진을 지웠어요') }, '지우기') : null),
      input);
  }
  let bulkText = '';
  let pasteOpen = false;
  let sheetPreview = null; // 올린 엑셀 파일 미리보기 { name, rows, count, sample }
  const loadScript = (src) => new Promise((ok, bad) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const el = document.createElement('script');
    el.src = src; el.onload = ok; el.onerror = () => bad(new Error('엑셀 읽기 도구를 불러오지 못했어요'));
    document.head.append(el);
  });
  let itemCat = null;
  function items() {
    const L = D.labels;
    const e = editing || { category: itemCat || 'snack', grp: '', name: '', spec: '', unit: '개', price: '', sort: 0 };
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
      if (!(await act('/api/admin/items', body, was ? '수정했어요' : '추가했어요'))) editing = was;
    };
    const cats = Object.keys(L.categories);
    if (!itemCat || !cats.includes(itemCat)) itemCat = cats[0];
    const list = D.items.filter((i) => i.category === itemCat);
    // ── 엑셀 파일로 한꺼번에 넣기 ──
    const bulkErr = h('div', { class: 'errs' });
    const sendBulk = async (text, done) => {
      bulkErr.textContent = '';
      try {
        const r = await call('/api/admin/items-bulk', { text });
        if (r.errors.length) {
          bulkErr.textContent = `저장하지 않았어요. 아래 줄을 고쳐서 다시 올려 주세요.\n${r.errors.slice(0, 20).join('\n')}${r.errors.length > 20 ? `\n… 외 ${r.errors.length - 20}개` : ''}`;
          return;
        }
        D = r.data;
        if (done) done();
        toast(`새 품목 ${r.added}개 추가 · ${r.updated}개 수정했어요`);
        render();
      } catch (e) { toast(e.message); }
    };
    const pickFile = () => {
      const input = h('input', { type: 'file', accept: '.xlsx,.csv', class: 'hidden' });
      input.addEventListener('change', async () => {
        const f = input.files[0];
        input.remove();
        if (!f) return;
        try {
          await loadScript('/assets/xlsx.js');
          const rows = await window.readSheet(f);
          const isHead = (r) => r.length && !/^(카페|스낵|음료|사우나|식당|cafe|snack|beverage)/i.test((r[0] || '').replace(/\s/g, '')) && !/^\d/.test(r[5] || '');
          const body = rows.filter((r, i) => r.some(Boolean) && !(i === 0 && isHead(r)));
          if (!body.length) throw new Error('파일에 품목이 없어요. [품목] 시트의 노란 칸에 적었는지 확인해 주세요');
          sheetPreview = { name: f.name, rows, count: body.length, sample: body.slice(0, 8) };
          render();
        } catch (e) { toast(e.message); }
      });
      document.body.append(input);
      input.click();
    };
    const exportCsv = () => {
      const label = { cafe: '카페', snack: '스낵', beverage: '음료' };
      const q = (x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
      const lines = [['분류', '묶음(진열대)', '품목명', '규격', '단위', '단가(원, 부가세 별도)', '판매 중지']]
        .concat(D.items.map((i) => [label[i.category], i.grp, i.name, i.spec, i.unit, i.price, i.active ? '' : '중지']));
      const blob = new Blob([`﻿${lines.map((l) => l.map(q).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `투스타_품목목록_${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(a); a.click(); a.remove();
    };
    // 예전 방식: 복사해서 붙여넣기 (Tab 키도 칸 나누기로 입력됨)
    const bulkBox = h('textarea', { placeholder: '분류\t묶음\t품목명\t규격\t단위\t단가\n스낵\t과자\t새우깡\t\t개\t1200\n카페\t시럽\t바닐라 시럽 1L\t1L\t병\t11000' });
    bulkBox.value = bulkText;
    bulkBox.addEventListener('input', () => { bulkText = bulkBox.value; });
    bulkBox.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const { selectionStart: a, selectionEnd: z, value } = bulkBox;
      bulkBox.value = `${value.slice(0, a)}\t${value.slice(z)}`;
      bulkBox.selectionStart = bulkBox.selectionEnd = a + 1;
      bulkText = bulkBox.value;
    });
    const sp = sheetPreview;
    const excelPanel = h('div', { class: 'panel bulk' },
      h('h2', null, '엑셀로 한꺼번에 넣기'),
      h('ol', { class: 'steps' },
        h('li', null, h('b', null, '양식 받기'), h('a', { class: 'btn small', href: '/assets/item-template.xlsx', download: true }, '엑셀 양식 받기')),
        h('li', null, h('b', null, '[품목] 시트 노란 칸에 입력'), h('span', { class: 'small muted' }, '분류(카페/스낵/음료) · 묶음 · 품목명 · 규격 · 단위 · 단가')),
        h('li', null, h('b', null, '저장한 파일 올리기'), h('button', { class: 'btn small primary', onclick: pickFile }, '엑셀 파일 올리기'))),
      h('p', { class: 'small muted' }, '같은 분류에 같은 품목명이 있으면 새로 만들지 않고 가격·규격을 고쳐요. 가격만 바꿀 때는 ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); exportCsv(); } }, '지금 품목을 엑셀(CSV)로 받기'), ' → 단가 고치기 → 다시 올리기.'),
      sp ? h('div', { class: 'preview' },
        h('div', { class: 'pv-hd' }, h('b', null, `📄 ${sp.name}`), h('span', null, ` · 품목 ${sp.count}줄을 읽었어요`)),
        h('div', { class: 'tbl' }, h('table', null,
          h('tr', null, ['분류', '묶음', '품목명', '규격', '단위', '단가'].map((t) => h('th', null, t))),
          sp.sample.map((r) => h('tr', null, [0, 1, 2, 3, 4, 5].map((k) => h('td', { class: k === 5 ? 'num' : null }, r[k] || ''))))),
        sp.count > sp.sample.length ? h('p', { class: 'small muted' }, `… 외 ${sp.count - sp.sample.length}줄`) : null),
        h('div', { class: 'acts' },
          h('button', { class: 'btn primary', onclick: () => sendBulk(sp.rows.map((r) => r.slice(0, 6).join('\t')).join('\n'), () => { sheetPreview = null; }) }, `${sp.count}개 품목 저장`),
          h('button', { class: 'btn', onclick: () => { sheetPreview = null; render(); } }, '취소'))) : null,
      bulkErr,
      h('details', { class: 'paste', open: pasteOpen, ontoggle: (e) => { pasteOpen = e.target.open; } }, h('summary', null, '또는 엑셀에서 복사해서 붙여넣기'),
        bulkBox,
        h('button', { class: 'btn', onclick: () => sendBulk(bulkBox.value, () => { bulkText = ''; }) }, '붙여넣은 품목 저장')));
    const inactive = D.items.filter((i) => !i.active).length;
    return [
      title('품목', `전체 ${D.items.length}개 · 판매 중 ${D.items.length - inactive}개`),
      excelPanel,
      h('div', { class: `panel${editing ? ' hl' : ''}` }, h('h2', null, editing ? `품목 수정 — ${editing.name}` : '품목 하나 추가'),
        h('div', { class: 'form' },
          h('label', null, '분류', F.category), h('label', null, '진열대·묶음', F.grp), h('label', null, '품목 이름', F.name),
          h('label', null, '규격', F.spec), h('label', null, '단위', F.unit), h('label', null, '단가(원)', F.price), h('label', null, '순서', F.sort),
          h('button', { class: 'btn primary', onclick: saveItem }, editing ? '저장' : '추가'),
          editing ? h('button', { class: 'btn', onclick: () => { editing = null; render(); } }, '취소') : null)),
      h('div', { class: 'panel' },
        h('div', { class: 'seg' }, cats.map((c) => h('button', { class: c === itemCat ? 'on' : null, onclick: () => { itemCat = c; render(); } },
          `${L.categories[c]} ${D.items.filter((i) => i.category === c).length}`))),
        list.length ? h('div', { class: 'tbl' }, h('table', null,
          h('tr', null, h('th', null, '사진'), h('th', null, '품목'), h('th', { class: 'num' }, '단가'), h('th', null, '')),
          list.map((i) => h('tr', { style: i.active ? null : 'opacity:.45' },
            h('td', null, photoCell(i)),
            h('td', null, h('b', null, i.name), h('div', { class: 'small muted' }, [i.grp, i.spec, i.active ? null : '판매 중지'].filter(Boolean).join(' · '))),
            h('td', { class: 'num' }, won(i.price)),
            h('td', null, h('div', { class: 'acts' },
              h('button', { class: 'btn small', onclick: () => { editing = i; render(); window.scrollTo(0, 0); } }, '수정'),
              h('button', { class: 'btn small', onclick: () => act('/api/admin/item-active', { id: i.id, active: !i.active }) }, i.active ? '판매 중지' : '다시 판매'),
              h('button', { class: 'btn small bad', onclick: () => removeItems(i) }, '삭제')))))))
          : empty('이 분류에는 품목이 없어요')),
      inactive ? h('div', { class: 'panel' },
        h('h2', null, `판매 중지한 품목 ${inactive}개`),
        h('p', { class: 'small muted' }, '샘플 품목 등을 한꺼번에 정리할 때: 먼저 [판매 중지] 한 뒤 이 버튼을 누르세요. 지난 주문 내역은 그대로 남아요.'),
        h('button', { class: 'btn bad', onclick: () => removeItems(null) }, '판매 중지한 품목 모두 삭제')) : null,
    ];
  }

  // ── 설정: 회사 정보(확인서·명세서) · 배송 기간 · 부가세 · 카톡 자동 알림 ──
  function settings() {
    const S = D.settings;
    const inp = (k, ph) => h('input', { value: S[k] ?? '', placeholder: ph || '' });
    const F = {
      company: inp('company'), bizNo: inp('bizNo', '000-00-00000'), ceo: inp('ceo'), tel: inp('tel', '02-000-0000'),
      address: inp('address'), bizType: inp('bizType', '도소매'), bizItem: inp('bizItem', '식품'), account: inp('account', '은행 계좌번호 예금주'),
      cutoffHour: h('input', { value: S.cutoffHour, inputmode: 'numeric' }),
      deliveryMin: h('input', { value: S.deliveryMin, inputmode: 'numeric' }), deliveryMax: h('input', { value: S.deliveryMax, inputmode: 'numeric' }),
      kakaoBotId: inp('kakaoBotId', '예: 64f0…'), kakaoEvent: inp('kakaoEvent', 'order_notice'),
      kakaoRestKey: h('input', { type: 'password', placeholder: S.kakaoKeySet ? '저장됨 (바꿀 때만 입력)' : '카카오 디벨로퍼스 REST API 키', autocomplete: 'off' }),
    };
    const week = h('input', { type: 'checkbox', checked: S.skipWeekend });
    const save = async (keys, extra = {}) => {
      const body = { ...Object.fromEntries(keys.map((k) => [k, k === 'skipWeekend' ? week.checked : F[k].value])), ...extra };
      await act('/api/admin/settings', body, '저장했어요');
    };
    const on = S.kakaoBotId && S.kakaoKeySet;
    return [
      title('설정', '확인서·명세서에 들어갈 회사 정보와 알림 방식을 정해요'),
      h('div', { class: 'panel' }, h('h2', null, '회사 정보'),
        h('p', { class: 'small muted' }, '발주 확인서 · 거래명세서의 공급자 칸에 들어갑니다.'),
        h('div', { class: 'form' },
          h('label', null, '상호', F.company), h('label', null, '사업자등록번호', F.bizNo), h('label', null, '대표', F.ceo), h('label', null, '연락처', F.tel),
          h('label', null, '주소', F.address), h('label', null, '업태', F.bizType), h('label', null, '종목', F.bizItem), h('label', null, '입금 계좌', F.account),
          h('button', { class: 'btn primary', onclick: () => save(['company', 'bizNo', 'ceo', 'tel', 'address', 'bizType', 'bizItem', 'account']) }, '저장'))),
      h('div', { class: 'panel' }, h('h2', null, '주문 마감 · 배송'),
        h('p', { class: 'small muted' }, `발주서 맨 위에 "마감까지 ○시간 ○분"과 도착 예정일을 보여 줘요. 마감 시각이 지나면 다음 영업일 접수로 계산해요 (0 = 마감 없음). 단가는 모두 부가세 별도로 표시돼요.`),
        h('div', { class: 'form' },
          h('label', null, '주문 마감 (시, 0~23)', F.cutoffHour),
          h('label', null, '배송 최소 (일)', F.deliveryMin), h('label', null, '배송 최대 (일)', F.deliveryMax),
          h('label', { class: 'check' }, week, '주말 빼고 계산'),
          h('button', { class: 'btn primary', onclick: () => save(['cutoffHour', 'deliveryMin', 'deliveryMax', 'skipWeekend']) }, '저장'))),
      h('div', { class: 'panel' }, h('h2', null, '휴대폰 알림 (무료)', h('span', { class: 'stat' }, h('span', { class: 'dot on' }), '사용 중')),
        h('p', { class: 'small muted' }, '주문을 확인·출고·취소하면, 발주서에서 [알림 켜기]를 누른 점주 휴대폰에 바로 알림이 떠요. 비용은 없어요.'),
        h('ol', { class: 'small guide' },
          h('li', null, '안드로이드: 카톡 발주서 → [크롬으로 열기] → [알림 켜기] → 허용'),
          h('li', null, '아이폰: 카톡 발주서 → [Safari로 열기] → 공유(□↑) → [홈 화면에 추가] → 홈 화면 아이콘으로 열고 [알림 켜기] → 허용 (iOS 16.4 이상)'),
          h('li', null, '켜진 휴대폰 수는 매장 상세에서 보이고, [알림 테스트]로 확인할 수 있어요'),
          h('li', null, '카톡 알림도 그대로 쌓여서, 점주가 채팅방에서 버튼을 누르면 맨 위에 보여요'))),
      h('div', { class: 'panel' }, h('h2', null, '카톡 자동 알림 (유료 · 선택)', h('span', { class: 'stat' }, h('span', { class: `dot${on ? ' on' : ''}` }), on ? '켜짐' : '설정 전')),
        h('p', { class: 'small muted' }, on ? '주문을 확인·출고·취소하면 점주 카톡으로 바로 알림이 가요.'
          : '지금은 점주가 채팅방에서 버튼을 누를 때 알림이 맨 위에 보여요. 아래를 설정하면 바로 보내져요.'),
        h('ol', { class: 'small guide' },
          h('li', null, '카카오 디벨로퍼스(developers.kakao.com)에서 앱을 만들고 [앱 키 → REST API 키]를 복사'),
          h('li', null, '오픈빌더 → 이 챗봇 → 설정 → Event API 에서 그 앱을 연결 (안내에 따라 사용 신청)'),
          h('li', null, '오픈빌더에 블록 하나를 새로 만들고, 이벤트 이름을 아래 [이벤트 이름]과 똑같이 적은 뒤 봇 응답을 스킬 데이터(발주서버)로 설정 → 배포'),
          h('li', null, '오픈빌더 주소창 bots/ 뒤의 값(봇 ID)과 REST API 키를 아래에 넣고 저장 → 매장 상세에서 [알림 테스트]'),
          h('li', null, '카카오 요금: 보낸 알림 1건당 15원(VAT 별도), 전송에 성공한 건만 과금')),
        h('div', { class: 'form' },
          h('label', null, '봇 ID', F.kakaoBotId), h('label', null, 'REST API 키', F.kakaoRestKey), h('label', null, '이벤트 이름', F.kakaoEvent),
          h('button', { class: 'btn primary', onclick: () => save(['kakaoBotId', 'kakaoEvent', 'kakaoRestKey']) }, '저장'),
          S.kakaoKeySet ? h('button', { class: 'btn bad', onclick: () => confirm('저장된 REST API 키를 지울까요?') && save([], { clearKey: true }) }, '키 지우기') : null)),
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
