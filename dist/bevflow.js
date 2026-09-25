#!/usr/bin/env node
'use strict';
// BevFlow 운영 관제 v1.0.0 — 단일 실행 파일 (외부 패키지 없음, Node.js 22.13 이상)
//
//   node bevflow.js start         운영 서버 실행 (기본)
//   node bevflow.js seed-sample   샘플 데이터 생성  [--weeks 6] [--force] [--db 경로]
//   node bevflow.js backup        DB 온라인 백업  [--db 경로] [--out 폴더]
//   node bevflow.js create-admin  관리자 추가·비밀번호 재설정  <이메일> [이름]
//
// 데이터는 이 파일 옆 data/bevflow.db 에 저장됩니다 (BEVFLOW_DB로 변경).
// 환경 변수: PORT, HOST, BEVFLOW_DB, BEVFLOW_TRUST_PROXY, BEVFLOW_ADMIN_EMAIL, BEVFLOW_ADMIN_PASSWORD,
//            BEVFLOW_LINK_SECRET, BEVFLOW_INGEST_SECRET, BEVFLOW_WEBHOOK_SECRET,
//            BEVFLOW_KAKAO_SKILL_SECRET, BEVFLOW_KAKAO_CLIENT_SECRET
//
// 이 파일은 scripts/bundle.js 가 소스(server/ · scripts/ · public/)로부터 만든 결과물입니다.
// 고칠 때는 소스를 고친 뒤 `npm run bundle`로 다시 만드세요.

const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number);
if (NODE_MAJOR < 22 || (NODE_MAJOR === 22 && NODE_MINOR < 13)) {
  console.error('BevFlow는 Node.js 22.13 이상이 필요합니다 (현재 ' + process.version + ')');
  process.exit(1);
}

// node:sqlite 실험 기능 경고만 숨기고 나머지 경고는 그대로 보여 줍니다
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w.name + ': ' + w.message); });

const __path = require('node:path');
const __BASE = __dirname;
globalThis.__BEVFLOW_CLI__ = 'node ' + __path.basename(__filename);

globalThis.__BEVFLOW_ASSETS__ = {
"admin-m.html": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"robots\" content=\"noindex\">\n<meta name=\"theme-color\" content=\"#3E5C76\">\n<title>BevFlow 오늘 발주</title>\n<link rel=\"stylesheet\" href=\"/assets/app.css\">\n</head>\n<body class=\"m shop\">\n<main class=\"s-wrap\" id=\"app\" aria-live=\"polite\">\n  <div class=\"m-card\"><div class=\"skel-line\" style=\"width:60%\"></div><div class=\"skel-line\" style=\"width:90%\"></div></div>\n</main>\n<div id=\"sheet\"></div>\n<script src=\"/assets/admin-m.js\"></script>\n</body>\n</html>\n",
"assets/admin-m.js": "'use strict';\n// 관리자 모바일 내역 (/a) — 카톡 알림 버튼으로 여는 화면. 오늘 요약 · 출고 집계 · 발주 내역\n// 주소 끝 #sum · #pick · #list · #order-123 으로 바로 해당 화면을 연다.\n(() => {\n  const app = document.getElementById('app');\n  const sheetRoot = document.getElementById('sheet');\n  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';\n  const KST = 9 * 3600e3;\n  const hm = (ts) => { const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };\n  const DOW = ['일', '월', '화', '수', '목', '금', '토'];\n  const dayLabel = (s) => { const [y, m, d] = s.split('-').map(Number); return `${m}/${d} (${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; };\n  const shift = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };\n  const BIZ = { cafe: '카페', sauna: '사우나', restaurant: '식당' };\n\n  let V = null, tab = 'sum', rg = 'ALL', biz = 'ALL', sel = null, date = null;\n\n  function fromHash() {\n    const h = location.hash.slice(1);\n    const m = /^order-(\\d+)$/.exec(h);\n    if (m) { tab = 'list'; sel = Number(m[1]); } else if (['sum', 'pick', 'list'].includes(h)) { tab = h; sel = null; }\n  }\n  async function load() {\n    const r = await fetch('/api/admin/today' + (date ? '?date=' + date : ''), { credentials: 'same-origin' });\n    if (r.status === 401) { location.href = '/login?next=%2Fa'; return; }\n    const j = await r.json().catch(() => ({}));\n    if (!r.ok) throw new Error(j.error || '불러오지 못했어요');\n    V = j; date = j.date; render();\n  }\n\n  function render() {\n    const s = V.summary;\n    const head = `<header class=\"s-head\"><span class=\"pf\">B</span><div class=\"s-who\"><b>발주 · ${dayLabel(V.date)}</b><small>BevFlow 운영 · ${hm(V.now)} 기준</small></div>\n      <div style=\"display:flex;gap:4px\"><button class=\"s-hbtn\" data-day=\"-1\" aria-label=\"전날\">‹</button><button class=\"s-hbtn\" data-day=\"1\" aria-label=\"다음 날\">›</button></div></header>\n      <nav class=\"s-tabs\" aria-label=\"보기\">${[['sum', '📋', '오늘 요약'], ['pick', '🚚', '출고 집계'], ['list', '🧾', '발주 내역']].map(([k, i, l]) => `<button class=\"s-tab ${tab === k ? 'on' : ''}\" data-tab=\"${k}\"><span class=\"s-ti\">${i}</span><span>${l}</span></button>`).join('')}</nav>`;\n    let body = '';\n    if (tab === 'sum') {\n      body = `<div class=\"a-tiles\">\n          <button class=\"a-tile\" data-tab=\"list\"><small>확정 발주</small><b>${s.orders}건</b><span>${won(s.amount)}</span></button>\n          <button class=\"a-tile\" data-tab=\"pick\"><small>오늘 출고</small><b>${s.outQty}개</b><span>${s.outStores}곳 · ${s.outKinds}품목</span></button>\n          <div class=\"a-tile ${s.waiting ? 'warn' : ''}\"><small>미확정 발주서</small><b>${s.waiting}곳</b><span>마감 전에 확인</span></div>\n          <div class=\"a-tile ${s.accessPending ? 'warn' : ''}\"><small>품목 이용 신청</small><b>${s.accessPending}건</b><span>콘솔에서 승인</span></div></div>\n        ${V.waiting.length ? `<section class=\"m-card\"><h2>⏰ 미확정 발주서</h2>${V.waiting.map((w) => `<div class=\"m-line\"><div class=\"nm\">${esc(w.store)}<small>${w.lines}품목 발주서 · ${w.seenAt ? hm(w.seenAt) + ' 열어 봄' : '아직 안 열어 봄'}</small></div><b class=\"a-num\">${esc(w.phone || '')}</b></div>`).join('')}</section>` : ''}\n        <section class=\"m-card\"><h2>접수 경로</h2>${Object.keys(s.bySource).length ? Object.entries(s.bySource).map(([k, n]) => `<div class=\"m-line\"><div class=\"nm\">${esc(k)}<div class=\"a-bar\"><i style=\"width:${n / Math.max(1, s.orders) * 100}%\"></i></div></div><b>${n}건</b></div>`).join('') : '<p class=\"m-note\" style=\"margin:0\">아직 확정된 발주가 없어요</p>'}</section>\n        ${s.delivered || s.failed.length ? `<section class=\"m-card\"><h2>📦 배송</h2><div class=\"m-line\"><div class=\"nm\">완료</div><b>${s.delivered}곳</b></div>${s.failed.map((f) => `<div class=\"m-line\"><div class=\"nm\">${esc(f.store)}<small>${esc(f.reason || '')} → 다음 배송일 재배차</small></div><b style=\"color:var(--danger)\">실패</b></div>`).join('')}</section>` : ''}`;\n    } else if (tab === 'pick') {\n      const regions = [['ALL', '전체'], ...V.regions.map((r) => [r.id, r.name])];\n      const rows = V.pick.map((p) => ({ ...p, q: rg === 'ALL' ? p.qty : (p.byRegion[rg] || 0) })).filter((p) => p.q > 0);\n      body = `<div class=\"s-quick\">${regions.map(([id, n]) => `<button class=\"s-chip ${rg === id ? 'on' : ''}\" data-rg=\"${esc(id)}\">${esc(n)}</button>`).join('')}</div>\n        <section class=\"m-card\"><h2>품목별 출고 수량 <small class=\"muted\" style=\"font-weight:400;font-size:12px\">${rows.reduce((a, p) => a + p.q, 0)}개 · ${rows.length}품목</small></h2>\n        ${rows.length ? rows.map((p) => `<div class=\"m-line\"><div class=\"nm\">${esc(p.name)}<small>${esc(p.grp || '')}</small></div><b class=\"a-num\">${p.q}${esc(p.u)}</b></div>`).join('') : '<p class=\"m-note\" style=\"margin:0\">이 날 출고할 발주가 없어요</p>'}</section>\n        <p class=\"m-note\">배송일이 이 날인 확정 발주를 모두 더한 수량이에요. 마감(발주 확정) 전에는 늘어날 수 있어요.</p>`;\n    } else {\n      const bizes = [['ALL', '전체'], ['sauna', '사우나'], ['cafe', '카페'], ['restaurant', '식당']];\n      const list = V.orders.filter((o) => biz === 'ALL' || o.biz === biz);\n      body = `<div class=\"s-quick\">${bizes.map(([id, n]) => `<button class=\"s-chip ${biz === id ? 'on' : ''}\" data-biz=\"${id}\">${n}</button>`).join('')}</div>\n        <section class=\"m-card\" style=\"gap:0\">${list.length ? list.map((o) => `<button class=\"a-row\" data-order=\"${o.id}\"><div class=\"nm\"><b>${esc(o.store)}</b><small>${hm(o.paidAt)} · ${esc(o.sourceText)} · ${o.n}품목 · ${esc(o.region)}</small></div><div class=\"a-amt\"><b>${won(o.amount)}</b><small>${o.status === 'delivered' ? '배송 완료' : o.status === 'dispatched' ? '배송 중' : '출고 대기'}</small></div></button>`).join('') : '<p class=\"m-note\" style=\"margin:0\">확정된 발주가 없어요</p>'}</section>\n        <p class=\"m-note\">기간·매장별 검색과 엑셀 내려받기는 PC 운영 콘솔에서 할 수 있어요.</p>`;\n    }\n    app.innerHTML = head + body;\n    const o = sel && V.orders.find((x) => x.id === sel);\n    sheetRoot.innerHTML = o ? `<div class=\"s-sheet-bg\" data-close=\"1\"><div class=\"s-sheet\" role=\"dialog\" aria-modal=\"true\"><div class=\"s-sh\"><h2>${esc(o.store)}</h2><button class=\"xbtn\" data-close=\"1\" aria-label=\"닫기\">✕</button></div>\n      <div class=\"s-sb\"><p class=\"m-note\" style=\"margin:0\">${esc(o.code)} · ${hm(o.paidAt)} 확정 · ${esc(o.sourceText)} · ${esc(BIZ[o.biz] || '')} · ${esc(o.region)}</p>\n      ${o.lines.map((l) => `<div class=\"m-line\"><div class=\"nm\">${esc(l.name)}<small>${l.qty}${esc(l.u)}</small></div><b class=\"a-num\">${won(l.amount)}</b></div>`).join('')}\n      <div class=\"m-total\"><span>합계 · ${o.n}품목</span><span>${won(o.amount)}</span></div>\n      <div class=\"s-arrive\">🚚 ${esc(o.deliverDate || '')} 배송</div></div></div></div>` : '';\n    document.body.classList.toggle('lock', !!o);\n  }\n\n  document.addEventListener('click', (ev) => {\n    const el = ev.target.closest('button, [data-close]');\n    if (!el || !V) return;\n    const d = el.dataset;\n    if (d.close && (ev.target === el || el.classList.contains('xbtn'))) { sel = null; history.replaceState(null, '', '#list'); render(); return; }\n    if (d.tab) { tab = d.tab; sel = null; history.replaceState(null, '', '#' + tab); render(); window.scrollTo(0, 0); return; }\n    if (d.rg) { rg = d.rg; render(); return; }\n    if (d.biz) { biz = d.biz; render(); return; }\n    if (d.order) { sel = Number(d.order); history.replaceState(null, '', '#order-' + sel); render(); return; }\n    if (d.day) { date = shift(date, Number(d.day)); sel = null; load().catch((e) => alertLine(e.message)); }\n  });\n  window.addEventListener('hashchange', () => { fromHash(); if (V) render(); });\n  function alertLine(m) { app.innerHTML = `<div class=\"m-card m-done\"><div class=\"m-lead\">${esc(m)}</div></div>`; }\n  fromHash();\n  load().catch((e) => alertLine(e.message));\n  setInterval(() => { if (document.visibilityState === 'visible' && !sel) load().catch(() => {}); }, 60e3);\n})();\n",
"assets/app.css": "[hidden] { display: none !important; }\n/* ==========================================================================\n   디자인 토큰 — 피치덱과 동일한 시각 언어 (라이트 단일 테마, 그라데이션 없음)\n   ========================================================================== */\n:root {\n  --bg: #F5F5F5;\n  --paper: #FFFFFF;\n  --ink: #333333;\n  --gray: #8B8B88;\n  --line: #E0DFDC;\n  --main: #3E5C76;\n  --sub: #9C6B4F;\n  --danger: #C0392B;\n  /* 상태 색: 정상=main, 주의=sub, 위험=danger. 면은 같은 색의 저채도 투명도만 사용 */\n  --main-t: rgba(62, 92, 118, .09);\n  --main-t2: rgba(62, 92, 118, .16);\n  --sub-t: rgba(156, 107, 79, .11);\n  --danger-t: rgba(192, 57, 43, .08);\n  --ink-t: rgba(51, 51, 51, .045);\n  --hover: rgba(62, 92, 118, .05);\n  --serif: 'Noto Serif KR', 'Nanum Myeongjo', Georgia, serif;\n  --sans: -apple-system, \"Segoe UI\", \"Malgun Gothic\", \"Apple SD Gothic Neo\", sans-serif;\n  color-scheme: light;\n}\n* { box-sizing: border-box; }\nhtml, body { height: 100%; overflow-x: hidden; }\n.drawer:not(.open) { visibility: hidden; }\nbody {\n  margin: 0; background: var(--bg); color: var(--ink);\n  font: 13px/1.5 var(--sans); font-variant-numeric: tabular-nums;\n  -webkit-font-smoothing: antialiased; overflow: hidden;\n}\nbutton, input, select { font: inherit; color: inherit; }\nbutton { cursor: pointer; }\n:focus-visible { outline: 2px solid var(--main); outline-offset: 2px; }\nh1, h2, h3, h4 { font-family: var(--serif); font-weight: 600; margin: 0; letter-spacing: -.01em; text-wrap: balance; }\n.num { font-variant-numeric: tabular-nums; }\n.muted { color: var(--gray); }\n.ic { flex: none; display: block; }\n.ic * { vector-effect: non-scaling-stroke; }\n\n/* ==========================================================================\n   셸: 상단 헤더 + 좌측 사이드바(220px 고정) + 본문\n   ========================================================================== */\n.app { display: grid; grid-template-columns: 220px minmax(0, 1fr); grid-template-rows: 52px minmax(0, 1fr); height: 100%; }\n.top {\n  grid-column: 1 / -1; display: flex; align-items: center; gap: 18px;\n  background: var(--paper); border-bottom: 1px solid var(--line); padding-right: 20px; min-width: 0;\n}\n.brand { width: 220px; flex: none; display: flex; align-items: baseline; gap: 8px; padding-left: 20px; }\n.logo { font-family: var(--serif); font-size: 19px; font-weight: 700; letter-spacing: -.02em; color: var(--ink); }\n.logo i { font-style: normal; color: var(--main); }\n.brand-sub { font-size: 11px; color: var(--gray); letter-spacing: .06em; }\n.page-title { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex: 1; }\n.page-title h1 { font-size: 16px; white-space: nowrap; }\n.page-title span { color: var(--gray); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.top-right { display: flex; align-items: center; gap: 14px; flex: none; }\n.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 7px; padding: 2px; background: var(--paper); }\n.seg button { border: 0; background: none; padding: 3px 10px; border-radius: 5px; font-size: 12px; color: var(--gray); white-space: nowrap; }\n.seg button:hover { color: var(--ink); }\n.seg button[aria-pressed=\"true\"] { background: var(--main-t2); color: var(--main); font-weight: 600; }\n.seg-label { font-size: 11px; color: var(--gray); margin-right: -6px; }\n.clock { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gray); white-space: nowrap; }\n.clock b { color: var(--ink); font-weight: 600; font-size: 13px; }\n.live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--main); box-shadow: 0 0 0 3px var(--main-t); animation: pulse 2s infinite; }\n@keyframes pulse { 50% { box-shadow: 0 0 0 5px rgba(62, 92, 118, .04); } }\n.pos-status { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--gray); border-left: 1px solid var(--line); padding-left: 14px; white-space: nowrap; }\n.pos-status b { color: var(--ink); font-weight: 600; }\n\n.side { background: var(--paper); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; overflow: auto; }\n.reset {\n  margin: 14px 14px 6px; display: flex; align-items: center; justify-content: center; gap: 7px;\n  height: 32px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); font-size: 12px; color: var(--ink);\n}\n.reset:hover { border-color: var(--main); color: var(--main); }\n.nav { display: flex; flex-direction: column; padding: 8px 10px; gap: 2px; }\n.nav button {\n  display: flex; align-items: center; gap: 10px; border: 0; background: none; height: 36px; padding: 0 10px;\n  border-radius: 7px; color: var(--ink); font-size: 13px; text-align: left; position: relative;\n}\n.nav button:hover { background: var(--hover); }\n.nav button[aria-current=\"page\"] { background: var(--main-t); color: var(--main); font-weight: 600; }\n.nav button[aria-current=\"page\"] .ic { color: var(--main); }\n.nav .ic { color: var(--gray); }\n.nav .nb { margin-left: auto; display: flex; align-items: center; gap: 6px; }\n.nav .cnt { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--danger); color: #fff; font-size: 10.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }\n.nav .cnt.soft { background: var(--sub-t); color: var(--sub); }\n.nav kbd { font: 10px var(--sans); color: var(--gray); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; line-height: 15px; }\n.side-foot { margin-top: auto; padding: 14px 16px 16px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px; }\n.pilot-box { font-size: 11.5px; color: var(--gray); line-height: 1.6; }\n.pilot-box b { color: var(--ink); font-weight: 600; }\n.sys { display: flex; flex-direction: column; gap: 5px; }\n.sys-h { font-size: 10.5px; letter-spacing: .08em; color: var(--gray); }\n.sys-row { display: flex; align-items: center; gap: 7px; font-size: 11.5px; }\n.sys-row .d { width: 6px; height: 6px; border-radius: 50%; background: var(--main); flex: none; }\n.sys-row .d.warn { background: var(--sub); }\n.sys-row .d.bad { background: var(--danger); }\n.sys-row em { margin-left: auto; font-style: normal; color: var(--gray); font-size: 11px; }\n.operator { display: flex; align-items: center; gap: 8px; font-size: 11.5px; }\n.avatar { width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; font-size: 11px; color: var(--main); font-weight: 700; }\n\nmain { overflow: auto; padding: 16px 20px 30px; min-width: 0; position: relative; }\n.view { display: flex; flex-direction: column; gap: 14px; min-height: 100%; }\n.view.fit { height: 100%; }\n\n/* ==========================================================================\n   공통 컴포넌트\n   ========================================================================== */\n.card { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; min-width: 0; }\n.card-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px 10px; min-height: 46px; }\n.card-h h3 { font-size: 14px; }\n.card-h .sub { font-size: 11.5px; color: var(--gray); font-family: var(--sans); font-weight: 400; margin-left: 6px; }\n.card-b { padding: 0 14px 14px; }\n.hstack { display: flex; align-items: center; gap: 8px; }\n.grow { flex: 1; min-width: 0; }\n\n.badge {\n  display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 10px;\n  font-size: 11px; font-weight: 600; white-space: nowrap; border: 0; line-height: 1; font-family: var(--sans);\n}\n.badge::before { content: \"\"; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }\n.badge.nodot::before { display: none; }\n.b-ok { color: var(--main); background: var(--main-t); }\n.b-warn { color: var(--sub); background: var(--sub-t); }\n.b-bad { color: var(--danger); background: var(--danger-t); }\n.b-mute { color: var(--gray); background: var(--ink-t); }\n.b-line { color: var(--ink); background: var(--paper); box-shadow: inset 0 0 0 1px var(--line); }\nbutton.badge { cursor: pointer; }\nbutton.badge:hover { filter: brightness(.95); box-shadow: inset 0 0 0 1px currentColor; }\n.tag { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 4px; font-size: 10.5px; color: var(--gray); box-shadow: inset 0 0 0 1px var(--line); white-space: nowrap; }\n\n.btn {\n  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 28px; padding: 0 10px;\n  border: 1px solid var(--line); border-radius: 6px; background: var(--paper); font-size: 12px; white-space: nowrap; color: var(--ink);\n}\n.btn:hover { border-color: var(--main); color: var(--main); }\n.btn.primary { background: var(--main); border-color: var(--main); color: #fff; font-weight: 600; }\n.btn.primary:hover { background: #34506A; color: #fff; }\n.btn.warn { color: var(--sub); border-color: rgba(156, 107, 79, .45); }\n.btn.bad { color: var(--danger); border-color: rgba(192, 57, 43, .4); }\n.btn.sm { height: 24px; padding: 0 8px; font-size: 11.5px; }\n.btn:disabled { opacity: .55; cursor: default; border-color: var(--line); color: var(--gray); background: var(--paper); }\n.btn .spin { width: 11px; height: 11px; border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }\n@keyframes spin { to { transform: rotate(360deg); } }\n\n.chips { display: flex; gap: 4px; flex-wrap: wrap; }\n.chip { border: 1px solid var(--line); background: var(--paper); border-radius: 12px; height: 24px; padding: 0 9px; font-size: 11.5px; color: var(--gray); display: inline-flex; align-items: center; gap: 5px; }\n.chip b { color: var(--ink); font-weight: 600; }\n.chip:hover { border-color: var(--main); }\n.chip[aria-pressed=\"true\"] { border-color: var(--main); color: var(--main); background: var(--main-t); }\n.chip[aria-pressed=\"true\"] b { color: var(--main); }\n\n.tbl-wrap { overflow: auto; min-height: 0; }\n.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }\n.tbl th { position: sticky; top: 0; background: var(--paper); z-index: 1; font-size: 11px; font-weight: 500; color: var(--gray); text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }\n.tbl td { padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }\n.tbl tr:last-child td { border-bottom: 0; }\n.tbl tbody tr { transition: background .12s; }\n.tbl tbody tr:hover td { background: var(--hover); }\n.tbl tr.sel td { background: var(--main-t); }\n.tbl tr.click { cursor: pointer; }\n.tbl .r { text-align: right; }\n.tbl .c { text-align: center; }\n.tbl .strong { font-weight: 600; }\n.sub2 { display: block; font-size: 11px; color: var(--gray); line-height: 1.35; }\n.tbl td.num, .tbl th { white-space: nowrap; }\n.tbl tfoot td { border-top: 1px solid var(--line); border-bottom: 0; font-weight: 600; background: var(--ink-t); }\n\n.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--gray); font-size: 12px; padding: 26px 12px; text-align: center; }\n.empty .ic { color: var(--line); }\n\n.bar { height: 6px; background: var(--main-t); border-radius: 3px; overflow: hidden; position: relative; }\n.bar > i { position: absolute; inset: 0 auto 0 0; background: var(--main); border-radius: 3px; transition: width .6s ease; }\n.bar > i.part { background: var(--sub); opacity: .75; }\n\n/* KPI 스트립 */\n.kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }\n.kpis.k4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }\n.kpi { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 11px 14px 11px; min-width: 0; transition: box-shadow .3s, border-color .3s; }\n.kpi-l { font-size: 11.5px; color: var(--gray); display: flex; align-items: center; justify-content: space-between; gap: 6px; white-space: nowrap; }\n.kpi-v { font-size: 25px; font-weight: 600; letter-spacing: -.02em; line-height: 1.25; margin-top: 3px; white-space: nowrap; }\n.kpi-v small { font-size: 12px; font-weight: 500; color: var(--gray); margin-left: 3px; letter-spacing: 0; }\n.kpi-s { font-size: 11px; color: var(--gray); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.kpi-s .up { color: var(--main); font-weight: 600; }\n.kpi-s .warn { color: var(--sub); font-weight: 600; }\n.kpi-s .bad { color: var(--danger); font-weight: 600; }\n.kpi.flash { border-color: var(--main); box-shadow: 0 0 0 3px var(--main-t); }\n\n/* 툴팁·토스트·드로어·모달 */\n#tip {\n  position: fixed; z-index: 60; pointer-events: none; background: var(--paper); border: 1px solid var(--line); border-radius: 7px;\n  padding: 8px 10px; font-size: 11.5px; min-width: 140px; max-width: 260px; box-shadow: 0 4px 14px rgba(0, 0, 0, .07); display: none;\n}\n#tip .tt { color: var(--gray); font-size: 11px; margin-bottom: 4px; }\n#tip .tr { display: flex; align-items: center; gap: 7px; line-height: 1.7; }\n#tip .tr .k { width: 12px; height: 2px; background: var(--main); flex: none; }\n#tip .tr .k.band { height: 8px; background: var(--main-t2); }\n#tip .tr .k.dash { background: none; border-top: 2px dashed var(--sub); height: 0; }\n#tip .tr b { font-weight: 600; }\n#tip .tr span { color: var(--gray); }\n#toasts { position: fixed; right: 20px; bottom: 34px; z-index: 70; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }\n.toast {\n  background: var(--ink); color: #fff; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; display: flex; gap: 9px; align-items: center;\n  max-width: 380px; box-shadow: 0 6px 20px rgba(0, 0, 0, .15); animation: toastIn .25s ease;\n}\n.toast .ic { color: #fff; }\n@keyframes toastIn { from { transform: translateY(8px); opacity: 0; } }\n.drawer {\n  position: fixed; top: 52px; right: 0; bottom: 0; width: 430px; max-width: 100%; background: var(--paper); border-left: 1px solid var(--line);\n  z-index: 40; transform: translateX(102%); transition: transform .28s cubic-bezier(.2, .8, .2, 1); display: flex; flex-direction: column;\n  box-shadow: -8px 0 24px rgba(0, 0, 0, .04);\n}\n.drawer.open { transform: none; visibility: visible; }\n.drawer-h { display: flex; align-items: flex-start; gap: 10px; padding: 16px 18px 12px; border-bottom: 1px solid var(--line); }\n.drawer-b { overflow: auto; padding: 14px 18px 24px; display: flex; flex-direction: column; gap: 16px; }\n.drawer-f { border-top: 1px solid var(--line); padding: 12px 18px; display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }\n.xbtn { margin-left: auto; border: 0; background: none; color: var(--gray); padding: 4px; border-radius: 6px; }\n.xbtn:hover { background: var(--hover); color: var(--ink); }\n.sec-h { font-size: 11px; color: var(--gray); letter-spacing: .06em; margin-bottom: 7px; }\n.kv { display: grid; grid-template-columns: 96px 1fr; gap: 5px 10px; font-size: 12.5px; }\n.kv dt { color: var(--gray); }\n.kv dd { margin: 0; }\n.modal-bg { position: fixed; inset: 0; background: rgba(51, 51, 51, .28); z-index: 80; display: grid; place-items: center; padding: 16px; }\n.modal { background: var(--paper); border-radius: 10px; border: 1px solid var(--line); width: 760px; max-width: 100%; max-height: 86vh; display: flex; flex-direction: column; }\n.modal-h { display: flex; gap: 10px; align-items: flex-start; padding: 18px 20px 12px; border-bottom: 1px solid var(--line); }\n.modal-b { overflow: auto; padding: 12px 20px 18px; }\n\n/* 스텝퍼 (발주 진행) */\n.steps { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; position: relative; }\n.step { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 10.5px; color: var(--gray); position: relative; text-align: center; }\n.step::before { content: \"\"; position: absolute; top: 6px; left: -50%; right: 50%; height: 1.5px; background: var(--line); }\n.step:first-child::before { display: none; }\n.step .dot { width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid var(--line); background: var(--paper); position: relative; z-index: 1; }\n.step.done .dot { background: var(--main); border-color: var(--main); }\n.step.done::before { background: var(--main); }\n.step.now .dot { border-color: var(--sub); box-shadow: 0 0 0 3px var(--sub-t); }\n.step.fail .dot { border-color: var(--danger); background: var(--danger); }\n.step b { color: var(--ink); font-weight: 600; font-size: 11px; }\n.log { display: flex; flex-direction: column; }\n.log-row { display: grid; grid-template-columns: 44px 1fr; gap: 10px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 12px; }\n.log-row:last-child { border-bottom: 0; }\n.log-row time { color: var(--gray); font-size: 11.5px; }\n\n/* 로딩 */\n.boot { position: fixed; inset: 0; background: var(--bg); z-index: 100; display: grid; place-items: center; transition: opacity .3s; }\n.boot.hide { opacity: 0; pointer-events: none; }\n.boot-in { display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--gray); font-size: 12px; }\n.boot .logo { font-size: 26px; }\n.boot-bar { width: 220px; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; }\n.boot-bar i { display: block; height: 100%; width: 35%; background: var(--main); animation: load 1s ease-in-out infinite; }\n@keyframes load { from { transform: translateX(-100%); } to { transform: translateX(300%); } }\n.skel { background: var(--ink-t); border-radius: 4px; height: 10px; animation: sk 1.2s ease-in-out infinite; }\n@keyframes sk { 50% { opacity: .5; } }\n\n.demo-mark { position: fixed; right: 12px; bottom: 8px; font-size: 10.5px; color: var(--gray); z-index: 90; pointer-events: none; letter-spacing: .02em; background: rgba(245, 245, 245, .85); padding: 1px 6px; border-radius: 4px; }\n\n/* ==========================================================================\n   ① 관제 홈\n   ========================================================================== */\n.ov-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); grid-template-rows: minmax(0, 1fr); gap: 14px; flex: 1; min-height: 0; }\n.ov-left { display: flex; flex-direction: column; min-height: 0; }\n.ov-left .tbl-wrap { flex: 1; }\n.ov-right { display: flex; flex-direction: column; gap: 14px; min-height: 0; }\n.kind { display: inline-flex; }\n.act-store b { font-weight: 600; }\n.act-store .tag { margin-left: 6px; }\n.reg-row { display: grid; grid-template-columns: 84px 1fr 64px; align-items: center; gap: 12px; padding: 7px 0; }\n.reg-row .nm { font-size: 12.5px; font-weight: 600; }\n.reg-row .nm small { display: block; font-weight: 400; color: var(--gray); font-size: 11px; }\n.reg-row .v { text-align: right; font-size: 12.5px; }\n.reg-row .v b { font-size: 15px; }\n.reg-row .bar { height: 8px; border-radius: 4px; }\n.reg-row .bar > i { border-radius: 4px; }\n.ev { display: grid; grid-template-columns: 42px 66px 1fr; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 12px; }\n.ev:last-child { border-bottom: 0; }\n.ev time { color: var(--gray); font-size: 11.5px; }\n.ev .badge { justify-self: start; }\n.ev.new { animation: evIn 1.4s ease; }\n@keyframes evIn { from { background: var(--main-t2); } }\n.ev-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.ev-txt b { font-weight: 600; }\n\n/* ==========================================================================\n   ② 재고 관제\n   ========================================================================== */\n.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }\n.fl { font-size: 11px; color: var(--gray); }\n.combo { position: relative; }\n.combo-btn {\n  display: flex; align-items: center; gap: 8px; height: 34px; min-width: 280px; padding: 0 10px 0 12px; border: 1px solid var(--line);\n  border-radius: 7px; background: var(--paper); text-align: left;\n}\n.combo-btn:hover { border-color: var(--main); }\n.combo-btn b { font-weight: 600; }\n.combo-btn .ic:last-child { margin-left: auto; color: var(--gray); }\n.combo-pop {\n  position: absolute; top: 38px; left: 0; width: 340px; max-height: 470px; background: var(--paper); border: 1px solid var(--line);\n  border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .08); z-index: 30; display: flex; flex-direction: column;\n}\n.combo-pop input { border: 0; border-bottom: 1px solid var(--line); padding: 10px 12px; outline: none; font-size: 12.5px; border-radius: 8px 8px 0 0; }\n.combo-list { overflow: auto; padding: 4px 0 6px; }\n.combo-g { font-size: 10.5px; color: var(--gray); padding: 8px 12px 4px; letter-spacing: .05em; }\n.combo-o { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; background: none; padding: 6px 12px; text-align: left; font-size: 12.5px; }\n.combo-o:hover, .combo-o.cur { background: var(--hover); }\n.combo-o .code { color: var(--gray); font-size: 11px; }\n.combo-o .badge { margin-left: auto; }\n.selbox { height: 34px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); padding: 0 10px; min-width: 170px; }\n.meta-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }\n.inv-top { display: grid; grid-template-columns: minmax(0, 1fr) 272px; gap: 14px; }\n.chart-card { padding-bottom: 6px; }\n.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: var(--gray); }\n.legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }\n.lg-line { width: 16px; height: 2px; background: var(--main); }\n.lg-band { width: 16px; height: 9px; background: var(--main-t2); }\n.lg-dash { width: 16px; border-top: 1.5px dashed var(--sub); }\n.lg-ring { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--danger); }\n.lg-sq { width: 8px; height: 8px; background: var(--ink); }\n.lg-dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--ink); background: var(--paper); }\nsvg text { font-family: var(--sans); }\n.chart { width: 100%; height: auto; display: block; }\n.why { display: flex; flex-direction: column; }\n.why-v { font-size: 26px; font-weight: 600; letter-spacing: -.02em; }\n.why-v small { font-size: 13px; color: var(--gray); font-weight: 500; }\n.why dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 5px 10px; font-size: 12px; }\n.why dd { white-space: nowrap; }\n.why dt { color: var(--gray); white-space: nowrap; }\n.why dd { margin: 0; text-align: right; }\n.why .note { font-size: 11.5px; color: var(--gray); line-height: 1.55; border-top: 1px solid var(--line); padding-top: 9px; }\n.alert-line { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; padding: 9px 12px; border-radius: 7px; }\n.alert-line.bad { background: var(--danger-t); color: var(--danger); }\n.alert-line.warn { background: var(--sub-t); color: var(--sub); }\n.alert-line.ok { background: var(--main-t); color: var(--main); }\n.alert-line .ic { margin-top: 1px; }\n.mini-gauge { position: relative; height: 22px; margin-top: 10px; }\n.stock-cell { display: flex; align-items: center; gap: 10px; }\n.stock-bar { position: relative; width: 90px; height: 8px; background: var(--ink-t); border-radius: 4px; flex: none; }\n.stock-bar .band { position: absolute; top: 0; bottom: 0; background: var(--main-t2); border-radius: 4px; }\n.stock-bar .pt { position: absolute; top: -2px; width: 2px; height: 12px; background: var(--main); border-radius: 1px; }\n.stock-bar .ss { position: absolute; top: -3px; height: 14px; border-left: 1.5px dashed var(--sub); }\n\n/* ==========================================================================\n   ③ 발주 관제 (칸반)\n   ========================================================================== */\n.kanban { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: minmax(0, 1fr); gap: 12px; flex: 1; min-height: 0; }\n.col { background: var(--ink-t); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; min-height: 0; }\n.col-h { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; }\n.col-h h3 { font-size: 13.5px; }\n.col-h .n { font-size: 12px; color: var(--gray); }\n.col-h .hint { margin-left: auto; font-size: 10.5px; color: var(--gray); }\n.col-b { overflow: auto; padding: 2px 10px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 60px; }\n.ocard {\n  background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 10px 11px; cursor: pointer;\n  display: flex; flex-direction: column; gap: 6px; transition: border-color .15s, transform .28s ease, opacity .28s ease; text-align: left; width: 100%;\n}\n.ocard:hover { border-color: var(--main); }\n.ocard.sel { border-color: var(--main); box-shadow: 0 0 0 2px var(--main-t2); }\n.ocard.leave { transform: translateX(40px); opacity: 0; }\n.ocard.arrive { animation: arrive 1.6s ease; }\n@keyframes arrive { 0% { background: var(--main-t2); transform: translateX(-30px); opacity: 0; } 25% { transform: none; opacity: 1; } 100% { background: var(--paper); } }\n.ocard .r1 { display: flex; align-items: center; gap: 6px; }\n.ocard .r1 b { font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.ocard .r1 .tag { margin-left: auto; }\n.ocard .sku { font-size: 12px; color: var(--ink); }\n.ocard .r3 { display: flex; align-items: center; gap: 6px; font-size: 12px; }\n.ocard .r3 .amt { font-weight: 600; }\n.ocard .r3 .el { margin-left: auto; color: var(--gray); font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px; }\n.ocard .r3 .el.late { color: var(--danger); font-weight: 600; }\n.ocard .r4 { display: flex; gap: 5px; flex-wrap: wrap; }\n.ocard .act { display: flex; gap: 6px; margin-top: 2px; }\n.ocard .act .btn { flex: 1; }\n.cutoff { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 12px; }\n.cutoff .pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 16px; border: 1px solid var(--line); background: var(--paper); }\n.cutoff .pill b { font-weight: 600; }\n\n/* ==========================================================================\n   ④ 알림톡 모니터\n   ========================================================================== */\n.nt-grid { display: grid; grid-template-columns: minmax(0, 1fr) 372px 250px; grid-template-rows: minmax(0, 1fr); gap: 14px; flex: 1; min-height: 0; }\n.nt-list { display: flex; flex-direction: column; min-height: 0; }\n.nt-list .tbl-wrap { flex: 1; }\n.phone-wrap { display: flex; justify-content: center; align-items: flex-start; min-height: 0; }\n.phone {\n  width: 356px; height: 700px; max-height: calc(100vh - 210px); min-height: 560px; border: 9px solid var(--ink); border-radius: 42px; background: var(--paper);\n  display: flex; flex-direction: column; overflow: hidden; position: relative;\n}\n.phone::before { content: \"\"; position: absolute; top: 7px; left: 50%; transform: translateX(-50%); width: 92px; height: 22px; background: var(--ink); border-radius: 12px; z-index: 3; }\n.ph-status { display: flex; justify-content: space-between; align-items: center; padding: 10px 24px 4px; font-size: 12px; font-weight: 600; height: 38px; }\n.ph-status .sig { display: flex; gap: 5px; align-items: center; }\n.ph-head { display: flex; align-items: center; gap: 9px; padding: 8px 14px 10px; border-bottom: 1px solid var(--line); }\n.ph-head .pf { width: 32px; height: 32px; border-radius: 12px; background: var(--main); color: #fff; display: grid; place-items: center; font-family: var(--serif); font-weight: 700; font-size: 15px; }\n.ph-head b { font-size: 13px; display: block; }\n.ph-head small { font-size: 10.5px; color: var(--gray); }\n.ph-body { flex: 1; overflow: auto; background: #EEF1F4; padding: 12px 12px 16px; display: flex; flex-direction: column; gap: 10px; }\n.ph-day { align-self: center; font-size: 10.5px; color: var(--gray); background: rgba(255, 255, 255, .7); border-radius: 10px; padding: 2px 10px; }\n.msg { display: flex; gap: 6px; align-items: flex-end; max-width: 100%; }\n.msg time { font-size: 9.5px; color: var(--gray); flex: none; margin-bottom: 2px; }\n.msg.me { flex-direction: row-reverse; }\n.bub { background: var(--paper); border-radius: 4px 14px 14px 14px; padding: 9px 11px; font-size: 12.5px; line-height: 1.55; max-width: 250px; white-space: pre-line; }\n.msg.me .bub { background: var(--main); color: #fff; border-radius: 14px 4px 14px 14px; }\n.bub.sys { background: rgba(255, 255, 255, .7); color: var(--gray); font-size: 11px; border-radius: 10px; }\n.alim { background: var(--paper); border-radius: 4px 14px 14px 14px; width: 250px; overflow: hidden; font-size: 12.5px; }\n.alim-h { padding: 8px 12px; font-size: 11.5px; font-weight: 700; color: var(--main); border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; }\n.alim-h span { color: var(--gray); font-weight: 400; }\n.alim-b { padding: 10px 12px 8px; line-height: 1.6; white-space: pre-line; }\n.alim-b .hl { font-weight: 700; }\n.alim-prop { margin: 6px 12px 0; padding: 8px 10px; background: var(--main-t); border-radius: 8px; font-size: 12px; }\n.alim-prop b { font-size: 13px; }\n.alim-f { padding: 6px 12px 10px; font-size: 11px; color: var(--gray); }\n.alim-btns { display: flex; flex-direction: column; gap: 5px; padding: 0 12px 12px; }\n.alim-btns button { height: 34px; border-radius: 6px; border: 1px solid var(--line); background: var(--paper); font-size: 12.5px; font-weight: 600; }\n.alim-btns button.pri { background: var(--main); color: #fff; border-color: var(--main); }\n.alim-btns button:disabled { opacity: .5; cursor: default; }\n.alim-btns button:not(:disabled):hover { border-color: var(--main); }\n.qty-row { display: flex; gap: 5px; }\n.qty-row button { flex: 1; }\n.nt-meta { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow: auto; }\n\n/* ==========================================================================\n   ⑤ 배송 관제\n   ========================================================================== */\n.dl-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 14px; }\n.dl-bottom { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 14px; }\n.drv { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }\n.drv-h { display: flex; align-items: center; gap: 8px; }\n.drv-h b { font-size: 13.5px; font-weight: 600; }\n.drv-h .tag { margin-left: auto; }\n.drv-n { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }\n.drv-n div { font-size: 11px; color: var(--gray); }\n.drv-n b { display: block; font-size: 17px; color: var(--ink); font-weight: 600; letter-spacing: -.01em; }\n.drv-n b small { font-size: 11px; color: var(--gray); font-weight: 500; margin-left: 2px; }\n.drv-now { font-size: 11.5px; color: var(--ink); display: flex; gap: 6px; align-items: center; }\n.drv-now .muted { margin-left: auto; }\n.cap dl { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 7px 12px; font-size: 12px; }\n.cap dt { color: var(--gray); }\n.cap dd { margin: 0; text-align: right; font-weight: 600; }\n.cap .formula { font-size: 11.5px; line-height: 1.7; background: var(--ink-t); border-radius: 7px; padding: 9px 11px; margin-top: 10px; }\n\n/* ==========================================================================\n   ⑥ 파일럿 리포트\n   ========================================================================== */\n.rp-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }\n.metric { padding: 14px 16px 12px; display: flex; flex-direction: column; gap: 6px; }\n.metric-h { display: flex; align-items: center; gap: 8px; }\n.metric-h h3 { font-size: 13.5px; }\n.metric-h .badge { margin-left: auto; }\n.metric-v { font-size: 32px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }\n.metric-v small { font-size: 14px; color: var(--gray); font-weight: 500; margin-left: 2px; }\n.metric-s { font-size: 11.5px; color: var(--gray); display: flex; gap: 12px; flex-wrap: wrap; }\n.metric-s b { color: var(--ink); font-weight: 600; }\n.metric .target-bar { position: relative; height: 6px; background: var(--ink-t); border-radius: 3px; margin: 4px 0 2px; }\n.trend3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }\n.trend3 > div { padding: 0 14px 10px; border-left: 1px solid var(--line); }\n.trend3 > div:first-child { border-left: 0; }\n.trend3 h4 { font-family: var(--sans); font-size: 12px; font-weight: 600; margin: 0 0 2px; }\n.trend3 h4 span { color: var(--gray); font-weight: 400; }\n.rp-bottom { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 14px; }\n.rank { width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 10.5px; font-weight: 700; background: var(--ink-t); color: var(--gray); }\n.rank.top { background: var(--main-t); color: var(--main); }\n.rank.low { background: var(--sub-t); color: var(--sub); }\n.divrow td { background: var(--ink-t) !important; font-size: 11px; color: var(--gray); padding: 5px 10px; font-weight: 600; }\n\n/* ==========================================================================\n   반응형 — 1440×900 기준 최적화, 좁은 화면(태블릿·폰)에서는 한 열로 쌓임\n   ========================================================================== */\n@media (max-width: 1280px) {\n  .nt-grid { grid-template-columns: minmax(0, 1fr) 372px; }\n  .nt-meta { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; }\n  .nt-meta > .card { flex: 1 1 260px; }\n}\n@media (max-width: 1100px) {\n  body { overflow: auto; }\n  .app { height: auto; min-height: 100%; grid-template-columns: 1fr; grid-template-rows: auto auto 1fr; }\n  .top { flex-wrap: wrap; padding: 10px 16px; gap: 10px; }\n  .brand { width: auto; padding-left: 0; }\n  .page-title { order: 3; flex-basis: 100%; }\n  .top-right { flex: 1 1 100%; flex-wrap: wrap; gap: 8px 10px; margin-left: 0; }\n  .side { flex-direction: row; align-items: center; border-right: 0; border-bottom: 1px solid var(--line); overflow-x: auto; overflow-y: hidden; }\n  .reset { margin: 8px 8px 8px 16px; flex: none; padding: 0 12px; }\n  .nav { flex-direction: row; padding: 6px 16px 6px 0; }\n  .nav button { flex: none; }\n  .nav kbd, .side-foot { display: none; }\n  main { overflow: visible; padding: 16px; }\n  .view.fit { height: auto; }\n  .ov-grid, .kanban, .nt-grid { grid-template-rows: none; }\n  .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }\n  .ov-grid, .inv-top, .dl-grid, .dl-bottom, .rp-bottom, .nt-grid { grid-template-columns: minmax(0, 1fr); }\n  .kanban { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .col-b { max-height: 460px; }\n  .drawer { top: 0; }\n  .ov-left .tbl-wrap { max-height: 460px; }\n}\n@media (max-width: 640px) {\n  .kpis, .kpis.k4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .kanban, .rp-cards, .trend3 { grid-template-columns: minmax(0, 1fr); }\n  .trend3 > div { border-left: 0; border-top: 1px solid var(--line); padding-top: 10px; }\n  .combo-btn { min-width: 0; width: 100%; }\n  .combo, .selbox { width: 100%; }\n  .combo-pop { width: 100%; }\n  .meta-chips { margin-left: 0; }\n  .pos-status { display: none; }\n  .phone { width: 100%; max-width: 356px; }\n  .kpi-v { font-size: 21px; }\n  .tbl { min-width: 560px; }\n  .cutoff .pill { white-space: normal; }\n}\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after { animation: none !important; transition: none !important; }\n}\n\n/* ==========================================================================\n   운영 툴 추가 스타일 — 폼 · 모달 · 관리 화면 · 모바일(사장님·기사) 페이지\n   ========================================================================== */\n.sample-banner { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 7px; background: var(--sub-t); color: var(--sub); font-size: 12px; }\n.sample-banner b { color: var(--ink); }\n.sync { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--gray); white-space: nowrap; }\n.sync .d { width: 7px; height: 7px; border-radius: 50%; background: var(--main); }\n.sync.err .d { background: var(--danger); }\n.sync.err { color: var(--danger); }\n.fgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }\n.fgrid .full { grid-column: 1 / -1; }\n.fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; min-width: 0; }\n.fld > span { color: var(--gray); font-size: 11.5px; }\n.fld small { color: var(--gray); font-size: 11px; }\n.inp, .fld input, .fld select, .fld textarea {\n  height: 32px; border: 1px solid var(--line); border-radius: 6px; padding: 0 9px; background: var(--paper); font-size: 12.5px; min-width: 0; width: 100%;\n}\n.fld textarea { height: auto; min-height: 70px; padding: 7px 9px; resize: vertical; font-family: inherit; }\n.inp:focus, .fld input:focus, .fld select:focus, .fld textarea:focus { outline: 2px solid var(--main-t2); border-color: var(--main); }\n.chk { display: flex; align-items: center; gap: 7px; font-size: 12.5px; }\n.chk input { width: 15px; height: 15px; accent-color: var(--main); }\n.form-err { color: var(--danger); font-size: 12px; min-height: 16px; }\n.modal-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px 16px; border-top: 1px solid var(--line); flex-wrap: wrap; }\n.modal.sm { width: 480px; }\n.copybox { display: flex; gap: 6px; }\n.copybox input { flex: 1; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; }\n.pre { white-space: pre-wrap; font-size: 12px; line-height: 1.6; background: var(--ink-t); border-radius: 7px; padding: 10px 12px; max-height: 260px; overflow: auto; }\n.subnav { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: 8px; }\n.subnav button { border: 0; background: none; padding: 6px 12px; border-radius: 6px; font-size: 12.5px; color: var(--gray); }\n.subnav button:hover { background: var(--hover); color: var(--ink); }\n.subnav button[aria-current=\"page\"] { background: var(--main-t); color: var(--main); font-weight: 600; }\n.qty-step { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }\n.qty-step button { width: 28px; height: 28px; border: 0; background: var(--ink-t); font-size: 15px; }\n.qty-step input { width: 44px; height: 28px; border: 0; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }\n.kbd-hint { font-size: 11px; color: var(--gray); }\n.skel-line { height: 12px; border-radius: 4px; background: var(--ink-t); animation: sk 1.2s ease-in-out infinite; }\n.loading-dim { opacity: .5; transition: opacity .2s; }\n.code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; background: var(--ink-t); padding: 1px 5px; border-radius: 4px; word-break: break-all; }\na { color: var(--main); }\n\n/* 모바일 페이지 (사장님 승인 · 기사 배송) */\nbody.m { overflow: auto; background: var(--bg); }\n.m-wrap { max-width: 480px; margin: 0 auto; padding: 16px 16px 40px; display: flex; flex-direction: column; gap: 12px; }\n.m-head { display: flex; align-items: center; gap: 10px; padding: 4px 0 2px; }\n.m-head .pf { width: 36px; height: 36px; border-radius: 12px; background: var(--main); color: #fff; display: grid; place-items: center; font-family: var(--serif); font-weight: 700; font-size: 16px; flex: none; }\n.m-head b { display: block; font-size: 15px; }\n.m-head small { color: var(--gray); font-size: 12px; }\n.m-card { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }\n.m-card h2 { font-size: 16px; }\n.m-lead { font-size: 14.5px; line-height: 1.6; }\n.m-line { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }\n.m-line:last-child { border-bottom: 0; }\n.m-line .nm { flex: 1; min-width: 0; font-size: 14px; }\n.m-line .nm small { display: block; color: var(--gray); font-size: 11.5px; }\n.m-total { display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; padding-top: 4px; }\n.m-btn { height: 48px; border-radius: 10px; border: 1px solid var(--line); background: var(--paper); font-size: 15px; font-weight: 600; width: 100%; }\n.m-btn.pri { background: var(--main); border-color: var(--main); color: #fff; }\n.m-btn.bad { color: var(--danger); border-color: rgba(192, 57, 43, .4); }\n.m-btn:disabled { opacity: .5; }\n.m-btns { display: flex; flex-direction: column; gap: 8px; }\n.m-note { font-size: 12px; color: var(--gray); line-height: 1.6; }\n.m-done { text-align: center; padding: 22px 16px; }\n.m-done .ic { margin: 0 auto 8px; color: var(--main); }\n.m-stop { border-left: 3px solid var(--line); }\n.m-stop.cur { border-left-color: var(--sub); }\n.m-stop.done { border-left-color: var(--main); opacity: .75; }\n.m-stop.failed { border-left-color: var(--danger); opacity: .75; }\n.m-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; }\n.m-row a { font-size: 13px; }\n.cnt-grid { display: grid; grid-template-columns: 1fr auto auto; gap: 6px 8px; align-items: center; font-size: 13px; }\n.cnt-grid input { width: 64px; height: 38px; border: 1px solid var(--line); border-radius: 8px; text-align: center; font-size: 15px; font-variant-numeric: tabular-nums; }\n.cnt-grid .h { font-size: 11px; color: var(--gray); text-align: center; }\n\n/* 점주 발주 화면 (/m/…) · 매장 연결 (/k/link) — 카카오톡 인앱 브라우저 기준, 엄지로 누르기 쉬운 크기 */\nbody.shop { font-size: 14px; }\nbody.lock { overflow: hidden; }\n.s-wrap { max-width: 520px; margin: 0 auto; padding: 0 16px 32px; display: flex; flex-direction: column; gap: 12px; }\n.s-wrap.has-bar { padding-bottom: 112px; }\n.s-head { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 10px; padding: 12px 0 10px; background: var(--bg); }\n.s-head .pf { width: 36px; height: 36px; border-radius: 12px; background: var(--main); color: #fff; display: grid; place-items: center; font-family: var(--serif); font-weight: 700; font-size: 16px; flex: none; }\n.s-who { flex: 1; min-width: 0; }\n.s-who b { display: block; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.s-who small { color: var(--gray); font-size: 12px; }\n.s-hbtn { height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--line); background: var(--paper); font-size: 13px; font-weight: 600; white-space: nowrap; }\n.s-banner { display: flex; gap: 10px; align-items: center; background: var(--main); color: #fff; border-radius: 12px; padding: 12px 14px; font-size: 15px; }\n.s-banner.next { background: var(--sub); }\n.s-banner small { display: block; font-size: 12px; opacity: .85; margin-top: 1px; }\n.s-bi { font-size: 22px; }\n.s-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }\n.s-tab { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px 9px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--paper); font-size: 13.5px; font-weight: 600; }\n.s-tab .s-ti { font-size: 24px; line-height: 1.1; }\n.s-tab.on { border-color: var(--main); background: var(--main-t); color: var(--main); }\n.s-tab.lock { color: var(--gray); background: transparent; border-style: dashed; }\n.s-tab em { font-style: normal; font-size: 11px; font-weight: 500; }\n.s-dot { position: absolute; top: 6px; right: 8px; min-width: 18px; height: 18px; border-radius: 9px; background: var(--main); color: #fff; font-size: 11px; font-style: normal; line-height: 18px; padding: 0 5px; }\n.s-quick { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }\n.s-chip { height: 34px; padding: 0 12px; border-radius: 17px; border: 1px solid var(--line); background: var(--paper); font-size: 13px; font-weight: 600; }\n.s-chip.on { background: var(--ink); border-color: var(--ink); color: #fff; }\n.s-search { flex: 1; min-width: 120px; display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 17px; background: var(--paper); font-size: 13px; }\n.s-search input { border: 0; outline: 0; flex: 1; min-width: 0; background: none; font-size: 14px; }\n.s-list { display: flex; flex-direction: column; gap: 8px; }\n.s-item { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--paper); border: 1.5px solid var(--line); border-radius: 12px; }\n.s-item.in { border-color: var(--main); }\n.s-ico { width: 48px; height: 48px; border-radius: 12px; background: var(--ink-t); display: grid; place-items: center; font-size: 26px; flex: none; }\n.s-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }\n.s-info b { font-size: 15px; line-height: 1.35; }\n.s-info small { color: var(--gray); font-size: 12px; }\n.s-price { font-size: 15px; font-weight: 700; margin-top: 2px; }\n.s-price i { font-style: normal; font-weight: 400; color: var(--gray); font-size: 12px; margin-left: 1px; }\n.s-last { align-self: flex-start; margin-top: 4px; border: 0; background: var(--sub-t); color: var(--sub); border-radius: 6px; font-size: 12px; font-weight: 600; padding: 3px 8px; }\n.s-add { height: 44px; min-width: 64px; padding: 0 14px; border-radius: 10px; border: 1.5px solid var(--main); background: var(--paper); color: var(--main); font-size: 15px; font-weight: 700; flex: none; }\n.s-step { display: flex; align-items: center; border-radius: 10px; background: var(--main); color: #fff; flex: none; overflow: hidden; }\n.s-step button { width: 44px; height: 44px; border: 0; background: none; color: #fff; font-size: 22px; font-weight: 600; }\n.s-step output { min-width: 30px; text-align: center; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; }\n.s-step.sm button { width: 38px; height: 38px; font-size: 19px; }\n.s-more { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1.5px dashed var(--line); background: none; font-size: 14px; font-weight: 600; }\n.s-more small { font-weight: 400; color: var(--gray); font-size: 12px; }\n.s-foot { text-align: center; }\n.s-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 8; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); background: var(--paper); border-top: 1px solid var(--line); box-shadow: 0 -6px 18px rgba(0, 0, 0, .06); }\n.s-bar-in { max-width: 520px; margin: 0 auto; display: flex; gap: 10px; align-items: stretch; }\n.s-cartsum { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; border: 0; background: none; padding: 0 4px; text-align: left; }\n.s-cartsum b { font-size: 13px; }\n.s-cartsum span { font-size: 18px; font-weight: 700; }\n.s-cartsum small { font-size: 11.5px; color: var(--sub); }\n.s-go { flex: none; min-width: 132px; height: 54px; border-radius: 12px; border: 0; background: var(--main); color: #fff; font-size: 17px; font-weight: 700; }\n.s-go:disabled { opacity: .45; }\n.s-sheet-bg { position: fixed; inset: 0; z-index: 20; background: rgba(20, 24, 28, .45); display: flex; align-items: flex-end; justify-content: center; }\n.s-sheet { width: 100%; max-width: 520px; max-height: 88vh; display: flex; flex-direction: column; background: var(--paper); border-radius: 18px 18px 0 0; animation: s-up .18s ease-out; }\n@keyframes s-up { from { transform: translateY(24px); opacity: .6; } to { transform: none; opacity: 1; } }\n.s-sh { display: flex; align-items: center; padding: 16px 16px 6px; }\n.s-sh h2 { font-size: 17px; }\n.s-sb { padding: 4px 16px 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }\n.s-sb .sec-h { margin: 6px 0 -4px; font-size: 12px; }\n.s-sf { padding: 10px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); }\n.s-sf .m-btn { height: 54px; font-size: 17px; }\n.s-arrive { background: var(--main-t); color: var(--main); border-radius: 10px; padding: 10px 12px; font-size: 14px; }\n.s-opt { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1.5px solid var(--line); border-radius: 12px; }\n.s-opt:has(input:checked) { border-color: var(--main); background: var(--main-t); }\n.s-opt.dis { opacity: .55; }\n.s-opt .s-ti { font-size: 26px; }\n.s-opt b { display: block; font-size: 15px; }\n.s-opt small { color: var(--gray); font-size: 12px; }\n.s-opt input { width: 20px; height: 20px; accent-color: var(--main); }\n.s-done { gap: 8px; }\n.s-check { width: 64px; height: 64px; margin: 4px auto 6px; border-radius: 32px; background: var(--main); color: #fff; display: grid; place-items: center; font-size: 32px; font-weight: 700; }\n.s-check.bad { background: var(--danger); }\n.s-linkbtn { display: grid; place-items: center; text-decoration: none; color: inherit; }\n.m-btn.pri.s-linkbtn { color: #fff; }\n.s-kakao { display: grid; place-items: center; text-decoration: none; background: #FEE500; border-color: #FEE500; color: #191919; }\n.s-code { height: 60px; border: 1.5px solid var(--line); border-radius: 12px; text-align: center; font-size: 30px; letter-spacing: .4em; font-variant-numeric: tabular-nums; width: 100%; }\n.s-code:focus { border-color: var(--main); outline: 0; }\n.s-order { gap: 6px; }\n.s-oh { display: flex; justify-content: space-between; align-items: center; gap: 8px; }\n.s-pill { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 11px; background: var(--main-t); color: var(--main); white-space: nowrap; }\n.s-pill.st-payfail { background: var(--danger-t); color: var(--danger); }\n.s-pill.st-delivered, .s-pill.st-cancelled, .s-pill.st-expired, .s-pill.st-held { background: var(--ink-t); color: var(--gray); }\n.s-steps { list-style: none; margin: 4px 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; font-size: 11.5px; color: var(--gray); text-align: center; }\n.s-steps li { border-top: 3px solid var(--line); padding-top: 4px; }\n.s-steps li.ok { border-color: var(--main); color: var(--main); }\n.s-steps li.cur { border-color: var(--main); color: var(--ink); font-weight: 700; }\n.s-steps li.bad { border-color: var(--danger); color: var(--danger); font-weight: 700; }\n.s-toast { position: fixed; left: 50%; bottom: 120px; transform: translateX(-50%); z-index: 30; background: var(--ink); color: #fff; padding: 10px 16px; border-radius: 20px; font-size: 13.5px; max-width: calc(100% - 32px); text-align: center; }\n.s-toast.bad { background: var(--danger); }\n\n/* 관리자 모바일 내역 (/a) */\n.a-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }\n.a-tile { background: var(--paper); border: 1.5px solid var(--line); border-radius: 12px; padding: 11px 12px; display: flex; flex-direction: column; gap: 1px; text-align: left; font: inherit; color: var(--ink); }\nbutton.a-tile { cursor: pointer; }\n.a-tile small { font-size: 12px; color: var(--gray); }\n.a-tile b { font-size: 21px; font-variant-numeric: tabular-nums; }\n.a-tile span { font-size: 11.5px; color: var(--gray); }\n.a-tile.warn { border-color: rgba(156, 107, 79, .55); }\n.a-tile.warn b { color: var(--sub); }\n.a-num { font-variant-numeric: tabular-nums; white-space: nowrap; }\n.a-bar { height: 6px; border-radius: 3px; background: var(--ink-t); overflow: hidden; margin-top: 4px; }\n.a-bar i { display: block; height: 100%; background: var(--main); }\n.a-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 0; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; font: inherit; color: var(--ink); cursor: pointer; }\n.a-row:last-child { border-bottom: 0; }\n.a-row .nm { flex: 1; min-width: 0; }\n.a-row .nm b { display: block; font-size: 14px; }\n.a-row .nm small { color: var(--gray); font-size: 11.5px; }\n.a-amt { text-align: right; }\n.a-amt b { display: block; font-variant-numeric: tabular-nums; }\n.a-amt small { color: var(--gray); font-size: 11.5px; }\n\n/* 점주 발주 화면: 매대·소분류 칩 · 발주서(사우나) */\n.s-gchips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }\n.s-gc { flex: none; height: 32px; padding: 0 11px; border-radius: 16px; border: 1px solid var(--line); background: var(--paper); font-size: 12.5px; font-weight: 600; color: var(--ink); white-space: nowrap; }\n.s-gc.on { background: var(--ink); border-color: var(--ink); color: #fff; }\n.s-banner.sheet { background: #5B4A3A; }\n.s-stick { position: sticky; top: 58px; z-index: 4; background: var(--bg); padding: 6px 0; display: flex; flex-direction: column; gap: 7px; }\n.s-chg { display: flex; gap: 6px; flex-wrap: wrap; font-size: 12.5px; }\n.s-chg span { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 3px 10px; }\n.c-up { --c: #2F6B4D; } .c-dn { --c: #9A5B12; } .c-off { --c: #9A3B30; } .c-new { --c: var(--main); }\n.s-chg span[class^=\"c-\"] { color: var(--c); }\n.s-zh { font-size: 13px; font-weight: 700; color: var(--ink); padding: 8px 2px 0; }\n.s-zh span { font-weight: 400; color: var(--gray); font-size: 12px; }\n.s-rows { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }\n.s-row { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-top: 1px solid var(--line); }\n.s-row:first-child { border-top: 0; }\n.s-row[class*=\"c-\"] { background: color-mix(in srgb, var(--c) 7%, transparent); }\n.s-rn { flex: 1; min-width: 0; }\n.s-rn b { display: block; font-size: 14px; line-height: 1.35; }\n.s-rn b i, .s-tag { font-style: normal; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 9px; margin-left: 5px; vertical-align: 1px; color: var(--c); background: color-mix(in srgb, var(--c) 14%, transparent); }\n.s-rn small { color: var(--gray); font-size: 11.5px; }\n.s-row.c-off .s-rn b { text-decoration: line-through; color: var(--gray); }\n.s-row.c-off .s-rn b i { text-decoration: none; }\n.s-revive { flex: none; height: 38px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--paper); font-size: 13px; font-weight: 600; color: var(--ink); }\na.btn { text-decoration: none; display: inline-flex; align-items: center; }\n",
"assets/console.js": "'use strict';\n/* ==========================================================================\n   BevFlow 운영 콘솔\n   - 서버 스냅샷(/api/console/snapshot)을 20초마다 받아(변경 없으면 304) 화면을 그린다.\n   - 시간은 모두 한국 표준시(KST). 내부에서는 \"오늘 0시(KST) 기준 경과 시간(h)\"으로 바꿔 계산한다.\n   - 조치 버튼은 모두 서버 API를 호출하고, 성공하면 스냅샷을 다시 받는다.\n   ========================================================================== */\n(() => {\n  // ── 유틸리티 ───────────────────────────────────────────────\n  const $ = (s, el = document) => el.querySelector(s);\n  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));\n  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n  const num = (n, d = 0) => Number(n || 0).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });\n  const won = (n) => num(Math.round(n)) + '원';\n  const pct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : num(n, d) + '%');\n  const box = (n) => num(Math.max(0, n), 1);\n  const DOW = ['일', '월', '화', '수', '목', '금', '토'];\n  const KST = 9 * 3600e3, DAY = 86400e3;\n  const kstMid = (ts) => Math.floor((ts + KST) / DAY) * DAY - KST;\n  let skew = 0;                    // 서버 시각 − 브라우저 시각\n  let TODAY0 = kstMid(Date.now()); // 오늘 0시(KST)\n  const nowTs = () => Date.now() + skew;\n  const nowH = () => (nowTs() - TODAY0) / 3600e3;\n  const H = (ts) => (ts == null ? null : (ts - TODAY0) / 3600e3);\n  const TS = (h) => TODAY0 + h * 3600e3;\n  const dayOf = (h) => Math.floor(h / 24);\n  const hodOf = (h) => h - Math.floor(h / 24) * 24;\n  const kd = (h) => new Date(TS(h) + KST);\n  const md = (h) => { const d = kd(h); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };\n  const mdw = (h) => { const d = kd(h); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' (' + DOW[d.getUTCDay()] + ')'; };\n  const hm = (h) => { const m = Math.floor(hodOf(h) * 60 + 1e-6); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };\n  const dayWord = (h) => { const d = dayOf(h); return d === 0 ? '오늘' : d === -1 ? '어제' : d === 1 ? '내일' : md(h); };\n  const when = (h) => dayWord(h) + ' ' + hm(h);\n  const durTxt = (min) => { min = Math.max(0, Math.round(min)); if (min < 60) return min + '분'; const m = min % 60; return Math.floor(min / 60) + '시간' + (m ? ' ' + m + '분' : ''); };\n  const dateIdx = (s) => { const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s || ''); return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - KST - TODAY0) / DAY) : null; };\n  const dateStrOf = (h) => { const d = kd(h); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };\n\n  const IC = {\n    home: '<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"8.5\" rx=\"1\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"5\" rx=\"1\"/><rect x=\"13.5\" y=\"11.5\" width=\"7\" height=\"9\" rx=\"1\"/><rect x=\"3.5\" y=\"15\" width=\"7\" height=\"5.5\" rx=\"1\"/>',\n    box: '<path d=\"M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z\"/><path d=\"M3.5 7.5 12 11.5l8.5-4M12 11.5v9\"/>',\n    order: '<rect x=\"5\" y=\"4\" width=\"14\" height=\"17\" rx=\"1.5\"/><path d=\"M9 4V2.8h6V4M8.5 10h7M8.5 14h7M8.5 18h4\"/>',\n    chat: '<path d=\"M4 5h16v11H9.5L5 19.5V16H4z\"/><path d=\"M8 9.5h8M8 12.5h5\"/>',\n    truck: '<path d=\"M2.5 6.5h11v9.5h-11zM13.5 9.5h4l3 3.5v3h-7z\"/><circle cx=\"6.5\" cy=\"17.5\" r=\"1.7\"/><circle cx=\"17\" cy=\"17.5\" r=\"1.7\"/>',\n    report: '<path d=\"M4 3.5v16.5h16.5\"/><path d=\"M7.5 15.5 11.5 11l3 2.5 5-6\"/>',\n    gear: '<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6\"/>',\n    reset: '<path d=\"M4.5 12a7.5 7.5 0 1 0 2.2-5.3\"/><path d=\"M4.5 4v4h4\"/>',\n    alert: '<path d=\"M12 4 2.8 19.5h18.4z\"/><path d=\"M12 10v4.2M12 16.8v.2\"/>',\n    check: '<path d=\"m5 12.5 4.5 4.5L19 7.5\"/>',\n    clock: '<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/>',\n    x: '<path d=\"M6.5 6.5l11 11M17.5 6.5l-11 11\"/>',\n    down: '<path d=\"m6.5 9.5 5.5 5.5 5.5-5.5\"/>',\n    right: '<path d=\"M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5\"/>',\n    card: '<rect x=\"3\" y=\"5.5\" width=\"18\" height=\"13\" rx=\"1.5\"/><path d=\"M3 10h18M7 15h3\"/>',\n    send: '<path d=\"M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z\"/>',\n    phone: '<path d=\"M7 3.5h3l1.5 4-2 1.3a10.5 10.5 0 0 0 5.7 5.7l1.3-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 5 5.5a2 2 0 0 1 2-2z\"/>',\n    doc: '<path d=\"M6 3.5h8l4 4v13H6z\"/><path d=\"M14 3.5v4h4M9 12h6M9 15.5h6\"/>',\n    pin: '<path d=\"M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.3\"/>',\n    link: '<path d=\"M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1\"/><path d=\"M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1\"/>',\n    copy: '<rect x=\"8\" y=\"8\" width=\"12\" height=\"12\" rx=\"1.5\"/><path d=\"M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8\"/>',\n    edit: '<path d=\"M4 20h4L19 9l-4-4L4 16z\"/><path d=\"m13.5 6.5 4 4\"/>',\n    plus: '<path d=\"M12 5v14M5 12h14\"/>',\n    signal: '<path d=\"M4 18v-2M8.5 18v-5M13 18V10M17.5 18V6.5\"/>',\n    wifi: '<path d=\"M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a7.5 7.5 0 0 1 11 0M9.5 15.5a3.5 3.5 0 0 1 5 0\"/>',\n    batt: '<rect x=\"3\" y=\"8\" width=\"16\" height=\"8\" rx=\"1.5\"/><path d=\"M21 11v2\"/>',\n    user: '<circle cx=\"12\" cy=\"8.5\" r=\"3.5\"/><path d=\"M5 20a7 7 0 0 1 14 0\"/>',\n    download: '<path d=\"M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14\"/>',\n  };\n  const icon = (n, s = 16) => `<svg class=\"ic\" width=\"${s}\" height=\"${s}\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">${IC[n]}</svg>`;\n\n  // ── 서버 통신 ───────────────────────────────────────────────\n  async function api(method, url, body, { raw = false } = {}) {\n    const headers = { 'x-bevflow': '1' };\n    if (body !== undefined && !raw) headers['content-type'] = 'application/json';\n    if (raw) headers['content-type'] = 'text/csv; charset=utf-8';\n    const res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });\n    if (res.status === 401) { location.href = '/login'; throw new Error('로그인이 필요합니다'); }\n    const j = await res.json().catch(() => ({}));\n    if (res.status === 403 && /비밀번호를 먼저/.test(j.error || '')) { location.href = '/login?change=1'; throw new Error(j.error); }\n    if (!res.ok) throw new Error(j.error || `요청에 실패했습니다 (${res.status})`);\n    return j;\n  }\n\n  // ── 데이터 ─────────────────────────────────────────────────\n  let DB = null, SNAP = null, ETAG = null, lastSync = 0, syncErr = null;\n  let lastSeenEv = null, justMoved = null, seriesVersion = 0;  // 스냅샷을 새로 받아도 유지할 화면 상태\n  let SKU = {}, REG = {}, REGIONS = [];\n  const S = (id) => DB.storeById.get(id);\n  const inRegion = (rid) => state.region === 'ALL' || state.region === rid;\n  const can = (role) => ({ viewer: 1, ops: 2, admin: 3 })[DB.user.role] >= ({ viewer: 1, ops: 2, admin: 3 })[role];\n\n  function adapt(snap) {\n    skew = snap.now - Date.now();\n    TODAY0 = kstMid(snap.now);\n    SKU = Object.fromEntries(snap.skus.map((k) => [k.id, k]));\n    REGIONS = snap.regions.map((r) => {\n      const d = snap.drivers.find((x) => x.region_id === r.id && x.active);\n      return { id: r.id, name: r.name, area: r.area, hub: r.hub_name, lat: r.hub_lat, lng: r.hub_lng, radius: r.radius_km || 3, driver: d ? d.name : '미배정', driverObj: d || null, vehicle: d ? d.vehicle : '' };\n    });\n    REG = Object.fromEntries(REGIONS.map((r) => [r.id, r]));\n    const st = snap.settings;\n    const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };\n    const stores = snap.stores.map((s) => {\n      const rg = REG[s.region] || {};\n      let angle, radius;\n      if (s.lat != null && rg.lat != null) {\n        const dx = (s.lng - rg.lng) * 88.2, dy = (s.lat - rg.lat) * 111;\n        angle = Math.atan2(-dy, dx); radius = Math.min(.96, Math.hypot(dx, dy) / (rg.radius || 3));\n      } else { angle = hash(s.id) * Math.PI * 2; radius = .3 + hash(s.id + 'r') * .6; }\n      const hourW = s.profile[Math.floor(hodOf(H(snap.now)))] || 0;\n      const posDelayAt = s.lastPosAt && hourW > .03 && snap.now - s.lastPosAt > 45 * 60e3 ? H(s.lastPosAt) : null;\n      return {\n        ...s, angle, radius, posDelayAt, posNever: !s.lastPosAt,\n        items: s.items.filter((it) => SKU[it.sku]).map((it) => ({ ...it, sku: SKU[it.sku], lastCount: it.lastCount ? { ...it.lastCount, t: H(it.lastCount.t) } : null, lastIn: it.lastIn ? { ...it.lastIn, t: H(it.lastIn.t) } : null })),\n      };\n    });\n    const P = snap.proposals.map((p) => ({\n      ...p, createdAt: H(p.createdAt), sendAt: H(p.sendAt), sentAt: H(p.sentAt), openAt: H(p.openAt), remindedAt: H(p.remindedAt), respondAt: H(p.respondAt),\n      closeAt: H(p.closeAt), paidAt: H(p.paidAt), payFailAt: H(p.payFailAt), deliveredAt: H(p.deliveredAt), deliverDay: dateIdx(p.deliverDate), payFail: p.status === 'payfail',\n    }));\n    const byId = new Map(P.map((p) => [p.pid, p]));\n    const routes = new Map(snap.routes.map((r) => [r.id, r]));\n    const stops = snap.stops.map((s) => {\n      const arrive = H(s.arrivedAt ?? s.eta), depart = H(s.departedAt ?? (s.eta != null ? s.eta + 7 * 60e3 : null));\n      const r = routes.get(s.route);\n      return { ...s, day: dateIdx(s.date), eta: H(s.eta), arrive, depart, dur: s.departedAt && s.arrivedAt ? (s.departedAt - s.arrivedAt) / 60e3 : null, p: byId.get(s.proposal) || null, dispatchedAt: r ? H(r.dispatched_at) : null };\n    });\n    for (const s of stops) if (s.p && s.status !== 'failed') { s.p.stop = s; s.p.shippedAt = s.dispatchedAt ?? s.day * 24 + st.dispatch; }\n    DB = {\n      user: snap.user, settings: st, stores, storeById: new Map(stores.map((s) => [s.idx, s])), P, byId, stops,\n      messages: snap.messages.map((m) => ({ ...m, t: H(m.created_at), sentAt: H(m.sent_at) })),\n      events: snap.events.map((e) => ({ ...e, t: H(e.t) })), drivers: snap.drivers, routes: snap.routes,\n      settlements: snap.settlements, pilot: snap.pilot, unmapped: snap.unmapped, outboxFailed: snap.outboxFailed, accessPending: snap.accessPending || 0,\n    };\n    if (!DB.pilotStartH) DB.pilotStartH = H(st.pilotStart);\n    seriesVersion++; // 차트 이력은 이전 것을 보여 주면서 백그라운드로 갱신\n  }\n\n  async function sync(force) {\n    try {\n      const res = await fetch('/api/console/snapshot', { headers: force || !ETAG ? {} : { 'if-none-match': ETAG }, credentials: 'same-origin' });\n      if (res.status === 401) { location.href = '/login'; return; }\n      if (res.status === 304) { lastSync = Date.now(); syncErr = null; renderShell(); return; }\n      const j = await res.json();\n      if (res.status === 403 && /비밀번호를 먼저/.test(j.error || '')) { location.href = '/login?change=1'; return; }\n      if (!res.ok) throw new Error(j.error || '동기화 실패');\n      ETAG = res.headers.get('etag');\n      SNAP = j; adapt(j);\n      lastSync = Date.now(); syncErr = null;\n      if (!state) initState();\n      if (!state.inv.open && !isTyping()) render(); else renderShell();\n    } catch (e) {\n      syncErr = e.message || String(e);\n      if (DB) renderShell();\n      else $('#bootMsg').textContent = '데이터를 불러오지 못했습니다 — ' + syncErr;\n    }\n  }\n  const isTyping = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#main'); };\n  async function afterAction(msg, ic = 'check') { if (msg) toast(msg, ic); await sync(true); }\n  async function run(btn, fn) {\n    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class=\"spin\"></span>처리 중…'; }\n    try { return await fn(); } catch (e) { toast(esc(e.message), 'alert'); if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }\n  }\n\n  // ── 상태 판정 ───────────────────────────────────────────────\n  function pStatus(p) {\n    switch (p.status) {\n      case 'created': return 'created';\n      case 'sent': return p.respondAt != null ? 'processing' : p.openAt != null ? 'opened' : 'sent';\n      case 'payfail': return 'payfail';\n      case 'paid': return 'paid';\n      case 'dispatched': return p.stop && p.stop.status === 'arrived' ? 'unloading' : 'shipped';\n      case 'delivered': return 'delivered';\n      case 'held': return 'hold';\n      case 'expired': return 'noresp';\n      default: return 'cancelled';\n    }\n  }\n  const OPEN = ['created', 'sent', 'opened', 'processing', 'payfail', 'paid', 'shipped', 'unloading'];\n  const openOrder = (st) => DB.P.find((p) => p.store === st.idx && OPEN.includes(pStatus(p)));\n  const boxesOf = (p) => p.lines.reduce((a, l) => a + l.qty, 0);\n  const skuName = (id) => (SKU[id] ? SKU[id].name : id);\n  const skuSum = (p) => { const l = p.lines[0]; return l ? skuName(l.sku) + ' ' + l.qty + '박스' + (p.lines.length > 1 ? ' 외 ' + (p.lines.length - 1) + '건' : '') : '—'; };\n  const itemBurn = (st, it) => Math.max(1e-6, it.r * (1 + st.alpha) * (1 + st.beta));\n  function itemStatus(st, it) {\n    const lo = it.E - it.w;\n    if (lo <= it.S) return 'order';\n    if ((lo - it.S) / itemBurn(st, it) < 1.2) return 'warn';\n    return 'ok';\n  }\n  const ST_LABEL = { ok: ['정상', 'b-ok'], warn: ['주의', 'b-warn'], order: ['발주필요', 'b-bad'] };\n  const storeStatus = (st) => { const ss = st.items.map((it) => itemStatus(st, it)); return ss.includes('order') ? 'order' : ss.includes('warn') ? 'warn' : 'ok'; };\n\n  function plannedIn(st, props) {\n    const out = [];\n    for (const p of props) {\n      if (p.store !== st.idx) continue;\n      if (p.status === 'dispatched' && p.stop) out.push({ t: p.stop.eta, p, eta: true });\n      else if (p.status === 'paid' && p.deliverDay != null) out.push({ t: p.deliverDay * 24 + DB.settings.dispatch + 1, p, eta: false });\n    }\n    return out;\n  }\n  function forecast(st, it, props, hours = 34) {\n    const pts = []; let E = it.E, w = it.w; const t0 = nowH();\n    const op = openOrder(st), covered = op && op.lines.some((l) => l.sku === it.sku.id && l.qty > 0); // 진행 중 발주에 포함된 SKU는 예상 트리거를 그리지 않음\n    const plan = plannedIn(st, props).map((x) => ({ ...x, q: (x.p.lines.find((l) => l.sku === it.sku.id) || { qty: 0 }).qty })).filter((x) => x.q > 0);\n    let trig = null, first = true;\n    for (let t = Math.ceil(t0); t <= t0 + hours; t++) {\n      const hr = ((Math.floor(t - 1) % 24) + 24) % 24;\n      const frac = first ? (t - t0) : 1; first = false;\n      const est = it.r * st.profile[hr] * (1 + st.alpha) * frac;\n      E -= est; w += st.beta * est;\n      plan.forEach((pl) => { if (!pl.done && pl.t <= t) { E = Math.max(0, E) + pl.q; w = DB.settings.bandW0; pl.done = true; pl.E = E; } });\n      if (!trig && !plan.length && !covered && E - w <= it.S && itemStatus(st, it) !== 'order') trig = { t, E, w };\n      pts.push({ t, E: Math.max(0, E), w, f: true });\n    }\n    return { pts, plan, trig };\n  }\n  function hoursToTrigger(st, it) {\n    if (it.E - it.w <= it.S) return 0;\n    let E = it.E, w = it.w; const t0 = nowH();\n    for (let t = Math.ceil(t0); t <= t0 + 30; t++) {\n      const hr = ((Math.floor(t - 1) % 24) + 24) % 24;\n      const est = it.r * st.profile[hr] * (1 + st.alpha) * (t - t0 < 1 ? t - t0 : 1);\n      E -= est; w += st.beta * est;\n      if (E - w <= it.S) return t - t0;\n    }\n    return Infinity;\n  }\n\n  // ── 집계 ───────────────────────────────────────────────────\n  function kpis() {\n    const t = nowH();\n    const P = DB.P.filter((p) => { const s = S(p.store); return s && inRegion(s.region); });\n    const created = P.filter((p) => p.createdAt >= 0 && p.createdAt <= t).length;\n    const createdY = P.filter((p) => p.createdAt >= -24 && p.createdAt <= t - 24).length;\n    const approved = P.filter((p) => p.response === 'approve' && p.respondAt != null && p.respondAt >= 0).length;\n    const pending = P.filter((p) => ['sent', 'opened'].includes(pStatus(p)));\n    const over30 = pending.filter((p) => p.sentAt != null && (t - p.sentAt) * 60 > 30).length;\n    const payfail = P.filter((p) => pStatus(p) === 'payfail').length;\n    const todayStops = DB.stops.filter((s) => s.day === 0 && inRegion(s.region) && s.status !== 'failed');\n    const done = todayStops.filter((s) => s.status === 'done').length;\n    const gmv = P.filter((p) => p.paidAt != null && p.paidAt >= 0 && p.status !== 'cancelled').reduce((a, p) => a + p.amount, 0);\n    const sd = DB.pilot.sameDay;\n    const wk = DB.pilot.weeks;\n    const w6 = wk[wk.length - 1];\n    return {\n      created, createdY, approved, pending: pending.length, over30, payfail, stops: todayStops.length, done, moving: todayStops.length - done,\n      sameDay: sd.n ? sd.ok / sd.n * 100 : null, sameN: sd.n, sameOk: sd.ok, same7n: sd.n7, same7ok: sd.ok7,\n      gmv, gmv14: DB.pilot.gmv14, appr7: w6 && w6.decided ? w6.approved / w6.decided * 100 : null,\n    };\n  }\n  function pilotMetrics() {\n    const wk = DB.pilot.weeks;\n    const rec = wk.slice(-2);\n    const sum = (arr, k) => arr.reduce((a, w) => a + w[k], 0);\n    const allDec = sum(wk, 'decided');\n    const last14 = DB.stops.filter((s) => s.status === 'done' && s.dur != null && s.day >= -13).map((s) => s.dur).sort((a, b) => a - b);\n    const p = DB.pilot;\n    const days = p.firstPaidAt ? Math.max(1, (nowTs() - p.firstPaidAt) / DAY) : 1;\n    return {\n      weeks: wk.map((w) => ({ ...w, appr: w.decided ? w.approved / w.decided * 100 : null, err: w.counts ? w.errSum / w.counts * 100 : null, hit: w.counts ? w.hits / w.counts * 100 : null, stop: w.stops ? w.stopSum / w.stops : null })),\n      appr2: sum(rec, 'decided') ? sum(rec, 'approved') / sum(rec, 'decided') * 100 : null, apprN: sum(rec, 'decided'),\n      apprCum: allDec ? sum(wk, 'approved') / allDec * 100 : null,\n      err2: sum(rec, 'counts') ? sum(rec, 'errSum') / sum(rec, 'counts') * 100 : null, errN: sum(rec, 'counts'),\n      hit2: sum(rec, 'counts') ? sum(rec, 'hits') / sum(rec, 'counts') * 100 : null,\n      stop2: sum(rec, 'stops') ? sum(rec, 'stopSum') / sum(rec, 'stops') : null, stopN: sum(rec, 'stops'),\n      stopP90: last14.length ? last14[Math.floor(last14.length * .9)] : null, stopIn: last14.length ? last14.filter((d) => d <= 7).length / last14.length * 100 : null,\n      monthlyPerStore: p.activeStores ? p.gmv / p.activeStores / days * 30.4 : 0, avgPrice: p.boxes ? p.gmv / p.boxes : 0, avgBoxes: p.orders ? p.boxes / p.orders : 0,\n    };\n  }\n\n  // ── 상태 ───────────────────────────────────────────────────\n  const TABS = [\n    { id: 'overview', name: '관제 홈', icon: 'home', desc: '매장·권역의 오늘 운영 현황' },\n    { id: 'inventory', name: '재고 관제', icon: 'box', desc: 'POS 판매 로그 기반 재고 추정 — 오차 밴드 하한이 안전재고에 닿으면 발주 제안' },\n    { id: 'orders', name: '발주 관제', icon: 'order', desc: '제안 생성 → 승인 대기 → 결제 완료 → 출고 완료' },\n    { id: 'notify', name: '알림톡 모니터', icon: 'chat', desc: '사장님께 발송된 발주 제안 메시지와 응답' },\n    { id: 'delivery', name: '배송 관제', icon: 'truck', desc: '권역별 라우트 · 기사 진행 현황 · 정차 시간' },\n    { id: 'report', name: '파일럿 리포트', icon: 'report', desc: '3대 검증 지표와 티오더 정산' },\n    { id: 'admin', name: '관리', icon: 'gear', desc: '매장 · 품목 승인·카카오 · SKU·메뉴 매핑 · 기사 · 계정 · 운영 설정 · 연동' },\n  ];\n  let state = null;\n  function initState() {\n    const first = DB.stores.find((s) => s.active && s.onboarded) || DB.stores[0];\n    let tab = 'overview';\n    try { tab = localStorage.getItem('bf.tab') || 'overview'; } catch { /* 저장소 차단 */ }\n    if (!TABS.some((t) => t.id === tab)) tab = 'overview';\n    state = {\n      tab, region: 'ALL', actFilter: 'ALL',\n      inv: { store: first ? first.idx : null, sku: first && first.items[0] ? first.items[0].sku.id : null, status: 'ALL', open: false, q: '' },\n      ord: { sel: null }, noti: { sel: null, filter: 'ALL', day: 0 }, del: { scope: '2w' }, rep: { perf: 'top' },\n      adm: { sub: 'stores', data: null, loading: false, q: '' },\n    };\n  }\n\n  // ── 셸 ─────────────────────────────────────────────────────\n  function renderShell() {\n    if (!DB) return;\n    const tab = TABS.find((x) => x.id === state.tab);\n    $('#pageTitle').textContent = tab.name;\n    $('#pageDesc').textContent = tab.desc;\n    $('#regionSeg').innerHTML = [['ALL', '전체'], ...REGIONS.map((r) => [r.id, r.name])].map(([id, nm]) => `<button type=\"button\" data-region=\"${esc(id)}\" aria-pressed=\"${state.region === id}\">${esc(nm)}</button>`).join('');\n    const k = kpis();\n    const nOrder = DB.stores.filter((st) => st.active && inRegion(st.region) && st.onboarded && storeStatus(st) === 'order' && !openOrder(st)).length;\n    const badge = { overview: k.over30 + k.payfail, orders: k.pending + k.payfail, inventory: nOrder, notify: k.pending, admin: DB.unmapped + DB.outboxFailed + DB.accessPending };\n    $('#nav').innerHTML = TABS.map((x, i) => `<button type=\"button\" data-tab=\"${x.id}\" ${state.tab === x.id ? 'aria-current=\"page\"' : ''}>${icon(x.icon)}<span>${x.name}</span><span class=\"nb\">${badge[x.id] ? `<span class=\"cnt ${['inventory', 'notify', 'admin'].includes(x.id) ? 'soft' : ''}\">${badge[x.id]}</span>` : ''}<kbd>${i + 1}</kbd></span></button>`).join('');\n    $('#btnRefresh').innerHTML = icon('reset', 15) + '<span>새로고침</span>';\n    const wk = DB.pilot.weeks.length;\n    $('#pilotBox').innerHTML = `<b>파일럿 ${wk}주차</b> · ${md(DB.pilotStartH)} 시작<br>매장 <b>${DB.stores.filter((s) => s.active).length}</b> · 권역 <b>${REGIONS.length}</b> · 기사 <b>${DB.drivers.filter((d) => d.active).length}</b><br>컷오프 <b>${hm(DB.settings.cutoff)}</b> · 출고 <b>${hm(DB.settings.dispatch)}</b>`;\n    const posLag = DB.stores.filter((s) => s.active && s.posDelayAt != null).length;\n    const posNever = DB.stores.filter((s) => s.active && s.posNever).length;\n    const pay = DB.P.filter((p) => pStatus(p) === 'payfail').length;\n    const todayRoutes = DB.routes.filter((r) => dateIdx(r.date) === 0).length;\n    $('#sysStatus').innerHTML = `<div class=\"sys-h\">연동 상태</div>\n      <div class=\"sys-row\"><span class=\"d ${posLag || posNever ? 'warn' : ''}\"></span>티오더 POS 로그<em>${posLag ? '지연 ' + posLag + '곳' : posNever ? '미수신 ' + posNever + '곳' : '정상'}</em></div>\n      <div class=\"sys-row\"><span class=\"d ${DB.outboxFailed ? 'bad' : ''}\"></span>알림 발송 (${DB.settings.notifier === 'console' ? '콘솔' : '웹훅'})<em>${DB.outboxFailed ? '실패 ' + DB.outboxFailed + '건' : '정상'}</em></div>\n      <div class=\"sys-row\"><span class=\"d ${pay ? 'bad' : ''}\"></span>결제 (${DB.settings.payMethod === 'invoice' ? '후불' : '카드'})<em>${pay ? '실패 ' + pay + '건' : '정상'}</em></div>\n      <div class=\"sys-row\"><span class=\"d\"></span>배차<em>오늘 ${todayRoutes}개 라우트</em></div>`;\n    $('#operator').innerHTML = `<span class=\"avatar\">${esc((DB.user.name || '?').slice(0, 1))}</span><span>${esc(DB.user.name)} · ${({ admin: '관리자', ops: '운영자', viewer: '열람' })[DB.user.role]}<br><button class=\"btn sm\" data-act=\"logout\" style=\"margin-top:4px\">로그아웃</button> <button class=\"btn sm\" data-act=\"pwchange\" style=\"margin-top:4px\">비밀번호</button></span>`;\n    tickClock();\n  }\n  function tickClock() {\n    const d = new Date(nowTs() + KST);\n    $('#clockDate').textContent = d.getUTCFullYear() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0') + ' (' + DOW[d.getUTCDay()] + ')';\n    $('#clockTime').textContent = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((x) => String(x).padStart(2, '0')).join(':');\n    const ago = lastSync ? Math.round((Date.now() - lastSync) / 1000) : null;\n    $('#syncStatus').innerHTML = syncErr ? `<span class=\"sync err\"><span class=\"d\"></span>동기화 오류 · ${esc(syncErr).slice(0, 40)}</span>` : `<span class=\"sync\"><span class=\"d\"></span>동기화 ${ago == null ? '—' : ago + '초 전'}</span>`;\n  }\n\n  // ── 렌더 ───────────────────────────────────────────────────\n  const prevKpi = {};\n  function render() {\n    if (!DB) return;\n    const keep = {}; $$('[data-sk]').forEach((el) => { keep[el.dataset.sk] = el.scrollTop; });\n    const mainScroll = $('#main').scrollTop;\n    renderShell();\n    const v = { overview: viewOverview, inventory: viewInventory, orders: viewOrders, notify: viewNotify, delivery: viewDelivery, report: viewReport, admin: viewAdmin }[state.tab];\n    const banner = DB.settings.sampleData ? `<div class=\"sample-banner\">${icon('alert', 15)}<span><b>샘플 데이터</b>로 운영 중입니다. 실제 매장을 등록하기 전에 [관리 → 데이터 연동]에서 샘플을 삭제하세요.</span></div>` : '';\n    $('#main').innerHTML = `<div class=\"view ${['overview', 'orders', 'notify'].includes(state.tab) ? 'fit' : ''}\">${banner}${v()}</div>`;\n    $$('[data-sk]').forEach((el) => { if (keep[el.dataset.sk] != null) el.scrollTop = keep[el.dataset.sk]; });\n    $('#main').scrollTop = mainScroll;\n    const ph = $('#phBody'); if (ph) ph.scrollTop = ph.scrollHeight;\n    renderDrawer();\n    animateKpis();\n    bindCharts();\n    if (state.tab === 'inventory') loadSeries();\n    if (state.tab === 'admin' && !state.adm.data && !state.adm.loading) loadAdmin();\n  }\n  function animateKpis() {\n    $$('[data-kpi]').forEach((el) => {\n      const key = el.dataset.kpi, val = parseFloat(el.dataset.val), dec = +(el.dataset.dec || 0), unit = el.dataset.unit || '';\n      const old = prevKpi[key];\n      const valEl = el.querySelector('.kval');\n      if (old != null && isFinite(val) && Math.abs(old - val) > 1e-9 && valEl) {\n        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);\n        const t0 = performance.now();\n        const step = (now) => { const k = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - k, 3); valEl.textContent = num(old + (val - old) * e, dec) + unit; if (k < 1) requestAnimationFrame(step); };\n        requestAnimationFrame(step);\n      }\n      if (isFinite(val)) prevKpi[key] = val;\n    });\n  }\n  function kpiTile(key, label, val, unit, sub, opt = {}) {\n    const dec = opt.dec || 0;\n    const shown = val == null || !isFinite(val) ? '—' : num(val, dec) + (opt.u || '');\n    return `<div class=\"kpi\" data-kpi=\"${key}\" data-val=\"${val ?? ''}\" data-dec=\"${dec}\" data-unit=\"${opt.u || ''}\">\n      <div class=\"kpi-l\"><span>${label}</span></div>\n      <div class=\"kpi-v\"><span class=\"kval\">${shown}</span>${unit && shown !== '—' ? `<small>${unit}</small>` : ''}</div>\n      <div class=\"kpi-s\" title=\"${esc(String(sub).replace(/<[^>]+>/g, ''))}\">${sub}</div></div>`;\n  }\n  function kpiStrip(k) {\n    return `<section class=\"kpis\" aria-label=\"오늘의 핵심 지표\">\n      ${kpiTile('created', '오늘 발주 제안', k.created, '건', `어제 같은 시각 ${k.createdY}건`)}\n      ${kpiTile('approved', '승인 완료', k.approved, '건', `이번 주 승인율 <span class=\"up\">${pct(k.appr7)}</span>`)}\n      ${kpiTile('pending', '승인 대기', k.pending, '건', k.over30 ? `<span class=\"bad\">30분 초과 ${k.over30}건</span>${k.payfail ? ` · 결제 실패 ${k.payfail}건 별도` : ''}` : `30분 초과 없음${k.payfail ? ` · 결제 실패 ${k.payfail}건 별도` : ''}`)}\n      ${kpiTile('stops', '오늘 출고', k.stops, '건', `배송 완료 ${k.done} · 배송 중 ${k.moving}`)}\n      ${kpiTile('sameday', '당일배송 달성률', k.sameDay, '', k.sameN ? `12시 전 결제 ${k.sameOk}/${k.sameN}건 · 7일 ${k.same7ok}/${k.same7n}` : '아직 대상 발주 없음', { dec: 1, u: '%' })}\n      ${kpiTile('gmv', '오늘 GMV', k.gmv, '원', `최근 14일 일 평균 ${num(Math.round(k.gmv14 / 1000) * 1000)}원`)}\n    </section>`;\n  }\n\n  /* ---------- ① 관제 홈 ---------- */\n  const KIND = { pay: ['결제 실패', 'b-bad'], late: ['승인 지연', 'b-warn'], low: ['재고 임박', 'b-line'], pos: ['POS 지연', 'b-warn'], onb: ['초기 실사', 'b-mute'], out: ['발송 실패', 'b-bad'] };\n  function actionItems() {\n    const t = nowH();\n    const items = [];\n    DB.P.forEach((p) => {\n      const st = S(p.store); if (!st || !inRegion(st.region)) return;\n      const s = pStatus(p);\n      if (s === 'payfail') items.push({ kind: 'pay', sev: 0, p, st, since: p.payFailAt });\n      if ((s === 'sent' || s === 'opened') && p.sentAt != null && (t - p.sentAt) * 60 > 30) items.push({ kind: 'late', sev: 1, p, st, since: p.sentAt, opened: s === 'opened' });\n      if (s === 'created' && p.review) items.push({ kind: 'late', sev: 1.2, p, st, since: p.createdAt, review: true });\n    });\n    DB.stores.forEach((st) => {\n      if (!st.active || !inRegion(st.region)) return;\n      if (!st.onboarded) { items.push({ kind: 'onb', sev: 3, st }); return; }\n      if (st.posDelayAt != null) items.push({ kind: 'pos', sev: 2.5, st, since: st.posDelayAt });\n      if (openOrder(st)) return;\n      let best = null;\n      st.items.forEach((it) => { const h = hoursToTrigger(st, it); if (h <= 10 && (!best || h < best.h)) best = { it, h }; });\n      if (best) {\n        const cooling = st.cooldownUntil && st.cooldownUntil > nowTs();\n        items.push({ kind: 'low', sev: cooling ? 1.5 : 2, st, it: best.it, h: best.h, held: cooling });\n      }\n    });\n    if (DB.outboxFailed) items.push({ kind: 'out', sev: 0.5, st: null });\n    return items.sort((a, b) => a.sev - b.sev || (a.kind === 'low' ? a.h - b.h : (a.since || 0) - (b.since || 0)));\n  }\n  function viewOverview() {\n    const t = nowH(), k = kpis();\n    const all = actionItems();\n    const kinds = ['pay', 'late', 'low', 'pos', 'onb', 'out'];\n    const cnt = { ALL: all.length }; kinds.forEach((x) => { cnt[x] = all.filter((i) => i.kind === x).length; });\n    const items = state.actFilter === 'ALL' ? all : all.filter((x) => x.kind === state.actFilter);\n    const w = can('ops');\n    const rows = items.map((x) => {\n      const st = x.st, rg = st ? REG[st.region] || {} : {};\n      let sku = '', el = '', act = '', go = '';\n      if (x.kind === 'pay') {\n        sku = esc(skuSum(x.p)) + `<span class=\"sub2\">${won(x.p.amount)} · ${esc(x.p.payFailReason || '결제 실패')}</span>`;\n        el = `<span data-since=\"${x.since}\">${durTxt((t - x.since) * 60)}</span><span class=\"sub2\">${hm(x.p.respondAt)} 승인 후 결제 실패</span>`;\n        act = w ? `<button class=\"btn sm bad\" data-act=\"repay\" data-id=\"${x.p.pid}\">${icon('card', 13)}재결제</button>` : '';\n        go = `data-go=\"order:${x.p.pid}\"`;\n      } else if (x.kind === 'late') {\n        sku = esc(skuSum(x.p)) + `<span class=\"sub2\">${won(x.p.amount)}</span>`;\n        if (x.review) {\n          el = `<span style=\"color:var(--sub);font-weight:600\">검수 대기</span><span class=\"sub2\">추정 편차 경보 매장 · ${hm(x.p.createdAt)} 생성</span>`;\n          act = w ? `<button class=\"btn sm\" data-act=\"sendnow\" data-id=\"${x.p.pid}\">${icon('send', 13)}검수 후 발송</button>` : '';\n        } else {\n          el = `<span style=\"color:var(--danger);font-weight:600\" data-since=\"${x.since}\">${durTxt((t - x.since) * 60)}</span><span class=\"sub2\">${hm(x.p.sentAt)} 발송 · ${x.opened ? '열람함' : '미열람'}</span>`;\n          act = w ? (x.p.remindedAt != null ? `<button class=\"btn sm\" data-act=\"call\" data-store=\"${st.idx}\">${icon('phone', 13)}전화</button>` : `<button class=\"btn sm warn\" data-act=\"remind\" data-id=\"${x.p.pid}\">${icon('send', 13)}리마인드</button>`) : '';\n        }\n        go = `data-go=\"order:${x.p.pid}\"`;\n      } else if (x.kind === 'low') {\n        const it = x.it, lo = it.E - it.w;\n        sku = `${esc(it.sku.name)}<span class=\"sub2\">하한 ${box(lo)} / 안전재고 ${box(it.S)}박스${x.held ? ' · <span style=\"color:var(--sub)\">보류·미응답 후 대기</span>' : ''}</span>`;\n        el = x.h === 0 ? `<span style=\"color:var(--danger);font-weight:600\">하한 도달</span><span class=\"sub2\">${x.held ? '재제안 대기 (' + hm(H(st.cooldownUntil)) + ')' : '다음 점검 시 제안'}</span>` : `<span>약 ${Math.max(1, Math.round(x.h))}시간 후</span><span class=\"sub2\">${hm(t + x.h)}경 트리거 예상</span>`;\n        act = w ? (x.held ? `<button class=\"btn sm\" data-act=\"call\" data-store=\"${st.idx}\">${icon('phone', 13)}전화</button>` : `<button class=\"btn sm\" data-act=\"propose\" data-store=\"${st.idx}\">${icon('send', 13)}선제 제안</button>`) : '';\n        go = `data-go=\"inv:${st.idx}:${it.sku.id}\"`;\n      } else if (x.kind === 'pos') {\n        sku = '<span class=\"muted\">—</span>';\n        el = `<span style=\"color:var(--sub);font-weight:600\">${durTxt((t - x.since) * 60)} 무수신</span><span class=\"sub2\">마지막 수신 ${when(x.since)}</span>`;\n        act = '';\n        go = `data-go=\"inv:${st.idx}:\"`;\n      } else if (x.kind === 'onb') {\n        sku = `<span class=\"muted\">취급 ${st.items.length}종</span>`;\n        el = '<span>초기 잔량 입력 전</span><span class=\"sub2\">입력 후 추정·제안 시작</span>';\n        act = w ? `<button class=\"btn sm\" data-act=\"count\" data-store=\"${st.idx}\" data-onb=\"1\">${icon('edit', 13)}잔량 입력</button>` : '';\n        go = `data-go=\"inv:${st.idx}:\"`;\n      } else {\n        return `<tr class=\"click\" data-go=\"admin:integrations\"><td><button class=\"badge b-bad\" data-filter-kind=\"out\">발송 실패</button></td><td colspan=\"3\">알림 메시지 ${DB.outboxFailed}건이 5회 재시도 후 실패했습니다 — 발송 설정(웹훅 URL)을 확인하세요</td><td class=\"r\"><button class=\"btn sm\" data-go=\"admin:integrations\">연동 설정</button></td></tr>`;\n      }\n      return `<tr class=\"click\" ${go}>\n        <td><button class=\"badge ${KIND[x.kind][1]}\" data-filter-kind=\"${x.kind}\" title=\"${KIND[x.kind][0]}만 보기\">${KIND[x.kind][0]}</button></td>\n        <td class=\"act-store\"><b>${esc(st.name)}</b><span class=\"tag\">${esc(rg.name || st.region)}</span><span class=\"sub2\">${esc(st.id)}</span></td>\n        <td>${sku}</td><td>${el}</td><td class=\"r\">${act}</td></tr>`;\n    }).join('');\n    const chips = [['ALL', '전체'], ...kinds.map((x) => [x, KIND[x][0]])].filter(([id]) => id === 'ALL' || cnt[id]).map(([id, nm]) => `<button class=\"chip\" data-act-filter=\"${id}\" aria-pressed=\"${state.actFilter === id}\">${nm} <b>${cnt[id]}</b></button>`).join('');\n    const regRows = REGIONS.filter((r) => inRegion(r.id)).map((r) => {\n      const ss = DB.stops.filter((s) => s.day === 0 && s.region === r.id && s.status !== 'failed');\n      const d = ss.filter((s) => s.status === 'done').length;\n      const cur = ss.some((s) => s.status === 'arrived');\n      const wd = ss.length ? d / ss.length * 100 : 0, pw = cur && ss.length ? 1 / ss.length * 100 : 0;\n      return `<div class=\"reg-row\"><div class=\"nm\">${esc(r.name)}<small>${esc(r.driver)} 기사</small></div>\n        <div><div class=\"bar\" title=\"완료 ${d} / 전체 ${ss.length}\"><i style=\"width:${wd + pw}%\" class=\"part\"></i><i style=\"width:${wd}%\"></i></div></div>\n        <div class=\"v\"><b>${d}</b> / ${ss.length}</div></div>`;\n    }).join('');\n    const tot = DB.stops.filter((s) => s.day === 0 && inRegion(s.region) && s.status !== 'failed');\n    const evs = DB.events.filter((e) => e.t <= t && (e.region_id == null || inRegion(e.region_id))).slice(0, 6);\n    const evHtml = evs.length ? evs.map((e) => `<div class=\"ev ${lastSeenEv != null && e.t > lastSeenEv ? 'new' : ''}\"><time>${hm(e.t)}</time><span class=\"badge nodot ${evTone(e.kind)}\">${esc(e.kind)}</span><span class=\"ev-txt\" title=\"${esc(e.message)}\">${esc(e.message)}</span></div>`).join('') : `<div class=\"empty\">${icon('clock', 22)}최근 이벤트가 없습니다</div>`;\n    if (evs[0]) lastSeenEv = evs[0].t;\n    return `${kpiStrip(k)}\n    <div class=\"ov-grid\">\n      <section class=\"card ov-left\" aria-label=\"지금 조치 필요\">\n        <div class=\"card-h\"><h3>지금 조치 필요 <span class=\"sub\">${all.length}건 · 심각도 순</span></h3><div class=\"chips\">${chips}</div></div>\n        <div class=\"tbl-wrap\" data-sk=\"act\">${items.length ? `<table class=\"tbl\"><thead><tr><th style=\"width:92px\">유형</th><th>매장</th><th>SKU</th><th>경과 · 상태</th><th class=\"r\">조치</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class=\"empty\">${icon('check', 26)}조치가 필요한 항목이 없습니다</div>`}</div>\n      </section>\n      <div class=\"ov-right\">\n        <section class=\"card\" aria-label=\"오늘의 배송 진행률\">\n          <div class=\"card-h\"><h3>오늘의 배송 진행률 <span class=\"sub\">완료 / 전체 정차</span></h3><span class=\"muted\" style=\"font-size:11.5px\">출고 ${hm(DB.settings.dispatch)} · 전체 ${tot.filter((s) => s.status === 'done').length}/${tot.length}</span></div>\n          <div class=\"card-b\" style=\"padding-top:0\">${regRows && tot.length ? regRows : `<div class=\"empty\">오늘 배차된 배송이 없습니다</div>`}</div>\n        </section>\n        ${metricSnap()}\n        <section class=\"card\" style=\"min-height:0;display:flex;flex-direction:column\" aria-label=\"최근 이벤트\">\n          <div class=\"card-h\"><h3>최근 이벤트</h3><span class=\"muted\" style=\"font-size:11.5px\">20초마다 갱신</span></div>\n          <div class=\"card-b\" style=\"padding-top:0;overflow:auto\" data-sk=\"ev\">${evHtml}</div>\n        </section>\n      </div>\n    </div>`;\n  }\n  const evTone = (k) => (/완료|승인|확정|정산/.test(k) ? 'b-ok' : /실패|취소/.test(k) ? 'b-bad' : /보류|미응답|검수/.test(k) ? 'b-warn' : /알림톡|출고|도착/.test(k) ? 'b-line' : 'b-mute');\n  function metricSnap() {\n    const pm = pilotMetrics(), T = DB.settings.targets;\n    const row = (nm, v, target, ok) => `<div class=\"reg-row\" style=\"grid-template-columns:1fr auto auto\"><div class=\"nm\" style=\"font-weight:500\">${nm}</div><div class=\"v\"><b>${v}</b> <span class=\"muted\">${target}</span></div>${ok == null ? '<span class=\"badge b-mute\">표본 부족</span>' : `<span class=\"badge ${ok ? 'b-ok' : 'b-bad'}\">${ok ? '달성' : '미달'}</span>`}</div>`;\n    return `<section class=\"card\" aria-label=\"파일럿 검증 지표\"><div class=\"card-h\"><h3>파일럿 검증 지표 <span class=\"sub\">최근 2주</span></h3><button class=\"btn sm\" data-tab=\"report\">리포트 ${icon('right', 13)}</button></div>\n      <div class=\"card-b\" style=\"padding-top:0\">${row('① 재고 추정 오차', pct(pm.err2), `목표 ≤${T.error}%`, pm.err2 == null ? null : pm.err2 <= T.error)}${row('② 카톡 승인율', pct(pm.appr2), `목표 ≥${T.approval}%`, pm.appr2 == null ? null : pm.appr2 >= T.approval)}${row('③ 평균 정차 시간', pm.stop2 == null ? '—' : num(pm.stop2, 1) + '분', `목표 ≤${T.stop}분`, pm.stop2 == null ? null : pm.stop2 <= T.stop)}</div></section>`;\n  }\n\n  /* ---------- ② 재고 관제 ---------- */\n  const seriesCache = new Map();\n  let seriesLoading = null;\n  async function loadSeries() {\n    const st = S(state.inv.store); if (!st) return;\n    const key = st.idx + '|' + state.inv.sku;\n    const c = seriesCache.get(key);\n    if ((c && c.v === seriesVersion) || seriesLoading === key) return;\n    seriesLoading = key;\n    try {\n      const j = await api('GET', `/api/stores/${st.idx}/series?sku=${encodeURIComponent(state.inv.sku)}&days=14`);\n      seriesCache.set(key, {\n        v: seriesVersion,\n        points: j.points.map((x) => ({ t: H(x.t), E: x.E, w: x.w })),\n        counts: j.counts.map((c) => ({ ...c, t: H(c.t) })),\n        proposals: j.proposals.map((p) => ({ ...p, createdAt: H(p.createdAt), deliverDay: dateIdx(p.deliverDate) })),\n        stops: j.stops.map((s) => ({ ...s, arrive: H(s.arrivedAt ?? s.eta), eta: H(s.eta) })),\n      });\n    } catch (e) { toast(esc(e.message), 'alert'); }\n    seriesLoading = null;\n    if (state.tab === 'inventory' && !state.inv.open) { const c = $('#chartSlot'); if (c) { c.innerHTML = invChartHtml(); bindCharts(); } }\n  }\n  function viewInventory() {\n    const t = nowH();\n    let st = S(state.inv.store);\n    if (!st || !inRegion(st.region)) { st = DB.stores.find((s) => inRegion(s.region) && s.active); if (st) state.inv.store = st.idx; }\n    if (!st) return `<div class=\"empty\">${icon('box', 26)}등록된 매장이 없습니다 — [관리 → 매장]에서 매장을 추가하세요</div>`;\n    let it = st.items.find((x) => x.sku.id === state.inv.sku) || st.items[0];\n    if (it) state.inv.sku = it.sku.id;\n    const rg = REG[st.region] || {};\n    const op = openOrder(st);\n    const lastIn = st.items.map((x) => x.lastIn).filter(Boolean).sort((a, b) => b.t - a.t)[0];\n    const q = state.inv.q.trim();\n    const list = REGIONS.filter((r) => inRegion(r.id)).map((r) => {\n      const ss = DB.stores.filter((s) => s.region === r.id && (!q || s.name.includes(q) || s.id.toLowerCase().includes(q.toLowerCase())));\n      if (!ss.length) return '';\n      return `<div class=\"combo-g\">${esc(r.name)} · ${esc(r.area)}</div>` + ss.map((s) => {\n        const oo = openOrder(s);\n        const badge = !s.active ? '<span class=\"badge b-mute\">비활성</span>' : !s.onboarded ? '<span class=\"badge b-mute\">초기 실사 전</span>' : s.posDelayAt != null ? '<span class=\"badge b-warn\">POS 지연</span>' : oo ? '<span class=\"badge b-mute\">발주 진행</span>' : `<span class=\"badge ${ST_LABEL[storeStatus(s)][1]}\">${ST_LABEL[storeStatus(s)][0]}</span>`;\n        return `<button class=\"combo-o ${s.idx === st.idx ? 'cur' : ''}\" data-pick-store=\"${s.idx}\"><span>${esc(s.name)}</span><span class=\"code\">${esc(s.id)}</span>${badge}</button>`;\n      }).join('');\n    }).join('') || `<div class=\"empty\">검색 결과가 없습니다</div>`;\n    const combo = `<div class=\"combo\">\n        <button class=\"combo-btn\" id=\"storeBtn\" aria-haspopup=\"listbox\" aria-expanded=\"${state.inv.open}\">${icon('pin', 15)}<b>${esc(st.name)}</b><span class=\"muted\">${esc(st.id)} · ${esc(rg.name || '')}</span>${icon('down', 15)}</button>\n        ${state.inv.open ? `<div class=\"combo-pop\" role=\"listbox\"><input id=\"storeQ\" placeholder=\"매장명·코드 검색 (${DB.stores.length}개 매장)\" value=\"${esc(state.inv.q)}\" autocomplete=\"off\"><div class=\"combo-list\" data-sk=\"combo\">${list}</div></div>` : ''}\n      </div>`;\n    const skuSel = st.items.length ? `<select class=\"selbox\" id=\"skuSel\" aria-label=\"SKU 필터\">${st.items.map((x) => `<option value=\"${esc(x.sku.id)}\" ${x === it ? 'selected' : ''}>${esc(x.sku.name)} (${x.sku.pack}입)</option>`).join('')}</select>` : '';\n    const acts = can('ops') ? `<button class=\"btn\" data-act=\"count\" data-store=\"${st.idx}\" ${st.onboarded ? '' : 'data-onb=\"1\"'}>${icon('edit', 14)}${st.onboarded ? '실사 입력' : '초기 잔량 입력'}</button>${!op && st.onboarded ? `<button class=\"btn\" data-act=\"propose\" data-store=\"${st.idx}\">${icon('send', 14)}선제 제안</button>` : ''}` : '';\n    const head = `<div class=\"filters\" role=\"search\"><span class=\"fl\">매장</span>${combo}<span class=\"fl\">SKU</span>${skuSel}${acts}\n      <div class=\"meta-chips\"><span class=\"tag\">${esc(rg.name || '')} · ${esc(rg.hub || '')}</span><span class=\"tag\">${st.type === 'D' ? '저녁 중심' : '점심 중심'}</span><span class=\"tag\">최근 입고 ${lastIn ? when(lastIn.t) : '—'}</span><span class=\"tag\">${op ? '발주 진행 중 · ' + esc(op.id) : '진행 중 발주 없음'}</span></div></div>`;\n    if (!it) return head + `<div class=\"empty\">${icon('box', 26)}이 매장에 취급 SKU가 없습니다 — [관리 → 매장]에서 SKU를 지정하세요</div>`;\n    if (!st.onboarded) return head + `<div class=\"alert-line warn\">${icon('alert', 15)}<span><b>초기 실사 전</b> — 매장의 현재 음료 잔량을 입력하면 그 시점부터 POS 판매로 재고를 추정하고 발주 제안을 시작합니다.</span></div>`;\n\n    const lo = it.E - it.w, stt = itemStatus(st, it);\n    const lc = it.lastCount;\n    const itOrder = op && op.lines.find((l) => l.sku === it.sku.id) ? op : null;\n    const statusLine = stt === 'order'\n      ? `<div class=\"alert-line bad\">${icon('alert', 15)}<span><b>발주 필요</b> — 하한 ${box(lo)} ≤ 안전재고 ${box(it.S)}${itOrder ? `<br><span style=\"color:var(--ink)\">${esc(itOrder.id)} · ${orderPhraseShort(itOrder)}</span>` : ''}</span></div>`\n      : itOrder ? `<div class=\"alert-line ok\">${icon('order', 15)}<span>발주 진행 중 — ${esc(itOrder.id)} · ${orderPhraseShort(itOrder)}</span></div>`\n      : stt === 'warn' ? `<div class=\"alert-line warn\">${icon('clock', 15)}<span>하한이 안전재고에 근접 — ${(() => { const h = hoursToTrigger(st, it); return isFinite(h) ? '약 ' + Math.max(1, Math.round(h)) + '시간 내' : '1일 내'; })()} 트리거 예상</span></div>`\n        : `<div class=\"alert-line ok\">${icon('check', 15)}<span>하한 ${box(lo)}박스 · 안전재고 대비 여유 ${box(lo - it.S)}박스</span></div>`;\n    const why = `<section class=\"card why\" aria-label=\"추정 근거\">\n      <div class=\"card-h\"><h3>추정 근거</h3><span class=\"muted\" style=\"font-size:11px\">실시간</span></div>\n      <div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:9px\">\n        <div><div class=\"muted\" style=\"font-size:11.5px\">${esc(it.sku.name)} 현재 추정</div>\n        <div class=\"why-v\">${box(it.E)} <small>±${num(it.w, 1)}박스</small></div>\n        <div class=\"muted\" style=\"font-size:11.5px\">≈ ${Math.round(Math.max(0, it.E) * it.sku.pack)}${esc(it.sku.unit)} (±${Math.round(it.w * it.sku.pack)}${esc(it.sku.unit)}) · 밴드 ${box(Math.max(0, lo))} ~ ${box(it.E + it.w)}</div></div>\n        ${statusLine}\n        <dl>\n          <dt>판매 속도</dt><dd>일 ${num(it.r, 2)}박스 <span class=\"muted\">${({ pos: 'POS 14일', manual: '수동 입력', default: '기본값' })[it.rateSource]}</span></dd>\n          <dt>POS (7일)</dt><dd>일 ${num(it.pos7, 2)}박스 · ${num(it.pos7 * it.sku.pack, 1)}${esc(it.sku.unit)}</dd>\n          <dt>누수 보정 α</dt><dd>${st.alpha >= 0 ? '+' : ''}${num(st.alpha * 100, 1)}% <span class=\"muted\">서비스·폐기</span></dd>\n          <dt>최근 실사</dt><dd>${lc ? `${md(lc.t)} · 편차 ${lc.T >= lc.E ? '+' : '−'}${num(Math.abs(lc.T - lc.E), 2)}` : '—'}</dd>\n        </dl>\n        <div class=\"note\">추정값이 아닌 <b style=\"color:var(--ink)\">오차 밴드 하한</b>이 안전재고에 닿을 때 제안합니다. 밴드는 실사 후 판매량의 ${num(st.beta * 100, 0)}%씩 넓어지고, 기사가 하차 전 잔량을 확인하면 리셋됩니다.</div>\n      </div></section>`;\n    const counts = { ALL: st.items.length, ok: 0, warn: 0, order: 0 };\n    st.items.forEach((x) => counts[itemStatus(st, x)]++);\n    const scale = Math.max(3, ...st.items.map((y) => y.E + y.w)) * 1.05;\n    const rows = st.items.filter((x) => state.inv.status === 'ALL' || itemStatus(st, x) === state.inv.status).map((x) => {\n      const s2 = itemStatus(st, x), l2 = x.E - x.w;\n      const days = x.E / Math.max(1e-6, x.r * (1 + st.alpha));\n      const ord = op && op.lines.find((l) => l.sku === x.sku.id);\n      const bar = `<span class=\"stock-bar\" aria-hidden=\"true\"><span class=\"band\" style=\"left:${Math.max(0, l2) / scale * 100}%;width:${Math.max(0, Math.min(x.E + x.w, scale) - Math.max(0, l2)) / scale * 100}%\"></span><span class=\"ss\" style=\"left:${x.S / scale * 100}%\"></span><span class=\"pt\" style=\"left:calc(${Math.max(0, x.E) / scale * 100}% - 1px)\"></span></span>`;\n      return `<tr class=\"click ${x === it ? 'sel' : ''}\" data-pick-sku=\"${esc(x.sku.id)}\">\n        <td title=\"${x.sku.pack}입 · ${num(x.sku.price)}원/박스\"><b class=\"strong\">${esc(x.sku.name)}</b> <span class=\"muted\" style=\"font-size:11px\">${x.sku.pack}입</span></td>\n        <td><div class=\"stock-cell\"><span class=\"num\"><b>${box(x.E)}</b> <span class=\"muted\">±${num(x.w, 1)}박스</span></span>${bar}</div></td>\n        <td class=\"r num\">${box(x.S)}</td>\n        <td><button class=\"badge ${ST_LABEL[s2][1]}\" data-badge-sku=\"${esc(x.sku.id)}\" title=\"이 SKU 차트 보기\">${ST_LABEL[s2][0]}</button></td>\n        <td class=\"r num\">${num(x.r, 2)} <span class=\"muted\" style=\"font-size:11px\">${num(x.r * x.sku.pack, 1)}${esc(x.sku.unit)}</span></td>\n        <td class=\"r num\">${days < 30 ? num(days, 1) + '일' : '30일+'} <span class=\"muted\" style=\"font-size:11px\">${days < 30 ? mdw(t + days * 24) : ''}</span></td>\n        <td>${ord ? `<span class=\"badge b-line\">${ord.qty}박스 ${orderPhraseShort(op)}</span>` : x.lastIn ? `<span class=\"muted\">최근 입고 ${md(x.lastIn.t)} +${x.lastIn.q}</span>` : '<span class=\"muted\">—</span>'}</td>\n      </tr>`;\n    }).join('');\n    const sChips = [['ALL', '전체'], ['ok', '정상'], ['warn', '주의'], ['order', '발주필요']].map(([id, nm]) => `<button class=\"chip\" data-inv-status=\"${id}\" aria-pressed=\"${state.inv.status === id}\">${nm} <b>${counts[id]}</b></button>`).join('');\n    const warn = st.posDelayAt != null ? `<div class=\"alert-line warn\">${icon('alert', 15)}<span><b>POS 로그 수신 지연</b> — 마지막 수신 ${hm(st.posDelayAt)} (${durTxt((t - st.posDelayAt) * 60)} 전). 영업 중인데 판매 로그가 들어오지 않습니다. 티오더 연동 상태를 확인하세요.</span></div>` : '';\n    const exc = st.exception ? `<div class=\"alert-line bad\">${icon('alert', 15)}<span><b>추정 편차 경보 매장</b> — 누수 보정 α ${num(st.alpha * 100, 0)}%. 이 매장의 제안은 운영자 검수 후 발송됩니다.</span></div>` : '';\n    return `${head}${warn}${exc}\n      <div class=\"inv-top\">\n        <section class=\"card chart-card\" aria-label=\"재고 추정 차트\">\n          <div class=\"card-h\" style=\"flex-wrap:wrap;row-gap:6px\"><h3>${esc(it.sku.name)} 재고 추정 <span class=\"sub\">최근 14일 + 34시간 예측 · 박스(${it.sku.pack}${esc(it.sku.unit)})</span></h3>\n            <div class=\"legend\"><span><i class=\"lg-line\"></i>추정 재고</span><span><i class=\"lg-band\"></i>오차 밴드(±)</span><span><i class=\"lg-dash\"></i>안전재고</span><span><i class=\"lg-ring\"></i>발주 트리거</span><span><i class=\"lg-sq\"></i>입고</span><span><i class=\"lg-dot\"></i>기사 실사(편차)</span></div></div>\n          <div style=\"padding:0 8px 0 4px\" id=\"chartSlot\">${invChartHtml()}</div>\n        </section>\n        ${why}\n      </div>\n      <section class=\"card\" aria-label=\"SKU별 재고\">\n        <div class=\"card-h\"><h3>SKU별 재고 <span class=\"sub\">${esc(st.name)} · ${st.items.length}종 · 행을 누르면 차트 전환</span></h3><div class=\"chips\">${sChips}</div></div>\n        <div class=\"tbl-wrap\">${rows ? `<table class=\"tbl\"><thead><tr><th>SKU</th><th>추정 재고 (±오차)</th><th class=\"r\">안전재고</th><th>상태</th><th class=\"r\">판매속도 (박스/일)</th><th class=\"r\">예상 소진</th><th>발주·입고</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class=\"empty\">${icon('box', 24)}해당 상태의 SKU가 없습니다</div>`}</div>\n      </section>`;\n  }\n  function orderPhrase(p) {\n    switch (pStatus(p)) {\n      case 'created': return '제안 생성 · ' + (p.review ? '검수 대기' : p.sendAt != null ? '발송 예약 ' + hm(p.sendAt) : '발송 대기');\n      case 'sent': return '알림톡 발송 · 응답 대기';\n      case 'opened': return '열람 · 응답 대기';\n      case 'processing': return '승인 처리 중';\n      case 'payfail': return '승인 · 결제 실패';\n      case 'paid': return '결제 완료 · ' + (p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md(p.deliverDay * 24)) + ' 출고';\n      case 'shipped': return '배송 중 · ' + (p.stop ? hm(p.stop.eta) + ' 도착 예정' : '');\n      case 'unloading': return '하차 중';\n      case 'delivered': return '배송 완료';\n      case 'hold': return '보류';\n      case 'noresp': return '미응답 만료';\n      default: return '취소';\n    }\n  }\n  function orderPhraseShort(p) {\n    switch (pStatus(p)) {\n      case 'created': return '제안 생성';\n      case 'sent': case 'opened': return '승인 대기';\n      case 'payfail': return '결제 실패';\n      case 'paid': return (p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md(p.deliverDay * 24)) + ' 도착 예정';\n      case 'shipped': return p.stop ? hm(p.stop.eta) + ' 도착 예정' : '배송 중';\n      case 'unloading': return '하차 중';\n      case 'delivered': return '배송 완료';\n      default: return '';\n    }\n  }\n\n  // 재고 추정 차트 (인라인 SVG)\n  let CHART = null;\n  function invChartHtml() {\n    const st = S(state.inv.store); if (!st) return '';\n    const it = st.items.find((x) => x.sku.id === state.inv.sku); if (!it) return '';\n    const hist0 = seriesCache.get(st.idx + '|' + it.sku.id);\n    const W = 900, H0 = 312, ml = 40, mr = 78, mt = 34, mb = 28;\n    if (!hist0) return `<svg class=\"chart loading-dim\" viewBox=\"0 0 ${W} ${H0}\" role=\"img\" aria-label=\"불러오는 중\"><text x=\"${W / 2}\" y=\"${H0 / 2}\" text-anchor=\"middle\" font-size=\"12\" fill=\"var(--gray)\">재고 이력을 불러오는 중…</text></svg>`;\n    const now = nowH();\n    const t0 = dayOf(now - 13 * 24) * 24, t1 = now + 34;\n    const hist = hist0.points.filter((p) => p.t >= t0 && p.t <= now);\n    const props = hist0.proposals.map((p) => ({ ...p, stop: DB.byId.get(p.pid)?.stop || null, deliverDay: p.deliverDay }));\n    const liveProps = DB.P.filter((p) => p.store === st.idx);\n    const fc = forecast(st, it, liveProps);\n    const nowPt = { t: now, E: it.E, w: it.w };\n    const all = hist.concat([nowPt], fc.pts);\n    let ymax = Math.max(it.S * 1.6, ...all.map((p) => p.E + p.w)) * 1.08;\n    const stepY = ymax > 12 ? 4 : ymax > 6 ? 2 : ymax > 3 ? 1 : .5;\n    ymax = Math.ceil(ymax / stepY) * stepY;\n    const x = (tt) => ml + (tt - t0) / (t1 - t0) * (W - ml - mr);\n    const y = (v) => mt + (1 - Math.max(0, v) / ymax) * (H0 - mt - mb);\n    const nowX = x(now);\n    const g = [];\n    g.push(`<rect x=\"${nowX}\" y=\"${mt}\" width=\"${W - mr - nowX}\" height=\"${H0 - mt - mb}\" fill=\"var(--ink-t)\"/>`);\n    g.push(`<text x=\"${nowX + 6}\" y=\"${mt + 12}\" font-size=\"10.5\" fill=\"var(--gray)\">예측</text>`);\n    for (let v = 0; v <= ymax + 1e-9; v += stepY) {\n      g.push(`<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(v)}\" y2=\"${y(v)}\" stroke=\"var(--line)\" stroke-width=\"1\"/>`);\n      g.push(`<text x=\"${ml - 8}\" y=\"${y(v) + 3.5}\" font-size=\"10.5\" fill=\"var(--gray)\" text-anchor=\"end\">${num(v, stepY < 1 ? 1 : 0)}</text>`);\n    }\n    for (let d = dayOf(t0); d <= dayOf(t1); d++) {\n      const xx = x(d * 24); if (xx < ml - 1 || xx > W - mr) continue;\n      g.push(`<line x1=\"${xx}\" x2=\"${xx}\" y1=\"${H0 - mb}\" y2=\"${H0 - mb + 4}\" stroke=\"var(--gray)\" stroke-width=\"1\"/>`);\n      const lab = d === 0 ? '오늘' : d === 1 ? '내일' : md(d * 24);\n      if (xx + 12 < W - mr + 20) g.push(`<text x=\"${xx + 2}\" y=\"${H0 - mb + 16}\" font-size=\"10.5\" fill=\"${d === 0 ? 'var(--ink)' : 'var(--gray)'}\" ${d === 0 ? 'font-weight=\"600\"' : ''}>${lab}</text>`);\n    }\n    g.push(`<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${H0 - mb}\" y2=\"${H0 - mb}\" stroke=\"var(--gray)\" stroke-width=\"1\"/>`);\n    const bandPath = (pts) => (pts.length > 1 ? 'M' + pts.map((p) => `${x(p.t).toFixed(1)},${y(p.E + p.w).toFixed(1)}`).join('L') + 'L' + pts.slice().reverse().map((p) => `${x(p.t).toFixed(1)},${y(p.E - p.w).toFixed(1)}`).join('L') + 'Z' : '');\n    const linePath = (pts) => (pts.length > 1 ? 'M' + pts.map((p) => `${x(p.t).toFixed(1)},${y(p.E).toFixed(1)}`).join('L') : '');\n    const histPts = hist.concat([nowPt]);\n    const fcPts = [nowPt].concat(fc.pts);\n    g.push(`<path d=\"${bandPath(histPts)}\" fill=\"var(--main)\" fill-opacity=\".14\"/>`);\n    g.push(`<path d=\"${bandPath(fcPts)}\" fill=\"var(--main)\" fill-opacity=\".08\"/>`);\n    g.push(`<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(it.S)}\" y2=\"${y(it.S)}\" stroke=\"var(--sub)\" stroke-width=\"1.5\" stroke-dasharray=\"5 4\"/>`);\n    g.push(`<text x=\"${W - mr + 6}\" y=\"${y(it.S) + 3.5}\" font-size=\"10.5\" fill=\"var(--sub)\" font-weight=\"600\">안전재고 ${box(it.S)}</text>`);\n    g.push(`<path d=\"${linePath(histPts)}\" fill=\"none\" stroke=\"var(--main)\" stroke-width=\"2\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>`);\n    g.push(`<path d=\"${linePath(fcPts)}\" fill=\"none\" stroke=\"var(--main)\" stroke-width=\"1.6\" stroke-dasharray=\"4 3\" stroke-linejoin=\"round\"/>`);\n    g.push(`<line x1=\"${nowX}\" x2=\"${nowX}\" y1=\"${mt - 8}\" y2=\"${H0 - mb}\" stroke=\"var(--ink)\" stroke-width=\"1\"/>`);\n    g.push(`<text x=\"${nowX}\" y=\"${mt - 12}\" font-size=\"10.5\" fill=\"var(--ink)\" font-weight=\"600\" text-anchor=\"middle\">지금 ${hm(now)}</text>`);\n    g.push(`<circle cx=\"${nowX}\" cy=\"${y(it.E)}\" r=\"4.5\" fill=\"var(--main)\" stroke=\"var(--paper)\" stroke-width=\"2\"/>`);\n    const marks = [];\n    hist0.counts.filter((c) => c.sku === it.sku.id && c.t >= t0).forEach((c) => {\n      const stop = hist0.stops.find((s) => s.sid === c.stop);\n      const pr = stop ? props.find((p) => p.pid === stop.proposal) : null;\n      const q = pr ? (pr.lines.find((l) => l.sku === it.sku.id) || { qty: 0 }).qty : 0;\n      const xx = x(c.t);\n      g.push(`<line x1=\"${xx}\" x2=\"${xx}\" y1=\"${y(c.E)}\" y2=\"${y(c.T)}\" stroke=\"var(--danger)\" stroke-width=\"1.5\"/>`);\n      g.push(`<circle cx=\"${xx}\" cy=\"${y(c.T)}\" r=\"4\" fill=\"var(--paper)\" stroke=\"var(--ink)\" stroke-width=\"1.5\"/>`);\n      if (q) {\n        g.push(`<rect x=\"${xx - 4}\" y=\"${y(c.T + q) - 4}\" width=\"8\" height=\"8\" fill=\"var(--ink)\" stroke=\"var(--paper)\" stroke-width=\"2\"/>`);\n        g.push(`<text x=\"${xx + 7}\" y=\"${y(c.T + q) - 5}\" font-size=\"10.5\" fill=\"var(--ink)\">입고 +${q}</text>`);\n      }\n      marks.push({ t: c.t, text: `${c.source === 'driver' ? '기사' : '운영자'} 실사 ${when(c.t)} — 추정 ${box(c.E)} → 실제 ${box(c.T)}박스${q ? ` · 입고 +${q}` : ''}` });\n    });\n    let lab = 0;\n    props.filter((p) => p.createdAt >= t0).forEach((p) => {\n      const l = p.lines.find((ll) => ll.sku === it.sku.id); if (!l) return;\n      const xx = x(p.createdAt);\n      if (l.trig) {\n        const yy = y(it.S), ly = mt + 4 + (lab++ % 2) * 13;\n        const nearNow = nowX - xx < 110, anchor = nearNow ? 'end' : 'middle', tx = nearNow ? xx - 4 : xx;\n        g.push(`<line x1=\"${xx}\" x2=\"${xx}\" y1=\"${ly - 8}\" y2=\"${yy - 7}\" stroke=\"var(--danger)\" stroke-width=\"1\" stroke-opacity=\".45\"/>`);\n        g.push(`<circle cx=\"${xx}\" cy=\"${yy}\" r=\"6.5\" fill=\"var(--paper)\" fill-opacity=\".6\" stroke=\"var(--danger)\" stroke-width=\"2\"/>`);\n        g.push(`<text x=\"${tx}\" y=\"${ly}\" font-size=\"10.5\" fill=\"var(--danger)\" font-weight=\"600\" text-anchor=\"${anchor}\">${p.reproposal ? '재제안' : p.manual ? '선제 제안' : '트리거'} ${md(p.createdAt)} ${hm(p.createdAt)}</text>`);\n        marks.push({ t: p.createdAt, text: `${p.manual ? '선제 제안' : '발주 트리거'} ${when(p.createdAt)} — 하한 ${box(l.E - l.w)} · 안전재고 ${box(l.S)} · ${p.id} ${l.qty}박스 제안` });\n      } else {\n        g.push(`<path d=\"M${xx},${y(l.E) - 5} l5,5 l-5,5 l-5,-5z\" fill=\"var(--paper)\" stroke=\"var(--danger)\" stroke-width=\"1.5\"/>`);\n        marks.push({ t: p.createdAt, text: `묶음 발주 ${when(p.createdAt)} — ${skuName(p.lines[0].sku)} 트리거에 함께 포함 (${l.qty}박스)` });\n      }\n    });\n    fc.plan.forEach((pl) => {\n      const xx = x(pl.t); if (xx > W - mr) return;\n      const yy = y(pl.E || it.E);\n      g.push(`<rect x=\"${xx - 4}\" y=\"${yy - 4}\" width=\"8\" height=\"8\" fill=\"var(--paper)\" stroke=\"var(--ink)\" stroke-width=\"1.5\"/>`);\n      g.push(`<text x=\"${xx + 7}\" y=\"${yy - 5}\" font-size=\"10.5\" fill=\"var(--ink)\">입고 예정 +${pl.q} (${pl.eta ? hm(pl.t) : dayWord(pl.t) + ' 오후'})</text>`);\n      marks.push({ t: pl.t, text: `입고 예정 ${pl.eta ? when(pl.t) : dayWord(pl.t) + ' 오후'} +${pl.q}박스 · ${pl.p.id}` });\n    });\n    if (fc.trig) {\n      const xx = x(fc.trig.t);\n      g.push(`<circle cx=\"${xx}\" cy=\"${y(it.S)}\" r=\"6.5\" fill=\"none\" stroke=\"var(--danger)\" stroke-width=\"1.5\" stroke-dasharray=\"3 2\"/>`);\n      g.push(`<text x=\"${xx}\" y=\"${y(it.S) + 20}\" font-size=\"10.5\" fill=\"var(--danger)\" text-anchor=\"middle\">예상 트리거 ${dayWord(fc.trig.t)} ${Math.floor(hodOf(fc.trig.t))}시경</text>`);\n      marks.push({ t: fc.trig.t, text: `예상 트리거 ${dayWord(fc.trig.t)} ${Math.floor(hodOf(fc.trig.t))}시경` });\n    }\n    if (!hist.length) g.push(`<text x=\"${(ml + nowX) / 2}\" y=\"${mt + 40}\" font-size=\"11\" fill=\"var(--gray)\" text-anchor=\"middle\">아직 쌓인 이력이 없습니다 (1시간마다 기록)</text>`);\n    g.push(`<line id=\"cx\" x1=\"0\" x2=\"0\" y1=\"${mt}\" y2=\"${H0 - mb}\" stroke=\"var(--ink)\" stroke-width=\"1\" stroke-opacity=\".35\" visibility=\"hidden\"/>`);\n    g.push(`<circle id=\"cxd\" r=\"4\" fill=\"var(--main)\" stroke=\"var(--paper)\" stroke-width=\"2\" visibility=\"hidden\"/>`);\n    g.push(`<rect id=\"hit\" x=\"${ml}\" y=\"${mt}\" width=\"${W - ml - mr}\" height=\"${H0 - mt - mb}\" fill=\"transparent\"/>`);\n    CHART = { W, ml, mr, t0, t1, pts: histPts.concat(fc.pts), x, y, S: it.S, marks };\n    return `<svg class=\"chart\" id=\"invChart\" viewBox=\"0 0 ${W} ${H0}\" role=\"img\" aria-label=\"${esc(it.sku.name)} 최근 14일 재고 추정 추이\">${g.join('')}</svg>`;\n  }\n\n  /* ---------- ③ 발주 관제 ---------- */\n  function stageOf(p) {\n    const s = pStatus(p);\n    if (s === 'created') return 'c';\n    if (s === 'sent' || s === 'opened' || s === 'payfail' || s === 'processing') return 'w';\n    if (s === 'paid') return 'p';\n    if ((s === 'shipped' || s === 'unloading' || s === 'delivered') && p.stop && p.stop.day === 0) return 's';\n    return null;\n  }\n  function orderCard(p) {\n    const t = nowH(), st = S(p.store), s = pStatus(p), rg = REG[st.region] || {};\n    let el = '', tags = [], act = '';\n    const w = can('ops');\n    if (s === 'created') {\n      el = `생성 <span data-since=\"${p.createdAt}\">${durTxt((t - p.createdAt) * 60)}</span> 전`;\n      if (p.manual) tags.push('<span class=\"badge b-line\">선제 제안</span>');\n      if (p.review) tags.push('<span class=\"badge b-warn\">검수 대기</span>');\n      else if (p.sendAt != null) tags.push(`<span class=\"badge b-mute\">발송 예약 ${hm(p.sendAt)}${p.sendRule === 'break' ? ' · 브레이크타임' : p.sendRule === 'night' ? ' · 야간 생성' : ''}</span>`);\n      if (w) act = `<div class=\"act\"><button class=\"btn sm\" data-act=\"sendnow\" data-id=\"${p.pid}\">${icon('send', 13)}${p.review ? '검수 후 발송' : '즉시 발송'}</button></div>`;\n    } else if (s === 'sent' || s === 'opened') {\n      const m = p.sentAt != null ? (t - p.sentAt) * 60 : 0;\n      el = `<span class=\"${m > 30 ? 'el late' : 'el'}\">${icon('clock', 12)}<span data-since=\"${p.sentAt}\">${durTxt(m)}</span></span>`;\n      tags.push(`<span class=\"badge ${s === 'opened' ? 'b-ok' : 'b-mute'}\">${s === 'opened' ? '열람함' : '미열람'}</span>`);\n      if (m > 30) tags.push('<span class=\"badge b-bad\">30분 초과</span>');\n      if (p.reproposal) tags.push('<span class=\"badge b-line nodot\">재제안</span>');\n      if (p.remindedAt != null) tags.push('<span class=\"badge b-line nodot\">리마인드 발송</span>');\n      if (w) act = `<div class=\"act\"><button class=\"btn sm\" data-act=\"copylink\" data-id=\"${p.pid}\">${icon('link', 13)}링크</button><button class=\"btn sm primary\" data-act=\"approve\" data-id=\"${p.pid}\">${icon('check', 13)}대리 승인</button></div>`;\n    } else if (s === 'processing') {\n      el = '<span class=\"el\"><span class=\"spin\"></span> 결제 처리 중</span>';\n    } else if (s === 'payfail') {\n      el = `<span class=\"el late\">${icon('card', 12)}결제 실패</span>`;\n      tags.push(`<span class=\"badge b-bad\">${esc((p.payFailReason || '결제 실패').slice(0, 18))}</span>`, '<span class=\"badge b-ok\">승인 ' + hm(p.respondAt) + '</span>');\n      if (w) act = `<div class=\"act\"><button class=\"btn sm bad\" data-act=\"repay\" data-id=\"${p.pid}\">${icon('card', 13)}재결제</button></div>`;\n    } else if (s === 'paid') {\n      el = `<span class=\"el\">결제 ${hm(p.paidAt)}</span>`;\n      tags.push(`<span class=\"badge b-ok\">${p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md(p.deliverDay * 24)} ${hm(DB.settings.dispatch)} 출고</span>`);\n      if (p.payMethod === 'invoice') tags.push('<span class=\"badge b-mute nodot\">후불 청구</span>');\n      if (p.deliverDay > 0 && p.paidAt != null && hodOf(p.paidAt) >= DB.settings.cutoff) tags.push('<span class=\"badge b-mute nodot\">컷오프 이후 승인</span>');\n    } else {\n      const sp = p.stop;\n      el = s === 'delivered' ? `<span class=\"el\">${icon('check', 12)}${hm(sp.depart)} 완료</span>` : s === 'unloading' ? '<span class=\"el\" style=\"color:var(--sub);font-weight:600\">하차 중</span>' : `<span class=\"el\">ETA ${hm(sp.eta)}</span>`;\n      tags.push(`<span class=\"badge ${s === 'delivered' ? 'b-ok' : s === 'unloading' ? 'b-warn' : 'b-line'}\">${s === 'delivered' ? '배송 완료' : s === 'unloading' ? '하차 중' : '배송 중'}</span>`, `<span class=\"badge b-mute nodot\">${esc(rg.driver || '')} · ${sp.seq}번째</span>`);\n    }\n    if (p.source === 'chat' || p.source === 'web') tags.unshift(`<span class=\"badge b-line nodot\">${p.source === 'chat' ? '카톡 직접 발주' : '화면 직접 발주'}</span>`);\n    return `<div class=\"ocard ${state.ord.sel === p.pid ? 'sel' : ''} ${justMoved === p.pid ? 'arrive' : ''}\" role=\"button\" tabindex=\"0\" data-order=\"${p.pid}\">\n      <div class=\"r1\"><b>${esc(st.name)}</b><span class=\"tag\">${esc(rg.name || st.region)}</span></div>\n      <div class=\"sku\">${esc(skuSum(p))} <span class=\"muted\">· ${boxesOf(p)}박스</span></div>\n      <div class=\"r3\"><span class=\"amt\">${won(p.amount)}</span><span class=\"el\">${el}</span></div>\n      <div class=\"r4\">${tags.join('')}</div>${act}</div>`;\n  }\n  function viewOrders() {\n    const k = kpis();\n    const cols = { c: [], w: [], p: [], s: [] };\n    DB.P.forEach((p) => { const st = S(p.store); if (!st || !inRegion(st.region)) return; const sg = stageOf(p); if (sg) cols[sg].push(p); });\n    cols.c.sort((a, b) => b.createdAt - a.createdAt);\n    cols.w.sort((a, b) => (pStatus(a) === 'payfail') - (pStatus(b) === 'payfail') || (a.sentAt ?? 0) - (b.sentAt ?? 0));\n    cols.p.sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));\n    cols.s.sort((a, b) => (a.stop.status === 'done') - (b.stop.status === 'done') || a.stop.seq - b.stop.seq);\n    const EMPTY = { c: '발송 전 제안이 없습니다', w: '응답을 기다리는 제안이 없습니다', p: `출고 대기 중인 발주가 없습니다`, s: '오늘 출고된 발주가 없습니다' };\n    const col = (id, name, hint) => `<section class=\"col\" aria-label=\"${name}\">\n      <div class=\"col-h\"><h3>${name}</h3><span class=\"n\">${cols[id].length}</span><span class=\"hint\">${hint}</span></div>\n      <div class=\"col-b\" data-sk=\"col-${id}\">${cols[id].length ? cols[id].map(orderCard).join('') : `<div class=\"empty\">${icon(id === 'p' ? 'card' : id === 's' ? 'truck' : 'order', 22)}${EMPTY[id]}</div>`}</div></section>`;\n    const past = hodOf(nowH()) >= DB.settings.cutoff;\n    const html = `<section class=\"kpis\" aria-label=\"발주 KPI\">\n        ${kpiTile('created', '오늘 발주 제안', k.created, '건', `어제 같은 시각 ${k.createdY}건`)}\n        ${kpiTile('approved', '승인 완료', k.approved, '건', `이번 주 승인율 <span class=\"up\">${pct(k.appr7)}</span>`)}\n        ${kpiTile('pending', '승인 대기', k.pending, '건', k.over30 ? `<span class=\"bad\">30분 초과 ${k.over30}건</span>` : '30분 초과 없음')}\n        ${kpiTile('stops', '오늘 출고', k.stops, '건', `배송 완료 ${k.done} · 배송 중 ${k.moving}`)}\n        ${kpiTile('gmv', '오늘 GMV', k.gmv, '원', '결제 완료 기준')}\n        ${kpiTile('payfail', '결제 실패', k.payfail, '건', k.payfail ? '<span class=\"bad\">재결제 필요</span>' : '정상')}\n      </section>\n      <div class=\"cutoff\">\n        <span class=\"pill\">${icon('clock', 14)}당일배송 컷오프 <b>${hm(DB.settings.cutoff)}</b> ${past ? '<span class=\"badge b-mute\">마감</span>' : '<span class=\"badge b-ok\">진행 중</span>'}</span>\n        <span class=\"muted\">${past ? `지금 승인되는 발주는 <b style=\"color:var(--ink)\">다음 배송일 ${hm(DB.settings.dispatch)} 출고</b>` : `${hm(DB.settings.cutoff)} 전 승인 시 오늘 ${hm(DB.settings.dispatch)} 출고`}</span>\n        <span class=\"muted\" style=\"margin-left:auto\">사장님이 전화로 승인하면 [대리 승인] · 카드를 누르면 상세</span>\n      </div>\n      <div class=\"kanban\">${col('c', '제안 생성', '발송 전')}${col('w', '승인 대기', '응답 대기')}${col('p', '결제 완료', '출고 대기')}${col('s', '출고 완료', '오늘 배송')}</div>`;\n    justMoved = null;\n    return html;\n  }\n  function renderDrawer() {\n    const dr = $('#drawer');\n    const p = state.ord.sel && DB.byId.get(state.ord.sel);\n    if (!p || state.tab !== 'orders') { dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); return; }\n    const t = nowH(), st = S(p.store), rg = REG[st.region] || {}, s = pStatus(p);\n    const stepDef = [\n      [p.source !== 'auto' ? '점주 발주' : '제안 생성', p.createdAt, true],\n      ['발송', p.sentAt, p.sentAt != null],\n      ['사장님 승인', p.respondAt, p.response === 'approve' && p.respondAt != null],\n      ['결제', p.paidAt, p.paidAt != null],\n      ['출고', p.shippedAt, p.stop != null],\n      ['도착', p.stop ? (p.stop.arrivedAt ? H(p.stop.arrivedAt) : p.stop.eta) : null, p.stop && ['arrived', 'done'].includes(p.stop.status)],\n    ];\n    const firstTodo = stepDef.findIndex((x) => !x[2]);\n    const steps = stepDef.map((x, i) => `<div class=\"step ${x[2] ? 'done' : ''} ${i === firstTodo ? (s === 'payfail' && i === 3 ? 'fail' : 'now') : ''}\"><span class=\"dot\"></span><b>${x[0]}</b><span>${x[2] && x[1] != null ? hm(x[1]) : i === firstTodo && i === 1 && p.sendAt != null ? '예약 ' + hm(p.sendAt) : i === 5 && p.stop ? 'ETA ' + hm(p.stop.eta) : '—'}</span></div>`).join('');\n    const lines = p.lines.map((l) => `<tr><td>${esc(skuName(l.sku))}${l.trig ? ' <span class=\"badge b-bad nodot\">트리거</span>' : ''}${p.source === 'auto' ? `<span class=\"sub2\">제안 시 추정 ${box(l.E)} ±${num(l.w, 1)} · 안전 ${box(l.S)}</span>` : ''}</td><td class=\"r num\">${l.qty}${l.qtyOrig !== l.qty ? ` <span class=\"muted\">(제안 ${l.qtyOrig})</span>` : ''}</td><td class=\"r num\">${won(l.qty * l.price)}</td></tr>`).join('');\n    const msgs = DB.messages.filter((m) => m.proposal_id === p.pid).slice().sort((a, b) => a.t - b.t);\n    const KINDN = { propose: '발주 제안', remind: '리마인드', confirm: '발주 확정 안내', payfail: '결제 실패 안내', hold_ack: '보류 안내', expire: '만료 안내', delivered: '배송 완료 안내', delivery_failed: '배송 실패 안내' };\n    const logHtml = [[p.createdAt, p.source !== 'auto' ? `점주 직접 발주 — ${p.source === 'chat' ? '카카오톡 채널 챗봇' : '모바일 발주 화면'}` : `제안 생성 — ${skuName(p.lines[0]?.sku)} 하한 도달${p.reproposal ? ' (재제안)' : ''}${p.manual ? ' (선제 제안: ' + esc(p.createdBy) + ')' : ''}`], ...(p.openAt != null ? [[p.openAt, '사장님 열람']] : []),\n      ...(p.respondAt != null ? [[p.respondAt, `${p.response === 'approve' ? (p.modify ? '수량 수정 승인' : '승인') : '보류'} — ${String(p.responder || '').startsWith('ops:') ? '운영자 대리 (' + esc(p.responder.slice(4)) + ')' : '사장님'}`]] : []),\n      ...msgs.map((m) => [m.t, `${KINDN[m.kind] || m.kind} 메시지 ${m.status === 'sent' ? '발송' : m.status === 'failed' ? '<span style=\"color:var(--danger)\">발송 실패</span>' : '대기'}${m.error ? ' · ' + esc(m.error) : ''}`])]\n      .sort((a, b) => a[0] - b[0]).map((l) => `<div class=\"log-row\"><time>${hm(l[0])}</time><span>${l[1]}${dayOf(l[0]) !== 0 ? ` <span class=\"muted\">(${dayWord(l[0])})</span>` : ''}</span></div>`).join('');\n    const pay = s === 'payfail' ? `<span style=\"color:var(--danger);font-weight:600\">결제 실패</span> · ${esc(p.payFailReason || '')} · ${hm(p.payFailAt)}` : p.paidAt != null ? `${p.payMethod === 'invoice' ? '후불 청구 확정' : '카드 결제 완료'} · ${when(p.paidAt)}<span class=\"sub2\">${esc(p.payRef || '')}</span>` : '승인 후 처리';\n    const eta = p.stop ? `${when(p.stop.eta)} <span class=\"muted\">(${esc(rg.driver || '')} 기사 · ${p.stop.seq}번째 정차)</span>` : p.paidAt != null ? `${p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md((p.deliverDay || 0) * 24)} ${hm(DB.settings.dispatch)} 출고 → 오후 도착` : hodOf(t) >= DB.settings.cutoff ? '지금 승인 시 다음 배송일 오후 도착' : `${hm(DB.settings.cutoff)} 전 승인 시 오늘 오후 도착`;\n    const w = can('ops');\n    let foot = '';\n    if (w && (s === 'sent' || s === 'opened')) foot = `<button class=\"btn\" data-act=\"hold\" data-id=\"${p.pid}\">보류 처리</button><button class=\"btn warn\" data-act=\"remind\" data-id=\"${p.pid}\" ${p.remindedAt != null ? 'disabled' : ''}>${icon('send', 13)}${p.remindedAt != null ? '리마인드 발송됨' : '리마인드'}</button><button class=\"btn primary\" data-act=\"approve\" data-id=\"${p.pid}\">${icon('check', 13)}대리 승인</button>`;\n    else if (w && s === 'payfail') foot = `<button class=\"btn\" data-act=\"cancel\" data-id=\"${p.pid}\">취소</button><button class=\"btn bad\" data-act=\"repay\" data-id=\"${p.pid}\">${icon('card', 13)}재결제</button>`;\n    else if (w && s === 'created') foot = `<button class=\"btn\" data-act=\"cancel\" data-id=\"${p.pid}\">제안 취소</button><button class=\"btn primary\" data-act=\"sendnow\" data-id=\"${p.pid}\">${icon('send', 13)}${p.review ? '검수 후 발송' : '즉시 발송'}</button>`;\n    else if (w && s === 'paid') foot = `<button class=\"btn\" data-act=\"cancel\" data-id=\"${p.pid}\">발주 취소</button>`;\n    const linkBtn = w ? `<button class=\"btn sm\" data-act=\"copylink\" data-id=\"${p.pid}\">${icon('link', 13)}사장님 링크·메시지</button>` : '';\n    dr.innerHTML = `<div class=\"drawer-h\"><div><div class=\"muted\" style=\"font-size:11.5px\">${esc(p.id)} · ${esc(rg.name || '')} · ${esc(st.id)}</div><h2 style=\"font-size:17px;margin-top:2px\">${esc(st.name)}</h2>\n        <div class=\"hstack\" style=\"margin-top:6px\"><span class=\"badge ${({ created: 'b-mute', sent: 'b-warn', opened: 'b-warn', payfail: 'b-bad', paid: 'b-ok', shipped: 'b-line', unloading: 'b-warn', delivered: 'b-ok', hold: 'b-warn', noresp: 'b-warn' })[s] || 'b-mute'}\">${esc(orderPhrase(p))}</span>${linkBtn}</div></div>\n        <button class=\"xbtn\" data-close-drawer aria-label=\"닫기\">${icon('x', 18)}</button></div>\n      <div class=\"drawer-b\">\n        <div class=\"steps\">${steps}</div>\n        <div><div class=\"sec-h\">발주 품목</div><table class=\"tbl\"><thead><tr><th>SKU</th><th class=\"r\">수량(박스)</th><th class=\"r\">금액</th></tr></thead><tbody>${lines}</tbody><tfoot><tr><td>합계 · ${boxesOf(p)}박스</td><td></td><td class=\"r\">${won(p.amount)}</td></tr></tfoot></table></div>\n        <dl class=\"kv\"><dt>결제</dt><dd>${pay}</dd><dt>사장님</dt><dd>${esc(st.owner || '')} ${st.phone ? `<span class=\"code\">${esc(st.phone)}</span>` : '<span class=\"muted\">연락처 없음</span>'}</dd><dt>예상 도착</dt><dd>${eta}</dd></dl>\n        <div><div class=\"sec-h\">처리 기록</div><div class=\"log\">${logHtml}</div></div>\n      </div>\n      ${foot ? `<div class=\"drawer-f\">${foot}</div>` : ''}`;\n    dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false');\n  }\n\n  /* ---------- ④ 알림톡 모니터 ---------- */\n  const NT_ST = { created: ['예약', 'b-mute'], sent: ['발송', 'b-line'], opened: ['열람', 'b-warn'], approve: ['승인', 'b-ok'], hold: ['보류', 'b-warn'], noresp: ['미응답', 'b-bad'] };\n  function ntStatus(p) {\n    const s = pStatus(p);\n    if (s === 'created') return 'created';\n    if (s === 'sent' || s === 'opened') return s;\n    if (s === 'hold') return 'hold';\n    if (s === 'noresp') return 'noresp';\n    if (s === 'cancelled') return p.response === 'approve' ? 'approve' : 'noresp';\n    return 'approve';\n  }\n  function viewNotify() {\n    const t = nowH();\n    const day = state.noti.day;\n    const base = DB.P.filter((p) => { const st = S(p.store); return st && inRegion(st.region) && (p.sentAt != null || p.sendAt != null); });\n    const sentAtOf = (p) => (p.sentAt != null ? p.sentAt : p.sendAt);\n    const today = base.filter((p) => p.sentAt != null && dayOf(p.sentAt) === 0);\n    const opened = today.filter((p) => p.openAt != null).length;\n    const decided = today.filter((p) => ['approve', 'hold', 'noresp'].includes(ntStatus(p)));\n    const appr = decided.filter((p) => ntStatus(p) === 'approve').length;\n    const resp = today.filter((p) => p.respondAt != null && p.sentAt != null);\n    const avgResp = resp.length ? resp.reduce((a, p) => a + (p.respondAt - p.sentAt) * 60, 0) / resp.length : null;\n    const k = kpis();\n    const kp = `<section class=\"kpis k4\" aria-label=\"알림톡 KPI\">\n      ${kpiTile('nt-sent', '오늘 발송 건수', today.length, '건', `어제 ${base.filter((p) => p.sentAt != null && dayOf(p.sentAt) === -1).length}건 · 발송 예약 ${base.filter((p) => p.sentAt == null && p.sendAt != null && p.status === 'created').length}건`)}\n      ${kpiTile('nt-open', '열람률', today.length ? opened / today.length * 100 : null, '', `${opened}/${today.length}건 열람`, { dec: 1, u: '%' })}\n      ${kpiTile('nt-appr', '승인율 (이번 주)', k.appr7, '', `오늘 응답 ${decided.length}건 중 승인 ${appr}건 · 목표 ${DB.settings.targets.approval}%`, { dec: 1, u: '%' })}\n      ${kpiTile('nt-resp', '평균 응답 시간', avgResp, '분', `오늘 응답 ${resp.length}건 기준`, { dec: 0 })}\n    </section>`;\n    const list = base.filter((p) => dayOf(sentAtOf(p)) === day).sort((a, b) => sentAtOf(b) - sentAtOf(a));\n    const counts = { ALL: list.length }; Object.keys(NT_ST).forEach((key) => { counts[key] = list.filter((p) => ntStatus(p) === key).length; });\n    const shown = list.filter((p) => state.noti.filter === 'ALL' || ntStatus(p) === state.noti.filter);\n    if (!state.noti.sel || !DB.byId.get(state.noti.sel)) state.noti.sel = (shown[0] || list[0] || {}).pid || null;\n    const rows = shown.map((p) => {\n      const st = S(p.store), s = ntStatus(p);\n      const failed = DB.messages.some((m) => m.proposal_id === p.pid && m.kind === 'propose' && m.status === 'failed');\n      return `<tr class=\"click ${state.noti.sel === p.pid ? 'sel' : ''}\" data-noti=\"${p.pid}\">\n        <td class=\"num\">${hm(sentAtOf(p))}<span class=\"sub2\">${s === 'created' ? '예약' : p.respondAt != null ? '응답 ' + hm(p.respondAt) : ''}</span></td>\n        <td><b class=\"strong\">${esc(st.name)}</b><span class=\"sub2\">${esc((REG[st.region] || {}).name || '')} · ${esc(skuSum(p))}</span></td>\n        <td><button class=\"badge ${NT_ST[s][1]}\" data-noti-filter=\"${s}\" title=\"${NT_ST[s][0]}만 보기\">${NT_ST[s][0]}</button>${failed ? '<span class=\"sub2\" style=\"color:var(--danger)\">발송 실패</span>' : pStatus(p) === 'payfail' ? '<span class=\"sub2\" style=\"color:var(--danger)\">결제 실패</span>' : ''}</td>\n      </tr>`;\n    }).join('');\n    const chips = [['ALL', '전체'], ...Object.entries(NT_ST).map(([key, v]) => [key, v[0]])].filter(([key]) => key === 'ALL' || counts[key]).map(([key, nm]) => `<button class=\"chip\" data-noti-filter=\"${key}\" aria-pressed=\"${state.noti.filter === key}\">${nm} <b>${counts[key]}</b></button>`).join('');\n    const sel = DB.byId.get(state.noti.sel);\n    return `${kp}\n      <div class=\"nt-grid\">\n        <section class=\"card nt-list\" aria-label=\"발송 이력\">\n          <div class=\"card-h\"><h3>발송 이력</h3><div class=\"seg\"><button data-noti-day=\"0\" aria-pressed=\"${day === 0}\">오늘</button><button data-noti-day=\"-1\" aria-pressed=\"${day === -1}\">어제</button><button data-noti-day=\"-2\" aria-pressed=\"${day === -2}\">그제</button></div></div>\n          <div class=\"card-b\" style=\"padding-bottom:8px\"><div class=\"chips\">${chips}</div></div>\n          <div class=\"tbl-wrap\" data-sk=\"noti\">${rows ? `<table class=\"tbl\"><thead><tr><th>시각</th><th>매장 · 제안</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class=\"empty\">${icon('chat', 24)}해당 날짜의 발송 이력이 없습니다</div>`}</div>\n        </section>\n        <div class=\"phone-wrap\">${sel ? phone(sel) : `<div class=\"empty\">발송 이력을 선택하세요</div>`}</div>\n        <div class=\"nt-meta\">${sel ? ntMeta(sel) : ''}</div>\n      </div>`;\n  }\n  function phone(sel) {\n    const t = nowH(), st = S(sel.store);\n    const msgs = DB.messages.filter((m) => m.store_id === sel.store).map((m) => ({ t: m.t, k: m.kind === 'propose' ? 'alim' : 'bot', m }));\n    DB.P.filter((p) => p.store === sel.store && p.respondAt != null).forEach((p) => msgs.push({ t: p.respondAt, k: 'me', text: p.response === 'approve' ? (p.modify ? '수량 수정 후 승인' : '승인') : '보류', ops: String(p.responder || '').startsWith('ops:') }));\n    msgs.sort((a, b) => a.t - b.t || (a.k === 'me' ? -1 : 1));\n    let lastDay = null;\n    const body = msgs.length ? msgs.map((x) => {\n      let h = '';\n      if (dayOf(x.t) !== lastDay) { lastDay = dayOf(x.t); h += `<div class=\"ph-day\">${mdw(x.t)}${lastDay === 0 ? ' · 오늘' : lastDay === -1 ? ' · 어제' : ''}</div>`; }\n      const tm = `<time>${hm(x.t)}</time>`;\n      const stTag = x.m && x.m.status !== 'sent' ? ` <span style=\"color:${x.m.status === 'failed' ? 'var(--danger)' : 'var(--gray)'}\">(${x.m.status === 'failed' ? '발송 실패' : '발송 대기'})</span>` : '';\n      if (x.k === 'alim') {\n        const text = x.m.body.replace(/▶[^\\n]*$/m, '').trim();\n        h += `<div class=\"msg\"><div class=\"alim\"><div class=\"alim-h\">발주 제안<span>알림톡${stTag}</span></div><div class=\"alim-b\">${esc(text)}</div><div class=\"alim-btns\"><button disabled>발주 확인하기</button></div></div>${tm}</div>`;\n      } else if (x.k === 'me') h += `<div class=\"msg me\"><div class=\"bub\">${esc(x.text)}${x.ops ? '<br><small style=\"opacity:.8\">운영자 대리 처리</small>' : ''}</div>${tm}</div>`;\n      else h += `<div class=\"msg\"><div class=\"bub\">${esc(x.m.body.replace(/▶[^\\n]*$/m, '').trim())}${stTag}</div>${tm}</div>`;\n      return h;\n    }).join('') : `<div class=\"ph-day\">${sel.sendAt != null ? hm(sel.sendAt) + ' 발송 예약 — 아직 발송 전입니다' : '검수 후 발송 대기 중입니다'}</div>`;\n    return `<div class=\"phone\" aria-label=\"알림톡 대화 미리보기\">\n      <div class=\"ph-status\"><span>${hm(t)}</span><span class=\"sig\">${icon('signal', 14)}${icon('wifi', 14)}${icon('batt', 16)}</span></div>\n      <div class=\"ph-head\"><span class=\"pf\">B</span><div><b>BevFlow 발주알림</b><small>${esc(st.name)} 사장님 화면 미리보기</small></div></div>\n      <div class=\"ph-body\" id=\"phBody\">${body}</div></div>`;\n  }\n  function ntMeta(p) {\n    const st = S(p.store);\n    const perf = DB.pilot.storePerf.find((x) => x.store === p.store);\n    const m = DB.messages.filter((x) => x.proposal_id === p.pid && x.kind === 'propose')[0];\n    return `<section class=\"card\"><div class=\"card-h\"><h3>메시지 정보</h3></div><div class=\"card-b\"><dl class=\"kv\" style=\"grid-template-columns:78px 1fr\">\n        <dt>발주번호</dt><dd>${esc(p.id)}</dd><dt>템플릿</dt><dd>${esc(m ? m.template : 'BF_PROPOSE_03')}</dd>\n        <dt>발송</dt><dd>${p.sentAt != null ? when(p.sentAt) : p.sendAt != null ? '예약 ' + when(p.sendAt) : '검수 대기'}${p.sendRule === 'break' ? '<span class=\"sub2\">브레이크타임 예약</span>' : p.sendRule === 'night' ? '<span class=\"sub2\">야간 생성 → 아침 발송</span>' : ''}</dd>\n        <dt>열람</dt><dd>${p.openAt != null ? when(p.openAt) : '—'}</dd>\n        <dt>응답</dt><dd>${p.respondAt != null ? when(p.respondAt) + (p.sentAt != null ? `<span class=\"sub2\">발송 후 ${durTxt((p.respondAt - p.sentAt) * 60)}</span>` : '') : pStatus(p) === 'noresp' ? '미응답 (만료)' : '대기 중'}</dd>\n        <dt>수신 번호</dt><dd>${m ? esc(m.to_phone || '—') : esc(st.phone || '—')}</dd>\n        <dt>채널</dt><dd>${m ? (m.channel === 'console' ? '콘솔 기록 (수동 전달)' : '웹훅 발송') : '—'}${m && m.status !== 'sent' ? ` · ${m.status === 'failed' ? '실패' : '대기'}` : ''}</dd></dl>\n        ${can('ops') ? `<div class=\"hstack\" style=\"margin-top:10px;flex-wrap:wrap\"><button class=\"btn sm\" data-act=\"copylink\" data-id=\"${p.pid}\">${icon('copy', 13)}메시지·링크 복사</button><button class=\"btn sm\" data-act=\"preview\" data-id=\"${p.pid}\">${icon('link', 13)}사장님 화면 열기</button></div>` : ''}</div></section>\n      <section class=\"card\"><div class=\"card-h\"><h3>매장 응답 패턴</h3></div><div class=\"card-b\"><dl class=\"kv\" style=\"grid-template-columns:78px 1fr\">\n        <dt>파일럿 승인</dt><dd>${perf ? `${perf.approved}/${perf.decided}건 · ${pct(perf.approved / Math.max(1, perf.decided) * 100, 0)}` : '—'}</dd>\n        <dt>응답 중앙값</dt><dd>${perf && perf.medResp != null ? Math.round(perf.medResp) + '분' : '—'}</dd>\n        <dt>발송 방식</dt><dd>${st.breakPref ? '브레이크타임(15:00) 예약' : '즉시 발송'}</dd></dl></div></section>\n      <p class=\"muted\" style=\"font-size:11px;margin:0;line-height:1.6\">${DB.settings.notifier === 'console' ? '현재 <b>콘솔 모드</b>입니다. 메시지는 외부로 나가지 않으니 [메시지·링크 복사]로 사장님 카카오톡에 전달하세요. 알림톡 대행사를 연결하면 자동 발송됩니다.' : '웹훅으로 알림톡 대행사에 전달됩니다.'}</p>`;\n  }\n\n  /* ---------- ⑤ 배송 관제 ---------- */\n  function viewDelivery() {\n    const t = nowH();\n    const today = DB.stops.filter((s) => s.day === 0 && s.status !== 'failed');\n    const pm = pilotMetrics();\n    const cap = DB.settings.driverCapacity;\n    const days13 = DB.stops.filter((s) => s.day >= -13 && s.day <= -1 && s.status !== 'failed').length / 13;\n    const w = can('ops');\n    const drivers = REGIONS.map((r) => {\n      const ss = today.filter((s) => s.region === r.id).sort((a, b) => a.seq - b.seq);\n      const done = ss.filter((s) => s.status === 'done');\n      const cur = ss.find((s) => s.status === 'arrived');\n      const next = ss.find((s) => s.status === 'pending');\n      const avg = done.filter((s) => s.dur != null).length ? done.filter((s) => s.dur != null).reduce((a, s) => a + s.dur, 0) / done.filter((s) => s.dur != null).length : null;\n      const wd = ss.length ? done.length / ss.length * 100 : 0;\n      const route = DB.routes.find((x) => dateIdx(x.date) === 0 && x.region_id === r.id);\n      const nowTxt = cur ? `<span class=\"badge b-warn\">하차 중</span>${esc(S(cur.store).name)}<span class=\"muted\">${Math.round((t - cur.arrive) * 60)}분째</span>`\n        : next ? `<span class=\"badge b-line\">다음</span>→ ${esc(S(next.store).name)}<span class=\"muted\">ETA ${hm(next.eta)}</span>`\n          : ss.length ? `<span class=\"badge b-ok\">완료</span>오늘 배송 완료<span class=\"muted\">${hm(ss[ss.length - 1].depart)}</span>` : '<span class=\"badge b-mute\">대기</span>오늘 배정 없음';\n      return `<section class=\"card drv\" style=\"${inRegion(r.id) ? '' : 'opacity:.45'}\">\n        <div class=\"drv-h\">${icon('truck', 16)}<b>${esc(r.driver)} 기사</b><span class=\"muted\" style=\"font-size:11.5px\">${esc(r.name)}</span>${route && w ? `<button class=\"btn sm\" data-act=\"driverlink\" data-route=\"${route.id}\" style=\"margin-left:auto\">${icon('link', 13)}기사 링크</button>` : `<span class=\"tag\">${esc((r.vehicle || '').split(' · ')[1] || r.vehicle || '')}</span>`}</div>\n        <div class=\"drv-n\"><div>완료 정차<b>${done.length}<small>/ ${ss.length}</small></b></div><div>평균 정차<b>${avg != null ? num(avg, 1) : '—'}<small>분</small></b></div><div>일 용량 대비<b>${num(ss.length / cap * 100, 0)}<small>% · ${cap}곳</small></b></div></div>\n        <div class=\"bar\" style=\"height:7px\"><i style=\"width:${wd}%\"></i></div>\n        <div class=\"drv-now\">${nowTxt}</div></section>`;\n    }).join('');\n    const scope = state.del.scope;\n    const durs = scope === '2w' ? DB.stops.filter((s) => s.status === 'done' && s.dur != null && s.day >= -13).map((s) => s.dur) : null;\n    const bins = []; for (let b = 3; b <= 12; b++) bins.push({ lo: b, n: 0 });\n    if (durs) durs.forEach((d) => { bins[Math.max(0, Math.min(9, Math.floor(d) - 3))].n++; });\n    else DB.pilot.hist.forEach((h) => { bins[Math.max(0, Math.min(9, h.b - 3))].n += h.c; });\n    const total = bins.reduce((a, b) => a + b.n, 0);\n    const mean = durs ? (durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null) : (() => { const all = pm.weeks.reduce((a, x) => a + x.stopSum, 0), n = pm.weeks.reduce((a, x) => a + x.stops, 0); return n ? all / n : null; })();\n    const sorted = durs ? durs.slice().sort((a, b) => a - b) : [];\n    const stopRows = DB.stops.filter((s) => s.day === 0 && inRegion(s.region)).sort((a, b) => a.region.localeCompare(b.region) || a.seq - b.seq).map((s) => {\n      const st = S(s.store);\n      const label = { pending: ['대기', 'b-mute'], arrived: ['하차 중', 'b-warn'], done: ['완료', 'b-ok'], failed: ['실패', 'b-bad'] }[s.status];\n      const acts = !w ? '' : s.status === 'pending' ? `<button class=\"btn sm\" data-act=\"stoparrive\" data-id=\"${s.sid}\">도착</button> <button class=\"btn sm\" data-act=\"stopdone\" data-id=\"${s.sid}\">하차 완료</button> <button class=\"btn sm bad\" data-act=\"stopfail\" data-id=\"${s.sid}\">실패</button>`\n        : s.status === 'arrived' ? `<button class=\"btn sm primary\" data-act=\"stopdone\" data-id=\"${s.sid}\">하차 완료</button> <button class=\"btn sm bad\" data-act=\"stopfail\" data-id=\"${s.sid}\">실패</button>` : '';\n      return `<tr><td>${esc((REG[s.region] || {}).name || s.region)} · ${s.seq}</td><td><b class=\"strong\">${esc(st ? st.name : '')}</b><span class=\"sub2\">${esc(st ? st.address || '' : '')}</span></td><td class=\"num\">${hm(s.eta)}</td><td class=\"r num\">${s.boxes}</td><td><span class=\"badge ${label[1]}\">${label[0]}</span>${s.failReason ? `<span class=\"sub2\">${esc(s.failReason)}</span>` : ''}</td><td class=\"num\">${s.dur != null ? num(s.dur, 1) + '분' : '—'}</td><td class=\"r\">${acts}</td></tr>`;\n    }).join('');\n    const pendingPaid = DB.P.filter((p) => p.status === 'paid' && p.deliverDay != null && p.deliverDay <= 0).length;\n    return `<div class=\"cutoff\">\n        <span class=\"pill\">${icon('clock', 14)}<b>${hm(DB.settings.cutoff)} 이전 승인 → 당일 도착</b></span><span class=\"pill\"><b>이후 승인 → 다음 배송일 오후</b></span>\n        <span class=\"muted\">출고·배차 ${hm(DB.settings.dispatch)} (자동) · 오늘 ${today.length}곳 (${REGIONS.map((r) => esc(r.name) + ' ' + today.filter((s) => s.region === r.id).length).join(' · ')})</span>\n        ${w ? `<button class=\"btn sm\" data-act=\"dispatch\" style=\"margin-left:auto\" ${pendingPaid ? '' : 'title=\"배차 대기 발주 없음\"'}>${icon('truck', 13)}지금 배차 실행${pendingPaid ? ` (${pendingPaid}건)` : ''}</button>` : ''}</div>\n      <div class=\"dl-grid\">\n        <section class=\"card\" aria-label=\"권역 라우트 뷰\">\n          <div class=\"card-h\"><h3>권역 라우트 <span class=\"sub\">거점 중심 · 번호는 방문 순서</span></h3>\n            <div class=\"legend\"><span><i class=\"lg-dot\" style=\"background:var(--main);border-color:var(--main)\"></i>배송 완료</span><span><i class=\"lg-dot\" style=\"background:var(--sub);border-color:var(--sub)\"></i>진행 중</span><span><i class=\"lg-dot\" style=\"background:var(--gray);border-color:var(--gray)\"></i>대기</span><span><i class=\"lg-dot\" style=\"width:6px;height:6px;border-color:var(--gray)\"></i>오늘 배송 없음</span></div></div>\n          <div style=\"padding:0 10px 8px\">${REGIONS.length ? routeMap(t) : '<div class=\"empty\">권역이 없습니다</div>'}</div>\n        </section>\n        <div style=\"display:flex;flex-direction:column;gap:10px\">${drivers || '<div class=\"empty\">기사가 없습니다</div>'}</div>\n      </div>\n      <section class=\"card\" aria-label=\"오늘 정차 목록\"><div class=\"card-h\"><h3>오늘 정차 목록 <span class=\"sub\">기사가 휴대폰을 못 쓸 때 운영자가 대신 처리</span></h3></div>\n        <div class=\"tbl-wrap\">${stopRows ? `<table class=\"tbl\"><thead><tr><th>권역·순서</th><th>매장</th><th>ETA</th><th class=\"r\">박스</th><th>상태</th><th>정차</th><th class=\"r\">조치</th></tr></thead><tbody>${stopRows}</tbody></table>` : `<div class=\"empty\">${icon('truck', 22)}오늘 배차된 정차가 없습니다</div>`}</div></section>\n      <div class=\"dl-bottom\">\n        <section class=\"card\" aria-label=\"정차 시간 분포\">\n          <div class=\"card-h\"><h3>정차 시간 분포 <span class=\"sub\">검증 지표 ③ · 도착~하차·잔량 확인 완료</span></h3>\n            <div class=\"seg\"><button data-del-scope=\"2w\" aria-pressed=\"${scope === '2w'}\">최근 2주</button><button data-del-scope=\"all\" aria-pressed=\"${scope === 'all'}\">파일럿 전체</button></div></div>\n          <div class=\"card-b\" style=\"display:grid;grid-template-columns:minmax(0,1fr) 168px;gap:14px;align-items:center\">\n            <div>${total ? histogram(bins, mean) : '<div class=\"empty\">완료된 정차가 없습니다</div>'}</div>\n            <dl class=\"kv\" style=\"grid-template-columns:auto 1fr;font-size:12px;white-space:nowrap\"><dt>정차 수</dt><dd class=\"num\">${num(total)}회</dd><dt>평균</dt><dd class=\"num\"><b>${mean != null ? num(mean, 1) + '분' : '—'}</b></dd>${durs ? `<dt>중앙값</dt><dd class=\"num\">${sorted.length ? num(sorted[Math.floor(sorted.length / 2)], 1) + '분' : '—'}</dd><dt>P90</dt><dd class=\"num\">${sorted.length ? num(sorted[Math.floor(sorted.length * .9)], 1) + '분' : '—'}</dd><dt>7분 이내</dt><dd class=\"num\">${sorted.length ? pct(sorted.filter((d) => d <= 7).length / sorted.length * 100, 0) : '—'}</dd>` : ''}<dt>목표</dt><dd>평균 ≤ ${DB.settings.targets.stop}분 ${mean != null ? `<span class=\"badge ${mean <= DB.settings.targets.stop ? 'b-ok' : 'b-bad'}\">${mean <= DB.settings.targets.stop ? '달성' : '미달'}</span>` : ''}</dd></dl>\n          </div>\n        </section>\n        <section class=\"card cap\" aria-label=\"배송 용량\">\n          <div class=\"card-h\"><h3>배송 용량 <span class=\"sub\">설계 대비</span></h3></div>\n          <div class=\"card-b\">\n            <dl><dt>설계 용량 (1인 1일)</dt><dd>${cap}곳</dd><dt>최근 2주 일 평균 정차 (전체)</dt><dd>${num(days13, 1)}곳</dd><dt>정차당 평균 하차</dt><dd>${num(pm.avgBoxes, 1)}박스</dd><dt>현재 가동률 (${REGIONS.length}명 기준)</dt><dd>${pct(days13 / Math.max(1, cap * REGIONS.length) * 100)}</dd></dl>\n            <div class=\"formula\">정차 ${pm.stop2 != null ? num(pm.stop2, 1) : '—'}분 × ${cap}곳 ≈ ${pm.stop2 != null ? num(pm.stop2 * cap / 60, 1) : '—'}시간 (+ 권역 내 이동)<br>현 인력 수용 한도 (주 1회 배송)<br>${REGIONS.length}명 × ${cap}곳 × 주 ${DB.settings.deliveryDays.length}일 ≈ <b>${num(REGIONS.length * cap * DB.settings.deliveryDays.length)}개 매장</b></div>\n          </div>\n        </section>\n      </div>`;\n  }\n  let CHART_ROUTE = [], CHART_BARS = [];\n  function routeMap(t) {\n    const n = REGIONS.length, W = 690, Hh = 318, R = Math.min(102, 690 / n / 2 - 14), cy = 150;\n    const cxs = REGIONS.map((_, i) => (W / n) * (i + .5));\n    const g = [], nodes = [];\n    REGIONS.forEach((r, i) => {\n      const cx = cxs[i], on = inRegion(r.id);\n      g.push(`<g opacity=\"${on ? 1 : .3}\">`);\n      g.push(`<circle cx=\"${cx}\" cy=\"${cy}\" r=\"${R}\" fill=\"var(--main)\" fill-opacity=\".035\" stroke=\"var(--line)\" stroke-width=\"1.2\"/>`);\n      g.push(`<circle cx=\"${cx}\" cy=\"${cy}\" r=\"${R / 2}\" fill=\"none\" stroke=\"var(--line)\" stroke-width=\"1\" stroke-dasharray=\"2 3\"/>`);\n      g.push(`<text x=\"${cx + R * .7}\" y=\"${cy + R * .74 + 12}\" font-size=\"9.5\" fill=\"var(--gray)\">${num(r.radius, 0)}km</text>`);\n      const ss = DB.stops.filter((s) => s.day === 0 && s.region === r.id && s.status !== 'failed').sort((a, b) => a.seq - b.seq);\n      const done = ss.filter((s) => s.status === 'done').length;\n      g.push(`<text x=\"${cx}\" y=\"${cy - R - 26}\" font-size=\"13\" font-weight=\"600\" fill=\"var(--ink)\" text-anchor=\"middle\" style=\"font-family:var(--serif)\">${esc(r.name)}</text>`);\n      g.push(`<text x=\"${cx}\" y=\"${cy - R - 11}\" font-size=\"10.5\" fill=\"var(--gray)\" text-anchor=\"middle\">${esc(r.area)} · ■ ${esc(r.hub)}</text>`);\n      g.push(`<text x=\"${cx}\" y=\"${cy + R + 22}\" font-size=\"11.5\" fill=\"var(--ink)\" text-anchor=\"middle\">완료 <tspan font-weight=\"700\">${done}</tspan> / ${ss.length} 정차 · ${esc(r.driver)}</text>`);\n      const pos = (st) => ({ x: cx + Math.cos(st.angle) * st.radius * R, y: cy + Math.sin(st.angle) * st.radius * R }); // angle = atan2(−북쪽, 동쪽) → SVG에서 북쪽이 위\n      DB.stores.filter((st) => st.region === r.id && st.active && !ss.some((s) => s.store === st.idx)).forEach((st) => {\n        const p = pos(st);\n        g.push(`<circle cx=\"${p.x.toFixed(1)}\" cy=\"${p.y.toFixed(1)}\" r=\"3.4\" fill=\"var(--paper)\" stroke=\"var(--gray)\" stroke-width=\"1\" stroke-opacity=\".7\"/>`);\n        nodes.push({ x: p.x, y: p.y, r: 3.4, html: `<div class=\"tt\">${esc(st.name)} · ${esc(st.id)}</div><div class=\"tr\">오늘 배송 없음</div>` });\n      });\n      let px = cx, py = cy;\n      ss.forEach((s) => {\n        const p = pos(S(s.store));\n        const doneLeg = s.status !== 'pending';\n        g.push(`<line x1=\"${px.toFixed(1)}\" y1=\"${py.toFixed(1)}\" x2=\"${p.x.toFixed(1)}\" y2=\"${p.y.toFixed(1)}\" stroke=\"${doneLeg ? 'var(--main)' : 'var(--gray)'}\" stroke-width=\"${doneLeg ? 1.6 : 1.1}\" ${doneLeg ? '' : 'stroke-dasharray=\"3 3\"'} stroke-opacity=\"${doneLeg ? .8 : .7}\"/>`);\n        px = p.x; py = p.y;\n      });\n      g.push(`<rect x=\"${cx - 6}\" y=\"${cy - 6}\" width=\"12\" height=\"12\" rx=\"2\" fill=\"var(--ink)\"/>`);\n      const cur = ss.find((s) => s.status === 'arrived'), next = ss.find((s) => s.status === 'pending');\n      ss.forEach((s) => {\n        const st = S(s.store), p = pos(st);\n        const status = s.status === 'done' ? 'done' : (s === cur || (!cur && s === next)) ? 'cur' : 'wait';\n        g.push(`<circle cx=\"${p.x.toFixed(1)}\" cy=\"${p.y.toFixed(1)}\" r=\"7\" fill=\"${({ done: 'var(--main)', cur: 'var(--sub)', wait: 'var(--gray)' })[status]}\" stroke=\"var(--paper)\" stroke-width=\"2\"/>`);\n        g.push(`<text x=\"${p.x.toFixed(1)}\" y=\"${(p.y + 3.4).toFixed(1)}\" font-size=\"9\" fill=\"#fff\" font-weight=\"700\" text-anchor=\"middle\">${s.seq}</text>`);\n        nodes.push({ x: p.x, y: p.y, r: 8, html: `<div class=\"tt\">${s.seq}번째 정차 · ${esc(r.name)}</div><div class=\"tr\"><b>${esc(st.name)}</b></div><div class=\"tr\"><span>${status === 'done' ? `도착 ${hm(s.arrive)} · 완료 ${hm(s.depart)}` : `도착 예정 ${hm(s.eta)}`}</span></div><div class=\"tr\"><span>하차 ${s.boxes}박스${s.dur != null ? ` · 정차 ${num(s.dur, 1)}분` : ''}</span></div>` });\n      });\n      if (cur && on) { const p = pos(S(cur.store)); g.push(`<circle cx=\"${p.x.toFixed(1)}\" cy=\"${p.y.toFixed(1)}\" r=\"10\" fill=\"none\" stroke=\"var(--sub)\" stroke-width=\"1.5\" stroke-opacity=\".5\"><animate attributeName=\"r\" values=\"8;13;8\" dur=\"2s\" repeatCount=\"indefinite\"/></circle>`); }\n      g.push('</g>');\n    });\n    CHART_ROUTE = nodes;\n    return `<svg class=\"chart\" id=\"routeMap\" viewBox=\"0 0 ${W} ${Hh}\" role=\"img\" aria-label=\"권역별 오늘 배송 라우트\">${g.join('')}</svg>`;\n  }\n  function histogram(bins, mean) {\n    const W = 600, Hh = 206, ml = 34, mr = 12, mt = 24, mb = 30;\n    const maxN = Math.max(1, ...bins.map((b) => b.n));\n    const stepY = maxN > 150 ? 50 : maxN > 60 ? 20 : maxN > 30 ? 10 : 5;\n    const ymax = Math.ceil(maxN * 1.1 / stepY) * stepY;\n    const total = bins.reduce((a, b) => a + b.n, 0);\n    const x = (v) => ml + (v - 3) / 10 * (W - ml - mr);\n    const y = (v) => mt + (1 - v / ymax) * (Hh - mt - mb);\n    const g = [];\n    for (let v = 0; v <= ymax; v += stepY) {\n      g.push(`<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(v)}\" y2=\"${y(v)}\" stroke=\"var(--line)\"/>`);\n      g.push(`<text x=\"${ml - 7}\" y=\"${y(v) + 3.5}\" font-size=\"10.5\" fill=\"var(--gray)\" text-anchor=\"end\">${v}</text>`);\n    }\n    const bw = Math.min(24, (W - ml - mr) / 10 - 10);\n    CHART_BARS = [];\n    const target = DB.settings.targets.stop;\n    bins.forEach((b, i) => {\n      const cx = x(b.lo + .5), h = y(0) - y(b.n);\n      if (b.n) g.push(`<path d=\"M${cx - bw / 2},${y(0)} v${-(Math.max(4, h) - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(4, h) - 4} z\" fill=\"var(--main)\" fill-opacity=\"${b.lo >= target ? .45 : 1}\" class=\"hbar\" data-i=\"${i}\"/>`);\n      if (b.n) g.push(`<text x=\"${cx}\" y=\"${y(b.n) - 5}\" font-size=\"10\" fill=\"var(--gray)\" text-anchor=\"middle\">${b.n}</text>`);\n      g.push(`<text x=\"${cx}\" y=\"${Hh - mb + 15}\" font-size=\"10.5\" fill=\"var(--gray)\" text-anchor=\"middle\">${b.lo === 12 ? '12+' : b.lo + '–' + (b.lo + 1)}</text>`);\n      CHART_BARS.push({ x: cx - (W - ml - mr) / 20, w: (W - ml - mr) / 10, html: `<div class=\"tt\">정차 ${b.lo === 12 ? '12분 이상' : b.lo + '~' + (b.lo + 1) + '분'}</div><div class=\"tr\"><b>${b.n}회</b><span>${pct(b.n / Math.max(1, total) * 100)}</span></div>` });\n    });\n    g.push(`<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(0)}\" y2=\"${y(0)}\" stroke=\"var(--gray)\"/>`);\n    g.push(`<text x=\"${W - mr}\" y=\"${Hh - 2}\" font-size=\"10\" fill=\"var(--gray)\" text-anchor=\"end\">분</text>`);\n    g.push(`<line x1=\"${x(target)}\" x2=\"${x(target)}\" y1=\"${mt - 10}\" y2=\"${y(0)}\" stroke=\"var(--danger)\" stroke-width=\"1.5\" stroke-dasharray=\"5 4\"/>`);\n    g.push(`<text x=\"${x(target) + 5}\" y=\"${mt - 2}\" font-size=\"10.5\" fill=\"var(--danger)\" font-weight=\"600\">목표 ${target}분</text>`);\n    if (mean != null) {\n      g.push(`<line x1=\"${x(Math.max(3, Math.min(13, mean)))}\" x2=\"${x(Math.max(3, Math.min(13, mean)))}\" y1=\"${mt - 10}\" y2=\"${y(0)}\" stroke=\"var(--ink)\" stroke-width=\"1.5\"/>`);\n      g.push(`<text x=\"${x(Math.max(3, Math.min(13, mean))) - 5}\" y=\"${mt - 2}\" font-size=\"10.5\" fill=\"var(--ink)\" font-weight=\"600\" text-anchor=\"end\">평균 ${num(mean, 1)}분</text>`);\n    }\n    return `<svg class=\"chart\" id=\"histChart\" viewBox=\"0 0 ${W} ${Hh}\" role=\"img\" aria-label=\"정차 시간 분포 히스토그램\">${g.join('')}</svg>`;\n  }\n\n  /* ---------- ⑥ 파일럿 리포트 ---------- */\n  let CHART_MINI = {};\n  function miniLine(id, valsAll, opt) {\n    const vals = valsAll.map((v) => (v == null ? null : v));\n    const known = vals.filter((v) => v != null);\n    const W = 360, Hh = 148, ml = 34, mr = 46, mt = 16, mb = 24;\n    if (known.length < 1) return `<div class=\"empty\" style=\"height:${Hh}px\">데이터가 쌓이면 표시됩니다</div>`;\n    const lo = Math.min(opt.target, ...known), hi = Math.max(opt.target, ...known);\n    const pad = (hi - lo) * .25 || 1;\n    const y0 = Math.max(0, Math.floor((lo - pad) / opt.step) * opt.step), y1 = Math.ceil((hi + pad) / opt.step) * opt.step;\n    const x = (i) => ml + (vals.length === 1 ? .5 : i / (vals.length - 1)) * (W - ml - mr);\n    const y = (v) => mt + (1 - (v - y0) / (y1 - y0)) * (Hh - mt - mb);\n    const g = [];\n    for (let v = y0; v <= y1 + 1e-9; v += opt.step) {\n      g.push(`<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(v)}\" y2=\"${y(v)}\" stroke=\"var(--line)\"/>`);\n      g.push(`<text x=\"${ml - 6}\" y=\"${y(v) + 3.5}\" font-size=\"10\" fill=\"var(--gray)\" text-anchor=\"end\">${num(v, opt.dec)}</text>`);\n    }\n    vals.forEach((v, i) => g.push(`<text x=\"${x(i)}\" y=\"${Hh - 7}\" font-size=\"10\" fill=\"${i === vals.length - 1 ? 'var(--ink)' : 'var(--gray)'}\" text-anchor=\"middle\">W${opt.first + i}</text>`));\n    g.push(`<line x1=\"${ml}\" x2=\"${W - mr}\" y1=\"${y(opt.target)}\" y2=\"${y(opt.target)}\" stroke=\"var(--sub)\" stroke-width=\"1.5\" stroke-dasharray=\"5 4\"/>`);\n    g.push(`<text x=\"${W - mr + 5}\" y=\"${y(opt.target) + 3.5}\" font-size=\"10\" fill=\"var(--sub)\" font-weight=\"600\">목표 ${num(opt.target, opt.dec)}</text>`);\n    const segs = []; let cur = [];\n    vals.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); });\n    if (cur.length) segs.push(cur);\n    segs.forEach((s) => { if (s.length > 1) g.push(`<path d=\"M${s.map((p) => p.join(',')).join('L')}\" fill=\"none\" stroke=\"var(--main)\" stroke-width=\"2\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>`); });\n    vals.forEach((v, i) => { if (v != null) g.push(`<circle cx=\"${x(i)}\" cy=\"${y(v)}\" r=\"${i === vals.length - 1 ? 5 : 4}\" fill=\"${i === vals.length - 1 ? 'var(--main)' : 'var(--paper)'}\" stroke=\"${i === vals.length - 1 ? 'var(--paper)' : 'var(--main)'}\" stroke-width=\"2\"/>`); });\n    const li = vals.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();\n    g.push(`<text x=\"${x(li)}\" y=\"${y(vals[li]) + (opt.better === 'down' ? 18 : -10)}\" font-size=\"11\" fill=\"var(--ink)\" font-weight=\"700\" text-anchor=\"middle\">${num(vals[li], 1)}${opt.unit}</text>`);\n    g.push(`<rect class=\"mhit\" data-mini=\"${id}\" x=\"${ml}\" y=\"${mt}\" width=\"${W - ml - mr}\" height=\"${Hh - mt - mb}\" fill=\"transparent\"/>`);\n    g.push(`<line class=\"mcx\" id=\"mcx-${id}\" x1=\"0\" x2=\"0\" y1=\"${mt}\" y2=\"${Hh - mb}\" stroke=\"var(--ink)\" stroke-opacity=\".3\" visibility=\"hidden\"/>`);\n    CHART_MINI[id] = { vals, x, W, ml, mr, opt };\n    return `<svg class=\"chart\" id=\"mini-${id}\" viewBox=\"0 0 ${W} ${Hh}\" role=\"img\" aria-label=\"${opt.label} 주차별 추이\">${g.join('')}</svg>`;\n  }\n  function viewReport() {\n    const pm = pilotMetrics(), T = DB.settings.targets;\n    const WK = pm.weeks;\n    const show = WK.slice(-8), first = WK.length - show.length + 1;\n    const badge = (v, ok) => (v == null ? '<span class=\"badge b-mute\">표본 부족</span>' : `<span class=\"badge ${ok ? 'b-ok' : 'b-bad'}\">${ok ? '목표 달성' : '목표 미달'}</span>`);\n    const tbar = (v, target, max) => `<div class=\"target-bar\"><div style=\"position:absolute;inset:0 auto 0 0;width:${Math.min(100, (v || 0) / max * 100)}%;background:var(--main);border-radius:3px\"></div><div style=\"position:absolute;top:-4px;bottom:-4px;left:${target / max * 100}%;border-left:1.5px dashed var(--sub)\"></div></div>`;\n    const w1 = WK[0], wl = WK[WK.length - 1];\n    const cards = `<div class=\"rp-cards\">\n      <section class=\"card metric\"><div class=\"metric-h\"><span class=\"rank top\">1</span><h3>재고 추정 오차</h3>${badge(pm.err2, pm.err2 <= T.error)}</div>\n        <div class=\"metric-v\">${pm.err2 != null ? num(pm.err2, 1) : '—'}<small>%</small></div>${tbar(pm.err2, T.error, Math.max(20, T.error * 2))}\n        <div class=\"metric-s\"><span>목표 <b>≤ ${T.error}%</b></span><span>실사 대비 평균 편차 · n=${num(pm.errN)}</span></div>\n        <div class=\"metric-s\"><span>W1 ${pct(w1.err)} → W${WK.length} ${pct(wl.err)}</span><span>밴드 적중률 <b>${pct(pm.hit2, 0)}</b></span></div></section>\n      <section class=\"card metric\"><div class=\"metric-h\"><span class=\"rank top\">2</span><h3>카톡 승인율</h3>${badge(pm.appr2, pm.appr2 >= T.approval)}</div>\n        <div class=\"metric-v\">${pm.appr2 != null ? num(pm.appr2, 1) : '—'}<small>%</small></div>${tbar(pm.appr2, T.approval, 100)}\n        <div class=\"metric-s\"><span>목표 <b>≥ ${T.approval}%</b></span><span>응답 완료 제안 n=${pm.apprN}</span></div>\n        <div class=\"metric-s\"><span>W1 ${pct(w1.appr)} → W${WK.length} ${pct(wl.appr)}</span><span>파일럿 누적 <b>${pct(pm.apprCum)}</b></span></div></section>\n      <section class=\"card metric\"><div class=\"metric-h\"><span class=\"rank top\">3</span><h3>평균 정차 시간</h3>${badge(pm.stop2, pm.stop2 <= T.stop)}</div>\n        <div class=\"metric-v\">${pm.stop2 != null ? num(pm.stop2, 1) : '—'}<small>분</small></div>${tbar(pm.stop2, T.stop, Math.max(10, T.stop * 1.5))}\n        <div class=\"metric-s\"><span>목표 <b>≤ ${T.stop}분</b></span><span>정차 n=${pm.stopN}${pm.stopP90 != null ? ' · P90 ' + num(pm.stopP90, 1) + '분' : ''}</span></div>\n        <div class=\"metric-s\"><span>W1 ${w1.stop != null ? num(w1.stop, 1) + '분' : '—'} → W${WK.length} ${wl.stop != null ? num(wl.stop, 1) + '분' : '—'}</span><span>7분 이내 <b>${pct(pm.stopIn, 0)}</b></span></div></section>\n    </div>`;\n    CHART_MINI = {};\n    const trend = `<section class=\"card\" aria-label=\"주차별 추이\">\n      <div class=\"card-h\"><h3>주차별 추이 <span class=\"sub\">W${first}–W${WK.length} · 지표별 개별 축 · 마지막 주는 진행 중</span></h3><span class=\"muted\" style=\"font-size:11.5px\">판정 기준: 최근 2주</span></div>\n      <div class=\"trend3\">\n        <div><h4>① 재고 추정 오차 <span>% · 낮을수록 좋음</span></h4>${miniLine('err', show.map((w) => w.err), { target: T.error, step: 2, dec: 0, unit: '%', better: 'down', label: '재고 추정 오차', first })}</div>\n        <div><h4>② 카톡 승인율 <span>% · 높을수록 좋음</span></h4>${miniLine('appr', show.map((w) => w.appr), { target: T.approval, step: 5, dec: 0, unit: '%', better: 'up', label: '카톡 승인율', first })}</div>\n        <div><h4>③ 평균 정차 시간 <span>분 · 낮을수록 좋음</span></h4>${miniLine('stop', show.map((w) => w.stop), { target: T.stop, step: 1, dec: 0, unit: '분', better: 'down', label: '평균 정차 시간', first })}</div>\n      </div></section>`;\n    let totG = 0, totF = 0, totN = 0;\n    const srows = DB.settlements.slice().reverse().map((w) => {\n      totG += w.gmv; totF += w.fee; totN += w.orders;\n      const payIdx = dateIdx(w.pay_date);\n      const status = w.status === 'open' ? ['집계 중', 'b-mute'] : w.status === 'paid' ? ['지급 완료', 'b-ok'] : payIdx === 0 ? ['오늘 지급', 'b-warn'] : payIdx < 0 ? ['지급 확인 필요', 'b-bad'] : ['정산 예정', 'b-line'];\n      return `<tr><td style=\"white-space:nowrap\"><b class=\"strong\">W${w.week}</b> <span class=\"muted\">${md(dateIdx(w.start) * 24)}–${md(dateIdx(w.end) * 24)}</span></td><td class=\"r num\">${num(w.orders)}</td><td class=\"r num\">${won(w.gmv)}</td><td class=\"r num strong\">${won(w.fee)}</td><td class=\"num\">${mdw(payIdx * 24)}</td><td><span class=\"badge ${status[1]}\">${status[0]}</span></td>\n        <td class=\"r\" style=\"white-space:nowrap\"><a class=\"btn sm\" href=\"/api/settlements/${esc(w.start)}/csv\" download>${icon('download', 13)}CSV</a>${can('admin') && w.status === 'closed' ? ` <button class=\"btn sm\" data-act=\"settlepaid\" data-week=\"${esc(w.start)}\">지급 완료</button>` : ''}</td></tr>`;\n    }).join('');\n    const settle = `<section class=\"card\" aria-label=\"티오더 정산 요약\">\n      <div class=\"card-h\"><h3>티오더 정산 <span class=\"sub\">수수료 ${num(DB.settings.feeRate * 100, 1)}% · 결제 완료 기준 · VAT 별도</span></h3></div>\n      <div class=\"tbl-wrap\" style=\"max-height:340px\" data-sk=\"settle\"><table class=\"tbl\"><thead><tr><th>기간</th><th class=\"r\">발주</th><th class=\"r\">발생 GMV</th><th class=\"r\">수수료</th><th>정산 예정일</th><th>상태</th><th class=\"r\">내역서</th></tr></thead><tbody>${srows}</tbody>\n      <tfoot><tr><td>파일럿 누계</td><td class=\"r num\">${num(totN)}</td><td class=\"r num\">${won(totG)}</td><td class=\"r num\">${won(totF)}</td><td colspan=\"3\"></td></tr></tfoot></table></div>\n    </section>`;\n    const perf = DB.pilot.storePerf.filter((x) => { const s = S(x.store); return s && inRegion(s.region) && x.decided >= 4; }).map((x) => ({ ...x, st: S(x.store), rate: x.approved / x.decided * 100 }));\n    perf.sort((a, b) => b.rate - a.rate || (a.medResp ?? 99) - (b.medResp ?? 99));\n    const top = perf.slice(0, 5), low = perf.slice(-5).reverse();\n    const prow = (x, rank, kind) => `<tr class=\"click\" data-go=\"inv:${x.st.idx}:\"><td><span class=\"rank ${kind}\">${rank}</span></td><td><b class=\"strong\">${esc(x.st.name)}</b><span class=\"sub2\">${esc((REG[x.st.region] || {}).name || '')} · ${esc(x.st.id)}</span></td><td class=\"r num\">${x.decided}</td><td class=\"r num strong\">${pct(x.rate, 0)}</td><td class=\"r num\">${x.medResp != null ? Math.round(x.medResp) + '분' : '—'}</td><td>${kind === 'top' ? (x.st.breakPref ? '<span class=\"tag\">브레이크타임 발송</span>' : '<span class=\"tag\">즉시 응답형</span>') : `${x.holds ? `<span class=\"badge b-warn\">보류 ${x.holds}</span> ` : ''}${x.nones ? `<span class=\"badge b-bad\">미응답 ${x.nones}</span>` : ''}`}</td></tr>`;\n    const perfT = `<section class=\"card\" aria-label=\"매장별 성과\">\n      <div class=\"card-h\"><h3>매장별 성과 <span class=\"sub\">승인율 · 제안 4건 이상 ${perf.length}곳</span></h3><div class=\"seg\"><button data-perf=\"top\" aria-pressed=\"${state.rep.perf === 'top'}\">상위 5</button><button data-perf=\"low\" aria-pressed=\"${state.rep.perf === 'low'}\">하위 5</button></div></div>\n      <div class=\"tbl-wrap\">${perf.length ? `<table class=\"tbl\"><thead><tr><th style=\"width:34px\">순위</th><th>매장</th><th class=\"r\">제안</th><th class=\"r\">승인율</th><th class=\"r\">응답 중앙값</th><th>${state.rep.perf === 'top' ? '특징' : '원인'}</th></tr></thead>\n      <tbody>${state.rep.perf === 'top' ? top.map((x, i) => prow(x, i + 1, 'top')).join('') : low.map((x, i) => prow(x, perf.length - i, 'low')).join('')}</tbody></table>` : '<div class=\"empty\">아직 표본이 부족합니다</div>'}</div>\n    </section>`;\n    return `<div class=\"cutoff\"><span class=\"pill\">${icon('report', 14)}파일럿 <b>W1–W${WK.length}</b> · ${md(DB.pilotStartH)} – ${md(0)} · 매장 ${DB.pilot.activeStores}곳</span>\n        <span class=\"muted\" style=\"margin-left:auto\">매장당 월 GMV <b style=\"color:var(--ink)\">${num(pm.monthlyPerStore / 10000, 1)}만 원</b> · 박스 단가 <b style=\"color:var(--ink)\">${num(Math.round(pm.avgPrice))}원</b> · 회당 ${num(pm.avgBoxes, 1)}박스</span></div>\n      ${cards}${trend}<div class=\"rp-bottom\">${settle}${perfT}</div>`;\n  }\n\n  /* ---------- ⑦ 관리 ---------- */\n  const SUBS = [['stores', '매장'], ['kakao', '품목 승인·카카오'], ['skus', 'SKU·메뉴 매핑'], ['drivers', '기사·권역'], ['users', '계정'], ['settings', '운영 설정'], ['integrations', '데이터 연동']];\n  async function loadAdmin() {\n    state.adm.loading = true;\n    try {\n      const [data, me] = await Promise.all([api('GET', '/api/admin/data'), can('ops') ? api('GET', '/api/me/kakao').catch(() => null) : null]);\n      state.adm.data = { ...data, meKakao: me };\n    } catch (e) { toast(esc(e.message), 'alert'); state.adm.data = { error: e.message }; }\n    state.adm.loading = false;\n    if (state.tab === 'admin') render();\n  }\n  function viewAdmin() {\n    const d = state.adm.data;\n    const nav = `<div class=\"subnav\">${SUBS.filter(([id]) => (id === 'users' || id === 'settings' ? can('admin') : true)).map(([id, nm]) => `<button data-adm=\"${id}\" ${state.adm.sub === id ? 'aria-current=\"page\"' : ''}>${nm}${id === 'skus' && DB.unmapped ? ` <span class=\"badge b-warn\">미매핑 ${DB.unmapped}</span>` : ''}${id === 'kakao' && DB.accessPending ? ` <span class=\"badge b-warn\">신청 ${DB.accessPending}</span>` : ''}</button>`).join('')}</div>`;\n    if (!can('ops')) return nav + '<div class=\"empty\">관리 화면은 운영자 이상 권한이 필요합니다</div>';\n    if (!d) return nav + `<div class=\"card\"><div class=\"card-b\" style=\"padding-top:14px\"><div class=\"skel-line\" style=\"width:60%\"></div><br><div class=\"skel-line\" style=\"width:80%\"></div></div></div>`;\n    if (d.error) return nav + `<div class=\"alert-line bad\">${esc(d.error)}</div>`;\n    return nav + ({ stores: admStores, kakao: admKakao, skus: admSkus, drivers: admDrivers, users: admUsers, settings: admSettings, integrations: admIntegrations }[state.adm.sub] || admStores)(d);\n  }\n  function admStores(d) {\n    const q = state.adm.q.trim();\n    const sk = new Map(); d.storeSkus.forEach((x) => { if (!sk.has(x.store_id)) sk.set(x.store_id, []); if (x.carried) sk.get(x.store_id).push(x); });\n    const rows = d.stores.filter((s) => !q || s.name.includes(q) || s.code.includes(q) || (s.pos_store_id || '').includes(q)).map((s) => {\n      const items = sk.get(s.id) || [];\n      const onb = items.some((i) => i.last_count_at);\n      return `<tr><td class=\"num\">${esc(s.code)}</td><td><b class=\"strong\">${esc(s.name)}</b><span class=\"sub2\">${esc(s.address || '')}</span></td><td>${esc((REG[s.region_id] || {}).name || s.region_id)}</td><td>${esc((d.biz[s.biz] || {}).label || '')}<span class=\"sub2\">${catPills(d, s)}</span></td>\n        <td>${esc(s.owner_name || '')}<span class=\"sub2\">${esc(s.owner_phone || '연락처 없음')}</span></td><td>${s.pos_store_id ? `<span class=\"code\">${esc(s.pos_store_id)}</span>` : '<span class=\"badge b-warn\">미연결</span>'}</td>\n        <td>${s.biz === 'restaurant' || items.length ? `${items.length}종 ${onb ? '' : '<span class=\"badge b-mute\">실사 전</span>'}` : '<span class=\"muted\">직접 발주</span>'}</td><td>${s.send_pref === 'break' ? '브레이크타임' : '즉시'}${s.review_required ? ' · <span class=\"badge b-warn\">검수</span>' : ''}</td>\n        <td>${s.active ? '<span class=\"badge b-ok\">운영</span>' : '<span class=\"badge b-mute\">중지</span>'}</td>\n        <td class=\"r\" style=\"white-space:nowrap\"><button class=\"btn sm\" data-act=\"editstore\" data-id=\"${s.id}\">${icon('edit', 13)}편집</button> <button class=\"btn sm\" data-act=\"storeskus\" data-id=\"${s.id}\">SKU</button> <button class=\"btn sm\" data-act=\"count\" data-store=\"${s.id}\" ${onb ? '' : 'data-onb=\"1\"'}>잔량</button></td></tr>`;\n    }).join('');\n    return `<section class=\"card\"><div class=\"card-h\"><h3>매장 <span class=\"sub\">${d.stores.length}곳</span></h3><div class=\"hstack\"><input class=\"inp\" id=\"admQ\" placeholder=\"매장명·코드·티오더 ID 검색\" value=\"${esc(state.adm.q)}\" style=\"width:220px\"><button class=\"btn primary\" data-act=\"editstore\">${icon('plus', 13)}매장 등록</button></div></div>\n      <div class=\"tbl-wrap\" data-sk=\"adm-stores\">${rows ? `<table class=\"tbl\"><thead><tr><th>코드</th><th>매장</th><th>권역</th><th>업종·품목</th><th>사장님</th><th>티오더 ID</th><th>취급 SKU</th><th>발송</th><th>상태</th><th class=\"r\"></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class=\"empty\">등록된 매장이 없습니다 — [매장 등록] 또는 [데이터 연동 → CSV 가져오기]</div>'}</div></section>\n      <p class=\"muted\" style=\"font-size:11.5px\">새 매장은 ① 등록(업종 선택 → 기본 품목 자동 승인) → ② [품목 승인·카카오]에서 연결 코드 발급 → ③ 사장님이 카카오톡 채널에서 연결 순서로 온보딩합니다. 식당(음료)은 여기에 더해 취급 SKU 지정 → 초기 잔량 입력을 하면 POS 기반 재고 추정과 자동 발주 제안이 시작됩니다.</p>`;\n  }\n  const catPills = (d, s) => Object.entries(d.categories).map(([cid, c]) => {\n    const r = d.storeCategories.find((x) => x.store_id === s.id && x.category === cid);\n    const st = d.biz[s.biz] && d.biz[s.biz].category === cid ? 'approved' : r ? r.status : 'none';\n    return st === 'approved' ? `<span title=\"${esc(c.label)} 이용 중\">${c.icon}</span>` : st === 'pending' ? `<span class=\"badge b-warn nodot\" title=\"${esc(c.label)} 신청\">${c.icon} 신청</span>` : '';\n  }).join(' ');\n  function myKakaoCard(d) {\n    const m = d.meKakao;\n    if (!m) return '';\n    const DAY = 864e5;\n    const exp = m.refreshExp ? Math.round((m.refreshExp - Date.now()) / DAY) : null;\n    return `<section class=\"card\"><div class=\"card-h\"><h3>내 카톡 알림 <span class=\"sub\">나에게 보내기 · ${esc(DB.user.name)}</span></h3></div><div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:8px;font-size:12.5px\">\n      ${m.linked ? `<div class=\"hstack\"><span class=\"badge b-ok\">연결됨</span><span>${esc(m.nickname || '카카오 계정')}</span>${exp != null ? `<span class=\"muted\">· 로그인 연장까지 ${exp}일${exp < 14 ? ' — 곧 다시 연결해 주세요' : ''}</span>` : ''}</div>\n        ${m.lastError ? `<div class=\"alert-line bad\">${esc(m.lastError)}</div>` : ''}\n        <div style=\"display:grid;grid-template-columns:1fr 1fr;gap:4px 10px\">${Object.entries(m.kinds).map(([k, l]) => `<label class=\"chk\"><input type=\"checkbox\" data-kpref=\"${k}\" ${m.prefs[k] ? 'checked' : ''}>${esc(l)}</label>`).join('')}</div>\n        <div class=\"hstack\"><button class=\"btn sm primary\" data-act=\"kakaotest\">${icon('send', 13)}테스트 알림 보내기</button><a class=\"btn sm\" href=\"/k/admin-login\">다시 연결</a><button class=\"btn sm\" data-act=\"kakaounlink\">연결 해제</button></div>`\n      : `<div class=\"muted\" style=\"line-height:1.6\">발주 확정, 미확정 발주서, 오늘 출고 합계를 내 카카오톡(나와의 채팅)으로 받습니다. 운영자마다 각자 연결합니다.</div>\n        ${m.loginReady ? `<a class=\"btn primary\" href=\"/k/admin-login\" style=\"align-self:flex-start\">카카오로 알림 연결하기</a>` : '<div class=\"alert-line warn\">먼저 [운영 설정 → 카카오 REST API 키]를 넣어 주세요.</div>'}`}\n      <div class=\"muted\" style=\"font-size:11.5px\">알림 버튼은 모바일 발주 내역 <span class=\"code\">/a</span>로 열립니다.</div></div></section>`;\n  }\n  function admKakao(d) {\n    const byId = new Map(d.stores.map((s) => [s.id, s]));\n    const pend = d.storeCategories.filter((r) => r.status === 'pending').sort((a, b) => a.requested_at - b.requested_at);\n    const via = { chat: '카카오톡', web: '발주 화면', ops: '운영자' };\n    const pendRows = pend.map((r) => { const s = byId.get(r.store_id) || {}; const c = d.categories[r.category]; return `<tr><td><b class=\"strong\">${esc(s.name || '')}</b><span class=\"sub2\">${esc(s.code || '')} · ${esc((d.biz[s.biz] || {}).label || '')}</span></td><td>${c.icon} ${esc(c.label)}</td><td>${when(H(r.requested_at))}<span class=\"sub2\">${esc(via[r.requested_via] || r.requested_via)}</span></td><td>${esc(r.request_note || '')}</td>\n      <td class=\"r\" style=\"white-space:nowrap\">${can('ops') ? `<button class=\"btn sm\" data-act=\"access\" data-store=\"${r.store_id}\" data-cat=\"${r.category}\" data-do=\"reject\">거절</button> <button class=\"btn sm primary\" data-act=\"access\" data-store=\"${r.store_id}\" data-cat=\"${r.category}\" data-do=\"approve\">${icon('check', 13)}승인</button>` : ''}</td></tr>`; }).join('');\n    const links = new Map(); d.kakaoLinks.forEach((l) => { if (!links.has(l.store_id)) links.set(l.store_id, []); links.get(l.store_id).push(l); });\n    const q = state.adm.q.trim();\n    const matrix = d.stores.filter((s) => s.active && (!q || s.name.includes(q) || s.code.includes(q))).map((s) => {\n      const cells = Object.entries(d.categories).map(([cid, c]) => {\n        const r = d.storeCategories.find((x) => x.store_id === s.id && x.category === cid);\n        const def = d.biz[s.biz].category === cid;\n        const st = def ? 'approved' : r ? r.status : 'none';\n        const lbl = def ? '기본' : st === 'approved' ? '승인' : st === 'pending' ? '신청' : st === 'rejected' ? '거절' : '—';\n        const cls = st === 'approved' ? 'b-ok' : st === 'pending' ? 'b-warn' : 'b-mute';\n        const nextAct = def ? '' : st === 'approved' ? 'revoke' : 'approve';\n        return `<td class=\"c\">${nextAct && can('ops') ? `<button class=\"badge ${cls} nodot\" style=\"border:0;cursor:pointer\" data-act=\"access\" data-store=\"${s.id}\" data-cat=\"${cid}\" data-do=\"${nextAct}\" title=\"${nextAct === 'revoke' ? '이용 해제' : '승인'}\">${lbl}</button>` : `<span class=\"badge ${cls} nodot\">${lbl}</span>`}</td>`;\n      }).join('');\n      const ls = links.get(s.id) || [];\n      const lk = ls.length ? ls.map((l) => `<span class=\"badge b-line nodot\" title=\"${l.last_seen_at ? '최근 사용 ' + when(H(l.last_seen_at)) : ''}\">${l.kind === 'chatbot' ? '💬 채널' : '👤 로그인'}${l.nickname ? ' ' + esc(l.nickname) : ''}${can('ops') ? ` <a href=\"#\" data-act=\"unlink\" data-id=\"${l.id}\" aria-label=\"연결 해제\">✕</a>` : ''}</span>`).join(' ') : '<span class=\"muted\">미연결</span>';\n      return `<tr><td><b class=\"strong\">${esc(s.name)}</b><span class=\"sub2\">${esc(s.code)} · ${esc(d.biz[s.biz].label)}${s.standing_days ? ' · 정기 ' + s.standing_days.split(',').map((x) => DOW[+x]).join('·') : ''}</span></td>${cells}<td>${lk}${s.link_code ? `<span class=\"sub2\">연결 코드 <b class=\"code\">${esc(s.link_code)}</b></span>` : ''}</td>\n        <td class=\"r\" style=\"white-space:nowrap\">${can('ops') ? `${s.standing_days ? `<button class=\"btn sm\" data-act=\"sheetnow\" data-id=\"${s.id}\" title=\"정기 발주서를 지금 채워서 사장님께 알림톡으로 보냅니다\">발주서</button> ` : ''}<button class=\"btn sm\" data-act=\"linkcode\" data-id=\"${s.id}\">연결 코드</button> <button class=\"btn sm\" data-act=\"orderlink\" data-id=\"${s.id}\">${icon('link', 13)}발주 링크</button> <button class=\"btn sm\" data-act=\"revokelinks\" data-id=\"${s.id}\" title=\"발주 링크 무효화 · 카카오 연결 해제\">초기화</button>` : ''}</td></tr>`;\n    }).join('');\n    const k = d.kakao;\n    const chk = (ok, label, hint) => `<div class=\"sys-row\"><span class=\"d ${ok ? '' : 'warn'}\"></span>${label}<em>${ok ? '완료' : esc(hint)}</em></div>`;\n    return `<section class=\"card\"><div class=\"card-h\"><h3>품목 이용 신청 <span class=\"sub\">승인하면 점주 발주 화면·카카오톡에 해당 품목이 열리고 알림톡으로 안내됩니다</span></h3></div>\n        <div class=\"tbl-wrap\">${pendRows ? `<table class=\"tbl\"><thead><tr><th>매장</th><th>신청 품목</th><th>신청</th><th>메모</th><th class=\"r\"></th></tr></thead><tbody>${pendRows}</tbody></table>` : `<div class=\"empty\">${icon('check', 22)}대기 중인 신청이 없습니다</div>`}</div></section>\n      <div class=\"rp-bottom\" style=\"grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)\">\n        <section class=\"card\"><div class=\"card-h\"><h3>매장별 품목 · 카카오 연결 <span class=\"sub\">품목 칸을 누르면 승인/해제</span></h3><input class=\"inp\" id=\"admQ\" placeholder=\"매장명·코드 검색\" value=\"${esc(state.adm.q)}\" style=\"width:180px\"></div>\n          <div class=\"tbl-wrap\" style=\"max-height:560px\"><table class=\"tbl\"><thead><tr><th>매장</th>${Object.values(d.categories).map((c) => `<th class=\"c\">${c.icon} ${esc(c.short)}</th>`).join('')}<th>카카오 연결</th><th class=\"r\"></th></tr></thead><tbody>${matrix}</tbody></table></div></section>\n        <div style=\"display:flex;flex-direction:column;gap:14px\">\n          ${myKakaoCard(d)}\n          <section class=\"card\"><div class=\"card-h\"><h3>카카오 연동 상태</h3></div><div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:6px;font-size:12.5px\">\n            ${chk(!!k.channelId, '카카오톡 채널 ID', '운영 설정에서 입력')}\n            ${chk(!!k.blockId, '오픈빌더 발주 블록 ID', '없으면 채팅 버튼 발주가 꺼짐')}\n            ${chk(k.restKey, '카카오 로그인 REST API 키', '선택 — 번호 자동 연결용')}\n            ${chk(k.clientSecret, 'Client Secret (환경 변수)', '선택 — 보안 강화')}\n          </div></section>\n          <section class=\"card\"><div class=\"card-h\"><h3>오픈빌더 스킬 서버</h3></div><div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:8px;font-size:12.5px\">\n            ${can('admin') ? `<div class=\"copybox\"><input readonly id=\"skillUrl\" value=\"${esc(k.skillUrl)}\"><button class=\"btn\" data-act=\"copyval\" data-src=\"skillUrl\">${icon('copy', 13)}복사</button></div>\n            <div class=\"hstack\"><button class=\"btn sm\" data-act=\"rotate\" data-name=\"kakao\">스킬 키 재발급</button><span class=\"muted\" style=\"font-size:11.5px\">재발급하면 오픈빌더 스킬 URL도 바꿔야 합니다</span></div>` : '<div class=\"muted\">스킬 URL은 관리자만 볼 수 있습니다</div>'}\n            <div class=\"muted\" style=\"font-size:11.5px;line-height:1.6\">오픈빌더 → 스킬 → 이 URL 등록 → 블록 1개(예: \"발주\")에 스킬 연결 + 봇 응답을 '스킬데이터'로 → 그 블록 ID를 운영 설정에 입력 → 폴백·웰컴 블록도 같은 스킬로. 자세한 순서는 docs/KAKAO.md.</div>\n          </div></section>\n          <section class=\"card\"><div class=\"card-h\"><h3>카카오 로그인</h3></div><div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:8px;font-size:12.5px\">\n            <div>Redirect URI <span class=\"code\">${esc(k.redirectUri)}</span> <button class=\"btn sm\" data-act=\"copytext\" data-text=\"${esc(k.redirectUri)}\">${icon('copy', 13)}</button></div>\n            <div>로그인 시작 주소 <span class=\"code\">${esc(k.loginUrl)}</span></div>\n            <div class=\"muted\" style=\"font-size:11.5px;line-height:1.6\">카카오 디벨로퍼스 앱 → 카카오 로그인 활성화 → Redirect URI 등록 → 동의항목 '카카오계정(전화번호)'을 켜면 사장님 휴대폰 번호로 매장이 자동 연결됩니다.</div>\n          </div></section>\n        </div></div>`;\n  }\n  function admSkus(d) {\n    const cf = state.adm.cat || 'ALL';\n    const rows = d.skus.filter((k) => cf === 'ALL' || k.category === cf).map((k) => `<tr><td class=\"num\">${esc(k.id)}</td><td><b class=\"strong\">${esc(k.name)}</b>${k.spec || k.grp ? `<span class=\"sub2\">${esc([k.grp, k.spec].filter(Boolean).join(' · '))}</span>` : ''}</td><td>${esc((d.categories[k.category] || {}).icon || '')} ${esc((d.categories[k.category] || {}).short || '')}</td><td class=\"r num\">${k.pack}${esc(k.unit)}</td><td class=\"r num\">${won(k.price)}</td><td>${k.active ? '<span class=\"badge b-ok\">판매</span>' : '<span class=\"badge b-mute\">중지</span>'}</td><td class=\"r\"><button class=\"btn sm\" data-act=\"editsku\" data-id=\"${esc(k.id)}\">${icon('edit', 13)}편집</button></td></tr>`).join('');\n    const maps = d.menuMap.map((m) => `<tr><td>${esc(m.menu_name)}</td><td>${m.store_id ? esc(m.store_name) : '<span class=\"muted\">전체 매장</span>'}</td><td>${esc(skuName(m.sku_id))}</td><td class=\"r num\">×${num(m.units, 2)}</td><td class=\"r\"><button class=\"btn sm\" data-act=\"delmap\" data-id=\"${m.id}\">삭제</button></td></tr>`).join('');\n    const un = d.unmapped.map((u) => `<tr><td><b class=\"strong\">${esc(u.menu_name)}</b></td><td>${esc(u.store_name)} <span class=\"muted\">${esc(u.store_code)}</span></td><td class=\"r num\">${num(u.qty)}</td><td>${when(H(u.last_seen))}</td><td class=\"r\"><button class=\"btn sm primary\" data-act=\"addmap\" data-menu=\"${esc(u.menu_name)}\" data-store=\"${u.store_id}\">매핑</button></td></tr>`).join('');\n    return `<div class=\"rp-bottom\" style=\"grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)\">\n      <section class=\"card\"><div class=\"card-h\"><h3>SKU <span class=\"sub\">${d.skus.length}종 · 박스 단가</span></h3><div class=\"hstack\"><div class=\"seg\">${[['ALL', '전체'], ...Object.entries(d.categories).map(([id, c]) => [id, c.icon + ' ' + c.short])].map(([id, nm]) => `<button type=\"button\" data-skucat=\"${id}\" aria-pressed=\"${cf === id}\">${esc(nm)}</button>`).join('')}</div><button class=\"btn primary\" data-act=\"editsku\">${icon('plus', 13)}SKU 추가</button></div></div>\n        <div class=\"tbl-wrap\"><table class=\"tbl\"><thead><tr><th>코드</th><th>SKU</th><th>품목</th><th class=\"r\">입수</th><th class=\"r\">박스 단가</th><th>상태</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>\n      <div style=\"display:flex;flex-direction:column;gap:14px\">\n        <section class=\"card\"><div class=\"card-h\"><h3>미매핑 POS 메뉴 <span class=\"sub\">매핑 전까지 재고에 반영되지 않음</span></h3></div>\n          <div class=\"tbl-wrap\">${un ? `<table class=\"tbl\"><thead><tr><th>POS 메뉴명</th><th>매장</th><th class=\"r\">판매 수량</th><th>마지막</th><th></th></tr></thead><tbody>${un}</tbody></table>` : `<div class=\"empty\">${icon('check', 22)}미매핑 메뉴가 없습니다</div>`}</div></section>\n        <section class=\"card\"><div class=\"card-h\"><h3>메뉴 → SKU 매핑 <span class=\"sub\">${d.menuMap.length}건 · 세트 메뉴는 SKU별로 여러 줄</span></h3><button class=\"btn\" data-act=\"addmap\">${icon('plus', 13)}매핑 추가</button></div>\n          <div class=\"tbl-wrap\" style=\"max-height:360px\">${maps ? `<table class=\"tbl\"><thead><tr><th>POS 메뉴명</th><th>적용</th><th>SKU</th><th class=\"r\">수량</th><th></th></tr></thead><tbody>${maps}</tbody></table>` : '<div class=\"empty\">매핑이 없습니다</div>'}</div></section>\n      </div></div>`;\n  }\n  function admDrivers(d) {\n    const rows = d.drivers.map((x) => `<tr><td><b class=\"strong\">${esc(x.name)}</b></td><td>${esc(x.phone)}</td><td>${esc((REG[x.region_id] || {}).name || x.region_id)}</td><td>${esc(x.vehicle)}</td><td class=\"r num\">${x.capacity}곳</td><td>${x.active ? '<span class=\"badge b-ok\">운영</span>' : '<span class=\"badge b-mute\">중지</span>'}</td><td class=\"r\"><button class=\"btn sm\" data-act=\"editdriver\" data-id=\"${x.id}\">${icon('edit', 13)}편집</button></td></tr>`).join('');\n    const regs = d.regions.map((r) => `<tr><td class=\"num\">${esc(r.id)}</td><td><b class=\"strong\">${esc(r.name)}</b><span class=\"sub2\">${esc(r.area)}</span></td><td>${esc(r.hub_name)}<span class=\"sub2\">${r.hub_lat != null ? num(r.hub_lat, 4) + ', ' + num(r.hub_lng, 4) : '좌표 없음'}</span></td><td class=\"r num\">${num(r.radius_km, 1)}km</td><td class=\"r\">${can('admin') ? `<button class=\"btn sm\" data-act=\"editregion\" data-id=\"${esc(r.id)}\">${icon('edit', 13)}편집</button>` : ''}</td></tr>`).join('');\n    return `<div class=\"rp-bottom\" style=\"grid-template-columns:minmax(0,1fr) minmax(0,1fr)\">\n      <section class=\"card\"><div class=\"card-h\"><h3>기사 <span class=\"sub\">권역당 활성 기사 1명이 배차됩니다</span></h3><button class=\"btn primary\" data-act=\"editdriver\">${icon('plus', 13)}기사 추가</button></div>\n        <div class=\"tbl-wrap\"><table class=\"tbl\"><thead><tr><th>이름</th><th>연락처</th><th>권역</th><th>차량</th><th class=\"r\">용량</th><th>상태</th><th></th></tr></thead><tbody>${rows || ''}</tbody></table></div></section>\n      <section class=\"card\"><div class=\"card-h\"><h3>권역 <span class=\"sub\">거점 좌표로 정차 순서를 계산</span></h3>${can('admin') ? `<button class=\"btn\" data-act=\"editregion\">${icon('plus', 13)}권역 추가</button>` : ''}</div>\n        <div class=\"tbl-wrap\"><table class=\"tbl\"><thead><tr><th>코드</th><th>권역</th><th>거점</th><th class=\"r\">반경</th><th></th></tr></thead><tbody>${regs}</tbody></table></div></section></div>`;\n  }\n  function admUsers(d) {\n    const rows = d.users.map((u) => `<tr><td><b class=\"strong\">${esc(u.name)}</b><span class=\"sub2\">${esc(u.email)}</span></td><td>${({ admin: '관리자', ops: '운영자', viewer: '열람' })[u.role]}</td><td>${u.disabled ? '<span class=\"badge b-mute\">비활성</span>' : u.must_change ? '<span class=\"badge b-warn\">비밀번호 변경 대기</span>' : '<span class=\"badge b-ok\">사용</span>'}</td><td>${u.last_login_at ? when(H(u.last_login_at)) : '—'}</td>\n      <td class=\"r\">${u.id !== DB.user.id ? `<select class=\"inp\" data-userrole=\"${u.id}\" style=\"width:auto;height:26px\">${['admin', 'ops', 'viewer'].map((r) => `<option value=\"${r}\" ${u.role === r ? 'selected' : ''}>${({ admin: '관리자', ops: '운영자', viewer: '열람' })[r]}</option>`).join('')}</select> <button class=\"btn sm\" data-act=\"userreset\" data-id=\"${u.id}\">비밀번호 초기화</button> <button class=\"btn sm\" data-act=\"usertoggle\" data-id=\"${u.id}\" data-disabled=\"${u.disabled ? 0 : 1}\">${u.disabled ? '활성화' : '비활성화'}</button>` : '<span class=\"muted\">본인</span>'}</td></tr>`).join('');\n    return `<section class=\"card\"><div class=\"card-h\"><h3>계정 <span class=\"sub\">관리자: 설정·계정 · 운영자: 운영 조치·매장 관리 · 열람: 조회만 (연락처 가림)</span></h3><button class=\"btn primary\" data-act=\"adduser\">${icon('plus', 13)}계정 추가</button></div>\n      <div class=\"tbl-wrap\"><table class=\"tbl\"><thead><tr><th>이름</th><th>권한</th><th>상태</th><th>마지막 로그인</th><th class=\"r\"></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;\n  }\n  const SETTING_GROUPS = [\n    ['운영 시간', ['cutoff', 'dispatch', 'delivery_days', 'night_start', 'night_end', 'break_from', 'break_to', 'break_send', 'expire_hours', 'auto_remind_min', 'retry_at']],\n    ['추정·발주 모델', ['cover_days', 'lookahead_days', 'safety_days', 'band_w0', 'band_beta', 'alpha_lr', 'default_rate']],\n    ['배송', ['driver_capacity', 'drive_min', 'stop_min']],\n    ['정산·지표', ['fee_rate', 'settle_lag_days', 'pilot_start', 'target_approval', 'target_stop', 'target_error']],\n    ['연동', ['pay_method', 'notifier', 'webhook_url', 'public_base_url']],\n    ['점주 직접 발주 · 카카오', ['order_min_amount', 'order_link_hours', 'kakao_channel_id', 'kakao_block_id', 'kakao_rest_key']],\n    ['정기 발주서 · 관리자 알림', ['sheet_time', 'alert_unconfirmed', 'alert_pick', 'alert_delivery']],\n  ];\n  function admSettings(d) {\n    const { values, spec } = d.settings;\n    const field = (k) => {\n      const s = spec[k], v = values[k];\n      const id = 'set-' + k;\n      if (s.type === 'enum') return `<label class=\"fld\"><span>${esc(s.label)}</span><select id=\"${id}\" data-setting=\"${k}\">${s.values.map((o) => `<option value=\"${o}\" ${o === v ? 'selected' : ''}>${({ invoice: '후불 청구 (월말)', sandbox_card: '카드 (샌드박스)', console: '콘솔 기록 (수동 전달)', webhook: '웹훅 (알림톡 대행사)' })[o] || o}</option>`).join('')}</select></label>`;\n      return `<label class=\"fld\"><span>${esc(s.label)}</span><input id=\"${id}\" data-setting=\"${k}\" value=\"${esc(v)}\" ${s.type === 'num' ? 'inputmode=\"decimal\"' : ''}></label>`;\n    };\n    return `<section class=\"card\"><div class=\"card-h\"><h3>운영 설정 <span class=\"sub\">저장 즉시 스케줄러에 반영</span></h3><button class=\"btn primary\" data-act=\"savesettings\">${icon('check', 13)}저장</button></div>\n      <div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:18px\">${SETTING_GROUPS.map(([g, keys]) => `<div><div class=\"sec-h\">${g}</div><div class=\"fgrid\" style=\"grid-template-columns:repeat(3,minmax(0,1fr))\">${keys.filter((k) => spec[k]).map(field).join('')}</div></div>`).join('')}\n      <div class=\"form-err\" id=\"setErr\"></div></div></section>`;\n  }\n  function admIntegrations(d) {\n    const ing = d.ingest;\n    const out = d.outbox.map((m) => `<tr><td class=\"num\">#${m.id}</td><td>${esc(m.kind)}</td><td><span class=\"badge ${m.status === 'failed' ? 'b-bad' : 'b-warn'}\">${m.status === 'failed' ? '실패' : '재시도 대기'}</span></td><td class=\"r num\">${m.attempts}</td><td>${esc(m.error || '')}</td></tr>`).join('');\n    return `<div class=\"rp-bottom\" style=\"grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)\">\n      <div style=\"display:flex;flex-direction:column;gap:14px\">\n        <section class=\"card\"><div class=\"card-h\"><h3>티오더 POS 판매 로그 수신</h3></div><div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:8px;font-size:12.5px\">\n          ${ing ? `<div>수신 주소 <span class=\"code\">POST ${esc(ing.endpoint)}</span></div>\n          <div>서명 키 <span class=\"code\">${esc(ing.secret.slice(0, 6))}…${esc(ing.secret.slice(-4))}</span> <button class=\"btn sm\" data-act=\"copysecret\" data-kind=\"ingest\">${icon('copy', 13)}복사</button> <button class=\"btn sm\" data-act=\"rotate\" data-name=\"ingest\">재발급</button></div>\n          <div class=\"muted\" style=\"font-size:11.5px;line-height:1.6\">헤더 <span class=\"code\">X-BevFlow-Timestamp</span>(ms)와 <span class=\"code\">X-BevFlow-Signature: sha256=HMAC(키, 타임스탬프 + \".\" + 본문)</span>을 붙여 보내면 됩니다. 같은 판매 ID는 한 번만 반영됩니다. 자세한 형식은 docs/INTEGRATIONS.md.</div>` : '<div class=\"muted\">관리자만 볼 수 있습니다</div>'}\n        </div></section>\n        <section class=\"card\"><div class=\"card-h\"><h3>CSV 가져오기 <span class=\"sub\">연동 전 · 과거 데이터 일괄 입력</span></h3></div><div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:10px\">\n          <div class=\"fgrid\"><label class=\"fld\"><span>종류</span><select id=\"impKind\"><option value=\"stores\">매장 (code,name,region_id,type,owner_name,owner_phone,address,lat,lng,pos_store_id,send_pref,skus)</option><option value=\"menu-map\">메뉴 매핑 (menu_name,sku_id,units,store_code)</option><option value=\"pos-sales\">POS 판매 (store,sale_id,sold_at,menu,qty)</option></select></label>\n          <label class=\"fld\"><span>파일 (UTF-8 CSV, 첫 줄은 머리글)</span><input type=\"file\" id=\"impFile\" accept=\".csv,text/csv\"></label></div>\n          <div class=\"hstack\"><button class=\"btn primary\" data-act=\"import\">${icon('download', 13)}가져오기</button><span class=\"muted\" id=\"impMsg\" style=\"font-size:12px\"></span></div>\n        </div></section>\n      </div>\n      <div style=\"display:flex;flex-direction:column;gap:14px\">\n        <section class=\"card\"><div class=\"card-h\"><h3>알림 발송</h3></div><div class=\"card-b\" style=\"font-size:12.5px;display:flex;flex-direction:column;gap:8px\">\n          <div>현재 방식: <b>${DB.settings.notifier === 'console' ? '콘솔 기록 (운영자가 링크를 복사해 전달)' : '웹훅 (알림톡 대행사로 전달)'}</b></div>\n          ${ing ? `<div>웹훅 서명 키 <span class=\"code\">${esc(ing.webhookSecret.slice(0, 6))}…</span> <button class=\"btn sm\" data-act=\"copysecret\" data-kind=\"webhook\">${icon('copy', 13)}복사</button> <button class=\"btn sm\" data-act=\"rotate\" data-name=\"webhook\">재발급</button></div>` : ''}\n          <div class=\"muted\" style=\"font-size:11.5px\">방식·웹훅 URL은 [운영 설정 → 연동]에서 바꿉니다.</div>\n          <div class=\"tbl-wrap\">${out ? `<table class=\"tbl\"><thead><tr><th>#</th><th>종류</th><th>상태</th><th class=\"r\">시도</th><th>오류</th></tr></thead><tbody>${out}</tbody></table>` : `<div class=\"empty\">${icon('check', 20)}대기·실패 메시지 없음</div>`}</div>\n        </div></section>\n        ${can('admin') ? `<section class=\"card\"><div class=\"card-h\"><h3>보안 · 데이터</h3></div><div class=\"card-b\" style=\"display:flex;flex-direction:column;gap:10px;font-size:12.5px\">\n          <div class=\"hstack\"><button class=\"btn\" data-act=\"rotate\" data-name=\"link\">링크 서명 키 재발급</button><span class=\"muted\" style=\"font-size:11.5px\">발급된 사장님·기사 링크가 모두 무효가 됩니다</span></div>\n          ${DB.settings.sampleData ? `<div class=\"hstack\"><button class=\"btn bad\" data-act=\"clearsample\">샘플 데이터 전체 삭제</button><span class=\"muted\" style=\"font-size:11.5px\">매장·발주·배송·실사 기록을 모두 지웁니다 (계정·설정은 유지)</span></div>` : ''}\n        </div></section>` : ''}\n      </div></div>`;\n  }\n\n  // ── 모달 ───────────────────────────────────────────────────\n  function modal({ title, sub = '', body, actions = [], size = 'sm', onAction }) {\n    const root = $('#modalRoot');\n    root.innerHTML = `<div class=\"modal-bg\" data-modal-bg><div class=\"modal ${size}\" role=\"dialog\" aria-modal=\"true\" aria-label=\"${esc(title)}\">\n      <div class=\"modal-h\"><div>${sub ? `<div class=\"muted\" style=\"font-size:11.5px\">${sub}</div>` : ''}<h2 style=\"font-size:16px\">${esc(title)}</h2></div><button class=\"xbtn\" data-modal-close aria-label=\"닫기\">${icon('x', 18)}</button></div>\n      <div class=\"modal-b\">${body}<div class=\"form-err\" id=\"mErr\"></div></div>\n      ${actions.length ? `<div class=\"modal-f\">${actions.map((a) => `<button class=\"btn ${a.cls || ''}\" data-modal-act=\"${a.id}\">${a.label}</button>`).join('')}</div>` : ''}</div></div>`;\n    const close = () => { root.innerHTML = ''; };\n    root.onclick = async (ev) => {\n      if (ev.target.matches('[data-modal-bg]') || ev.target.closest('[data-modal-close]')) return close();\n      const b = ev.target.closest('[data-modal-act]');\n      if (!b) return;\n      if (b.dataset.modalAct === 'cancel') return close();\n      b.disabled = true;\n      try { const r = await onAction(b.dataset.modalAct, root); if (r !== false) close(); } catch (e) { const m = $('#mErr', root); if (m) m.textContent = e.message; }\n      if (b.isConnected) b.disabled = false;\n    };\n    const f = root.querySelector('input:not([readonly]), select, textarea');\n    if (f) setTimeout(() => f.focus(), 30);\n    return close;\n  }\n  const closeModal = () => { $('#modalRoot').innerHTML = ''; };\n  const val = (root, id) => { const el = $('#' + id, root); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };\n\n  function approveModal(p) {\n    const st = S(p.store);\n    modal({\n      title: '대리 승인', sub: `${esc(st.name)} · ${esc(p.id)}`,\n      body: `<p style=\"margin:0 0 10px;font-size:12.5px\">사장님이 전화·방문으로 승인했을 때 사용합니다. 수량을 확인하고 사유를 남겨 주세요.</p>\n        <table class=\"tbl\"><thead><tr><th>SKU</th><th class=\"r\">수량(박스)</th></tr></thead><tbody>${p.lines.map((l) => `<tr><td>${esc(skuName(l.sku))}${l.trig ? ' <span class=\"badge b-bad nodot\">트리거</span>' : ''}</td><td class=\"r\"><input class=\"inp\" type=\"number\" min=\"0\" max=\"200\" step=\"1\" data-q=\"${esc(l.sku)}\" value=\"${l.qty}\" style=\"width:72px;text-align:right\"></td></tr>`).join('')}</tbody></table>\n        <label class=\"fld\" style=\"margin-top:10px\"><span>사유 (필수)</span><input id=\"apNote\" placeholder=\"예: 사장님 통화 확인 14:32\" maxlength=\"100\"></label>`,\n      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '승인 처리', cls: 'primary' }],\n      onAction: async (id, root) => {\n        const qty = {}; $$('[data-q]', root).forEach((i) => { qty[i.dataset.q] = Number(i.value); });\n        await api('POST', `/api/proposals/${p.pid}/approve`, { qty, note: val(root, 'apNote') });\n        state.ord.sel = p.pid; justMoved = p.pid;\n        await afterAction(`<b>${esc(st.name)}</b> 대리 승인 완료`);\n      },\n    });\n  }\n  function countModal(storeId, onboarding) {\n    const st = S(storeId) || (state.adm.data && state.adm.data.stores.find((s) => s.id === storeId));\n    const items = (S(storeId) ? S(storeId).items.map((it) => ({ id: it.sku.id, name: it.sku.name, pack: it.sku.pack, unit: it.sku.unit, est: it.E })) : []);\n    if (!items.length) return toast('취급 SKU를 먼저 지정하세요', 'alert');\n    modal({\n      title: onboarding ? '초기 잔량 입력' : '실사 입력', sub: esc(st.name),\n      body: `<p style=\"margin:0 0 10px;font-size:12.5px\">${onboarding ? '지금 매장에 남아 있는 음료를 세어 입력하면 이 시점부터 재고 추정과 발주 제안이 시작됩니다.' : '직접 센 잔량을 입력하면 추정과 오차 밴드가 리셋되고, 편차로 누수 보정 α를 학습합니다.'} 박스와 낱개로 나눠 입력하세요.</p>\n        <div class=\"cnt-grid\" style=\"grid-template-columns:1fr 70px 70px\"><span></span><span class=\"h\">박스</span><span class=\"h\">낱개</span>${items.map((it) => `<span>${esc(it.name)} <small class=\"muted\">${it.pack}${esc(it.unit)}/박스${onboarding ? '' : ' · 추정 ' + box(it.est)}</small></span><input type=\"number\" min=\"0\" step=\"1\" data-cb=\"${esc(it.id)}\" inputmode=\"numeric\" placeholder=\"0\"><input type=\"number\" min=\"0\" step=\"1\" data-cu=\"${esc(it.id)}\" inputmode=\"numeric\" placeholder=\"0\">`).join('')}</div>`,\n      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '저장', cls: 'primary' }],\n      onAction: async (id, root) => {\n        const counts = {};\n        for (const it of items) {\n          const b = $(`[data-cb=\"${it.id}\"]`, root).value, u = $(`[data-cu=\"${it.id}\"]`, root).value;\n          if (b === '' && u === '') { if (onboarding) throw new Error(`${it.name} 잔량을 입력해 주세요 (없으면 0)`); continue; }\n          counts[it.id] = (Number(b) || 0) + (Number(u) || 0) / it.pack;\n        }\n        if (!Object.keys(counts).length) throw new Error('한 개 이상 입력해 주세요');\n        await api('POST', `/api/stores/${storeId}/counts`, { counts, onboarding: !!onboarding });\n        if (state.adm.data) state.adm.data = null;\n        await afterAction(`<b>${esc(st.name)}</b> 잔량 ${Object.keys(counts).length}종 저장`);\n      },\n    });\n  }\n  async function linkModal(p) {\n    const j = await api('GET', `/api/proposals/${p.pid}/link`);\n    const st = S(p.store);\n    modal({\n      title: '사장님 링크 · 메시지', sub: `${esc(st.name)} · ${esc(st.phone || '연락처 없음')}`,\n      body: `<div class=\"fld\"><span>승인 링크 (사장님만 열 수 있게 전달하세요)</span><div class=\"copybox\"><input readonly id=\"lkUrl\" value=\"${esc(j.url)}\"><button class=\"btn\" data-copy=\"lkUrl\">${icon('copy', 13)}복사</button></div></div>\n        ${j.text ? `<div class=\"fld\" style=\"margin-top:12px\"><span>발송 메시지 전문</span><div class=\"pre\" id=\"lkText\">${esc(j.text)}</div><div><button class=\"btn\" data-copy-text=\"1\" style=\"margin-top:6px\">${icon('copy', 13)}메시지 복사</button></div></div>` : '<p class=\"muted\" style=\"font-size:12px\">아직 발송되지 않은 제안입니다.</p>'}`,\n      actions: [{ id: 'cancel', label: '닫기' }],\n      onAction: () => true,\n    });\n    const root = $('#modalRoot');\n    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($('#' + b.dataset.copy).value, '링크')));\n    const ct = root.querySelector('[data-copy-text]'); if (ct) ct.addEventListener('click', () => copyText(j.text, '메시지'));\n  }\n  async function copyText(text, label) {\n    try { await navigator.clipboard.writeText(text); toast(`${esc(label)}를 복사했습니다`, 'copy'); }\n    catch { modal({ title: label + ' 복사', body: `<p class=\"muted\" style=\"font-size:12px\">자동 복사가 막혀 있습니다. 아래 내용을 선택해 복사하세요.</p><textarea class=\"inp\" style=\"height:120px;width:100%\" readonly>${esc(text)}</textarea>`, actions: [{ id: 'cancel', label: '닫기' }], onAction: () => true }); const ta = $('#modalRoot textarea'); if (ta) { ta.focus(); ta.select(); } }\n  }\n  function storeModal(s) {\n    const d = state.adm.data;\n    const cur = s || { code: '', name: '', region_id: REGIONS[0] ? REGIONS[0].id : '', biz: 'restaurant', type: 'L', owner_name: '', owner_phone: '', address: '', lat: '', lng: '', pos_store_id: '', send_pref: 'immediate', review_required: 0, pay_test_fail: 0, active: 1, memo: '' };\n    modal({\n      title: s ? '매장 편집' : '매장 등록', size: '',\n      body: `<div class=\"fgrid\">\n        <label class=\"fld\"><span>매장 코드 (영문·숫자·-)</span><input id=\"f-code\" value=\"${esc(cur.code)}\" maxlength=\"30\"></label>\n        <label class=\"fld\"><span>매장명</span><input id=\"f-name\" value=\"${esc(cur.name)}\" maxlength=\"60\"></label>\n        <label class=\"fld\"><span>권역</span><select id=\"f-region_id\">${d.regions.map((r) => `<option value=\"${esc(r.id)}\" ${r.id === cur.region_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>\n        <label class=\"fld\"><span>업종 (기본 발주 품목)</span><select id=\"f-biz\">${Object.entries(d.biz).map(([id, b]) => `<option value=\"${id}\" ${id === (cur.biz || 'restaurant') ? 'selected' : ''}>${esc(b.label)} → ${esc(d.categories[b.category].label)}</option>`).join('')}</select></label>\n        <label class=\"fld\"><span>영업 유형 (POS 판매 시간대)</span><select id=\"f-type\"><option value=\"L\" ${cur.type === 'L' ? 'selected' : ''}>점심 중심 (식당)</option><option value=\"D\" ${cur.type === 'D' ? 'selected' : ''}>저녁 중심 (주점·포차)</option></select></label>\n        <label class=\"fld\"><span>사장님 성함</span><input id=\"f-owner_name\" value=\"${esc(cur.owner_name)}\" maxlength=\"30\"></label>\n        <label class=\"fld\"><span>사장님 휴대폰 (알림 수신)</span><input id=\"f-owner_phone\" value=\"${esc(cur.owner_phone)}\" maxlength=\"20\" placeholder=\"010-0000-0000\"></label>\n        <label class=\"fld full\"><span>주소</span><input id=\"f-address\" value=\"${esc(cur.address)}\" maxlength=\"200\"></label>\n        <label class=\"fld\"><span>위도 (정차 순서 계산)</span><input id=\"f-lat\" value=\"${esc(cur.lat ?? '')}\" inputmode=\"decimal\"></label>\n        <label class=\"fld\"><span>경도</span><input id=\"f-lng\" value=\"${esc(cur.lng ?? '')}\" inputmode=\"decimal\"></label>\n        <label class=\"fld\"><span>티오더 매장 ID (POS 로그 연결)</span><input id=\"f-pos_store_id\" value=\"${esc(cur.pos_store_id || '')}\" maxlength=\"60\"></label>\n        <label class=\"fld\"><span>발주 제안 발송</span><select id=\"f-send_pref\"><option value=\"immediate\" ${cur.send_pref !== 'break' ? 'selected' : ''}>즉시 발송</option><option value=\"break\" ${cur.send_pref === 'break' ? 'selected' : ''}>점심 피크 생성분은 브레이크타임에</option></select></label>\n        <label class=\"chk\"><input type=\"checkbox\" id=\"f-review_required\" ${cur.review_required ? 'checked' : ''}>운영자 검수 후 발송 (추정 편차가 큰 매장)</label>\n        <label class=\"chk\"><input type=\"checkbox\" id=\"f-active\" ${cur.active ? 'checked' : ''}>운영 중</label>\n        <label class=\"chk\"><input type=\"checkbox\" id=\"f-pay_test_fail\" ${cur.pay_test_fail ? 'checked' : ''}>결제 실패 테스트 (샌드박스 카드)</label>\n        <div class=\"fld full\"><span>정기 발주 요일 (이날 ${esc(state.adm.data.settings.values.sheet_time)}에 지난 발주 수량으로 발주서를 채워 사장님께 보냅니다 · 사우나 매점에 권장)</span><div class=\"chips\">${DOW.map((nm, i) => `<label class=\"chk\" style=\"margin-right:8px\"><input type=\"checkbox\" data-sday=\"${i}\" ${String(cur.standing_days || '').split(',').includes(String(i)) ? 'checked' : ''}>${nm}</label>`).join('')}</div></div>\n        <label class=\"fld full\"><span>메모</span><textarea id=\"f-memo\" maxlength=\"500\">${esc(cur.memo || '')}</textarea></label>\n        ${s ? '' : `<div class=\"fld full\"><span>취급 음료 SKU (식당 · POS 재고 추정 대상)</span><div class=\"chips\">${d.skus.filter((k) => k.active && k.category === 'beverage').map((k) => `<label class=\"chk\" style=\"margin-right:10px\"><input type=\"checkbox\" data-newsku=\"${esc(k.id)}\" ${['CL125', 'SD150'].includes(k.id) ? 'checked' : ''}>${esc(k.name)}</label>`).join('')}</div></div>`}\n      </div>`,\n      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: s ? '저장' : '등록', cls: 'primary' }],\n      onAction: async (id, root) => {\n        const b = {};\n        ['code', 'name', 'region_id', 'biz', 'type', 'owner_name', 'owner_phone', 'address', 'lat', 'lng', 'pos_store_id', 'send_pref', 'memo'].forEach((k) => { b[k] = val(root, 'f-' + k); });\n        b.standing_days = $$('[data-sday]', root).filter((x) => x.checked).map((x) => x.dataset.sday).join(',');\n        ['review_required', 'active', 'pay_test_fail'].forEach((k) => { b[k] = val(root, 'f-' + k); });\n        if (!s) b.skus = $$('[data-newsku]', root).filter((x) => x.checked).map((x) => x.dataset.newsku);\n        await api(s ? 'PUT' : 'POST', s ? `/api/admin/stores/${s.id}` : '/api/admin/stores', b);\n        state.adm.data = null;\n        await afterAction(s ? '매장 정보를 저장했습니다' : `<b>${esc(b.name)}</b> 등록 — 다음 단계: 초기 잔량 입력`);\n      },\n    });\n  }\n  function storeSkuModal(s) {\n    const d = state.adm.data;\n    const cur = new Map(d.storeSkus.filter((x) => x.store_id === s.id).map((x) => [x.sku_id, x]));\n    modal({\n      title: '취급 SKU', sub: esc(s.name), size: '',\n      body: `<table class=\"tbl\"><thead><tr><th>취급</th><th>SKU</th><th class=\"r\">판매 속도 (POS)</th><th class=\"r\">예상 일 판매 (수동)</th><th class=\"r\">안전재고 수동 (박스)</th></tr></thead><tbody>${d.skus.filter((k) => k.category === 'beverage' && (k.active || cur.has(k.id))).map((k) => { const x = cur.get(k.id) || {}; return `<tr><td><input type=\"checkbox\" data-carried=\"${esc(k.id)}\" ${x.carried ? 'checked' : ''}></td><td>${esc(k.name)}</td><td class=\"r num\">${x.rate != null ? num(x.rate, 2) : '<span class=\"muted\">이력 부족</span>'}</td><td class=\"r\"><input class=\"inp\" data-rate=\"${esc(k.id)}\" value=\"${x.rate_manual ?? ''}\" style=\"width:80px;text-align:right\" placeholder=\"자동\"></td><td class=\"r\"><input class=\"inp\" data-safety=\"${esc(k.id)}\" value=\"${x.safety_override ?? ''}\" style=\"width:80px;text-align:right\" placeholder=\"자동\"></td></tr>`; }).join('')}</tbody></table>\n        <p class=\"muted\" style=\"font-size:11.5px;margin:8px 0 0\">판매 이력이 3일 이상 쌓이면 POS 기준 속도를 자동으로 씁니다. 수동값은 새 매장 초기에만 필요합니다. 안전재고를 비우면 판매 속도 × 안전 일수로 자동 계산합니다.</p>`,\n      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '저장', cls: 'primary' }],\n      onAction: async (id, root) => {\n        const items = d.skus.filter((k) => k.category === 'beverage' && (k.active || cur.has(k.id))).map((k) => ({ sku_id: k.id, carried: $(`[data-carried=\"${k.id}\"]`, root).checked, rate_manual: $(`[data-rate=\"${k.id}\"]`, root).value, safety_override: $(`[data-safety=\"${k.id}\"]`, root).value }));\n        await api('PUT', `/api/admin/stores/${s.id}/skus`, { items });\n        state.adm.data = null;\n        await afterAction('취급 SKU를 저장했습니다');\n      },\n    });\n  }\n  function simpleForm({ title, fields, url, method, done }) {\n    modal({\n      title, size: '',\n      body: `<div class=\"fgrid\">${fields.map((f) => f.type === 'select' ? `<label class=\"fld ${f.full ? 'full' : ''}\"><span>${f.label}</span><select id=\"sf-${f.k}\">${f.options.map(([v, l]) => `<option value=\"${esc(v)}\" ${String(v) === String(f.v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : f.type === 'check' ? `<label class=\"chk\"><input type=\"checkbox\" id=\"sf-${f.k}\" ${f.v ? 'checked' : ''}>${f.label}</label>` : `<label class=\"fld ${f.full ? 'full' : ''}\"><span>${f.label}</span><input id=\"sf-${f.k}\" value=\"${esc(f.v ?? '')}\" ${f.ro ? 'readonly' : ''}></label>`).join('')}</div>`,\n      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '저장', cls: 'primary' }],\n      onAction: async (id, root) => {\n        const b = {}; fields.forEach((f) => { if (!f.ro || f.send) b[f.k] = val(root, 'sf-' + f.k); });\n        const r = await api(method, url, b);\n        state.adm.data = null;\n        await afterAction(done || '저장했습니다');\n        return r;\n      },\n    });\n  }\n\n  // ── 차트 인터랙션 ───────────────────────────────────────────\n  const tip = () => $('#tip');\n  function showTip(html, ev) {\n    const el = tip(); el.innerHTML = html; el.style.display = 'block';\n    const r = el.getBoundingClientRect();\n    let x = ev.clientX + 14, y = ev.clientY + 14;\n    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;\n    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;\n    el.style.left = x + 'px'; el.style.top = y + 'px';\n  }\n  const hideTip = () => { tip().style.display = 'none'; };\n  const svgPoint = (svg, ev) => { const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; return { x: (ev.clientX - r.left) / r.width * vb.width, y: (ev.clientY - r.top) / r.height * vb.height }; };\n  function bindCharts() {\n    const inv = $('#invChart');\n    if (inv && CHART) {\n      const hit = $('#hit', inv), cx = $('#cx', inv), cxd = $('#cxd', inv);\n      hit.addEventListener('pointermove', (ev) => {\n        const p = svgPoint(inv, ev), c = CHART;\n        const tt = c.t0 + (p.x - c.ml) / (c.W - c.ml - c.mr) * (c.t1 - c.t0);\n        let best = c.pts[0]; c.pts.forEach((q) => { if (Math.abs(q.t - tt) < Math.abs(best.t - tt)) best = q; });\n        const xx = c.x(best.t);\n        cx.setAttribute('x1', xx); cx.setAttribute('x2', xx); cx.setAttribute('visibility', 'visible');\n        cxd.setAttribute('cx', xx); cxd.setAttribute('cy', c.y(best.E)); cxd.setAttribute('visibility', 'visible');\n        const near = c.marks.filter((m) => Math.abs(m.t - best.t) < 3).map((m) => `<div class=\"tr\" style=\"line-height:1.45;margin-top:4px\"><span style=\"color:var(--ink)\">${esc(m.text)}</span></div>`).join('');\n        showTip(`<div class=\"tt\">${esc(when(best.t))}${best.f ? ' · 예측' : ''}</div>\n          <div class=\"tr\"><i class=\"k\"></i><b>${box(best.E)}박스</b><span>추정 재고</span></div>\n          <div class=\"tr\"><i class=\"k band\"></i><b>±${num(best.w, 2)}</b><span>하한 ${box(best.E - best.w)} · 상한 ${box(best.E + best.w)}</span></div>\n          <div class=\"tr\"><i class=\"k dash\"></i><b>${box(c.S)}</b><span>안전재고</span></div>${near}`, ev);\n      });\n      hit.addEventListener('pointerleave', () => { hideTip(); cx.setAttribute('visibility', 'hidden'); cxd.setAttribute('visibility', 'hidden'); });\n    }\n    const rm = $('#routeMap');\n    if (rm) {\n      rm.addEventListener('pointermove', (ev) => {\n        const p = svgPoint(rm, ev);\n        let best = null, bd = 1e9; CHART_ROUTE.forEach((n) => { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } });\n        if (best && bd < Math.max(12, best.r + 6)) showTip(best.html, ev); else hideTip();\n      });\n      rm.addEventListener('pointerleave', hideTip);\n    }\n    const hc = $('#histChart');\n    if (hc) {\n      const bars = $$('.hbar', hc);\n      hc.addEventListener('pointermove', (ev) => {\n        const p = svgPoint(hc, ev);\n        const b = CHART_BARS.findIndex((x) => p.x >= x.x && p.x < x.x + x.w);\n        bars.forEach((el) => { el.style.opacity = ''; });\n        if (b >= 0 && p.y > 10) { showTip(CHART_BARS[b].html, ev); const el = bars.find((e) => +e.dataset.i === b); if (el) el.style.opacity = '.75'; } else hideTip();\n      });\n      hc.addEventListener('pointerleave', () => { hideTip(); bars.forEach((el) => { el.style.opacity = ''; }); });\n    }\n    $$('.mhit').forEach((h) => {\n      const id = h.dataset.mini, c = CHART_MINI[id], svg = $('#mini-' + id), line = $('#mcx-' + id);\n      h.addEventListener('pointermove', (ev) => {\n        const p = svgPoint(svg, ev);\n        const i = Math.max(0, Math.min(c.vals.length - 1, Math.round((p.x - c.ml) / (c.W - c.ml - c.mr) * (c.vals.length - 1))));\n        line.setAttribute('x1', c.x(i)); line.setAttribute('x2', c.x(i)); line.setAttribute('visibility', 'visible');\n        const wk = DB.pilot.weeks[c.opt.first - 1 + i];\n        showTip(`<div class=\"tt\">W${c.opt.first + i} · ${md(H(wk.start))}–${md(H(wk.start) + 6 * 24)}${c.opt.first + i === DB.pilot.weeks.length ? ' (진행 중)' : ''}</div><div class=\"tr\"><i class=\"k\"></i><b>${c.vals[i] != null ? num(c.vals[i], 1) + c.opt.unit : '—'}</b><span>${c.opt.label}</span></div><div class=\"tr\"><i class=\"k dash\"></i><b>${num(c.opt.target, 0)}${c.opt.unit}</b><span>목표</span></div><div class=\"tr\"><span>표본 ${id === 'err' ? '실사 ' + num(wk.counts) + '건' : id === 'appr' ? '응답 ' + wk.decided + '건' : '정차 ' + wk.stops + '회'}</span></div>`, ev);\n      });\n      h.addEventListener('pointerleave', () => { hideTip(); line.setAttribute('visibility', 'hidden'); });\n    });\n  }\n\n  // ── 토스트 ─────────────────────────────────────────────────\n  function toast(msg, ic = 'check') {\n    const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = icon(ic, 16) + '<span>' + msg + '</span>';\n    $('#toasts').appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3800); setTimeout(() => el.remove(), 4200);\n  }\n\n  // ── 이벤트 바인딩 ───────────────────────────────────────────\n  function go(tab) { state.tab = tab; state.inv.open = false; hideTip(); try { localStorage.setItem('bf.tab', tab); } catch { /* 무시 */ } render(); $('#main').scrollTop = 0; }\n  document.addEventListener('click', async (ev) => {\n    if (!DB) return;\n    if (ev.target.closest('#modalRoot')) return;\n    const el = ev.target.closest('button, a[data-act], [data-order], [data-go], [data-pick-sku], [data-noti], [data-close-drawer]');\n    if (!el) { if (state.inv.open && !ev.target.closest('.combo')) { state.inv.open = false; render(); } return; }\n    const d = el.dataset;\n    if (d.tab) return go(d.tab);\n    if (d.region) { state.region = d.region; return render(); }\n    if (el.id === 'btnRefresh') { ETAG = null; await sync(true); return toast('최신 데이터로 갱신했습니다'); }\n    if (d.act) {\n      ev.stopPropagation();\n      const a = d.act;\n      const p = d.id ? DB.byId.get(+d.id) : null;\n      if (a === 'logout') { await api('POST', '/api/auth/logout', {}).catch(() => {}); location.href = '/login'; return; }\n      if (a === 'pwchange') { location.href = '/login?change=1'; return; }\n      if (a === 'approve' && p) return approveModal(p);\n      if (a === 'copylink' && p) return run(null, () => linkModal(p));\n      if (a === 'preview' && p) return run(null, async () => { const j = await api('GET', `/api/proposals/${p.pid}/link`); window.open(j.url + '#preview', '_blank', 'noopener'); });\n      if (a === 'hold' && p) return run(el, async () => { await api('POST', `/api/proposals/${p.pid}/hold`, {}); await afterAction('보류 처리 · 다음 날 재확인', 'clock'); });\n      if (a === 'remind' && p) return run(el, async () => { await api('POST', `/api/proposals/${p.pid}/remind`, {}); await afterAction('리마인드를 보냈습니다', 'send'); });\n      if (a === 'repay' && p) return run(el, async () => { const r = await api('POST', `/api/proposals/${p.pid}/retry-payment`, {}); await afterAction(r.result && r.result.status === 'paid' ? '재결제 완료' : '재결제 실패 — 사장님께 결제 수단 확인 요청', r.result && r.result.status === 'paid' ? 'card' : 'alert'); });\n      if (a === 'sendnow' && p) return run(el, async () => { await api('POST', `/api/proposals/${p.pid}/send-now`, {}); await afterAction('발주 제안을 발송했습니다', 'send'); });\n      if (a === 'cancel' && p) return modal({ title: '발주 취소', sub: esc(p.id), body: '<p style=\"font-size:12.5px;margin:0\">이 발주를 취소할까요? 사장님께 별도 안내가 나가지 않으니 필요하면 직접 연락하세요.</p>', actions: [{ id: 'cancel', label: '닫기' }, { id: 'ok', label: '취소 처리', cls: 'bad' }], onAction: async () => { await api('POST', `/api/proposals/${p.pid}/cancel`, {}); state.ord.sel = null; await afterAction('발주를 취소했습니다', 'x'); } });\n      if (a === 'propose') return run(el, async () => { await api('POST', `/api/stores/${d.store}/propose`, {}); await afterAction('선제 제안을 만들었습니다 — [발주 관제 → 제안 생성]에서 확인', 'send'); });\n      if (a === 'call') { const st = S(+d.store); return copyText(st && st.phone ? st.phone : '', '사장님 연락처'); }\n      if (a === 'count') return countModal(+d.store, d.onb === '1');\n      if (a === 'dispatch') return run(el, async () => { const r = await api('POST', '/api/dispatch', {}); const n = r.result.reduce((x, y) => x + y.added, 0); await afterAction(n ? `${n}건 배차했습니다` : '배차할 발주가 없습니다', 'truck'); });\n      if (a === 'driverlink') return run(null, async () => { const j = await api('GET', `/api/routes/${d.route}/link`); await copyText(j.url, '기사 링크'); });\n      if (a === 'stoparrive') return run(el, async () => { await api('POST', `/api/stops/${d.id}/arrive`, {}); await afterAction('도착 처리했습니다', 'truck'); });\n      if (a === 'stopdone') return modal({ title: '하차 완료 (운영자 대리)', body: '<p style=\"font-size:12.5px;margin:0\">기사에게 확인한 잔량이 있으면 [실사 입력]으로 따로 넣어 주세요. 잔량 없이 하차 완료만 처리합니다.</p>', actions: [{ id: 'cancel', label: '닫기' }, { id: 'ok', label: '하차 완료', cls: 'primary' }], onAction: async () => { await api('POST', `/api/stops/${d.id}/complete`, {}); await afterAction('하차 완료 처리했습니다', 'truck'); } });\n      if (a === 'stopfail') return modal({ title: '배송 실패', body: '<label class=\"fld\"><span>사유</span><select id=\"flR\"><option>매장 휴무</option><option>사장님 부재 · 연락 두절</option><option>주차 불가</option><option>차량 문제</option><option>기타</option></select></label>', actions: [{ id: 'cancel', label: '닫기' }, { id: 'ok', label: '실패 처리 (다음 배송일 재배차)', cls: 'bad' }], onAction: async (id, root) => { await api('POST', `/api/stops/${d.id}/fail`, { reason: val(root, 'flR') }); await afterAction('다음 배송일로 재배차됩니다', 'alert'); } });\n      if (a === 'settlepaid') return run(el, async () => { await api('POST', `/api/settlements/${d.week}/paid`, {}); await afterAction('지급 완료로 표시했습니다'); });\n      // 관리\n      const ad = state.adm.data;\n      if (a === 'editstore') return storeModal(d.id ? ad.stores.find((s) => s.id === +d.id) : null);\n      if (a === 'storeskus') return storeSkuModal(ad.stores.find((s) => s.id === +d.id));\n      if (a === 'editsku') { const k = d.id ? ad.skus.find((x) => x.id === d.id) : null; return simpleForm({ title: k ? 'SKU 편집' : 'SKU 추가', method: k ? 'PUT' : 'POST', url: k ? `/api/admin/skus/${encodeURIComponent(k.id)}` : '/api/admin/skus', fields: [{ k: 'id', label: 'SKU 코드 (영문 대문자·숫자)', v: k ? k.id : '', ro: !!k }, { k: 'name', label: 'SKU명', v: k ? k.name : '' }, { k: 'pack', label: '박스당 입수', v: k ? k.pack : 12 }, { k: 'unit', label: '단위', v: k ? k.unit : '병' }, { k: 'price', label: '박스(발주 단위) 단가 (원)', v: k ? k.price : '' }, { k: 'category', label: '품목 구분', type: 'select', v: k ? k.category : (state.adm.cat && state.adm.cat !== 'ALL' ? state.adm.cat : 'beverage'), options: Object.entries(ad.categories).map(([id, c]) => [id, c.icon + ' ' + c.label]) }, { k: 'spec', label: '규격 설명 (발주 화면 표시, 예: 1L × 12팩)', v: k ? k.spec : '' }, { k: 'grp', label: '매대·소분류 (예: 냉장고 ① 음료, 원두) — 품목이 많을 때 묶어 보여 줌', v: k ? k.grp : '' }, { k: 'sort', label: '정렬 순서', v: k ? k.sort : 0 }, { k: 'active', label: '판매 중', type: 'check', v: k ? k.active : 1 }] }); }\n      if (a === 'addmap') return simpleForm({ title: '메뉴 → SKU 매핑', method: 'POST', url: '/api/admin/menu-map', done: '매핑을 추가했습니다 — 이후 판매부터 재고에 반영', fields: [{ k: 'menu_name', label: 'POS 메뉴명 (정확히 일치)', v: d.menu || '', full: true }, { k: 'sku_id', label: 'SKU', type: 'select', options: ad.skus.map((k) => [k.id, k.name]) }, { k: 'units', label: '메뉴 1개당 SKU 수량 (병·캔)', v: 1 }, { k: 'store_id', label: '적용 매장', type: 'select', v: d.store || '', options: [['', '전체 매장 공통'], ...ad.stores.map((s) => [s.id, s.name])] }] });\n      if (a === 'delmap') return run(el, async () => { await api('DELETE', `/api/admin/menu-map/${d.id}`); state.adm.data = null; await afterAction('매핑을 삭제했습니다'); });\n      if (a === 'editdriver') { const x = d.id ? ad.drivers.find((v) => v.id === +d.id) : null; return simpleForm({ title: x ? '기사 편집' : '기사 추가', method: x ? 'PUT' : 'POST', url: x ? `/api/admin/drivers/${x.id}` : '/api/admin/drivers', fields: [{ k: 'name', label: '이름', v: x ? x.name : '' }, { k: 'phone', label: '휴대폰', v: x ? x.phone : '' }, { k: 'region_id', label: '권역', type: 'select', v: x ? x.region_id : '', options: ad.regions.map((r) => [r.id, r.name]) }, { k: 'vehicle', label: '차량', v: x ? x.vehicle : '' }, { k: 'capacity', label: '1일 용량 (곳)', v: x ? x.capacity : 60 }, { k: 'active', label: '운영 중', type: 'check', v: x ? x.active : 1 }] }); }\n      if (a === 'editregion') { const r = d.id ? ad.regions.find((v) => v.id === d.id) : null; return simpleForm({ title: r ? '권역 편집' : '권역 추가', method: r ? 'PUT' : 'POST', url: r ? `/api/admin/regions/${encodeURIComponent(r.id)}` : '/api/admin/regions', fields: [{ k: 'id', label: '권역 코드 (영문 대문자)', v: r ? r.id : '', ro: !!r }, { k: 'name', label: '권역명', v: r ? r.name : '' }, { k: 'area', label: '지역 (예: 강남·역삼)', v: r ? r.area : '' }, { k: 'hub_name', label: '거점명', v: r ? r.hub_name : '' }, { k: 'hub_lat', label: '거점 위도', v: r ? r.hub_lat : '' }, { k: 'hub_lng', label: '거점 경도', v: r ? r.hub_lng : '' }, { k: 'radius_km', label: '반경 (km)', v: r ? r.radius_km : 3 }, { k: 'sort', label: '정렬', v: r ? r.sort : 0 }] }); }\n      if (a === 'adduser') return modal({ title: '계정 추가', body: `<div class=\"fgrid\"><label class=\"fld\"><span>이름</span><input id=\"u-name\"></label><label class=\"fld\"><span>이메일</span><input id=\"u-email\" type=\"email\"></label><label class=\"fld\"><span>권한</span><select id=\"u-role\"><option value=\"ops\">운영자</option><option value=\"viewer\">열람</option><option value=\"admin\">관리자</option></select></label></div><p class=\"muted\" style=\"font-size:11.5px\">임시 비밀번호가 발급되며, 첫 로그인 때 새 비밀번호로 바꿔야 합니다.</p>`, actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '추가', cls: 'primary' }], onAction: async (id, root) => { const r = await api('POST', '/api/admin/users', { name: val(root, 'u-name'), email: val(root, 'u-email'), role: val(root, 'u-role') }); state.adm.data = null; await sync(true); modal({ title: '임시 비밀번호', body: `<p style=\"font-size:12.5px\">${esc(val(root, 'u-email'))} 계정의 임시 비밀번호입니다. 지금만 표시되니 안전하게 전달하세요.</p><div class=\"copybox\"><input readonly id=\"tmpPw\" value=\"${esc(r.tempPassword)}\"></div>`, actions: [{ id: 'cancel', label: '확인' }], onAction: () => true }); return false; } });\n      if (a === 'userreset') return run(el, async () => { const r = await api('PUT', `/api/admin/users/${d.id}`, { resetPassword: true }); state.adm.data = null; await sync(true); modal({ title: '비밀번호 초기화', body: `<p style=\"font-size:12.5px\">새 임시 비밀번호입니다. 지금만 표시됩니다.</p><div class=\"copybox\"><input readonly value=\"${esc(r.tempPassword)}\"></div>`, actions: [{ id: 'cancel', label: '확인' }], onAction: () => true }); });\n      if (a === 'usertoggle') return run(el, async () => { await api('PUT', `/api/admin/users/${d.id}`, { disabled: d.disabled === '1' }); state.adm.data = null; await afterAction('계정 상태를 바꿨습니다'); });\n      if (a === 'savesettings') return run(el, async () => { const b = {}; $$('[data-setting]').forEach((i) => { const spec = state.adm.data.settings.spec[i.dataset.setting]; b[i.dataset.setting] = spec.type === 'num' ? Number(i.value) : i.value; }); try { await api('PUT', '/api/admin/settings', b); } catch (e) { $('#setErr').textContent = e.message; throw e; } state.adm.data = null; await afterAction('운영 설정을 저장했습니다'); });\n      if (a === 'access') {\n        const cat = ad.categories[d.cat], st = ad.stores.find((x) => x.id === +d.store);\n        const word = { approve: '승인', reject: '거절', revoke: '이용 해제' }[d.do];\n        return modal({ title: `${cat.label} ${word}`, sub: esc(st ? st.name : ''),\n          body: `<p style=\"font-size:12.5px;margin:0 0 10px\">${d.do === 'approve' ? '승인하면 점주 발주 화면과 카카오톡 채널에 이 품목이 열리고, 사장님께 알림톡으로 안내됩니다.' : d.do === 'reject' ? '사장님께 미승인 안내 알림톡이 나갑니다. 사유를 남기면 함께 전달됩니다.' : '이 매장은 더 이상 이 품목을 발주할 수 없게 됩니다. 장바구니에 담긴 해당 품목도 비워집니다.'}</p>\n            <label class=\"fld\"><span>메모${d.do === 'reject' ? ' (사장님께 전달)' : ''}</span><input id=\"acNote\" maxlength=\"100\"></label>`,\n          actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: word, cls: d.do === 'approve' ? 'primary' : 'bad' }],\n          onAction: async (id, root) => { await api('POST', `/api/admin/access/${d.store}/${d.cat}`, { action: d.do, note: val(root, 'acNote') }); state.adm.data = null; await afterAction(`${esc(cat.label)} ${word} 처리했습니다`); } });\n      }\n      if (a === 'linkcode') return run(el, async () => {\n        const r = await api('POST', `/api/admin/stores/${d.id}/link-code`, {}); state.adm.data = null; await sync(true);\n        const st = ad.stores.find((x) => x.id === +d.id);\n        modal({ title: '카카오 연결 코드', sub: esc(st ? st.name : ''), body: `<p style=\"font-size:12.5px;margin:0 0 10px\">사장님께 이 6자리 숫자를 알려 주세요. 카카오톡 채널 채팅방에 보내거나 [매장 연결하기] 화면에 입력하면 연결됩니다. 한 번 쓰면 사라지며, 다시 발급하면 이전 코드는 무효가 됩니다.</p><div class=\"copybox\"><input readonly id=\"lcode\" value=\"${esc(r.code)}\" style=\"font-size:22px;letter-spacing:.3em;text-align:center\"><button class=\"btn\" data-copy=\"lcode\">${icon('copy', 13)}복사</button></div>`, actions: [{ id: 'cancel', label: '닫기' }], onAction: () => true });\n        $('#modalRoot [data-copy]').addEventListener('click', () => copyText(r.code, '연결 코드'));\n      });\n      if (a === 'orderlink') {\n        const st = ad.stores.find((x) => x.id === +d.id);\n        return run(el, async () => {\n          const r = await api('POST', `/api/admin/stores/${d.id}/order-link`, {});\n          modal({ title: '발주 화면 링크', sub: esc(st ? st.name : ''), body: `<p style=\"font-size:12.5px;margin:0 0 10px\">로그인 없이 이 매장으로 발주할 수 있는 링크입니다 (유효 ${esc(DB.settings.orderLinkHours || '')}시간). 사장님께만 전달하세요. 사장님이 요청하지 않은 발주 권유는 알림톡으로 보낼 수 없어서(광고로 분류) 복사해 전달합니다.</p><div class=\"copybox\"><input readonly id=\"olink\" value=\"${esc(r.url)}\"><button class=\"btn\" data-copy=\"olink\">${icon('copy', 13)}복사</button></div>`,\n            actions: [{ id: 'cancel', label: '닫기' }], onAction: () => true });\n          $('#modalRoot [data-copy]').addEventListener('click', () => copyText(r.url, '발주 링크'));\n        });\n      }\n      if (a === 'sheetnow') {\n        const st = ad.stores.find((x) => x.id === +d.id);\n        return modal({ title: '정기 발주서 지금 보내기', sub: esc(st ? st.name : ''), body: '<p style=\"font-size:12.5px;margin:0\">지난 발주 수량으로 발주서를 채우고(이미 담긴 장바구니가 있으면 그대로 둠) 사장님께 [발주서 확인하기] 알림톡을 보냅니다.</p>', actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '보내기', cls: 'primary' }],\n          onAction: async () => { const r = await api('POST', `/api/admin/stores/${d.id}/sheet`, { notify: true }); state.adm.data = null; await afterAction(`발주서를 보냈습니다 · ${r.result.count}품목`, 'send'); } });\n      }\n      if (a === 'kakaotest') return run(el, async () => { await api('POST', '/api/me/kakao/test', {}); toast('테스트 알림을 보냈습니다 — 카카오톡 나와의 채팅을 확인하세요', 'send'); });\n      if (a === 'kakaounlink') return run(el, async () => { await api('DELETE', '/api/me/kakao'); state.adm.data = null; await afterAction('카톡 알림 연결을 해제했습니다'); });\n      if (a === 'revokelinks') return modal({ title: '발주 링크·카카오 연결 초기화', body: '<p style=\"font-size:12.5px;margin:0\">이 매장에 발급된 발주 화면 링크가 모두 열리지 않게 되고, 연결된 카카오 계정(채널·로그인)이 모두 해제됩니다. 점주 변경·휴대폰 분실 때 사용하세요.</p>', actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '초기화', cls: 'bad' }], onAction: async () => { await api('POST', `/api/admin/stores/${d.id}/revoke-links`, {}); state.adm.data = null; await afterAction('초기화했습니다'); } });\n      if (a === 'unlink') { ev.preventDefault(); return run(null, async () => { await api('DELETE', `/api/admin/kakao-links/${d.id}`); state.adm.data = null; await afterAction('카카오 연결을 해제했습니다'); }); }\n      if (a === 'copyval') return copyText($('#' + d.src).value, '주소');\n      if (a === 'copytext') return copyText(d.text, '주소');\n      if (a === 'copysecret') return copyText(d.kind === 'ingest' ? state.adm.data.ingest.secret : state.adm.data.ingest.webhookSecret, '서명 키');\n      if (a === 'rotate') return modal({ title: '키 재발급', body: `<p style=\"font-size:12.5px;margin:0\">${d.name === 'link' ? '이미 보낸 사장님 승인 링크와 기사 링크가 모두 열리지 않게 됩니다.' : '연동 상대방에도 새 키를 반영해야 수신·발송이 이어집니다.'} 계속할까요?</p>`, actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '재발급', cls: 'bad' }], onAction: async () => { await api('POST', `/api/admin/secrets/${d.name}/rotate`, {}); state.adm.data = null; await afterAction('키를 재발급했습니다'); } });\n      if (a === 'clearsample') return modal({ title: '샘플 데이터 삭제', body: `<p style=\"font-size:12.5px\">매장·SKU·권역·기사·발주·배송·실사·POS 기록이 모두 삭제됩니다. 계정과 운영 설정은 남습니다.</p><label class=\"fld\"><span>확인을 위해 <b>샘플 삭제</b>를 입력하세요</span><input id=\"cfm\"></label>`, actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '전체 삭제', cls: 'bad' }], onAction: async (id, root) => { await api('POST', '/api/admin/sample/clear', { confirm: val(root, 'cfm') }); state.adm.data = null; await afterAction('샘플 데이터를 삭제했습니다'); } });\n      if (a === 'import') return run(el, async () => { const f = $('#impFile').files[0]; if (!f) throw new Error('CSV 파일을 선택하세요'); const r = await api('POST', `/api/admin/import/${$('#impKind').value}`, await f.text(), { raw: true }); state.adm.data = null; await afterAction(`${r.ok}건 반영${r.errorCount ? ` · 오류 ${r.errorCount}건` : ''}`); if (r.errors.length) modal({ title: '가져오기 오류', body: `<div class=\"pre\">${esc(r.errors.join('\\n'))}</div>`, actions: [{ id: 'cancel', label: '닫기' }], onAction: () => true }); });\n    }\n    if (d.adm) { state.adm.sub = d.adm; return render(); }\n    if (d.skucat) { state.adm.cat = d.skucat; return render(); }\n    if (d.filterKind) { ev.stopPropagation(); state.actFilter = state.actFilter === d.filterKind ? 'ALL' : d.filterKind; return render(); }\n    if (d.actFilter) { state.actFilter = d.actFilter; return render(); }\n    if (d.go) {\n      const [kind, a, b] = d.go.split(':');\n      if (kind === 'order') { state.tab = 'orders'; state.ord.sel = +a; return render(); }\n      if (kind === 'inv') { state.tab = 'inventory'; state.inv.store = +a; const st = S(+a); state.inv.sku = b || (st && st.items[0] ? st.items[0].sku.id : null); state.inv.status = 'ALL'; return render(); }\n      if (kind === 'admin') { state.tab = 'admin'; state.adm.sub = a; return render(); }\n    }\n    if (el.id === 'storeBtn') { state.inv.open = !state.inv.open; state.inv.q = ''; render(); const q = $('#storeQ'); if (q) q.focus(); return; }\n    if (d.pickStore) { state.inv.store = +d.pickStore; state.inv.open = false; state.inv.status = 'ALL'; const st = S(state.inv.store); if (st && !st.items.some((x) => x.sku.id === state.inv.sku)) state.inv.sku = st.items[0] ? st.items[0].sku.id : null; return render(); }\n    if (d.badgeSku) { ev.stopPropagation(); state.inv.sku = d.badgeSku; return render(); }\n    if (d.pickSku) { state.inv.sku = d.pickSku; return render(); }\n    if (d.invStatus) { state.inv.status = d.invStatus; return render(); }\n    if (d.order) { state.ord.sel = state.ord.sel === +d.order ? null : +d.order; return render(); }\n    if (d.closeDrawer != null) { state.ord.sel = null; return render(); }\n    if (d.notiFilter) { ev.stopPropagation(); state.noti.filter = state.noti.filter === d.notiFilter && el.classList.contains('badge') ? 'ALL' : d.notiFilter; state.noti.sel = null; return render(); }\n    if (d.notiDay) { state.noti.day = +d.notiDay; state.noti.filter = 'ALL'; state.noti.sel = null; return render(); }\n    if (d.noti) { state.noti.sel = +d.noti; return render(); }\n    if (d.delScope) { state.del.scope = d.delScope; return render(); }\n    if (d.perf) { state.rep.perf = d.perf; return render(); }\n  });\n  document.addEventListener('change', async (ev) => {\n    if (ev.target.id === 'skuSel') { state.inv.sku = ev.target.value; render(); }\n    if (ev.target.dataset && ev.target.dataset.kpref) {\n      try { const m = await api('PUT', '/api/me/kakao', { prefs: { [ev.target.dataset.kpref]: ev.target.checked } }); if (state.adm.data) state.adm.data.meKakao = m; toast('알림 설정을 저장했습니다'); } catch (e) { toast(esc(e.message), 'alert'); }\n    }\n    if (ev.target.dataset && ev.target.dataset.userrole) {\n      try { await api('PUT', `/api/admin/users/${ev.target.dataset.userrole}`, { role: ev.target.value }); state.adm.data = null; await afterAction('권한을 바꿨습니다'); } catch (e) { toast(esc(e.message), 'alert'); }\n    }\n  });\n  document.addEventListener('input', (ev) => {\n    if (ev.target.id === 'storeQ') { state.inv.q = ev.target.value; const pos = ev.target.selectionStart; render(); const q = $('#storeQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }\n    if (ev.target.id === 'admQ') { state.adm.q = ev.target.value; const pos = ev.target.selectionStart; render(); const q = $('#admQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }\n  });\n  document.addEventListener('keydown', (ev) => {\n    if (!DB) return;\n    if (ev.key === 'Escape') { if ($('#modalRoot').innerHTML) return closeModal(); if (state.inv.open) state.inv.open = false; else state.ord.sel = null; return render(); }\n    if (ev.target.matches('input, select, textarea')) return;\n    if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.order) { ev.target.click(); return; }\n    const n = +ev.key; if (n >= 1 && n <= TABS.length && !ev.metaKey && !ev.ctrlKey && !ev.altKey) go(TABS[n - 1].id);\n  });\n\n  // ── 주기 작업 ───────────────────────────────────────────────\n  setInterval(() => {\n    if (!DB) return;\n    tickClock();\n    const t = nowH();\n    $$('[data-since]').forEach((el) => { const s = parseFloat(el.dataset.since); if (isFinite(s)) el.textContent = durTxt((t - s) * 60); });\n    if (kstMid(nowTs()) !== TODAY0) sync(true); // 자정이 지나면 날짜 기준 재계산\n  }, 1000);\n  setInterval(() => { if (document.visibilityState === 'visible') sync(false); }, 20000);\n  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(false); });\n\n  (async () => {\n    await sync(true);\n    if (DB) $('#boot').classList.add('hide');\n    // 카카오 알림 연결에서 돌아온 경우 (/?kakao=ok 또는 오류 문구)\n    if (location.hash === '#access' && DB) { history.replaceState(null, '', '/'); state.tab = 'admin'; state.adm.sub = 'kakao'; render(); } // 관리자 카톡 알림 [승인하러 가기]\n    const kq = new URLSearchParams(location.search).get('kakao');\n    if (kq && DB) {\n      history.replaceState(null, '', '/');\n      state.tab = 'admin'; state.adm.sub = 'kakao'; render();\n      toast(kq === 'ok' ? '카톡 알림을 연결했습니다 — [테스트 알림 보내기]로 확인하세요' : esc(kq), kq === 'ok' ? 'check' : 'alert');\n    }\n  })();\n})();\n",
"assets/driver.js": "'use strict';\n// 기사 배송 페이지 — 배차 때 발급되는 라우트 링크 (로그인 없음)\n// 순서: [도착] → 하차 전 잔량 입력(박스·낱개) → [하차 완료]. 잔량은 재고 추정 보정에 바로 쓰인다.\n(() => {\n  const app = document.getElementById('app');\n  const token = location.pathname.split('/d/')[1] || '';\n  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n  const KST = 9 * 3600e3;\n  const hm = (ts) => { if (!ts) return '—'; const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };\n  let V = null, openStop = null, draft = {};\n  try { draft = JSON.parse(localStorage.getItem('bf.drv.' + token.slice(-12)) || '{}'); } catch { draft = {}; }\n  const saveDraft = () => { try { localStorage.setItem('bf.drv.' + token.slice(-12), JSON.stringify(draft)); } catch { /* 저장 불가 */ } };\n\n  async function call(method, path, body) {\n    const r = await fetch('/api/driver/' + encodeURIComponent(token) + path, { method, headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: body ? JSON.stringify(body) : undefined });\n    const j = await r.json().catch(() => ({}));\n    if (!r.ok) throw new Error(j.error || '처리하지 못했습니다');\n    return j;\n  }\n  function render() {\n    const done = V.stops.filter((s) => s.status === 'done').length;\n    const cur = V.stops.find((s) => s.status === 'arrived') || V.stops.find((s) => s.status === 'pending');\n    if (openStop == null && cur) openStop = cur.id;\n    app.innerHTML = `<div class=\"m-head\"><span class=\"pf\">B</span><div><b>${esc(V.driver || '기사')}님 · ${esc(V.region)}</b><small>${esc(V.date)} · ${esc(V.hub)} 출발 · 완료 ${done}/${V.stops.length}</small></div></div>\n      ${V.stops.map(stopCard).join('')}\n      ${done === V.stops.length ? '<div class=\"m-card m-done\"><div class=\"m-lead\">✓ 오늘 배송을 모두 마쳤어요. 수고하셨습니다!</div></div>' : ''}\n      <p class=\"m-note\">문제가 있으면 [배송 실패]로 사유를 남기면 다음 배송일에 다시 배차됩니다.</p>`;\n  }\n  function stopCard(s) {\n    const cls = s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : s.id === openStop ? 'cur' : '';\n    const status = { pending: '대기', arrived: '하차 중', done: `완료 ${hm(s.departedAt)}`, failed: '실패 · ' + esc(s.failReason || '') }[s.status];\n    const map = s.address ? `<a href=\"https://map.kakao.com/link/search/${encodeURIComponent(s.address)}\" target=\"_blank\" rel=\"noopener noreferrer\">지도</a>` : '';\n    const tel = s.phone ? `<a href=\"tel:${esc(s.phone.replace(/[^0-9+]/g, ''))}\">${esc(s.phone)}</a>` : '';\n    let body = '';\n    if (s.id === openStop && (s.status === 'pending' || s.status === 'arrived')) {\n      body = `<div class=\"m-row\"><b>하차</b> ${s.unload.map((u) => `${esc(u.name)} ${u.qty}박스`).join(' · ')}</div>`;\n      if (s.status === 'pending') body += `<div class=\"m-btns\"><button class=\"m-btn pri\" data-arrive=\"${s.id}\">도착</button><button class=\"m-btn bad\" data-fail=\"${s.id}\">배송 실패</button></div>`;\n      else {\n        const dv = draft[s.id] || {};\n        body += `<div class=\"m-note\">하차하기 <b>전에</b> 매장에 남은 음료를 세어 주세요. 없으면 0.</div>\n          <div class=\"cnt-grid\"><span></span><span class=\"h\">박스</span><span class=\"h\">낱개</span>${s.count.map((c) => `<span>${esc(c.name)}<br><small class=\"muted\">${c.pack}${esc(c.unit)}/박스</small></span><input type=\"number\" min=\"0\" inputmode=\"numeric\" data-b=\"${esc(c.sku)}\" value=\"${esc(dv[c.sku + ':b'] ?? '')}\" aria-label=\"${esc(c.name)} 박스\"><input type=\"number\" min=\"0\" inputmode=\"numeric\" data-u=\"${esc(c.sku)}\" value=\"${esc(dv[c.sku + ':u'] ?? '')}\" aria-label=\"${esc(c.name)} 낱개\">`).join('')}</div>\n          <div class=\"m-btns\"><button class=\"m-btn pri\" data-done=\"${s.id}\">잔량 저장 · 하차 완료</button><button class=\"m-btn bad\" data-fail=\"${s.id}\">배송 실패</button></div>`;\n      }\n    }\n    return `<section class=\"m-card m-stop ${cls}\" data-open=\"${s.id}\">\n      <div class=\"m-row\" style=\"justify-content:space-between\"><b style=\"font-size:15px\">${s.seq}. ${esc(s.store)}</b><span class=\"badge ${s.status === 'done' ? 'b-ok' : s.status === 'failed' ? 'b-bad' : s.status === 'arrived' ? 'b-warn' : 'b-mute'}\">${status}</span></div>\n      <div class=\"m-row\"><span class=\"muted\">예정 ${hm(s.eta)}</span><span class=\"muted\">·</span><span>${s.boxes}박스</span>${map ? '<span class=\"muted\">·</span>' + map : ''}${tel ? '<span class=\"muted\">·</span>' + tel : ''}</div>\n      ${s.address ? `<div class=\"m-note\">${esc(s.address)}</div>` : ''}${body}</section>`;\n  }\n  app.addEventListener('input', (e) => {\n    const t = e.target; const sid = openStop;\n    if (!sid || !(t.dataset.b || t.dataset.u)) return;\n    draft[sid] = draft[sid] || {};\n    draft[sid][(t.dataset.b || t.dataset.u) + (t.dataset.b ? ':b' : ':u')] = t.value;\n    saveDraft();\n  });\n  app.addEventListener('click', async (e) => {\n    const b = e.target.closest('button');\n    const card = e.target.closest('[data-open]');\n    if (!b && card && !e.target.closest('a, input')) { openStop = +card.dataset.open; render(); return; }\n    if (!b) return;\n    b.disabled = true;\n    try {\n      if (b.dataset.arrive) V = await call('POST', `/stops/${b.dataset.arrive}/arrive`, {});\n      if (b.dataset.done) {\n        const s = V.stops.find((x) => x.id === +b.dataset.done);\n        const counts = {};\n        for (const c of s.count) {\n          const bx = app.querySelector(`[data-b=\"${c.sku}\"]`).value, un = app.querySelector(`[data-u=\"${c.sku}\"]`).value;\n          if (bx === '' && un === '') throw new Error(`${c.name} 잔량을 입력해 주세요 (없으면 0)`);\n          counts[c.sku] = (Number(bx) || 0) + (Number(un) || 0) / c.pack;\n        }\n        V = await call('POST', `/stops/${s.id}/complete`, { counts });\n        delete draft[s.id]; saveDraft(); openStop = null;\n      }\n      if (b.dataset.fail) {\n        const reason = await askReason();\n        if (!reason) { b.disabled = false; return; }\n        V = await call('POST', `/stops/${b.dataset.fail}/fail`, { reason });\n        openStop = null;\n      }\n      render();\n    } catch (err) {\n      b.disabled = false;\n      const d = document.createElement('div'); d.className = 'alert-line bad'; d.textContent = err.message;\n      app.prepend(d); setTimeout(() => d.remove(), 5000);\n    }\n  });\n  function askReason() {\n    return new Promise((resolve) => {\n      const wrap = document.createElement('div');\n      wrap.className = 'modal-bg';\n      wrap.innerHTML = `<div class=\"modal sm\"><div class=\"modal-h\"><h2 style=\"font-size:16px\">배송 실패 사유</h2></div><div class=\"modal-b m-btns\">${['매장 휴무', '사장님 부재 · 연락 두절', '주차 불가', '차량 문제', '기타'].map((r) => `<button class=\"m-btn\" data-r=\"${r}\">${r}</button>`).join('')}<button class=\"m-btn\" data-r=\"\">취소</button></div></div>`;\n      document.body.appendChild(wrap);\n      wrap.addEventListener('click', (e) => { const x = e.target.closest('[data-r]'); if (!x) return; wrap.remove(); resolve(x.dataset.r); });\n    });\n  }\n  const load = () => call('GET', '').then((v) => { V = v; render(); }).catch((e) => { app.innerHTML = `<div class=\"m-card m-done\"><div class=\"m-lead\">${esc(e.message)}</div><p class=\"m-note\">운영팀에 새 링크를 요청하세요.</p></div>`; });\n  load();\n  setInterval(() => { if (document.visibilityState === 'visible' && !app.querySelector('input:focus')) call('GET', '').then((v) => { V = v; render(); }).catch(() => {}); }, 60000);\n})();\n",
"assets/kakao-link.js": "'use strict';\n// 매장 연결 (/k/link) — 카카오톡 채널 챗봇·카카오 로그인 사용자를 매장에 묶는다.\n// ?t= 챗봇 사용자 토큰 · ?l= 카카오 로그인 사용자 토큰(번호로 자동 연결 실패 시) · ?err= 오류 안내\n(() => {\n  const app = document.getElementById('app');\n  const qs = new URLSearchParams(location.search);\n  const t = qs.get('t') || '', l = qs.get('l') || '', err = qs.get('err') || '';\n  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n  const head = '<div class=\"m-head\"><span class=\"pf\">B</span><div><b>BevFlow 매장 연결</b><small>처음 한 번만 연결하면 돼요</small></div></div>';\n\n  function render(info) {\n    if (!t && !l) {\n      app.innerHTML = `${head}${err ? `<div class=\"alert-line bad\">${esc(err)}</div>` : ''}\n        <section class=\"m-card\"><div class=\"m-lead\">카카오톡 <b>BevFlow 채널</b>에서 [발주하기]를 눌러 시작해 주세요.</div>\n        ${info.login ? '<a class=\"m-btn s-kakao\" href=\"/k/login\">카카오 로그인으로 시작하기</a>' : ''}</section>`;\n      return;\n    }\n    app.innerHTML = `${head}${err ? `<div class=\"alert-line bad\">${esc(err)}</div>` : ''}\n      ${l ? '<div class=\"alert-line warn\">카카오 계정의 휴대폰 번호와 등록된 사장님 번호가 달라 자동으로 연결하지 못했어요. 연결 코드를 입력해 주세요.</div>' : ''}\n      <section class=\"m-card\"><h2>연결 코드 6자리</h2><p class=\"m-note\" style=\"margin:0\">BevFlow 운영팀이 문자·전화로 알려 드린 숫자예요.</p>\n        <input id=\"code\" class=\"s-code\" inputmode=\"numeric\" autocomplete=\"one-time-code\" maxlength=\"6\" pattern=\"[0-9]*\" placeholder=\"000000\" aria-label=\"연결 코드 6자리\">\n        <div class=\"form-err\" id=\"e\"></div>\n        <button class=\"m-btn pri\" id=\"go\">매장 연결하기</button></section>\n      ${t && info.login ? `<section class=\"m-card\"><div class=\"m-note\" style=\"margin:0\">연결 코드가 없나요? 사장님 휴대폰 번호로 가입한 카카오 계정이면 자동으로 연결돼요.</div>\n        <a class=\"m-btn s-kakao\" href=\"/k/login?t=${encodeURIComponent(t)}\">카카오 로그인으로 연결</a></section>` : ''}`;\n    const code = document.getElementById('code');\n    code.addEventListener('input', () => { code.value = code.value.replace(/\\D/g, '').slice(0, 6); if (code.value.length === 6) go(); });\n    document.getElementById('go').addEventListener('click', go);\n    code.focus();\n  }\n  async function go() {\n    const btn = document.getElementById('go'), e = document.getElementById('e');\n    if (btn.disabled) return;\n    btn.disabled = true; e.textContent = '';\n    try {\n      const r = await fetch('/api/kakao/link', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: JSON.stringify({ t, l, code: document.getElementById('code').value }) });\n      const j = await r.json().catch(() => ({}));\n      if (!r.ok) throw new Error(j.error || '연결하지 못했어요');\n      app.innerHTML = `${head}<section class=\"m-card m-done s-done\"><div class=\"s-check\">✓</div><div class=\"m-lead\"><b>${esc(j.store)}</b><br>연결이 끝났어요</div>\n        <p class=\"m-note\">이제 카카오톡 채널에서 버튼만 눌러 발주할 수 있어요.</p><a class=\"m-btn pri s-linkbtn\" href=\"${esc(j.orderUrl)}\">지금 발주하기</a></section>`;\n    } catch (ex) { e.textContent = ex.message; btn.disabled = false; }\n  }\n  fetch('/api/kakao/link-info').then((r) => r.json()).catch(() => ({})).then(render);\n})();\n",
"assets/login.js": "'use strict';\n// 로그인 · 비밀번호 변경\n(() => {\n  const $ = (s) => document.querySelector(s);\n  const post = async (url, body) => {\n    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: JSON.stringify(body), credentials: 'same-origin' });\n    const j = await r.json().catch(() => ({}));\n    if (!r.ok) throw new Error(j.error || '요청에 실패했습니다');\n    return j;\n  };\n  const showChange = () => { $('#loginForm').hidden = true; $('#changeForm').hidden = false; $('#cur').focus(); };\n  if (new URLSearchParams(location.search).get('change') === '1') {\n    fetch('/api/me', { credentials: 'same-origin' }).then((r) => (r.ok ? showChange() : null));\n  }\n  $('#loginForm').addEventListener('submit', async (e) => {\n    e.preventDefault();\n    $('#err').textContent = '';\n    try {\n      const j = await post('/api/auth/login', { email: $('#email').value.trim(), password: $('#password').value });\n      if (j.user.must_change) { $('#cur').value = $('#password').value; showChange(); return; }\n      const next = new URLSearchParams(location.search).get('next') || '';\n      location.href = /^\\/[a-z]{0,10}$/.test(next) ? next : '/'; // 관리자 카톡 알림 버튼(/a)에서 온 경우 되돌아간다\n    } catch (err) { $('#err').textContent = err.message; }\n  });\n  $('#changeForm').addEventListener('submit', async (e) => {\n    e.preventDefault();\n    $('#err2').textContent = '';\n    if ($('#next').value !== $('#next2').value) { $('#err2').textContent = '새 비밀번호가 서로 다릅니다'; return; }\n    try {\n      await post('/api/auth/password', { current: $('#cur').value, next: $('#next').value });\n      $('#changeForm').hidden = true; $('#loginForm').hidden = false;\n      $('#err').textContent = '비밀번호를 바꿨습니다. 새 비밀번호로 로그인하세요.';\n      $('#password').value = ''; $('#password').focus();\n    } catch (err) { $('#err2').textContent = err.message; }\n  });\n  $('#email').focus();\n})();\n",
"assets/owner.js": "'use strict';\n// 사장님 발주 확인 페이지 — 알림톡 버튼으로 여는 링크 (로그인 없음, 서명 토큰으로 본인 발주만 조회)\n(() => {\n  const app = document.getElementById('app');\n  const token = location.pathname.split('/o/')[1] || '';\n  const preview = location.hash === '#preview';\n  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';\n  const KST = 9 * 3600e3;\n  const hm = (ts) => { const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };\n  const dayWord = (dateStr) => {\n    const now = new Date(Date.now() + KST);\n    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());\n    const [y, m, d] = dateStr.split('-').map(Number);\n    const diff = Math.round((Date.UTC(y, m - 1, d) - today) / 864e5);\n    return diff === 0 ? '오늘' : diff === 1 ? '내일' : `${m}월 ${d}일`;\n  };\n  let V = null, qty = {};\n\n  async function call(method, path, body) {\n    const r = await fetch('/api/owner/' + encodeURIComponent(token) + path + (preview && method === 'GET' ? '?preview=1' : ''), {\n      method, headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: body ? JSON.stringify(body) : undefined,\n    });\n    const j = await r.json().catch(() => ({}));\n    if (!r.ok) throw new Error(j.error || '처리하지 못했습니다');\n    return j;\n  }\n  const total = () => V.lines.reduce((a, l) => a + (qty[l.sku] ?? l.qty) * l.price, 0);\n\n  function render() {\n    const v = V;\n    const head = `<div class=\"m-head\"><span class=\"pf\">B</span><div><b>BevFlow 발주 확인</b><small>${esc(v.store)}${v.owner ? ' · ' + esc(v.owner) + ' 사장님' : ''}</small></div></div>`;\n    const l0 = v.lines.find((l) => l.trig) || v.lines[0];\n    if (!v.canAct) {\n      const s = v.status;\n      const msg = s === 'paid' || s === 'dispatched' ? `✓ 발주가 확정됐어요<br><b>${v.eta ? dayWord(new Date(v.eta + KST).toISOString().slice(0, 10)) + ' ' + hm(v.eta) + '경' : v.deliverDate ? dayWord(v.deliverDate) + ' 오후(13~17시)' : ''}</b> 도착 예정이에요`\n        : s === 'delivered' ? `✓ 배송이 완료됐어요${v.deliveredAt ? ` (${hm(v.deliveredAt)})` : ''}`\n          : s === 'payfail' ? `결제가 완료되지 않았어요<br><span class=\"m-note\">${esc(v.payFailReason || '')} — BevFlow 운영팀이 곧 연락드릴게요</span>`\n            : s === 'held' ? '보류했어요. 내일 오전에 재고를 다시 확인해 안내드릴게요.'\n              : s === 'expired' ? '응답 시간이 지나 이번 제안은 만료됐어요. 내일 오전에 다시 안내드릴게요.'\n                : s === 'cancelled' ? '이 발주는 취소됐어요.' : '발송 준비 중인 제안이에요.';\n      app.innerHTML = `${head}<div class=\"m-card m-done\"><div class=\"m-lead\">${msg}</div><div class=\"m-note\">${esc(v.code)} · 합계 ${won(v.amount)}${v.payMethod === 'invoice' ? ' (월말 청구)' : ''}</div></div>${linesCard(false)}`;\n      return;\n    }\n    app.innerHTML = `${head}\n      <div class=\"m-card\"><div class=\"m-lead\">${l0 ? `<b>${esc(l0.name)}</b> 재고가 약 <b>${l0.est}박스(±${l0.band})</b> 남은 것으로 보여요.` : ''}<br>발주를 진행할까요?</div>\n        <div class=\"m-note\">${v.sameDay ? `${esc(v.cutoff)} 전에 승인하시면 <b>오늘 오후</b> 도착해요.` : `지금 승인하시면 <b>다음 배송일 오후</b> 도착해요.`}${v.expiresAt ? ` · ${hm(v.expiresAt)}까지 응답이 없으면 제안이 만료돼요.` : ''}</div></div>\n      ${linesCard(true)}\n      <div class=\"m-btns\"><button class=\"m-btn pri\" id=\"ok\">이대로 발주하기 · ${won(total())}</button><button class=\"m-btn\" id=\"hold\">이번엔 보류</button></div>\n      <p class=\"m-note\">수량은 − / + 로 바꿀 수 있어요. 필요 없는 품목은 0으로 두세요. 결제는 ${v.payMethod === 'sandbox_card' ? '등록 카드로 자동 결제' : '월말 청구'}됩니다.${preview ? '<br><b>운영자 미리보기</b> — 이 화면을 연 것은 열람으로 기록되지 않습니다.' : ''}</p>`;\n    document.getElementById('ok').onclick = () => act('approve');\n    document.getElementById('hold').onclick = () => act('hold');\n    app.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {\n      const sku = b.dataset.sku, l = v.lines.find((x) => x.sku === sku);\n      qty[sku] = Math.max(0, Math.min(200, (qty[sku] ?? l.qty) + Number(b.dataset.d)));\n      render();\n    }));\n  }\n  function linesCard(editable) {\n    return `<div class=\"m-card\"><h2 style=\"font-size:14px\">발주 품목</h2>${V.lines.map((l) => {\n      const q = qty[l.sku] ?? l.qty;\n      return `<div class=\"m-line\"><div class=\"nm\">${esc(l.name)}${l.trig ? ' <span class=\"badge b-bad nodot\">재고 부족</span>' : ''}<small>${won(l.price)}/박스${l.qtyOrig !== l.qty ? ` · 제안 ${l.qtyOrig}박스` : ''}</small></div>\n        ${editable ? `<div class=\"qty-step\"><button data-sku=\"${esc(l.sku)}\" data-d=\"-1\" aria-label=\"${esc(l.name)} 한 박스 빼기\">−</button><input readonly value=\"${q}\" aria-label=\"${esc(l.name)} 수량\"><button data-sku=\"${esc(l.sku)}\" data-d=\"1\" aria-label=\"${esc(l.name)} 한 박스 더하기\">+</button></div>` : `<b>${q}박스</b>`}</div>`;\n    }).join('')}<div class=\"m-total\"><span>합계</span><span>${won(editable ? total() : V.amount)}</span></div></div>`;\n  }\n  async function act(kind) {\n    if (preview) { alertBox('미리보기에서는 승인·보류할 수 없어요.'); return; }\n    const btns = app.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });\n    try {\n      const changed = {}; V.lines.forEach((l) => { if (qty[l.sku] != null && qty[l.sku] !== l.qty) changed[l.sku] = qty[l.sku]; });\n      V = await call('POST', '/' + kind, kind === 'approve' ? { qty: Object.keys(changed).length ? changed : null } : {});\n      qty = {};\n      render();\n    } catch (e) { btns.forEach((b) => { b.disabled = false; }); alertBox(e.message); }\n  }\n  function alertBox(m) {\n    const d = document.createElement('div'); d.className = 'alert-line bad'; d.textContent = m;\n    app.prepend(d); setTimeout(() => d.remove(), 5000);\n  }\n  call('GET', '').then((v) => { V = v; render(); }).catch((e) => {\n    app.innerHTML = `<div class=\"m-card m-done\"><div class=\"m-lead\">${esc(e.message)}</div><p class=\"m-note\">BevFlow 운영팀에 문의해 주세요.</p></div>`;\n  });\n})();\n",
"assets/shop.js": "'use strict';\n// 점주 발주 화면 (/m/…) — 카카오톡 채널 버튼·카카오 로그인으로 여는 링크. 글자 입력 없이 누르기만으로 발주한다.\n// 장바구니는 서버에 저장돼 카카오톡 채팅에서 담은 품목과 이어진다.\n(() => {\n  const app = document.getElementById('app');\n  const sheetRoot = document.getElementById('sheet');\n  const token = location.pathname.split('/m/')[1] || '';\n  const esc = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\n  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';\n  const KST = 9 * 3600e3;\n  const hm = (ts) => { const d = new Date(ts + KST); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };\n  const md = (ts) => { const d = new Date(ts + KST); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };\n  const ICON = { cafe: '☕', snack: '🍪', beverage: '🥤' };\n\n  let V = null;                 // 서버 화면 데이터\n  let qty = {};                 // 장바구니 수량 (화면 기준)\n  let tab = null;               // 선택한 품목 탭\n  let view = 'shop';            // shop | orders | done\n  let quick = 'all';            // all | fav\n  let q = '';                   // 검색어\n  let done = null;              // 방금 접수된 발주\n  let ref = null;               // 중복 접수 방지 키\n  let busy = false;\n  let grp = 'ALL';              // 매대·소분류 필터\n  let onlyChg = false;          // 발주서: 바뀐 줄만\n  let showMore = false;         // 발주서: 발주서에 없는 품목 펼치기\n  const timers = {};\n  const saving = new Set();     // 서버에 아직 저장되지 않은 수량 변경\n\n  async function call(method, path, body) {\n    const r = await fetch('/api/shop/' + encodeURIComponent(token) + path, {\n      method, headers: { 'content-type': 'application/json', 'x-bevflow': '1' }, body: body ? JSON.stringify(body) : undefined,\n    });\n    const j = await r.json().catch(() => ({}));\n    if (!r.ok) throw new Error(j.error || '처리하지 못했어요');\n    return j;\n  }\n  function load(v) {\n    V = v;\n    qty = Object.fromEntries(v.cart.lines.map((l) => [l.sku, l.qty]));\n    const ok = v.categories.filter((c) => c.status === 'approved');\n    if (!tab || !ok.some((c) => c.id === tab)) tab = ok[0] ? ok[0].id : null;\n  }\n  const P = (id) => V.products.find((p) => p.id === id);\n  const cartLines = () => Object.entries(qty).filter(([id, n]) => n > 0 && P(id)).map(([id, n]) => ({ ...P(id), qty: n }));\n  const totals = () => { const l = cartLines(); return { count: l.length, amount: l.reduce((a, x) => a + x.qty * x.price, 0) }; };\n  // 발주서 방식(사우나): 지난 발주 수량과 비교한 상태\n  const baseOf = (id) => (V.sheet && V.sheet.base[id]) || 0;\n  const chgOf = (p) => { const b = baseOf(p.id), n = qty[p.id] || 0; return !b && n ? 'new' : b && !n ? 'off' : n > b ? 'up' : n < b ? 'dn' : ''; };\n  const CHG = { up: '늘림', dn: '줄임', off: '뺌', new: '추가' };\n  const changed = () => V.products.filter((p) => chgOf(p));\n  const groupsIn = (list) => [...new Set(list.map((p) => p.grp).filter(Boolean))];\n\n  // 수량 변경 → 화면 즉시 반영, 서버 장바구니는 잠시 뒤 저장 (카톡 채팅과 공유)\n  function setQty(id, n) {\n    n = Math.max(0, Math.min(200, n));\n    qty[id] = n;\n    clearTimeout(timers[id]);\n    saving.add(id);\n    timers[id] = setTimeout(() => { call('PUT', '/cart', { sku: id, qty: n }).catch(() => {}).finally(() => saving.delete(id)); }, 450);\n  }\n\n  // ── 그리기 ──────────────────────────────────────────────\n  function render() {\n    if (view === 'done') return renderDone();\n    const t = totals();\n    const d = V.delivery;\n    const head = `<header class=\"s-head\">\n      <span class=\"pf\">B</span><div class=\"s-who\"><b>${esc(V.store.name)}</b><small>${esc(V.store.bizLabel)}${V.store.owner ? ' · ' + esc(V.store.owner) + ' 사장님' : ''}</small></div>\n      <button class=\"s-hbtn\" data-view=\"${view === 'orders' ? 'shop' : 'orders'}\">${view === 'orders' ? '← 발주하기' : '📦 발주 내역'}</button>\n    </header>`;\n    if (view === 'orders') { app.innerHTML = head + ordersHtml(); return; }\n    if (V.mode === 'sheet') return renderSheet(head);\n\n    const cats = V.categories;\n    const tabs = `<nav class=\"s-tabs\" aria-label=\"품목\">${cats.map((c) => {\n      const ok = c.status === 'approved';\n      const n = ok ? cartLines().filter((l) => l.category === c.id).length : 0;\n      return `<button class=\"s-tab ${c.id === tab ? 'on' : ''} ${ok ? '' : 'lock'}\" data-tab=\"${c.id}\" ${c.id === tab ? 'aria-current=\"true\"' : ''}>\n        <span class=\"s-ti\">${c.icon}</span><span>${esc(c.short)}</span>${ok ? (n ? `<i class=\"s-dot\">${n}</i>` : '') : `<em>${c.status === 'pending' ? '승인 대기' : '🔒 신청'}</em>`}</button>`;\n    }).join('')}</nav>`;\n\n    const banner = `<div class=\"s-banner ${d.sameDay ? '' : 'next'}\"><span class=\"s-bi\">🚚</span><div>지금 발주하면 <b>${esc(d.word)} 오후</b> 도착<small>${d.sameDay ? `당일배송은 ${esc(d.cutoff)}까지 발주 · 결제는 ${V.payMethod === 'invoice' ? '월말 청구' : '등록 카드'}` : `당일배송 마감(${esc(d.cutoff)})이 지나 다음 배송일에 도착해요`}</small></div></div>`;\n    const notice = V.pendingProposal ? `<div class=\"alert-line warn\">재고 기반 발주 제안(${esc(V.pendingProposal)})이 승인을 기다리고 있어요. 알림톡의 [발주 확인하기]에서 함께 처리해 주세요.</div>` : '';\n    const quickRow = `<div class=\"s-quick\">\n      ${V.hasLastOrder ? '<button class=\"s-chip\" data-act=\"reorder\">🔁 지난번과 똑같이</button>' : ''}\n      <button class=\"s-chip ${quick === 'fav' ? 'on' : ''}\" data-quick=\"${quick === 'fav' ? 'all' : 'fav'}\">⭐ 자주 시키는 품목</button>\n      <label class=\"s-search\"><span aria-hidden=\"true\">🔍</span><input id=\"q\" type=\"search\" placeholder=\"품목 찾기\" value=\"${esc(q)}\" aria-label=\"품목 찾기\"></label>\n    </div>`;\n\n    let body;\n    const cur = cats.find((c) => c.id === tab);\n    if (!cur) body = '<div class=\"empty\">발주할 수 있는 품목이 없어요. 운영팀에 문의해 주세요.</div>';\n    else {\n      let list = V.products.filter((p) => p.category === tab);\n      const gs = groupsIn(list);\n      if (gs.length > 1) body = `<div class=\"s-gchips\">${['ALL', ...gs].map((g) => `<button class=\"s-gc ${grp === g ? 'on' : ''}\" data-grp=\"${esc(g)}\">${g === 'ALL' ? `전체 ${list.length}` : `${esc(g)} ${list.filter((p) => p.grp === g).length}`}</button>`).join('')}</div>`;\n      if (grp !== 'ALL') list = list.filter((p) => p.grp === grp);\n      if (quick === 'fav') list = list.filter((p) => p.freq > 0).sort((a, b) => b.freq - a.freq);\n      if (q.trim()) list = list.filter((p) => (p.name + ' ' + p.spec).toLowerCase().includes(q.trim().toLowerCase()));\n      body = (body || '') + (list.length ? `<div class=\"s-list\">${list.map(itemHtml).join('')}</div>`\n        : `<div class=\"empty\">${quick === 'fav' ? '아직 자주 시킨 품목이 없어요' : '찾는 품목이 없어요'}</div>`);\n    }\n    const lockInfo = cats.filter((c) => c.status !== 'approved');\n    const more = lockInfo.length ? `<button class=\"s-more\" data-act=\"access\">➕ 다른 품목도 발주하고 싶어요 <small>${lockInfo.map((c) => `${c.icon} ${esc(c.short)}${c.status === 'pending' ? ' (승인 대기)' : ''}`).join(' · ')}</small></button>` : '';\n\n    const short = Math.max(0, V.minAmount - t.amount);\n    const bar = t.count ? `<div class=\"s-bar\"><div class=\"s-bar-in\">\n        <button class=\"s-cartsum\" data-act=\"cart\"><b>🛒 ${t.count}품목 담음</b><span>${won(t.amount)}</span>${short ? `<small>최소 발주까지 ${won(short)}</small>` : ''}</button>\n        <button class=\"s-go\" data-act=\"cart\" ${short ? 'disabled' : ''}>발주하기</button></div></div>` : '';\n\n    app.innerHTML = head + banner + notice + tabs + quickRow + body + more + (V.channelChatUrl ? `<p class=\"m-note s-foot\">문의는 <a href=\"${esc(V.channelChatUrl)}\" target=\"_blank\" rel=\"noopener\">카카오톡 채널 채팅</a>으로 보내 주세요.</p>` : '') + bar;\n    app.classList.toggle('has-bar', !!t.count);\n  }\n\n  // ── 발주서 화면 (사우나 매점: 매대 순서 · 지난번 수량이 채워진 발주서에서 바뀐 줄만 고치기) ──\n  function renderSheet(head) {\n    const t = totals(), d = V.delivery, sh = V.sheet;\n    const ch = changed(), cnt = { up: 0, dn: 0, off: 0, new: 0 };\n    ch.forEach((p) => { cnt[chgOf(p)]++; });\n    const today = sh.preparedAt && sh.preparedAt >= Date.now() - (Date.now() + KST) % 864e5;\n    const banner = `<div class=\"s-banner sheet\"><span class=\"s-bi\">📋</span><div>${today ? `<b>오늘 ${sh.standing ? esc(sh.standing) + ' ' : ''}정기 발주서</b>` : '<b>발주서</b>'}${sh ? ` · 지난번(${esc(sh.date.slice(5).replace('-', '/'))}) 기준` : ''}\n      <small>${esc(d.cutoff)}까지 확정하면 <b>${esc(d.word)} 오후</b> 도착 · 바뀐 것만 고쳐 주세요</small></div></div>`;\n    if (!t.count && !ch.length) {\n      app.innerHTML = head + banner + `<section class=\"m-card m-done\"><div class=\"m-lead\">아직 채워진 발주서가 없어요</div>\n        ${sh ? `<p class=\"m-note\">지난번(${esc(sh.code)}) 발주 수량으로 채운 뒤 바뀐 것만 고치면 돼요.</p><button class=\"m-btn pri\" data-act=\"loadsheet\">📋 지난 발주서 불러오기</button>` : '<p class=\"m-note\">첫 발주는 아래에서 품목을 골라 주세요.</p>'}</section>`\n        + (sh ? '' : sheetRows()) + barHtml(t, ch.length);\n      app.classList.toggle('has-bar', !!t.count);\n      return;\n    }\n    const zones = groupsIn(V.products);\n    const chips = `<div class=\"s-chg\">${ch.length ? `<span>바뀐 줄 <b>${ch.length}</b></span>` : '<span>지난번과 같아요</span>'}${['up', 'dn', 'off', 'new'].filter((k) => cnt[k]).map((k) => `<span class=\"c-${k}\">${CHG[k]} ${cnt[k]}</span>`).join('')}</div>\n      <div class=\"s-gchips\">${['ALL', ...zones].map((g) => `<button class=\"s-gc ${grp === g && !onlyChg ? 'on' : ''}\" data-grp=\"${esc(g)}\">${g === 'ALL' ? '전체 매대' : esc(g)}</button>`).join('')}<button class=\"s-gc ${onlyChg ? 'on' : ''}\" data-chg=\"1\">✏️ 바뀐 것만 ${ch.length}</button></div>`;\n    app.innerHTML = head + banner + `<div class=\"s-stick\">${chips}</div>` + sheetRows() + barHtml(t, ch.length);\n    app.classList.toggle('has-bar', true);\n  }\n  function sheetRows() {\n    const inSheet = (p) => baseOf(p.id) || qty[p.id];\n    const pass = (p) => (grp === 'ALL' || p.grp === grp) && (!onlyChg || chgOf(p));\n    const zones = groupsIn(V.products);\n    const zoneOf = (p) => p.grp || '기타';\n    const order = [...zones, '기타'];\n    let html = order.map((z) => {\n      const l = V.products.filter((p) => zoneOf(p) === z && inSheet(p) && pass(p));\n      return l.length ? `<div class=\"s-zh\">${esc(z)} <span>${l.length}줄</span></div><div class=\"s-rows\">${l.map(rowHtml).join('')}</div>` : '';\n    }).join('');\n    if (!html) html = `<div class=\"empty\">${onlyChg ? '바뀐 줄이 없어요. 지난번 그대로예요.' : '이 매대에는 발주서 품목이 없어요.'}</div>`;\n    const extra = V.products.filter((p) => !inSheet(p) && (grp === 'ALL' || p.grp === grp));\n    if (!onlyChg && extra.length) html += showMore ? `<div class=\"s-zh\">➕ 발주서에 없는 품목 <span>${extra.length}종</span></div><div class=\"s-rows\">${extra.map(rowHtml).join('')}</div>`\n      : `<button class=\"s-more\" data-act=\"more\">➕ 발주서에 없는 품목 ${extra.length}종 보기</button>`;\n    return html;\n  }\n  function rowHtml(p) {\n    const n = qty[p.id] || 0, c = chgOf(p), b = baseOf(p.id);\n    return `<div class=\"s-row ${c ? 'c-' + c : ''}\"><div class=\"s-rn\"><b>${esc(p.name)}${c ? `<i>${CHG[c]}</i>` : ''}</b><small>${esc(p.spec || '')} · ${won(p.price)}/${esc(p.u)}${c && c !== 'new' ? ` · 지난번 ${b}` : ''}</small></div>${c === 'off'\n      ? `<button class=\"s-revive\" data-set=\"${esc(p.id)}\" data-n=\"${b}\">되살리기</button>`\n      : n ? `<div class=\"s-step sm\" role=\"group\" aria-label=\"${esc(p.name)} 수량\"><button data-d=\"-1\" data-id=\"${esc(p.id)}\" aria-label=\"하나 줄이기\">−</button><output>${n}</output><button data-d=\"1\" data-id=\"${esc(p.id)}\" aria-label=\"하나 늘리기\">+</button></div>`\n        : `<button class=\"s-revive\" data-d=\"1\" data-id=\"${esc(p.id)}\">+ 추가</button>`}</div>`;\n  }\n  function barHtml(t, nChg) {\n    if (!t.count) return '';\n    const short = Math.max(0, V.minAmount - t.amount);\n    return `<div class=\"s-bar\"><div class=\"s-bar-in\"><button class=\"s-cartsum\" data-act=\"cart\"><b>📋 ${t.count}품목 · ${nChg ? `바뀐 줄 ${nChg}` : '지난번 그대로'}</b><span>${won(t.amount)}</span>${short ? `<small>최소 발주까지 ${won(short)}</small>` : ''}</button>\n      <button class=\"s-go\" data-act=\"cart\" ${short ? 'disabled' : ''}>확정하기</button></div></div>`;\n  }\n\n  function itemHtml(p) {\n    const n = qty[p.id] || 0;\n    return `<div class=\"s-item ${n ? 'in' : ''}\">\n      <div class=\"s-ico\" aria-hidden=\"true\">${ICON[p.category] || '📦'}</div>\n      <div class=\"s-info\"><b>${esc(p.name)}</b><small>${esc(p.spec || `${p.pack}${p.unit} / 박스`)}</small>\n        <span class=\"s-price\">${won(p.price)}<i>/${esc(p.u)}</i></span>${p.lastQty && !n ? `<button class=\"s-last\" data-set=\"${esc(p.id)}\" data-n=\"${p.lastQty}\">지난번 ${p.lastQty}${esc(p.u)} 담기</button>` : ''}</div>\n      ${n ? `<div class=\"s-step\" role=\"group\" aria-label=\"${esc(p.name)} 수량\">\n          <button data-d=\"-1\" data-id=\"${esc(p.id)}\" aria-label=\"하나 빼기\">−</button><output>${n}</output><button data-d=\"1\" data-id=\"${esc(p.id)}\" aria-label=\"하나 더하기\">+</button></div>`\n        : `<button class=\"s-add\" data-d=\"1\" data-id=\"${esc(p.id)}\" aria-label=\"${esc(p.name)} 담기\">담기</button>`}\n    </div>`;\n  }\n\n  function ordersHtml() {\n    if (!V.orders.length) return '<div class=\"m-card m-done\"><div class=\"m-lead\">아직 발주 내역이 없어요</div></div>';\n    const steps = (o) => {\n      const i = { created: 0, sent: 0, payfail: 1, paid: 1, dispatched: 2, delivered: 3 }[o.status];\n      if (i == null) return '';\n      return `<ol class=\"s-steps\">${['접수', '확정', '배송 중', '도착'].map((s, k) => `<li class=\"${k < i ? 'ok' : k === i ? (o.status === 'payfail' ? 'bad' : 'cur') : ''}\">${s}</li>`).join('')}</ol>`;\n    };\n    return V.orders.map((o) => `<section class=\"m-card s-order\">\n      <div class=\"s-oh\"><b>${esc(o.code)}</b><span class=\"s-pill st-${esc(o.status)}\">${esc(o.statusText)}</span></div>\n      <small class=\"muted\">${md(o.createdAt)} ${hm(o.createdAt)} · ${o.source === 'chat' ? '카카오톡' : o.source === 'web' ? '발주 화면' : '재고 기반 제안'}${o.eta && o.status === 'dispatched' ? ` · ${hm(o.eta)}경 도착 예정` : ''}${o.deliveredAt ? ` · ${hm(o.deliveredAt)} 도착` : ''}</small>\n      ${steps(o)}\n      <div>${o.lines.map((l) => `<div class=\"m-line\"><div class=\"nm\">${esc(l.name)}</div><b>${l.qty}${esc(l.u)}</b></div>`).join('')}</div>\n      <div class=\"m-total\"><span>합계</span><span>${won(o.amount)}</span></div></section>`).join('')\n      + (V.hasLastOrder ? '<button class=\"m-btn\" data-act=\"reorder\">🔁 지난번과 똑같이 담기</button>' : '');\n  }\n\n  function renderDone() {\n    const o = done;\n    const ok = o.status === 'paid';\n    app.classList.remove('has-bar');\n    app.innerHTML = `<section class=\"m-card m-done s-done\">\n      <div class=\"s-check ${ok ? '' : 'bad'}\">${ok ? '✓' : '!'}</div>\n      <div class=\"m-lead\"><b>${ok ? '발주가 완료됐어요' : '결제 확인이 필요해요'}</b></div>\n      <div class=\"m-note\">${esc(o.code)} · ${won(o.amount)}${o.payMethod === 'invoice' ? ' (월말 청구)' : ''}</div>\n      <div class=\"s-arrive\">${ok ? `🚚 <b>${esc(o.statusText)}</b>` : esc(o.payFailReason || '운영팀이 곧 연락드릴게요')}</div>\n      <p class=\"m-note\">확정·배송 소식은 카카오톡 알림톡으로 보내 드려요.</p>\n      <div class=\"m-btns\"><button class=\"m-btn pri\" data-view=\"shop\">계속 발주하기</button><button class=\"m-btn\" data-view=\"orders\">발주 내역 보기</button>\n      ${V.channelChatUrl ? `<a class=\"m-btn s-linkbtn\" href=\"${esc(V.channelChatUrl)}\">카카오톡 채널로 돌아가기</a>` : ''}</div></section>`;\n  }\n\n  // ── 시트 (장바구니 확인 · 품목 신청) ─────────────────────────────\n  function sheet(html) {\n    sheetRoot.innerHTML = `<div class=\"s-sheet-bg\" data-close=\"1\"><div class=\"s-sheet\" role=\"dialog\" aria-modal=\"true\">${html}</div></div>`;\n    document.body.classList.add('lock');\n  }\n  function closeSheet() { sheetRoot.innerHTML = ''; document.body.classList.remove('lock'); }\n\n  function cartSheet() {\n    const lines = cartLines();\n    if (!lines.length) return closeSheet();\n    const t = totals();\n    const short = Math.max(0, V.minAmount - t.amount);\n    if (!ref) ref = 'web-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);\n    const byCat = {};\n    lines.forEach((l) => { (byCat[l.category] = byCat[l.category] || []).push(l); });\n    const diffOnly = V.mode === 'sheet' && V.sheet;\n    const ch = diffOnly ? changed() : [];\n    const listHtml = diffOnly\n      ? (ch.length ? `<p class=\"m-note\" style=\"margin:0\">지난번과 달라진 ${ch.length}줄만 보여 드려요. 나머지 ${lines.length - ch.filter((p) => qty[p.id]).length}품목은 지난번과 같아요.</p>${ch.map((p) => `<div class=\"m-line\"><div class=\"nm\">${esc(p.name)} <span class=\"s-tag c-${chgOf(p)}\">${CHG[chgOf(p)]}</span></div><b>${baseOf(p.id)} → ${qty[p.id] || 0}${esc(p.u)}</b></div>`).join('')}`\n        : `<p class=\"m-note\" style=\"margin:0\">지난번(${esc(V.sheet.code)})과 똑같이 ${lines.length}품목을 발주해요.</p>`)\n      : null;\n    sheet(`<div class=\"s-sh\"><h2>${diffOnly ? '이대로 확정할까요?' : '발주 확인'}</h2><button class=\"xbtn\" data-close=\"1\" aria-label=\"닫기\">✕</button></div>\n      <div class=\"s-sb\">${listHtml != null ? listHtml : Object.entries(byCat).map(([c, ls]) => `<div class=\"sec-h\">${ICON[c]} ${esc((V.categories.find((x) => x.id === c) || {}).short || '')}</div>${ls.map((l) => `\n        <div class=\"m-line\"><div class=\"nm\">${esc(l.name)}<small>${won(l.price)} × ${l.qty} = ${won(l.price * l.qty)}</small></div>\n        <div class=\"s-step sm\"><button data-d=\"-1\" data-id=\"${esc(l.id)}\" aria-label=\"하나 빼기\">−</button><output>${l.qty}</output><button data-d=\"1\" data-id=\"${esc(l.id)}\" aria-label=\"하나 더하기\">+</button></div></div>`).join('')}`).join('')}\n        <div class=\"m-total\"><span>합계 · ${t.count}품목</span><span>${won(t.amount)}</span></div>\n        <div class=\"s-arrive\">🚚 <b>${esc(V.delivery.word)} 오후</b> 도착 예정 · ${V.payMethod === 'invoice' ? '월말 청구' : '등록 카드 결제'}</div>\n        ${short ? `<div class=\"alert-line warn\">최소 발주 금액은 ${won(V.minAmount)}이에요. ${won(short)}어치 더 담아 주세요.</div>` : ''}\n        <div class=\"form-err\" id=\"err\"></div></div>\n      <div class=\"s-sf\"><button class=\"m-btn pri\" data-act=\"submit\" ${short || busy ? 'disabled' : ''}>${won(t.amount)} 발주 확정</button></div>`);\n  }\n\n  function accessSheet(pre) {\n    const list = V.categories.filter((c) => c.status !== 'approved');\n    sheet(`<div class=\"s-sh\"><h2>다른 품목 이용 신청</h2><button class=\"xbtn\" data-close=\"1\" aria-label=\"닫기\">✕</button></div>\n      <div class=\"s-sb\"><p class=\"m-note\" style=\"margin:0\">신청하시면 운영팀이 확인 후 열어 드려요. 승인되면 카카오톡으로 알려 드려요.</p>\n      ${list.map((c) => `<label class=\"s-opt ${c.status === 'pending' ? 'dis' : ''}\"><input type=\"radio\" name=\"cat\" value=\"${c.id}\" ${c.status === 'pending' ? 'disabled' : ''} ${c.id === pre ? 'checked' : ''}>\n        <span class=\"s-ti\">${c.icon}</span><span><b>${esc(c.label)}</b><small>${c.status === 'pending' ? '승인 대기 중' : c.status === 'rejected' ? `지난 신청 미승인${c.decideNote ? ' · ' + esc(c.decideNote) : ''} — 다시 신청할 수 있어요` : '신청 가능'}</small></span></label>`).join('')}\n      <label class=\"fld\"><span>하고 싶은 말 (선택)</span><input id=\"note\" maxlength=\"200\" placeholder=\"예: 매점에 커피도 들이려고요\"></label>\n      <div class=\"form-err\" id=\"err\"></div></div>\n      <div class=\"s-sf\"><button class=\"m-btn pri\" data-act=\"request\">이용 신청하기</button></div>`);\n  }\n\n  // ── 동작 ────────────────────────────────────────────────\n  function toast(m, bad) {\n    const d = document.createElement('div'); d.className = 's-toast' + (bad ? ' bad' : ''); d.textContent = m;\n    document.body.appendChild(d); setTimeout(() => d.remove(), 2600);\n  }\n  async function act(a, el) {\n    if (a === 'cart') return cartSheet();\n    if (a === 'access') return accessSheet();\n    if (a === 'more') { showMore = true; render(); return; }\n    if (a === 'loadsheet') {\n      el.disabled = true;\n      try { load(await call('POST', '/sheet', {})); render(); toast('지난 발주 수량으로 채웠어요. 바뀐 것만 고쳐 주세요'); } catch (e) { toast(e.message, true); el.disabled = false; }\n      return;\n    }\n    if (a === 'reorder') {\n      try { load(await call('POST', '/reorder', {})); view = 'shop'; render(); toast('지난 발주 품목을 담았어요'); cartSheet(); } catch (e) { toast(e.message, true); }\n      return;\n    }\n    if (a === 'request') {\n      const pick = sheetRoot.querySelector('input[name=cat]:checked');\n      if (!pick) { sheetRoot.querySelector('#err').textContent = '신청할 품목을 골라 주세요'; return; }\n      el.disabled = true;\n      try { load(await call('POST', '/access', { category: pick.value, note: sheetRoot.querySelector('#note').value })); closeSheet(); render(); toast('신청했어요. 승인되면 카카오톡으로 알려 드릴게요'); } catch (e) { sheetRoot.querySelector('#err').textContent = e.message; el.disabled = false; }\n      return;\n    }\n    if (a === 'submit') {\n      if (busy) return;\n      busy = true; el.disabled = true; el.textContent = '접수 중…';\n      Object.values(timers).forEach(clearTimeout);\n      saving.clear();\n      const items = Object.fromEntries(cartLines().map((l) => [l.id, l.qty]));\n      try {\n        const r = await call('POST', '/order', { items, ref });\n        done = r.order; ref = null; load(r.view); closeSheet(); view = 'done'; render(); window.scrollTo(0, 0);\n      } catch (e) {\n        const err = sheetRoot.querySelector('#err'); if (err) err.textContent = e.message;\n        el.disabled = false; el.textContent = '다시 시도';\n      } finally { busy = false; }\n    }\n  }\n\n  document.addEventListener('click', (ev) => {\n    const el = ev.target.closest('button, [data-close], a');\n    if (!el || !V) return;\n    const d = el.dataset;\n    if (d.close && (ev.target === el || el.classList.contains('xbtn'))) return closeSheet();\n    if (d.view) { view = d.view; closeSheet(); render(); window.scrollTo(0, 0); return; }\n    if (d.tab) {\n      const c = V.categories.find((x) => x.id === d.tab);\n      if (c.status !== 'approved') return accessSheet(c.status === 'pending' ? null : c.id);\n      tab = d.tab; grp = 'ALL'; render(); return;\n    }\n    if (d.quick) { quick = d.quick; render(); return; }\n    if (d.grp) { grp = d.grp; onlyChg = false; render(); window.scrollTo(0, Math.min(window.scrollY, 200)); return; }\n    if (d.chg) { onlyChg = !onlyChg; render(); return; }\n    if (d.d) { setQty(d.id, (qty[d.id] || 0) + Number(d.d)); render(); if (sheetRoot.innerHTML) cartSheet(); return; }\n    if (d.set) { setQty(d.set, Number(d.n)); render(); return; }\n    if (d.act) act(d.act, el);\n  });\n  document.addEventListener('input', (ev) => {\n    if (ev.target.id !== 'q') return;\n    q = ev.target.value; const pos = ev.target.selectionStart; render();\n    const i = document.getElementById('q'); if (i) { i.focus(); i.setSelectionRange(pos, pos); }\n  });\n  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && sheetRoot.innerHTML) closeSheet(); });\n  // 다른 곳(카카오톡 채팅)에서 담은 품목을 반영: 화면으로 돌아올 때 새로 불러오기\n  document.addEventListener('visibilitychange', () => {\n    if (document.visibilityState !== 'visible' || !V || sheetRoot.innerHTML || view === 'done' || saving.size || busy) return;\n    call('GET', '').then((v) => { load(v); render(); }).catch(() => {});\n  });\n\n  call('GET', '').then((v) => { load(v); render(); }).catch((e) => {\n    app.innerHTML = `<div class=\"m-card m-done\"><div class=\"m-lead\">${esc(e.message)}</div><p class=\"m-note\">BevFlow 카카오톡 채널에서 [발주하기]를 눌러 새 링크로 열어 주세요.</p></div>`;\n  });\n})();\n",
"console.html": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>BevFlow 운영 관제</title>\n<link rel=\"stylesheet\" href=\"/assets/app.css\">\n</head>\n<body>\n<div class=\"boot\" id=\"boot\" role=\"status\" aria-live=\"polite\">\n  <div class=\"boot-in\">\n    <span class=\"logo\">Bev<i>Flow</i></span>\n    <div class=\"boot-bar\"><i></i></div>\n    <span id=\"bootMsg\">운영 데이터를 불러오는 중…</span>\n  </div>\n</div>\n\n<div class=\"app\">\n  <header class=\"top\">\n    <div class=\"brand\"><span class=\"logo\">Bev<i>Flow</i></span><span class=\"brand-sub\">OPS CONSOLE</span></div>\n    <div class=\"page-title\"><h1 id=\"pageTitle\">관제 홈</h1><span id=\"pageDesc\"></span></div>\n    <div class=\"top-right\">\n      <span class=\"seg-label\">권역</span>\n      <div class=\"seg\" id=\"regionSeg\" role=\"group\" aria-label=\"권역 필터\"></div>\n      <div class=\"clock\" title=\"한국 표준시\"><span class=\"live-dot\" aria-hidden=\"true\"></span><span id=\"clockDate\"></span><b id=\"clockTime\"></b></div>\n      <div class=\"pos-status\" id=\"syncStatus\"></div>\n    </div>\n  </header>\n\n  <aside class=\"side\" aria-label=\"주 메뉴\">\n    <button class=\"reset\" id=\"btnRefresh\" type=\"button\" title=\"서버에서 최신 데이터를 다시 불러옵니다\"></button>\n    <nav class=\"nav\" id=\"nav\"></nav>\n    <div class=\"side-foot\">\n      <div class=\"pilot-box\" id=\"pilotBox\"></div>\n      <div class=\"sys\" id=\"sysStatus\"></div>\n      <div class=\"operator\" id=\"operator\"></div>\n    </div>\n  </aside>\n\n  <main id=\"main\" tabindex=\"-1\"></main>\n</div>\n\n<aside class=\"drawer\" id=\"drawer\" aria-label=\"발주 상세\" aria-hidden=\"true\"></aside>\n<div id=\"modalRoot\"></div>\n<div id=\"tip\" role=\"tooltip\"></div>\n<div id=\"toasts\" aria-live=\"polite\"></div>\n<script src=\"/assets/console.js\"></script>\n</body>\n</html>\n",
"driver.html": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"robots\" content=\"noindex\">\n<title>BevFlow 배송</title>\n<link rel=\"stylesheet\" href=\"/assets/app.css\">\n</head>\n<body class=\"m\">\n<main class=\"m-wrap\" id=\"app\" aria-live=\"polite\">\n  <div class=\"m-card\"><div class=\"skel-line\" style=\"width:60%\"></div><div class=\"skel-line\" style=\"width:90%\"></div></div>\n</main>\n<script src=\"/assets/driver.js\"></script>\n</body>\n</html>\n",
"kakao-link.html": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"robots\" content=\"noindex\">\n<meta name=\"theme-color\" content=\"#3E5C76\">\n<title>BevFlow 매장 연결</title>\n<link rel=\"stylesheet\" href=\"/assets/app.css\">\n</head>\n<body class=\"m shop\">\n<main class=\"m-wrap\" id=\"app\" aria-live=\"polite\"></main>\n<script src=\"/assets/kakao-link.js\"></script>\n</body>\n</html>\n",
"login.html": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>BevFlow 로그인</title>\n<link rel=\"stylesheet\" href=\"/assets/app.css\">\n</head>\n<body class=\"m\">\n<main class=\"m-wrap\" style=\"max-width:380px;padding-top:12vh\">\n  <div class=\"m-head\"><span class=\"logo\" style=\"font-size:24px\">Bev<i>Flow</i></span><span class=\"brand-sub\">OPS CONSOLE</span></div>\n  <form class=\"m-card\" id=\"loginForm\" autocomplete=\"on\">\n    <h2>운영 콘솔 로그인</h2>\n    <label class=\"fld\"><span>이메일</span><input id=\"email\" type=\"email\" autocomplete=\"username\" required></label>\n    <label class=\"fld\"><span>비밀번호</span><input id=\"password\" type=\"password\" autocomplete=\"current-password\" required></label>\n    <div class=\"form-err\" id=\"err\"></div>\n    <button class=\"m-btn pri\" type=\"submit\">로그인</button>\n  </form>\n  <form class=\"m-card\" id=\"changeForm\" hidden>\n    <h2>비밀번호 변경</h2>\n    <p class=\"m-note\">임시 비밀번호로 로그인했거나 변경을 요청했습니다. 10자 이상 새 비밀번호를 정해 주세요.</p>\n    <label class=\"fld\"><span>현재(임시) 비밀번호</span><input id=\"cur\" type=\"password\" autocomplete=\"current-password\" required></label>\n    <label class=\"fld\"><span>새 비밀번호</span><input id=\"next\" type=\"password\" autocomplete=\"new-password\" minlength=\"10\" required></label>\n    <label class=\"fld\"><span>새 비밀번호 확인</span><input id=\"next2\" type=\"password\" autocomplete=\"new-password\" minlength=\"10\" required></label>\n    <div class=\"form-err\" id=\"err2\"></div>\n    <button class=\"m-btn pri\" type=\"submit\">변경하고 다시 로그인</button>\n  </form>\n  <p class=\"m-note\" style=\"text-align:center\">계정이 없으면 관리자에게 요청하세요.</p>\n</main>\n<script src=\"/assets/login.js\"></script>\n</body>\n</html>\n",
"owner.html": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"robots\" content=\"noindex\">\n<title>BevFlow 발주 확인</title>\n<link rel=\"stylesheet\" href=\"/assets/app.css\">\n</head>\n<body class=\"m\">\n<main class=\"m-wrap\" id=\"app\" aria-live=\"polite\">\n  <div class=\"m-card\"><div class=\"skel-line\" style=\"width:60%\"></div><div class=\"skel-line\" style=\"width:90%\"></div><div class=\"skel-line\" style=\"width:40%\"></div></div>\n</main>\n<script src=\"/assets/owner.js\"></script>\n</body>\n</html>\n",
"shop.html": "<!DOCTYPE html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"robots\" content=\"noindex\">\n<meta name=\"theme-color\" content=\"#3E5C76\">\n<title>BevFlow 발주</title>\n<link rel=\"stylesheet\" href=\"/assets/app.css\">\n</head>\n<body class=\"m shop\">\n<main class=\"s-wrap\" id=\"app\" aria-live=\"polite\">\n  <div class=\"m-card\"><div class=\"skel-line\" style=\"width:60%\"></div><div class=\"skel-line\" style=\"width:90%\"></div><div class=\"skel-line\" style=\"width:40%\"></div></div>\n</main>\n<div id=\"sheet\"></div>\n<script src=\"/assets/shop.js\"></script>\n</body>\n</html>\n",
};

const __MODULES = {
// ── server/adapters/notifier.js ───────────────────────────────────────────
"server/adapters/notifier.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 알림 발송 어댑터
// - console: 외부로 보내지 않고 콘솔 [알림톡 모니터]에만 기록 (파일럿 초기: 운영자가 링크를 복사해 카카오톡으로 전달)
// - webhook: 설정한 URL로 JSON POST. 알림톡 대행사(비즈메시지) 연동 서버나 자동화 도구에서 받아 실제 발송한다.
//   본문 서명: X-BevFlow-Signature: sha256=<HMAC(웹훅 시크릿, 본문)>
// TODO: 알림톡 API 연동 — 대행사 API를 직접 호출하려면 이 파일에 모드를 하나 추가하면 된다.

const crypto = require('node:crypto');

function createNotifier({ getRules, getSecret }) {
  return {
    async deliver(m) {
      const R = getRules();
      if (m.channel === 'console' || R.notifier === 'console') return { ok: true, id: 'console-' + m.id };
      if (!R.webhook_url) return { ok: false, error: '웹훅 URL이 설정되지 않았습니다' };
      const payload = JSON.parse(m.payload || '{}');
      const body = JSON.stringify({
        id: m.id, kind: m.kind, template: m.template, to: m.to_phone, text: m.body,
        variables: payload.variables || {}, buttons: payload.buttons || [], created_at: m.created_at,
      });
      const sig = crypto.createHmac('sha256', getSecret('webhook')).update(body).digest('hex');
      const res = await fetch(R.webhook_url, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-bevflow-signature': 'sha256=' + sig }, body,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { ok: false, error: `웹훅 응답 ${res.status}` };
      let id = null;
      try { const j = await res.json(); id = j && (j.id || j.message_id) ? String(j.id || j.message_id) : null; } catch { /* 본문 없음 */ }
      return { ok: true, id };
    },
  };
}

module.exports = { createNotifier };
},

// ── server/adapters/payment.js ────────────────────────────────────────────
"server/adapters/payment.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 결제 어댑터
// - invoice: 후불 청구. 승인 즉시 주문 확정, 월말에 매장별로 청구 (파일럿 기본값 — PG 계약 전에도 운영 가능)
// - sandbox_card: 카드 자동결제 흐름 테스트용. 매장의 '결제 실패 테스트'를 켜면 승인 거절을 돌려준다.
// TODO: PG 결제 API 연동 — 빌링키 자동결제(예: 카드 등록 후 정기 결제)는 여기에 모드를 추가한다.

function createPayment({ getRules }) {
  return {
    async charge({ proposal, store }) {
      const R = getRules();
      if (R.pay_method === 'invoice') return { ok: true, method: 'invoice', ref: 'INV-' + proposal.code };
      if (store.pay_test_fail) return { ok: false, method: 'sandbox_card', reason: '카드 승인 거절 (샌드박스 테스트)' };
      return { ok: true, method: 'sandbox_card', ref: 'SBX-' + proposal.code + '-' + Date.now().toString(36) };
    },
  };
}

module.exports = { createPayment };
},

// ── server/adminNotify.js ─────────────────────────────────────────────────
"server/adminNotify.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 관리자 카톡 알림 — 카카오 "나에게 보내기" 메시지 API로 운영자 본인의 카카오톡(나와의 채팅)에 알림을 넣는다.
// 운영자마다 콘솔에서 카카오 로그인(카카오톡 메시지 전송 동의)을 한 번 해 두면, 알림 종류별로 켜고 끌 수 있다.
// 메시지는 피드형 카드(품목 줄 최대 5개, 버튼 최대 2개)라서 요약만 싣고, 전체는 버튼으로 여는 모바일 내역 화면(/a)에서 본다.

const KAUTH = 'https://kauth.kakao.com';
const KAPI = 'https://kapi.kakao.com';

const KINDS = {
  order: '발주 확정 · 결제 실패 (건마다)',
  access: '품목 이용 신청',
  sheets: '정기 발주서 발송 현황',
  unconfirmed: '미확정 발주서 (마감 전)',
  pick: '오늘 출고 합계',
  delivery: '배송 결과',
};

const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function prefsOf(row) {
  let p = {};
  try { p = JSON.parse(row.prefs || '{}'); } catch { /* 기본값 */ }
  return Object.fromEntries(Object.keys(KINDS).map((k) => [k, p[k] !== false]));
}

/**
 * 피드형 메시지 템플릿. items: [[왼쪽, 오른쪽]] 최대 5줄, buttons: [[제목, 경로]] 최대 2개
 * 경로는 운영 주소 기준(/a#pick 등) — 카카오 디벨로퍼스 앱에 등록된 도메인이어야 열린다.
 */
function feed(ctx, { profile, title, desc = '', items = [], sum = null, buttons = [] }) {
  const base = ctx.R.public_base_url;
  const link = (path) => ({ web_url: base + path, mobile_web_url: base + path });
  const t = {
    object_type: 'feed',
    content: { title: cut(title, 60), description: cut(desc, 120), link: link(buttons[0] ? buttons[0][1] : '/a') },
    buttons: buttons.slice(0, 2).map(([title2, path]) => ({ title: cut(title2, 14), link: link(path) })),
  };
  if (items.length || sum || profile) {
    t.item_content = {
      ...(profile ? { profile_text: cut(profile, 16) } : {}),
      ...(items.length ? { items: items.slice(0, 5).map(([a, b]) => ({ item: cut(a, 12), item_op: cut(b, 14) })) } : {}),
      ...(sum ? { sum: cut(sum[0], 12), sum_op: cut(sum[1], 14) } : {}),
    };
  }
  return t;
}

/** 알림 적재: 이 종류를 켜 둔 운영자에게 한 건씩 (dedupe가 같으면 한 번만) */
function notify(ctx, kind, dedupe, template, now = Date.now()) {
  const { db } = ctx;
  if (!KINDS[kind]) throw new Error('알 수 없는 알림: ' + kind);
  let n = 0;
  for (const r of db.all(`SELECT a.* FROM admin_kakao a JOIN users u ON u.id = a.user_id WHERE u.disabled = 0 AND u.role IN ('admin','ops')`)) {
    if (!prefsOf(r)[kind]) continue;
    const res = db.run('INSERT OR IGNORE INTO admin_notices (user_id, kind, dedupe, payload, created_at) VALUES (?, ?, ?, ?, ?)',
      [r.user_id, kind, `${kind}:${dedupe}`, JSON.stringify(template), now]);
    n += res.changes;
  }
  return n;
}

// ── 이벤트별 알림 ────────────────────────────────────────────
const SRC = { auto: '자동 제안 승인', web: '발주 화면', chat: '카톡 채팅' };

function orderResult(ctx, p, now) {
  const { db } = ctx;
  if (!db.get('SELECT 1 FROM admin_kakao LIMIT 1')) return 0;
  const s = db.get('SELECT name FROM stores WHERE id = ?', [p.store_id]);
  const lines = db.all(`SELECT k.name, k.pack, k.unit, l.qty, l.price FROM proposal_lines l JOIN skus k ON k.id = l.sku_id
                        WHERE l.proposal_id = ? AND l.qty > 0 ORDER BY l.qty * l.price DESC`, [p.id]);
  const u = (l) => (l.pack === 1 ? l.unit : '박스');
  const shown = lines.length > 5 ? lines.slice(0, 4) : lines;
  const items = shown.map((l) => [`${l.name} ${l.qty}${u(l)}`, won(l.qty * l.price)]);
  if (lines.length > 5) items.push([`외 ${lines.length - 4}품목`, won(lines.slice(4).reduce((a, l) => a + l.qty * l.price, 0))]);
  const ok = p.status === 'paid';
  return notify(ctx, 'order', p.code, feed(ctx, {
    profile: `${s.name}`,
    title: ok ? `✅ 발주 확정 ${p.code}` : `⚠️ 결제 실패 ${p.code}`,
    desc: ok ? `${SRC[p.source] || ''} · ${lines.length}품목 · ${p.deliver_date || ''} 배송` : (p.pay_fail_reason || '결제 확인 필요'),
    items, sum: ['합계', won(p.amount)],
    buttons: [['발주 상세', `/a#order-${p.id}`], ['오늘 내역', '/a#list']],
  }), now);
}

function accessRequest(ctx, store, label, note, now) {
  return notify(ctx, 'access', `${store.id}:${label}:${now}`, feed(ctx, {
    profile: store.name, title: `➕ ${label} 이용 신청`, desc: note ? `"${note}"` : '승인하면 점주 화면에 품목이 열려요',
    buttons: [['승인하러 가기', '/#access'], ['오늘 요약', '/a#sum']],
  }), now);
}

// ── 발송 ───────────────────────────────────────────────────
async function refresh(ctx, row, now) {
  const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: ctx.R.kakao_rest_key, refresh_token: row.refresh_token });
  if (ctx.env.BEVFLOW_KAKAO_CLIENT_SECRET) form.set('client_secret', ctx.env.BEVFLOW_KAKAO_CLIENT_SECRET);
  const r = await ctx.fetch(`${KAUTH}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form.toString(), signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('카카오 로그인이 만료됐어요. 콘솔에서 다시 연결해 주세요');
  const next = {
    access_token: j.access_token, access_exp: now + (Number(j.expires_in) || 21599) * 1000,
    refresh_token: j.refresh_token || row.refresh_token,
    refresh_exp: j.refresh_token_expires_in ? now + Number(j.refresh_token_expires_in) * 1000 : row.refresh_exp,
  };
  ctx.db.run('UPDATE admin_kakao SET access_token = ?, access_exp = ?, refresh_token = ?, refresh_exp = ? WHERE user_id = ?',
    [next.access_token, next.access_exp, next.refresh_token, next.refresh_exp, row.user_id]);
  return { ...row, ...next };
}

async function sendMemo(ctx, row, template) {
  const r = await ctx.fetch(`${KAPI}/v2/api/talk/memo/default/send`, {
    method: 'POST', headers: { authorization: 'Bearer ' + row.access_token, 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }).toString(), signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.result_code === 0, status: r.status, error: j.msg || j.error_description || ('HTTP ' + r.status) };
}

/** 대기 중인 알림 발송 (토큰 만료 1분 전이면 먼저 갱신, 401이면 한 번 갱신 후 재시도, 5회 실패 시 포기) */
async function flush(ctx, now = Date.now()) {
  const { db } = ctx;
  const queued = db.all("SELECT * FROM admin_notices WHERE status = 'queued' ORDER BY id LIMIT 50");
  const rows = new Map();
  for (const m of queued) {
    let row = rows.get(m.user_id) || db.get('SELECT * FROM admin_kakao WHERE user_id = ?', [m.user_id]);
    let res;
    try {
      if (!row) throw new Error('카카오 연결이 해제됐어요');
      if (row.access_exp < now + 60e3) row = await refresh(ctx, row, now);
      res = await sendMemo(ctx, row, JSON.parse(m.payload));
      if (!res.ok && res.status === 401) { row = await refresh(ctx, row, now); res = await sendMemo(ctx, row, JSON.parse(m.payload)); }
    } catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
    if (row) rows.set(m.user_id, row);
    if (res.ok) {
      db.run("UPDATE admin_notices SET status = 'sent', sent_at = ?, attempts = attempts + 1, error = NULL WHERE id = ?", [now, m.id]);
      db.run('UPDATE admin_kakao SET last_error = NULL WHERE user_id = ?', [m.user_id]);
    } else {
      db.run("UPDATE admin_notices SET attempts = attempts + 1, error = ?, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END WHERE id = ?", [String(res.error).slice(0, 300), m.id]);
      db.run('UPDATE admin_kakao SET last_error = ? WHERE user_id = ?', [String(res.error).slice(0, 300), m.user_id]);
    }
  }
  return queued.length;
}

module.exports = { KINDS, prefsOf, feed, notify, orderResult, accessRequest, flush, refresh, sendMemo };
},

// ── server/api/snapshot.js ────────────────────────────────────────────────
"server/api/snapshot.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 콘솔 스냅샷 — 운영 콘솔이 한 번에 받아 그리는 데이터 묶음 (최근 45일 + 진행 중 건)

const T = require('../time');
const inv = require('../engine/inventory');
const settlement = require('../engine/settlement');

// 판매 이력이 부족한 매장의 기본 시간대 분포 (L=점심 중심, D=저녁 중심)
const DEFAULT_PROFILE = {
  L: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, .02, .14, .20, .12, .04, .02, .03, .10, .14, .11, .06, .02, 0, 0],
  D: [.03, .01, 0, 0, 0, 0, 0, 0, 0, 0, 0, .02, .04, .02, 0, 0, .02, .07, .13, .17, .17, .14, .10, .08],
};

const r4 = (x) => (x == null ? x : Math.round(x * 1e4) / 1e4);
const maskPhone = (p) => String(p || '').replace(/(\d{2,3})[- ]?(\d{3,4})[- ]?(\d{4})/, '$1-****-$3');

/** 파일럿 전체 기간의 주차별 3대 지표 · 매장별 성과 · 정차 시간 분포 */
function pilot(ctx, now) {
  const { db, R } = ctx;
  const ps = R.pilotStart, WK = 7 * T.DAY;
  const n = Math.max(1, Math.floor((now - ps) / WK) + 1);
  const weeks = Array.from({ length: n }, (_, i) => ({ week: i + 1, start: ps + i * WK, decided: 0, approved: 0, counts: 0, errSum: 0, hits: 0, stops: 0, stopSum: 0 }));
  const at = (w) => weeks[Math.max(0, Math.min(n - 1, w))];
  for (const r of db.all(`SELECT CAST((created_at - ?) / ? AS INTEGER) AS w, SUM(response = 'approve') AS a, SUM(response IN ('approve','hold','none')) AS d
                          FROM proposals WHERE created_at >= ? AND status != 'cancelled' AND source = 'auto' GROUP BY w`, [ps, WK, ps])) { at(r.w).approved += r.a; at(r.w).decided += r.d; }
  for (const r of db.all(`SELECT CAST((t - ?) / ? AS INTEGER) AS w, COUNT(*) AS c, SUM(ABS(estimate - actual) / MAX(actual, 0.5)) AS e, SUM(ABS(estimate - actual) <= band) AS h
                          FROM counts WHERE source != 'onboarding' AND t >= ? GROUP BY w`, [ps, WK, ps])) { at(r.w).counts += r.c; at(r.w).errSum += r.e; at(r.w).hits += r.h; }
  for (const r of db.all(`SELECT CAST((departed_at - ?) / ? AS INTEGER) AS w, COUNT(*) AS c, SUM((departed_at - arrived_at) / 60000.0) AS s
                          FROM stops WHERE status = 'done' AND departed_at >= ? AND arrived_at IS NOT NULL GROUP BY w`, [ps, WK, ps])) { at(r.w).stops += r.c; at(r.w).stopSum += r.s; }
  const hist = db.all(`SELECT MIN(12, MAX(3, CAST((departed_at - arrived_at) / 60000.0 AS INTEGER))) AS b, COUNT(*) AS c FROM stops
                       WHERE status = 'done' AND arrived_at IS NOT NULL AND departed_at >= ? GROUP BY b`, [ps]);
  const perf = new Map();
  for (const r of db.all(`SELECT store_id, response, sent_at, responded_at FROM proposals WHERE created_at >= ? AND response IN ('approve','hold','none') AND status != 'cancelled' AND source = 'auto'`, [ps])) {
    if (!perf.has(r.store_id)) perf.set(r.store_id, { store: r.store_id, decided: 0, approved: 0, holds: 0, nones: 0, resp: [] });
    const x = perf.get(r.store_id);
    x.decided++;
    if (r.response === 'approve') x.approved++;
    if (r.response === 'hold') x.holds++;
    if (r.response === 'none') x.nones++;
    if (r.responded_at && r.sent_at) x.resp.push((r.responded_at - r.sent_at) / 60e3);
  }
  const storePerf = [...perf.values()].map((x) => { x.resp.sort((a, b) => a - b); return { store: x.store, decided: x.decided, approved: x.approved, holds: x.holds, nones: x.nones, medResp: x.resp.length ? x.resp[Math.floor(x.resp.length / 2)] : null }; });
  const paid = db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS g, COALESCE(SUM((SELECT SUM(qty) FROM proposal_lines l WHERE l.proposal_id = p.id)), 0) AS b,
                         MIN(paid_at) AS f FROM proposals p WHERE paid_at >= ? AND status != 'cancelled'`, [ps]);
  const activeStores = db.get('SELECT COUNT(*) AS c FROM stores WHERE active = 1').c;
  // 당일배송 달성률: 배송 요일에 컷오프 전 결제된 발주 중 결제일에 도착한 비율 (오늘 결제분 제외)
  const today = T.kstMidnight(now);
  const sd = (from) => db.get(`SELECT COUNT(*) AS n, SUM(status = 'delivered' AND CAST((delivered_at + 32400000) / 86400000 AS INTEGER) = CAST((paid_at + 32400000) / 86400000 AS INTEGER)) AS ok
                               FROM proposals WHERE paid_at >= ? AND paid_at < ? AND status != 'cancelled' AND ((paid_at + 32400000) % 86400000) < ?
                                 AND ((CAST((paid_at + 32400000) / 86400000 AS INTEGER) + 4) % 7) IN (${[...R.days].map(Number).join(',')})`, [from, today, R.cutoffH * T.HOUR]);
  const all = sd(ps), last7 = sd(today - 7 * T.DAY);
  const gmv14 = db.get("SELECT COALESCE(SUM(amount), 0) AS g FROM proposals WHERE paid_at >= ? AND paid_at < ? AND status != 'cancelled'", [today - 14 * T.DAY, today]).g / 14;
  return { weeks, hist, storePerf, orders: paid.n, gmv: paid.g, boxes: paid.b, firstPaidAt: paid.f, activeStores,
    sameDay: { n: all.n, ok: all.ok || 0, n7: last7.n, ok7: last7.ok || 0 }, gmv14 };
}

function mapProposal(p, lines) {
  return {
    pid: p.id, id: p.code, store: p.store_id, status: p.status, createdAt: p.created_at, sendAt: p.send_at, sentAt: p.sent_at,
    openAt: p.opened_at, remindedAt: p.reminded_at, respondAt: p.responded_at, response: p.response, responder: p.responder,
    closeAt: p.closed_at, paidAt: p.paid_at, payFailAt: p.pay_failed_at, payFailReason: p.pay_fail_reason, payMethod: p.pay_method, payRef: p.pay_ref,
    deliverDate: p.deliver_date, deliveredAt: p.delivered_at, amount: p.amount, reproposal: !!p.reproposal, manual: !!p.manual,
    review: !!p.review, sendRule: p.send_rule, modify: !!p.modified, createdBy: p.created_by, source: p.source,
    lines: (lines || []).sort((a, b) => (b.trig - a.trig) || (b.qty * b.price - a.qty * a.price)),
  };
}
const mapLine = (l) => ({ sku: l.sku_id, qty: l.qty, qtyOrig: l.qty_orig, E: r4(l.est), w: r4(l.band), S: l.safety, trig: !!l.trig, price: l.price });
const mapStop = (s) => ({ sid: s.id, route: s.route_id, date: s.date, region: s.region_id, driver: s.driver_id, proposal: s.proposal_id, store: s.store_id, seq: s.seq, eta: s.eta, status: s.status, arrivedAt: s.arrived_at, departedAt: s.departed_at, boxes: s.boxes, failReason: s.fail_reason });

/** 재고 차트용 매장 이력 (스냅샷 + 실사 + 제안 + 배송, 최근 N일) */
function storeHistory(ctx, storeId, sku, days, now) {
  const { db } = ctx;
  const since = now - days * T.DAY;
  const P = db.all('SELECT * FROM proposals WHERE store_id = ? AND created_at >= ? ORDER BY id', [storeId, since]);
  const lines = new Map();
  for (const l of db.all('SELECT l.* FROM proposal_lines l JOIN proposals p ON p.id = l.proposal_id WHERE p.store_id = ? AND p.created_at >= ?', [storeId, since])) {
    if (!lines.has(l.proposal_id)) lines.set(l.proposal_id, []);
    lines.get(l.proposal_id).push(mapLine(l));
  }
  return {
    points: db.all('SELECT t, est AS E, band AS w FROM inv_snapshots WHERE store_id = ? AND sku_id = ? AND t >= ? ORDER BY t', [storeId, sku, since]).map((x) => ({ t: x.t, E: r4(x.E), w: r4(x.w) })),
    counts: db.all("SELECT sku_id, t, estimate, actual, band, source, stop_id FROM counts WHERE store_id = ? AND t >= ? AND source != 'onboarding' ORDER BY t", [storeId, since])
      .map((c) => ({ sku: c.sku_id, t: c.t, E: r4(c.estimate), T: r4(c.actual), w: r4(c.band), source: c.source, stop: c.stop_id })),
    proposals: P.map((p) => mapProposal(p, lines.get(p.id))),
    stops: db.all('SELECT s.*, r.date, r.region_id, r.driver_id FROM stops s JOIN routes r ON r.id = s.route_id WHERE s.store_id = ? AND r.date >= ? ORDER BY s.id', [storeId, T.dateStr(since)]).map(mapStop),
  };
}

function build(ctx, user, now) {
  const { db, R } = ctx;
  const since = now - 3 * T.DAY;                       // 칸반·알림톡 모니터용 최근 제안
  const sinceDate = T.dateStr(now - 14 * T.DAY);       // 정차 시간 분포(최근 2주)용 배송
  const viewer = user.role === 'viewer';

  const pos7 = new Map(db.all('SELECT store_id, sku_id, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, sku_id', [now - 7 * T.DAY])
    .map((r) => [r.store_id + '|' + r.sku_id, r.b / 7]));
  const prof = new Map();
  for (const r of db.all(`SELECT store_id, ((sold_at + 32400000) / 3600000) % 24 AS h, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, h`, [now - 14 * T.DAY])) {
    if (!prof.has(r.store_id)) prof.set(r.store_id, new Array(24).fill(0));
    prof.get(r.store_id)[r.h] = r.b;
  }
  const itemsBy = new Map();
  for (const it of db.all(`SELECT ss.*, k.pack, k.price FROM store_skus ss JOIN skus k ON k.id = ss.sku_id WHERE ss.carried = 1 AND k.active = 1 AND k.category = 'beverage' ORDER BY k.sort, k.id`)) {
    if (!itemsBy.has(it.store_id)) itemsBy.set(it.store_id, []);
    itemsBy.get(it.store_id).push({
      sku: it.sku_id, E: r4(it.est), w: r4(it.band), S: inv.safetyOf(it, R), r: r4(inv.rateOf(it, R)), rateSource: it.rate != null ? 'pos' : it.rate_manual != null ? 'manual' : 'default',
      pos7: r4(pos7.get(it.store_id + '|' + it.sku_id) || 0),
      lastCount: it.last_count_at != null ? { t: it.last_count_at, E: it.last_count_est, T: it.last_count_actual, w: it.last_count_band } : null,
      lastIn: it.last_in_at != null ? { t: it.last_in_at, q: it.last_in_qty } : null,
    });
  }
  const stores = db.all('SELECT * FROM stores ORDER BY region_id, code').map((s) => {
    let p = prof.get(s.id);
    const tot = p ? p.reduce((a, b) => a + b, 0) : 0;
    p = tot > 1 ? p.map((x) => r4(x / tot)) : DEFAULT_PROFILE[s.type];
    return {
      idx: s.id, id: s.code, name: s.name, region: s.region_id, type: s.type, biz: s.biz, alpha: s.alpha, beta: s.beta != null ? s.beta : R.band_beta,
      breakPref: s.send_pref === 'break', exception: !!s.review_required, active: !!s.active,
      lat: s.lat, lng: s.lng, address: s.address, owner: s.owner_name, phone: viewer ? maskPhone(s.owner_phone) : s.owner_phone,
      lastPosAt: s.last_pos_at, cooldownUntil: s.cooldown_until, profile: p, items: itemsBy.get(s.id) || [],
      onboarded: (itemsBy.get(s.id) || []).some((i) => i.lastCount),
    };
  });

  const P = db.all(`SELECT * FROM proposals WHERE created_at >= ? OR status IN ('created','sent','payfail','paid','dispatched') ORDER BY id`, [since]);
  const ids = new Set(P.map((p) => p.id));
  const lines = new Map();
  for (const l of db.all('SELECT l.* FROM proposal_lines l JOIN proposals p ON p.id = l.proposal_id WHERE p.created_at >= ? OR p.status IN (\'created\',\'sent\',\'payfail\',\'paid\',\'dispatched\')', [since])) {
    if (!ids.has(l.proposal_id)) continue;
    if (!lines.has(l.proposal_id)) lines.set(l.proposal_id, []);
    lines.get(l.proposal_id).push(mapLine(l));
  }
  const proposals = P.map((p) => mapProposal(p, lines.get(p.id)));

  const stops = db.all(`SELECT s.*, r.date, r.region_id, r.driver_id FROM stops s JOIN routes r ON r.id = s.route_id WHERE r.date >= ? ORDER BY r.date, r.region_id, s.seq`, [sinceDate])
    .map(mapStop);
  const messages = db.all('SELECT id, proposal_id, store_id, kind, channel, to_phone, template, body, status, attempts, error, created_at, sent_at FROM messages WHERE created_at >= ? ORDER BY id DESC LIMIT 400', [now - 3 * T.DAY])
    .map((m) => ({ ...m, to_phone: viewer ? maskPhone(m.to_phone) : m.to_phone }));
  const events = db.all('SELECT * FROM events WHERE t >= ? ORDER BY id DESC LIMIT 300', [now - 36 * T.HOUR]);

  return {
    version: db.version, now, user,
    settings: {
      cutoff: R.cutoffH, dispatch: R.dispatchH, deliveryDays: [...R.days], expireHours: R.expire_hours, pilotStart: R.pilotStart,
      feeRate: R.fee_rate, driverCapacity: R.driver_capacity, targets: { approval: R.target_approval, stop: R.target_stop, error: R.target_error },
      payMethod: R.pay_method, notifier: R.notifier, sampleData: !!R.sample_data, orderLinkHours: R.order_link_hours, coverDays: R.cover_days, bandW0: R.band_w0, retryAt: R.retryH,
    },
    regions: db.all('SELECT * FROM regions ORDER BY sort, id'),
    drivers: db.all('SELECT id, name, phone, region_id, vehicle, capacity, active FROM drivers ORDER BY id').map((d) => ({ ...d, phone: viewer ? maskPhone(d.phone) : d.phone })),
    skus: db.all('SELECT * FROM skus ORDER BY sort, id'),
    stores, proposals, stops, messages, events,
    routes: db.all('SELECT id, date, region_id, driver_id, dispatched_at FROM routes WHERE date >= ?', [T.dateStr(now - 2 * T.DAY)]),
    settlements: settlement.weeks(ctx, now),
    pilot: pilot(ctx, now),
    unmapped: db.get('SELECT COUNT(*) AS c FROM unmapped_menu').c,
    outboxFailed: db.get("SELECT COUNT(*) AS c FROM messages WHERE status = 'failed'").c,
    accessPending: db.get("SELECT COUNT(*) AS c FROM store_categories WHERE status = 'pending'").c,
  };
}

module.exports = { build, storeHistory, DEFAULT_PROFILE, maskPhone };
},

// ── server/api/today.js ───────────────────────────────────────────────────
"server/api/today.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 관리자 모바일 내역 (/a) — 하루치 발주 요약 · 출고 집계(품목별·권역별) · 발주 내역 · 미확정 발주서
// 관리자 카톡 알림의 버튼이 이 화면으로 연결된다.

const T = require('../time');
const { maskPhone } = require('./snapshot');

const SRC = { auto: '자동 제안', web: '발주서·화면', chat: '카톡 채팅' };

function build(ctx, user, at, now) {
  const { db } = ctx;
  const viewer = user.role === 'viewer';
  const mid = T.kstMidnight(at), end = mid + T.DAY, date = T.dateStr(at);
  const regions = db.all('SELECT id, name FROM regions ORDER BY sort, id');
  const rgName = Object.fromEntries(regions.map((r) => [r.id, r.name]));

  // 오늘 확정(결제 완료 이후 단계)된 발주
  const P = db.all(`SELECT p.*, s.name AS store_name, s.biz, s.region_id FROM proposals p JOIN stores s ON s.id = p.store_id
                    WHERE p.paid_at >= ? AND p.paid_at < ? AND p.status IN ('paid','dispatched','delivered') ORDER BY p.paid_at DESC`, [mid, end]);
  const lineStmt = (pid) => db.all(`SELECT l.sku_id AS sku, l.qty, l.price, k.name, k.pack, k.unit FROM proposal_lines l JOIN skus k ON k.id = l.sku_id
                                   WHERE l.proposal_id = ? AND l.qty > 0 ORDER BY l.qty * l.price DESC`, [pid]);
  const u = (k) => (k.pack === 1 ? k.unit : '박스');
  const orders = P.map((p) => {
    const lines = lineStmt(p.id);
    return { id: p.id, code: p.code, paidAt: p.paid_at, store: p.store_name, biz: p.biz, region: rgName[p.region_id] || p.region_id, source: p.source, sourceText: SRC[p.source] || p.source,
      status: p.status, deliverDate: p.deliver_date, amount: p.amount, n: lines.length, lines: lines.map((l) => ({ name: l.name, qty: l.qty, u: u(l), amount: l.qty * l.price })) };
  });

  // 오늘 출고분 품목 합계 (배송일이 오늘인 결제 완료 이후 발주) — 창고 피킹 리스트
  const pick = new Map();
  for (const r of db.all(`SELECT l.sku_id, k.name, k.pack, k.unit, k.category, k.grp, s.region_id, SUM(l.qty) AS q FROM proposal_lines l
                          JOIN proposals p ON p.id = l.proposal_id JOIN stores s ON s.id = p.store_id JOIN skus k ON k.id = l.sku_id
                          WHERE p.deliver_date = ? AND p.status IN ('paid','dispatched','delivered') AND l.qty > 0
                          GROUP BY l.sku_id, s.region_id`, [date])) {
    if (!pick.has(r.sku_id)) pick.set(r.sku_id, { sku: r.sku_id, name: r.name, u: u(r), category: r.category, grp: r.grp, qty: 0, byRegion: {} });
    const x = pick.get(r.sku_id);
    x.qty += r.q;
    x.byRegion[r.region_id] = (x.byRegion[r.region_id] || 0) + r.q;
  }
  const pickList = [...pick.values()].sort((a, b) => b.qty - a.qty);
  const outStores = db.get(`SELECT COUNT(DISTINCT store_id) AS c, COALESCE(SUM(amount), 0) AS a FROM proposals WHERE deliver_date = ? AND status IN ('paid','dispatched','delivered')`, [date]);

  // 오늘 발주서를 받았는데 아직 확정하지 않은 매장
  const waiting = db.all(`SELECT s.id, s.name, s.owner_phone, s.sheet_at, s.sheet_seen_at, (SELECT COUNT(*) FROM carts c WHERE c.store_id = s.id) AS n FROM stores s
                          WHERE s.active = 1 AND s.sheet_at >= ? AND s.sheet_at < ?
                            AND NOT EXISTS (SELECT 1 FROM proposals p WHERE p.store_id = s.id AND p.source != 'auto' AND p.created_at >= s.sheet_at AND p.status != 'cancelled')
                          ORDER BY s.name`, [mid, end])
    .map((s) => ({ id: s.id, store: s.name, phone: viewer ? maskPhone(s.owner_phone) : s.owner_phone, lines: s.n, seenAt: s.sheet_seen_at }));

  const stops = db.all(`SELECT st.status, st.fail_reason, s.name FROM stops st JOIN routes r ON r.id = st.route_id JOIN stores s ON s.id = st.store_id WHERE r.date = ?`, [date]);
  const bySource = {};
  for (const o of orders) bySource[o.sourceText] = (bySource[o.sourceText] || 0) + 1;

  return {
    date, now, regions,
    summary: {
      orders: orders.length, amount: orders.reduce((a, o) => a + o.amount, 0),
      outStores: outStores.c, outAmount: outStores.a, outQty: pickList.reduce((a, p) => a + p.qty, 0), outKinds: pickList.length,
      waiting: waiting.length, accessPending: db.get("SELECT COUNT(*) AS c FROM store_categories WHERE status = 'pending'").c,
      delivered: stops.filter((s) => s.status === 'done').length, failed: stops.filter((s) => s.status === 'failed').map((s) => ({ store: s.name, reason: s.fail_reason })),
      bySource,
    },
    waiting, pick: pickList, orders,
  };
}

module.exports = { build };
},

// ── server/app.js ─────────────────────────────────────────────────────────
"server/app.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// HTTP 서버 조립: 세션 확인 → CSRF 헤더 확인 → 권한 확인 → 핸들러 → 응답

const http = require('node:http');
const path = require('node:path');
const auth = require('./auth');
const kakao = require('./kakao');
const shop = require('./engine/shop');
const { buildRoutes } = require('./routes');
const { HttpError, parseCookies, send, serveFile } = require('./http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createServer(ctx, { trustProxy = false, log = console } = {}) {
  const router = buildRoutes(ctx);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    req.ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    req.secure = trustProxy ? req.headers['x-forwarded-proto'] === 'https' : !!req.socket.encrypted;
    const cookies = parseCookies(req);
    req.sid = cookies.bf_sid || null;
    req.user = auth.sessionUser(ctx.db, req.sid);

    try {
      if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, '없는 API입니다');
        if (m.notAllowed) throw new HttpError(405, '허용되지 않는 메서드입니다');
        const { route, params } = m;
        // CSRF: 상태를 바꾸는 요청은 사용자 정의 헤더가 있어야 한다 (외부 사이트 폼으로는 붙일 수 없음)
        if (!['GET', 'HEAD'].includes(req.method) && !route.opts.noCsrf && req.headers['x-bevflow'] !== '1') throw new HttpError(403, '요청 헤더가 올바르지 않습니다');
        if (!route.opts.public) auth.requireRole(req.user, route.opts.role || 'admin');
        if (req.user && req.user.must_change && !['/api/auth/password', '/api/me', '/api/auth/logout'].includes(url.pathname)) throw new HttpError(403, '비밀번호를 먼저 변경해 주세요');
        // 스냅샷 ETag: DB 쓰기 버전 기준 (변경이 없으면 304로 전송량 절약)
        if (route.opts.etag) {
          const tag = `W/"v${ctx.db.version}-u${req.user ? req.user.id : 0}"`;
          if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
          req.etag = tag;
        }
        const out = await route.handler(req, params, url);
        const headers = {};
        if (req.setCookie) headers['Set-Cookie'] = req.setCookie;
        if (out && out.__raw != null) {
          headers['Content-Type'] = out.type;
          headers['Content-Disposition'] = `attachment; filename="${out.filename}"`;
          return send(res, 200, out.__raw, headers);
        }
        if (req.etag) headers.ETag = req.etag;
        return send(res, 200, out, headers);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '허용되지 않는 메서드입니다');
      // 카카오 로그인: 인가 요청 → 콜백 (리다이렉트만 하는 경로)
      if (url.pathname === '/k/login') {
        let loc;
        try {
          const { url: to, nonce } = kakao.loginStart(ctx, url.searchParams.get('t'));
          res.setHeader('Set-Cookie', `bf_ks=${nonce}; Path=/k; HttpOnly; SameSite=Lax; Max-Age=600${req.secure ? '; Secure' : ''}`);
          loc = to;
        } catch (e) { loc = '/k/link?err=' + encodeURIComponent(e.message); }
        res.writeHead(302, { Location: loc, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (url.pathname === '/k/admin-login') {
        let loc;
        if (!req.user || !['admin', 'ops'].includes(req.user.role)) loc = '/login';
        else {
          try {
            const { url: to, nonce } = kakao.adminLoginStart(ctx, req.user.id);
            res.setHeader('Set-Cookie', `bf_ks=${nonce}; Path=/k; HttpOnly; SameSite=Lax; Max-Age=600${req.secure ? '; Secure' : ''}`);
            loc = to;
          } catch (e) { loc = '/?kakao=' + encodeURIComponent(e.message); }
        }
        res.writeHead(302, { Location: loc, 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (url.pathname === '/k/callback') {
        let loc;
        try {
          const r = await kakao.loginCallback(ctx, { code: url.searchParams.get('code'), state: url.searchParams.get('state'), cookieNonce: cookies.bf_ks, sessionUser: req.user });
          loc = r.admin ? '/?kakao=ok' : r.store ? shop.orderLink(ctx, r.store.id) : '/k/link?l=' + encodeURIComponent(r.pendingToken);
        } catch (e) {
          log.error('[카카오 로그인]', e.message);
          loc = (req.user ? '/?kakao=' : '/k/link?err=') + encodeURIComponent(e.message);
        }
        res.writeHead(302, { Location: loc, 'Cache-Control': 'no-store', 'Set-Cookie': `bf_ks=; Path=/k; HttpOnly; SameSite=Lax; Max-Age=0${req.secure ? '; Secure' : ''}` });
        return res.end();
      }
      // 페이지 라우팅
      let page = null;
      if (url.pathname === '/') {
        if (!req.user) { res.writeHead(302, { Location: '/login' }); return res.end(); }
        page = 'console.html';
      } else if (url.pathname === '/login') page = 'login.html';
      else if (/^\/o\/[A-Za-z0-9_\-.]+$/.test(url.pathname)) page = 'owner.html';
      else if (/^\/d\/[A-Za-z0-9_\-.]+$/.test(url.pathname)) page = 'driver.html';
      else if (/^\/m\/[A-Za-z0-9_\-.]+$/.test(url.pathname)) page = 'shop.html';
      else if (url.pathname === '/k/link') page = 'kakao-link.html';
      else if (url.pathname === '/a') {
        if (!req.user) { res.writeHead(302, { Location: '/login?next=%2Fa' }); return res.end(); }
        page = 'admin-m.html';
      }
      else if (/^\/assets\/[a-z0-9_.-]+$/i.test(url.pathname)) page = url.pathname.slice(1);
      if (page && serveFile(res, PUBLIC_DIR, page)) return;
      throw new HttpError(404, '페이지를 찾을 수 없습니다');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) log.error('[HTTP]', req.method, url.pathname, e);
      if (!res.headersSent) send(res, status, { error: status >= 500 ? '서버 오류가 발생했습니다' : e.message });
      else res.end();
    }
  });
}

module.exports = { createServer };
},

// ── server/auth.js ────────────────────────────────────────────────────────
"server/auth.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 운영팀 계정 · 세션 · 로그인 시도 제한
// 비밀번호: scrypt(N=16384) + 무작위 솔트. 세션: 32바이트 무작위 ID, HttpOnly 쿠키, 12시간.

const crypto = require('node:crypto');
const { HttpError } = require('./http');

const SESSION_HOURS = 12;
const ROLES = { viewer: 1, ops: 2, admin: 3 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !k) return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'base64url'), 32, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'base64url');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, '비밀번호는 10자 이상이어야 합니다');
  if (pw.length > 200) throw new HttpError(400, '비밀번호가 너무 깁니다');
}

function createUser(db, { email, name, role, password, mustChange = false }, now = Date.now()) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw new HttpError(400, '이메일 형식이 올바르지 않습니다');
  if (!ROLES[role]) throw new HttpError(400, '권한은 admin, ops, viewer 중 하나입니다');
  if (!String(name || '').trim()) throw new HttpError(400, '이름을 입력해 주세요');
  checkPasswordPolicy(password);
  if (db.get('SELECT 1 FROM users WHERE email = ?', [email])) throw new HttpError(409, '이미 등록된 이메일입니다');
  const r = db.run('INSERT INTO users (email, name, role, pw_hash, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [String(email).trim(), String(name).trim(), role, hashPassword(password), mustChange ? 1 : 0, now]);
  return Number(r.lastInsertRowid);
}

// 로그인 시도 제한: IP·이메일별 15분에 10회
const attempts = new Map();
function limited(key, now) {
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(key, a);
  return a.length >= 10;
}
function recordFail(key, now) { (attempts.get(key) || attempts.set(key, []).get(key)).push(now); }

function login(db, email, password, ip, now = Date.now()) {
  const keys = ['ip:' + ip, 'em:' + String(email).toLowerCase()];
  if (keys.some((k) => limited(k, now))) throw new HttpError(429, '로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요');
  const u = db.get('SELECT * FROM users WHERE email = ?', [String(email || '')]);
  const ok = u && !u.disabled && verifyPassword(String(password || ''), u.pw_hash);
  if (!ok) { keys.forEach((k) => recordFail(k, now)); throw new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다'); }
  keys.forEach((k) => attempts.delete(k));
  const sid = crypto.randomBytes(32).toString('base64url');
  db.run('INSERT INTO sessions (id, user_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)', [sid, u.id, now, now + SESSION_HOURS * 3600e3, ip]);
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, u.id]);
  return { sid, user: publicUser(u) };
}

function sessionUser(db, sid, now = Date.now()) {
  if (!sid || sid.length > 100) return null;
  const r = db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ? AND u.disabled = 0`, [sid, now]);
  return r ? publicUser(r) : null;
}

function logout(db, sid) { if (sid) db.run('DELETE FROM sessions WHERE id = ?', [sid]); }

function publicUser(u) { return { id: u.id, email: u.email, name: u.name, role: u.role, must_change: !!u.must_change }; }

function requireRole(user, role) {
  if (!user) throw new HttpError(401, '로그인이 필요합니다');
  if (ROLES[user.role] < ROLES[role]) throw new HttpError(403, '권한이 없습니다');
}

function changePassword(db, userId, current, next) {
  const u = db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!u || !verifyPassword(String(current || ''), u.pw_hash)) throw new HttpError(400, '현재 비밀번호가 올바르지 않습니다');
  checkPasswordPolicy(next);
  db.run('UPDATE users SET pw_hash = ?, must_change = 0 WHERE id = ?', [hashPassword(next), userId]);
  db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

function cookieHeader(sid, secure, maxAgeSec = SESSION_HOURS * 3600) {
  return `bf_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

module.exports = { hashPassword, verifyPassword, createUser, login, sessionUser, logout, requireRole, changePassword, cookieHeader, checkPasswordPolicy, ROLES, _attempts: attempts };
},

// ── server/context.js ─────────────────────────────────────────────────────
"server/context.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 애플리케이션 컨텍스트: DB · 설정 · 비밀키 · 어댑터를 한곳에 묶는다.

const crypto = require('node:crypto');
const { Db } = require('./db');
const settings = require('./settings');
const { createNotifier } = require('./adapters/notifier');
const { createPayment } = require('./adapters/payment');

const ENV_SECRET = { link: 'BEVFLOW_LINK_SECRET', ingest: 'BEVFLOW_INGEST_SECRET', webhook: 'BEVFLOW_WEBHOOK_SECRET', kakao: 'BEVFLOW_KAKAO_SKILL_SECRET' };

function createContext({ file = ':memory:', env = process.env } = {}) {
  const db = new Db(file);
  const ctx = { db, env, fetch: (...a) => globalThis.fetch(...a) }; // fetch: 카카오 API 호출 (테스트에서 교체)
  ctx.reload = () => { ctx.settings = settings.load(db); ctx.R = settings.rules(ctx.settings); return ctx.R; };
  ctx.getSecret = (name) => {
    if (env[ENV_SECRET[name]]) return env[ENV_SECRET[name]];
    let r = db.get('SELECT value FROM secrets WHERE key = ?', [name]);
    if (!r) {
      db.run('INSERT INTO secrets (key, value) VALUES (?, ?)', [name, crypto.randomBytes(32).toString('base64url')]);
      r = db.get('SELECT value FROM secrets WHERE key = ?', [name]);
    }
    return r.value;
  };
  ctx.rotateSecret = (name) => {
    db.run('INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [name, crypto.randomBytes(32).toString('base64url')]);
    if (name === 'link') ctx.secret = ctx.getSecret('link');
  };
  ctx.reload();
  ctx.secret = ctx.getSecret('link');
  ctx.notifier = createNotifier({ getRules: () => ctx.R, getSecret: ctx.getSecret });
  ctx.payment = createPayment({ getRules: () => ctx.R });
  return ctx;
}

module.exports = { createContext };
},

// ── server/csv.js ─────────────────────────────────────────────────────────
"server/csv.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// CSV 파서 (따옴표·쉼표·줄바꿈 포함 필드, UTF-8 BOM 지원) — 매장·메뉴 매핑·POS 판매 일괄 가져오기용

function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r, n) => {
    const o = { _line: n + 2 };
    head.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

module.exports = { parseCsv };
},

// ── server/db.js ──────────────────────────────────────────────────────────
"server/db.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// SQLite 저장소 (Node.js 내장 node:sqlite). 파일 하나로 운영하고 WAL 모드로 동시 읽기를 허용한다.
// 파일럿 규모(매장 수백 곳)까지 충분하며, 규모가 커지면 이 모듈만 Postgres로 바꾸면 된다.

const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  // v1 — 초기 스키마
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','ops','viewer')), pw_hash TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT
  );

  CREATE TABLE regions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT NOT NULL DEFAULT '', hub_name TEXT NOT NULL DEFAULT '',
    hub_lat REAL, hub_lng REAL, radius_km REAL NOT NULL DEFAULT 3, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE drivers (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', region_id TEXT REFERENCES regions(id),
    vehicle TEXT NOT NULL DEFAULT '', capacity INTEGER NOT NULL DEFAULT 60, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE skus (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, pack INTEGER NOT NULL CHECK (pack > 0), unit TEXT NOT NULL DEFAULT '병',
    price INTEGER NOT NULL CHECK (price >= 0), active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE stores (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id),
    type TEXT NOT NULL DEFAULT 'L' CHECK (type IN ('L','D')),
    owner_name TEXT NOT NULL DEFAULT '', owner_phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
    lat REAL, lng REAL, pos_store_id TEXT UNIQUE,
    send_pref TEXT NOT NULL DEFAULT 'immediate' CHECK (send_pref IN ('immediate','break')),
    review_required INTEGER NOT NULL DEFAULT 0, pay_test_fail INTEGER NOT NULL DEFAULT 0,
    alpha REAL NOT NULL DEFAULT 0, beta REAL,
    cooldown_until INTEGER NOT NULL DEFAULT 0, last_pos_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE store_skus (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, sku_id TEXT NOT NULL REFERENCES skus(id),
    carried INTEGER NOT NULL DEFAULT 1,
    est REAL NOT NULL DEFAULT 0, band REAL NOT NULL DEFAULT 0.08,
    cum_est REAL NOT NULL DEFAULT 0, cum_pos REAL NOT NULL DEFAULT 0,
    base_qty REAL NOT NULL DEFAULT 0, in_since REAL NOT NULL DEFAULT 0,
    rate REAL, rate_manual REAL, safety_override REAL,
    last_count_at INTEGER, last_count_est REAL, last_count_actual REAL, last_count_band REAL,
    last_in_at INTEGER, last_in_qty INTEGER,
    PRIMARY KEY (store_id, sku_id)
  );
  CREATE TABLE menu_map (
    id INTEGER PRIMARY KEY, store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
    menu_name TEXT NOT NULL, sku_id TEXT NOT NULL REFERENCES skus(id), units REAL NOT NULL CHECK (units > 0)
  );
  CREATE UNIQUE INDEX menu_map_uq ON menu_map (COALESCE(store_id, 0), menu_name, sku_id);
  CREATE TABLE unmapped_menu (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, menu_name TEXT NOT NULL,
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, menu_name)
  );

  CREATE TABLE pos_sales (
    id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, ext_id TEXT NOT NULL,
    sold_at INTEGER NOT NULL, menu_name TEXT NOT NULL, qty INTEGER NOT NULL, mapped INTEGER NOT NULL DEFAULT 0, received_at INTEGER NOT NULL,
    UNIQUE (store_id, ext_id)
  );
  CREATE INDEX pos_sales_t ON pos_sales (store_id, sold_at);
  CREATE TABLE pos_sale_items (
    sale_id INTEGER NOT NULL REFERENCES pos_sales(id) ON DELETE CASCADE, store_id INTEGER NOT NULL, sku_id TEXT NOT NULL,
    sold_at INTEGER NOT NULL, boxes REAL NOT NULL
  );
  CREATE INDEX pos_sale_items_t ON pos_sale_items (store_id, sold_at);

  CREATE TABLE inv_snapshots (
    store_id INTEGER NOT NULL, sku_id TEXT NOT NULL, t INTEGER NOT NULL, est REAL NOT NULL, band REAL NOT NULL,
    PRIMARY KEY (store_id, sku_id, t)
  ) WITHOUT ROWID;
  CREATE TABLE counts (
    id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, sku_id TEXT NOT NULL,
    t INTEGER NOT NULL, estimate REAL NOT NULL, actual REAL NOT NULL, band REAL NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('driver','ops','onboarding')), stop_id INTEGER, actor TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX counts_t ON counts (t);

  CREATE TABLE proposals (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, store_id INTEGER NOT NULL REFERENCES stores(id),
    status TEXT NOT NULL CHECK (status IN ('created','sent','payfail','paid','dispatched','delivered','held','expired','cancelled')),
    created_at INTEGER NOT NULL, trigger_sku TEXT, reproposal INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0,
    review INTEGER NOT NULL DEFAULT 0, send_rule TEXT NOT NULL DEFAULT 'auto', send_at INTEGER,
    sent_at INTEGER, opened_at INTEGER, reminded_at INTEGER, responded_at INTEGER, response TEXT, responder TEXT,
    closed_at INTEGER, modified INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL DEFAULT 0,
    pay_method TEXT, paid_at INTEGER, pay_ref TEXT, pay_failed_at INTEGER, pay_fail_reason TEXT,
    deliver_date TEXT, delivered_at INTEGER, token_nonce TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT 'system'
  );
  CREATE INDEX proposals_store ON proposals (store_id, created_at);
  CREATE INDEX proposals_status ON proposals (status);
  CREATE TABLE proposal_lines (
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE, sku_id TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty >= 0), qty_orig INTEGER NOT NULL, est REAL NOT NULL, band REAL NOT NULL, safety REAL NOT NULL,
    trig INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL,
    PRIMARY KEY (proposal_id, sku_id)
  );

  CREATE TABLE messages (
    id INTEGER PRIMARY KEY, proposal_id INTEGER REFERENCES proposals(id), store_id INTEGER, kind TEXT NOT NULL,
    channel TEXT NOT NULL, to_phone TEXT NOT NULL DEFAULT '', template TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, provider_id TEXT, error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
  );
  CREATE INDEX messages_status ON messages (status);

  CREATE TABLE routes (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, region_id TEXT NOT NULL REFERENCES regions(id), driver_id INTEGER REFERENCES drivers(id),
    dispatched_at INTEGER NOT NULL, token_nonce TEXT NOT NULL, UNIQUE (date, region_id)
  );
  CREATE TABLE stops (
    id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id), store_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    eta INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','arrived','done','failed')),
    arrived_at INTEGER, departed_at INTEGER, boxes INTEGER NOT NULL, fail_reason TEXT
  );
  CREATE INDEX stops_route ON stops (route_id);

  CREATE TABLE settlements (
    week_start TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','paid')),
    paid_at INTEGER, paid_by TEXT
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY, t INTEGER NOT NULL, kind TEXT NOT NULL, store_id INTEGER, proposal_id INTEGER, region_id TEXT,
    actor TEXT NOT NULL DEFAULT 'system', message TEXT NOT NULL
  );
  CREATE INDEX events_t ON events (t);
  `,
  // v2 — 업종별 품목(카페·사우나 스낵·식당 음료) · 품목 이용 승인 · 점주 직접 발주 · 카카오 연결
  `
  ALTER TABLE skus ADD COLUMN category TEXT NOT NULL DEFAULT 'beverage' CHECK (category IN ('cafe','snack','beverage'));
  ALTER TABLE skus ADD COLUMN spec TEXT NOT NULL DEFAULT '';
  ALTER TABLE stores ADD COLUMN biz TEXT NOT NULL DEFAULT 'restaurant' CHECK (biz IN ('cafe','sauna','restaurant'));
  ALTER TABLE stores ADD COLUMN link_code TEXT;
  ALTER TABLE stores ADD COLUMN order_nonce TEXT NOT NULL DEFAULT '';
  CREATE UNIQUE INDEX stores_link_code ON stores (link_code) WHERE link_code IS NOT NULL;
  ALTER TABLE proposals ADD COLUMN source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','web','chat'));
  ALTER TABLE proposals ADD COLUMN client_ref TEXT;
  CREATE UNIQUE INDEX proposals_client_ref ON proposals (store_id, client_ref) WHERE client_ref IS NOT NULL;

  CREATE TABLE store_categories (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('cafe','snack','beverage')),
    status TEXT NOT NULL CHECK (status IN ('approved','pending','rejected')),
    requested_at INTEGER NOT NULL, requested_via TEXT NOT NULL DEFAULT 'ops', request_note TEXT NOT NULL DEFAULT '',
    decided_at INTEGER, decided_by TEXT, decide_note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (store_id, category)
  );
  CREATE TABLE carts (
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE, sku_id TEXT NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
    qty INTEGER NOT NULL CHECK (qty > 0), updated_at INTEGER NOT NULL,
    PRIMARY KEY (store_id, sku_id)
  );
  CREATE TABLE kakao_links (
    id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('chatbot','login')), user_key TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '',
    linked_at INTEGER NOT NULL, last_seen_at INTEGER, UNIQUE (kind, user_key)
  );
  INSERT INTO store_categories (store_id, category, status, requested_at, decided_at, decided_by)
    SELECT id, 'beverage', 'approved', created_at, created_at, 'migration' FROM stores;
  `,
  // v3 — 매대(소분류) · 정기 발주서 · 관리자 카톡 알림(나에게 보내기)
  `
  ALTER TABLE skus ADD COLUMN grp TEXT NOT NULL DEFAULT '';
  ALTER TABLE stores ADD COLUMN standing_days TEXT NOT NULL DEFAULT '';
  ALTER TABLE stores ADD COLUMN sheet_at INTEGER;
  ALTER TABLE stores ADD COLUMN sheet_base INTEGER;
  ALTER TABLE stores ADD COLUMN sheet_seen_at INTEGER;

  CREATE TABLE admin_kakao (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, kakao_id TEXT NOT NULL, nickname TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL, access_exp INTEGER NOT NULL, refresh_token TEXT NOT NULL, refresh_exp INTEGER,
    prefs TEXT NOT NULL DEFAULT '{}', linked_at INTEGER NOT NULL, last_error TEXT
  );
  CREATE TABLE admin_notices (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, dedupe TEXT NOT NULL,
    payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
    attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER, UNIQUE (user_id, dedupe)
  );
  CREATE INDEX admin_notices_status ON admin_notices (status);
  CREATE TABLE daily_marks (day TEXT NOT NULL, kind TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (day, kind));
  `,
];

class Db {
  constructor(file) {
    this.file = file;
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.cache = new Map();
    this.depth = 0;
    this.version = 0; // 쓰기마다 증가 → 콘솔 스냅샷 ETag
    this.migrate();
  }
  migrate() {
    const cur = this.raw.prepare('PRAGMA user_version').get().user_version;
    for (let v = cur; v < MIGRATIONS.length; v++) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
        this.raw.exec('COMMIT');
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      }
    }
  }
  st(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  static args(p) {
    if (p == null) return [];
    if (Array.isArray(p)) return p.map(norm);
    const o = {};
    for (const k of Object.keys(p)) o[k] = norm(p[k]);
    return [o];
  }
  all(sql, p) { return this.st(sql).all(...Db.args(p)); }
  get(sql, p) { return this.st(sql).get(...Db.args(p)); }
  run(sql, p) { this.version++; return this.st(sql).run(...Db.args(p)); }
  exec(sql) { this.version++; this.raw.exec(sql); }
  /** 중첩 가능한 트랜잭션 (SAVEPOINT) */
  tx(fn) {
    const name = 'sp' + this.depth;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const r = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      this.version++;
      return r;
    } catch (e) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw e;
    }
  }
  close() { this.raw.close(); }
}
function norm(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

module.exports = { Db };
},

// ── server/engine/catalog.js ──────────────────────────────────────────────
"server/engine/catalog.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 품목 카테고리와 매장별 이용 권한
// - 업종마다 기본 품목이 정해져 있다: 카페 → 카페 품목, 사우나 → 스낵 품목, 식당 → 음료 품목
// - 다른 품목은 점주가 신청하고(카카오톡·발주 화면) 운영자가 승인해야 발주 화면에 나타난다.

const { logEvent } = require('./events');
const adminNotify = require('../adminNotify');

const CATEGORIES = {
  cafe: { label: '카페 품목', short: '카페', icon: '☕' },
  snack: { label: '스낵 품목', short: '스낵', icon: '🍪' },
  beverage: { label: '음료 품목', short: '음료', icon: '🥤' },
};
const BIZ = {
  cafe: { label: '카페', category: 'cafe' },
  sauna: { label: '사우나', category: 'snack' },
  restaurant: { label: '식당', category: 'beverage' },
};
const CAT_IDS = Object.keys(CATEGORIES);

/** 업종 기본 품목을 승인 상태로 둔다 (매장 등록·업종 변경 때) */
function ensureDefault(db, store, actor, now) {
  const cat = BIZ[store.biz].category;
  const cur = db.get('SELECT status FROM store_categories WHERE store_id = ? AND category = ?', [store.id, cat]);
  if (cur && cur.status === 'approved') return;
  db.run(`INSERT INTO store_categories (store_id, category, status, requested_at, requested_via, decided_at, decided_by, decide_note)
          VALUES (?, ?, 'approved', ?, 'ops', ?, ?, '업종 기본 품목')
          ON CONFLICT (store_id, category) DO UPDATE SET status = 'approved', decided_at = excluded.decided_at, decided_by = excluded.decided_by, decide_note = excluded.decide_note`,
  [store.id, cat, now, now, actor]);
}

/** 매장의 카테고리별 상태 [{ id, label, icon, status: approved|pending|rejected|none, isDefault }] */
function storeCategories(db, store) {
  const rows = new Map(db.all('SELECT * FROM store_categories WHERE store_id = ?', [store.id]).map((r) => [r.category, r]));
  const def = BIZ[store.biz].category;
  return CAT_IDS.map((id) => {
    const r = rows.get(id);
    return { id, ...CATEGORIES[id], status: id === def ? 'approved' : r ? r.status : 'none', isDefault: id === def, decideNote: r ? r.decide_note : '', requestedAt: r ? r.requested_at : null };
  }).sort((a, b) => (b.isDefault - a.isDefault) || (a.status === 'approved' ? -1 : 0) - (b.status === 'approved' ? -1 : 0));
}

/** 발주할 수 있는 카테고리 (업종 기본 품목은 항상 포함) */
function approvedSet(db, storeId) {
  const st = db.get('SELECT biz FROM stores WHERE id = ?', [storeId]);
  if (!st) return new Set();
  const set = new Set(db.all("SELECT category FROM store_categories WHERE store_id = ? AND status = 'approved'", [storeId]).map((r) => r.category));
  set.add(BIZ[st.biz].category);
  return set;
}

/** 점주의 품목 이용 신청 */
function requestAccess(ctx, storeId, category, { via = 'web', note = '' } = {}, now = Date.now()) {
  const { db } = ctx;
  if (!CATEGORIES[category]) throw new Error('알 수 없는 품목입니다');
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    const cur = db.get('SELECT * FROM store_categories WHERE store_id = ? AND category = ?', [storeId, category]);
    if (BIZ[store.biz].category === category || (cur && cur.status === 'approved')) throw new Error('이미 이용 중인 품목입니다');
    if (cur && cur.status === 'pending') return { status: 'pending', already: true };
    db.run(`INSERT INTO store_categories (store_id, category, status, requested_at, requested_via, request_note)
            VALUES (?, ?, 'pending', ?, ?, ?)
            ON CONFLICT (store_id, category) DO UPDATE SET status = 'pending', requested_at = excluded.requested_at, requested_via = excluded.requested_via,
              request_note = excluded.request_note, decided_at = NULL, decided_by = NULL, decide_note = ''`,
    [storeId, category, now, via, String(note || '').slice(0, 200)]);
    logEvent(db, { t: now, kind: '품목 신청', store_id: storeId, region_id: store.region_id, actor: 'owner:' + via, message: `${store.name} · ${CATEGORIES[category].label} 이용 신청` });
    adminNotify.accessRequest(ctx, store, CATEGORIES[category].label, String(note || '').slice(0, 60), now);
    return { status: 'pending' };
  });
}

/** 운영자 결정: approve · reject · revoke(승인 취소) */
function decide(ctx, storeId, category, action, { actor, note = '' }, now = Date.now()) {
  const { db } = ctx;
  if (!CATEGORIES[category]) throw new Error('알 수 없는 품목입니다');
  if (!['approve', 'reject', 'revoke'].includes(action)) throw new Error('알 수 없는 처리입니다');
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    if (action !== 'approve' && BIZ[store.biz].category === category) throw new Error('업종 기본 품목은 거절·해제할 수 없습니다. 업종을 먼저 바꿔 주세요');
    const status = action === 'approve' ? 'approved' : 'rejected';
    db.run(`INSERT INTO store_categories (store_id, category, status, requested_at, requested_via, decided_at, decided_by, decide_note)
            VALUES (?, ?, ?, ?, 'ops', ?, ?, ?)
            ON CONFLICT (store_id, category) DO UPDATE SET status = excluded.status, decided_at = excluded.decided_at, decided_by = excluded.decided_by, decide_note = excluded.decide_note`,
    [storeId, category, status, now, now, actor, String(note || '').slice(0, 200)]);
    if (status !== 'approved') db.run('DELETE FROM carts WHERE store_id = ? AND sku_id IN (SELECT id FROM skus WHERE category = ?)', [storeId, category]);
    const word = { approve: '승인', reject: '거절', revoke: '이용 해제' }[action];
    logEvent(db, { t: now, kind: '품목 ' + word, store_id: storeId, region_id: store.region_id, actor, message: `${store.name} · ${CATEGORIES[category].label} ${word}${note ? ' · ' + note : ''}` });
    return { status };
  });
}

module.exports = { CATEGORIES, BIZ, CAT_IDS, ensureDefault, storeCategories, approvedSet, requestAccess, decide };
},

// ── server/engine/delivery.js ─────────────────────────────────────────────
"server/engine/delivery.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 출고·배차와 기사 작업
// 배차: 배송일이 된 결제 완료 발주를 권역별 라우트로 묶고, 거점에서 가까운 순(최근접 이웃)으로 정차 순서를 정한다.
// 하차: 기사가 도착 → 잔량 확인(실사) → 하차 완료. 실사값은 추정 엔진에 바로 반영된다.

const T = require('../time');
const tokens = require('../tokens');
const inv = require('./inventory');
const msg = require('./messages');
const { logEvent } = require('./events');

const dist = (a, b) => (a.lat == null || b.lat == null ? null : Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88.2));

function orderStops(start, stores) {
  const left = stores.slice();
  const out = [];
  let cur = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => {
      const d = dist(cur, s);
      const dd = d == null ? 1e6 + i : d;
      if (dd < bd) { bd = dd; bi = i; }
    });
    cur = left.splice(bi, 1)[0];
    out.push(cur);
  }
  return out;
}

/** 배차 실행 (멱등: 아직 배차되지 않은 건만 추가) */
function dispatch(ctx, dateMid, now, actor = 'system') {
  const { db, R } = ctx;
  const date = T.dateStr(dateMid + T.HOUR);
  const startAt = Math.max(now, T.at(dateMid, R.dispatchH));
  const result = [];
  db.tx(() => {
    for (const rg of db.all('SELECT * FROM regions ORDER BY sort, id')) {
      const orders = db.all(`SELECT p.*, s.lat, s.lng, s.name AS store_name FROM proposals p JOIN stores s ON s.id = p.store_id
                             WHERE p.status = 'paid' AND p.deliver_date <= ? AND s.region_id = ? ORDER BY p.paid_at`, [date, rg.id]);
      if (!orders.length) continue;
      let route = db.get('SELECT * FROM routes WHERE date = ? AND region_id = ?', [date, rg.id]);
      if (!route) {
        const driver = db.get('SELECT * FROM drivers WHERE region_id = ? AND active = 1 ORDER BY id LIMIT 1', [rg.id]);
        const r = db.run('INSERT INTO routes (date, region_id, driver_id, dispatched_at, token_nonce) VALUES (?, ?, ?, ?, ?)',
          [date, rg.id, driver ? driver.id : null, now, tokens.nonce()]);
        route = db.get('SELECT * FROM routes WHERE id = ?', [Number(r.lastInsertRowid)]);
      }
      const last = db.get(`SELECT s.seq, s.eta, st.lat, st.lng FROM stops s JOIN stores st ON st.id = s.store_id WHERE s.route_id = ? ORDER BY s.seq DESC LIMIT 1`, [route.id]);
      const start = last ? { lat: last.lat, lng: last.lng } : { lat: rg.hub_lat, lng: rg.hub_lng };
      let seq = last ? last.seq : 0;
      let clock = last && last.eta ? Math.max(last.eta + R.stop_min * 60e3, startAt) : startAt;
      for (const o of orderStops(start, orders)) {
        clock += R.drive_min * 60e3;
        const boxes = db.get('SELECT COALESCE(SUM(qty), 0) AS b FROM proposal_lines WHERE proposal_id = ?', [o.id]).b;
        db.run('INSERT INTO stops (route_id, proposal_id, store_id, seq, eta, boxes) VALUES (?, ?, ?, ?, ?, ?)', [route.id, o.id, o.store_id, ++seq, clock, boxes]);
        db.run("UPDATE proposals SET status = 'dispatched' WHERE id = ?", [o.id]);
        clock += R.stop_min * 60e3;
      }
      logEvent(db, { t: now, kind: '출고', region_id: rg.id, actor, message: `${rg.name} ${orders.length}건 출고 · 배차` });
      result.push({ region: rg.id, route: route.id, added: orders.length });
    }
  });
  return result;
}

function driverLink(ctx, route) {
  const exp = T.parseDate(route.date) + 2 * T.DAY;
  return ctx.R.public_base_url + '/d/' + tokens.sign(ctx.secret, { k: 'd', id: route.id, n: route.token_nonce, e: exp });
}

function loadStop(db, stopId, routeId) {
  const s = db.get('SELECT * FROM stops WHERE id = ?', [stopId]);
  if (!s || (routeId != null && s.route_id !== routeId)) throw new Error('정차 정보를 찾을 수 없습니다');
  return s;
}

function arrive(ctx, stopId, { routeId = null, actor = 'driver' } = {}, now = Date.now()) {
  const { db } = ctx;
  return db.tx(() => {
    const s = loadStop(db, stopId, routeId);
    if (s.status !== 'pending') throw new Error('이미 도착 처리된 정차입니다');
    db.run("UPDATE stops SET status = 'arrived', arrived_at = ? WHERE id = ?", [now, stopId]);
    const st = db.get('SELECT name, region_id FROM stores WHERE id = ?', [s.store_id]);
    logEvent(db, { t: now, kind: '도착', store_id: s.store_id, proposal_id: s.proposal_id, region_id: st.region_id, actor, message: `${st.name} · ${s.seq}번째 정차 도착` });
  });
}

/**
 * 하차 완료. counts = { skuId: 하차 전 잔량(박스) } — 기사 실사
 */
function complete(ctx, stopId, { counts = null, routeId = null, actor = 'driver' } = {}, now = Date.now()) {
  const { db } = ctx;
  return db.tx(() => {
    const s = loadStop(db, stopId, routeId);
    if (!['pending', 'arrived'].includes(s.status)) throw new Error('이미 처리된 정차입니다');
    const store = db.get('SELECT * FROM stores WHERE id = ?', [s.store_id]);
    const arrivedAt = s.arrived_at || now;
    if (counts && Object.keys(counts).length) inv.applyCount(ctx, store, counts, { source: 'driver', stopId, actor }, now);
    // 재고 추정은 음료 품목만 (카페·스낵 품목은 입고 기록 없이 배송만 처리)
    for (const l of db.all("SELECT l.sku_id, l.qty FROM proposal_lines l JOIN skus k ON k.id = l.sku_id WHERE l.proposal_id = ? AND l.qty > 0 AND k.category = 'beverage'", [s.proposal_id])) {
      db.run('INSERT OR IGNORE INTO store_skus (store_id, sku_id) VALUES (?, ?)', [store.id, l.sku_id]);
      inv.applyReceipt(ctx, store, l.sku_id, l.qty, now);
    }
    db.run("UPDATE stops SET status = 'done', arrived_at = ?, departed_at = ? WHERE id = ?", [arrivedAt, now, stopId]);
    db.run("UPDATE proposals SET status = 'delivered', delivered_at = ? WHERE id = ?", [now, s.proposal_id]);
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [s.proposal_id]);
    msg.enqueue(ctx, p, 'delivered', now);
    logEvent(db, { t: now, kind: '배송 완료', store_id: store.id, proposal_id: p.id, region_id: store.region_id, actor, message: `${store.name} · 하차 ${s.boxes}박스 · 정차 ${((now - arrivedAt) / 60e3).toFixed(1)}분` });
  });
}

function fail(ctx, stopId, { reason = '', routeId = null, actor = 'driver' } = {}, now = Date.now()) {
  const { db, R } = ctx;
  return db.tx(() => {
    const s = loadStop(db, stopId, routeId);
    if (!['pending', 'arrived'].includes(s.status)) throw new Error('이미 처리된 정차입니다');
    const next = T.dateStr(T.nextDeliveryDay(T.kstMidnight(now), R.days, false) + T.HOUR);
    db.run("UPDATE stops SET status = 'failed', fail_reason = ?, departed_at = ? WHERE id = ?", [String(reason || '사유 미입력').slice(0, 200), now, stopId]);
    db.run("UPDATE proposals SET status = 'paid', deliver_date = ? WHERE id = ?", [next, s.proposal_id]);
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [s.proposal_id]);
    msg.enqueue(ctx, p, 'delivery_failed', now);
    const st = db.get('SELECT name, region_id FROM stores WHERE id = ?', [s.store_id]);
    logEvent(db, { t: now, kind: '배송 실패', store_id: s.store_id, proposal_id: p.id, region_id: st.region_id, actor, message: `${st.name} · ${reason || '사유 미입력'} → ${next} 재배송` });
  });
}

module.exports = { dispatch, driverLink, arrive, complete, fail, orderStops };
},

// ── server/engine/events.js ───────────────────────────────────────────────
"server/engine/events.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 운영 이벤트 로그 (감사 기록 겸 콘솔 실시간 스트림)

function logEvent(db, e) {
  db.run('INSERT INTO events (t, kind, store_id, proposal_id, region_id, actor, message) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [e.t, e.kind, e.store_id ?? null, e.proposal_id ?? null, e.region_id ?? null, e.actor || 'system', e.message]);
}

module.exports = { logEvent };
},

// ── server/engine/inventory.js ────────────────────────────────────────────
"server/engine/inventory.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 재고 추정 엔진
// - POS 판매 → 박스 환산 × (1 + 누수 보정 α) 만큼 추정 재고 차감
// - 오차 밴드: w = w0 + β × (마지막 실사 이후 추정 소진량)
// - 실사(기사 하차 전 잔량 확인 또는 운영자 입력) → 편차 기록, α 학습, 추정·밴드 리셋

const T = require('../time');
const { logEvent } = require('./events');

const rateOf = (item, R) => (item.rate != null ? item.rate : item.rate_manual != null ? item.rate_manual : R.default_rate);
const betaOf = (store, R) => (store.beta != null ? store.beta : R.band_beta);
function safetyOf(item, R) {
  if (item.safety_override != null) return item.safety_override;
  return Math.max(0.25, Math.ceil(rateOf(item, R) * R.safety_days * 4) / 4);
}
/** 밴드를 포함한 소진 속도 (박스/일) */
const burnRate = (item, store, R) => Math.max(1e-6, rateOf(item, R) * (1 + store.alpha) * (1 + betaOf(store, R)));

/** 재고 추정·자동 제안 대상 품목 (POS 판매로 추정하는 식당 음료만) */
function carriedItems(db, storeId) {
  return db.all(`SELECT ss.*, k.name, k.pack, k.unit, k.price FROM store_skus ss JOIN skus k ON k.id = ss.sku_id
                 WHERE ss.store_id = ? AND ss.carried = 1 AND k.active = 1 AND k.category = 'beverage' ORDER BY k.sort, k.id`, [storeId]);
}

/** POS 메뉴명 → SKU 매핑 (매장별 매핑이 있으면 우선, 없으면 공통 매핑) */
function mapMenu(db, storeId, menu) {
  const own = db.all('SELECT sku_id, units FROM menu_map WHERE store_id = ? AND menu_name = ?', [storeId, menu]);
  if (own.length) return own;
  return db.all('SELECT sku_id, units FROM menu_map WHERE store_id IS NULL AND menu_name = ?', [menu]);
}

/**
 * 판매 1건 반영. 같은 ext_id는 한 번만 처리(멱등).
 * @returns {{dup?:boolean, mapped:boolean}}
 */
function applySale(ctx, store, sale, now) {
  const { db, R } = ctx;
  const ins = db.run(`INSERT INTO pos_sales (store_id, ext_id, sold_at, menu_name, qty, mapped, received_at)
                      VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT (store_id, ext_id) DO NOTHING`,
  [store.id, sale.ext_id, sale.sold_at, sale.menu, sale.qty, now]);
  if (!ins.changes) return { dup: true, mapped: false };
  const saleId = Number(ins.lastInsertRowid);
  db.run('UPDATE stores SET last_pos_at = MAX(COALESCE(last_pos_at, 0), ?) WHERE id = ?', [now, store.id]);
  const maps = mapMenu(db, store.id, sale.menu);
  if (!maps.length) {
    db.run(`INSERT INTO unmapped_menu (store_id, menu_name, first_seen, last_seen, qty) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (store_id, menu_name) DO UPDATE SET last_seen = excluded.last_seen, qty = qty + excluded.qty`,
    [store.id, sale.menu, sale.sold_at, sale.sold_at, sale.qty]);
    return { mapped: false };
  }
  db.run('UPDATE pos_sales SET mapped = 1 WHERE id = ?', [saleId]);
  const beta = betaOf(store, R);
  for (const m of maps) {
    const sku = db.get('SELECT pack FROM skus WHERE id = ?', [m.sku_id]);
    if (!sku) continue;
    const boxes = (m.units * sale.qty) / sku.pack;
    db.run('INSERT INTO pos_sale_items (sale_id, store_id, sku_id, sold_at, boxes) VALUES (?, ?, ?, ?, ?)', [saleId, store.id, m.sku_id, sale.sold_at, boxes]);
    const item = db.get('SELECT * FROM store_skus WHERE store_id = ? AND sku_id = ? AND carried = 1', [store.id, m.sku_id]);
    // 실사 이전에 팔린 건이 늦게 도착하면 이미 실사값에 반영돼 있으므로 추정에서 빼지 않는다
    if (!item || (item.last_count_at != null && sale.sold_at < item.last_count_at)) continue;
    const est = boxes * (1 + store.alpha);
    const cumEst = item.cum_est + est;
    db.run(`UPDATE store_skus SET est = est - ?, cum_est = ?, cum_pos = cum_pos + ?, band = ? WHERE store_id = ? AND sku_id = ?`,
      [est, cumEst, boxes, R.band_w0 + beta * cumEst, store.id, m.sku_id]);
  }
  return { mapped: true };
}

/**
 * 실사 반영. counts = { skuId: 실제 잔량(박스) }
 * 직전 실사 이후의 실제 소진(= 기준량 + 입고 − 잔량)과 POS 판매를 비교해 매장 누수율 α를 학습한다.
 */
function applyCount(ctx, store, counts, { source, stopId = null, actor = '' }, now) {
  const { db, R } = ctx;
  const rows = [];
  let cumTrue = 0, cumPos = 0, learnable = false;
  for (const [skuId, actualRaw] of Object.entries(counts)) {
    const actual = Number(actualRaw);
    if (!Number.isFinite(actual) || actual < 0 || actual > 10000) throw new Error(`잔량 값이 올바르지 않습니다 (${skuId}: ${actualRaw})`);
    const item = db.get('SELECT * FROM store_skus WHERE store_id = ? AND sku_id = ?', [store.id, skuId]);
    if (!item) throw new Error(`매장에 등록되지 않은 SKU: ${skuId}`);
    rows.push({ item, actual });
    if (item.last_count_at != null && source !== 'onboarding') {
      learnable = true;
      cumTrue += item.base_qty + item.in_since - actual;
      cumPos += item.cum_pos;
    }
  }
  if (learnable && cumPos > 0.3) {
    const obs = Math.max(-0.3, Math.min(1.5, cumTrue / cumPos - 1));
    const alpha = Math.max(-0.2, Math.min(0.8, store.alpha + R.alpha_lr * (obs - store.alpha)));
    db.run('UPDATE stores SET alpha = ? WHERE id = ?', [alpha, store.id]);
    store.alpha = alpha;
  }
  for (const { item, actual } of rows) {
    db.run(`INSERT INTO counts (store_id, sku_id, t, estimate, actual, band, source, stop_id, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [store.id, item.sku_id, now, item.est, actual, item.band, source, stopId, actor]);
    db.run(`UPDATE store_skus SET est = ?, band = ?, cum_est = 0, cum_pos = 0, base_qty = ?, in_since = 0,
              last_count_at = ?, last_count_est = ?, last_count_actual = ?, last_count_band = ?, carried = 1
            WHERE store_id = ? AND sku_id = ?`,
    [actual, R.band_w0, actual, now, item.est, actual, item.band, store.id, item.sku_id]);
  }
  return rows.length;
}

/** 입고 반영 (배송 완료 시) */
function applyReceipt(ctx, store, skuId, qty, now) {
  ctx.db.run(`UPDATE store_skus SET est = est + ?, in_since = in_since + ?, last_in_at = ?, last_in_qty = ?
              WHERE store_id = ? AND sku_id = ?`, [qty, qty, now, qty, store.id, skuId]);
}

/** 시간 단위 스냅샷 (재고 차트용) */
function snapshot(ctx, now) {
  const hourTs = Math.floor(now / T.HOUR) * T.HOUR;
  ctx.db.run(`INSERT OR REPLACE INTO inv_snapshots (store_id, sku_id, t, est, band)
              SELECT ss.store_id, ss.sku_id, ?, ss.est, ss.band FROM store_skus ss JOIN stores s ON s.id = ss.store_id
              WHERE ss.carried = 1 AND s.active = 1`, [hourTs]);
  return hourTs;
}

/** 최근 14일 POS 기반 판매 속도 갱신 (판매 이력 3일 미만이면 수동값/기본값 사용) */
function refreshRates(ctx, now) {
  const { db } = ctx;
  const since = now - 14 * T.DAY;
  const firsts = new Map(db.all('SELECT store_id, MIN(sold_at) AS f FROM pos_sales GROUP BY store_id').map((r) => [r.store_id, r.f]));
  const sums = new Map(db.all('SELECT store_id, sku_id, SUM(boxes) AS b FROM pos_sale_items WHERE sold_at >= ? GROUP BY store_id, sku_id', [since])
    .map((r) => [r.store_id + '|' + r.sku_id, r.b]));
  for (const it of db.all('SELECT store_id, sku_id FROM store_skus')) {
    const f = firsts.get(it.store_id);
    const days = f == null ? 0 : Math.min(14, (now - Math.max(f, since)) / T.DAY);
    const rate = days >= 3 ? (sums.get(it.store_id + '|' + it.sku_id) || 0) / days : null;
    db.run('UPDATE store_skus SET rate = ? WHERE store_id = ? AND sku_id = ?', [rate, it.store_id, it.sku_id]);
  }
}

/** 운영자 실사 입력 (온보딩 포함) */
function recordCount(ctx, storeId, counts, actor, now, onboarding) {
  const store = ctx.db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
  if (!store) throw new Error('매장을 찾을 수 없습니다');
  return ctx.db.tx(() => {
    const n = applyCount(ctx, store, counts, { source: onboarding ? 'onboarding' : 'ops', actor }, now);
    logEvent(ctx.db, { t: now, kind: onboarding ? '초기 실사' : '실사', store_id: store.id, region_id: store.region_id, actor, message: `${store.name} · ${n}개 SKU 잔량 입력` });
    return n;
  });
}

module.exports = { rateOf, betaOf, safetyOf, burnRate, carriedItems, applySale, applyCount, applyReceipt, snapshot, refreshRates, recordCount, mapMenu };
},

// ── server/engine/messages.js ─────────────────────────────────────────────
"server/engine/messages.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 사장님께 보내는 메시지 (알림톡 템플릿) — 아웃박스에 쌓고 발송 어댑터가 내보낸다.
// 알림톡은 사전 승인된 템플릿만 보낼 수 있으므로 template 코드와 변수(variables)를 함께 넘긴다.

const T = require('../time');
const tokens = require('../tokens');

const TEMPLATES = {
  propose: 'BF_PROPOSE_03',
  remind: 'BF_REMIND_01',
  confirm: 'BF_CONFIRM_02',
  payfail: 'BF_PAYFAIL_01',
  hold_ack: 'BF_HOLD_01',
  expire: 'BF_EXPIRE_01',
  delivered: 'BF_DELIVERED_01',
  delivery_failed: 'BF_DLVFAIL_01',
  access_ok: 'BF_ACCESS_OK_02',
  access_no: 'BF_ACCESS_NO_01',
  sheet_ready: 'BF_SHEET_01',
};

const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
const boxTxt = (v) => {
  const r = Math.max(0.5, Math.round(v * 2) / 2);
  return (r % 1 ? r.toFixed(1) : String(r));
};

function ownerLink(ctx, p) {
  const exp = p.created_at + 7 * T.DAY;
  return ctx.R.public_base_url + '/o/' + tokens.sign(ctx.secret, { k: 'o', id: p.id, n: p.token_nonce, e: exp });
}

function linesOf(db, pid) {
  return db.all(`SELECT l.*, k.name FROM proposal_lines l JOIN skus k ON k.id = l.sku_id WHERE l.proposal_id = ?
                 ORDER BY l.trig DESC, l.qty * l.price DESC`, [pid]);
}

/** 예상 도착 문구 */
function arrivalText(ctx, p, now) {
  const { db } = ctx;
  if (p.deliver_date) {
    const mid = T.parseDate(p.deliver_date);
    const stop = db.get('SELECT eta FROM stops WHERE proposal_id = ? ORDER BY id DESC LIMIT 1', [p.id]);
    const today = T.kstMidnight(now);
    const dayWord = mid === today ? '금일' : mid === today + T.DAY ? '내일' : T.dateStr(mid).slice(5).replace('-', '/');
    if (stop && stop.eta) return `${dayWord} ${Math.round(T.kstHour(stop.eta))}시 도착 예정`;
    return `${dayWord} 오후(13~17시) 도착 예정`;
  }
  return '';
}

function build(ctx, p, kind, now) {
  const { db } = ctx;
  const store = db.get('SELECT * FROM stores WHERE id = ?', [p.store_id]);
  const lines = linesOf(db, p.id).filter((l) => l.qty > 0);
  const l0 = lines[0];
  const link = ownerLink(ctx, p);
  const sameDay = T.kstHour(p.sent_at || now) < ctx.R.cutoffH - 0.5;
  const who = store.owner_name ? `${store.owner_name} 사장님` : '사장님';
  const vars = { store: store.name, owner: store.owner_name, who, code: p.code, amount: won(p.amount), link };
  let text = '';
  switch (kind) {
    case 'propose': {
      const others = lines.slice(1);
      Object.assign(vars, { sku: l0.name, stock: boxTxt(l0.est), band: (Math.max(0.1, Math.round(l0.band * 10) / 10)).toFixed(1), qty: l0.qty, arrive: sameDay ? '오늘 도착' : '내일 오후 도착' });
      text = `[BevFlow 발주 제안]\n${who}, ${l0.name} 재고가 약 ${vars.stock}박스(±${vars.band}) 남았어요.\n발주를 시작할까요?\n\n제안 ${l0.qty}박스 · ${vars.arrive}`
        + (others.length ? `\n함께 보충: ${others.slice(0, 3).map((l) => `${l.name} ${l.qty}박스`).join(', ')}${others.length > 3 ? ` 외 ${others.length - 3}건` : ''}` : '')
        + `\n합계 ${vars.amount}\n\n▶ 승인·수량 수정·보류: ${link}`;
      break;
    }
    case 'remind':
      text = `[BevFlow 리마인드]\n${who}, 보내드린 발주 제안(${l0 ? l0.name : ''}) 확인 부탁드려요.\n▶ ${link}`;
      break;
    case 'confirm':
      vars.arrive = arrivalText(ctx, p, now);
      vars.total = vars.amount + (p.pay_method === 'invoice' ? ' (월말 청구)' : '');
      text = `[BevFlow 발주 확정]\n✓ ${p.code} 발주가 확정됐어요 — ${vars.arrive}\n합계 ${vars.total}\n▶ ${link}`;
      break;
    case 'payfail':
      text = `[BevFlow 결제 안내]\n${who}, ${p.code} 결제가 완료되지 않았어요 (${p.pay_fail_reason || '카드 승인 거절'}).\n결제 수단을 확인해 주시면 바로 출고할게요.\n▶ ${link}`;
      break;
    case 'hold_ack':
      text = `[BevFlow]\n보류했어요. 내일 오전에 재고를 다시 확인해 안내드릴게요.`;
      break;
    case 'expire':
      text = `[BevFlow]\n응답이 없어 이번 발주 제안(${p.code})은 만료됐어요. 내일 오전에 다시 확인해 드릴게요.`;
      break;
    case 'delivered': {
      const stop = db.get('SELECT departed_at, boxes FROM stops WHERE proposal_id = ? AND status = \'done\' ORDER BY id DESC LIMIT 1', [p.id]);
      Object.assign(vars, { time: stop ? T.fmtTime(stop.departed_at) : '', boxes: stop ? stop.boxes : '' });
      text = `[BevFlow 배송 완료]\n${vars.time}에 주문하신 ${vars.boxes}박스를 하차했어요. 확인 부탁드려요.`;
      break;
    }
    case 'delivery_failed':
      text = `[BevFlow 배송 안내]\n오늘 배송을 완료하지 못했어요. 다음 배송일에 다시 방문할게요.`;
      break;
    default: throw new Error('알 수 없는 메시지 종류: ' + kind);
  }
  return { store, text, vars, template: TEMPLATES[kind], buttons: ['propose', 'remind', 'confirm', 'payfail'].includes(kind) ? [{ name: kind === 'propose' ? '발주 확인하기' : '확인하기', url: link }] : [] };
}

/** 아웃박스에 메시지 적재 (실제 발송은 flushOutbox) */
function enqueue(ctx, p, kind, now) {
  const m = build(ctx, p, kind, now);
  ctx.db.run(`INSERT INTO messages (proposal_id, store_id, kind, channel, to_phone, template, body, payload, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [p.id, p.store_id, kind, ctx.R.notifier, m.store.owner_phone, m.template, m.text, JSON.stringify({ variables: m.vars, buttons: m.buttons }), now]);
}

/**
 * 발주 건과 무관한 매장 안내 (품목 승인 결과 · 정기 발주서 준비) — 버튼은 발주 화면으로 연결
 * 알림톡은 정보성 메시지만 보낼 수 있어서, 점주가 요청하지 않은 발주 권유(링크만 보내기 등)는 만들지 않는다.
 * @param kind access_ok | access_no | sheet_ready
 */
function enqueueNotice(ctx, storeId, kind, { text, vars = {}, link = null, button = '확인하기' }, now) {
  const store = ctx.db.get('SELECT * FROM stores WHERE id = ?', [storeId]);
  if (!TEMPLATES[kind]) throw new Error('알 수 없는 메시지 종류: ' + kind);
  const buttons = link ? [{ name: button, url: link }] : [];
  ctx.db.run(`INSERT INTO messages (proposal_id, store_id, kind, channel, to_phone, template, body, payload, created_at)
              VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [storeId, kind, ctx.R.notifier, store.owner_phone, TEMPLATES[kind], text, JSON.stringify({ variables: { store: store.name, owner: store.owner_name, ...vars, ...(link ? { link } : {}) }, buttons }), now]);
}

/** 대기 중인 메시지 발송 (최대 5회 재시도) */
async function flushOutbox(ctx, now) {
  const { db } = ctx;
  const queued = db.all("SELECT * FROM messages WHERE status = 'queued' ORDER BY id LIMIT 50");
  for (const m of queued) {
    let res;
    try { res = await ctx.notifier.deliver(m); } catch (e) { res = { ok: false, error: String(e && e.message || e) }; }
    if (res.ok) db.run("UPDATE messages SET status = 'sent', sent_at = ?, provider_id = ?, attempts = attempts + 1, error = NULL WHERE id = ?", [now, res.id || null, m.id]);
    else db.run("UPDATE messages SET attempts = attempts + 1, error = ?, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'queued' END WHERE id = ?", [String(res.error || '발송 실패').slice(0, 300), m.id]);
  }
  return queued.length;
}

module.exports = { enqueue, enqueueNotice, flushOutbox, ownerLink, build, TEMPLATES, linesOf };
},

// ── server/engine/orders.js ───────────────────────────────────────────────
"server/engine/orders.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 승인 · 보류 · 결제 · 취소
// 결제 어댑터가 비동기(PG)일 수 있으므로 응답 기록과 결제 결과 반영을 두 트랜잭션으로 나눈다.

const T = require('../time');
const msg = require('./messages');
const { logEvent } = require('./events');
const adminNotify = require('../adminNotify');

/** 결제 시각 기준 배송일: 컷오프 전이면 그날(배송 요일일 때), 아니면 다음 배송일 */
function deliverDate(paidAt, R) {
  const mid = T.kstMidnight(paidAt);
  const d = T.kstHour(paidAt) < R.cutoffH ? T.nextDeliveryDay(mid, R.days, true) : T.nextDeliveryDay(mid, R.days, false);
  return T.dateStr(d + T.HOUR);
}

function load(db, pid) {
  const p = db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
  if (!p) throw new Error('발주를 찾을 수 없습니다');
  return p;
}

/**
 * 승인 (사장님 링크 또는 운영자 대리 승인)
 * @param qty { skuId: 수량 } — 수량 수정 시
 */
async function approve(ctx, pid, { qty = null, actor = 'owner', note = '' } = {}, now = Date.now()) {
  const { db } = ctx;
  const p = db.tx(() => {
    const p = load(db, pid);
    if (!['created', 'sent'].includes(p.status) || p.responded_at != null) throw new Error('이미 처리된 발주입니다');
    let modified = 0;
    if (qty && typeof qty === 'object') {
      for (const [sku, raw] of Object.entries(qty)) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 200) throw new Error('수량은 0~200 사이 정수입니다');
        const l = db.get('SELECT * FROM proposal_lines WHERE proposal_id = ? AND sku_id = ?', [pid, sku]);
        if (!l) throw new Error('제안에 없는 SKU입니다: ' + sku);
        if (l.qty !== n) { db.run('UPDATE proposal_lines SET qty = ? WHERE proposal_id = ? AND sku_id = ?', [n, pid, sku]); modified = 1; }
      }
    }
    const amount = db.get('SELECT COALESCE(SUM(qty * price), 0) AS a FROM proposal_lines WHERE proposal_id = ?', [pid]).a;
    if (amount <= 0) throw new Error('수량이 모두 0입니다. 보류를 이용해 주세요');
    db.run(`UPDATE proposals SET responded_at = ?, response = 'approve', responder = ?, modified = ?, amount = ?,
              opened_at = COALESCE(opened_at, ?), sent_at = COALESCE(sent_at, ?), status = 'sent' WHERE id = ?`,
    [now, actor, modified, amount, now, p.status === 'created' ? null : p.sent_at, pid]);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '발주 승인', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · ${Math.round(amount).toLocaleString('ko-KR')}원${modified ? ' · 수량 수정' : ''}${note ? ' · ' + note : ''}` });
    return load(db, pid);
  });
  return charge(ctx, p, actor, now);
}

async function charge(ctx, p, actor, now) {
  const { db } = ctx;
  const store = db.get('SELECT * FROM stores WHERE id = ?', [p.store_id]);
  let res;
  try { res = await ctx.payment.charge({ proposal: p, store }); } catch (e) { res = { ok: false, reason: String(e && e.message || e) }; }
  return db.tx(() => {
    if (res.ok) {
      const dd = deliverDate(now, ctx.R);
      db.run(`UPDATE proposals SET status = 'paid', paid_at = ?, pay_ref = ?, pay_method = ?, deliver_date = ?, pay_fail_reason = NULL WHERE id = ?`,
        [now, res.ref || null, res.method || ctx.R.pay_method, dd, p.id]);
      const q = load(db, p.id);
      msg.enqueue(ctx, q, 'confirm', now);
      adminNotify.orderResult(ctx, q, now);
      logEvent(db, { t: now, kind: '결제 완료', store_id: p.store_id, proposal_id: p.id, region_id: store.region_id, actor, message: `${store.name} · ${res.method === 'invoice' ? '후불 청구 확정' : '자동결제'} · ${dd} 배송` });
      return q;
    }
    db.run("UPDATE proposals SET status = 'payfail', pay_failed_at = ?, pay_fail_reason = ? WHERE id = ?", [now, String(res.reason || '결제 실패').slice(0, 200), p.id]);
    const q = load(db, p.id);
    msg.enqueue(ctx, q, 'payfail', now);
    adminNotify.orderResult(ctx, q, now);
    logEvent(db, { t: now, kind: '결제 실패', store_id: p.store_id, proposal_id: p.id, region_id: store.region_id, actor, message: `${store.name} · ${q.pay_fail_reason}` });
    return q;
  });
}

async function retryPayment(ctx, pid, actor, now = Date.now()) {
  const p = load(ctx.db, pid);
  if (p.status !== 'payfail') throw new Error('결제 실패 건만 재결제할 수 있습니다');
  return charge(ctx, p, actor, now);
}

function hold(ctx, pid, { actor = 'owner' } = {}, now = Date.now()) {
  const { db, R } = ctx;
  return db.tx(() => {
    const p = load(db, pid);
    if (!['created', 'sent'].includes(p.status) || p.responded_at != null) throw new Error('이미 처리된 발주입니다');
    db.run(`UPDATE proposals SET status = 'held', responded_at = ?, response = 'hold', responder = ?, closed_at = ?, opened_at = COALESCE(opened_at, ?) WHERE id = ?`, [now, actor, now, now, pid]);
    db.run('UPDATE stores SET cooldown_until = ? WHERE id = ?', [T.at(T.kstMidnight(now) + T.DAY, R.retryH), p.store_id]);
    msg.enqueue(ctx, p, 'hold_ack', now);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '보류', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · 보류 → 내일 재확인` });
    return load(db, pid);
  });
}

function cancel(ctx, pid, actor, now = Date.now()) {
  const { db } = ctx;
  return db.tx(() => {
    const p = load(db, pid);
    if (!['created', 'sent', 'payfail', 'paid'].includes(p.status)) throw new Error('배차 전 발주만 취소할 수 있습니다');
    db.run("UPDATE proposals SET status = 'cancelled', closed_at = ? WHERE id = ?", [now, pid]);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '취소', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · ${p.code} 취소` });
    return load(db, pid);
  });
}

function markOpened(ctx, pid, now) {
  ctx.db.run('UPDATE proposals SET opened_at = ? WHERE id = ? AND opened_at IS NULL AND sent_at IS NOT NULL', [now, pid]);
}

module.exports = { deliverDate, approve, retryPayment, hold, cancel, markOpened };
},

// ── server/engine/proposals.js ────────────────────────────────────────────
"server/engine/proposals.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 발주 제안 엔진
// 트리거: 오차 밴드 하한(추정 − 밴드)이 안전재고 이하 → 제안 생성
// 묶음: 트리거 SKU + 향후 lookahead_days 안에 트리거가 예상되는 SKU를 한 번에 채워 주 1회 배송에 맞춘다.
// 발송 규칙: 야간(21~09시) 생성분은 09시, 브레이크타임 선호 매장의 점심 피크 생성분은 15시, 검수 대상 매장은 운영자 확인 후.

const T = require('../time');
const tokens = require('../tokens');
const inv = require('./inventory');
const { logEvent } = require('./events');
const msg = require('./messages');

const OPEN = ['created', 'sent', 'payfail', 'paid', 'dispatched'];

function openProposal(db, storeId) {
  return db.get(`SELECT * FROM proposals WHERE store_id = ? AND status IN ('created','sent','payfail','paid','dispatched') ORDER BY id DESC LIMIT 1`, [storeId]);
}

function buildLines(store, items, trig, R) {
  const lines = [];
  for (const it of items) {
    const S = inv.safetyOf(it, R);
    const burn = inv.burnRate(it, store, R);
    const dtt = (it.est - it.band - S) / burn;
    const target = S + R.band_w0 + burn * R.cover_days;
    const q = Math.max(1, Math.ceil(target - it.est - 0.2));
    if (it.sku_id === trig.sku_id || dtt < R.lookahead_days) {
      lines.push({ sku_id: it.sku_id, qty: q, est: it.est, band: it.band, safety: S, trig: it.sku_id === trig.sku_id ? 1 : 0, price: it.price });
    }
  }
  lines.sort((a, b) => (b.trig - a.trig) || (b.qty * b.price - a.qty * a.price));
  return lines;
}

function computeSend(store, createdAt, R) {
  const mid = T.kstMidnight(createdAt), h = T.kstHour(createdAt);
  if (h >= R.nightStartH) return { rule: 'night', at: T.at(mid + T.DAY, R.nightEndH) };
  if (h < R.nightEndH) return { rule: 'night', at: T.at(mid, R.nightEndH) };
  if (store.send_pref === 'break' && h >= R.breakFromH && h < R.breakToH) return { rule: 'break', at: T.at(mid, R.breakSendH) };
  return { rule: 'auto', at: createdAt };
}

function nextCode(db, now) {
  const d = T.dateStr(now).replace(/-/g, '').slice(2);
  const mid = T.kstMidnight(now);
  const n = db.get('SELECT COUNT(*) AS c FROM proposals WHERE created_at >= ? AND created_at < ?', [mid, mid + T.DAY]).c + 1;
  let code = `PO-${d}-${String(n).padStart(3, '0')}`;
  for (let k = n + 1; db.get('SELECT 1 FROM proposals WHERE code = ?', [code]); k++) code = `PO-${d}-${String(k).padStart(3, '0')}`;
  return code;
}

function createProposal(ctx, store, items, trig, now, { manual = false, actor = 'system' } = {}) {
  const { db, R } = ctx;
  const lines = buildLines(store, items, trig, R);
  const amount = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const last = db.get("SELECT status, closed_at FROM proposals WHERE store_id = ? ORDER BY id DESC LIMIT 1", [store.id]);
  const reproposal = last && ['held', 'expired'].includes(last.status) && now - last.closed_at < 36 * T.HOUR ? 1 : 0;
  const send = computeSend(store, now, R);
  const review = store.review_required ? 1 : 0;
  const r = db.run(`INSERT INTO proposals (code, store_id, status, created_at, trigger_sku, reproposal, manual, review, send_rule, send_at, amount, token_nonce, created_by)
                    VALUES (?, ?, 'created', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [nextCode(db, now), store.id, now, trig.sku_id, reproposal, manual ? 1 : 0, review, send.rule, review ? null : send.at, amount, tokens.nonce(), actor]);
  const pid = Number(r.lastInsertRowid);
  for (const l of lines) {
    db.run('INSERT INTO proposal_lines (proposal_id, sku_id, qty, qty_orig, est, band, safety, trig, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [pid, l.sku_id, l.qty, l.qty, l.est, l.band, l.safety, l.trig, l.price]);
  }
  logEvent(db, { t: now, kind: '제안 생성', store_id: store.id, proposal_id: pid, region_id: store.region_id, actor, message: `${store.name} · ${trig.name} 하한 도달${manual ? ' (운영자 선제 제안)' : ''}${review ? ' · 검수 대기' : ''}` });
  return db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
}

/** 모든 매장의 트리거 점검 (스케줄러가 주기적으로 호출) */
function evaluateTriggers(ctx, now) {
  const { db, R } = ctx;
  const created = [];
  for (const store of db.all('SELECT * FROM stores WHERE active = 1')) {
    if (now < store.cooldown_until) continue;
    if (openProposal(db, store.id)) continue;
    const items = inv.carriedItems(db, store.id);
    if (!items.length || items.every((i) => i.last_count_at == null)) continue; // 초기 실사 전에는 제안하지 않음
    const trig = items.filter((i) => i.last_count_at != null && i.est - i.band <= inv.safetyOf(i, R))
      .sort((a, b) => (a.est - a.band - inv.safetyOf(a, R)) - (b.est - b.band - inv.safetyOf(b, R)))[0];
    if (trig) created.push(createProposal(ctx, store, items, trig, now));
  }
  return created;
}

/** 운영자 선제 제안 */
function proposeNow(ctx, storeId, actor, now) {
  const { db, R } = ctx;
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    if (openProposal(db, store.id)) throw new Error('이미 진행 중인 발주가 있습니다');
    const items = inv.carriedItems(db, store.id);
    if (!items.length) throw new Error('취급 SKU가 없습니다');
    const trig = items.slice().sort((a, b) => (a.est - a.band - inv.safetyOf(a, R)) / inv.burnRate(a, store, R) - (b.est - b.band - inv.safetyOf(b, R)) / inv.burnRate(b, store, R))[0];
    return createProposal(ctx, store, items, trig, now, { manual: true, actor });
  });
}

/** 발송 시각이 된 제안 발송 */
function sendDue(ctx, now) {
  const { db } = ctx;
  const due = db.all("SELECT * FROM proposals WHERE status = 'created' AND send_at IS NOT NULL AND send_at <= ?", [now]);
  for (const p of due) {
    db.run("UPDATE proposals SET status = 'sent', sent_at = ? WHERE id = ?", [now, p.id]);
    const store = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    msg.enqueue(ctx, { ...p, status: 'sent', sent_at: now }, 'propose', now);
    logEvent(db, { t: now, kind: '알림톡', store_id: p.store_id, proposal_id: p.id, region_id: store.region_id, message: `${store.name} · 발주 제안 발송` });
  }
  return due.length;
}

function sendNow(ctx, pid, actor, now) {
  const { db } = ctx;
  return db.tx(() => {
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
    if (!p || p.status !== 'created') throw new Error('발송 전 제안만 즉시 발송할 수 있습니다');
    db.run('UPDATE proposals SET send_at = ?, review = 0 WHERE id = ?', [now, pid]);
    logEvent(db, { t: now, kind: '검수 완료', store_id: p.store_id, proposal_id: pid, actor, message: `${p.code} 즉시 발송` });
    sendDue(ctx, now);
  });
}

function remind(ctx, pid, actor, now) {
  const { db } = ctx;
  return db.tx(() => {
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [pid]);
    if (!p || p.status !== 'sent' || p.responded_at != null) throw new Error('응답 대기 중인 제안만 리마인드할 수 있습니다');
    db.run('UPDATE proposals SET reminded_at = ? WHERE id = ?', [now, pid]);
    msg.enqueue(ctx, p, 'remind', now);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '알림톡', store_id: p.store_id, proposal_id: pid, region_id: s.region_id, actor, message: `${s.name} · 리마인드 발송` });
  });
}

/** 자동 리마인드 · 무응답 만료 */
function sweepPending(ctx, now) {
  const { db, R } = ctx;
  if (R.auto_remind_min > 0) {
    for (const p of db.all("SELECT * FROM proposals WHERE status = 'sent' AND responded_at IS NULL AND reminded_at IS NULL AND sent_at <= ?", [now - R.auto_remind_min * 60e3])) {
      if (now - p.sent_at >= R.expire_hours * T.HOUR) continue;
      db.run('UPDATE proposals SET reminded_at = ? WHERE id = ?', [now, p.id]);
      msg.enqueue(ctx, p, 'remind', now);
    }
  }
  for (const p of db.all("SELECT * FROM proposals WHERE status = 'sent' AND responded_at IS NULL AND sent_at <= ?", [now - R.expire_hours * T.HOUR])) {
    const retry = T.at(T.kstMidnight(now) + T.DAY, R.retryH);
    db.run("UPDATE proposals SET status = 'expired', response = 'none', closed_at = ? WHERE id = ?", [now, p.id]);
    db.run('UPDATE stores SET cooldown_until = ? WHERE id = ?', [retry, p.store_id]);
    msg.enqueue(ctx, p, 'expire', now);
    const s = db.get('SELECT name, region_id FROM stores WHERE id = ?', [p.store_id]);
    logEvent(db, { t: now, kind: '미응답', store_id: p.store_id, proposal_id: p.id, region_id: s.region_id, message: `${s.name} · ${R.expire_hours}시간 무응답으로 제안 만료` });
  }
}

module.exports = { OPEN, openProposal, buildLines, computeSend, nextCode, createProposal, evaluateTriggers, proposeNow, sendDue, sendNow, remind, sweepPending };
},

// ── server/engine/settlement.js ───────────────────────────────────────────
"server/engine/settlement.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 티오더 정산 — 파일럿 시작일부터 7일 단위 주차로 결제 완료 GMV를 집계하고 수수료를 계산한다.
// 취소된 발주는 제외. 주차가 끝나면 '마감', 지급을 확인하면 '지급 완료'로 표시한다.

const T = require('../time');

function weeks(ctx, now) {
  const { db, R } = ctx;
  const start = R.pilotStart;
  const out = [];
  const marks = new Map(db.all('SELECT * FROM settlements').map((r) => [r.week_start, r]));
  for (let k = 0, ws = start; ws <= now; k++, ws += 7 * T.DAY) {
    const we = ws + 7 * T.DAY;
    const agg = db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS gmv FROM proposals
                        WHERE paid_at >= ? AND paid_at < ? AND status NOT IN ('cancelled')`, [ws, we]);
    const key = T.dateStr(ws);
    const mark = marks.get(key);
    const ended = now >= we;
    out.push({
      week: k + 1, start: key, end: T.dateStr(we - T.HOUR), orders: agg.n, gmv: agg.gmv,
      fee: Math.round(agg.gmv * R.fee_rate), fee_rate: R.fee_rate,
      pay_date: T.dateStr(we - T.HOUR + R.settle_lag_days * T.DAY),
      status: !ended ? 'open' : mark && mark.status === 'paid' ? 'paid' : 'closed', paid_at: mark ? mark.paid_at : null,
    });
  }
  return out;
}

function markPaid(ctx, weekStart, actor, now) {
  T.parseDate(weekStart);
  ctx.db.run(`INSERT INTO settlements (week_start, status, paid_at, paid_by) VALUES (?, 'paid', ?, ?)
              ON CONFLICT (week_start) DO UPDATE SET status = 'paid', paid_at = excluded.paid_at, paid_by = excluded.paid_by`, [weekStart, now, actor]);
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 스프레드시트 수식 주입 방지
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** 주차 정산 내역서 CSV (엑셀 호환 UTF-8 BOM) */
function csv(ctx, weekStart) {
  const { db, R } = ctx;
  const ws = T.parseDate(weekStart), we = ws + 7 * T.DAY;
  const rows = db.all(`SELECT p.code, p.paid_at, p.amount, p.pay_method, p.status, s.code AS store_code, s.name AS store_name, s.pos_store_id,
                         (SELECT COALESCE(SUM(qty), 0) FROM proposal_lines l WHERE l.proposal_id = p.id) AS boxes
                       FROM proposals p JOIN stores s ON s.id = p.store_id
                       WHERE p.paid_at >= ? AND p.paid_at < ? AND p.status NOT IN ('cancelled') ORDER BY p.paid_at`, [ws, we]);
  const head = ['발주번호', '결제일시(KST)', '매장코드', '매장명', '티오더 매장ID', '박스', '결제금액', `수수료(${(R.fee_rate * 100).toFixed(1)}%)`, '결제방식', '상태'];
  const lines = [head.map(csvCell).join(',')];
  let g = 0, f = 0;
  for (const r of rows) {
    const fee = Math.round(r.amount * R.fee_rate);
    g += r.amount; f += fee;
    lines.push([r.code, T.dateStr(r.paid_at) + ' ' + T.fmtTime(r.paid_at), r.store_code, r.store_name, r.pos_store_id || '', r.boxes, r.amount, fee, r.pay_method === 'invoice' ? '후불 청구' : '카드', r.status].map(csvCell).join(','));
  }
  lines.push(['합계', '', '', '', '', '', g, f, '', ''].map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { weeks, markPaid, csv, csvCell };
},

// ── server/engine/shop.js ─────────────────────────────────────────────────
"server/engine/shop.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 점주 직접 발주 — 카카오톡 채팅(버튼 선택)과 모바일 발주 화면이 같은 장바구니·같은 발주 흐름을 쓴다.
// 접수된 발주는 자동 제안과 같은 proposals 테이블에 들어가 결제 → 배차 → 배송 → 정산을 그대로 탄다.

const T = require('../time');
const tokens = require('../tokens');
const catalog = require('./catalog');
const orders = require('./orders');
const props = require('./proposals');
const { logEvent } = require('./events');
const msg = require('./messages');

const MAX_QTY = 200;
const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
/** 발주 단위: 낱개로 파는 품목(입수 1)은 그 단위(봉·병), 나머지는 박스 */
const unitOf = (k) => (k.pack === 1 ? k.unit : '박스');

// ── 발주 화면 링크 (/m/…) ─────────────────────────────────────
function orderLink(ctx, storeId, now = Date.now(), hours = ctx.R.order_link_hours) {
  const { db } = ctx;
  let s = db.get('SELECT id, order_nonce FROM stores WHERE id = ?', [storeId]);
  if (!s) throw new Error('매장을 찾을 수 없습니다');
  if (!s.order_nonce) {
    db.run("UPDATE stores SET order_nonce = ? WHERE id = ? AND order_nonce = ''", [tokens.nonce(), storeId]);
    s = db.get('SELECT id, order_nonce FROM stores WHERE id = ?', [storeId]);
  }
  return ctx.R.public_base_url + '/m/' + tokens.sign(ctx.secret, { k: 'm', id: s.id, n: s.order_nonce, e: now + hours * T.HOUR });
}

/** 발주 화면 토큰 → 매장 (없거나 만료면 null) */
function storeFromToken(ctx, token, now = Date.now()) {
  const t = tokens.verify(ctx.secret, token, 'm', now);
  if (!t) return null;
  const s = ctx.db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [t.id]);
  return s && s.order_nonce && s.order_nonce === t.n ? s : null;
}

/** 매장의 모든 발주 링크 무효화 (분실·점주 변경 시) */
function revokeLinks(ctx, storeId) {
  ctx.db.run('UPDATE stores SET order_nonce = ? WHERE id = ?', [tokens.nonce(), storeId]);
}

// ── 품목 ───────────────────────────────────────────────────
function orderable(db, storeId) {
  const cats = catalog.approvedSet(db, storeId);
  if (!cats.size) return [];
  return db.all(`SELECT id, name, spec, pack, unit, price, category, grp, sort FROM skus WHERE active = 1 AND category IN (${[...cats].map(() => '?').join(',')}) ORDER BY sort, id`, [...cats]);
}

function orderableMap(db, storeId) { return new Map(orderable(db, storeId).map((k) => [k.id, k])); }

/** 최근 90일 SKU별 발주 횟수·마지막 수량 (자주 시키는 품목을 위로) */
function history(db, storeId, now) {
  const out = new Map();
  for (const r of db.all(`SELECT l.sku_id, COUNT(*) AS n, MAX(p.id) AS last_id FROM proposal_lines l JOIN proposals p ON p.id = l.proposal_id
                          WHERE p.store_id = ? AND p.created_at >= ? AND l.qty > 0 AND p.status NOT IN ('cancelled','held','expired') GROUP BY l.sku_id`, [storeId, now - 90 * T.DAY])) {
    const last = db.get('SELECT qty FROM proposal_lines WHERE proposal_id = ? AND sku_id = ?', [r.last_id, r.sku_id]);
    out.set(r.sku_id, { n: r.n, lastQty: last ? last.qty : 0 });
  }
  return out;
}

// ── 장바구니 (채팅·화면 공용, 매장 단위) ─────────────────────────
function cart(db, storeId) {
  const items = db.all(`SELECT c.sku_id AS sku, c.qty, k.name, k.price, k.category, k.pack, k.unit FROM carts c JOIN skus k ON k.id = c.sku_id
                        WHERE c.store_id = ? ORDER BY k.category, k.sort, k.id`, [storeId]);
  const ok = orderableMap(db, storeId);
  const lines = items.filter((i) => ok.has(i.sku)).map((i) => ({ ...i, u: unitOf(i) }));
  return { lines, count: lines.length, boxes: lines.reduce((a, l) => a + l.qty, 0), amount: lines.reduce((a, l) => a + l.qty * l.price, 0) };
}

function setCart(ctx, storeId, sku, qty, now = Date.now()) {
  const { db } = ctx;
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw new Error(`수량은 0~${MAX_QTY} 사이 정수입니다`);
  if (!orderableMap(db, storeId).has(sku)) throw new Error('발주할 수 없는 품목입니다');
  if (n === 0) db.run('DELETE FROM carts WHERE store_id = ? AND sku_id = ?', [storeId, sku]);
  else db.run(`INSERT INTO carts (store_id, sku_id, qty, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT (store_id, sku_id) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at`, [storeId, sku, n, now]);
  return cart(db, storeId);
}

function addCart(ctx, storeId, sku, delta, now = Date.now()) {
  const cur = ctx.db.get('SELECT qty FROM carts WHERE store_id = ? AND sku_id = ?', [storeId, sku]);
  return setCart(ctx, storeId, sku, Math.max(0, Math.min(MAX_QTY, (cur ? cur.qty : 0) + delta)), now);
}

function clearCart(ctx, storeId) { ctx.db.run('DELETE FROM carts WHERE store_id = ?', [storeId]); }

/** 지난 발주와 똑같이 → 장바구니 (지금 발주할 수 있는 품목만) */
function reorderToCart(ctx, storeId, now = Date.now()) {
  const { db } = ctx;
  const last = db.get(`SELECT id, code FROM proposals WHERE store_id = ? AND status IN ('paid','dispatched','delivered') ORDER BY id DESC LIMIT 1`, [storeId]);
  if (!last) throw new Error('지난 발주 내역이 없습니다');
  const ok = orderableMap(db, storeId);
  let n = 0;
  db.tx(() => {
    db.run('DELETE FROM carts WHERE store_id = ?', [storeId]);
    for (const l of db.all('SELECT sku_id, qty FROM proposal_lines WHERE proposal_id = ? AND qty > 0', [last.id])) {
      if (!ok.has(l.sku_id)) continue;
      db.run('INSERT INTO carts (store_id, sku_id, qty, updated_at) VALUES (?, ?, ?, ?)', [storeId, l.sku_id, Math.min(MAX_QTY, l.qty), now]);
      n++;
    }
  });
  if (!n) throw new Error('지난 발주 품목 중 지금 발주할 수 있는 품목이 없습니다');
  return { from: last.code, cart: cart(db, storeId) };
}

// ── 정기 발주서 (사우나처럼 품목이 많은 매장: 지난번 수량이 채워진 발주서에서 바뀐 것만 고친다) ──
/** 발주서 방식 매장인지 (사우나 매점) */
const sheetMode = (store) => store.biz === 'sauna';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const daysText = (s) => String(s || '').split(',').filter((x) => x !== '').map((d) => DOW[+d]).join('·');

function lastOrder(db, storeId) {
  return db.get("SELECT id, code, created_at FROM proposals WHERE store_id = ? AND status IN ('paid','dispatched','delivered') ORDER BY id DESC LIMIT 1", [storeId]);
}

/**
 * 발주서 준비: 장바구니가 비어 있으면 지난 발주 수량으로 채우고, 비교 기준(지난 발주)을 기록한다.
 * notify=true면 점주에게 발주서 준비 알림톡을 보낸다 (정기 발주 요일 아침).
 */
function prepareSheet(ctx, storeId, now = Date.now(), { notify = false } = {}) {
  const { db } = ctx;
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    const last = lastOrder(db, storeId);
    if (!last) throw new Error('지난 발주 내역이 없어 발주서를 만들 수 없습니다');
    let filled = 0;
    // 지난 확정 이후에 손댄 장바구니가 있으면(작성 중) 그대로 두고, 그 전에 남은 것뿐이면 지난 발주 수량으로 새로 채운다
    const touched = db.get('SELECT MAX(updated_at) AS t FROM carts WHERE store_id = ?', [storeId]).t;
    if (touched != null && touched < last.created_at) db.run('DELETE FROM carts WHERE store_id = ?', [storeId]);
    if (!db.get('SELECT 1 FROM carts WHERE store_id = ?', [storeId])) {
      const ok = orderableMap(db, storeId);
      for (const l of db.all('SELECT sku_id, qty FROM proposal_lines WHERE proposal_id = ? AND qty > 0', [last.id])) {
        if (!ok.has(l.sku_id)) continue;
        db.run('INSERT INTO carts (store_id, sku_id, qty, updated_at) VALUES (?, ?, ?, ?)', [storeId, l.sku_id, Math.min(MAX_QTY, l.qty), now]);
        filled++;
      }
    }
    db.run('UPDATE stores SET sheet_at = ?, sheet_base = ?, sheet_seen_at = NULL WHERE id = ?', [now, last.id, storeId]);
    const c = cart(db, storeId);
    if (notify) {
      const link = orderLink(ctx, storeId, now);
      const d = deliveryPreview(ctx.R, now);
      msg.enqueueNotice(ctx, storeId, 'sheet_ready', {
        text: `[BevFlow 정기 발주서]\n${store.owner_name ? store.owner_name + ' 사장님' : '사장님'}, 신청하신 ${daysText(store.standing_days)} 정기 발주서가 준비됐어요.\n지난번(${T.dateStr(last.created_at).slice(5).replace('-', '/')}) 발주 기준 ${c.count}품목 · ${won(c.amount)}\n${ctx.R.cutoff}까지 확정하시면 ${d.word} 오후에 도착해요.\n▶ ${link}`,
        vars: { who: store.owner_name ? store.owner_name + ' 사장님' : '사장님', days: daysText(store.standing_days), base_date: T.dateStr(last.created_at).slice(5).replace('-', '/'), count: c.count, amount: won(c.amount), cutoff: ctx.R.cutoff, arrive: d.word }, link, button: '발주서 확인하기',
      }, now);
    }
    logEvent(db, { t: now, kind: '발주서', store_id: storeId, region_id: store.region_id, actor: notify ? 'system' : 'owner', message: `${store.name} · 발주서 준비 (${last.code} 기준 ${c.count}품목${filled ? '' : ', 기존 장바구니 유지'})` });
    return { base: last.code, count: c.count, amount: c.amount };
  });
}

/** 점주가 오늘 발주서를 열어 봤다고 기록 (관리자 미확정 알림에 "열어 봄" 표시) */
function markSheetSeen(ctx, store, now = Date.now()) {
  if (store.sheet_at && store.sheet_at >= T.kstMidnight(now) && !store.sheet_seen_at) ctx.db.run('UPDATE stores SET sheet_seen_at = ? WHERE id = ?', [now, store.id]);
}

/** 발주서 비교 기준: 준비할 때 기록한 지난 발주, 없으면 가장 최근 발주 */
function sheetBase(db, store) {
  const p = (store.sheet_base && db.get('SELECT id, code, created_at FROM proposals WHERE id = ?', [store.sheet_base])) || lastOrder(db, store.id);
  if (!p) return null;
  const base = Object.fromEntries(db.all('SELECT sku_id, qty FROM proposal_lines WHERE proposal_id = ? AND qty > 0', [p.id]).map((l) => [l.sku_id, l.qty]));
  return { code: p.code, date: T.dateStr(p.created_at), base };
}

// ── 발주 접수 ──────────────────────────────────────────────
/**
 * 점주 발주. items = { skuId: 수량 }. ref: 중복 접수 방지 키(같은 ref는 한 번만 접수).
 * 접수 즉시 승인·결제까지 진행하고 확정 알림톡을 보낸다.
 */
async function submit(ctx, storeId, { items, source = 'web', ref = null }, now = Date.now()) {
  const { db, R } = ctx;
  if (!['web', 'chat'].includes(source)) throw new Error('알 수 없는 접수 경로');
  const cleanRef = ref == null ? null : String(ref).slice(0, 64);
  if (cleanRef) {
    const dup = db.get('SELECT * FROM proposals WHERE store_id = ? AND client_ref = ?', [storeId, cleanRef]);
    if (dup) return { proposal: dup, duplicate: true };
  }
  const pid = db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [storeId]);
    if (!store) throw new Error('매장을 찾을 수 없습니다');
    const ok = orderableMap(db, storeId);
    const lines = [];
    for (const [sku, raw] of Object.entries(items || {})) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) throw new Error(`수량은 0~${MAX_QTY} 사이 정수입니다`);
      if (n === 0) continue;
      const k = ok.get(sku);
      if (!k) throw new Error('발주할 수 없는 품목이 있습니다. 화면을 새로고침해 주세요');
      lines.push({ ...k, qty: n });
    }
    if (!lines.length) throw new Error('발주할 품목을 골라 주세요');
    const amount = lines.reduce((a, l) => a + l.qty * l.price, 0);
    if (amount < R.order_min_amount) throw new Error(`최소 발주 금액은 ${won(R.order_min_amount)}입니다 (현재 ${won(amount)})`);
    lines.sort((a, b) => b.qty * b.price - a.qty * a.price);
    const r = db.run(`INSERT INTO proposals (code, store_id, status, created_at, trigger_sku, send_rule, amount, token_nonce, created_by, source, client_ref)
                      VALUES (?, ?, 'created', ?, ?, 'owner', ?, ?, ?, ?, ?)`,
    [props.nextCode(db, now), storeId, now, lines[0].id, amount, tokens.nonce(), 'owner:' + source, source, cleanRef]);
    const id = Number(r.lastInsertRowid);
    for (const l of lines) {
      db.run('INSERT INTO proposal_lines (proposal_id, sku_id, qty, qty_orig, est, band, safety, trig, price) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)', [id, l.id, l.qty, l.qty, l.price]);
      db.run('DELETE FROM carts WHERE store_id = ? AND sku_id = ?', [storeId, l.id]);
    }
    const cats = [...new Set(lines.map((l) => catalog.CATEGORIES[l.category].short))].join('·');
    logEvent(db, { t: now, kind: '점주 발주', store_id: storeId, proposal_id: id, region_id: store.region_id, actor: 'owner:' + source,
      message: `${store.name} · ${source === 'chat' ? '카카오톡' : '발주 화면'} · ${cats} ${lines.length}품목 ${won(amount)}` });
    return id;
  });
  try {
    return { proposal: await orders.approve(ctx, pid, { actor: 'owner:' + source }, now), duplicate: false };
  } catch (e) {
    orders.cancel(ctx, pid, 'system', now); // 접수만 되고 승인되지 않은 건이 남지 않게
    throw e;
  }
}

// ── 조회 ───────────────────────────────────────────────────
function statusText(p, now) {
  switch (p.status) {
    case 'created': case 'sent': return p.source === 'auto' ? '승인 대기' : '접수 중';
    case 'payfail': return '결제 확인 필요';
    case 'paid': return deliverWord(p.deliver_date, now) + ' 배송 예정';
    case 'dispatched': return '배송 중';
    case 'delivered': return '배송 완료';
    case 'held': return '보류';
    case 'expired': return '만료';
    case 'cancelled': return '취소';
    default: return p.status;
  }
}
function deliverWord(date, now) {
  if (!date) return '';
  const d = Math.round((T.parseDate(date) - T.kstMidnight(now)) / T.DAY);
  return d === 0 ? '오늘' : d === 1 ? '내일' : date.slice(5).replace('-', '/');
}

function recentOrders(db, storeId, now, limit = 5) {
  return db.all(`SELECT * FROM proposals WHERE store_id = ? AND (source != 'auto' OR response = 'approve' OR status IN ('created','sent'))
                 ORDER BY id DESC LIMIT ?`, [storeId, limit]).map((p) => {
    const lines = db.all('SELECT l.sku_id AS sku, l.qty, l.price, k.name, k.pack, k.unit FROM proposal_lines l JOIN skus k ON k.id = l.sku_id WHERE l.proposal_id = ? AND l.qty > 0 ORDER BY l.qty * l.price DESC', [p.id]);
    const stop = db.get('SELECT eta FROM stops WHERE proposal_id = ? ORDER BY id DESC LIMIT 1', [p.id]);
    return { id: p.id, code: p.code, status: p.status, statusText: statusText(p, now), source: p.source, createdAt: p.created_at, amount: p.amount,
      deliverDate: p.deliver_date, eta: stop ? stop.eta : null, deliveredAt: p.delivered_at, lines: lines.map((l) => ({ sku: l.sku, qty: l.qty, price: l.price, name: l.name, u: unitOf(l) })) };
  });
}

/** 지금 발주하면 언제 오는지 */
function deliveryPreview(R, now) {
  const date = orders.deliverDate(now, R);
  return { date, word: deliverWord(date, now), sameDay: date === T.dateStr(now), cutoff: R.cutoff };
}

/** 모바일 발주 화면 전체 데이터 */
function view(ctx, store, now = Date.now()) {
  const { db, R } = ctx;
  const hist = history(db, store.id, now);
  const products = orderable(db, store.id).map((k) => {
    const h = hist.get(k.id);
    return { id: k.id, name: k.name, spec: k.spec, pack: k.pack, unit: k.unit, u: unitOf(k), price: k.price, category: k.category, grp: k.grp, freq: h ? h.n : 0, lastQty: h ? h.lastQty : 0 };
  });
  const pending = db.get("SELECT code FROM proposals WHERE store_id = ? AND source = 'auto' AND status IN ('created','sent') AND responded_at IS NULL AND send_at IS NOT NULL ORDER BY id DESC LIMIT 1", [store.id]);
  const sheet = sheetMode(store) ? sheetBase(db, store) : null;
  return {
    store: { name: store.name, owner: store.owner_name, biz: store.biz, bizLabel: catalog.BIZ[store.biz].label },
    mode: sheet ? 'sheet' : 'pick',
    sheet: sheet ? { ...sheet, preparedAt: store.sheet_at, standing: daysText(store.standing_days) } : null,
    categories: catalog.storeCategories(db, store),
    products,
    cart: cart(db, store.id),
    orders: recentOrders(db, store.id, now),
    delivery: deliveryPreview(R, now),
    minAmount: R.order_min_amount,
    payMethod: R.pay_method,
    channelChatUrl: R.kakao_channel_id ? `https://pf.kakao.com/${R.kakao_channel_id}/chat` : null,
    pendingProposal: pending ? pending.code : null,
    hasLastOrder: !!db.get("SELECT 1 FROM proposals WHERE store_id = ? AND status IN ('paid','dispatched','delivered')", [store.id]),
  };
}

module.exports = { MAX_QTY, unitOf, markSheetSeen, sheetMode, daysText, prepareSheet, sheetBase, lastOrder, orderLink, storeFromToken, revokeLinks, orderable, cart, setCart, addCart, clearCart, reorderToCart, submit, recentOrders, statusText, deliveryPreview, view, won };
},

// ── server/engine/standing.js ─────────────────────────────────────────────
"server/engine/standing.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 정기 발주와 하루 일정 알림 (스케줄러가 1분마다 호출)
// - 정기 발주 요일 아침(sheet_time): 지난 발주 수량으로 발주서를 채우고 점주에게 알림톡, 관리자에게 발송 현황
// - 마감 전(alert_unconfirmed): 발주서를 받고도 확정하지 않은 매장 → 관리자
// - 출고 전(alert_pick): 오늘 출고 품목 합계 → 관리자
// - 저녁(alert_delivery): 오늘 배송 결과 → 관리자

const T = require('../time');
const shop = require('./shop');
const adminNotify = require('../adminNotify');
const today = require('../api/today');

const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';

/** 하루에 한 번만: 처음 표시하면 true */
function once(db, day, kind, now) {
  return db.run('INSERT OR IGNORE INTO daily_marks (day, kind, t) VALUES (?, ?, ?)', [day, kind, now]).changes === 1;
}

function tick(ctx, now) {
  const { db, R } = ctx;
  const h = T.kstHour(now), day = T.dateStr(now), mid = T.kstMidnight(now), dow = String(T.kstDow(now));
  const out = { sheets: 0 };

  // 1) 정기 발주서
  if (h >= R.sheetH && h < R.cutoffH) {
    const due = db.all("SELECT * FROM stores WHERE active = 1 AND standing_days != '' AND (sheet_at IS NULL OR sheet_at < ?)", [mid])
      .filter((s) => s.standing_days.split(',').includes(dow));
    const made = [];
    for (const s of due) {
      try { made.push({ store: s, ...shop.prepareSheet(ctx, s.id, now, { notify: true }) }); } catch { db.run('UPDATE stores SET sheet_at = ? WHERE id = ?', [now, s.id]); } // 지난 발주가 없으면 오늘은 건너뜀
    }
    out.sheets = made.length;
    if (made.length) {
      const items = (made.length > 5 ? made.slice(0, 4) : made).map((m) => [m.store.name, `${m.count}품목`]);
      if (made.length > 5) items.push([`외 ${made.length - 4}곳`, `${made.slice(4).reduce((a, m) => a + m.count, 0)}품목`]);
      adminNotify.notify(ctx, 'sheets', `${day}:${now}`, adminNotify.feed(ctx, {
        profile: 'BevFlow 정기 발주서', title: `📋 정기 발주서 ${made.length}곳 발송`, desc: `${R.cutoff} 마감 · ${R.alert_unconfirmed}에 미확정 매장을 알려 드려요`,
        items, sum: ['예상 합계', won(made.reduce((a, m) => a + m.amount, 0))], buttons: [['발주서 현황', '/a#sum']],
      }), now);
    }
  }

  // 2) 미확정 발주서 (마감 전)
  if (h >= R.unconfirmedH && h < R.cutoffH && db.get('SELECT 1 FROM stores WHERE sheet_at >= ?', [mid]) && once(db, day, 'unconfirmed', now)) {
    const w = today.build(ctx, { role: 'admin' }, now, now).waiting;
    if (w.length) {
      const items = (w.length > 5 ? w.slice(0, 4) : w).map((x) => [x.store, x.phone || (x.seenAt ? '열어 봄' : '안 열어 봄')]);
      if (w.length > 5) items.push([`외 ${w.length - 4}곳`, '']);
      adminNotify.notify(ctx, 'unconfirmed', day, adminNotify.feed(ctx, {
        profile: 'BevFlow 마감 전 확인', title: `⏰ 미확정 발주서 ${w.length}곳`, desc: `${R.cutoff}이 지나면 다음 배송일로 넘어가요`, items, buttons: [['미확정 목록', '/a#sum']],
      }), now);
    }
  }

  // 3) 오늘 출고 합계
  if (h >= R.pickH && R.days.has(T.kstDow(now)) && once(db, day, 'pick', now)) {
    const t = today.build(ctx, { role: 'admin' }, now, now);
    if (t.pick.length) {
      const items = t.pick.slice(0, 4).map((p) => [p.name, `${p.qty}${p.u}`]);
      if (t.pick.length > 4) items.push([`외 ${t.pick.length - 4}품목`, `${t.pick.slice(4).reduce((a, p) => a + p.qty, 0)}개`]);
      adminNotify.notify(ctx, 'pick', day, adminNotify.feed(ctx, {
        profile: 'BevFlow 출고 준비', title: `🚚 오늘 ${R.dispatch} 출고 합계`, desc: `${t.summary.outStores}곳 · ${t.pick.length}품목`,
        items, sum: [`${t.summary.outQty}개`, won(t.summary.outAmount)], buttons: [['출고 집계 전체', '/a#pick'], ['발주 내역', '/a#list']],
      }), now);
    }
  }

  // 4) 배송 결과
  if (h >= R.deliveryAlertH && once(db, day, 'delivery', now)) {
    const s = today.build(ctx, { role: 'admin' }, now, now).summary;
    if (s.delivered || s.failed.length) {
      adminNotify.notify(ctx, 'delivery', day, adminNotify.feed(ctx, {
        profile: 'BevFlow 배송 결과', title: `📦 배송 ${s.delivered}곳 완료${s.failed.length ? ` · ${s.failed.length}곳 실패` : ''}`,
        desc: s.failed.length ? '실패한 매장은 다음 배송일로 다시 배차됐어요' : '오늘 배송을 모두 마쳤어요',
        items: s.failed.slice(0, 5).map((f) => [f.store, f.reason || '사유 없음']), buttons: [['오늘 요약', '/a#sum']],
      }), now);
    }
  }
  return out;
}

module.exports = { tick, once };
},

// ── server/http.js ────────────────────────────────────────────────────────
"server/http.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 최소 HTTP 프레임워크: 라우팅 · JSON/텍스트 본문 · 쿠키 · 정적 파일 · 보안 헤더

const fs = require('node:fs');
const path = require('node:path');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', // 링크 토큰이 외부로 새지 않게
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, opts });
  };
  const match = (method, pathname) => {
    let allowed = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      if (r.method !== method) { allowed = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return allowed ? { notAllowed: true } : null;
  };
  return {
    get: (p, h, o) => add('GET', p, h, o), post: (p, h, o) => add('POST', p, h, o),
    put: (p, h, o) => add('PUT', p, h, o), del: (p, h, o) => add('DELETE', p, h, o), match,
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '요청 본문이 너무 큽니다')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 1 << 20) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'JSON 형식이 올바르지 않습니다'); }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

// 단일 파일 빌드(dist/bevflow.js)는 public/ 파일을 이 맵에 넣어 둡니다
function embeddedAsset(rel) {
  const map = globalThis.__BEVFLOW_ASSETS__;
  return map && Object.prototype.hasOwnProperty.call(map, rel) ? map[rel] : null;
}

function serveFile(res, root, rel, extraHeaders = {}) {
  const type = MIME[path.extname(rel).toLowerCase()] || 'application/octet-stream';
  const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': type.startsWith('text/html') ? 'no-store' : 'public, max-age=300', ...extraHeaders };
  const embedded = embeddedAsset(rel);
  if (embedded != null) {
    res.writeHead(200, headers);
    res.end(embedded);
    return true;
  }
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(path.resolve(root) + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
  return true;
}

module.exports = { HttpError, createRouter, readBody, readJson, parseCookies, send, serveFile, SECURITY_HEADERS };
},

// ── server/index.js ───────────────────────────────────────────────────────
"server/index.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// BevFlow 운영 서버 진입점
//   node --disable-warning=ExperimentalWarning server/index.js
// 환경 변수: PORT, HOST, BEVFLOW_DB, BEVFLOW_TRUST_PROXY, BEVFLOW_ADMIN_EMAIL, BEVFLOW_ADMIN_PASSWORD,
//            BEVFLOW_LINK_SECRET, BEVFLOW_INGEST_SECRET, BEVFLOW_WEBHOOK_SECRET

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createContext } = require('./context');
const { createServer } = require('./app');
const auth = require('./auth');
const jobs = require('./jobs');

const env = process.env;
const file = env.BEVFLOW_DB || path.join(__dirname, '..', 'data', 'bevflow.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

const ctx = createContext({ file, env });

// 첫 실행: 관리자 계정 생성
if (!ctx.db.get('SELECT 1 FROM users LIMIT 1')) {
  const email = env.BEVFLOW_ADMIN_EMAIL || 'admin@bevflow.local';
  const password = env.BEVFLOW_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  auth.createUser(ctx.db, { email, name: '관리자', role: 'admin', password, mustChange: !env.BEVFLOW_ADMIN_PASSWORD });
  console.log('────────────────────────────────────────────');
  console.log(' 관리자 계정이 생성되었습니다');
  console.log('   이메일  :', email);
  if (!env.BEVFLOW_ADMIN_PASSWORD) console.log('   임시 비밀번호:', password, ' (첫 로그인 시 변경)');
  console.log('────────────────────────────────────────────');
}

const port = Number(env.PORT || 8080);
const host = env.HOST || undefined; // 프록시 뒤에서는 127.0.0.1 권장
const server = createServer(ctx, { trustProxy: env.BEVFLOW_TRUST_PROXY === '1' });
server.listen(port, host, () => {
  console.log(`BevFlow 운영 서버 실행 중 → http://${host || 'localhost'}:${port}  (DB: ${file})`);
  console.log(`외부 접속 주소 설정값: ${ctx.R.public_base_url} — 사장님·기사 링크가 이 주소로 만들어집니다`);
});
const stopJobs = jobs.start(ctx);

const shutdown = () => {
  console.log('종료 중…');
  stopJobs();
  server.close(() => { ctx.db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
},

// ── server/jobs.js ────────────────────────────────────────────────────────
"server/jobs.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 스케줄러 — 1분마다 운영 규칙을 돌린다. now를 주입받아 테스트·샘플 데이터 생성에서도 같은 코드를 쓴다.

const T = require('./time');
const inv = require('./engine/inventory');
const props = require('./engine/proposals');
const delivery = require('./engine/delivery');
const msg = require('./engine/messages');
const standing = require('./engine/standing');
const adminNotify = require('./adminNotify');

async function tick(ctx, now, { flush = true } = {}) {
  const { db, R } = ctx;
  const st = ctx.jobState || (ctx.jobState = { snapHour: 0, rateHour: 0, dispatchDay: 0 });
  db.tx(() => {
    const hourTs = Math.floor(now / T.HOUR) * T.HOUR;
    if (st.rateHour !== hourTs) { inv.refreshRates(ctx, now); st.rateHour = hourTs; }
    props.evaluateTriggers(ctx, now);
    props.sendDue(ctx, now);
    props.sweepPending(ctx, now);
    // 출고·배차: 배송 요일의 배차 시각 이후 (늦게 결제된 오늘 배송분도 이어서 추가)
    const mid = T.kstMidnight(now);
    if (R.days.has(T.kstDow(now)) && T.kstHour(now) >= R.dispatchH) {
      const pending = db.get(`SELECT COUNT(*) AS c FROM proposals WHERE status = 'paid' AND deliver_date <= ?`, [T.dateStr(now)]).c;
      if (pending) delivery.dispatch(ctx, mid, now);
      st.dispatchDay = mid;
    }
    if (st.snapHour !== hourTs) { inv.snapshot(ctx, now); st.snapHour = hourTs; }
    standing.tick(ctx, now);
  });
  if (flush) {
    await msg.flushOutbox(ctx, now);
    await adminNotify.flush(ctx, now);
  }
}

/** 오래된 세션·스냅샷 정리 (하루 1회 정도) */
function housekeeping(ctx, now) {
  const { db } = ctx;
  db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  db.run('DELETE FROM inv_snapshots WHERE t < ?', [now - 90 * T.DAY]);
  db.run("DELETE FROM admin_notices WHERE created_at < ? AND status != 'queued'", [now - 30 * T.DAY]);
  db.run('DELETE FROM daily_marks WHERE t < ?', [now - 30 * T.DAY]);
}

function start(ctx, { intervalMs = 60e3, log = console } = {}) {
  let running = false;
  let lastHk = 0;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      await tick(ctx, now);
      if (now - lastHk > 6 * T.HOUR) { housekeeping(ctx, now); lastHk = now; }
    } catch (e) {
      log.error('[스케줄러] 오류:', e);
    } finally {
      running = false;
    }
  };
  run();
  const h = setInterval(run, intervalMs);
  return () => clearInterval(h);
}

module.exports = { tick, start, housekeeping };
},

// ── server/kakao.js ───────────────────────────────────────────────────────
"server/kakao.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 카카오 연동
// 1) 카카오톡 채널 챗봇 (카카오 i 오픈빌더 스킬 서버) — 점주가 글자를 치지 않고 버튼만 눌러 발주
//    POST /api/kakao/skill?key=<스킬 키>  · 응답 형식: 오픈빌더 SkillResponse v2.0
// 2) 카카오 로그인 (Kakao Developers REST API) — 발주 화면 로그인 · 휴대폰 번호로 매장 자동 연결
//    GET /k/login → kauth.kakao.com 인가 → GET /k/callback
// 3) 매장 연결 — 운영자가 발급한 6자리 연결 코드로 카카오 계정(챗봇 사용자·로그인 사용자)을 매장에 묶는다.

const crypto = require('node:crypto');
const T = require('./time');
const tokens = require('./tokens');
const catalog = require('./engine/catalog');
const shop = require('./engine/shop');
const { logEvent } = require('./engine/events');

const won = shop.won;
const PAGE = 9; // 캐러셀 최대 10장 = 품목 9장 + [다음 품목]

// ── 매장 연결 ──────────────────────────────────────────────
const attempts = new Map(); // 연결 코드 대입 방지: key → [시각…]
function limited(key, now, max = 5, windowMs = 10 * 60e3) {
  const arr = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  attempts.set(key, arr);
  if (attempts.size > 5000) for (const k of attempts.keys()) { attempts.delete(k); if (attempts.size < 2500) break; }
  if (arr.length >= max) return true;
  arr.push(now);
  return false;
}

/** 새 연결 코드 (6자리 숫자, 한 번 쓰면 사라짐) */
function issueLinkCode(ctx, storeId) {
  const { db } = ctx;
  for (let i = 0; i < 20; i++) {
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    if (db.get('SELECT 1 FROM stores WHERE link_code = ?', [code])) continue;
    db.run('UPDATE stores SET link_code = ? WHERE id = ?', [code, storeId]);
    return code;
  }
  throw new Error('연결 코드를 만들지 못했습니다. 다시 시도해 주세요');
}

function linkedStore(db, kind, userKey, now) {
  const l = db.get('SELECT * FROM kakao_links WHERE kind = ? AND user_key = ?', [kind, userKey]);
  if (!l) return null;
  const s = db.get('SELECT * FROM stores WHERE id = ? AND active = 1', [l.store_id]);
  if (s && now) db.run('UPDATE kakao_links SET last_seen_at = ? WHERE id = ?', [now, l.id]);
  return s || null;
}

function saveLink(db, storeId, kind, userKey, nickname, now) {
  db.run(`INSERT INTO kakao_links (store_id, kind, user_key, nickname, linked_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (kind, user_key) DO UPDATE SET store_id = excluded.store_id, nickname = excluded.nickname, linked_at = excluded.linked_at`,
  [storeId, kind, String(userKey).slice(0, 128), String(nickname || '').slice(0, 40), now, now]);
}

/**
 * 연결 코드로 매장 연결. who = [{ kind, key, nickname }] (챗봇 사용자·로그인 사용자를 한 번에 묶을 수 있음)
 */
function linkByCode(ctx, code, who, rateKey, now = Date.now()) {
  const { db } = ctx;
  if (limited('code:' + rateKey, now)) throw new Error('시도 횟수가 많습니다. 10분 뒤 다시 시도해 주세요');
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) throw new Error('연결 코드 6자리를 입력해 주세요');
  return db.tx(() => {
    const store = db.get('SELECT * FROM stores WHERE link_code = ? AND active = 1', [c]);
    if (!store) throw new Error('연결 코드가 올바르지 않습니다. BevFlow 운영팀에 확인해 주세요');
    for (const w of who) saveLink(db, store.id, w.kind, w.key, w.nickname, now);
    db.run('UPDATE stores SET link_code = NULL WHERE id = ?', [store.id]);
    logEvent(db, { t: now, kind: '카카오 연결', store_id: store.id, region_id: store.region_id, actor: 'owner', message: `${store.name} · 카카오 계정 연결 (${who.map((w) => (w.kind === 'chatbot' ? '채널 챗봇' : '카카오 로그인')).join('·')})` });
    return store;
  });
}

const normPhone = (p) => {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('82')) d = '0' + d.slice(2);
  return d;
};

/** 카카오 계정 휴대폰 번호와 사장님 연락처가 정확히 한 매장과 일치하면 그 매장 */
function storeByPhone(db, phone) {
  const want = normPhone(phone);
  if (want.length < 10) return null;
  const hit = db.all('SELECT * FROM stores WHERE active = 1 AND owner_phone != \'\'').filter((s) => normPhone(s.owner_phone) === want);
  return hit.length === 1 ? hit[0] : null;
}

// ── 오픈빌더 응답 조립 ─────────────────────────────────────────
function ui(ctx) {
  const blockId = ctx.R.kakao_block_id;
  const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
  // 블록 버튼: 같은 스킬 블록으로 되돌아오며 extra로 다음 단계를 전달한다. 블록 ID가 없으면 말풍선 문구로 대신한다.
  const btn = (label, extra, text) => (blockId
    ? { label: cut(label, 14), action: 'block', blockId, extra, messageText: text || label }
    : { label: cut(label, 14), action: 'message', messageText: text || label });
  const link = (label, url) => ({ label: cut(label, 14), action: 'webLink', webLinkUrl: url });
  const qr = (label, extra, text) => btn(label, extra, text);
  const res = (outputs, quickReplies = []) => ({ version: '2.0', template: { outputs, quickReplies: quickReplies.slice(0, 10) } });
  const text = (t) => ({ simpleText: { text: cut(t, 1000) } });
  const card = (title, description, buttons = []) => ({ textCard: { title: cut(title, 50), description: cut(description, 400), buttons: buttons.slice(0, 3) } });
  const carousel = (cards) => ({ carousel: { type: 'textCard', items: cards.slice(0, 10).map((c) => c.textCard) } });
  const list = (header, items, buttons = []) => ({ listCard: { header: { title: cut(header, 40) }, items: items.slice(0, 5), buttons: buttons.slice(0, 2) } });
  return { btn, link, qr, res, text, card, carousel, list, chat: !!blockId };
}

// ── 스킬 처리 ──────────────────────────────────────────────
const UTTER = [
  [/장바구니|카트/, { s: 'cart' }],
  [/현황|내역|배송|언제/, { s: 'status' }],
  [/지난|똑같이|재주문|다시/, { s: 'reorder' }],
  [/신청|추가 품목|다른 품목/, { s: 'request' }],
  [/확정|주문하기|발주하기/, { s: 'confirm' }],
  [/카페|커피|원두/, { s: 'items', c: 'cafe' }],
  [/스낵|과자|간식/, { s: 'items', c: 'snack' }],
  [/음료|콜라|사이다/, { s: 'items', c: 'beverage' }],
];

function cartHash(c) {
  return crypto.createHash('sha256').update(c.lines.map((l) => l.sku + ':' + l.qty).join(',')).digest('base64url').slice(0, 10);
}

/**
 * 오픈빌더 스킬 요청 처리 → SkillResponse
 * @param body 오픈빌더가 보낸 JSON
 */
async function skill(ctx, body, now = Date.now()) {
  const { db, R } = ctx;
  const U = ui(ctx);
  const user = (body && body.userRequest && body.userRequest.user) || {};
  const userKey = String(user.id || '');
  if (!userKey) return U.res([U.text('사용자 정보를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')]);
  const utter = String((body.userRequest && body.userRequest.utterance) || '').trim();
  const rawExtra = (body.action && body.action.clientExtra) || {};
  let x = rawExtra && typeof rawExtra.s === 'string' ? rawExtra : null;

  let store = linkedStore(db, 'chatbot', userKey, now);
  // 채널이 카카오 앱과 연결돼 있으면 appUserId가 온다 → 카카오 로그인으로 연결된 매장을 그대로 쓴다
  const appUserId = user.properties && user.properties.appUserId ? String(user.properties.appUserId) : '';
  if (!store && appUserId) {
    const viaLogin = linkedStore(db, 'login', appUserId, now);
    if (viaLogin) { saveLink(db, viaLogin.id, 'chatbot', userKey, '', now); store = viaLogin; }
  }
  if (!store) {
    // 채팅창에 연결 코드 6자리만 보내도 연결된다
    if (/^\d{6}$/.test(utter.replace(/\s/g, ''))) {
      try {
        store = linkByCode(ctx, utter, [{ kind: 'chatbot', key: userKey }], 'bot:' + userKey, now);
        return home(ctx, U, store, now, `✅ ${store.name} 매장과 연결됐어요. 이제 버튼만 눌러 발주하세요.`);
      } catch (e) { return U.res([U.text(e.message)]); }
    }
    const t = tokens.sign(ctx.secret, { k: 'kl', id: 0, u: userKey, e: now + 30 * 60e3 });
    return U.res([U.card('매장 연결이 필요해요', '처음 한 번만 매장을 연결하면 그다음부터는 버튼만 눌러 발주할 수 있어요.\n\n운영팀이 알려 드린 연결 코드 6자리를 이 채팅방에 보내거나, 아래 버튼을 눌러 주세요.',
      [U.link('매장 연결하기', `${R.public_base_url}/k/link?t=${encodeURIComponent(t)}`)])]);
  }

  if (!x) x = (UTTER.find(([re]) => re.test(utter)) || [null, { s: 'home' }])[1];
  try {
    return await step(ctx, U, store, x, userKey, now);
  } catch (e) {
    return U.res([U.text('⚠️ ' + e.message)], [U.qr('🛒 장바구니', { s: 'cart' }), U.qr('처음으로', { s: 'home' })]);
  }
}

function catLabel(c) { const k = catalog.CATEGORIES[c]; return k ? `${k.icon} ${k.short}` : c; }

/** 매대·소분류 목록 (발주 가능한 품목 기준, 정렬 순서대로) */
function groupsOf(ctx, store) {
  const seen = new Map();
  for (const k of shop.orderable(ctx.db, store.id)) if (k.grp && !seen.has(k.grp)) seen.set(k.grp, k.category);
  return [...seen.entries()].map(([g, c]) => ({ g, c }));
}

/** 발주서 방식 매장(사우나)의 첫 화면: 버튼 세 개만 */
function sheetHome(ctx, U, store, now, notice) {
  const { db, R } = ctx;
  const c = shop.cart(db, store.id);
  const base = shop.sheetBase(db, store);
  const d = shop.deliveryPreview(R, now);
  const today = store.sheet_at && store.sheet_at >= T.kstMidnight(now);
  const desc = (c.count ? `${base ? `지난번(${base.date.slice(5).replace('-', '/')}) 기준 ` : ''}${c.count}품목 · ${won(c.amount)}` : '아직 채워진 발주서가 없어요')
    + `\n${R.cutoff}까지 확정하면 ${d.word} 오후 도착`;
  const buttons = [U.link('📋 발주서 확인하기', shop.orderLink(ctx, store.id, now))];
  if (U.chat) buttons.push(U.btn('✅ 지난번 그대로 확정', { s: 'same' }, '지난번 그대로 확정'), U.btn('➕ 이것만 추가', { s: 'groups' }, '이것만 추가'));
  const out = notice ? [U.text(notice)] : [];
  out.push(U.card(today ? '📋 오늘 정기 발주서' : `📋 ${store.name} 발주서`, desc, buttons));
  return U.res(out, [U.qr('📦 발주 현황', { s: 'status' }, '발주 현황'), U.qr('➕ 품목 추가 신청', { s: 'request' }, '품목 추가 신청')]);
}

function home(ctx, U, store, now, notice) {
  const { db } = ctx;
  if (shop.sheetMode(store) && shop.lastOrder(db, store.id)) return sheetHome(ctx, U, store, now, notice);
  const cats = catalog.storeCategories(db, store).filter((c) => c.status === 'approved');
  const c = shop.cart(db, store.id);
  const d = shop.deliveryPreview(ctx.R, now);
  const desc = `이용 품목 ${cats.map((k) => k.icon + k.short).join(' · ')}\n지금 발주하면 ${d.word} 도착 (당일배송 ${d.cutoff} 마감)`
    + (c.count ? `\n\n🛒 장바구니 ${c.count}품목 · ${won(c.amount)}` : '');
  const buttons = [U.link('📋 한눈에 발주하기', shop.orderLink(ctx, store.id, now))];
  if (U.chat) buttons.push(U.btn('💬 채팅으로 고르기', { s: 'cats' }), U.btn('🔁 지난번과 똑같이', { s: 'reorder' }));
  const out = [];
  if (notice) out.push(U.text(notice));
  out.push(U.card(`${store.name} 발주`, desc, buttons));
  return U.res(out, [
    ...(c.count ? [U.qr(`🛒 장바구니 ${c.count}`, { s: 'cart' }, '장바구니')] : []),
    ...cats.map((k) => U.qr(`${k.icon} ${k.short}`, { s: 'items', c: k.id }, k.short + ' 품목')),
    U.qr('📦 발주 현황', { s: 'status' }, '발주 현황'),
    U.qr('➕ 품목 추가 신청', { s: 'request' }, '품목 추가 신청'),
  ]);
}

function cartOut(ctx, U, store, now, notice) {
  const c = shop.cart(ctx.db, store.id);
  const out = notice ? [U.text(notice)] : [];
  if (!c.count) {
    out.push(U.text('🛒 장바구니가 비어 있어요.'));
    return U.res(out, [U.qr('💬 품목 고르기', { s: 'cats' }), U.qr('🔁 지난번과 똑같이', { s: 'reorder' }), U.qr('처음으로', { s: 'home' })]);
  }
  const shown = c.lines.length > 5 ? c.lines.slice(0, 4) : c.lines;
  const items = shown.map((l) => ({ title: l.name, description: `${l.qty}${l.u} · ${won(l.qty * l.price)}`, ...(U.chat ? { action: 'block', blockId: ctx.R.kakao_block_id, extra: { s: 'item', k: l.sku }, messageText: l.name + ' 수량 변경' } : {}) }));
  if (c.lines.length > 5) items.push({ title: `외 ${c.lines.length - 4}품목`, description: '전체 보기는 발주 화면에서', action: 'webLink', webLinkUrl: shop.orderLink(ctx, store.id, now) });
  out.push(U.list(`🛒 장바구니 · ${c.count}품목 · ${won(c.amount)}`, items, [U.btn('✅ 발주하기', { s: 'confirm' }, '발주하기'), U.link('✏️ 화면에서 수정', shop.orderLink(ctx, store.id, now))]));
  return U.res(out, [U.qr('계속 고르기', { s: 'cats' }), U.qr('🗑 비우기', { s: 'clear' }, '장바구니 비우기'), U.qr('처음으로', { s: 'home' })]);
}

async function step(ctx, U, store, x, userKey, now) {
  const { db, R } = ctx;
  const approved = catalog.storeCategories(db, store).filter((c) => c.status === 'approved');
  switch (x.s) {
    case 'home': return home(ctx, U, store, now);
    case 'cats': {
      if (approved.length === 1) return step(ctx, U, store, { s: 'items', c: approved[0].id }, userKey, now);
      return U.res([U.text('어떤 품목을 발주할까요?')], approved.map((k) => U.qr(`${k.icon} ${k.short}`, { s: 'items', c: k.id }, k.short + ' 품목')));
    }
    case 'same': {
      if (!shop.cart(db, store.id).count) shop.prepareSheet(ctx, store.id, now);
      return step(ctx, U, store, { s: 'confirm' }, userKey, now);
    }
    case 'groups': {
      const gs = groupsOf(ctx, store);
      if (!gs.length) return step(ctx, U, store, { s: 'cats' }, userKey, now);
      return U.res([U.text('어느 매대 품목을 더할까요?')], gs.slice(0, 10).map(({ g, c }) => U.qr(g, { s: 'items', c, g }, g)));
    }
    case 'items': {
      const cat = String(x.c || '');
      if (!approved.some((k) => k.id === cat)) {
        return U.res([U.text(`${catLabel(cat)} 품목은 아직 이용 승인 전이에요. 신청하면 운영팀 확인 후 열어 드려요.`)], [U.qr('➕ 이용 신청', { s: 'req', c: cat }, catalog.CATEGORIES[cat] ? catalog.CATEGORIES[cat].short + ' 이용 신청' : '이용 신청'), U.qr('처음으로', { s: 'home' })]);
      }
      const view = shop.view(ctx, store, now);
      const inCart = new Map(view.cart.lines.map((l) => [l.sku, l.qty]));
      const grp = x.g ? String(x.g) : '';
      const all = view.products.filter((p) => p.category === cat && (!grp || p.grp === grp)).sort((a, b) => (b.freq - a.freq) || 0);
      const gs = groupsOf(ctx, store).filter((v) => v.c === cat);
      // 품목이 많고 매대·소분류가 있으면: 처음엔 자주 시키는 품목만, 나머지는 소분류 버튼으로
      const favOnly = !grp && gs.length > 1 && all.length > PAGE;
      const list = favOnly ? all.slice(0, PAGE) : all;
      if (!list.length) return U.res([U.text('지금 발주할 수 있는 품목이 없어요.')], [U.qr('처음으로', { s: 'home' })]);
      const page = Math.max(0, Number(x.p) || 0);
      const slice = list.slice(page * PAGE, page * PAGE + PAGE);
      const cards = slice.map((p) => {
        const q = inCart.get(p.id) || 0;
        return U.card(`${catalog.CATEGORIES[p.category].icon} ${p.name}`,
          `${p.spec || `${p.pack}${p.unit} / 박스`}\n${won(p.price)} / ${p.u}${q ? `\n🛒 담은 수량 ${q}${p.u}` : p.lastQty ? `\n지난번 ${p.lastQty}${p.u}` : ''}`,
          [U.btn('+1' + p.u, { s: 'add', k: p.id, q: 1, c: cat, g: grp || undefined }, `${p.name} 1${p.u} 담기`), U.btn('+5' + p.u, { s: 'add', k: p.id, q: 5, c: cat, g: grp || undefined }, `${p.name} 5${p.u} 담기`),
            q ? U.btn('−1' + p.u, { s: 'add', k: p.id, q: -1, c: cat, g: grp || undefined }, `${p.name} 1${p.u} 빼기`) : U.btn('+10' + p.u, { s: 'add', k: p.id, q: 10, c: cat, g: grp || undefined }, `${p.name} 10${p.u} 담기`)]);
      });
      if (favOnly) cards.push(U.card('다른 품목 찾기', `${catLabel(cat)} 품목은 모두 ${all.length}가지예요.\n아래 분류 버튼을 누르거나 발주 화면에서 한 번에 보세요.`, [U.link('📋 발주 화면에서 보기', shop.orderLink(ctx, store.id, now))]));
      else if (list.length > (page + 1) * PAGE) cards.push(U.card('다음 품목 보기', `${list.length - (page + 1) * PAGE}개 품목이 더 있어요`, [U.btn('다음 ▶', { s: 'items', c: cat, g: grp || undefined, p: page + 1 }, '다음 품목')]));
      const cartQr = U.qr(view.cart.count ? `🛒 장바구니 ${view.cart.count}` : '🛒 장바구니', { s: 'cart' }, '장바구니');
      if (gs.length > 1) {
        return U.res([U.text(grp ? `${grp} ${all.length}가지` : `⭐ 자주 시키는 ${catLabel(cat)} 품목이에요. 다른 품목은 분류 버튼으로 찾아 주세요.`), U.carousel(cards)],
          [cartQr, U.qr('✅ 발주하기', { s: 'confirm' }, '발주하기'), ...gs.filter((v) => v.g !== grp).slice(0, 8).map((v) => U.qr(v.g, { s: 'items', c: cat, g: v.g }, v.g))]);
      }
      return U.res([U.text(`${catLabel(cat)} 품목 — 버튼으로 담아 주세요`), U.carousel(cards)],
        [cartQr, U.qr('✅ 발주하기', { s: 'confirm' }, '발주하기'),
          ...approved.filter((k) => k.id !== cat).map((k) => U.qr(`${k.icon} ${k.short}`, { s: 'items', c: k.id }, k.short + ' 품목')), U.qr('처음으로', { s: 'home' })]);
    }
    case 'add': case 'set': {
      const sku = String(x.k || '');
      const c = x.s === 'set' ? shop.setCart(ctx, store.id, sku, Number(x.q) || 0, now) : shop.addCart(ctx, store.id, sku, Math.trunc(Number(x.q) || 0), now);
      const line = c.lines.find((l) => l.sku === sku);
      const name = line ? line.name : (db.get('SELECT name FROM skus WHERE id = ?', [sku]) || {}).name || sku;
      const msg = line ? `✓ ${name} ${line.qty}${line.u} 담았어요` : `✓ ${name}을(를) 뺐어요`;
      return U.res([U.text(`${msg}\n🛒 ${c.count}품목 · ${won(c.amount)}`)], [
        ...(x.c ? [U.qr('계속 고르기', { s: 'items', c: x.c, g: x.g })] : []),
        U.qr(`${name.slice(0, 6)} +1`, { s: 'add', k: sku, q: 1, c: x.c, g: x.g }, `${name} 하나 더`),
        U.qr('🛒 장바구니', { s: 'cart' }, '장바구니'), U.qr('✅ 발주하기', { s: 'confirm' }, '발주하기'),
      ]);
    }
    case 'item': {
      const c = shop.cart(db, store.id);
      const l = c.lines.find((v) => v.sku === x.k);
      if (!l) return cartOut(ctx, U, store, now);
      return U.res([U.card(l.name, `지금 ${l.qty}${l.u} · ${won(l.qty * l.price)}`, [U.btn('+1' + l.u, { s: 'add', k: l.sku, q: 1 }), U.btn('−1' + l.u, { s: 'add', k: l.sku, q: -1 }), U.btn('삭제', { s: 'set', k: l.sku, q: 0 }, l.name + ' 삭제')])],
        [U.qr('🛒 장바구니', { s: 'cart' }, '장바구니')]);
    }
    case 'cart': return cartOut(ctx, U, store, now);
    case 'clear': shop.clearCart(ctx, store.id); return cartOut(ctx, U, store, now, '장바구니를 비웠어요.');
    case 'reorder': {
      const r = shop.reorderToCart(ctx, store.id, now);
      return cartOut(ctx, U, store, now, `🔁 지난 발주(${r.from})와 같은 품목을 담았어요. 확인 후 [발주하기]를 눌러 주세요.`);
    }
    case 'confirm': {
      const c = shop.cart(db, store.id);
      if (!c.count) return cartOut(ctx, U, store, now);
      if (c.amount < R.order_min_amount) return cartOut(ctx, U, store, now, `최소 발주 금액은 ${won(R.order_min_amount)}이에요. ${won(R.order_min_amount - c.amount)}어치 더 담아 주세요.`);
      const d = shop.deliveryPreview(R, now);
      const lines = (c.lines.length > 8 ? c.lines.slice(0, 7) : c.lines).map((l) => `· ${l.name} ${l.qty}${l.u}`).join('\n') + (c.lines.length > 8 ? `\n· 외 ${c.lines.length - 7}품목` : '');
      const ref = 'chat-' + crypto.randomBytes(6).toString('base64url');
      return U.res([U.card('발주 내용을 확인해 주세요', `${lines}\n\n합계 ${won(c.amount)}${R.pay_method === 'invoice' ? ' (월말 청구)' : ''}\n${d.word} 도착 예정`,
        U.chat ? [U.btn('✅ 발주 확정', { s: 'submit', ref, h: cartHash(c) }, '발주 확정'), U.btn('✏️ 수정하기', { s: 'cart' }, '장바구니')] : [U.link('✅ 화면에서 확정', shop.orderLink(ctx, store.id, now))])]);
    }
    case 'submit': {
      const c = shop.cart(db, store.id);
      if (!c.count) {
        const done = x.ref ? db.get('SELECT * FROM proposals WHERE store_id = ? AND client_ref = ?', [store.id, String(x.ref)]) : null;
        if (done) return U.res([U.text(`이미 접수된 발주예요 (${done.code} · ${shop.statusText(done, now)}).`)], [U.qr('📦 발주 현황', { s: 'status' }, '발주 현황')]);
        return cartOut(ctx, U, store, now);
      }
      if (x.h !== cartHash(c)) return step(ctx, U, store, { s: 'confirm' }, userKey, now); // 확인 뒤 장바구니가 바뀌면 다시 확인
      const items = Object.fromEntries(c.lines.map((l) => [l.sku, l.qty]));
      const { proposal: p } = await shop.submit(ctx, store.id, { items, source: 'chat', ref: x.ref ? String(x.ref) : null }, now);
      const ok = p.status === 'paid';
      return U.res([U.card(ok ? `✅ 발주 완료 · ${p.code}` : `⚠️ 결제 확인 필요 · ${p.code}`,
        ok ? `${shop.statusText(p, now)}\n합계 ${won(p.amount)}${p.pay_method === 'invoice' ? ' (월말 청구)' : ''}\n\n배송 출발·도착도 카카오톡으로 알려 드릴게요.` : `${p.pay_fail_reason || '결제가 완료되지 않았어요'}\n운영팀이 곧 연락드릴게요.`,
        [U.link('발주 내역 보기', shop.orderLink(ctx, store.id, now))])], [U.qr('처음으로', { s: 'home' })]);
    }
    case 'status': {
      const list = shop.recentOrders(db, store.id, now, 5);
      if (!list.length) return U.res([U.text('아직 발주 내역이 없어요.')], [U.qr('💬 품목 고르기', { s: 'cats' }), U.qr('처음으로', { s: 'home' })]);
      return U.res([U.list('📦 최근 발주', list.map((o) => ({
        title: `${o.code} · ${o.statusText}`,
        description: `${o.lines.slice(0, 2).map((l) => `${l.name} ${l.qty}${l.u}`).join(', ')}${o.lines.length > 2 ? ` 외 ${o.lines.length - 2}` : ''} · ${won(o.amount)}`,
      })), [U.link('전체 보기', shop.orderLink(ctx, store.id, now))])], [U.qr('🔁 지난번과 똑같이', { s: 'reorder' }), U.qr('처음으로', { s: 'home' })]);
    }
    case 'request': {
      const cats = catalog.storeCategories(db, store).filter((c) => c.status !== 'approved');
      if (!cats.length) return U.res([U.text('모든 품목을 이용 중이에요.')], [U.qr('처음으로', { s: 'home' })]);
      const pend = cats.filter((c) => c.status === 'pending');
      return U.res([U.text('추가로 발주하고 싶은 품목을 골라 주세요. 운영팀이 확인 후 열어 드려요.' + (pend.length ? `\n\n⏳ 승인 대기: ${pend.map((c) => c.short).join(', ')}` : ''))],
        [...cats.filter((c) => c.status !== 'pending').map((c) => U.qr(`${c.icon} ${c.short} 신청`, { s: 'req', c: c.id }, `${c.short} 품목 이용 신청`)), U.qr('처음으로', { s: 'home' })]);
    }
    case 'req': {
      const r = catalog.requestAccess(ctx, store.id, String(x.c || ''), { via: 'chat' }, now);
      return U.res([U.text(r.already ? '이미 신청해 두셨어요. 승인되면 카카오톡으로 알려 드릴게요.' : `✅ ${catLabel(x.c)} 품목 이용을 신청했어요.\n운영팀이 확인하면 카카오톡으로 알려 드릴게요.`)], [U.qr('처음으로', { s: 'home' })]);
    }
    default: return home(ctx, U, store, now);
  }
}

function checkSkillKey(ctx, given) {
  const want = ctx.getSecret('kakao');
  const a = Buffer.from(String(given || '')), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── 카카오 로그인 ─────────────────────────────────────────────
const KAUTH = 'https://kauth.kakao.com';
const KAPI = 'https://kapi.kakao.com';
const redirectUri = (ctx) => ctx.R.public_base_url + '/k/callback';

/** 인가 요청 주소 + 로그인 CSRF 방지용 쿠키 값 */
function loginStart(ctx, botToken, now = Date.now()) {
  if (!ctx.R.kakao_rest_key) throw new Error('카카오 로그인이 설정되지 않았습니다');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const bot = botToken ? tokens.verify(ctx.secret, botToken, 'kl', now) : null;
  const state = tokens.sign(ctx.secret, { k: 'ks', id: 0, r: nonce, u: bot ? bot.u : '', e: now + 10 * 60e3 });
  const q = new URLSearchParams({ response_type: 'code', client_id: ctx.R.kakao_rest_key, redirect_uri: redirectUri(ctx), state });
  return { url: `${KAUTH}/oauth/authorize?${q}`, nonce };
}

/**
 * 인가 코드 → 토큰 → 사용자 정보 → 매장 찾기
 * @returns {{ store?, pendingToken? }} 매장을 못 찾으면 연결 코드 입력용 토큰
 */
/** 인가 코드 → 토큰 → 사용자 정보 */
async function exchange(ctx, code) {
  const { R } = ctx;
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: R.kakao_rest_key, redirect_uri: redirectUri(ctx), code });
  if (ctx.env.BEVFLOW_KAKAO_CLIENT_SECRET) form.set('client_secret', ctx.env.BEVFLOW_KAKAO_CLIENT_SECRET);
  const tr = await ctx.fetch(`${KAUTH}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form.toString(), signal: AbortSignal.timeout(8000) });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) throw new Error('카카오 로그인에 실패했어요 (' + (tj.error_description || tj.error || tr.status) + ')');
  const ur = await ctx.fetch(`${KAPI}/v2/user/me`, { headers: { authorization: 'Bearer ' + tj.access_token }, signal: AbortSignal.timeout(8000) });
  const me = await ur.json().catch(() => ({}));
  if (!ur.ok || me.id == null) throw new Error('카카오 사용자 정보를 받지 못했어요');
  return { tj, me };
}

/** 관리자 카톡 알림 연결 시작: 카카오톡 메시지 전송(talk_message) 동의를 받는다 */
function adminLoginStart(ctx, userId, now = Date.now()) {
  if (!ctx.R.kakao_rest_key) throw new Error('카카오 REST API 키를 먼저 운영 설정에 넣어 주세요');
  const nonce = crypto.randomBytes(12).toString('base64url');
  const state = tokens.sign(ctx.secret, { k: 'ka', id: userId, r: nonce, e: now + 10 * 60e3 });
  const q = new URLSearchParams({ response_type: 'code', client_id: ctx.R.kakao_rest_key, redirect_uri: redirectUri(ctx), state, scope: 'talk_message' });
  return { url: `${KAUTH}/oauth/authorize?${q}`, nonce };
}

async function loginCallback(ctx, { code, state, cookieNonce, sessionUser = null }, now = Date.now()) {
  const { db } = ctx;
  const adm = tokens.verify(ctx.secret, state, 'ka', now);
  if (adm) {
    if (!cookieNonce || adm.r !== cookieNonce || !sessionUser || sessionUser.id !== adm.id) throw new Error('연결 요청이 만료됐어요. 콘솔에서 다시 시도해 주세요');
    if (!code) throw new Error('카카오 연결을 취소했어요');
    const { tj, me } = await exchange(ctx, code);
    const scopes = String(tj.scope || '').split(/[ ,]+/);
    if (tj.scope && !scopes.includes('talk_message')) throw new Error('카카오톡 메시지 전송에 동의해야 알림을 받을 수 있어요');
    const nick = (me.kakao_account && me.kakao_account.profile && me.kakao_account.profile.nickname) || (me.properties && me.properties.nickname) || '';
    db.run(`INSERT INTO admin_kakao (user_id, kakao_id, nickname, access_token, access_exp, refresh_token, refresh_exp, linked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE SET kakao_id = excluded.kakao_id, nickname = excluded.nickname, access_token = excluded.access_token, access_exp = excluded.access_exp,
              refresh_token = excluded.refresh_token, refresh_exp = excluded.refresh_exp, linked_at = excluded.linked_at, last_error = NULL`,
    [adm.id, String(me.id), nick.slice(0, 40), tj.access_token, now + (Number(tj.expires_in) || 21599) * 1000, tj.refresh_token || '', tj.refresh_token_expires_in ? now + Number(tj.refresh_token_expires_in) * 1000 : null, now]);
    logEvent(db, { t: now, kind: '카카오 연결', actor: sessionUser.email, message: '관리자 카톡 알림 연결' });
    return { admin: true };
  }
  const st = tokens.verify(ctx.secret, state, 'ks', now);
  if (!st || !cookieNonce || st.r !== cookieNonce) throw new Error('로그인 요청이 만료됐어요. 처음부터 다시 시도해 주세요');
  if (!code) throw new Error('카카오 로그인을 취소했어요');
  const { me } = await exchange(ctx, code);
  const kakaoId = String(me.id);
  const acct = me.kakao_account || {};
  const nickname = (acct.profile && acct.profile.nickname) || (me.properties && me.properties.nickname) || '';
  let store = linkedStore(db, 'login', kakaoId, now);
  if (!store && acct.phone_number) {
    store = storeByPhone(db, acct.phone_number);
    if (store) {
      saveLink(db, store.id, 'login', kakaoId, nickname, now);
      logEvent(db, { t: now, kind: '카카오 연결', store_id: store.id, region_id: store.region_id, actor: 'owner', message: `${store.name} · 카카오 로그인 (휴대폰 번호 일치로 자동 연결)` });
    }
  }
  if (store && st.u) saveLink(db, store.id, 'chatbot', st.u, nickname, now);
  if (store) return { store };
  return { pendingToken: tokens.sign(ctx.secret, { k: 'kk', id: 0, u: kakaoId, nk: nickname.slice(0, 20), b: st.u || '', e: now + 30 * 60e3 }) };
}

/** 연결 화면(/k/link)에서 코드 입력 → 연결 */
function linkFromPage(ctx, { t, l, code }, ip, now = Date.now()) {
  const who = [];
  const bot = t ? tokens.verify(ctx.secret, t, 'kl', now) : null;
  const login = l ? tokens.verify(ctx.secret, l, 'kk', now) : null;
  if (bot) who.push({ kind: 'chatbot', key: bot.u });
  if (login) {
    who.push({ kind: 'login', key: login.u, nickname: login.nk });
    if (login.b) who.push({ kind: 'chatbot', key: login.b });
  }
  if (!who.length) throw new Error('연결 링크가 만료됐어요. 카카오톡 채널에서 다시 시작해 주세요');
  const store = linkByCode(ctx, code, who, 'ip:' + ip, now);
  return { store: store.name, orderUrl: shop.orderLink(ctx, store.id, now) };
}

module.exports = { skill, checkSkillKey, issueLinkCode, linkByCode, linkFromPage, loginStart, adminLoginStart, loginCallback, storeByPhone, normPhone, _attempts: attempts };
},

// ── server/routes.js ──────────────────────────────────────────────────────
"server/routes.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// API 라우트 — 운영 콘솔(로그인) · 관리(관리자/운영자) · 외부(POS 수신, 사장님·기사 링크)

const crypto = require('node:crypto');
const T = require('./time');
const auth = require('./auth');
const settings = require('./settings');
const tokens = require('./tokens');
const snapshot = require('./api/snapshot');
const inv = require('./engine/inventory');
const props = require('./engine/proposals');
const orders = require('./engine/orders');
const delivery = require('./engine/delivery');
const settlement = require('./engine/settlement');
const msg = require('./engine/messages');
const catalog = require('./engine/catalog');
const shop = require('./engine/shop');
const kakao = require('./kakao');
const adminNotify = require('./adminNotify');
const today = require('./api/today');
const { logEvent } = require('./engine/events');
const { parseCsv } = require('./csv');
const { HttpError, createRouter, readJson, readBody } = require('./http');

// ── 입력 검증 도우미 ─────────────────────────────────────────
const str = (v, label, { max = 200, required = true, re = null } = {}) => {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${label}을(를) 입력해 주세요`);
  if (s.length > max) throw new HttpError(400, `${label}은(는) ${max}자 이하여야 합니다`);
  if (s && re && !re.test(s)) throw new HttpError(400, `${label} 형식이 올바르지 않습니다`);
  return s;
};
const num = (v, label, { min = -Infinity, max = Infinity, nullable = false, int = false } = {}) => {
  if ((v === '' || v == null) && nullable) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new HttpError(400, `${label}: ${min}~${max} 범위의 ${int ? '정수' : '숫자'}여야 합니다`);
  return n;
};
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const id = (v) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, '잘못된 ID'); return n; };
const PHONE = /^[0-9+\- ]{8,20}$/;
const SKU_ID = /^[A-Z0-9_]{2,20}$/;
const CODE = /^[A-Za-z0-9_-]{2,30}$/;

function parseTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v || '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return T.parseDate(m[1]) + ((+m[2]) * 3600 + (+m[3]) * 60 + (+(m[4] || 0))) * 1000; // 시간대 없는 값은 KST로 간주
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new HttpError(400, '판매 시각 형식이 올바르지 않습니다: ' + s);
  return t;
}

const standingDays = (v) => {
  const s = String(v ?? '').replace(/\s/g, '');
  if (!s) return '';
  const days = [...new Set(s.split(/[,;]/).filter(Boolean))];
  if (!days.every((d) => /^[0-6]$/.test(d))) throw new HttpError(400, '정기 발주 요일은 0(일)~6(토)을 쉼표로 구분해 입력해 주세요');
  return days.sort().join(',');
};

const STORE_INSERT = `INSERT INTO stores (code, name, region_id, type, biz, standing_days, owner_name, owner_phone, address, lat, lng, pos_store_id, send_pref, review_required, pay_test_fail, active, beta, memo, created_at)
  VALUES ($code, $name, $region_id, $type, $biz, $standing_days, $owner_name, $owner_phone, $address, $lat, $lng, $pos_store_id, $send_pref, $review_required, $pay_test_fail, $active, $beta, $memo, $now)`;
const STORE_UPDATE = `UPDATE stores SET code=$code, name=$name, region_id=$region_id, type=$type, biz=$biz, standing_days=$standing_days, owner_name=$owner_name, owner_phone=$owner_phone, address=$address,
  lat=$lat, lng=$lng, pos_store_id=$pos_store_id, send_pref=$send_pref, review_required=$review_required, pay_test_fail=$pay_test_fail,
  active=$active, beta=$beta, memo=$memo WHERE id=$id`;

function buildRoutes(ctx) {
  const r = createRouter();
  const { db } = ctx;

  // ── 인증 ────────────────────────────────────────────────
  r.post('/api/auth/login', async (req) => {
    const b = await readJson(req);
    const { sid, user } = auth.login(db, b.email, b.password, req.ip);
    req.setCookie = auth.cookieHeader(sid, req.secure);
    return { user };
  }, { public: true });
  r.post('/api/auth/logout', async (req) => {
    auth.logout(db, req.sid);
    req.setCookie = auth.cookieHeader('', req.secure, 0);
    return { ok: true };
  }, { public: true });
  r.get('/api/me', async (req) => ({ user: req.user }), { role: 'viewer' });
  r.post('/api/auth/password', async (req) => {
    const b = await readJson(req);
    auth.changePassword(db, req.user.id, b.current, b.next);
    req.setCookie = auth.cookieHeader('', req.secure, 0);
    return { ok: true };
  }, { role: 'viewer' });

  // ── 운영 콘솔 ────────────────────────────────────────────
  r.get('/api/console/snapshot', async (req) => snapshot.build(ctx, req.user, Date.now()), { role: 'viewer', etag: true });
  r.get('/api/stores/:id/series', async (req, p, url) => {
    const days = num(url.searchParams.get('days') || 14, '기간', { min: 1, max: 60 });
    const sku = str(url.searchParams.get('sku'), 'SKU', { re: SKU_ID });
    return snapshot.storeHistory(ctx, id(p.id), sku, days, Date.now());
  }, { role: 'viewer' });

  const act = (fn) => async (req, p) => {
    const b = await readJson(req);
    try { return { ok: true, result: await fn(id(p.id), b, req.user.email, Date.now()) }; } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(409, e.message);
    }
  };
  r.post('/api/proposals/:id/approve', act((pid, b, who, now) => {
    const note = str(b.note, '대리 승인 사유 (예: 사장님 통화 확인)', { max: 100 });
    return orders.approve(ctx, pid, { qty: b.qty || null, actor: 'ops:' + who, note }, now);
  }), { role: 'ops' });
  r.post('/api/proposals/:id/hold', act((pid, b, who, now) => orders.hold(ctx, pid, { actor: 'ops:' + who }, now)), { role: 'ops' });
  r.post('/api/proposals/:id/remind', act((pid, b, who, now) => props.remind(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/proposals/:id/send-now', act((pid, b, who, now) => props.sendNow(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/proposals/:id/cancel', act((pid, b, who, now) => orders.cancel(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/proposals/:id/retry-payment', act((pid, b, who, now) => orders.retryPayment(ctx, pid, 'ops:' + who, now)), { role: 'ops' });
  r.get('/api/proposals/:id/link', async (req, p) => {
    const pr = db.get('SELECT * FROM proposals WHERE id = ?', [id(p.id)]);
    if (!pr) throw new HttpError(404, '발주를 찾을 수 없습니다');
    return { url: msg.ownerLink(ctx, pr), text: db.get("SELECT body FROM messages WHERE proposal_id = ? AND kind = 'propose' ORDER BY id DESC LIMIT 1", [pr.id])?.body || null };
  }, { role: 'ops' });
  r.post('/api/stores/:id/propose', act((sid, b, who, now) => props.proposeNow(ctx, sid, 'ops:' + who, now)), { role: 'ops' });
  r.post('/api/stores/:id/counts', act((sid, b, who, now) => {
    if (!b.counts || typeof b.counts !== 'object') throw new HttpError(400, '잔량을 입력해 주세요');
    return inv.recordCount(ctx, sid, b.counts, 'ops:' + who, now, !!b.onboarding);
  }), { role: 'ops' });
  r.post('/api/dispatch', async (req) => {
    const b = await readJson(req);
    const now = Date.now();
    const mid = b.date ? T.parseDate(b.date) : T.kstMidnight(now);
    return { ok: true, result: delivery.dispatch(ctx, mid, now, 'ops:' + req.user.email) };
  }, { role: 'ops' });
  const stopAct = (fn) => act((sid, b, who, now) => fn(sid, b, 'ops:' + who, now));
  r.post('/api/stops/:id/arrive', stopAct((sid, b, who, now) => delivery.arrive(ctx, sid, { actor: who }, now)), { role: 'ops' });
  r.post('/api/stops/:id/complete', stopAct((sid, b, who, now) => delivery.complete(ctx, sid, { counts: b.counts || null, actor: who }, now)), { role: 'ops' });
  r.post('/api/stops/:id/fail', stopAct((sid, b, who, now) => delivery.fail(ctx, sid, { reason: str(b.reason, '실패 사유', { max: 100 }), actor: who }, now)), { role: 'ops' });
  r.get('/api/routes/:id/link', async (req, p) => {
    const route = db.get('SELECT * FROM routes WHERE id = ?', [id(p.id)]);
    if (!route) throw new HttpError(404, '라우트를 찾을 수 없습니다');
    return { url: delivery.driverLink(ctx, route) };
  }, { role: 'ops' });
  r.get('/api/settlements/:week/csv', async (req, p) => {
    T.parseDate(p.week);
    return { __raw: settlement.csv(ctx, p.week), type: 'text/csv; charset=utf-8', filename: `bevflow-settlement-${p.week}.csv` };
  }, { role: 'viewer' });
  r.post('/api/settlements/:week/paid', async (req, p) => {
    settlement.markPaid(ctx, p.week, req.user.email, Date.now());
    logEvent(db, { t: Date.now(), kind: '정산', actor: req.user.email, message: `${p.week} 주차 지급 완료 처리` });
    return { ok: true };
  }, { role: 'admin' });

  // ── 관리 ────────────────────────────────────────────────
  r.get('/api/admin/data', async (req) => {
    const admin = req.user.role === 'admin';
    return {
      stores: db.all('SELECT * FROM stores ORDER BY region_id, code'),
      storeSkus: db.all('SELECT store_id, sku_id, carried, rate, rate_manual, safety_override, last_count_at FROM store_skus'),
      skus: db.all('SELECT * FROM skus ORDER BY sort, id'),
      menuMap: db.all('SELECT m.*, s.name AS store_name FROM menu_map m LEFT JOIN stores s ON s.id = m.store_id ORDER BY m.menu_name'),
      unmapped: db.all('SELECT u.*, s.name AS store_name, s.code AS store_code FROM unmapped_menu u JOIN stores s ON s.id = u.store_id ORDER BY u.qty DESC LIMIT 200'),
      drivers: db.all('SELECT * FROM drivers ORDER BY id'),
      regions: db.all('SELECT * FROM regions ORDER BY sort, id'),
      users: admin ? db.all('SELECT id, email, name, role, disabled, must_change, created_at, last_login_at FROM users ORDER BY id') : [],
      settings: { values: ctx.settings, spec: settings.SPEC },
      ingest: admin ? { endpoint: ctx.R.public_base_url + '/api/ingest/pos', secret: ctx.getSecret('ingest'), webhookSecret: ctx.getSecret('webhook') } : null,
      outbox: db.all("SELECT id, kind, status, attempts, error, created_at FROM messages WHERE status != 'sent' ORDER BY id DESC LIMIT 50"),
      categories: catalog.CATEGORIES, biz: catalog.BIZ,
      storeCategories: db.all('SELECT * FROM store_categories'),
      kakaoLinks: db.all('SELECT id, store_id, kind, nickname, linked_at, last_seen_at FROM kakao_links ORDER BY id DESC'),
      kakao: {
        skillUrl: ctx.R.public_base_url + '/api/kakao/skill' + (admin ? '?key=' + encodeURIComponent(ctx.getSecret('kakao')) : ''),
        redirectUri: ctx.R.public_base_url + '/k/callback', loginUrl: ctx.R.public_base_url + '/k/login',
        restKey: !!ctx.R.kakao_rest_key, clientSecret: !!ctx.env.BEVFLOW_KAKAO_CLIENT_SECRET, blockId: ctx.R.kakao_block_id, channelId: ctx.R.kakao_channel_id,
      },
    };
  }, { role: 'ops' });

  const storeFields = (b, cur = {}) => {
    const o = {
      code: str(b.code ?? cur.code, '매장 코드', { max: 30, re: CODE }),
      name: str(b.name ?? cur.name, '매장명', { max: 60 }),
      region_id: str(b.region_id ?? cur.region_id, '권역', { max: 20 }),
      type: (b.type ?? cur.type) === 'D' ? 'D' : 'L',
      biz: catalog.BIZ[b.biz || cur.biz] ? (b.biz || cur.biz) : 'restaurant', // CSV의 빈 칸은 기존 값 유지
      standing_days: standingDays(b.standing_days ?? cur.standing_days),
      owner_name: str(b.owner_name ?? cur.owner_name, '사장님 성함', { max: 30, required: false }),
      owner_phone: str(b.owner_phone ?? cur.owner_phone, '사장님 연락처', { max: 20, required: false, re: PHONE }),
      address: str(b.address ?? cur.address, '주소', { max: 200, required: false }),
      lat: num(b.lat ?? cur.lat, '위도', { min: 33, max: 39, nullable: true }),
      lng: num(b.lng ?? cur.lng, '경도', { min: 124, max: 132, nullable: true }),
      pos_store_id: str(b.pos_store_id ?? cur.pos_store_id, '티오더 매장 ID', { max: 60, required: false }) || null,
      send_pref: (b.send_pref ?? cur.send_pref) === 'break' ? 'break' : 'immediate',
      review_required: bool(b.review_required ?? cur.review_required),
      pay_test_fail: bool(b.pay_test_fail ?? cur.pay_test_fail),
      active: b.active === undefined ? (cur.active ?? 1) : bool(b.active),
      beta: num(b.beta === undefined ? cur.beta : b.beta, '밴드 증가율', { min: 0, max: 1, nullable: true }),
      memo: str(b.memo ?? cur.memo, '메모', { max: 500, required: false }),
    };
    if (!db.get('SELECT 1 FROM regions WHERE id = ?', [o.region_id])) throw new HttpError(400, '존재하지 않는 권역입니다');
    return o;
  };
  const uniq = (fn) => { try { return fn(); } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, '이미 사용 중인 코드 또는 티오더 매장 ID입니다'); throw e; } };
  r.post('/api/admin/stores', async (req) => {
    const b = await readJson(req);
    const o = storeFields(b);
    const now = Date.now();
    const sid = uniq(() => db.tx(() => {
      const res = db.run(STORE_INSERT, { ...o, now });
      const newId = Number(res.lastInsertRowid);
      catalog.ensureDefault(db, { id: newId, biz: o.biz }, req.user.email, now);
      for (const sku of Array.isArray(b.skus) ? b.skus : []) {
        if (db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) db.run('INSERT OR IGNORE INTO store_skus (store_id, sku_id) VALUES (?, ?)', [newId, sku]);
      }
      logEvent(db, { t: now, kind: '매장 등록', store_id: newId, region_id: o.region_id, actor: req.user.email, message: `${o.name} (${o.code}) 등록` });
      return newId;
    }));
    return { id: sid };
  }, { role: 'ops' });
  r.put('/api/admin/stores/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM stores WHERE id = ?', [id(p.id)]);
    if (!cur) throw new HttpError(404, '매장을 찾을 수 없습니다');
    const o = storeFields(await readJson(req), cur);
    uniq(() => db.tx(() => {
      catalog.ensureDefault(db, cur, req.user.email, Date.now()); // 업종을 바꿔도 이전 기본 품목은 승인 상태로 남긴다 (필요하면 운영자가 해제)
      db.run(STORE_UPDATE, { ...o, id: cur.id });
      catalog.ensureDefault(db, { id: cur.id, biz: o.biz }, req.user.email, Date.now());
    }));
    logEvent(db, { t: Date.now(), kind: '매장 수정', store_id: cur.id, region_id: o.region_id, actor: req.user.email, message: `${o.name} 정보 수정` });
    return { ok: true };
  }, { role: 'ops' });
  r.put('/api/admin/stores/:id/skus', async (req, p) => {
    const sid = id(p.id);
    if (!db.get('SELECT 1 FROM stores WHERE id = ?', [sid])) throw new HttpError(404, '매장을 찾을 수 없습니다');
    const b = await readJson(req);
    if (!Array.isArray(b.items)) throw new HttpError(400, 'items 배열이 필요합니다');
    db.tx(() => {
      for (const it of b.items) {
        const sku = str(it.sku_id, 'SKU', { re: SKU_ID });
        if (!db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) throw new HttpError(400, '없는 SKU: ' + sku);
        db.run(`INSERT INTO store_skus (store_id, sku_id, carried, rate_manual, safety_override) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (store_id, sku_id) DO UPDATE SET carried = excluded.carried, rate_manual = excluded.rate_manual, safety_override = excluded.safety_override`,
        [sid, sku, bool(it.carried), num(it.rate_manual, '예상 일 판매량', { min: 0, max: 50, nullable: true }), num(it.safety_override, '안전재고', { min: 0, max: 100, nullable: true })]);
      }
    });
    return { ok: true };
  }, { role: 'ops' });

  const skuFields = (b, cur = {}) => ({
    name: str(b.name ?? cur.name, 'SKU명', { max: 60 }),
    pack: num(b.pack ?? cur.pack, '입수', { min: 1, max: 500, int: true }),
    unit: str(b.unit ?? cur.unit ?? '병', '단위', { max: 10 }),
    price: num(b.price ?? cur.price, '박스 단가', { min: 0, max: 10000000, int: true }),
    active: b.active === undefined ? (cur.active ?? 1) : bool(b.active),
    sort: num(b.sort ?? cur.sort ?? 0, '정렬', { min: 0, max: 9999, int: true }),
    category: catalog.CATEGORIES[b.category ?? cur.category] ? (b.category ?? cur.category) : 'beverage',
    spec: str(b.spec ?? cur.spec, '규격 설명', { max: 60, required: false }),
    grp: str(b.grp ?? cur.grp, '매대·소분류', { max: 20, required: false }),
  });
  r.post('/api/admin/skus', async (req) => {
    const b = await readJson(req);
    const skuId = str(b.id, 'SKU 코드', { re: SKU_ID });
    const o = skuFields(b);
    uniq(() => db.run('INSERT INTO skus (id, name, pack, unit, price, active, sort, category, spec, grp) VALUES ($id, $name, $pack, $unit, $price, $active, $sort, $category, $spec, $grp)', { ...o, id: skuId }));
    return { ok: true };
  }, { role: 'ops' });
  r.put('/api/admin/skus/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM skus WHERE id = ?', [p.id]);
    if (!cur) throw new HttpError(404, 'SKU를 찾을 수 없습니다');
    const o = skuFields(await readJson(req), cur);
    db.run('UPDATE skus SET name=$name, pack=$pack, unit=$unit, price=$price, active=$active, sort=$sort, category=$category, spec=$spec, grp=$grp WHERE id=$id', { ...o, id: cur.id });
    return { ok: true };
  }, { role: 'ops' });

  r.post('/api/admin/menu-map', async (req) => {
    const b = await readJson(req);
    const storeId = b.store_id ? id(b.store_id) : null;
    const menu = str(b.menu_name, 'POS 메뉴명', { max: 100 });
    const sku = str(b.sku_id, 'SKU', { re: SKU_ID });
    if (!db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) throw new HttpError(400, '없는 SKU입니다');
    const units = num(b.units, '메뉴 1개당 수량', { min: 0.01, max: 100 });
    uniq(() => db.run('INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (?, ?, ?, ?)', [storeId, menu, sku, units]));
    db.run('DELETE FROM unmapped_menu WHERE menu_name = ?' + (storeId ? ' AND store_id = ?' : ''), storeId ? [menu, storeId] : [menu]);
    return { ok: true };
  }, { role: 'ops' });
  r.del('/api/admin/menu-map/:id', async (req, p) => { db.run('DELETE FROM menu_map WHERE id = ?', [id(p.id)]); return { ok: true }; }, { role: 'ops' });

  const driverFields = (b, cur = {}) => ({
    name: str(b.name ?? cur.name, '기사 이름', { max: 30 }),
    phone: str(b.phone ?? cur.phone, '연락처', { max: 20, required: false, re: PHONE }),
    region_id: str(b.region_id ?? cur.region_id, '권역', { max: 20 }),
    vehicle: str(b.vehicle ?? cur.vehicle, '차량', { max: 60, required: false }),
    capacity: num(b.capacity ?? cur.capacity ?? 60, '일 용량', { min: 1, max: 500, int: true }),
    active: b.active === undefined ? (cur.active ?? 1) : bool(b.active),
  });
  r.post('/api/admin/drivers', async (req) => {
    const o = driverFields(await readJson(req));
    db.run('INSERT INTO drivers (name, phone, region_id, vehicle, capacity, active) VALUES ($name, $phone, $region_id, $vehicle, $capacity, $active)', o);
    return { ok: true };
  }, { role: 'ops' });
  r.put('/api/admin/drivers/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM drivers WHERE id = ?', [id(p.id)]);
    if (!cur) throw new HttpError(404, '기사를 찾을 수 없습니다');
    db.run('UPDATE drivers SET name=$name, phone=$phone, region_id=$region_id, vehicle=$vehicle, capacity=$capacity, active=$active WHERE id=$id', { ...driverFields(await readJson(req), cur), id: cur.id });
    return { ok: true };
  }, { role: 'ops' });
  const regionFields = (b, cur = {}) => ({
    name: str(b.name ?? cur.name, '권역명', { max: 30 }),
    area: str(b.area ?? cur.area, '지역', { max: 100, required: false }),
    hub_name: str(b.hub_name ?? cur.hub_name, '거점명', { max: 40, required: false }),
    hub_lat: num(b.hub_lat ?? cur.hub_lat, '거점 위도', { min: 33, max: 39, nullable: true }),
    hub_lng: num(b.hub_lng ?? cur.hub_lng, '거점 경도', { min: 124, max: 132, nullable: true }),
    radius_km: num(b.radius_km ?? cur.radius_km ?? 3, '반경', { min: 0.5, max: 50 }),
    sort: num(b.sort ?? cur.sort ?? 0, '정렬', { min: 0, max: 999, int: true }),
  });
  r.post('/api/admin/regions', async (req) => {
    const b = await readJson(req);
    const rid = str(b.id, '권역 코드', { max: 20, re: /^[A-Z0-9_]{2,20}$/ });
    uniq(() => db.run('INSERT INTO regions (id, name, area, hub_name, hub_lat, hub_lng, radius_km, sort) VALUES ($id, $name, $area, $hub_name, $hub_lat, $hub_lng, $radius_km, $sort)', { ...regionFields(b), id: rid }));
    return { ok: true };
  }, { role: 'admin' });
  r.put('/api/admin/regions/:id', async (req, p) => {
    const cur = db.get('SELECT * FROM regions WHERE id = ?', [p.id]);
    if (!cur) throw new HttpError(404, '권역을 찾을 수 없습니다');
    db.run('UPDATE regions SET name=$name, area=$area, hub_name=$hub_name, hub_lat=$hub_lat, hub_lng=$hub_lng, radius_km=$radius_km, sort=$sort WHERE id=$id', { ...regionFields(await readJson(req), cur), id: cur.id });
    return { ok: true };
  }, { role: 'admin' });

  r.post('/api/admin/users', async (req) => {
    const b = await readJson(req);
    const temp = crypto.randomBytes(9).toString('base64url');
    const uid = auth.createUser(db, { email: b.email, name: b.name, role: b.role, password: temp, mustChange: true });
    logEvent(db, { t: Date.now(), kind: '계정', actor: req.user.email, message: `${b.email} 계정 생성 (${b.role})` });
    return { id: uid, tempPassword: temp };
  }, { role: 'admin' });
  r.put('/api/admin/users/:id', async (req, p) => {
    const uid = id(p.id);
    const b = await readJson(req);
    const cur = db.get('SELECT * FROM users WHERE id = ?', [uid]);
    if (!cur) throw new HttpError(404, '계정을 찾을 수 없습니다');
    if (uid === req.user.id && (b.disabled || (b.role && b.role !== 'admin'))) throw new HttpError(400, '자기 계정의 관리자 권한은 해제할 수 없습니다');
    if (b.role && !auth.ROLES[b.role]) throw new HttpError(400, '잘못된 권한');
    let temp = null;
    db.tx(() => {
      if (b.role) db.run('UPDATE users SET role = ? WHERE id = ?', [b.role, uid]);
      if (b.disabled !== undefined) { db.run('UPDATE users SET disabled = ? WHERE id = ?', [bool(b.disabled), uid]); if (bool(b.disabled)) db.run('DELETE FROM sessions WHERE user_id = ?', [uid]); }
      if (b.resetPassword) {
        temp = crypto.randomBytes(9).toString('base64url');
        db.run('UPDATE users SET pw_hash = ?, must_change = 1 WHERE id = ?', [auth.hashPassword(temp), uid]);
        db.run('DELETE FROM sessions WHERE user_id = ?', [uid]);
      }
    });
    logEvent(db, { t: Date.now(), kind: '계정', actor: req.user.email, message: `${cur.email} 계정 변경` });
    return { ok: true, tempPassword: temp };
  }, { role: 'admin' });

  r.put('/api/admin/settings', async (req) => {
    const b = await readJson(req);
    try { settings.save(db, b); } catch (e) { throw new HttpError(400, e.message); }
    ctx.reload();
    logEvent(db, { t: Date.now(), kind: '설정', actor: req.user.email, message: `운영 설정 변경: ${Object.keys(b).join(', ')}` });
    return { ok: true, settings: ctx.settings };
  }, { role: 'admin' });
  r.post('/api/admin/secrets/:name/rotate', async (req, p) => {
    if (!['ingest', 'webhook', 'link', 'kakao'].includes(p.name)) throw new HttpError(400, '알 수 없는 키');
    ctx.rotateSecret(p.name);
    logEvent(db, { t: Date.now(), kind: '보안', actor: req.user.email, message: `${p.name} 키 재발급` });
    return { ok: true };
  }, { role: 'admin' });
  r.post('/api/admin/sample/clear', async (req) => {
    const b = await readJson(req);
    if (b.confirm !== '샘플 삭제') throw new HttpError(400, "확인 문구 '샘플 삭제'를 입력해 주세요");
    db.tx(() => {
      for (const t of ['admin_notices', 'daily_marks', 'carts', 'kakao_links', 'store_categories', 'events', 'stops', 'routes', 'messages', 'proposal_lines', 'proposals', 'counts', 'inv_snapshots', 'pos_sale_items', 'pos_sales', 'unmapped_menu', 'menu_map', 'store_skus', 'stores', 'drivers', 'regions', 'skus', 'settlements']) db.run(`DELETE FROM ${t}`);
    });
    settings.save(db, { sample_data: 0 });
    ctx.reload();
    logEvent(db, { t: Date.now(), kind: '데이터', actor: req.user.email, message: '샘플 데이터 전체 삭제' });
    return { ok: true };
  }, { role: 'admin' });

  // ── 관리: 품목 이용 승인 · 카카오 연결 ─────────────────────────
  r.post('/api/admin/access/:store/:cat', async (req, p) => {
    const b = await readJson(req);
    const sid = id(p.store);
    const now = Date.now();
    const action = str(b.action, '처리', { max: 10 });
    const note = str(b.note, '메모', { max: 100, required: false });
    try {
      db.tx(() => {
        catalog.decide(ctx, sid, p.cat, action, { actor: req.user.email, note }, now);
        const cat = catalog.CATEGORIES[p.cat].label;
        if (action === 'approve') {
          const link = shop.orderLink(ctx, sid, now);
          msg.enqueueNotice(ctx, sid, 'access_ok', { text: `[BevFlow 품목 이용 안내]\n요청하신 ${cat} 이용이 승인됐어요.\n발주 화면과 카카오톡 채널의 품목 목록에 추가됐어요.\n▶ ${link}`, vars: { category: cat }, link, button: '품목 확인하기' }, now);
        } else if (action === 'reject') {
          msg.enqueueNotice(ctx, sid, 'access_no', { text: `[BevFlow]\n요청하신 ${cat} 이용은 이번에 승인되지 않았어요.${note ? '\n사유: ' + note : ''}\n궁금한 점은 카카오톡 채널로 문의해 주세요.`, vars: { category: cat, reason: note } }, now);
        }
      });
    } catch (e) { throw new HttpError(409, e.message); }
    return { ok: true };
  }, { role: 'ops' });
  r.post('/api/admin/stores/:id/link-code', async (req, p) => {
    const sid = id(p.id);
    if (!db.get('SELECT 1 FROM stores WHERE id = ?', [sid])) throw new HttpError(404, '매장을 찾을 수 없습니다');
    const code = kakao.issueLinkCode(ctx, sid);
    logEvent(db, { t: Date.now(), kind: '카카오 연결', store_id: sid, actor: req.user.email, message: '연결 코드 발급' });
    return { code };
  }, { role: 'ops' });
  // 발주 화면 링크는 복사해서 전달만 한다 (점주 요청 없는 발주 권유 알림톡은 광고로 분류돼 심사 반려)
  r.post('/api/admin/stores/:id/order-link', async (req, p) => {
    const sid = id(p.id);
    if (!db.get('SELECT 1 FROM stores WHERE id = ? AND active = 1', [sid])) throw new HttpError(404, '운영 중인 매장이 아닙니다');
    return { url: shop.orderLink(ctx, sid, Date.now()) };
  }, { role: 'ops' });
  // 정기 발주서 지금 준비 (notify: 점주에게 준비 알림톡)
  r.post('/api/admin/stores/:id/sheet', async (req, p) => {
    const b = await readJson(req);
    try { return { ok: true, result: shop.prepareSheet(ctx, id(p.id), Date.now(), { notify: !!b.notify }) }; } catch (e) { throw new HttpError(409, e.message); }
  }, { role: 'ops' });

  // ── 관리자: 오늘 발주 (모바일 내역 화면 /a) ─────────────────────
  r.get('/api/admin/today', async (req, p, url) => {
    const d = url.searchParams.get('date');
    return today.build(ctx, req.user, d ? T.parseDate(d) + 12 * T.HOUR : Date.now(), Date.now());
  }, { role: 'viewer' });

  // ── 관리자: 내 카톡 알림 (나에게 보내기) ───────────────────────
  const myKakao = (u) => {
    const r2 = db.get('SELECT kakao_id, nickname, prefs, linked_at, last_error, refresh_exp FROM admin_kakao WHERE user_id = ?', [u.id]);
    return { linked: !!r2, nickname: r2 ? r2.nickname : '', linkedAt: r2 ? r2.linked_at : null, refreshExp: r2 ? r2.refresh_exp : null, lastError: r2 ? r2.last_error : null,
      prefs: r2 ? adminNotify.prefsOf(r2) : null, kinds: adminNotify.KINDS, loginReady: !!ctx.R.kakao_rest_key };
  };
  r.get('/api/me/kakao', async (req) => myKakao(req.user), { role: 'ops' });
  r.put('/api/me/kakao', async (req) => {
    const b = await readJson(req);
    const cur = db.get('SELECT * FROM admin_kakao WHERE user_id = ?', [req.user.id]);
    if (!cur) throw new HttpError(409, '먼저 카카오 계정을 연결해 주세요');
    const prefs = Object.fromEntries(Object.keys(adminNotify.KINDS).map((k) => [k, b.prefs && b.prefs[k] !== undefined ? !!b.prefs[k] : adminNotify.prefsOf(cur)[k]]));
    db.run('UPDATE admin_kakao SET prefs = ? WHERE user_id = ?', [JSON.stringify(prefs), req.user.id]);
    return myKakao(req.user);
  }, { role: 'ops' });
  r.post('/api/me/kakao/test', async (req) => {
    if (!db.get('SELECT 1 FROM admin_kakao WHERE user_id = ?', [req.user.id])) throw new HttpError(409, '먼저 카카오 계정을 연결해 주세요');
    const now = Date.now();
    db.run('INSERT INTO admin_notices (user_id, kind, dedupe, payload, created_at) VALUES (?, ?, ?, ?, ?)', [req.user.id, 'order', 'test:' + now, JSON.stringify(adminNotify.feed(ctx, {
      profile: 'BevFlow', title: '🔔 알림 연결 테스트', desc: `${req.user.name}님 카카오톡으로 BevFlow 알림이 이렇게 와요`, items: [['예) 구운란 6판', '90,000원']], sum: ['합계', '90,000원'], buttons: [['오늘 요약', '/a#sum']],
    })), now]);
    await adminNotify.flush(ctx, now);
    const last = db.get('SELECT status, error FROM admin_notices WHERE user_id = ? ORDER BY id DESC LIMIT 1', [req.user.id]);
    if (last.status !== 'sent') throw new HttpError(502, '발송하지 못했어요: ' + (last.error || '알 수 없는 오류'));
    return { ok: true };
  }, { role: 'ops' });
  r.del('/api/me/kakao', async (req) => {
    db.run('DELETE FROM admin_kakao WHERE user_id = ?', [req.user.id]);
    db.run("DELETE FROM admin_notices WHERE user_id = ? AND status = 'queued'", [req.user.id]);
    return { ok: true };
  }, { role: 'ops' });
  r.post('/api/admin/stores/:id/revoke-links', async (req, p) => {
    const sid = id(p.id);
    db.tx(() => {
      shop.revokeLinks(ctx, sid);
      db.run('DELETE FROM kakao_links WHERE store_id = ?', [sid]);
      db.run('UPDATE stores SET link_code = NULL WHERE id = ?', [sid]);
      logEvent(db, { t: Date.now(), kind: '보안', store_id: sid, actor: req.user.email, message: '발주 링크 무효화 · 카카오 연결 전체 해제' });
    });
    return { ok: true };
  }, { role: 'ops' });
  r.del('/api/admin/kakao-links/:id', async (req, p) => {
    const l = db.get('SELECT * FROM kakao_links WHERE id = ?', [id(p.id)]);
    if (!l) throw new HttpError(404, '연결을 찾을 수 없습니다');
    db.run('DELETE FROM kakao_links WHERE id = ?', [l.id]);
    logEvent(db, { t: Date.now(), kind: '카카오 연결', store_id: l.store_id, actor: req.user.email, message: `카카오 연결 해제 (${l.kind === 'chatbot' ? '채널 챗봇' : '카카오 로그인'}${l.nickname ? ' · ' + l.nickname : ''})` });
    return { ok: true };
  }, { role: 'ops' });

  // CSV 일괄 가져오기
  r.post('/api/admin/import/:kind', async (req, p) => {
    const text = (await readBody(req, 8 << 20)).toString('utf8');
    const rows = parseCsv(text);
    if (!rows.length) throw new HttpError(400, 'CSV에 데이터 행이 없습니다');
    const now = Date.now();
    const errors = [];
    let ok = 0;
    const each = (fn) => rows.forEach((row) => { try { db.tx(() => fn(row)); ok++; } catch (e) { errors.push(`${row._line}행: ${e.message}`); } });
    if (p.kind === 'stores') {
      each((row) => {
        const cur = db.get('SELECT * FROM stores WHERE code = ?', [row.code]) || {};
        const o = storeFields({ ...row, review_required: row.review_required, active: row.active === '' ? undefined : row.active }, cur);
        if (cur.id) db.run(STORE_UPDATE, { ...o, id: cur.id });
        else db.run(STORE_INSERT, { ...o, now });
        const sid = db.get('SELECT id FROM stores WHERE code = ?', [o.code]).id;
        catalog.ensureDefault(db, { id: sid, biz: o.biz }, 'csv', now);
        for (const sku of String(row.skus || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean)) {
          if (!db.get('SELECT 1 FROM skus WHERE id = ?', [sku])) throw new Error('없는 SKU: ' + sku);
          db.run('INSERT OR IGNORE INTO store_skus (store_id, sku_id) VALUES (?, ?)', [sid, sku]);
        }
      });
    } else if (p.kind === 'menu-map') {
      each((row) => {
        const store = row.store_code ? db.get('SELECT id FROM stores WHERE code = ?', [row.store_code]) : null;
        if (row.store_code && !store) throw new Error('없는 매장 코드: ' + row.store_code);
        if (!db.get('SELECT 1 FROM skus WHERE id = ?', [row.sku_id])) throw new Error('없는 SKU: ' + row.sku_id);
        const units = num(row.units || 1, 'units', { min: 0.01, max: 100 });
        db.run(`INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (?, ?, ?, ?)
                ON CONFLICT DO UPDATE SET units = excluded.units`, [store ? store.id : null, str(row.menu_name, 'menu_name', { max: 100 }), row.sku_id, units]);
      });
    } else if (p.kind === 'pos-sales') {
      each((row) => {
        const store = db.get('SELECT * FROM stores WHERE pos_store_id = ? OR code = ?', [row.store || row.pos_store_id || '', row.store_code || row.store || '']);
        if (!store) throw new Error('매장을 찾을 수 없습니다: ' + (row.store || row.store_code));
        inv.applySale(ctx, store, { ext_id: str(row.sale_id || row.id, 'sale_id', { max: 100 }), sold_at: parseTime(row.sold_at), menu: str(row.menu, 'menu', { max: 100 }), qty: num(row.qty, 'qty', { min: 1, max: 1000, int: true }) }, now);
      });
    } else throw new HttpError(404, '지원하지 않는 가져오기 종류입니다');
    logEvent(db, { t: now, kind: '가져오기', actor: req.user.email, message: `${p.kind} CSV ${ok}건 반영${errors.length ? `, 오류 ${errors.length}건` : ''}` });
    return { ok, errors: errors.slice(0, 50), errorCount: errors.length };
  }, { role: 'ops' });

  // ── 외부: 티오더 POS 판매 로그 수신 ─────────────────────────
  // TODO: 티오더 API 연동 — 티오더가 이 주소로 판매 로그를 푸시하도록 협의 (서명 방식은 docs/INTEGRATIONS.md)
  r.post('/api/ingest/pos', async (req) => {
    const raw = await readBody(req, 4 << 20);
    const ts = Number(req.headers['x-bevflow-timestamp']);
    const sig = String(req.headers['x-bevflow-signature'] || '').replace(/^sha256=/, '');
    const now = Date.now();
    if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60e3) throw new HttpError(401, '타임스탬프가 없거나 5분 이상 차이납니다');
    const want = crypto.createHmac('sha256', ctx.getSecret('ingest')).update(ts + '.' + raw.toString('utf8')).digest('hex');
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw new HttpError(401, '서명이 올바르지 않습니다');
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON 형식이 올바르지 않습니다'); }
    const sales = Array.isArray(body.sales) ? body.sales : [];
    if (sales.length > 5000) throw new HttpError(413, '한 번에 5,000건까지 보낼 수 있습니다');
    const out = { accepted: 0, duplicates: 0, unmapped: 0, unknownStore: 0, invalid: 0 };
    db.tx(() => {
      for (const s of sales) {
        const posId = String(s.store ?? body.store ?? '');
        const store = db.get('SELECT * FROM stores WHERE pos_store_id = ? AND active = 1', [posId]);
        if (!store) { out.unknownStore++; continue; }
        let sale;
        try { sale = { ext_id: str(s.id, 'id', { max: 100 }), sold_at: parseTime(s.sold_at), menu: str(s.menu, 'menu', { max: 100 }), qty: num(s.qty, 'qty', { min: 1, max: 1000, int: true }) }; } catch { out.invalid++; continue; }
        if (sale.sold_at > now + 10 * 60e3) { out.invalid++; continue; }
        const res = inv.applySale(ctx, store, sale, now);
        if (res.dup) out.duplicates++; else { out.accepted++; if (!res.mapped) out.unmapped++; }
      }
    });
    return out;
  }, { public: true, noCsrf: true });

  // ── 외부: 사장님 승인 링크 ─────────────────────────────────
  const ownerProposal = (token) => {
    const t = tokens.verify(ctx.secret, token, 'o');
    if (!t) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    const p = db.get('SELECT * FROM proposals WHERE id = ?', [t.id]);
    if (!p || p.token_nonce !== t.n) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    return p;
  };
  const ownerView = (p, now) => {
    const store = db.get('SELECT name, owner_name FROM stores WHERE id = ?', [p.store_id]);
    const lines = msg.linesOf(db, p.id);
    const canAct = ['sent', 'created'].includes(p.status) && p.responded_at == null && (p.status === 'sent' || p.send_at != null);
    const stop = db.get('SELECT eta, status, departed_at FROM stops WHERE proposal_id = ? ORDER BY id DESC LIMIT 1', [p.id]);
    return {
      code: p.code, store: store.name, owner: store.owner_name, status: p.status, canAct, amount: p.amount,
      sameDay: T.kstHour(now) < ctx.R.cutoffH, cutoff: ctx.settings.cutoff, expiresAt: p.sent_at ? p.sent_at + ctx.R.expire_hours * T.HOUR : null,
      lines: lines.map((l) => ({ sku: l.sku_id, name: l.name, qty: l.qty, qtyOrig: l.qty_orig, price: l.price, est: Math.round(l.est * 10) / 10, band: Math.round(l.band * 10) / 10, trig: !!l.trig })),
      deliverDate: p.deliver_date, eta: stop ? stop.eta : null, deliveredAt: stop && stop.status === 'done' ? stop.departed_at : null,
      payMethod: p.pay_method, payFailReason: p.status === 'payfail' ? p.pay_fail_reason : null,
    };
  };
  r.get('/api/owner/:token', async (req, p, url) => {
    const pr = ownerProposal(p.token);
    const now = Date.now();
    if (url.searchParams.get('preview') !== '1') orders.markOpened(ctx, pr.id, now); // 운영자 미리보기는 열람으로 치지 않음
    return ownerView(db.get('SELECT * FROM proposals WHERE id = ?', [pr.id]), now);
  }, { public: true });
  r.post('/api/owner/:token/approve', async (req, p) => {
    const pr = ownerProposal(p.token);
    const b = await readJson(req);
    try { await orders.approve(ctx, pr.id, { qty: b.qty || null, actor: 'owner' }, Date.now()); } catch (e) { throw new HttpError(409, e.message); }
    return ownerView(db.get('SELECT * FROM proposals WHERE id = ?', [pr.id]), Date.now());
  }, { public: true });
  r.post('/api/owner/:token/hold', async (req, p) => {
    const pr = ownerProposal(p.token);
    try { orders.hold(ctx, pr.id, { actor: 'owner' }, Date.now()); } catch (e) { throw new HttpError(409, e.message); }
    return ownerView(db.get('SELECT * FROM proposals WHERE id = ?', [pr.id]), Date.now());
  }, { public: true });

  // ── 외부: 기사 배송 링크 ───────────────────────────────────
  const driverRoute = (token) => {
    const t = tokens.verify(ctx.secret, token, 'd');
    if (!t) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    const route = db.get('SELECT * FROM routes WHERE id = ?', [t.id]);
    if (!route || route.token_nonce !== t.n) throw new HttpError(404, '링크가 만료되었거나 올바르지 않습니다');
    return route;
  };
  const routeView = (route) => {
    const rg = db.get('SELECT * FROM regions WHERE id = ?', [route.region_id]);
    const drv = route.driver_id ? db.get('SELECT name FROM drivers WHERE id = ?', [route.driver_id]) : null;
    const stops = db.all(`SELECT s.*, st.name, st.address, st.owner_phone, st.lat, st.lng FROM stops s JOIN stores st ON st.id = s.store_id WHERE s.route_id = ? ORDER BY s.seq`, [route.id]);
    return {
      date: route.date, region: rg ? rg.name : route.region_id, hub: rg ? rg.hub_name : '', driver: drv ? drv.name : '',
      stops: stops.map((s) => ({
        id: s.id, seq: s.seq, status: s.status, eta: s.eta, arrivedAt: s.arrived_at, departedAt: s.departed_at, boxes: s.boxes, failReason: s.fail_reason,
        store: s.name, address: s.address, phone: s.owner_phone, lat: s.lat, lng: s.lng,
        unload: db.all('SELECT l.sku_id AS sku, k.name, l.qty FROM proposal_lines l JOIN skus k ON k.id = l.sku_id WHERE l.proposal_id = ? AND l.qty > 0 ORDER BY k.sort', [s.proposal_id]),
        count: db.all('SELECT ss.sku_id AS sku, k.name, k.pack, k.unit FROM store_skus ss JOIN skus k ON k.id = ss.sku_id WHERE ss.store_id = ? AND ss.carried = 1 AND k.active = 1 AND k.category = \'beverage\' ORDER BY k.sort', [s.store_id]),
      })),
    };
  };
  r.get('/api/driver/:token', async (req, p) => routeView(driverRoute(p.token)), { public: true });
  const drvAct = (fn) => async (req, p) => {
    const route = driverRoute(p.token);
    const b = await readJson(req);
    try { fn(id(p.id), route, b, Date.now()); } catch (e) { throw new HttpError(409, e.message); }
    return routeView(route);
  };
  r.post('/api/driver/:token/stops/:id/arrive', drvAct((sid, route, b, now) => delivery.arrive(ctx, sid, { routeId: route.id, actor: 'driver' }, now)), { public: true });
  r.post('/api/driver/:token/stops/:id/complete', drvAct((sid, route, b, now) => delivery.complete(ctx, sid, { counts: b.counts || null, routeId: route.id, actor: 'driver' }, now)), { public: true });
  r.post('/api/driver/:token/stops/:id/fail', drvAct((sid, route, b, now) => delivery.fail(ctx, sid, { reason: str(b.reason, '실패 사유', { max: 100 }), routeId: route.id, actor: 'driver' }, now)), { public: true });

  // ── 외부: 점주 발주 화면 (/m/…) ─────────────────────────────
  const shopStore = (token) => {
    const st = shop.storeFromToken(ctx, token);
    if (!st) throw new HttpError(404, '링크가 만료됐어요. 카카오톡 채널에서 [발주하기]를 다시 눌러 주세요');
    return st;
  };
  const shopAct = (fn) => async (req, p) => {
    const st = shopStore(p.token);
    const b = await readJson(req, 64 << 10);
    try { await fn(st, b, Date.now()); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(409, e.message); }
    return shop.view(ctx, db.get('SELECT * FROM stores WHERE id = ?', [st.id]), Date.now());
  };
  r.get('/api/shop/:token', async (req, p) => {
    const st = shopStore(p.token);
    const now = Date.now();
    shop.markSheetSeen(ctx, st, now);
    return shop.view(ctx, st, now);
  }, { public: true });
  r.post('/api/shop/:token/sheet', shopAct((st, b, now) => shop.prepareSheet(ctx, st.id, now)), { public: true });
  r.put('/api/shop/:token/cart', shopAct((st, b, now) => {
    if (b.clear) return shop.clearCart(ctx, st.id);
    const items = b.items && typeof b.items === 'object' ? b.items : { [b.sku]: b.qty };
    if (Object.keys(items).length > 300) throw new HttpError(400, '품목이 너무 많습니다');
    db.tx(() => { for (const [sku, q] of Object.entries(items)) shop.setCart(ctx, st.id, String(sku), q, now); });
  }), { public: true });
  r.post('/api/shop/:token/reorder', shopAct((st, b, now) => shop.reorderToCart(ctx, st.id, now)), { public: true });
  r.post('/api/shop/:token/access', shopAct((st, b, now) => catalog.requestAccess(ctx, st.id, str(b.category, '품목', { max: 20 }), { via: 'web', note: str(b.note, '메모', { max: 200, required: false }) }, now)), { public: true });
  r.post('/api/shop/:token/order', async (req, p) => {
    const st = shopStore(p.token);
    const b = await readJson(req, 64 << 10);
    let out;
    try { out = await shop.submit(ctx, st.id, { items: b.items, source: 'web', ref: b.ref ? str(b.ref, 'ref', { max: 64 }) : null }, Date.now()); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(409, e.message); }
    const pr = out.proposal;
    return { order: { code: pr.code, status: pr.status, statusText: shop.statusText(pr, Date.now()), amount: pr.amount, deliverDate: pr.deliver_date, payMethod: pr.pay_method, payFailReason: pr.pay_fail_reason, duplicate: out.duplicate },
      view: shop.view(ctx, db.get('SELECT * FROM stores WHERE id = ?', [st.id]), Date.now()) };
  }, { public: true });

  // ── 외부: 카카오 (오픈빌더 스킬 · 매장 연결) ─────────────────────
  r.post('/api/kakao/skill', async (req, p, url) => {
    if (!kakao.checkSkillKey(ctx, req.headers['x-bevflow-skill-key'] || url.searchParams.get('key'))) throw new HttpError(401, '스킬 키가 올바르지 않습니다');
    const b = await readJson(req, 256 << 10);
    try { return await kakao.skill(ctx, b, Date.now()); } catch (e) {
      console.error('[카카오 스킬]', e);
      return { version: '2.0', template: { outputs: [{ simpleText: { text: '잠시 문제가 생겼어요. 조금 뒤 다시 시도해 주세요.' } }] } };
    }
  }, { public: true, noCsrf: true });
  r.get('/api/kakao/link-info', async (req, p, url) => ({ login: !!ctx.R.kakao_rest_key, t: !!url.searchParams.get('t'), l: !!url.searchParams.get('l') }), { public: true });
  r.post('/api/kakao/link', async (req) => {
    const b = await readJson(req, 8 << 10);
    try { return kakao.linkFromPage(ctx, { t: b.t, l: b.l, code: b.code }, req.ip, Date.now()); } catch (e) { throw new HttpError(409, e.message); }
  }, { public: true });

  r.get('/healthz', async () => ({ ok: true, version: db.version }), { public: true });
  return r;
}

module.exports = { buildRoutes, parseTime };
},

// ── server/settings.js ────────────────────────────────────────────────────
"server/settings.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 운영 설정 — DB에 저장되고 콘솔 [운영 설정]에서 바꾼다. 값마다 검증 규칙을 둔다.

const T = require('./time');

const SPEC = {
  // 운영 시간 규칙
  cutoff: { def: '12:00', type: 'time', label: '당일배송 컷오프' },
  dispatch: { def: '13:30', type: 'time', label: '출고·배차 시각' },
  delivery_days: { def: '1,2,3,4,5,6', type: 'days', label: '배송 요일 (0=일 … 6=토)' },
  night_start: { def: '21:00', type: 'time', label: '야간 발송 제한 시작' },
  night_end: { def: '09:00', type: 'time', label: '야간 발송 제한 종료 (이때 일괄 발송)' },
  break_from: { def: '11:00', type: 'time', label: '브레이크타임 예약 대상 시작' },
  break_to: { def: '14:30', type: 'time', label: '브레이크타임 예약 대상 종료' },
  break_send: { def: '15:00', type: 'time', label: '브레이크타임 발송 시각' },
  expire_hours: { def: 3, type: 'num', min: 0.5, max: 24, label: '무응답 만료 (시간)' },
  auto_remind_min: { def: 60, type: 'num', min: 0, max: 600, label: '자동 리마인드 (분, 0=끔)' },
  retry_at: { def: '10:00', type: 'time', label: '보류·만료 후 재제안 가능 시각 (다음 날)' },
  // 추정·발주 모델
  cover_days: { def: 7.6, type: 'num', min: 1, max: 30, label: '1회 발주로 채우는 기간 (일)' },
  lookahead_days: { def: 8, type: 'num', min: 0, max: 30, label: '묶음 발주 포함 기준 (N일 내 트리거 예상 SKU)' },
  safety_days: { def: 2.2, type: 'num', min: 0.5, max: 14, label: '안전재고 (일 판매량 × N일)' },
  band_w0: { def: 0.08, type: 'num', min: 0, max: 2, label: '오차 밴드 기본 폭 (박스)' },
  band_beta: { def: 0.10, type: 'num', min: 0, max: 1, label: '오차 밴드 증가율 (실사 후 판매량 대비)' },
  alpha_lr: { def: 0.35, type: 'num', min: 0, max: 1, label: '누수 보정 학습률' },
  default_rate: { def: 0.15, type: 'num', min: 0, max: 20, label: '판매 이력이 없을 때 기본 일 판매량 (박스)' },
  // 배송
  driver_capacity: { def: 60, type: 'num', min: 1, max: 500, label: '기사 1인 1일 설계 용량 (곳)' },
  drive_min: { def: 12, type: 'num', min: 1, max: 120, label: 'ETA 계산용 정차 간 이동 (분)' },
  stop_min: { def: 7, type: 'num', min: 1, max: 60, label: 'ETA 계산용 정차 시간 (분)' },
  // 정산
  fee_rate: { def: 0.03, type: 'num', min: 0, max: 0.5, label: '티오더 수수료율' },
  settle_lag_days: { def: 7, type: 'num', min: 0, max: 60, label: '주간 마감 후 지급까지 (일)' },
  pilot_start: { def: '', type: 'date', label: '파일럿 시작일' },
  // 지표 목표
  target_approval: { def: 85, type: 'num', min: 0, max: 100, label: '목표 승인율 (%)' },
  target_stop: { def: 7, type: 'num', min: 0, max: 60, label: '목표 평균 정차 (분)' },
  target_error: { def: 10, type: 'num', min: 0, max: 100, label: '목표 재고 추정 오차 (%)' },
  // 연동
  pay_method: { def: 'invoice', type: 'enum', values: ['invoice', 'sandbox_card'], label: '결제 방식' },
  notifier: { def: 'console', type: 'enum', values: ['console', 'webhook'], label: '알림 발송 방식' },
  webhook_url: { def: '', type: 'url', label: '알림 웹훅 URL (webhook 방식)' },
  public_base_url: { def: 'http://localhost:8080', type: 'url', label: '외부 접속 주소 (사장님·기사 링크)' },
  sample_data: { def: 0, type: 'num', min: 0, max: 1, label: '샘플 데이터 여부' },
  // 점주 직접 발주 · 카카오
  order_min_amount: { def: 30000, type: 'num', min: 0, max: 10000000, label: '최소 발주 금액 (원)' },
  order_link_hours: { def: 24, type: 'num', min: 1, max: 720, label: '발주 화면 링크 유효 시간 (시간)' },
  kakao_rest_key: { def: '', type: 'text', re: /^[A-Za-z0-9]{0,64}$/, label: '카카오 REST API 키 (카카오 로그인)' },
  kakao_channel_id: { def: '', type: 'text', re: /^(_[A-Za-z0-9]{2,20})?$/, label: '카카오톡 채널 ID (예: _xaBcD)' },
  kakao_block_id: { def: '', type: 'text', re: /^[a-f0-9]{0,40}$/, label: '오픈빌더 발주 블록 ID' },
  sheet_time: { def: '09:00', type: 'time', label: '정기 발주서 준비 시각' },
  alert_unconfirmed: { def: '11:30', type: 'time', label: '관리자 알림: 미확정 발주서' },
  alert_pick: { def: '11:50', type: 'time', label: '관리자 알림: 오늘 출고 합계' },
  alert_delivery: { def: '18:00', type: 'time', label: '관리자 알림: 배송 결과' },
};

function validate(key, v) {
  const s = SPEC[key];
  if (!s) throw new Error('알 수 없는 설정: ' + key);
  switch (s.type) {
    case 'time': T.hhmm(v); return String(v);
    case 'days': T.parseDays(v); return String(v);
    case 'date': if (v !== '') T.parseDate(v); return String(v);
    case 'num': {
      const n = Number(v);
      if (!Number.isFinite(n) || n < s.min || n > s.max) throw new Error(`${s.label}: ${s.min}~${s.max} 범위의 숫자여야 합니다`);
      return n;
    }
    case 'enum': if (!s.values.includes(v)) throw new Error(`${s.label}: ${s.values.join(', ')} 중 하나`); return v;
    case 'text': if (!s.re.test(String(v))) throw new Error(`${s.label}: 형식이 올바르지 않습니다`); return String(v);
    case 'url': if (v !== '' && !/^https?:\/\/[^\s]+$/.test(String(v))) throw new Error(`${s.label}: http(s):// 로 시작하는 주소`); return String(v).replace(/\/+$/, '');
    default: return v;
  }
}

function load(db) {
  const out = {};
  for (const [k, s] of Object.entries(SPEC)) out[k] = s.def;
  for (const r of db.all('SELECT key, value FROM settings')) {
    if (SPEC[r.key]) out[r.key] = JSON.parse(r.value);
  }
  if (!out.pilot_start) out.pilot_start = T.dateStr(Date.now());
  return out;
}

function save(db, patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) clean[k] = validate(k, v);
  db.tx(() => {
    for (const [k, v] of Object.entries(clean)) {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
    }
  });
  return load(db);
}

/** 계산에 쓰기 좋게 파싱한 규칙 묶음 */
function rules(s) {
  return {
    ...s,
    cutoffH: T.hhmm(s.cutoff), dispatchH: T.hhmm(s.dispatch), days: T.parseDays(s.delivery_days),
    nightStartH: T.hhmm(s.night_start), nightEndH: T.hhmm(s.night_end),
    breakFromH: T.hhmm(s.break_from), breakToH: T.hhmm(s.break_to), breakSendH: T.hhmm(s.break_send),
    retryH: T.hhmm(s.retry_at), pilotStart: T.parseDate(s.pilot_start),
    sheetH: T.hhmm(s.sheet_time), unconfirmedH: T.hhmm(s.alert_unconfirmed), pickH: T.hhmm(s.alert_pick), deliveryAlertH: T.hhmm(s.alert_delivery),
  };
}

module.exports = { SPEC, load, save, rules, validate };
},

// ── server/time.js ────────────────────────────────────────────────────────
"server/time.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 한국 표준시(KST, UTC+9, 서머타임 없음) 기준 시간 계산 도우미
// 모든 타임스탬프는 epoch 밀리초로 저장하고, 운영 규칙(컷오프·배차·야간 발송)은 KST로 판단한다.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const KST = 9 * HOUR;

/** ts가 속한 KST 날짜의 0시 (epoch ms) */
function kstMidnight(ts) {
  return Math.floor((ts + KST) / DAY) * DAY - KST;
}

/** KST 기준 시각을 소수 시간으로 (예: 14:30 → 14.5) */
function kstHour(ts) {
  return (ts - kstMidnight(ts)) / HOUR;
}

/** KST 요일 (0=일 … 6=토) */
function kstDow(ts) {
  return new Date(ts + KST).getUTCDay();
}

/** 'YYYY-MM-DD' (KST) */
function dateStr(ts) {
  const d = new Date(ts + KST);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

/** 'YYYY-MM-DD' → 그날 KST 0시 */
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw new Error('날짜 형식은 YYYY-MM-DD 입니다: ' + s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) - KST;
}

/** 'HH:MM' → 소수 시간 */
function hhmm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) throw new Error('시각 형식은 HH:MM 입니다: ' + s);
  const h = +m[1], mi = +m[2];
  if (h > 24 || mi > 59) throw new Error('잘못된 시각: ' + s);
  return h + mi / 60;
}

/** 특정 KST 날짜(0시 ts)의 hour시 */
function at(midnight, hour) {
  return midnight + hour * HOUR;
}

/** 'HH:MM' 표기 (KST) */
function fmtTime(ts) {
  const m = Math.floor(kstHour(ts) * 60 + 1e-6);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** 배송 요일 집합 (예: '1,2,3,4,5,6' = 월~토) */
function parseDays(s) {
  const set = new Set(String(s || '').split(',').map((x) => +x.trim()).filter((x) => x >= 0 && x <= 6));
  if (!set.size) throw new Error('배송 요일이 비어 있습니다');
  return set;
}

/** fromMidnight 이후(포함 여부 선택) 첫 배송일의 0시 */
function nextDeliveryDay(fromMidnight, days, includeSelf) {
  let d = includeSelf ? fromMidnight : fromMidnight + DAY;
  for (let i = 0; i < 8; i++) {
    if (days.has(kstDow(d + HOUR))) return d;
    d += DAY;
  }
  return d;
}

module.exports = { HOUR, DAY, KST, kstMidnight, kstHour, kstDow, dateStr, parseDate, hhmm, at, fmtTime, parseDays, nextDeliveryDay };
},

// ── server/tokens.js ──────────────────────────────────────────────────────
"server/tokens.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 서명 링크 토큰 — 로그인 없이 쓰는 사장님 승인 링크(/o/…)와 기사 배송 링크(/d/…)
// 형식: base64url(JSON) + '.' + base64url(HMAC-SHA256). DB의 nonce와 대조하므로 재발급하면 이전 링크는 무효.

const crypto = require('node:crypto');

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function sign(secret, payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest();
  return body + '.' + b64(mac);
}

/** 서명·만료를 확인한 payload, 아니면 null */
function verify(secret, token, kind, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = crypto.createHmac('sha256', secret).update(body).digest();
  let given;
  try { given = Buffer.from(mac, 'base64url'); } catch { return null; }
  if (given.length !== expect.length || !crypto.timingSafeEqual(given, expect)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.k !== kind || typeof p.id !== 'number' || typeof p.e !== 'number' || p.e < now) return null;
  return p;
}

const nonce = () => crypto.randomBytes(9).toString('base64url');

module.exports = { sign, verify, nonce };
},

// ── scripts/seed-sample.js ────────────────────────────────────────────────
"scripts/seed-sample.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 샘플 데이터 생성기 — 실제 운영 엔진에 가상의 POS 판매·사장님 응답·기사 실사를 흘려 넣어 파일럿 N주를 재현한다.
// 운영 전 교육·점검용. 실데이터를 넣기 전에 콘솔 [관리 → 데이터 연동]에서 '샘플 삭제'로 지울 수 있다.
//
//   node --disable-warning=ExperimentalWarning scripts/seed-sample.js [--db data/bevflow.db] [--weeks 6] [--force]

const path = require('node:path');
const fs = require('node:fs');
const { createContext } = require('../server/context');
const settings = require('../server/settings');
const T = require('../server/time');
const inv = require('../server/engine/inventory');
const orders = require('../server/engine/orders');
const delivery = require('../server/engine/delivery');
const jobs = require('../server/jobs');
const props = require('../server/engine/proposals');
const settlement = require('../server/engine/settlement');
const catalog = require('../server/engine/catalog');
const shop = require('../server/engine/shop');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = opt('db', process.env.BEVFLOW_DB || path.join(__dirname, '..', 'data', 'bevflow.db'));
const WEEKS = Number(opt('weeks', 6));
const FORCE = args.includes('--force');

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R0 = mulberry32(20260923);
const U = (a, b) => a + (b - a) * R0();
const N = () => { let u = 0; for (let i = 0; i < 6; i++) u += R0(); return (u - 3) / Math.sqrt(0.5); };
const pois = (l) => { if (l <= 0) return 0; const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= R0(); } while (p > L); return k - 1; };

const SKUS = [
  ['CL125', '콜라 1.25L', 12, '병', 22800, .20], ['ZC125', '제로콜라 1.25L', 12, '병', 22800, .12], ['CL355', '콜라 355ml 캔', 24, '캔', 21600, .08],
  ['SD150', '사이다 1.5L', 12, '병', 22200, .16], ['SD355', '사이다 355ml 캔', 24, '캔', 20400, .06], ['SP500', '탄산수 500ml', 20, '병', 17600, .05],
  ['WT200', '생수 2L', 12, '병', 11400, .07], ['WT050', '생수 500ml', 40, '병', 15600, .06], ['IO500', '이온음료 500ml', 20, '병', 24000, .05],
  ['CF275', '캔커피 275ml', 24, '캔', 26400, .05], ['BT500', '보리차 500ml', 20, '병', 19800, .04], ['OJ150', '오렌지주스 1.5L', 12, '병', 29400, .06],
];
const REGIONS = [
  ['GN', '강남권', '강남·역삼·선릉·논현', '역삼 거점', 37.5007, 127.0365, '김도윤', '1톤 탑차 · 서울 88바 4127'],
  ['MP', '마포권', '합정·망원·연남·서교', '합정 거점', 37.5496, 126.9139, '이서준', '1톤 탑차 · 서울 88바 4133'],
  ['SS', '성수권', '성수·뚝섬·서울숲·건대', '성수 거점', 37.5446, 127.0557, '박지훈', '1톤 탑차 · 서울 88바 4150'],
];
const NAMES = {
  GN: [['역삼 달빛포차', 'D'], ['강남 한솥밥상', 'L'], ['선릉 우리고깃간', 'D'], ['논현 온기국밥', 'L'], ['역삼 소담식당', 'L'], ['강남 불꽃닭갈비', 'D'], ['신논현 바다횟집', 'D'], ['선릉 모퉁이분식', 'L'], ['역삼 유월이자카야', 'D'], ['논현 가마솥순대국', 'L'], ['강남 두레치킨', 'D'], ['역삼 한마당곱창', 'D'], ['선릉 봄날칼국수', 'L'], ['논현 연탄구이집', 'D'], ['강남 골목포차', 'D'], ['신논현 참숯갈비', 'D'], ['역삼 다올김밥', 'L'], ['선릉 새벽해장국', 'L']],
  MP: [['합정 오늘포차', 'D'], ['망원 시장국수', 'L'], ['연남 초록식탁', 'L'], ['서교 마포갈매기', 'D'], ['상수 손두부집', 'L'], ['합정 불타는곱창', 'D'], ['망원 한그릇덮밥', 'L'], ['연남 달보드레주점', 'D'], ['서교 원조족발', 'D'], ['상수 소금구이', 'D'], ['합정 동네치킨', 'D'], ['망원 골목쌈밥', 'L'], ['연남 이모네포차', 'D'], ['서교 노을횟집', 'D'], ['합정 바른국밥', 'L'], ['망원 옛날통닭', 'D']],
  SS: [['성수 공장식당', 'L'], ['뚝섬 강변포차', 'D'], ['성수 붉은곱창', 'D'], ['서울숲 숲속밥상', 'L'], ['건대 양꼬치집', 'D'], ['성수 철길포차', 'D'], ['뚝섬 뚝배기집', 'L'], ['건대 청춘포차', 'D'], ['성수 한옥곰탕', 'L'], ['서울숲 초원파스타', 'L'], ['건대 불막창', 'D'], ['성수 골목칼국수', 'L'], ['뚝섬 나루횟집', 'D'], ['건대 일미닭갈비', 'D'], ['성수 모락모락만두', 'L'], ['서울숲 소반식당', 'L']],
};
const PROFILE = {
  L: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, .02, .14, .20, .12, .04, .02, .03, .10, .14, .11, .06, .02, 0, 0],
  D: [.03, .01, 0, 0, 0, 0, 0, 0, 0, 0, 0, .02, .04, .02, 0, 0, .02, .07, .13, .17, .17, .14, .10, .08],
};
// 카페·사우나 스낵 품목 (점주가 카카오톡·발주 화면으로 직접 발주)
// 카페·사우나 품목 (점주가 카카오톡·발주 화면으로 직접 발주) — [코드, 품목, 입수, 단위, 단가, 구분, 규격, 매대·소분류]
const EXTRA_SKUS = [
  ['CB1KG', '원두 하우스 블렌드 1kg', 1, '봉', 26000, 'cafe', '1kg × 1봉', '원두'], ['CBDEC', '디카페인 원두 1kg', 1, '봉', 32000, 'cafe', '1kg × 1봉', '원두'],
  ['CBETH', '에티오피아 싱글오리진 1kg', 1, '봉', 38000, 'cafe', '1kg × 1봉', '원두'], ['DRIPB', '드립백 커피', 50, '개', 29000, 'cafe', '10g × 50개', '원두'],
  ['MK1L', '우유 1L', 12, '팩', 30000, 'cafe', '1L × 12팩', '우유·대체유'], ['OMK1L', '오트 음료 1L', 6, '팩', 21000, 'cafe', '1L × 6팩', '우유·대체유'],
  ['CREAM', '생크림 1L', 6, '팩', 42000, 'cafe', '1L × 6팩', '우유·대체유'], ['SYVAN', '바닐라 시럽 1L', 1, '병', 13500, 'cafe', '1L × 1병', '시럽·소스'],
  ['SYHAZ', '헤이즐넛 시럽 1L', 1, '병', 13500, 'cafe', '1L × 1병', '시럽·소스'], ['SCCAR', '카라멜 소스 1.9kg', 1, '통', 18000, 'cafe', '1.9kg × 1통', '시럽·소스'],
  ['PWCHO', '초코 파우더 1kg', 1, '봉', 16000, 'cafe', '1kg × 1봉', '파우더'], ['PWMAT', '녹차 파우더 500g', 1, '봉', 19000, 'cafe', '500g × 1봉', '파우더'],
  ['CUP16', '아이스컵 16oz', 1000, '개', 52000, 'cafe', '16oz · 1,000개', '컵·뚜껑'], ['CUPH13', '핫컵 13oz', 1000, '개', 49000, 'cafe', '13oz · 1,000개', '컵·뚜껑'],
  ['LID16', '돔 뚜껑 16oz', 1000, '개', 24000, 'cafe', '1,000개', '컵·뚜껑'], ['STRAW', '종이 빨대', 5000, '개', 38000, 'cafe', '5,000개', '컵·뚜껑'],
];
// 사우나 매점 스낵 42종 — 매대 순서(냉장고 → 냉동고 → 온장고 → 과자 매대 → 안주 → 소모품)대로 정렬
const SNACK = [
  ['냉장고 ① 음료', [['SIKHE', '식혜 240ml 캔', 30, '캔', 21000], ['SUJEONG', '수정과 240ml 캔', 30, '캔', 22000], ['MILKBN', '바나나맛 우유 240ml', 24, '개', 26400], ['MILKST', '딸기맛 우유 240ml', 24, '개', 26400],
    ['MILKCF', '커피 우유 240ml', 24, '개', 26400], ['ION500', '이온음료 500ml', 20, '병', 24000], ['WTR500', '생수 500ml', 40, '병', 15600], ['SPK500', '탄산수 500ml', 20, '병', 17600], ['VITA', '비타민 음료 100ml', 30, '병', 21000]]],
  ['냉동고 · 아이스', [['ICETB', '튜브 아이스크림', 40, '개', 24000], ['ICEBAR', '바 아이스크림', 40, '개', 26000], ['ICECN', '콘 아이스크림', 24, '개', 28800], ['ICEBS', '빙수컵', 12, '개', 30000], ['SLUSH', '식혜 슬러시', 30, '개', 27000]]],
  ['온장고 · 즉석', [['EGGBK', '맥반석 구운란', 30, '개', 15000], ['EGGSM', '훈제란', 30, '개', 16500], ['RAMEN', '컵라면 (소)', 30, '개', 24000], ['RAMENL', '컵라면 (대)', 16, '개', 22400],
    ['TTEOK', '떡볶이 컵', 12, '개', 21600], ['RICE', '즉석밥 210g', 24, '개', 25200], ['HOTBAR', '핫바', 30, '개', 27000]]],
  ['과자 매대', [['CHIPS', '감자칩 60g', 20, '봉', 22000], ['SHRIMP', '새우 과자 90g', 20, '봉', 24000], ['CORN', '옥수수 과자 70g', 20, '봉', 22000], ['CHOPIE', '초코 파이 12입', 8, '곽', 36000],
    ['COOKIE', '버터 쿠키', 20, '봉', 26000], ['CRACK', '크래커', 24, '봉', 21600], ['ONION', '양파링', 20, '봉', 22000], ['JELLY', '젤리 50g', 30, '봉', 24000], ['CANDY', '목캔디', 30, '개', 18000],
    ['GUM', '껌', 30, '개', 19500], ['CHOBAR', '초코바', 36, '개', 30000]]],
  ['안주 · 간식', [['JERKY', '오징어 땅콩', 30, '봉', 27000], ['JWIPO', '쥐포', 20, '봉', 30000], ['BEEFJ', '육포 30g', 20, '봉', 36000], ['NUTS', '견과 믹스', 30, '봉', 33000], ['SQUID', '맥반석 오징어', 20, '봉', 32000]]],
  ['소모품', [['PCUP', '종이컵 6.5oz', 1000, '개', 18000], ['CHOPS', '나무젓가락', 1000, '개', 14000], ['NAPKIN', '냅킨', 5000, '매', 19000], ['BAGS', '비닐봉투 (소)', 1000, '장', 12000], ['BAR30', '에너지바', 36, '개', 30000]]],
];
SNACK.forEach(([grp, list]) => list.forEach(([id, name, pack, unit, price]) => EXTRA_SKUS.push([id, name, pack, unit, price, 'snack', pack === 1 ? '' : `${pack}${unit}`, grp])));
const SAUNA_BASKET = (drop) => SNACK.flatMap(([, list]) => list.map(([id]) => id)).filter((id, i) => i % drop !== 0);
const OWNER_STORES = [
  ['GN', 'GN-C1', '역삼 모닝브루 카페', 'cafe', ['CB1KG', 'MK1L', 'CUP16', 'LID16', 'SYVAN', 'STRAW']],
  ['MP', 'MP-C1', '연남 오후세시 커피', 'cafe', ['CB1KG', 'CBDEC', 'MK1L', 'OMK1L', 'STRAW', 'SYHAZ']],
  ['SS', 'SS-C1', '성수 로스터리 공방', 'cafe', ['CB1KG', 'CBETH', 'MK1L', 'CUP16', 'CUPH13']],
  ['GN', 'GN-S1', '강남 한빛 사우나', 'sauna', SAUNA_BASKET(4)],
  ['MP', 'MP-S1', '망원 황토 찜질방', 'sauna', SAUNA_BASKET(3)],
  ['SS', 'SS-S1', '뚝섬 온천 사우나', 'sauna', SAUNA_BASKET(5)],
];
const WEEK_APPROVAL = [.83, .865, .89, .905, .918, .925, .925, .93];
const WEEK_STOP = [8.4, 7.8, 7.35, 7.05, 6.9, 6.78, 6.7, 6.6];

async function main() {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const ctx = createContext({ file, env: process.env });
  const { db } = ctx;
  if (db.get('SELECT 1 FROM stores LIMIT 1') && !FORCE) {
    console.error('이미 매장 데이터가 있습니다. 덮어쓰려면 --force (기존 운영 데이터가 삭제됩니다)');
    process.exit(1);
  }
  const now = Date.now();
  const startMid = T.kstMidnight(now) - (WEEKS * 7 - 1) * T.DAY;
  db.tx(() => {
    for (const t of ['carts', 'kakao_links', 'store_categories', 'events', 'stops', 'routes', 'messages', 'proposal_lines', 'proposals', 'counts', 'inv_snapshots', 'pos_sale_items', 'pos_sales', 'unmapped_menu', 'menu_map', 'store_skus', 'stores', 'drivers', 'regions', 'skus', 'settlements']) db.run(`DELETE FROM ${t}`);
  });
  settings.save(db, { pilot_start: T.dateStr(startMid + T.HOUR), sample_data: 1 });
  ctx.reload();

  // ── 마스터 데이터 ──
  SKUS.forEach(([id, name, pack, unit, price], i) => db.run('INSERT INTO skus (id, name, pack, unit, price, sort) VALUES (?, ?, ?, ?, ?, ?)', [id, name, pack, unit, price, i]));
  const SKU = Object.fromEntries(SKUS.map((s) => [s[0], { id: s[0], name: s[1], pack: s[2], price: s[4], w: s[5] }]));
  REGIONS.forEach(([id, name, area, hub, lat, lng, driver, vehicle], i) => {
    db.run('INSERT INTO regions (id, name, area, hub_name, hub_lat, hub_lng, radius_km, sort) VALUES (?, ?, ?, ?, ?, ?, 3, ?)', [id, name, area, hub, lat, lng, i]);
    db.run('INSERT INTO drivers (name, phone, region_id, vehicle, capacity) VALUES (?, ?, ?, ?, 60)', [driver, `010-0000-90${String(i + 1).padStart(2, '0')}`, id, vehicle]);
  });
  for (const s of SKUS) db.run('INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (NULL, ?, ?, 1)', [s[1], s[0]]);
  db.run("INSERT INTO menu_map (store_id, menu_name, sku_id, units) VALUES (NULL, '점심세트(콜라캔 포함)', 'CL355', 1)");

  const sim = [];
  let phoneSeq = 1;
  for (const [rid, , , , hlat, hlng] of REGIONS) {
    NAMES[rid].forEach(([name, type], i) => {
      const f = U(.72, 1.3);
      const others = SKUS.filter((s) => s[0] !== 'CL125' && s[0] !== 'SD150')
        .map((s) => ({ s, k: R0() * s[5] * (type === 'D' ? (/콜라|사이다|탄산/.test(s[1]) ? 1.8 : 1) : (/생수|보리|커피|이온/.test(s[1]) ? 1.8 : 1)) }))
        .sort((a, b) => b.k - a.k).slice(0, 4 + Math.floor(R0() * 3)).map((x) => x.s[0]);
      const set = ['CL125', 'SD150', ...others];
      const ang = U(0, Math.PI * 2), rad = U(.3, .93) * 3;
      const code = `${rid}-${String(i + 1).padStart(2, '0')}`;
      const review = name === '서교 원조족발';
      const r = db.run(`INSERT INTO stores (code, name, region_id, type, owner_name, owner_phone, address, lat, lng, pos_store_id, send_pref, review_required, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, name, rid, type, '', `010-0000-${String(phoneSeq++).padStart(4, '0')}`, `(샘플 주소) ${name.split(' ')[0]}동`, hlat + Math.sin(ang) * rad / 111, hlng + Math.cos(ang) * rad / 88.2,
        'TO-' + code, type === 'L' && R0() < .55 ? 'break' : 'immediate', review ? 1 : 0, startMid]);
      const sid = Number(r.lastInsertRowid);
      const lam = review ? .22 : U(.06, .18);
      const wsum = set.reduce((a, k) => a + SKU[k].w, 0);
      const avgPrice = set.reduce((a, k) => a + SKU[k].w * SKU[k].price, 0) / wsum;
      const posPerDay = 800000 * .965 * f / (30.4 * avgPrice) / (1 + lam);
      const items = {};
      for (const k of set) {
        const rate = posPerDay * SKU[k].w / wsum;
        db.run('INSERT INTO store_skus (store_id, sku_id, rate_manual) VALUES (?, ?, ?)', [sid, k, Math.round(rate * 100) / 100]);
        items[k] = { rate, true: 0 };
      }
      sim.push({ sid, name, type, lam, offset: U(-.13, .07), items, review });
    });
  }

  // ── 카페·사우나 (점주 직접 발주 매장 · 별도 난수로 기존 시뮬레이션과 독립) ──
  const R1 = mulberry32(777);
  EXTRA_SKUS.forEach(([id, name, pack, unit, price, category, spec, grp], i) => db.run('INSERT INTO skus (id, name, pack, unit, price, sort, category, spec, grp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, name, pack, unit, price, 100 + i, category, spec, grp]));
  const owners = [];
  for (const [rid, code, name, biz, basket] of OWNER_STORES) {
    const [, , , , hlat, hlng] = REGIONS.find((x) => x[0] === rid);
    const ang = R1() * Math.PI * 2, rad = (.3 + R1() * .6) * 3;
    const r = db.run(`INSERT INTO stores (code, name, region_id, type, biz, standing_days, owner_name, owner_phone, address, lat, lng, created_at) VALUES (?, ?, ?, 'L', ?, ?, '', ?, ?, ?, ?, ?)`,
      [code, name, rid, biz, biz === 'sauna' ? '1,4' : '', `010-0000-${String(phoneSeq++).padStart(4, '0')}`, `(샘플 주소) ${name.split(' ')[0]}동`, hlat + Math.sin(ang) * rad / 111, hlng + Math.cos(ang) * rad / 88.2, startMid]);
    const sid = Number(r.lastInsertRowid);
    catalog.ensureDefault(db, { id: sid, biz }, 'sample', startMid);
    // 사우나는 첫 발주만 직접 하고, 이후에는 월·목 정기 발주서(스케줄러가 준비)를 고쳐서 확정한다
    owners.push({ sid, biz, basket, next: startMid + (1 + R1() * 2) * T.DAY + (9 + R1() * 2) * T.HOUR, every: biz === 'cafe' ? 3.5 : 1e9, sheetDay: null, delay: (20 + R1() * 120) * 60e3 });
  }
  // 품목 이용 신청 예시: 사우나 1곳은 음료 승인, 카페·사우나 1곳씩 승인 대기
  catalog.decide(ctx, owners[3].sid, 'beverage', 'approve', { actor: 'sample', note: '매점 음료 함께 공급' }, startMid + 2 * T.DAY);
  owners[3].basket.push('SD355', 'WT050');

  // ── 초기 실사 (파일럿 시작일 10시) ──
  const t0 = startMid + 10 * T.HOUR;
  for (const s of sim) {
    const phase = U(.2, 1);
    const counts = {};
    for (const [k, it] of Object.entries(s.items)) {
      const S = Math.max(.25, Math.ceil(it.rate * 2.2 * 4) / 4);
      it.true = Math.round((S + .1 + it.rate * 1.2 * 7.6 * phase * U(.9, 1.15)) * SKU[k].pack) / SKU[k].pack;
      counts[k] = it.true;
    }
    inv.recordCount(ctx, s.sid, counts, '샘플', t0, true);
  }

  // ── 시뮬레이션 루프 (15분 단위) ──
  const plan = new Map(); // 사장님 응답 계획
  const doneStop = new Set();
  const STEP = 15 * 60e3;
  let saleSeq = 0;
  const weekOf = (t) => Math.min(WEEK_APPROVAL.length - 1, Math.floor((t - startMid) / (7 * T.DAY)));
  const started = Date.now();
  for (let t = t0; t < now; t += STEP) {
    const h = Math.floor(T.kstHour(t));
    // 1) POS 판매
    for (const s of sim) {
      if (s._d !== T.kstMidnight(t)) { s._d = T.kstMidnight(t); s._dn = U(.78, 1.22); for (const it of Object.values(s.items)) it.ld = s.lam * Math.exp(.8 * N() - .32); }
      const prof = PROFILE[s.type][h];
      if (!prof) continue;
      const store = db.get('SELECT * FROM stores WHERE id = ?', [s.sid]);
      for (const [k, it] of Object.entries(s.items)) {
        const mu = it.rate * SKU[k].pack * prof / 4 * s._dn;
        let q = pois(mu);
        const extra = pois(mu * it.ld);
        const avail = Math.floor(it.true * SKU[k].pack + 1e-6);
        q = Math.min(q, avail);
        const ex = Math.max(0, Math.min(extra, avail - q));
        it.true = Math.max(0, it.true - (q + ex) / SKU[k].pack);
        if (q > 0) {
          const menu = k === 'CL355' && R0() < .3 ? '점심세트(콜라캔 포함)' : SKU[k].name;
          inv.applySale(ctx, store, { ext_id: 'S' + (++saleSeq), sold_at: t + Math.floor(R0() * STEP), menu, qty: q }, t + STEP);
        }
      }
      if (s.name === '연남 이모네포차' && prof > .1 && R0() < .3) inv.applySale(ctx, store, { ext_id: 'S' + (++saleSeq), sold_at: t, menu: '음료 무한리필', qty: 1 }, t + STEP);
    }
    // 1-1) 카페·사우나 점주 직접 발주 (카카오톡 채팅 또는 발주 화면)
    for (const o of owners) {
      // 사우나: 오늘 발주서가 준비됐으면 몇 군데 고쳐서 확정 (마지막 날 망원 황토 찜질방은 미확정으로 남겨 관리자 알림 예시로)
      const sst = o.biz === 'sauna' ? db.get('SELECT sheet_at FROM stores WHERE id = ?', [o.sid]) : null;
      if (sst && sst.sheet_at && sst.sheet_at >= T.kstMidnight(t) && o.sheetDay !== T.dateStr(t) && t >= sst.sheet_at + o.delay && t < now) {
        o.sheetDay = T.dateStr(t);
        o.delay = (20 + R1() * 120) * 60e3;
        if (!(o === owners[4] && T.dateStr(t) === T.dateStr(now))) {
          const items = Object.fromEntries(db.all('SELECT sku_id, qty FROM carts WHERE store_id = ?', [o.sid]).map((c) => [c.sku_id, c.qty]));
          for (let k = 0; k < 3; k++) { const id = o.basket[Math.floor(R1() * o.basket.length)]; items[id] = Math.max(0, (items[id] || 0) + (R1() < .6 ? 1 : -1)); }
          try { await shop.submit(ctx, o.sid, { items, source: R1() < .5 ? 'chat' : 'web' }, t); } catch { /* 최소 금액 미달 등은 건너뜀 */ }
        }
      }
      if (o.next > t + STEP || o.next >= now) continue;
      const items = {};
      for (const k of o.basket) if (R1() < (o.biz === 'sauna' ? .95 : .8)) items[k] = 1 + Math.floor(R1() * 3);
      if (Object.keys(items).length) {
        try { await shop.submit(ctx, o.sid, { items, source: R1() < .6 ? 'chat' : 'web' }, o.next); } catch { /* 최소 금액 미달 등은 건너뜀 */ }
      }
      o.next += o.every * T.DAY * (.8 + R1() * .4);
      o.next = T.kstMidnight(o.next) + (9 + R1() * 2.5) * T.HOUR;
    }
    // 2) 스케줄러 (트리거·발송·만료·배차·스냅샷)
    await jobs.tick(ctx, t);
    // 2-1) 운영자 검수: 검수 대상 매장의 제안은 30~60분 뒤(업무 시간) 발송
    for (const p of db.all("SELECT * FROM proposals WHERE status = 'created' AND review = 1")) {
      const h2 = T.kstHour(t);
      if (h2 >= 9 && h2 < 21 && t - p.created_at >= U(30, 60) * 60e3) props.sendNow(ctx, p.id, 'ops:sample', t);
    }
    // 3) 사장님 응답
    for (const p of db.all("SELECT * FROM proposals WHERE status = 'sent' AND responded_at IS NULL")) {
      const s = sim.find((x) => x.sid === p.store_id);
      if (!plan.has(p.id)) {
        const sh = T.kstHour(p.sent_at);
        const lunch = sh >= 11.5 && sh < 14, dinner = sh >= 18 && sh < 21;
        const openAt = p.sent_at + Math.exp(Math.log(lunch ? 48 : dinner ? 18 : 5) + .9 * N()) * 60e3;
        const pA = Math.min(.985, Math.max(.45, WEEK_APPROVAL[weekOf(t)] + s.offset + (p.send_rule === 'break' ? .03 : 0) - (lunch || dinner ? .04 : 0)));
        const u = R0();
        plan.set(p.id, { openAt, at: openAt + Math.exp(Math.log(3.5) + .8 * N()) * 60e3, d: u < pA ? 'approve' : R0() < .6 ? 'hold' : 'none', modify: R0() < .1 });
      }
      const pl = plan.get(p.id);
      if (pl.openAt <= t + STEP) orders.markOpened(ctx, p.id, Math.min(pl.openAt, t + STEP));
      if (pl.d !== 'none' && pl.at <= t + STEP && pl.at < now) {
        const at = Math.max(pl.at, p.sent_at + 60e3);
        if (pl.d === 'approve') {
          let qty = null;
          if (pl.modify) { const l = db.get('SELECT sku_id, qty FROM proposal_lines WHERE proposal_id = ? AND trig = 1', [p.id]); qty = { [l.sku_id]: Math.max(1, l.qty + (R0() < .5 ? -1 : 1)) }; }
          await orders.approve(ctx, p.id, { qty, actor: 'owner' }, at);
        } else orders.hold(ctx, p.id, { actor: 'owner' }, at);
      }
    }
    // 4) 기사 도착·하차 (하차 전 잔량 실사)
    for (const st of db.all("SELECT * FROM stops WHERE status IN ('pending','arrived') AND eta <= ?", [t + STEP])) {
      if (doneStop.has(st.id)) continue;
      const s = sim.find((x) => x.sid === st.store_id) || null; // 점주 직접 발주 매장은 재고 시뮬레이션 없음
      const boxes = st.boxes;
      const dur = Math.max(3.2, Math.min(14, WEEK_STOP[weekOf(st.eta)] * Math.exp(.17 * N()) + (boxes - 8.6) * .22));
      const arriveAt = st.eta + Math.floor(U(-4, 6) * 60e3);
      const doneAt = arriveAt + dur * 60e3;
      if (doneAt > now) { if (st.status === 'pending' && arriveAt <= now) delivery.arrive(ctx, st.id, { actor: 'driver' }, arriveAt); continue; }
      if (st.status === 'pending') delivery.arrive(ctx, st.id, { actor: 'driver' }, arriveAt);
      const counts = {};
      if (s) for (const [k, it] of Object.entries(s.items)) counts[k] = Math.round(it.true * SKU[k].pack) / SKU[k].pack;
      delivery.complete(ctx, st.id, { counts, actor: 'driver' }, doneAt);
      if (s) for (const l of db.all('SELECT sku_id, qty FROM proposal_lines WHERE proposal_id = ?', [st.proposal_id])) if (s.items[l.sku_id]) s.items[l.sku_id].true += l.qty;
      doneStop.add(st.id);
    }
  }
  await jobs.tick(ctx, now);
  catalog.requestAccess(ctx, owners[1].sid, 'snack', { via: 'chat', note: '디저트용 과자류도 받고 싶어요' }, now - 3 * T.HOUR);
  catalog.requestAccess(ctx, owners[4].sid, 'cafe', { via: 'web', note: '매점에서 아이스커피 판매 예정' }, now - 50 * 60e3);
  // 지급일이 지난 주차는 지급 완료로 표시
  for (const w of settlement.weeks(ctx, now)) if (w.status === 'closed' && T.parseDate(w.pay_date) < T.kstMidnight(now)) settlement.markPaid(ctx, w.start, 'sample', T.parseDate(w.pay_date) + 10 * T.HOUR);
  const n = (sql) => db.get(sql).c;
  const direct = n("SELECT COUNT(*) AS c FROM proposals WHERE source != 'auto'");
  if (!direct) throw new Error('점주 직접 발주가 만들어지지 않았습니다');
  console.log(`샘플 데이터 생성 완료 (${((Date.now() - started) / 1000).toFixed(1)}초): 매장 ${n('SELECT COUNT(*) AS c FROM stores')} · POS 판매 ${n('SELECT COUNT(*) AS c FROM pos_sales')} · 발주 ${n('SELECT COUNT(*) AS c FROM proposals')} · 배송 ${n("SELECT COUNT(*) AS c FROM stops WHERE status = 'done'")} · 실사 ${n('SELECT COUNT(*) AS c FROM counts')}`);
  console.log(`파일럿 시작일 ${T.dateStr(startMid + T.HOUR)} · DB ${file}`);
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
},

// ── scripts/backup.js ─────────────────────────────────────────────────────
"scripts/backup.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 운영 DB 온라인 백업 (서버 실행 중에도 안전: SQLite VACUUM INTO)
//   npm run backup [-- --db data/bevflow.db --out backups]
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = opt('db', process.env.BEVFLOW_DB || path.join(__dirname, '..', 'data', 'bevflow.db'));
const outDir = opt('out', path.join(__dirname, '..', 'backups'));
if (!fs.existsSync(file)) { console.error('DB 파일이 없습니다:', file); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
const out = path.join(outDir, `bevflow-${stamp}.db`);
const db = new DatabaseSync(file);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
// 30일 넘은 백업 정리
for (const f of fs.readdirSync(outDir)) {
  const p = path.join(outDir, f);
  if (/^bevflow-.*\.db$/.test(f) && Date.now() - fs.statSync(p).mtimeMs > 30 * 864e5) fs.unlinkSync(p);
}
console.log('백업 완료:', out);
},

// ── scripts/create-admin.js ───────────────────────────────────────────────
"scripts/create-admin.js": function (exports, require, module, __filename, __dirname) {
'use strict';
// 관리자 계정 추가 / 비밀번호 분실 시 재설정
//   npm run create-admin -- <이메일> <이름>   → 임시 비밀번호 출력 (첫 로그인 때 변경)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createContext } = require('../server/context');
const auth = require('../server/auth');
const [email, name = '관리자'] = process.argv.slice(2);
const cli = globalThis.__BEVFLOW_CLI__ ? globalThis.__BEVFLOW_CLI__ + ' create-admin' : 'npm run create-admin --';
if (!email) { console.error(`사용법: ${cli} <이메일> [이름]`); process.exit(1); }
const file = process.env.BEVFLOW_DB || path.join(__dirname, '..', 'data', 'bevflow.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
const ctx = createContext({ file });
const temp = crypto.randomBytes(9).toString('base64url');
const cur = ctx.db.get('SELECT id FROM users WHERE email = ?', [email]);
if (cur) {
  ctx.db.run("UPDATE users SET pw_hash = ?, must_change = 1, disabled = 0, role = 'admin' WHERE id = ?", [auth.hashPassword(temp), cur.id]);
  ctx.db.run('DELETE FROM sessions WHERE user_id = ?', [cur.id]);
  console.log('기존 계정을 관리자로 재설정했습니다:', email);
} else {
  auth.createUser(ctx.db, { email, name, role: 'admin', password: temp, mustChange: true });
  console.log('관리자 계정을 만들었습니다:', email);
}
console.log('임시 비밀번호:', temp, '(첫 로그인 때 변경)');
},
};

const __cache = {};
function __load(id) {
  if (__cache[id]) return __cache[id].exports;
  const fn = __MODULES[id];
  if (!fn) throw new Error('모듈을 찾을 수 없습니다: ' + id);
  const module = { exports: {}, id };
  __cache[id] = module;
  const dir = __path.posix.dirname(id);
  fn.call(module.exports, module.exports, (req) => __require(dir, req), module, __path.join(__BASE, id), __path.join(__BASE, dir));
  return module.exports;
}
function __require(fromDir, req) {
  if (!req.startsWith('.')) return require(req);
  const base = __path.posix.join(fromDir, req);
  for (const id of [base, base + '.js', base + '/index.js']) if (__MODULES[id]) return __load(id);
  throw new Error('모듈을 찾을 수 없습니다: ' + req + ' (' + fromDir + ')');
}

const __COMMANDS = {"start":"server/index.js","seed-sample":"scripts/seed-sample.js","backup":"scripts/backup.js","create-admin":"scripts/create-admin.js"};
const __cmd = process.argv[2];
if (__cmd === 'help' || __cmd === '--help' || __cmd === '-h') {
  console.log('BevFlow 운영 관제 v1.0.0\n\n  node bevflow.js start         운영 서버 실행 (기본)\n  node bevflow.js seed-sample   샘플 데이터 생성  [--weeks 6] [--force] [--db 경로]\n  node bevflow.js backup        DB 온라인 백업  [--db 경로] [--out 폴더]\n  node bevflow.js create-admin  관리자 추가·비밀번호 재설정  <이메일> [이름]');
} else if (__cmd && !__COMMANDS[__cmd]) {
  console.error('알 수 없는 명령: ' + __cmd + '\n\n  node bevflow.js start         운영 서버 실행 (기본)\n  node bevflow.js seed-sample   샘플 데이터 생성  [--weeks 6] [--force] [--db 경로]\n  node bevflow.js backup        DB 온라인 백업  [--db 경로] [--out 폴더]\n  node bevflow.js create-admin  관리자 추가·비밀번호 재설정  <이메일> [이름]');
  process.exit(1);
} else {
  if (__cmd) process.argv.splice(2, 1);
  __load(__COMMANDS[__cmd || 'start']);
}
