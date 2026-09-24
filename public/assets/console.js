'use strict';
/* ==========================================================================
   BevFlow 운영 콘솔
   - 서버 스냅샷(/api/console/snapshot)을 20초마다 받아(변경 없으면 304) 화면을 그린다.
   - 시간은 모두 한국 표준시(KST). 내부에서는 "오늘 0시(KST) 기준 경과 시간(h)"으로 바꿔 계산한다.
   - 조치 버튼은 모두 서버 API를 호출하고, 성공하면 스냅샷을 다시 받는다.
   ========================================================================== */
(() => {
  // ── 유틸리티 ───────────────────────────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n, d = 0) => Number(n || 0).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const won = (n) => num(Math.round(n)) + '원';
  const pct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : num(n, d) + '%');
  const box = (n) => num(Math.max(0, n), 1);
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const KST = 9 * 3600e3, DAY = 86400e3;
  const kstMid = (ts) => Math.floor((ts + KST) / DAY) * DAY - KST;
  let skew = 0;                    // 서버 시각 − 브라우저 시각
  let TODAY0 = kstMid(Date.now()); // 오늘 0시(KST)
  const nowTs = () => Date.now() + skew;
  const nowH = () => (nowTs() - TODAY0) / 3600e3;
  const H = (ts) => (ts == null ? null : (ts - TODAY0) / 3600e3);
  const TS = (h) => TODAY0 + h * 3600e3;
  const dayOf = (h) => Math.floor(h / 24);
  const hodOf = (h) => h - Math.floor(h / 24) * 24;
  const kd = (h) => new Date(TS(h) + KST);
  const md = (h) => { const d = kd(h); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); };
  const mdw = (h) => { const d = kd(h); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' (' + DOW[d.getUTCDay()] + ')'; };
  const hm = (h) => { const m = Math.floor(hodOf(h) * 60 + 1e-6); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const dayWord = (h) => { const d = dayOf(h); return d === 0 ? '오늘' : d === -1 ? '어제' : d === 1 ? '내일' : md(h); };
  const when = (h) => dayWord(h) + ' ' + hm(h);
  const durTxt = (min) => { min = Math.max(0, Math.round(min)); if (min < 60) return min + '분'; const m = min % 60; return Math.floor(min / 60) + '시간' + (m ? ' ' + m + '분' : ''); };
  const dateIdx = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - KST - TODAY0) / DAY) : null; };
  const dateStrOf = (h) => { const d = kd(h); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };

  const IC = {
    home: '<rect x="3.5" y="3.5" width="7" height="8.5" rx="1"/><rect x="13.5" y="3.5" width="7" height="5" rx="1"/><rect x="13.5" y="11.5" width="7" height="9" rx="1"/><rect x="3.5" y="15" width="7" height="5.5" rx="1"/>',
    box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/>',
    order: '<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 4V2.8h6V4M8.5 10h7M8.5 14h7M8.5 18h4"/>',
    chat: '<path d="M4 5h16v11H9.5L5 19.5V16H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    truck: '<path d="M2.5 6.5h11v9.5h-11zM13.5 9.5h4l3 3.5v3h-7z"/><circle cx="6.5" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
    report: '<path d="M4 3.5v16.5h16.5"/><path d="M7.5 15.5 11.5 11l3 2.5 5-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
    reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 16.8v.2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    down: '<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>',
    right: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="1.5"/><path d="M3 10h18M7 15h3"/>',
    send: '<path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z"/>',
    phone: '<path d="M7 3.5h3l1.5 4-2 1.3a10.5 10.5 0 0 0 5.7 5.7l1.3-2 4 1.5v3a2 2 0 0 1-2 2A15.5 15.5 0 0 1 5 5.5a2 2 0 0 1 2-2z"/>',
    doc: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>',
    pin: '<path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    signal: '<path d="M4 18v-2M8.5 18v-5M13 18V10M17.5 18V6.5"/>',
    wifi: '<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.5a7.5 7.5 0 0 1 11 0M9.5 15.5a3.5 3.5 0 0 1 5 0"/>',
    batt: '<rect x="3" y="8" width="16" height="8" rx="1.5"/><path d="M21 11v2"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  };
  const icon = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n]}</svg>`;

  // ── 서버 통신 ───────────────────────────────────────────────
  async function api(method, url, body, { raw = false } = {}) {
    const headers = { 'x-bevflow': '1' };
    if (body !== undefined && !raw) headers['content-type'] = 'application/json';
    if (raw) headers['content-type'] = 'text/csv; charset=utf-8';
    const res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    if (res.status === 401) { location.href = '/login'; throw new Error('로그인이 필요합니다'); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 403 && /비밀번호를 먼저/.test(j.error || '')) { location.href = '/login?change=1'; throw new Error(j.error); }
    if (!res.ok) throw new Error(j.error || `요청에 실패했습니다 (${res.status})`);
    return j;
  }

  // ── 데이터 ─────────────────────────────────────────────────
  let DB = null, SNAP = null, ETAG = null, lastSync = 0, syncErr = null;
  let lastSeenEv = null, justMoved = null, seriesVersion = 0;  // 스냅샷을 새로 받아도 유지할 화면 상태
  let SKU = {}, REG = {}, REGIONS = [];
  const S = (id) => DB.storeById.get(id);
  const inRegion = (rid) => state.region === 'ALL' || state.region === rid;
  const can = (role) => ({ viewer: 1, ops: 2, admin: 3 })[DB.user.role] >= ({ viewer: 1, ops: 2, admin: 3 })[role];

  function adapt(snap) {
    skew = snap.now - Date.now();
    TODAY0 = kstMid(snap.now);
    SKU = Object.fromEntries(snap.skus.map((k) => [k.id, k]));
    REGIONS = snap.regions.map((r) => {
      const d = snap.drivers.find((x) => x.region_id === r.id && x.active);
      return { id: r.id, name: r.name, area: r.area, hub: r.hub_name, lat: r.hub_lat, lng: r.hub_lng, radius: r.radius_km || 3, driver: d ? d.name : '미배정', driverObj: d || null, vehicle: d ? d.vehicle : '' };
    });
    REG = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
    const st = snap.settings;
    const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
    const stores = snap.stores.map((s) => {
      const rg = REG[s.region] || {};
      let angle, radius;
      if (s.lat != null && rg.lat != null) {
        const dx = (s.lng - rg.lng) * 88.2, dy = (s.lat - rg.lat) * 111;
        angle = Math.atan2(-dy, dx); radius = Math.min(.96, Math.hypot(dx, dy) / (rg.radius || 3));
      } else { angle = hash(s.id) * Math.PI * 2; radius = .3 + hash(s.id + 'r') * .6; }
      const hourW = s.profile[Math.floor(hodOf(H(snap.now)))] || 0;
      const posDelayAt = s.lastPosAt && hourW > .03 && snap.now - s.lastPosAt > 45 * 60e3 ? H(s.lastPosAt) : null;
      return {
        ...s, angle, radius, posDelayAt, posNever: !s.lastPosAt,
        items: s.items.filter((it) => SKU[it.sku]).map((it) => ({ ...it, sku: SKU[it.sku], lastCount: it.lastCount ? { ...it.lastCount, t: H(it.lastCount.t) } : null, lastIn: it.lastIn ? { ...it.lastIn, t: H(it.lastIn.t) } : null })),
      };
    });
    const P = snap.proposals.map((p) => ({
      ...p, createdAt: H(p.createdAt), sendAt: H(p.sendAt), sentAt: H(p.sentAt), openAt: H(p.openAt), remindedAt: H(p.remindedAt), respondAt: H(p.respondAt),
      closeAt: H(p.closeAt), paidAt: H(p.paidAt), payFailAt: H(p.payFailAt), deliveredAt: H(p.deliveredAt), deliverDay: dateIdx(p.deliverDate), payFail: p.status === 'payfail',
    }));
    const byId = new Map(P.map((p) => [p.pid, p]));
    const routes = new Map(snap.routes.map((r) => [r.id, r]));
    const stops = snap.stops.map((s) => {
      const arrive = H(s.arrivedAt ?? s.eta), depart = H(s.departedAt ?? (s.eta != null ? s.eta + 7 * 60e3 : null));
      const r = routes.get(s.route);
      return { ...s, day: dateIdx(s.date), eta: H(s.eta), arrive, depart, dur: s.departedAt && s.arrivedAt ? (s.departedAt - s.arrivedAt) / 60e3 : null, p: byId.get(s.proposal) || null, dispatchedAt: r ? H(r.dispatched_at) : null };
    });
    for (const s of stops) if (s.p && s.status !== 'failed') { s.p.stop = s; s.p.shippedAt = s.dispatchedAt ?? s.day * 24 + st.dispatch; }
    DB = {
      user: snap.user, settings: st, stores, storeById: new Map(stores.map((s) => [s.idx, s])), P, byId, stops,
      messages: snap.messages.map((m) => ({ ...m, t: H(m.created_at), sentAt: H(m.sent_at) })),
      events: snap.events.map((e) => ({ ...e, t: H(e.t) })), drivers: snap.drivers, routes: snap.routes,
      settlements: snap.settlements, pilot: snap.pilot, unmapped: snap.unmapped, outboxFailed: snap.outboxFailed,
    };
    if (!DB.pilotStartH) DB.pilotStartH = H(st.pilotStart);
    seriesVersion++; // 차트 이력은 이전 것을 보여 주면서 백그라운드로 갱신
  }

  async function sync(force) {
    try {
      const res = await fetch('/api/console/snapshot', { headers: force || !ETAG ? {} : { 'if-none-match': ETAG }, credentials: 'same-origin' });
      if (res.status === 401) { location.href = '/login'; return; }
      if (res.status === 304) { lastSync = Date.now(); syncErr = null; renderShell(); return; }
      const j = await res.json();
      if (res.status === 403 && /비밀번호를 먼저/.test(j.error || '')) { location.href = '/login?change=1'; return; }
      if (!res.ok) throw new Error(j.error || '동기화 실패');
      ETAG = res.headers.get('etag');
      SNAP = j; adapt(j);
      lastSync = Date.now(); syncErr = null;
      if (!state) initState();
      if (!state.inv.open && !isTyping()) render(); else renderShell();
    } catch (e) {
      syncErr = e.message || String(e);
      if (DB) renderShell();
      else $('#bootMsg').textContent = '데이터를 불러오지 못했습니다 — ' + syncErr;
    }
  }
  const isTyping = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#main'); };
  async function afterAction(msg, ic = 'check') { if (msg) toast(msg, ic); await sync(true); }
  async function run(btn, fn) {
    if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spin"></span>처리 중…'; }
    try { return await fn(); } catch (e) { toast(esc(e.message), 'alert'); if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
  }

  // ── 상태 판정 ───────────────────────────────────────────────
  function pStatus(p) {
    switch (p.status) {
      case 'created': return 'created';
      case 'sent': return p.respondAt != null ? 'processing' : p.openAt != null ? 'opened' : 'sent';
      case 'payfail': return 'payfail';
      case 'paid': return 'paid';
      case 'dispatched': return p.stop && p.stop.status === 'arrived' ? 'unloading' : 'shipped';
      case 'delivered': return 'delivered';
      case 'held': return 'hold';
      case 'expired': return 'noresp';
      default: return 'cancelled';
    }
  }
  const OPEN = ['created', 'sent', 'opened', 'processing', 'payfail', 'paid', 'shipped', 'unloading'];
  const openOrder = (st) => DB.P.find((p) => p.store === st.idx && OPEN.includes(pStatus(p)));
  const boxesOf = (p) => p.lines.reduce((a, l) => a + l.qty, 0);
  const skuName = (id) => (SKU[id] ? SKU[id].name : id);
  const skuSum = (p) => { const l = p.lines[0]; return l ? skuName(l.sku) + ' ' + l.qty + '박스' + (p.lines.length > 1 ? ' 외 ' + (p.lines.length - 1) + '건' : '') : '—'; };
  const itemBurn = (st, it) => Math.max(1e-6, it.r * (1 + st.alpha) * (1 + st.beta));
  function itemStatus(st, it) {
    const lo = it.E - it.w;
    if (lo <= it.S) return 'order';
    if ((lo - it.S) / itemBurn(st, it) < 1.2) return 'warn';
    return 'ok';
  }
  const ST_LABEL = { ok: ['정상', 'b-ok'], warn: ['주의', 'b-warn'], order: ['발주필요', 'b-bad'] };
  const storeStatus = (st) => { const ss = st.items.map((it) => itemStatus(st, it)); return ss.includes('order') ? 'order' : ss.includes('warn') ? 'warn' : 'ok'; };

  function plannedIn(st, props) {
    const out = [];
    for (const p of props) {
      if (p.store !== st.idx) continue;
      if (p.status === 'dispatched' && p.stop) out.push({ t: p.stop.eta, p, eta: true });
      else if (p.status === 'paid' && p.deliverDay != null) out.push({ t: p.deliverDay * 24 + DB.settings.dispatch + 1, p, eta: false });
    }
    return out;
  }
  function forecast(st, it, props, hours = 34) {
    const pts = []; let E = it.E, w = it.w; const t0 = nowH();
    const op = openOrder(st), covered = op && op.lines.some((l) => l.sku === it.sku.id && l.qty > 0); // 진행 중 발주에 포함된 SKU는 예상 트리거를 그리지 않음
    const plan = plannedIn(st, props).map((x) => ({ ...x, q: (x.p.lines.find((l) => l.sku === it.sku.id) || { qty: 0 }).qty })).filter((x) => x.q > 0);
    let trig = null, first = true;
    for (let t = Math.ceil(t0); t <= t0 + hours; t++) {
      const hr = ((Math.floor(t - 1) % 24) + 24) % 24;
      const frac = first ? (t - t0) : 1; first = false;
      const est = it.r * st.profile[hr] * (1 + st.alpha) * frac;
      E -= est; w += st.beta * est;
      plan.forEach((pl) => { if (!pl.done && pl.t <= t) { E = Math.max(0, E) + pl.q; w = DB.settings.bandW0; pl.done = true; pl.E = E; } });
      if (!trig && !plan.length && !covered && E - w <= it.S && itemStatus(st, it) !== 'order') trig = { t, E, w };
      pts.push({ t, E: Math.max(0, E), w, f: true });
    }
    return { pts, plan, trig };
  }
  function hoursToTrigger(st, it) {
    if (it.E - it.w <= it.S) return 0;
    let E = it.E, w = it.w; const t0 = nowH();
    for (let t = Math.ceil(t0); t <= t0 + 30; t++) {
      const hr = ((Math.floor(t - 1) % 24) + 24) % 24;
      const est = it.r * st.profile[hr] * (1 + st.alpha) * (t - t0 < 1 ? t - t0 : 1);
      E -= est; w += st.beta * est;
      if (E - w <= it.S) return t - t0;
    }
    return Infinity;
  }

  // ── 집계 ───────────────────────────────────────────────────
  function kpis() {
    const t = nowH();
    const P = DB.P.filter((p) => { const s = S(p.store); return s && inRegion(s.region); });
    const created = P.filter((p) => p.createdAt >= 0 && p.createdAt <= t).length;
    const createdY = P.filter((p) => p.createdAt >= -24 && p.createdAt <= t - 24).length;
    const approved = P.filter((p) => p.response === 'approve' && p.respondAt != null && p.respondAt >= 0).length;
    const pending = P.filter((p) => ['sent', 'opened'].includes(pStatus(p)));
    const over30 = pending.filter((p) => p.sentAt != null && (t - p.sentAt) * 60 > 30).length;
    const payfail = P.filter((p) => pStatus(p) === 'payfail').length;
    const todayStops = DB.stops.filter((s) => s.day === 0 && inRegion(s.region) && s.status !== 'failed');
    const done = todayStops.filter((s) => s.status === 'done').length;
    const gmv = P.filter((p) => p.paidAt != null && p.paidAt >= 0 && p.status !== 'cancelled').reduce((a, p) => a + p.amount, 0);
    const sd = DB.pilot.sameDay;
    const wk = DB.pilot.weeks;
    const w6 = wk[wk.length - 1];
    return {
      created, createdY, approved, pending: pending.length, over30, payfail, stops: todayStops.length, done, moving: todayStops.length - done,
      sameDay: sd.n ? sd.ok / sd.n * 100 : null, sameN: sd.n, sameOk: sd.ok, same7n: sd.n7, same7ok: sd.ok7,
      gmv, gmv14: DB.pilot.gmv14, appr7: w6 && w6.decided ? w6.approved / w6.decided * 100 : null,
    };
  }
  function pilotMetrics() {
    const wk = DB.pilot.weeks;
    const rec = wk.slice(-2);
    const sum = (arr, k) => arr.reduce((a, w) => a + w[k], 0);
    const allDec = sum(wk, 'decided');
    const last14 = DB.stops.filter((s) => s.status === 'done' && s.dur != null && s.day >= -13).map((s) => s.dur).sort((a, b) => a - b);
    const p = DB.pilot;
    const days = p.firstPaidAt ? Math.max(1, (nowTs() - p.firstPaidAt) / DAY) : 1;
    return {
      weeks: wk.map((w) => ({ ...w, appr: w.decided ? w.approved / w.decided * 100 : null, err: w.counts ? w.errSum / w.counts * 100 : null, hit: w.counts ? w.hits / w.counts * 100 : null, stop: w.stops ? w.stopSum / w.stops : null })),
      appr2: sum(rec, 'decided') ? sum(rec, 'approved') / sum(rec, 'decided') * 100 : null, apprN: sum(rec, 'decided'),
      apprCum: allDec ? sum(wk, 'approved') / allDec * 100 : null,
      err2: sum(rec, 'counts') ? sum(rec, 'errSum') / sum(rec, 'counts') * 100 : null, errN: sum(rec, 'counts'),
      hit2: sum(rec, 'counts') ? sum(rec, 'hits') / sum(rec, 'counts') * 100 : null,
      stop2: sum(rec, 'stops') ? sum(rec, 'stopSum') / sum(rec, 'stops') : null, stopN: sum(rec, 'stops'),
      stopP90: last14.length ? last14[Math.floor(last14.length * .9)] : null, stopIn: last14.length ? last14.filter((d) => d <= 7).length / last14.length * 100 : null,
      monthlyPerStore: p.activeStores ? p.gmv / p.activeStores / days * 30.4 : 0, avgPrice: p.boxes ? p.gmv / p.boxes : 0, avgBoxes: p.orders ? p.boxes / p.orders : 0,
    };
  }

  // ── 상태 ───────────────────────────────────────────────────
  const TABS = [
    { id: 'overview', name: '관제 홈', icon: 'home', desc: '매장·권역의 오늘 운영 현황' },
    { id: 'inventory', name: '재고 관제', icon: 'box', desc: 'POS 판매 로그 기반 재고 추정 — 오차 밴드 하한이 안전재고에 닿으면 발주 제안' },
    { id: 'orders', name: '발주 관제', icon: 'order', desc: '제안 생성 → 승인 대기 → 결제 완료 → 출고 완료' },
    { id: 'notify', name: '알림톡 모니터', icon: 'chat', desc: '사장님께 발송된 발주 제안 메시지와 응답' },
    { id: 'delivery', name: '배송 관제', icon: 'truck', desc: '권역별 라우트 · 기사 진행 현황 · 정차 시간' },
    { id: 'report', name: '파일럿 리포트', icon: 'report', desc: '3대 검증 지표와 티오더 정산' },
    { id: 'admin', name: '관리', icon: 'gear', desc: '매장 · SKU·메뉴 매핑 · 기사 · 계정 · 운영 설정 · 연동' },
  ];
  let state = null;
  function initState() {
    const first = DB.stores.find((s) => s.active && s.onboarded) || DB.stores[0];
    let tab = 'overview';
    try { tab = localStorage.getItem('bf.tab') || 'overview'; } catch { /* 저장소 차단 */ }
    if (!TABS.some((t) => t.id === tab)) tab = 'overview';
    state = {
      tab, region: 'ALL', actFilter: 'ALL',
      inv: { store: first ? first.idx : null, sku: first && first.items[0] ? first.items[0].sku.id : null, status: 'ALL', open: false, q: '' },
      ord: { sel: null }, noti: { sel: null, filter: 'ALL', day: 0 }, del: { scope: '2w' }, rep: { perf: 'top' },
      adm: { sub: 'stores', data: null, loading: false, q: '' },
    };
  }

  // ── 셸 ─────────────────────────────────────────────────────
  function renderShell() {
    if (!DB) return;
    const tab = TABS.find((x) => x.id === state.tab);
    $('#pageTitle').textContent = tab.name;
    $('#pageDesc').textContent = tab.desc;
    $('#regionSeg').innerHTML = [['ALL', '전체'], ...REGIONS.map((r) => [r.id, r.name])].map(([id, nm]) => `<button type="button" data-region="${esc(id)}" aria-pressed="${state.region === id}">${esc(nm)}</button>`).join('');
    const k = kpis();
    const nOrder = DB.stores.filter((st) => st.active && inRegion(st.region) && st.onboarded && storeStatus(st) === 'order' && !openOrder(st)).length;
    const badge = { overview: k.over30 + k.payfail, orders: k.pending + k.payfail, inventory: nOrder, notify: k.pending, admin: DB.unmapped + DB.outboxFailed };
    $('#nav').innerHTML = TABS.map((x, i) => `<button type="button" data-tab="${x.id}" ${state.tab === x.id ? 'aria-current="page"' : ''}>${icon(x.icon)}<span>${x.name}</span><span class="nb">${badge[x.id] ? `<span class="cnt ${['inventory', 'notify', 'admin'].includes(x.id) ? 'soft' : ''}">${badge[x.id]}</span>` : ''}<kbd>${i + 1}</kbd></span></button>`).join('');
    $('#btnRefresh').innerHTML = icon('reset', 15) + '<span>새로고침</span>';
    const wk = DB.pilot.weeks.length;
    $('#pilotBox').innerHTML = `<b>파일럿 ${wk}주차</b> · ${md(DB.pilotStartH)} 시작<br>매장 <b>${DB.stores.filter((s) => s.active).length}</b> · 권역 <b>${REGIONS.length}</b> · 기사 <b>${DB.drivers.filter((d) => d.active).length}</b><br>컷오프 <b>${hm(DB.settings.cutoff)}</b> · 출고 <b>${hm(DB.settings.dispatch)}</b>`;
    const posLag = DB.stores.filter((s) => s.active && s.posDelayAt != null).length;
    const posNever = DB.stores.filter((s) => s.active && s.posNever).length;
    const pay = DB.P.filter((p) => pStatus(p) === 'payfail').length;
    const todayRoutes = DB.routes.filter((r) => dateIdx(r.date) === 0).length;
    $('#sysStatus').innerHTML = `<div class="sys-h">연동 상태</div>
      <div class="sys-row"><span class="d ${posLag || posNever ? 'warn' : ''}"></span>티오더 POS 로그<em>${posLag ? '지연 ' + posLag + '곳' : posNever ? '미수신 ' + posNever + '곳' : '정상'}</em></div>
      <div class="sys-row"><span class="d ${DB.outboxFailed ? 'bad' : ''}"></span>알림 발송 (${DB.settings.notifier === 'console' ? '콘솔' : '웹훅'})<em>${DB.outboxFailed ? '실패 ' + DB.outboxFailed + '건' : '정상'}</em></div>
      <div class="sys-row"><span class="d ${pay ? 'bad' : ''}"></span>결제 (${DB.settings.payMethod === 'invoice' ? '후불' : '카드'})<em>${pay ? '실패 ' + pay + '건' : '정상'}</em></div>
      <div class="sys-row"><span class="d"></span>배차<em>오늘 ${todayRoutes}개 라우트</em></div>`;
    $('#operator').innerHTML = `<span class="avatar">${esc((DB.user.name || '?').slice(0, 1))}</span><span>${esc(DB.user.name)} · ${({ admin: '관리자', ops: '운영자', viewer: '열람' })[DB.user.role]}<br><button class="btn sm" data-act="logout" style="margin-top:4px">로그아웃</button> <button class="btn sm" data-act="pwchange" style="margin-top:4px">비밀번호</button></span>`;
    tickClock();
  }
  function tickClock() {
    const d = new Date(nowTs() + KST);
    $('#clockDate').textContent = d.getUTCFullYear() + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0') + ' (' + DOW[d.getUTCDay()] + ')';
    $('#clockTime').textContent = [d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
    const ago = lastSync ? Math.round((Date.now() - lastSync) / 1000) : null;
    $('#syncStatus').innerHTML = syncErr ? `<span class="sync err"><span class="d"></span>동기화 오류 · ${esc(syncErr).slice(0, 40)}</span>` : `<span class="sync"><span class="d"></span>동기화 ${ago == null ? '—' : ago + '초 전'}</span>`;
  }

  // ── 렌더 ───────────────────────────────────────────────────
  const prevKpi = {};
  function render() {
    if (!DB) return;
    const keep = {}; $$('[data-sk]').forEach((el) => { keep[el.dataset.sk] = el.scrollTop; });
    const mainScroll = $('#main').scrollTop;
    renderShell();
    const v = { overview: viewOverview, inventory: viewInventory, orders: viewOrders, notify: viewNotify, delivery: viewDelivery, report: viewReport, admin: viewAdmin }[state.tab];
    const banner = DB.settings.sampleData ? `<div class="sample-banner">${icon('alert', 15)}<span><b>샘플 데이터</b>로 운영 중입니다. 실제 매장을 등록하기 전에 [관리 → 데이터 연동]에서 샘플을 삭제하세요.</span></div>` : '';
    $('#main').innerHTML = `<div class="view ${['overview', 'orders', 'notify'].includes(state.tab) ? 'fit' : ''}">${banner}${v()}</div>`;
    $$('[data-sk]').forEach((el) => { if (keep[el.dataset.sk] != null) el.scrollTop = keep[el.dataset.sk]; });
    $('#main').scrollTop = mainScroll;
    const ph = $('#phBody'); if (ph) ph.scrollTop = ph.scrollHeight;
    renderDrawer();
    animateKpis();
    bindCharts();
    if (state.tab === 'inventory') loadSeries();
    if (state.tab === 'admin' && !state.adm.data && !state.adm.loading) loadAdmin();
  }
  function animateKpis() {
    $$('[data-kpi]').forEach((el) => {
      const key = el.dataset.kpi, val = parseFloat(el.dataset.val), dec = +(el.dataset.dec || 0), unit = el.dataset.unit || '';
      const old = prevKpi[key];
      const valEl = el.querySelector('.kval');
      if (old != null && isFinite(val) && Math.abs(old - val) > 1e-9 && valEl) {
        el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400);
        const t0 = performance.now();
        const step = (now) => { const k = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - k, 3); valEl.textContent = num(old + (val - old) * e, dec) + unit; if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      }
      if (isFinite(val)) prevKpi[key] = val;
    });
  }
  function kpiTile(key, label, val, unit, sub, opt = {}) {
    const dec = opt.dec || 0;
    const shown = val == null || !isFinite(val) ? '—' : num(val, dec) + (opt.u || '');
    return `<div class="kpi" data-kpi="${key}" data-val="${val ?? ''}" data-dec="${dec}" data-unit="${opt.u || ''}">
      <div class="kpi-l"><span>${label}</span></div>
      <div class="kpi-v"><span class="kval">${shown}</span>${unit && shown !== '—' ? `<small>${unit}</small>` : ''}</div>
      <div class="kpi-s" title="${esc(String(sub).replace(/<[^>]+>/g, ''))}">${sub}</div></div>`;
  }
  function kpiStrip(k) {
    return `<section class="kpis" aria-label="오늘의 핵심 지표">
      ${kpiTile('created', '오늘 발주 제안', k.created, '건', `어제 같은 시각 ${k.createdY}건`)}
      ${kpiTile('approved', '승인 완료', k.approved, '건', `이번 주 승인율 <span class="up">${pct(k.appr7)}</span>`)}
      ${kpiTile('pending', '승인 대기', k.pending, '건', k.over30 ? `<span class="bad">30분 초과 ${k.over30}건</span>${k.payfail ? ` · 결제 실패 ${k.payfail}건 별도` : ''}` : `30분 초과 없음${k.payfail ? ` · 결제 실패 ${k.payfail}건 별도` : ''}`)}
      ${kpiTile('stops', '오늘 출고', k.stops, '건', `배송 완료 ${k.done} · 배송 중 ${k.moving}`)}
      ${kpiTile('sameday', '당일배송 달성률', k.sameDay, '', k.sameN ? `12시 전 결제 ${k.sameOk}/${k.sameN}건 · 7일 ${k.same7ok}/${k.same7n}` : '아직 대상 발주 없음', { dec: 1, u: '%' })}
      ${kpiTile('gmv', '오늘 GMV', k.gmv, '원', `최근 14일 일 평균 ${num(Math.round(k.gmv14 / 1000) * 1000)}원`)}
    </section>`;
  }

  /* ---------- ① 관제 홈 ---------- */
  const KIND = { pay: ['결제 실패', 'b-bad'], late: ['승인 지연', 'b-warn'], low: ['재고 임박', 'b-line'], pos: ['POS 지연', 'b-warn'], onb: ['초기 실사', 'b-mute'], out: ['발송 실패', 'b-bad'] };
  function actionItems() {
    const t = nowH();
    const items = [];
    DB.P.forEach((p) => {
      const st = S(p.store); if (!st || !inRegion(st.region)) return;
      const s = pStatus(p);
      if (s === 'payfail') items.push({ kind: 'pay', sev: 0, p, st, since: p.payFailAt });
      if ((s === 'sent' || s === 'opened') && p.sentAt != null && (t - p.sentAt) * 60 > 30) items.push({ kind: 'late', sev: 1, p, st, since: p.sentAt, opened: s === 'opened' });
      if (s === 'created' && p.review) items.push({ kind: 'late', sev: 1.2, p, st, since: p.createdAt, review: true });
    });
    DB.stores.forEach((st) => {
      if (!st.active || !inRegion(st.region)) return;
      if (!st.onboarded) { items.push({ kind: 'onb', sev: 3, st }); return; }
      if (st.posDelayAt != null) items.push({ kind: 'pos', sev: 2.5, st, since: st.posDelayAt });
      if (openOrder(st)) return;
      let best = null;
      st.items.forEach((it) => { const h = hoursToTrigger(st, it); if (h <= 10 && (!best || h < best.h)) best = { it, h }; });
      if (best) {
        const cooling = st.cooldownUntil && st.cooldownUntil > nowTs();
        items.push({ kind: 'low', sev: cooling ? 1.5 : 2, st, it: best.it, h: best.h, held: cooling });
      }
    });
    if (DB.outboxFailed) items.push({ kind: 'out', sev: 0.5, st: null });
    return items.sort((a, b) => a.sev - b.sev || (a.kind === 'low' ? a.h - b.h : (a.since || 0) - (b.since || 0)));
  }
  function viewOverview() {
    const t = nowH(), k = kpis();
    const all = actionItems();
    const kinds = ['pay', 'late', 'low', 'pos', 'onb', 'out'];
    const cnt = { ALL: all.length }; kinds.forEach((x) => { cnt[x] = all.filter((i) => i.kind === x).length; });
    const items = state.actFilter === 'ALL' ? all : all.filter((x) => x.kind === state.actFilter);
    const w = can('ops');
    const rows = items.map((x) => {
      const st = x.st, rg = st ? REG[st.region] || {} : {};
      let sku = '', el = '', act = '', go = '';
      if (x.kind === 'pay') {
        sku = esc(skuSum(x.p)) + `<span class="sub2">${won(x.p.amount)} · ${esc(x.p.payFailReason || '결제 실패')}</span>`;
        el = `<span data-since="${x.since}">${durTxt((t - x.since) * 60)}</span><span class="sub2">${hm(x.p.respondAt)} 승인 후 결제 실패</span>`;
        act = w ? `<button class="btn sm bad" data-act="repay" data-id="${x.p.pid}">${icon('card', 13)}재결제</button>` : '';
        go = `data-go="order:${x.p.pid}"`;
      } else if (x.kind === 'late') {
        sku = esc(skuSum(x.p)) + `<span class="sub2">${won(x.p.amount)}</span>`;
        if (x.review) {
          el = `<span style="color:var(--sub);font-weight:600">검수 대기</span><span class="sub2">추정 편차 경보 매장 · ${hm(x.p.createdAt)} 생성</span>`;
          act = w ? `<button class="btn sm" data-act="sendnow" data-id="${x.p.pid}">${icon('send', 13)}검수 후 발송</button>` : '';
        } else {
          el = `<span style="color:var(--danger);font-weight:600" data-since="${x.since}">${durTxt((t - x.since) * 60)}</span><span class="sub2">${hm(x.p.sentAt)} 발송 · ${x.opened ? '열람함' : '미열람'}</span>`;
          act = w ? (x.p.remindedAt != null ? `<button class="btn sm" data-act="call" data-store="${st.idx}">${icon('phone', 13)}전화</button>` : `<button class="btn sm warn" data-act="remind" data-id="${x.p.pid}">${icon('send', 13)}리마인드</button>`) : '';
        }
        go = `data-go="order:${x.p.pid}"`;
      } else if (x.kind === 'low') {
        const it = x.it, lo = it.E - it.w;
        sku = `${esc(it.sku.name)}<span class="sub2">하한 ${box(lo)} / 안전재고 ${box(it.S)}박스${x.held ? ' · <span style="color:var(--sub)">보류·미응답 후 대기</span>' : ''}</span>`;
        el = x.h === 0 ? `<span style="color:var(--danger);font-weight:600">하한 도달</span><span class="sub2">${x.held ? '재제안 대기 (' + hm(H(st.cooldownUntil)) + ')' : '다음 점검 시 제안'}</span>` : `<span>약 ${Math.max(1, Math.round(x.h))}시간 후</span><span class="sub2">${hm(t + x.h)}경 트리거 예상</span>`;
        act = w ? (x.held ? `<button class="btn sm" data-act="call" data-store="${st.idx}">${icon('phone', 13)}전화</button>` : `<button class="btn sm" data-act="propose" data-store="${st.idx}">${icon('send', 13)}선제 제안</button>`) : '';
        go = `data-go="inv:${st.idx}:${it.sku.id}"`;
      } else if (x.kind === 'pos') {
        sku = '<span class="muted">—</span>';
        el = `<span style="color:var(--sub);font-weight:600">${durTxt((t - x.since) * 60)} 무수신</span><span class="sub2">마지막 수신 ${when(x.since)}</span>`;
        act = '';
        go = `data-go="inv:${st.idx}:"`;
      } else if (x.kind === 'onb') {
        sku = `<span class="muted">취급 ${st.items.length}종</span>`;
        el = '<span>초기 잔량 입력 전</span><span class="sub2">입력 후 추정·제안 시작</span>';
        act = w ? `<button class="btn sm" data-act="count" data-store="${st.idx}" data-onb="1">${icon('edit', 13)}잔량 입력</button>` : '';
        go = `data-go="inv:${st.idx}:"`;
      } else {
        return `<tr class="click" data-go="admin:integrations"><td><button class="badge b-bad" data-filter-kind="out">발송 실패</button></td><td colspan="3">알림 메시지 ${DB.outboxFailed}건이 5회 재시도 후 실패했습니다 — 발송 설정(웹훅 URL)을 확인하세요</td><td class="r"><button class="btn sm" data-go="admin:integrations">연동 설정</button></td></tr>`;
      }
      return `<tr class="click" ${go}>
        <td><button class="badge ${KIND[x.kind][1]}" data-filter-kind="${x.kind}" title="${KIND[x.kind][0]}만 보기">${KIND[x.kind][0]}</button></td>
        <td class="act-store"><b>${esc(st.name)}</b><span class="tag">${esc(rg.name || st.region)}</span><span class="sub2">${esc(st.id)}</span></td>
        <td>${sku}</td><td>${el}</td><td class="r">${act}</td></tr>`;
    }).join('');
    const chips = [['ALL', '전체'], ...kinds.map((x) => [x, KIND[x][0]])].filter(([id]) => id === 'ALL' || cnt[id]).map(([id, nm]) => `<button class="chip" data-act-filter="${id}" aria-pressed="${state.actFilter === id}">${nm} <b>${cnt[id]}</b></button>`).join('');
    const regRows = REGIONS.filter((r) => inRegion(r.id)).map((r) => {
      const ss = DB.stops.filter((s) => s.day === 0 && s.region === r.id && s.status !== 'failed');
      const d = ss.filter((s) => s.status === 'done').length;
      const cur = ss.some((s) => s.status === 'arrived');
      const wd = ss.length ? d / ss.length * 100 : 0, pw = cur && ss.length ? 1 / ss.length * 100 : 0;
      return `<div class="reg-row"><div class="nm">${esc(r.name)}<small>${esc(r.driver)} 기사</small></div>
        <div><div class="bar" title="완료 ${d} / 전체 ${ss.length}"><i style="width:${wd + pw}%" class="part"></i><i style="width:${wd}%"></i></div></div>
        <div class="v"><b>${d}</b> / ${ss.length}</div></div>`;
    }).join('');
    const tot = DB.stops.filter((s) => s.day === 0 && inRegion(s.region) && s.status !== 'failed');
    const evs = DB.events.filter((e) => e.t <= t && (e.region_id == null || inRegion(e.region_id))).slice(0, 6);
    const evHtml = evs.length ? evs.map((e) => `<div class="ev ${lastSeenEv != null && e.t > lastSeenEv ? 'new' : ''}"><time>${hm(e.t)}</time><span class="badge nodot ${evTone(e.kind)}">${esc(e.kind)}</span><span class="ev-txt" title="${esc(e.message)}">${esc(e.message)}</span></div>`).join('') : `<div class="empty">${icon('clock', 22)}최근 이벤트가 없습니다</div>`;
    if (evs[0]) lastSeenEv = evs[0].t;
    return `${kpiStrip(k)}
    <div class="ov-grid">
      <section class="card ov-left" aria-label="지금 조치 필요">
        <div class="card-h"><h3>지금 조치 필요 <span class="sub">${all.length}건 · 심각도 순</span></h3><div class="chips">${chips}</div></div>
        <div class="tbl-wrap" data-sk="act">${items.length ? `<table class="tbl"><thead><tr><th style="width:92px">유형</th><th>매장</th><th>SKU</th><th>경과 · 상태</th><th class="r">조치</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">${icon('check', 26)}조치가 필요한 항목이 없습니다</div>`}</div>
      </section>
      <div class="ov-right">
        <section class="card" aria-label="오늘의 배송 진행률">
          <div class="card-h"><h3>오늘의 배송 진행률 <span class="sub">완료 / 전체 정차</span></h3><span class="muted" style="font-size:11.5px">출고 ${hm(DB.settings.dispatch)} · 전체 ${tot.filter((s) => s.status === 'done').length}/${tot.length}</span></div>
          <div class="card-b" style="padding-top:0">${regRows && tot.length ? regRows : `<div class="empty">오늘 배차된 배송이 없습니다</div>`}</div>
        </section>
        ${metricSnap()}
        <section class="card" style="min-height:0;display:flex;flex-direction:column" aria-label="최근 이벤트">
          <div class="card-h"><h3>최근 이벤트</h3><span class="muted" style="font-size:11.5px">20초마다 갱신</span></div>
          <div class="card-b" style="padding-top:0;overflow:auto" data-sk="ev">${evHtml}</div>
        </section>
      </div>
    </div>`;
  }
  const evTone = (k) => (/완료|승인|확정|정산/.test(k) ? 'b-ok' : /실패|취소/.test(k) ? 'b-bad' : /보류|미응답|검수/.test(k) ? 'b-warn' : /알림톡|출고|도착/.test(k) ? 'b-line' : 'b-mute');
  function metricSnap() {
    const pm = pilotMetrics(), T = DB.settings.targets;
    const row = (nm, v, target, ok) => `<div class="reg-row" style="grid-template-columns:1fr auto auto"><div class="nm" style="font-weight:500">${nm}</div><div class="v"><b>${v}</b> <span class="muted">${target}</span></div>${ok == null ? '<span class="badge b-mute">표본 부족</span>' : `<span class="badge ${ok ? 'b-ok' : 'b-bad'}">${ok ? '달성' : '미달'}</span>`}</div>`;
    return `<section class="card" aria-label="파일럿 검증 지표"><div class="card-h"><h3>파일럿 검증 지표 <span class="sub">최근 2주</span></h3><button class="btn sm" data-tab="report">리포트 ${icon('right', 13)}</button></div>
      <div class="card-b" style="padding-top:0">${row('① 재고 추정 오차', pct(pm.err2), `목표 ≤${T.error}%`, pm.err2 == null ? null : pm.err2 <= T.error)}${row('② 카톡 승인율', pct(pm.appr2), `목표 ≥${T.approval}%`, pm.appr2 == null ? null : pm.appr2 >= T.approval)}${row('③ 평균 정차 시간', pm.stop2 == null ? '—' : num(pm.stop2, 1) + '분', `목표 ≤${T.stop}분`, pm.stop2 == null ? null : pm.stop2 <= T.stop)}</div></section>`;
  }

  /* ---------- ② 재고 관제 ---------- */
  const seriesCache = new Map();
  let seriesLoading = null;
  async function loadSeries() {
    const st = S(state.inv.store); if (!st) return;
    const key = st.idx + '|' + state.inv.sku;
    const c = seriesCache.get(key);
    if ((c && c.v === seriesVersion) || seriesLoading === key) return;
    seriesLoading = key;
    try {
      const j = await api('GET', `/api/stores/${st.idx}/series?sku=${encodeURIComponent(state.inv.sku)}&days=14`);
      seriesCache.set(key, {
        v: seriesVersion,
        points: j.points.map((x) => ({ t: H(x.t), E: x.E, w: x.w })),
        counts: j.counts.map((c) => ({ ...c, t: H(c.t) })),
        proposals: j.proposals.map((p) => ({ ...p, createdAt: H(p.createdAt), deliverDay: dateIdx(p.deliverDate) })),
        stops: j.stops.map((s) => ({ ...s, arrive: H(s.arrivedAt ?? s.eta), eta: H(s.eta) })),
      });
    } catch (e) { toast(esc(e.message), 'alert'); }
    seriesLoading = null;
    if (state.tab === 'inventory' && !state.inv.open) { const c = $('#chartSlot'); if (c) { c.innerHTML = invChartHtml(); bindCharts(); } }
  }
  function viewInventory() {
    const t = nowH();
    let st = S(state.inv.store);
    if (!st || !inRegion(st.region)) { st = DB.stores.find((s) => inRegion(s.region) && s.active); if (st) state.inv.store = st.idx; }
    if (!st) return `<div class="empty">${icon('box', 26)}등록된 매장이 없습니다 — [관리 → 매장]에서 매장을 추가하세요</div>`;
    let it = st.items.find((x) => x.sku.id === state.inv.sku) || st.items[0];
    if (it) state.inv.sku = it.sku.id;
    const rg = REG[st.region] || {};
    const op = openOrder(st);
    const lastIn = st.items.map((x) => x.lastIn).filter(Boolean).sort((a, b) => b.t - a.t)[0];
    const q = state.inv.q.trim();
    const list = REGIONS.filter((r) => inRegion(r.id)).map((r) => {
      const ss = DB.stores.filter((s) => s.region === r.id && (!q || s.name.includes(q) || s.id.toLowerCase().includes(q.toLowerCase())));
      if (!ss.length) return '';
      return `<div class="combo-g">${esc(r.name)} · ${esc(r.area)}</div>` + ss.map((s) => {
        const oo = openOrder(s);
        const badge = !s.active ? '<span class="badge b-mute">비활성</span>' : !s.onboarded ? '<span class="badge b-mute">초기 실사 전</span>' : s.posDelayAt != null ? '<span class="badge b-warn">POS 지연</span>' : oo ? '<span class="badge b-mute">발주 진행</span>' : `<span class="badge ${ST_LABEL[storeStatus(s)][1]}">${ST_LABEL[storeStatus(s)][0]}</span>`;
        return `<button class="combo-o ${s.idx === st.idx ? 'cur' : ''}" data-pick-store="${s.idx}"><span>${esc(s.name)}</span><span class="code">${esc(s.id)}</span>${badge}</button>`;
      }).join('');
    }).join('') || `<div class="empty">검색 결과가 없습니다</div>`;
    const combo = `<div class="combo">
        <button class="combo-btn" id="storeBtn" aria-haspopup="listbox" aria-expanded="${state.inv.open}">${icon('pin', 15)}<b>${esc(st.name)}</b><span class="muted">${esc(st.id)} · ${esc(rg.name || '')}</span>${icon('down', 15)}</button>
        ${state.inv.open ? `<div class="combo-pop" role="listbox"><input id="storeQ" placeholder="매장명·코드 검색 (${DB.stores.length}개 매장)" value="${esc(state.inv.q)}" autocomplete="off"><div class="combo-list" data-sk="combo">${list}</div></div>` : ''}
      </div>`;
    const skuSel = st.items.length ? `<select class="selbox" id="skuSel" aria-label="SKU 필터">${st.items.map((x) => `<option value="${esc(x.sku.id)}" ${x === it ? 'selected' : ''}>${esc(x.sku.name)} (${x.sku.pack}입)</option>`).join('')}</select>` : '';
    const acts = can('ops') ? `<button class="btn" data-act="count" data-store="${st.idx}" ${st.onboarded ? '' : 'data-onb="1"'}>${icon('edit', 14)}${st.onboarded ? '실사 입력' : '초기 잔량 입력'}</button>${!op && st.onboarded ? `<button class="btn" data-act="propose" data-store="${st.idx}">${icon('send', 14)}선제 제안</button>` : ''}` : '';
    const head = `<div class="filters" role="search"><span class="fl">매장</span>${combo}<span class="fl">SKU</span>${skuSel}${acts}
      <div class="meta-chips"><span class="tag">${esc(rg.name || '')} · ${esc(rg.hub || '')}</span><span class="tag">${st.type === 'D' ? '저녁 중심' : '점심 중심'}</span><span class="tag">최근 입고 ${lastIn ? when(lastIn.t) : '—'}</span><span class="tag">${op ? '발주 진행 중 · ' + esc(op.id) : '진행 중 발주 없음'}</span></div></div>`;
    if (!it) return head + `<div class="empty">${icon('box', 26)}이 매장에 취급 SKU가 없습니다 — [관리 → 매장]에서 SKU를 지정하세요</div>`;
    if (!st.onboarded) return head + `<div class="alert-line warn">${icon('alert', 15)}<span><b>초기 실사 전</b> — 매장의 현재 음료 잔량을 입력하면 그 시점부터 POS 판매로 재고를 추정하고 발주 제안을 시작합니다.</span></div>`;

    const lo = it.E - it.w, stt = itemStatus(st, it);
    const lc = it.lastCount;
    const itOrder = op && op.lines.find((l) => l.sku === it.sku.id) ? op : null;
    const statusLine = stt === 'order'
      ? `<div class="alert-line bad">${icon('alert', 15)}<span><b>발주 필요</b> — 하한 ${box(lo)} ≤ 안전재고 ${box(it.S)}${itOrder ? `<br><span style="color:var(--ink)">${esc(itOrder.id)} · ${orderPhraseShort(itOrder)}</span>` : ''}</span></div>`
      : itOrder ? `<div class="alert-line ok">${icon('order', 15)}<span>발주 진행 중 — ${esc(itOrder.id)} · ${orderPhraseShort(itOrder)}</span></div>`
      : stt === 'warn' ? `<div class="alert-line warn">${icon('clock', 15)}<span>하한이 안전재고에 근접 — ${(() => { const h = hoursToTrigger(st, it); return isFinite(h) ? '약 ' + Math.max(1, Math.round(h)) + '시간 내' : '1일 내'; })()} 트리거 예상</span></div>`
        : `<div class="alert-line ok">${icon('check', 15)}<span>하한 ${box(lo)}박스 · 안전재고 대비 여유 ${box(lo - it.S)}박스</span></div>`;
    const why = `<section class="card why" aria-label="추정 근거">
      <div class="card-h"><h3>추정 근거</h3><span class="muted" style="font-size:11px">실시간</span></div>
      <div class="card-b" style="display:flex;flex-direction:column;gap:9px">
        <div><div class="muted" style="font-size:11.5px">${esc(it.sku.name)} 현재 추정</div>
        <div class="why-v">${box(it.E)} <small>±${num(it.w, 1)}박스</small></div>
        <div class="muted" style="font-size:11.5px">≈ ${Math.round(Math.max(0, it.E) * it.sku.pack)}${esc(it.sku.unit)} (±${Math.round(it.w * it.sku.pack)}${esc(it.sku.unit)}) · 밴드 ${box(Math.max(0, lo))} ~ ${box(it.E + it.w)}</div></div>
        ${statusLine}
        <dl>
          <dt>판매 속도</dt><dd>일 ${num(it.r, 2)}박스 <span class="muted">${({ pos: 'POS 14일', manual: '수동 입력', default: '기본값' })[it.rateSource]}</span></dd>
          <dt>POS (7일)</dt><dd>일 ${num(it.pos7, 2)}박스 · ${num(it.pos7 * it.sku.pack, 1)}${esc(it.sku.unit)}</dd>
          <dt>누수 보정 α</dt><dd>${st.alpha >= 0 ? '+' : ''}${num(st.alpha * 100, 1)}% <span class="muted">서비스·폐기</span></dd>
          <dt>최근 실사</dt><dd>${lc ? `${md(lc.t)} · 편차 ${lc.T >= lc.E ? '+' : '−'}${num(Math.abs(lc.T - lc.E), 2)}` : '—'}</dd>
        </dl>
        <div class="note">추정값이 아닌 <b style="color:var(--ink)">오차 밴드 하한</b>이 안전재고에 닿을 때 제안합니다. 밴드는 실사 후 판매량의 ${num(st.beta * 100, 0)}%씩 넓어지고, 기사가 하차 전 잔량을 확인하면 리셋됩니다.</div>
      </div></section>`;
    const counts = { ALL: st.items.length, ok: 0, warn: 0, order: 0 };
    st.items.forEach((x) => counts[itemStatus(st, x)]++);
    const scale = Math.max(3, ...st.items.map((y) => y.E + y.w)) * 1.05;
    const rows = st.items.filter((x) => state.inv.status === 'ALL' || itemStatus(st, x) === state.inv.status).map((x) => {
      const s2 = itemStatus(st, x), l2 = x.E - x.w;
      const days = x.E / Math.max(1e-6, x.r * (1 + st.alpha));
      const ord = op && op.lines.find((l) => l.sku === x.sku.id);
      const bar = `<span class="stock-bar" aria-hidden="true"><span class="band" style="left:${Math.max(0, l2) / scale * 100}%;width:${Math.max(0, Math.min(x.E + x.w, scale) - Math.max(0, l2)) / scale * 100}%"></span><span class="ss" style="left:${x.S / scale * 100}%"></span><span class="pt" style="left:calc(${Math.max(0, x.E) / scale * 100}% - 1px)"></span></span>`;
      return `<tr class="click ${x === it ? 'sel' : ''}" data-pick-sku="${esc(x.sku.id)}">
        <td title="${x.sku.pack}입 · ${num(x.sku.price)}원/박스"><b class="strong">${esc(x.sku.name)}</b> <span class="muted" style="font-size:11px">${x.sku.pack}입</span></td>
        <td><div class="stock-cell"><span class="num"><b>${box(x.E)}</b> <span class="muted">±${num(x.w, 1)}박스</span></span>${bar}</div></td>
        <td class="r num">${box(x.S)}</td>
        <td><button class="badge ${ST_LABEL[s2][1]}" data-badge-sku="${esc(x.sku.id)}" title="이 SKU 차트 보기">${ST_LABEL[s2][0]}</button></td>
        <td class="r num">${num(x.r, 2)} <span class="muted" style="font-size:11px">${num(x.r * x.sku.pack, 1)}${esc(x.sku.unit)}</span></td>
        <td class="r num">${days < 30 ? num(days, 1) + '일' : '30일+'} <span class="muted" style="font-size:11px">${days < 30 ? mdw(t + days * 24) : ''}</span></td>
        <td>${ord ? `<span class="badge b-line">${ord.qty}박스 ${orderPhraseShort(op)}</span>` : x.lastIn ? `<span class="muted">최근 입고 ${md(x.lastIn.t)} +${x.lastIn.q}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');
    const sChips = [['ALL', '전체'], ['ok', '정상'], ['warn', '주의'], ['order', '발주필요']].map(([id, nm]) => `<button class="chip" data-inv-status="${id}" aria-pressed="${state.inv.status === id}">${nm} <b>${counts[id]}</b></button>`).join('');
    const warn = st.posDelayAt != null ? `<div class="alert-line warn">${icon('alert', 15)}<span><b>POS 로그 수신 지연</b> — 마지막 수신 ${hm(st.posDelayAt)} (${durTxt((t - st.posDelayAt) * 60)} 전). 영업 중인데 판매 로그가 들어오지 않습니다. 티오더 연동 상태를 확인하세요.</span></div>` : '';
    const exc = st.exception ? `<div class="alert-line bad">${icon('alert', 15)}<span><b>추정 편차 경보 매장</b> — 누수 보정 α ${num(st.alpha * 100, 0)}%. 이 매장의 제안은 운영자 검수 후 발송됩니다.</span></div>` : '';
    return `${head}${warn}${exc}
      <div class="inv-top">
        <section class="card chart-card" aria-label="재고 추정 차트">
          <div class="card-h" style="flex-wrap:wrap;row-gap:6px"><h3>${esc(it.sku.name)} 재고 추정 <span class="sub">최근 14일 + 34시간 예측 · 박스(${it.sku.pack}${esc(it.sku.unit)})</span></h3>
            <div class="legend"><span><i class="lg-line"></i>추정 재고</span><span><i class="lg-band"></i>오차 밴드(±)</span><span><i class="lg-dash"></i>안전재고</span><span><i class="lg-ring"></i>발주 트리거</span><span><i class="lg-sq"></i>입고</span><span><i class="lg-dot"></i>기사 실사(편차)</span></div></div>
          <div style="padding:0 8px 0 4px" id="chartSlot">${invChartHtml()}</div>
        </section>
        ${why}
      </div>
      <section class="card" aria-label="SKU별 재고">
        <div class="card-h"><h3>SKU별 재고 <span class="sub">${esc(st.name)} · ${st.items.length}종 · 행을 누르면 차트 전환</span></h3><div class="chips">${sChips}</div></div>
        <div class="tbl-wrap">${rows ? `<table class="tbl"><thead><tr><th>SKU</th><th>추정 재고 (±오차)</th><th class="r">안전재고</th><th>상태</th><th class="r">판매속도 (박스/일)</th><th class="r">예상 소진</th><th>발주·입고</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">${icon('box', 24)}해당 상태의 SKU가 없습니다</div>`}</div>
      </section>`;
  }
  function orderPhrase(p) {
    switch (pStatus(p)) {
      case 'created': return '제안 생성 · ' + (p.review ? '검수 대기' : p.sendAt != null ? '발송 예약 ' + hm(p.sendAt) : '발송 대기');
      case 'sent': return '알림톡 발송 · 응답 대기';
      case 'opened': return '열람 · 응답 대기';
      case 'processing': return '승인 처리 중';
      case 'payfail': return '승인 · 결제 실패';
      case 'paid': return '결제 완료 · ' + (p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md(p.deliverDay * 24)) + ' 출고';
      case 'shipped': return '배송 중 · ' + (p.stop ? hm(p.stop.eta) + ' 도착 예정' : '');
      case 'unloading': return '하차 중';
      case 'delivered': return '배송 완료';
      case 'hold': return '보류';
      case 'noresp': return '미응답 만료';
      default: return '취소';
    }
  }
  function orderPhraseShort(p) {
    switch (pStatus(p)) {
      case 'created': return '제안 생성';
      case 'sent': case 'opened': return '승인 대기';
      case 'payfail': return '결제 실패';
      case 'paid': return (p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md(p.deliverDay * 24)) + ' 도착 예정';
      case 'shipped': return p.stop ? hm(p.stop.eta) + ' 도착 예정' : '배송 중';
      case 'unloading': return '하차 중';
      case 'delivered': return '배송 완료';
      default: return '';
    }
  }

  // 재고 추정 차트 (인라인 SVG)
  let CHART = null;
  function invChartHtml() {
    const st = S(state.inv.store); if (!st) return '';
    const it = st.items.find((x) => x.sku.id === state.inv.sku); if (!it) return '';
    const hist0 = seriesCache.get(st.idx + '|' + it.sku.id);
    const W = 900, H0 = 312, ml = 40, mr = 78, mt = 34, mb = 28;
    if (!hist0) return `<svg class="chart loading-dim" viewBox="0 0 ${W} ${H0}" role="img" aria-label="불러오는 중"><text x="${W / 2}" y="${H0 / 2}" text-anchor="middle" font-size="12" fill="var(--gray)">재고 이력을 불러오는 중…</text></svg>`;
    const now = nowH();
    const t0 = dayOf(now - 13 * 24) * 24, t1 = now + 34;
    const hist = hist0.points.filter((p) => p.t >= t0 && p.t <= now);
    const props = hist0.proposals.map((p) => ({ ...p, stop: DB.byId.get(p.pid)?.stop || null, deliverDay: p.deliverDay }));
    const liveProps = DB.P.filter((p) => p.store === st.idx);
    const fc = forecast(st, it, liveProps);
    const nowPt = { t: now, E: it.E, w: it.w };
    const all = hist.concat([nowPt], fc.pts);
    let ymax = Math.max(it.S * 1.6, ...all.map((p) => p.E + p.w)) * 1.08;
    const stepY = ymax > 12 ? 4 : ymax > 6 ? 2 : ymax > 3 ? 1 : .5;
    ymax = Math.ceil(ymax / stepY) * stepY;
    const x = (tt) => ml + (tt - t0) / (t1 - t0) * (W - ml - mr);
    const y = (v) => mt + (1 - Math.max(0, v) / ymax) * (H0 - mt - mb);
    const nowX = x(now);
    const g = [];
    g.push(`<rect x="${nowX}" y="${mt}" width="${W - mr - nowX}" height="${H0 - mt - mb}" fill="var(--ink-t)"/>`);
    g.push(`<text x="${nowX + 6}" y="${mt + 12}" font-size="10.5" fill="var(--gray)">예측</text>`);
    for (let v = 0; v <= ymax + 1e-9; v += stepY) {
      g.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`);
      g.push(`<text x="${ml - 8}" y="${y(v) + 3.5}" font-size="10.5" fill="var(--gray)" text-anchor="end">${num(v, stepY < 1 ? 1 : 0)}</text>`);
    }
    for (let d = dayOf(t0); d <= dayOf(t1); d++) {
      const xx = x(d * 24); if (xx < ml - 1 || xx > W - mr) continue;
      g.push(`<line x1="${xx}" x2="${xx}" y1="${H0 - mb}" y2="${H0 - mb + 4}" stroke="var(--gray)" stroke-width="1"/>`);
      const lab = d === 0 ? '오늘' : d === 1 ? '내일' : md(d * 24);
      if (xx + 12 < W - mr + 20) g.push(`<text x="${xx + 2}" y="${H0 - mb + 16}" font-size="10.5" fill="${d === 0 ? 'var(--ink)' : 'var(--gray)'}" ${d === 0 ? 'font-weight="600"' : ''}>${lab}</text>`);
    }
    g.push(`<line x1="${ml}" x2="${W - mr}" y1="${H0 - mb}" y2="${H0 - mb}" stroke="var(--gray)" stroke-width="1"/>`);
    const bandPath = (pts) => (pts.length > 1 ? 'M' + pts.map((p) => `${x(p.t).toFixed(1)},${y(p.E + p.w).toFixed(1)}`).join('L') + 'L' + pts.slice().reverse().map((p) => `${x(p.t).toFixed(1)},${y(p.E - p.w).toFixed(1)}`).join('L') + 'Z' : '');
    const linePath = (pts) => (pts.length > 1 ? 'M' + pts.map((p) => `${x(p.t).toFixed(1)},${y(p.E).toFixed(1)}`).join('L') : '');
    const histPts = hist.concat([nowPt]);
    const fcPts = [nowPt].concat(fc.pts);
    g.push(`<path d="${bandPath(histPts)}" fill="var(--main)" fill-opacity=".14"/>`);
    g.push(`<path d="${bandPath(fcPts)}" fill="var(--main)" fill-opacity=".08"/>`);
    g.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(it.S)}" y2="${y(it.S)}" stroke="var(--sub)" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    g.push(`<text x="${W - mr + 6}" y="${y(it.S) + 3.5}" font-size="10.5" fill="var(--sub)" font-weight="600">안전재고 ${box(it.S)}</text>`);
    g.push(`<path d="${linePath(histPts)}" fill="none" stroke="var(--main)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    g.push(`<path d="${linePath(fcPts)}" fill="none" stroke="var(--main)" stroke-width="1.6" stroke-dasharray="4 3" stroke-linejoin="round"/>`);
    g.push(`<line x1="${nowX}" x2="${nowX}" y1="${mt - 8}" y2="${H0 - mb}" stroke="var(--ink)" stroke-width="1"/>`);
    g.push(`<text x="${nowX}" y="${mt - 12}" font-size="10.5" fill="var(--ink)" font-weight="600" text-anchor="middle">지금 ${hm(now)}</text>`);
    g.push(`<circle cx="${nowX}" cy="${y(it.E)}" r="4.5" fill="var(--main)" stroke="var(--paper)" stroke-width="2"/>`);
    const marks = [];
    hist0.counts.filter((c) => c.sku === it.sku.id && c.t >= t0).forEach((c) => {
      const stop = hist0.stops.find((s) => s.sid === c.stop);
      const pr = stop ? props.find((p) => p.pid === stop.proposal) : null;
      const q = pr ? (pr.lines.find((l) => l.sku === it.sku.id) || { qty: 0 }).qty : 0;
      const xx = x(c.t);
      g.push(`<line x1="${xx}" x2="${xx}" y1="${y(c.E)}" y2="${y(c.T)}" stroke="var(--danger)" stroke-width="1.5"/>`);
      g.push(`<circle cx="${xx}" cy="${y(c.T)}" r="4" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5"/>`);
      if (q) {
        g.push(`<rect x="${xx - 4}" y="${y(c.T + q) - 4}" width="8" height="8" fill="var(--ink)" stroke="var(--paper)" stroke-width="2"/>`);
        g.push(`<text x="${xx + 7}" y="${y(c.T + q) - 5}" font-size="10.5" fill="var(--ink)">입고 +${q}</text>`);
      }
      marks.push({ t: c.t, text: `${c.source === 'driver' ? '기사' : '운영자'} 실사 ${when(c.t)} — 추정 ${box(c.E)} → 실제 ${box(c.T)}박스${q ? ` · 입고 +${q}` : ''}` });
    });
    let lab = 0;
    props.filter((p) => p.createdAt >= t0).forEach((p) => {
      const l = p.lines.find((ll) => ll.sku === it.sku.id); if (!l) return;
      const xx = x(p.createdAt);
      if (l.trig) {
        const yy = y(it.S), ly = mt + 4 + (lab++ % 2) * 13;
        const nearNow = nowX - xx < 110, anchor = nearNow ? 'end' : 'middle', tx = nearNow ? xx - 4 : xx;
        g.push(`<line x1="${xx}" x2="${xx}" y1="${ly - 8}" y2="${yy - 7}" stroke="var(--danger)" stroke-width="1" stroke-opacity=".45"/>`);
        g.push(`<circle cx="${xx}" cy="${yy}" r="6.5" fill="var(--paper)" fill-opacity=".6" stroke="var(--danger)" stroke-width="2"/>`);
        g.push(`<text x="${tx}" y="${ly}" font-size="10.5" fill="var(--danger)" font-weight="600" text-anchor="${anchor}">${p.reproposal ? '재제안' : p.manual ? '선제 제안' : '트리거'} ${md(p.createdAt)} ${hm(p.createdAt)}</text>`);
        marks.push({ t: p.createdAt, text: `${p.manual ? '선제 제안' : '발주 트리거'} ${when(p.createdAt)} — 하한 ${box(l.E - l.w)} · 안전재고 ${box(l.S)} · ${p.id} ${l.qty}박스 제안` });
      } else {
        g.push(`<path d="M${xx},${y(l.E) - 5} l5,5 l-5,5 l-5,-5z" fill="var(--paper)" stroke="var(--danger)" stroke-width="1.5"/>`);
        marks.push({ t: p.createdAt, text: `묶음 발주 ${when(p.createdAt)} — ${skuName(p.lines[0].sku)} 트리거에 함께 포함 (${l.qty}박스)` });
      }
    });
    fc.plan.forEach((pl) => {
      const xx = x(pl.t); if (xx > W - mr) return;
      const yy = y(pl.E || it.E);
      g.push(`<rect x="${xx - 4}" y="${yy - 4}" width="8" height="8" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5"/>`);
      g.push(`<text x="${xx + 7}" y="${yy - 5}" font-size="10.5" fill="var(--ink)">입고 예정 +${pl.q} (${pl.eta ? hm(pl.t) : dayWord(pl.t) + ' 오후'})</text>`);
      marks.push({ t: pl.t, text: `입고 예정 ${pl.eta ? when(pl.t) : dayWord(pl.t) + ' 오후'} +${pl.q}박스 · ${pl.p.id}` });
    });
    if (fc.trig) {
      const xx = x(fc.trig.t);
      g.push(`<circle cx="${xx}" cy="${y(it.S)}" r="6.5" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="3 2"/>`);
      g.push(`<text x="${xx}" y="${y(it.S) + 20}" font-size="10.5" fill="var(--danger)" text-anchor="middle">예상 트리거 ${dayWord(fc.trig.t)} ${Math.floor(hodOf(fc.trig.t))}시경</text>`);
      marks.push({ t: fc.trig.t, text: `예상 트리거 ${dayWord(fc.trig.t)} ${Math.floor(hodOf(fc.trig.t))}시경` });
    }
    if (!hist.length) g.push(`<text x="${(ml + nowX) / 2}" y="${mt + 40}" font-size="11" fill="var(--gray)" text-anchor="middle">아직 쌓인 이력이 없습니다 (1시간마다 기록)</text>`);
    g.push(`<line id="cx" x1="0" x2="0" y1="${mt}" y2="${H0 - mb}" stroke="var(--ink)" stroke-width="1" stroke-opacity=".35" visibility="hidden"/>`);
    g.push(`<circle id="cxd" r="4" fill="var(--main)" stroke="var(--paper)" stroke-width="2" visibility="hidden"/>`);
    g.push(`<rect id="hit" x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H0 - mt - mb}" fill="transparent"/>`);
    CHART = { W, ml, mr, t0, t1, pts: histPts.concat(fc.pts), x, y, S: it.S, marks };
    return `<svg class="chart" id="invChart" viewBox="0 0 ${W} ${H0}" role="img" aria-label="${esc(it.sku.name)} 최근 14일 재고 추정 추이">${g.join('')}</svg>`;
  }

  /* ---------- ③ 발주 관제 ---------- */
  function stageOf(p) {
    const s = pStatus(p);
    if (s === 'created') return 'c';
    if (s === 'sent' || s === 'opened' || s === 'payfail' || s === 'processing') return 'w';
    if (s === 'paid') return 'p';
    if ((s === 'shipped' || s === 'unloading' || s === 'delivered') && p.stop && p.stop.day === 0) return 's';
    return null;
  }
  function orderCard(p) {
    const t = nowH(), st = S(p.store), s = pStatus(p), rg = REG[st.region] || {};
    let el = '', tags = [], act = '';
    const w = can('ops');
    if (s === 'created') {
      el = `생성 <span data-since="${p.createdAt}">${durTxt((t - p.createdAt) * 60)}</span> 전`;
      if (p.manual) tags.push('<span class="badge b-line">선제 제안</span>');
      if (p.review) tags.push('<span class="badge b-warn">검수 대기</span>');
      else if (p.sendAt != null) tags.push(`<span class="badge b-mute">발송 예약 ${hm(p.sendAt)}${p.sendRule === 'break' ? ' · 브레이크타임' : p.sendRule === 'night' ? ' · 야간 생성' : ''}</span>`);
      if (w) act = `<div class="act"><button class="btn sm" data-act="sendnow" data-id="${p.pid}">${icon('send', 13)}${p.review ? '검수 후 발송' : '즉시 발송'}</button></div>`;
    } else if (s === 'sent' || s === 'opened') {
      const m = p.sentAt != null ? (t - p.sentAt) * 60 : 0;
      el = `<span class="${m > 30 ? 'el late' : 'el'}">${icon('clock', 12)}<span data-since="${p.sentAt}">${durTxt(m)}</span></span>`;
      tags.push(`<span class="badge ${s === 'opened' ? 'b-ok' : 'b-mute'}">${s === 'opened' ? '열람함' : '미열람'}</span>`);
      if (m > 30) tags.push('<span class="badge b-bad">30분 초과</span>');
      if (p.reproposal) tags.push('<span class="badge b-line nodot">재제안</span>');
      if (p.remindedAt != null) tags.push('<span class="badge b-line nodot">리마인드 발송</span>');
      if (w) act = `<div class="act"><button class="btn sm" data-act="copylink" data-id="${p.pid}">${icon('link', 13)}링크</button><button class="btn sm primary" data-act="approve" data-id="${p.pid}">${icon('check', 13)}대리 승인</button></div>`;
    } else if (s === 'processing') {
      el = '<span class="el"><span class="spin"></span> 결제 처리 중</span>';
    } else if (s === 'payfail') {
      el = `<span class="el late">${icon('card', 12)}결제 실패</span>`;
      tags.push(`<span class="badge b-bad">${esc((p.payFailReason || '결제 실패').slice(0, 18))}</span>`, '<span class="badge b-ok">승인 ' + hm(p.respondAt) + '</span>');
      if (w) act = `<div class="act"><button class="btn sm bad" data-act="repay" data-id="${p.pid}">${icon('card', 13)}재결제</button></div>`;
    } else if (s === 'paid') {
      el = `<span class="el">결제 ${hm(p.paidAt)}</span>`;
      tags.push(`<span class="badge b-ok">${p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md(p.deliverDay * 24)} ${hm(DB.settings.dispatch)} 출고</span>`);
      if (p.payMethod === 'invoice') tags.push('<span class="badge b-mute nodot">후불 청구</span>');
      if (p.deliverDay > 0 && p.paidAt != null && hodOf(p.paidAt) >= DB.settings.cutoff) tags.push('<span class="badge b-mute nodot">컷오프 이후 승인</span>');
    } else {
      const sp = p.stop;
      el = s === 'delivered' ? `<span class="el">${icon('check', 12)}${hm(sp.depart)} 완료</span>` : s === 'unloading' ? '<span class="el" style="color:var(--sub);font-weight:600">하차 중</span>' : `<span class="el">ETA ${hm(sp.eta)}</span>`;
      tags.push(`<span class="badge ${s === 'delivered' ? 'b-ok' : s === 'unloading' ? 'b-warn' : 'b-line'}">${s === 'delivered' ? '배송 완료' : s === 'unloading' ? '하차 중' : '배송 중'}</span>`, `<span class="badge b-mute nodot">${esc(rg.driver || '')} · ${sp.seq}번째</span>`);
    }
    return `<div class="ocard ${state.ord.sel === p.pid ? 'sel' : ''} ${justMoved === p.pid ? 'arrive' : ''}" role="button" tabindex="0" data-order="${p.pid}">
      <div class="r1"><b>${esc(st.name)}</b><span class="tag">${esc(rg.name || st.region)}</span></div>
      <div class="sku">${esc(skuSum(p))} <span class="muted">· ${boxesOf(p)}박스</span></div>
      <div class="r3"><span class="amt">${won(p.amount)}</span><span class="el">${el}</span></div>
      <div class="r4">${tags.join('')}</div>${act}</div>`;
  }
  function viewOrders() {
    const k = kpis();
    const cols = { c: [], w: [], p: [], s: [] };
    DB.P.forEach((p) => { const st = S(p.store); if (!st || !inRegion(st.region)) return; const sg = stageOf(p); if (sg) cols[sg].push(p); });
    cols.c.sort((a, b) => b.createdAt - a.createdAt);
    cols.w.sort((a, b) => (pStatus(a) === 'payfail') - (pStatus(b) === 'payfail') || (a.sentAt ?? 0) - (b.sentAt ?? 0));
    cols.p.sort((a, b) => (b.paidAt ?? 0) - (a.paidAt ?? 0));
    cols.s.sort((a, b) => (a.stop.status === 'done') - (b.stop.status === 'done') || a.stop.seq - b.stop.seq);
    const EMPTY = { c: '발송 전 제안이 없습니다', w: '응답을 기다리는 제안이 없습니다', p: `출고 대기 중인 발주가 없습니다`, s: '오늘 출고된 발주가 없습니다' };
    const col = (id, name, hint) => `<section class="col" aria-label="${name}">
      <div class="col-h"><h3>${name}</h3><span class="n">${cols[id].length}</span><span class="hint">${hint}</span></div>
      <div class="col-b" data-sk="col-${id}">${cols[id].length ? cols[id].map(orderCard).join('') : `<div class="empty">${icon(id === 'p' ? 'card' : id === 's' ? 'truck' : 'order', 22)}${EMPTY[id]}</div>`}</div></section>`;
    const past = hodOf(nowH()) >= DB.settings.cutoff;
    const html = `<section class="kpis" aria-label="발주 KPI">
        ${kpiTile('created', '오늘 발주 제안', k.created, '건', `어제 같은 시각 ${k.createdY}건`)}
        ${kpiTile('approved', '승인 완료', k.approved, '건', `이번 주 승인율 <span class="up">${pct(k.appr7)}</span>`)}
        ${kpiTile('pending', '승인 대기', k.pending, '건', k.over30 ? `<span class="bad">30분 초과 ${k.over30}건</span>` : '30분 초과 없음')}
        ${kpiTile('stops', '오늘 출고', k.stops, '건', `배송 완료 ${k.done} · 배송 중 ${k.moving}`)}
        ${kpiTile('gmv', '오늘 GMV', k.gmv, '원', '결제 완료 기준')}
        ${kpiTile('payfail', '결제 실패', k.payfail, '건', k.payfail ? '<span class="bad">재결제 필요</span>' : '정상')}
      </section>
      <div class="cutoff">
        <span class="pill">${icon('clock', 14)}당일배송 컷오프 <b>${hm(DB.settings.cutoff)}</b> ${past ? '<span class="badge b-mute">마감</span>' : '<span class="badge b-ok">진행 중</span>'}</span>
        <span class="muted">${past ? `지금 승인되는 발주는 <b style="color:var(--ink)">다음 배송일 ${hm(DB.settings.dispatch)} 출고</b>` : `${hm(DB.settings.cutoff)} 전 승인 시 오늘 ${hm(DB.settings.dispatch)} 출고`}</span>
        <span class="muted" style="margin-left:auto">사장님이 전화로 승인하면 [대리 승인] · 카드를 누르면 상세</span>
      </div>
      <div class="kanban">${col('c', '제안 생성', '발송 전')}${col('w', '승인 대기', '응답 대기')}${col('p', '결제 완료', '출고 대기')}${col('s', '출고 완료', '오늘 배송')}</div>`;
    justMoved = null;
    return html;
  }
  function renderDrawer() {
    const dr = $('#drawer');
    const p = state.ord.sel && DB.byId.get(state.ord.sel);
    if (!p || state.tab !== 'orders') { dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); return; }
    const t = nowH(), st = S(p.store), rg = REG[st.region] || {}, s = pStatus(p);
    const stepDef = [
      ['제안 생성', p.createdAt, true],
      ['발송', p.sentAt, p.sentAt != null],
      ['사장님 승인', p.respondAt, p.response === 'approve' && p.respondAt != null],
      ['결제', p.paidAt, p.paidAt != null],
      ['출고', p.shippedAt, p.stop != null],
      ['도착', p.stop ? (p.stop.arrivedAt ? H(p.stop.arrivedAt) : p.stop.eta) : null, p.stop && ['arrived', 'done'].includes(p.stop.status)],
    ];
    const firstTodo = stepDef.findIndex((x) => !x[2]);
    const steps = stepDef.map((x, i) => `<div class="step ${x[2] ? 'done' : ''} ${i === firstTodo ? (s === 'payfail' && i === 3 ? 'fail' : 'now') : ''}"><span class="dot"></span><b>${x[0]}</b><span>${x[2] && x[1] != null ? hm(x[1]) : i === firstTodo && i === 1 && p.sendAt != null ? '예약 ' + hm(p.sendAt) : i === 5 && p.stop ? 'ETA ' + hm(p.stop.eta) : '—'}</span></div>`).join('');
    const lines = p.lines.map((l) => `<tr><td>${esc(skuName(l.sku))}${l.trig ? ' <span class="badge b-bad nodot">트리거</span>' : ''}<span class="sub2">제안 시 추정 ${box(l.E)} ±${num(l.w, 1)} · 안전 ${box(l.S)}</span></td><td class="r num">${l.qty}${l.qtyOrig !== l.qty ? ` <span class="muted">(제안 ${l.qtyOrig})</span>` : ''}</td><td class="r num">${won(l.qty * l.price)}</td></tr>`).join('');
    const msgs = DB.messages.filter((m) => m.proposal_id === p.pid).slice().sort((a, b) => a.t - b.t);
    const KINDN = { propose: '발주 제안', remind: '리마인드', confirm: '발주 확정 안내', payfail: '결제 실패 안내', hold_ack: '보류 안내', expire: '만료 안내', delivered: '배송 완료 안내', delivery_failed: '배송 실패 안내' };
    const logHtml = [[p.createdAt, `제안 생성 — ${skuName(p.lines[0]?.sku)} 하한 도달${p.reproposal ? ' (재제안)' : ''}${p.manual ? ' (선제 제안: ' + esc(p.createdBy) + ')' : ''}`], ...(p.openAt != null ? [[p.openAt, '사장님 열람']] : []),
      ...(p.respondAt != null ? [[p.respondAt, `${p.response === 'approve' ? (p.modify ? '수량 수정 승인' : '승인') : '보류'} — ${String(p.responder || '').startsWith('ops:') ? '운영자 대리 (' + esc(p.responder.slice(4)) + ')' : '사장님'}`]] : []),
      ...msgs.map((m) => [m.t, `${KINDN[m.kind] || m.kind} 메시지 ${m.status === 'sent' ? '발송' : m.status === 'failed' ? '<span style="color:var(--danger)">발송 실패</span>' : '대기'}${m.error ? ' · ' + esc(m.error) : ''}`])]
      .sort((a, b) => a[0] - b[0]).map((l) => `<div class="log-row"><time>${hm(l[0])}</time><span>${l[1]}${dayOf(l[0]) !== 0 ? ` <span class="muted">(${dayWord(l[0])})</span>` : ''}</span></div>`).join('');
    const pay = s === 'payfail' ? `<span style="color:var(--danger);font-weight:600">결제 실패</span> · ${esc(p.payFailReason || '')} · ${hm(p.payFailAt)}` : p.paidAt != null ? `${p.payMethod === 'invoice' ? '후불 청구 확정' : '카드 결제 완료'} · ${when(p.paidAt)}<span class="sub2">${esc(p.payRef || '')}</span>` : '승인 후 처리';
    const eta = p.stop ? `${when(p.stop.eta)} <span class="muted">(${esc(rg.driver || '')} 기사 · ${p.stop.seq}번째 정차)</span>` : p.paidAt != null ? `${p.deliverDay === 0 ? '오늘' : p.deliverDay === 1 ? '내일' : md((p.deliverDay || 0) * 24)} ${hm(DB.settings.dispatch)} 출고 → 오후 도착` : hodOf(t) >= DB.settings.cutoff ? '지금 승인 시 다음 배송일 오후 도착' : `${hm(DB.settings.cutoff)} 전 승인 시 오늘 오후 도착`;
    const w = can('ops');
    let foot = '';
    if (w && (s === 'sent' || s === 'opened')) foot = `<button class="btn" data-act="hold" data-id="${p.pid}">보류 처리</button><button class="btn warn" data-act="remind" data-id="${p.pid}" ${p.remindedAt != null ? 'disabled' : ''}>${icon('send', 13)}${p.remindedAt != null ? '리마인드 발송됨' : '리마인드'}</button><button class="btn primary" data-act="approve" data-id="${p.pid}">${icon('check', 13)}대리 승인</button>`;
    else if (w && s === 'payfail') foot = `<button class="btn" data-act="cancel" data-id="${p.pid}">취소</button><button class="btn bad" data-act="repay" data-id="${p.pid}">${icon('card', 13)}재결제</button>`;
    else if (w && s === 'created') foot = `<button class="btn" data-act="cancel" data-id="${p.pid}">제안 취소</button><button class="btn primary" data-act="sendnow" data-id="${p.pid}">${icon('send', 13)}${p.review ? '검수 후 발송' : '즉시 발송'}</button>`;
    else if (w && s === 'paid') foot = `<button class="btn" data-act="cancel" data-id="${p.pid}">발주 취소</button>`;
    const linkBtn = w ? `<button class="btn sm" data-act="copylink" data-id="${p.pid}">${icon('link', 13)}사장님 링크·메시지</button>` : '';
    dr.innerHTML = `<div class="drawer-h"><div><div class="muted" style="font-size:11.5px">${esc(p.id)} · ${esc(rg.name || '')} · ${esc(st.id)}</div><h2 style="font-size:17px;margin-top:2px">${esc(st.name)}</h2>
        <div class="hstack" style="margin-top:6px"><span class="badge ${({ created: 'b-mute', sent: 'b-warn', opened: 'b-warn', payfail: 'b-bad', paid: 'b-ok', shipped: 'b-line', unloading: 'b-warn', delivered: 'b-ok', hold: 'b-warn', noresp: 'b-warn' })[s] || 'b-mute'}">${esc(orderPhrase(p))}</span>${linkBtn}</div></div>
        <button class="xbtn" data-close-drawer aria-label="닫기">${icon('x', 18)}</button></div>
      <div class="drawer-b">
        <div class="steps">${steps}</div>
        <div><div class="sec-h">발주 품목</div><table class="tbl"><thead><tr><th>SKU</th><th class="r">수량(박스)</th><th class="r">금액</th></tr></thead><tbody>${lines}</tbody><tfoot><tr><td>합계 · ${boxesOf(p)}박스</td><td></td><td class="r">${won(p.amount)}</td></tr></tfoot></table></div>
        <dl class="kv"><dt>결제</dt><dd>${pay}</dd><dt>사장님</dt><dd>${esc(st.owner || '')} ${st.phone ? `<span class="code">${esc(st.phone)}</span>` : '<span class="muted">연락처 없음</span>'}</dd><dt>예상 도착</dt><dd>${eta}</dd></dl>
        <div><div class="sec-h">처리 기록</div><div class="log">${logHtml}</div></div>
      </div>
      ${foot ? `<div class="drawer-f">${foot}</div>` : ''}`;
    dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false');
  }

  /* ---------- ④ 알림톡 모니터 ---------- */
  const NT_ST = { created: ['예약', 'b-mute'], sent: ['발송', 'b-line'], opened: ['열람', 'b-warn'], approve: ['승인', 'b-ok'], hold: ['보류', 'b-warn'], noresp: ['미응답', 'b-bad'] };
  function ntStatus(p) {
    const s = pStatus(p);
    if (s === 'created') return 'created';
    if (s === 'sent' || s === 'opened') return s;
    if (s === 'hold') return 'hold';
    if (s === 'noresp') return 'noresp';
    if (s === 'cancelled') return p.response === 'approve' ? 'approve' : 'noresp';
    return 'approve';
  }
  function viewNotify() {
    const t = nowH();
    const day = state.noti.day;
    const base = DB.P.filter((p) => { const st = S(p.store); return st && inRegion(st.region) && (p.sentAt != null || p.sendAt != null); });
    const sentAtOf = (p) => (p.sentAt != null ? p.sentAt : p.sendAt);
    const today = base.filter((p) => p.sentAt != null && dayOf(p.sentAt) === 0);
    const opened = today.filter((p) => p.openAt != null).length;
    const decided = today.filter((p) => ['approve', 'hold', 'noresp'].includes(ntStatus(p)));
    const appr = decided.filter((p) => ntStatus(p) === 'approve').length;
    const resp = today.filter((p) => p.respondAt != null && p.sentAt != null);
    const avgResp = resp.length ? resp.reduce((a, p) => a + (p.respondAt - p.sentAt) * 60, 0) / resp.length : null;
    const k = kpis();
    const kp = `<section class="kpis k4" aria-label="알림톡 KPI">
      ${kpiTile('nt-sent', '오늘 발송 건수', today.length, '건', `어제 ${base.filter((p) => p.sentAt != null && dayOf(p.sentAt) === -1).length}건 · 발송 예약 ${base.filter((p) => p.sentAt == null && p.sendAt != null && p.status === 'created').length}건`)}
      ${kpiTile('nt-open', '열람률', today.length ? opened / today.length * 100 : null, '', `${opened}/${today.length}건 열람`, { dec: 1, u: '%' })}
      ${kpiTile('nt-appr', '승인율 (이번 주)', k.appr7, '', `오늘 응답 ${decided.length}건 중 승인 ${appr}건 · 목표 ${DB.settings.targets.approval}%`, { dec: 1, u: '%' })}
      ${kpiTile('nt-resp', '평균 응답 시간', avgResp, '분', `오늘 응답 ${resp.length}건 기준`, { dec: 0 })}
    </section>`;
    const list = base.filter((p) => dayOf(sentAtOf(p)) === day).sort((a, b) => sentAtOf(b) - sentAtOf(a));
    const counts = { ALL: list.length }; Object.keys(NT_ST).forEach((key) => { counts[key] = list.filter((p) => ntStatus(p) === key).length; });
    const shown = list.filter((p) => state.noti.filter === 'ALL' || ntStatus(p) === state.noti.filter);
    if (!state.noti.sel || !DB.byId.get(state.noti.sel)) state.noti.sel = (shown[0] || list[0] || {}).pid || null;
    const rows = shown.map((p) => {
      const st = S(p.store), s = ntStatus(p);
      const failed = DB.messages.some((m) => m.proposal_id === p.pid && m.kind === 'propose' && m.status === 'failed');
      return `<tr class="click ${state.noti.sel === p.pid ? 'sel' : ''}" data-noti="${p.pid}">
        <td class="num">${hm(sentAtOf(p))}<span class="sub2">${s === 'created' ? '예약' : p.respondAt != null ? '응답 ' + hm(p.respondAt) : ''}</span></td>
        <td><b class="strong">${esc(st.name)}</b><span class="sub2">${esc((REG[st.region] || {}).name || '')} · ${esc(skuSum(p))}</span></td>
        <td><button class="badge ${NT_ST[s][1]}" data-noti-filter="${s}" title="${NT_ST[s][0]}만 보기">${NT_ST[s][0]}</button>${failed ? '<span class="sub2" style="color:var(--danger)">발송 실패</span>' : pStatus(p) === 'payfail' ? '<span class="sub2" style="color:var(--danger)">결제 실패</span>' : ''}</td>
      </tr>`;
    }).join('');
    const chips = [['ALL', '전체'], ...Object.entries(NT_ST).map(([key, v]) => [key, v[0]])].filter(([key]) => key === 'ALL' || counts[key]).map(([key, nm]) => `<button class="chip" data-noti-filter="${key}" aria-pressed="${state.noti.filter === key}">${nm} <b>${counts[key]}</b></button>`).join('');
    const sel = DB.byId.get(state.noti.sel);
    return `${kp}
      <div class="nt-grid">
        <section class="card nt-list" aria-label="발송 이력">
          <div class="card-h"><h3>발송 이력</h3><div class="seg"><button data-noti-day="0" aria-pressed="${day === 0}">오늘</button><button data-noti-day="-1" aria-pressed="${day === -1}">어제</button><button data-noti-day="-2" aria-pressed="${day === -2}">그제</button></div></div>
          <div class="card-b" style="padding-bottom:8px"><div class="chips">${chips}</div></div>
          <div class="tbl-wrap" data-sk="noti">${rows ? `<table class="tbl"><thead><tr><th>시각</th><th>매장 · 제안</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">${icon('chat', 24)}해당 날짜의 발송 이력이 없습니다</div>`}</div>
        </section>
        <div class="phone-wrap">${sel ? phone(sel) : `<div class="empty">발송 이력을 선택하세요</div>`}</div>
        <div class="nt-meta">${sel ? ntMeta(sel) : ''}</div>
      </div>`;
  }
  function phone(sel) {
    const t = nowH(), st = S(sel.store);
    const msgs = DB.messages.filter((m) => m.store_id === sel.store).map((m) => ({ t: m.t, k: m.kind === 'propose' ? 'alim' : 'bot', m }));
    DB.P.filter((p) => p.store === sel.store && p.respondAt != null).forEach((p) => msgs.push({ t: p.respondAt, k: 'me', text: p.response === 'approve' ? (p.modify ? '수량 수정 후 승인' : '승인') : '보류', ops: String(p.responder || '').startsWith('ops:') }));
    msgs.sort((a, b) => a.t - b.t || (a.k === 'me' ? -1 : 1));
    let lastDay = null;
    const body = msgs.length ? msgs.map((x) => {
      let h = '';
      if (dayOf(x.t) !== lastDay) { lastDay = dayOf(x.t); h += `<div class="ph-day">${mdw(x.t)}${lastDay === 0 ? ' · 오늘' : lastDay === -1 ? ' · 어제' : ''}</div>`; }
      const tm = `<time>${hm(x.t)}</time>`;
      const stTag = x.m && x.m.status !== 'sent' ? ` <span style="color:${x.m.status === 'failed' ? 'var(--danger)' : 'var(--gray)'}">(${x.m.status === 'failed' ? '발송 실패' : '발송 대기'})</span>` : '';
      if (x.k === 'alim') {
        const text = x.m.body.replace(/▶[^\n]*$/m, '').trim();
        h += `<div class="msg"><div class="alim"><div class="alim-h">발주 제안<span>알림톡${stTag}</span></div><div class="alim-b">${esc(text)}</div><div class="alim-btns"><button disabled>발주 확인하기</button></div></div>${tm}</div>`;
      } else if (x.k === 'me') h += `<div class="msg me"><div class="bub">${esc(x.text)}${x.ops ? '<br><small style="opacity:.8">운영자 대리 처리</small>' : ''}</div>${tm}</div>`;
      else h += `<div class="msg"><div class="bub">${esc(x.m.body.replace(/▶[^\n]*$/m, '').trim())}${stTag}</div>${tm}</div>`;
      return h;
    }).join('') : `<div class="ph-day">${sel.sendAt != null ? hm(sel.sendAt) + ' 발송 예약 — 아직 발송 전입니다' : '검수 후 발송 대기 중입니다'}</div>`;
    return `<div class="phone" aria-label="알림톡 대화 미리보기">
      <div class="ph-status"><span>${hm(t)}</span><span class="sig">${icon('signal', 14)}${icon('wifi', 14)}${icon('batt', 16)}</span></div>
      <div class="ph-head"><span class="pf">B</span><div><b>BevFlow 발주알림</b><small>${esc(st.name)} 사장님 화면 미리보기</small></div></div>
      <div class="ph-body" id="phBody">${body}</div></div>`;
  }
  function ntMeta(p) {
    const st = S(p.store);
    const perf = DB.pilot.storePerf.find((x) => x.store === p.store);
    const m = DB.messages.filter((x) => x.proposal_id === p.pid && x.kind === 'propose')[0];
    return `<section class="card"><div class="card-h"><h3>메시지 정보</h3></div><div class="card-b"><dl class="kv" style="grid-template-columns:78px 1fr">
        <dt>발주번호</dt><dd>${esc(p.id)}</dd><dt>템플릿</dt><dd>${esc(m ? m.template : 'BF_PROPOSE_03')}</dd>
        <dt>발송</dt><dd>${p.sentAt != null ? when(p.sentAt) : p.sendAt != null ? '예약 ' + when(p.sendAt) : '검수 대기'}${p.sendRule === 'break' ? '<span class="sub2">브레이크타임 예약</span>' : p.sendRule === 'night' ? '<span class="sub2">야간 생성 → 아침 발송</span>' : ''}</dd>
        <dt>열람</dt><dd>${p.openAt != null ? when(p.openAt) : '—'}</dd>
        <dt>응답</dt><dd>${p.respondAt != null ? when(p.respondAt) + (p.sentAt != null ? `<span class="sub2">발송 후 ${durTxt((p.respondAt - p.sentAt) * 60)}</span>` : '') : pStatus(p) === 'noresp' ? '미응답 (만료)' : '대기 중'}</dd>
        <dt>수신 번호</dt><dd>${m ? esc(m.to_phone || '—') : esc(st.phone || '—')}</dd>
        <dt>채널</dt><dd>${m ? (m.channel === 'console' ? '콘솔 기록 (수동 전달)' : '웹훅 발송') : '—'}${m && m.status !== 'sent' ? ` · ${m.status === 'failed' ? '실패' : '대기'}` : ''}</dd></dl>
        ${can('ops') ? `<div class="hstack" style="margin-top:10px;flex-wrap:wrap"><button class="btn sm" data-act="copylink" data-id="${p.pid}">${icon('copy', 13)}메시지·링크 복사</button><button class="btn sm" data-act="preview" data-id="${p.pid}">${icon('link', 13)}사장님 화면 열기</button></div>` : ''}</div></section>
      <section class="card"><div class="card-h"><h3>매장 응답 패턴</h3></div><div class="card-b"><dl class="kv" style="grid-template-columns:78px 1fr">
        <dt>파일럿 승인</dt><dd>${perf ? `${perf.approved}/${perf.decided}건 · ${pct(perf.approved / Math.max(1, perf.decided) * 100, 0)}` : '—'}</dd>
        <dt>응답 중앙값</dt><dd>${perf && perf.medResp != null ? Math.round(perf.medResp) + '분' : '—'}</dd>
        <dt>발송 방식</dt><dd>${st.breakPref ? '브레이크타임(15:00) 예약' : '즉시 발송'}</dd></dl></div></section>
      <p class="muted" style="font-size:11px;margin:0;line-height:1.6">${DB.settings.notifier === 'console' ? '현재 <b>콘솔 모드</b>입니다. 메시지는 외부로 나가지 않으니 [메시지·링크 복사]로 사장님 카카오톡에 전달하세요. 알림톡 대행사를 연결하면 자동 발송됩니다.' : '웹훅으로 알림톡 대행사에 전달됩니다.'}</p>`;
  }

  /* ---------- ⑤ 배송 관제 ---------- */
  function viewDelivery() {
    const t = nowH();
    const today = DB.stops.filter((s) => s.day === 0 && s.status !== 'failed');
    const pm = pilotMetrics();
    const cap = DB.settings.driverCapacity;
    const days13 = DB.stops.filter((s) => s.day >= -13 && s.day <= -1 && s.status !== 'failed').length / 13;
    const w = can('ops');
    const drivers = REGIONS.map((r) => {
      const ss = today.filter((s) => s.region === r.id).sort((a, b) => a.seq - b.seq);
      const done = ss.filter((s) => s.status === 'done');
      const cur = ss.find((s) => s.status === 'arrived');
      const next = ss.find((s) => s.status === 'pending');
      const avg = done.filter((s) => s.dur != null).length ? done.filter((s) => s.dur != null).reduce((a, s) => a + s.dur, 0) / done.filter((s) => s.dur != null).length : null;
      const wd = ss.length ? done.length / ss.length * 100 : 0;
      const route = DB.routes.find((x) => dateIdx(x.date) === 0 && x.region_id === r.id);
      const nowTxt = cur ? `<span class="badge b-warn">하차 중</span>${esc(S(cur.store).name)}<span class="muted">${Math.round((t - cur.arrive) * 60)}분째</span>`
        : next ? `<span class="badge b-line">다음</span>→ ${esc(S(next.store).name)}<span class="muted">ETA ${hm(next.eta)}</span>`
          : ss.length ? `<span class="badge b-ok">완료</span>오늘 배송 완료<span class="muted">${hm(ss[ss.length - 1].depart)}</span>` : '<span class="badge b-mute">대기</span>오늘 배정 없음';
      return `<section class="card drv" style="${inRegion(r.id) ? '' : 'opacity:.45'}">
        <div class="drv-h">${icon('truck', 16)}<b>${esc(r.driver)} 기사</b><span class="muted" style="font-size:11.5px">${esc(r.name)}</span>${route && w ? `<button class="btn sm" data-act="driverlink" data-route="${route.id}" style="margin-left:auto">${icon('link', 13)}기사 링크</button>` : `<span class="tag">${esc((r.vehicle || '').split(' · ')[1] || r.vehicle || '')}</span>`}</div>
        <div class="drv-n"><div>완료 정차<b>${done.length}<small>/ ${ss.length}</small></b></div><div>평균 정차<b>${avg != null ? num(avg, 1) : '—'}<small>분</small></b></div><div>일 용량 대비<b>${num(ss.length / cap * 100, 0)}<small>% · ${cap}곳</small></b></div></div>
        <div class="bar" style="height:7px"><i style="width:${wd}%"></i></div>
        <div class="drv-now">${nowTxt}</div></section>`;
    }).join('');
    const scope = state.del.scope;
    const durs = scope === '2w' ? DB.stops.filter((s) => s.status === 'done' && s.dur != null && s.day >= -13).map((s) => s.dur) : null;
    const bins = []; for (let b = 3; b <= 12; b++) bins.push({ lo: b, n: 0 });
    if (durs) durs.forEach((d) => { bins[Math.max(0, Math.min(9, Math.floor(d) - 3))].n++; });
    else DB.pilot.hist.forEach((h) => { bins[Math.max(0, Math.min(9, h.b - 3))].n += h.c; });
    const total = bins.reduce((a, b) => a + b.n, 0);
    const mean = durs ? (durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null) : (() => { const all = pm.weeks.reduce((a, x) => a + x.stopSum, 0), n = pm.weeks.reduce((a, x) => a + x.stops, 0); return n ? all / n : null; })();
    const sorted = durs ? durs.slice().sort((a, b) => a - b) : [];
    const stopRows = DB.stops.filter((s) => s.day === 0 && inRegion(s.region)).sort((a, b) => a.region.localeCompare(b.region) || a.seq - b.seq).map((s) => {
      const st = S(s.store);
      const label = { pending: ['대기', 'b-mute'], arrived: ['하차 중', 'b-warn'], done: ['완료', 'b-ok'], failed: ['실패', 'b-bad'] }[s.status];
      const acts = !w ? '' : s.status === 'pending' ? `<button class="btn sm" data-act="stoparrive" data-id="${s.sid}">도착</button> <button class="btn sm" data-act="stopdone" data-id="${s.sid}">하차 완료</button> <button class="btn sm bad" data-act="stopfail" data-id="${s.sid}">실패</button>`
        : s.status === 'arrived' ? `<button class="btn sm primary" data-act="stopdone" data-id="${s.sid}">하차 완료</button> <button class="btn sm bad" data-act="stopfail" data-id="${s.sid}">실패</button>` : '';
      return `<tr><td>${esc((REG[s.region] || {}).name || s.region)} · ${s.seq}</td><td><b class="strong">${esc(st ? st.name : '')}</b><span class="sub2">${esc(st ? st.address || '' : '')}</span></td><td class="num">${hm(s.eta)}</td><td class="r num">${s.boxes}</td><td><span class="badge ${label[1]}">${label[0]}</span>${s.failReason ? `<span class="sub2">${esc(s.failReason)}</span>` : ''}</td><td class="num">${s.dur != null ? num(s.dur, 1) + '분' : '—'}</td><td class="r">${acts}</td></tr>`;
    }).join('');
    const pendingPaid = DB.P.filter((p) => p.status === 'paid' && p.deliverDay != null && p.deliverDay <= 0).length;
    return `<div class="cutoff">
        <span class="pill">${icon('clock', 14)}<b>${hm(DB.settings.cutoff)} 이전 승인 → 당일 도착</b></span><span class="pill"><b>이후 승인 → 다음 배송일 오후</b></span>
        <span class="muted">출고·배차 ${hm(DB.settings.dispatch)} (자동) · 오늘 ${today.length}곳 (${REGIONS.map((r) => esc(r.name) + ' ' + today.filter((s) => s.region === r.id).length).join(' · ')})</span>
        ${w ? `<button class="btn sm" data-act="dispatch" style="margin-left:auto" ${pendingPaid ? '' : 'title="배차 대기 발주 없음"'}>${icon('truck', 13)}지금 배차 실행${pendingPaid ? ` (${pendingPaid}건)` : ''}</button>` : ''}</div>
      <div class="dl-grid">
        <section class="card" aria-label="권역 라우트 뷰">
          <div class="card-h"><h3>권역 라우트 <span class="sub">거점 중심 · 번호는 방문 순서</span></h3>
            <div class="legend"><span><i class="lg-dot" style="background:var(--main);border-color:var(--main)"></i>배송 완료</span><span><i class="lg-dot" style="background:var(--sub);border-color:var(--sub)"></i>진행 중</span><span><i class="lg-dot" style="background:var(--gray);border-color:var(--gray)"></i>대기</span><span><i class="lg-dot" style="width:6px;height:6px;border-color:var(--gray)"></i>오늘 배송 없음</span></div></div>
          <div style="padding:0 10px 8px">${REGIONS.length ? routeMap(t) : '<div class="empty">권역이 없습니다</div>'}</div>
        </section>
        <div style="display:flex;flex-direction:column;gap:10px">${drivers || '<div class="empty">기사가 없습니다</div>'}</div>
      </div>
      <section class="card" aria-label="오늘 정차 목록"><div class="card-h"><h3>오늘 정차 목록 <span class="sub">기사가 휴대폰을 못 쓸 때 운영자가 대신 처리</span></h3></div>
        <div class="tbl-wrap">${stopRows ? `<table class="tbl"><thead><tr><th>권역·순서</th><th>매장</th><th>ETA</th><th class="r">박스</th><th>상태</th><th>정차</th><th class="r">조치</th></tr></thead><tbody>${stopRows}</tbody></table>` : `<div class="empty">${icon('truck', 22)}오늘 배차된 정차가 없습니다</div>`}</div></section>
      <div class="dl-bottom">
        <section class="card" aria-label="정차 시간 분포">
          <div class="card-h"><h3>정차 시간 분포 <span class="sub">검증 지표 ③ · 도착~하차·잔량 확인 완료</span></h3>
            <div class="seg"><button data-del-scope="2w" aria-pressed="${scope === '2w'}">최근 2주</button><button data-del-scope="all" aria-pressed="${scope === 'all'}">파일럿 전체</button></div></div>
          <div class="card-b" style="display:grid;grid-template-columns:minmax(0,1fr) 168px;gap:14px;align-items:center">
            <div>${total ? histogram(bins, mean) : '<div class="empty">완료된 정차가 없습니다</div>'}</div>
            <dl class="kv" style="grid-template-columns:auto 1fr;font-size:12px;white-space:nowrap"><dt>정차 수</dt><dd class="num">${num(total)}회</dd><dt>평균</dt><dd class="num"><b>${mean != null ? num(mean, 1) + '분' : '—'}</b></dd>${durs ? `<dt>중앙값</dt><dd class="num">${sorted.length ? num(sorted[Math.floor(sorted.length / 2)], 1) + '분' : '—'}</dd><dt>P90</dt><dd class="num">${sorted.length ? num(sorted[Math.floor(sorted.length * .9)], 1) + '분' : '—'}</dd><dt>7분 이내</dt><dd class="num">${sorted.length ? pct(sorted.filter((d) => d <= 7).length / sorted.length * 100, 0) : '—'}</dd>` : ''}<dt>목표</dt><dd>평균 ≤ ${DB.settings.targets.stop}분 ${mean != null ? `<span class="badge ${mean <= DB.settings.targets.stop ? 'b-ok' : 'b-bad'}">${mean <= DB.settings.targets.stop ? '달성' : '미달'}</span>` : ''}</dd></dl>
          </div>
        </section>
        <section class="card cap" aria-label="배송 용량">
          <div class="card-h"><h3>배송 용량 <span class="sub">설계 대비</span></h3></div>
          <div class="card-b">
            <dl><dt>설계 용량 (1인 1일)</dt><dd>${cap}곳</dd><dt>최근 2주 일 평균 정차 (전체)</dt><dd>${num(days13, 1)}곳</dd><dt>정차당 평균 하차</dt><dd>${num(pm.avgBoxes, 1)}박스</dd><dt>현재 가동률 (${REGIONS.length}명 기준)</dt><dd>${pct(days13 / Math.max(1, cap * REGIONS.length) * 100)}</dd></dl>
            <div class="formula">정차 ${pm.stop2 != null ? num(pm.stop2, 1) : '—'}분 × ${cap}곳 ≈ ${pm.stop2 != null ? num(pm.stop2 * cap / 60, 1) : '—'}시간 (+ 권역 내 이동)<br>현 인력 수용 한도 (주 1회 배송)<br>${REGIONS.length}명 × ${cap}곳 × 주 ${DB.settings.deliveryDays.length}일 ≈ <b>${num(REGIONS.length * cap * DB.settings.deliveryDays.length)}개 매장</b></div>
          </div>
        </section>
      </div>`;
  }
  let CHART_ROUTE = [], CHART_BARS = [];
  function routeMap(t) {
    const n = REGIONS.length, W = 690, Hh = 318, R = Math.min(102, 690 / n / 2 - 14), cy = 150;
    const cxs = REGIONS.map((_, i) => (W / n) * (i + .5));
    const g = [], nodes = [];
    REGIONS.forEach((r, i) => {
      const cx = cxs[i], on = inRegion(r.id);
      g.push(`<g opacity="${on ? 1 : .3}">`);
      g.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="var(--main)" fill-opacity=".035" stroke="var(--line)" stroke-width="1.2"/>`);
      g.push(`<circle cx="${cx}" cy="${cy}" r="${R / 2}" fill="none" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3"/>`);
      g.push(`<text x="${cx + R * .7}" y="${cy + R * .74 + 12}" font-size="9.5" fill="var(--gray)">${num(r.radius, 0)}km</text>`);
      const ss = DB.stops.filter((s) => s.day === 0 && s.region === r.id && s.status !== 'failed').sort((a, b) => a.seq - b.seq);
      const done = ss.filter((s) => s.status === 'done').length;
      g.push(`<text x="${cx}" y="${cy - R - 26}" font-size="13" font-weight="600" fill="var(--ink)" text-anchor="middle" style="font-family:var(--serif)">${esc(r.name)}</text>`);
      g.push(`<text x="${cx}" y="${cy - R - 11}" font-size="10.5" fill="var(--gray)" text-anchor="middle">${esc(r.area)} · ■ ${esc(r.hub)}</text>`);
      g.push(`<text x="${cx}" y="${cy + R + 22}" font-size="11.5" fill="var(--ink)" text-anchor="middle">완료 <tspan font-weight="700">${done}</tspan> / ${ss.length} 정차 · ${esc(r.driver)}</text>`);
      const pos = (st) => ({ x: cx + Math.cos(st.angle) * st.radius * R, y: cy + Math.sin(st.angle) * st.radius * R }); // angle = atan2(−북쪽, 동쪽) → SVG에서 북쪽이 위
      DB.stores.filter((st) => st.region === r.id && st.active && !ss.some((s) => s.store === st.idx)).forEach((st) => {
        const p = pos(st);
        g.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.4" fill="var(--paper)" stroke="var(--gray)" stroke-width="1" stroke-opacity=".7"/>`);
        nodes.push({ x: p.x, y: p.y, r: 3.4, html: `<div class="tt">${esc(st.name)} · ${esc(st.id)}</div><div class="tr">오늘 배송 없음</div>` });
      });
      let px = cx, py = cy;
      ss.forEach((s) => {
        const p = pos(S(s.store));
        const doneLeg = s.status !== 'pending';
        g.push(`<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${doneLeg ? 'var(--main)' : 'var(--gray)'}" stroke-width="${doneLeg ? 1.6 : 1.1}" ${doneLeg ? '' : 'stroke-dasharray="3 3"'} stroke-opacity="${doneLeg ? .8 : .7}"/>`);
        px = p.x; py = p.y;
      });
      g.push(`<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" rx="2" fill="var(--ink)"/>`);
      const cur = ss.find((s) => s.status === 'arrived'), next = ss.find((s) => s.status === 'pending');
      ss.forEach((s) => {
        const st = S(s.store), p = pos(st);
        const status = s.status === 'done' ? 'done' : (s === cur || (!cur && s === next)) ? 'cur' : 'wait';
        g.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" fill="${({ done: 'var(--main)', cur: 'var(--sub)', wait: 'var(--gray)' })[status]}" stroke="var(--paper)" stroke-width="2"/>`);
        g.push(`<text x="${p.x.toFixed(1)}" y="${(p.y + 3.4).toFixed(1)}" font-size="9" fill="#fff" font-weight="700" text-anchor="middle">${s.seq}</text>`);
        nodes.push({ x: p.x, y: p.y, r: 8, html: `<div class="tt">${s.seq}번째 정차 · ${esc(r.name)}</div><div class="tr"><b>${esc(st.name)}</b></div><div class="tr"><span>${status === 'done' ? `도착 ${hm(s.arrive)} · 완료 ${hm(s.depart)}` : `도착 예정 ${hm(s.eta)}`}</span></div><div class="tr"><span>하차 ${s.boxes}박스${s.dur != null ? ` · 정차 ${num(s.dur, 1)}분` : ''}</span></div>` });
      });
      if (cur && on) { const p = pos(S(cur.store)); g.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" fill="none" stroke="var(--sub)" stroke-width="1.5" stroke-opacity=".5"><animate attributeName="r" values="8;13;8" dur="2s" repeatCount="indefinite"/></circle>`); }
      g.push('</g>');
    });
    CHART_ROUTE = nodes;
    return `<svg class="chart" id="routeMap" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="권역별 오늘 배송 라우트">${g.join('')}</svg>`;
  }
  function histogram(bins, mean) {
    const W = 600, Hh = 206, ml = 34, mr = 12, mt = 24, mb = 30;
    const maxN = Math.max(1, ...bins.map((b) => b.n));
    const stepY = maxN > 150 ? 50 : maxN > 60 ? 20 : maxN > 30 ? 10 : 5;
    const ymax = Math.ceil(maxN * 1.1 / stepY) * stepY;
    const total = bins.reduce((a, b) => a + b.n, 0);
    const x = (v) => ml + (v - 3) / 10 * (W - ml - mr);
    const y = (v) => mt + (1 - v / ymax) * (Hh - mt - mb);
    const g = [];
    for (let v = 0; v <= ymax; v += stepY) {
      g.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>`);
      g.push(`<text x="${ml - 7}" y="${y(v) + 3.5}" font-size="10.5" fill="var(--gray)" text-anchor="end">${v}</text>`);
    }
    const bw = Math.min(24, (W - ml - mr) / 10 - 10);
    CHART_BARS = [];
    const target = DB.settings.targets.stop;
    bins.forEach((b, i) => {
      const cx = x(b.lo + .5), h = y(0) - y(b.n);
      if (b.n) g.push(`<path d="M${cx - bw / 2},${y(0)} v${-(Math.max(4, h) - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(4, h) - 4} z" fill="var(--main)" fill-opacity="${b.lo >= target ? .45 : 1}" class="hbar" data-i="${i}"/>`);
      if (b.n) g.push(`<text x="${cx}" y="${y(b.n) - 5}" font-size="10" fill="var(--gray)" text-anchor="middle">${b.n}</text>`);
      g.push(`<text x="${cx}" y="${Hh - mb + 15}" font-size="10.5" fill="var(--gray)" text-anchor="middle">${b.lo === 12 ? '12+' : b.lo + '–' + (b.lo + 1)}</text>`);
      CHART_BARS.push({ x: cx - (W - ml - mr) / 20, w: (W - ml - mr) / 10, html: `<div class="tt">정차 ${b.lo === 12 ? '12분 이상' : b.lo + '~' + (b.lo + 1) + '분'}</div><div class="tr"><b>${b.n}회</b><span>${pct(b.n / Math.max(1, total) * 100)}</span></div>` });
    });
    g.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(0)}" y2="${y(0)}" stroke="var(--gray)"/>`);
    g.push(`<text x="${W - mr}" y="${Hh - 2}" font-size="10" fill="var(--gray)" text-anchor="end">분</text>`);
    g.push(`<line x1="${x(target)}" x2="${x(target)}" y1="${mt - 10}" y2="${y(0)}" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    g.push(`<text x="${x(target) + 5}" y="${mt - 2}" font-size="10.5" fill="var(--danger)" font-weight="600">목표 ${target}분</text>`);
    if (mean != null) {
      g.push(`<line x1="${x(Math.max(3, Math.min(13, mean)))}" x2="${x(Math.max(3, Math.min(13, mean)))}" y1="${mt - 10}" y2="${y(0)}" stroke="var(--ink)" stroke-width="1.5"/>`);
      g.push(`<text x="${x(Math.max(3, Math.min(13, mean))) - 5}" y="${mt - 2}" font-size="10.5" fill="var(--ink)" font-weight="600" text-anchor="end">평균 ${num(mean, 1)}분</text>`);
    }
    return `<svg class="chart" id="histChart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="정차 시간 분포 히스토그램">${g.join('')}</svg>`;
  }

  /* ---------- ⑥ 파일럿 리포트 ---------- */
  let CHART_MINI = {};
  function miniLine(id, valsAll, opt) {
    const vals = valsAll.map((v) => (v == null ? null : v));
    const known = vals.filter((v) => v != null);
    const W = 360, Hh = 148, ml = 34, mr = 46, mt = 16, mb = 24;
    if (known.length < 1) return `<div class="empty" style="height:${Hh}px">데이터가 쌓이면 표시됩니다</div>`;
    const lo = Math.min(opt.target, ...known), hi = Math.max(opt.target, ...known);
    const pad = (hi - lo) * .25 || 1;
    const y0 = Math.max(0, Math.floor((lo - pad) / opt.step) * opt.step), y1 = Math.ceil((hi + pad) / opt.step) * opt.step;
    const x = (i) => ml + (vals.length === 1 ? .5 : i / (vals.length - 1)) * (W - ml - mr);
    const y = (v) => mt + (1 - (v - y0) / (y1 - y0)) * (Hh - mt - mb);
    const g = [];
    for (let v = y0; v <= y1 + 1e-9; v += opt.step) {
      g.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/>`);
      g.push(`<text x="${ml - 6}" y="${y(v) + 3.5}" font-size="10" fill="var(--gray)" text-anchor="end">${num(v, opt.dec)}</text>`);
    }
    vals.forEach((v, i) => g.push(`<text x="${x(i)}" y="${Hh - 7}" font-size="10" fill="${i === vals.length - 1 ? 'var(--ink)' : 'var(--gray)'}" text-anchor="middle">W${opt.first + i}</text>`));
    g.push(`<line x1="${ml}" x2="${W - mr}" y1="${y(opt.target)}" y2="${y(opt.target)}" stroke="var(--sub)" stroke-width="1.5" stroke-dasharray="5 4"/>`);
    g.push(`<text x="${W - mr + 5}" y="${y(opt.target) + 3.5}" font-size="10" fill="var(--sub)" font-weight="600">목표 ${num(opt.target, opt.dec)}</text>`);
    const segs = []; let cur = [];
    vals.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); });
    if (cur.length) segs.push(cur);
    segs.forEach((s) => { if (s.length > 1) g.push(`<path d="M${s.map((p) => p.join(',')).join('L')}" fill="none" stroke="var(--main)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`); });
    vals.forEach((v, i) => { if (v != null) g.push(`<circle cx="${x(i)}" cy="${y(v)}" r="${i === vals.length - 1 ? 5 : 4}" fill="${i === vals.length - 1 ? 'var(--main)' : 'var(--paper)'}" stroke="${i === vals.length - 1 ? 'var(--paper)' : 'var(--main)'}" stroke-width="2"/>`); });
    const li = vals.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
    g.push(`<text x="${x(li)}" y="${y(vals[li]) + (opt.better === 'down' ? 18 : -10)}" font-size="11" fill="var(--ink)" font-weight="700" text-anchor="middle">${num(vals[li], 1)}${opt.unit}</text>`);
    g.push(`<rect class="mhit" data-mini="${id}" x="${ml}" y="${mt}" width="${W - ml - mr}" height="${Hh - mt - mb}" fill="transparent"/>`);
    g.push(`<line class="mcx" id="mcx-${id}" x1="0" x2="0" y1="${mt}" y2="${Hh - mb}" stroke="var(--ink)" stroke-opacity=".3" visibility="hidden"/>`);
    CHART_MINI[id] = { vals, x, W, ml, mr, opt };
    return `<svg class="chart" id="mini-${id}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${opt.label} 주차별 추이">${g.join('')}</svg>`;
  }
  function viewReport() {
    const pm = pilotMetrics(), T = DB.settings.targets;
    const WK = pm.weeks;
    const show = WK.slice(-8), first = WK.length - show.length + 1;
    const badge = (v, ok) => (v == null ? '<span class="badge b-mute">표본 부족</span>' : `<span class="badge ${ok ? 'b-ok' : 'b-bad'}">${ok ? '목표 달성' : '목표 미달'}</span>`);
    const tbar = (v, target, max) => `<div class="target-bar"><div style="position:absolute;inset:0 auto 0 0;width:${Math.min(100, (v || 0) / max * 100)}%;background:var(--main);border-radius:3px"></div><div style="position:absolute;top:-4px;bottom:-4px;left:${target / max * 100}%;border-left:1.5px dashed var(--sub)"></div></div>`;
    const w1 = WK[0], wl = WK[WK.length - 1];
    const cards = `<div class="rp-cards">
      <section class="card metric"><div class="metric-h"><span class="rank top">1</span><h3>재고 추정 오차</h3>${badge(pm.err2, pm.err2 <= T.error)}</div>
        <div class="metric-v">${pm.err2 != null ? num(pm.err2, 1) : '—'}<small>%</small></div>${tbar(pm.err2, T.error, Math.max(20, T.error * 2))}
        <div class="metric-s"><span>목표 <b>≤ ${T.error}%</b></span><span>실사 대비 평균 편차 · n=${num(pm.errN)}</span></div>
        <div class="metric-s"><span>W1 ${pct(w1.err)} → W${WK.length} ${pct(wl.err)}</span><span>밴드 적중률 <b>${pct(pm.hit2, 0)}</b></span></div></section>
      <section class="card metric"><div class="metric-h"><span class="rank top">2</span><h3>카톡 승인율</h3>${badge(pm.appr2, pm.appr2 >= T.approval)}</div>
        <div class="metric-v">${pm.appr2 != null ? num(pm.appr2, 1) : '—'}<small>%</small></div>${tbar(pm.appr2, T.approval, 100)}
        <div class="metric-s"><span>목표 <b>≥ ${T.approval}%</b></span><span>응답 완료 제안 n=${pm.apprN}</span></div>
        <div class="metric-s"><span>W1 ${pct(w1.appr)} → W${WK.length} ${pct(wl.appr)}</span><span>파일럿 누적 <b>${pct(pm.apprCum)}</b></span></div></section>
      <section class="card metric"><div class="metric-h"><span class="rank top">3</span><h3>평균 정차 시간</h3>${badge(pm.stop2, pm.stop2 <= T.stop)}</div>
        <div class="metric-v">${pm.stop2 != null ? num(pm.stop2, 1) : '—'}<small>분</small></div>${tbar(pm.stop2, T.stop, Math.max(10, T.stop * 1.5))}
        <div class="metric-s"><span>목표 <b>≤ ${T.stop}분</b></span><span>정차 n=${pm.stopN}${pm.stopP90 != null ? ' · P90 ' + num(pm.stopP90, 1) + '분' : ''}</span></div>
        <div class="metric-s"><span>W1 ${w1.stop != null ? num(w1.stop, 1) + '분' : '—'} → W${WK.length} ${wl.stop != null ? num(wl.stop, 1) + '분' : '—'}</span><span>7분 이내 <b>${pct(pm.stopIn, 0)}</b></span></div></section>
    </div>`;
    CHART_MINI = {};
    const trend = `<section class="card" aria-label="주차별 추이">
      <div class="card-h"><h3>주차별 추이 <span class="sub">W${first}–W${WK.length} · 지표별 개별 축 · 마지막 주는 진행 중</span></h3><span class="muted" style="font-size:11.5px">판정 기준: 최근 2주</span></div>
      <div class="trend3">
        <div><h4>① 재고 추정 오차 <span>% · 낮을수록 좋음</span></h4>${miniLine('err', show.map((w) => w.err), { target: T.error, step: 2, dec: 0, unit: '%', better: 'down', label: '재고 추정 오차', first })}</div>
        <div><h4>② 카톡 승인율 <span>% · 높을수록 좋음</span></h4>${miniLine('appr', show.map((w) => w.appr), { target: T.approval, step: 5, dec: 0, unit: '%', better: 'up', label: '카톡 승인율', first })}</div>
        <div><h4>③ 평균 정차 시간 <span>분 · 낮을수록 좋음</span></h4>${miniLine('stop', show.map((w) => w.stop), { target: T.stop, step: 1, dec: 0, unit: '분', better: 'down', label: '평균 정차 시간', first })}</div>
      </div></section>`;
    let totG = 0, totF = 0, totN = 0;
    const srows = DB.settlements.slice().reverse().map((w) => {
      totG += w.gmv; totF += w.fee; totN += w.orders;
      const payIdx = dateIdx(w.pay_date);
      const status = w.status === 'open' ? ['집계 중', 'b-mute'] : w.status === 'paid' ? ['지급 완료', 'b-ok'] : payIdx === 0 ? ['오늘 지급', 'b-warn'] : payIdx < 0 ? ['지급 확인 필요', 'b-bad'] : ['정산 예정', 'b-line'];
      return `<tr><td style="white-space:nowrap"><b class="strong">W${w.week}</b> <span class="muted">${md(dateIdx(w.start) * 24)}–${md(dateIdx(w.end) * 24)}</span></td><td class="r num">${num(w.orders)}</td><td class="r num">${won(w.gmv)}</td><td class="r num strong">${won(w.fee)}</td><td class="num">${mdw(payIdx * 24)}</td><td><span class="badge ${status[1]}">${status[0]}</span></td>
        <td class="r" style="white-space:nowrap"><a class="btn sm" href="/api/settlements/${esc(w.start)}/csv" download>${icon('download', 13)}CSV</a>${can('admin') && w.status === 'closed' ? ` <button class="btn sm" data-act="settlepaid" data-week="${esc(w.start)}">지급 완료</button>` : ''}</td></tr>`;
    }).join('');
    const settle = `<section class="card" aria-label="티오더 정산 요약">
      <div class="card-h"><h3>티오더 정산 <span class="sub">수수료 ${num(DB.settings.feeRate * 100, 1)}% · 결제 완료 기준 · VAT 별도</span></h3></div>
      <div class="tbl-wrap" style="max-height:340px" data-sk="settle"><table class="tbl"><thead><tr><th>기간</th><th class="r">발주</th><th class="r">발생 GMV</th><th class="r">수수료</th><th>정산 예정일</th><th>상태</th><th class="r">내역서</th></tr></thead><tbody>${srows}</tbody>
      <tfoot><tr><td>파일럿 누계</td><td class="r num">${num(totN)}</td><td class="r num">${won(totG)}</td><td class="r num">${won(totF)}</td><td colspan="3"></td></tr></tfoot></table></div>
    </section>`;
    const perf = DB.pilot.storePerf.filter((x) => { const s = S(x.store); return s && inRegion(s.region) && x.decided >= 4; }).map((x) => ({ ...x, st: S(x.store), rate: x.approved / x.decided * 100 }));
    perf.sort((a, b) => b.rate - a.rate || (a.medResp ?? 99) - (b.medResp ?? 99));
    const top = perf.slice(0, 5), low = perf.slice(-5).reverse();
    const prow = (x, rank, kind) => `<tr class="click" data-go="inv:${x.st.idx}:"><td><span class="rank ${kind}">${rank}</span></td><td><b class="strong">${esc(x.st.name)}</b><span class="sub2">${esc((REG[x.st.region] || {}).name || '')} · ${esc(x.st.id)}</span></td><td class="r num">${x.decided}</td><td class="r num strong">${pct(x.rate, 0)}</td><td class="r num">${x.medResp != null ? Math.round(x.medResp) + '분' : '—'}</td><td>${kind === 'top' ? (x.st.breakPref ? '<span class="tag">브레이크타임 발송</span>' : '<span class="tag">즉시 응답형</span>') : `${x.holds ? `<span class="badge b-warn">보류 ${x.holds}</span> ` : ''}${x.nones ? `<span class="badge b-bad">미응답 ${x.nones}</span>` : ''}`}</td></tr>`;
    const perfT = `<section class="card" aria-label="매장별 성과">
      <div class="card-h"><h3>매장별 성과 <span class="sub">승인율 · 제안 4건 이상 ${perf.length}곳</span></h3><div class="seg"><button data-perf="top" aria-pressed="${state.rep.perf === 'top'}">상위 5</button><button data-perf="low" aria-pressed="${state.rep.perf === 'low'}">하위 5</button></div></div>
      <div class="tbl-wrap">${perf.length ? `<table class="tbl"><thead><tr><th style="width:34px">순위</th><th>매장</th><th class="r">제안</th><th class="r">승인율</th><th class="r">응답 중앙값</th><th>${state.rep.perf === 'top' ? '특징' : '원인'}</th></tr></thead>
      <tbody>${state.rep.perf === 'top' ? top.map((x, i) => prow(x, i + 1, 'top')).join('') : low.map((x, i) => prow(x, perf.length - i, 'low')).join('')}</tbody></table>` : '<div class="empty">아직 표본이 부족합니다</div>'}</div>
    </section>`;
    return `<div class="cutoff"><span class="pill">${icon('report', 14)}파일럿 <b>W1–W${WK.length}</b> · ${md(DB.pilotStartH)} – ${md(0)} · 매장 ${DB.pilot.activeStores}곳</span>
        <span class="muted" style="margin-left:auto">매장당 월 GMV <b style="color:var(--ink)">${num(pm.monthlyPerStore / 10000, 1)}만 원</b> · 박스 단가 <b style="color:var(--ink)">${num(Math.round(pm.avgPrice))}원</b> · 회당 ${num(pm.avgBoxes, 1)}박스</span></div>
      ${cards}${trend}<div class="rp-bottom">${settle}${perfT}</div>`;
  }

  /* ---------- ⑦ 관리 ---------- */
  const SUBS = [['stores', '매장'], ['skus', 'SKU·메뉴 매핑'], ['drivers', '기사·권역'], ['users', '계정'], ['settings', '운영 설정'], ['integrations', '데이터 연동']];
  async function loadAdmin() {
    state.adm.loading = true;
    try { state.adm.data = await api('GET', '/api/admin/data'); } catch (e) { toast(esc(e.message), 'alert'); state.adm.data = { error: e.message }; }
    state.adm.loading = false;
    if (state.tab === 'admin') render();
  }
  function viewAdmin() {
    const d = state.adm.data;
    const nav = `<div class="subnav">${SUBS.filter(([id]) => (id === 'users' || id === 'settings' ? can('admin') : true)).map(([id, nm]) => `<button data-adm="${id}" ${state.adm.sub === id ? 'aria-current="page"' : ''}>${nm}${id === 'skus' && DB.unmapped ? ` <span class="badge b-warn">미매핑 ${DB.unmapped}</span>` : ''}</button>`).join('')}</div>`;
    if (!can('ops')) return nav + '<div class="empty">관리 화면은 운영자 이상 권한이 필요합니다</div>';
    if (!d) return nav + `<div class="card"><div class="card-b" style="padding-top:14px"><div class="skel-line" style="width:60%"></div><br><div class="skel-line" style="width:80%"></div></div></div>`;
    if (d.error) return nav + `<div class="alert-line bad">${esc(d.error)}</div>`;
    return nav + ({ stores: admStores, skus: admSkus, drivers: admDrivers, users: admUsers, settings: admSettings, integrations: admIntegrations }[state.adm.sub] || admStores)(d);
  }
  function admStores(d) {
    const q = state.adm.q.trim();
    const sk = new Map(); d.storeSkus.forEach((x) => { if (!sk.has(x.store_id)) sk.set(x.store_id, []); if (x.carried) sk.get(x.store_id).push(x); });
    const rows = d.stores.filter((s) => !q || s.name.includes(q) || s.code.includes(q) || (s.pos_store_id || '').includes(q)).map((s) => {
      const items = sk.get(s.id) || [];
      const onb = items.some((i) => i.last_count_at);
      return `<tr><td class="num">${esc(s.code)}</td><td><b class="strong">${esc(s.name)}</b><span class="sub2">${esc(s.address || '')}</span></td><td>${esc((REG[s.region_id] || {}).name || s.region_id)}</td>
        <td>${esc(s.owner_name || '')}<span class="sub2">${esc(s.owner_phone || '연락처 없음')}</span></td><td>${s.pos_store_id ? `<span class="code">${esc(s.pos_store_id)}</span>` : '<span class="badge b-warn">미연결</span>'}</td>
        <td>${items.length}종 ${onb ? '' : '<span class="badge b-mute">실사 전</span>'}</td><td>${s.send_pref === 'break' ? '브레이크타임' : '즉시'}${s.review_required ? ' · <span class="badge b-warn">검수</span>' : ''}</td>
        <td>${s.active ? '<span class="badge b-ok">운영</span>' : '<span class="badge b-mute">중지</span>'}</td>
        <td class="r" style="white-space:nowrap"><button class="btn sm" data-act="editstore" data-id="${s.id}">${icon('edit', 13)}편집</button> <button class="btn sm" data-act="storeskus" data-id="${s.id}">SKU</button> <button class="btn sm" data-act="count" data-store="${s.id}" ${onb ? '' : 'data-onb="1"'}>잔량</button></td></tr>`;
    }).join('');
    return `<section class="card"><div class="card-h"><h3>매장 <span class="sub">${d.stores.length}곳</span></h3><div class="hstack"><input class="inp" id="admQ" placeholder="매장명·코드·티오더 ID 검색" value="${esc(state.adm.q)}" style="width:220px"><button class="btn primary" data-act="editstore">${icon('plus', 13)}매장 등록</button></div></div>
      <div class="tbl-wrap" data-sk="adm-stores">${rows ? `<table class="tbl"><thead><tr><th>코드</th><th>매장</th><th>권역</th><th>사장님</th><th>티오더 ID</th><th>취급 SKU</th><th>발송</th><th>상태</th><th class="r"></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">등록된 매장이 없습니다 — [매장 등록] 또는 [데이터 연동 → CSV 가져오기]</div>'}</div></section>
      <p class="muted" style="font-size:11.5px">새 매장은 ① 등록 → ② 취급 SKU 지정 → ③ 초기 잔량 입력 순서로 온보딩합니다. 초기 잔량을 넣은 시점부터 재고 추정과 발주 제안이 시작됩니다.</p>`;
  }
  function admSkus(d) {
    const rows = d.skus.map((k) => `<tr><td class="num">${esc(k.id)}</td><td><b class="strong">${esc(k.name)}</b></td><td class="r num">${k.pack}${esc(k.unit)}</td><td class="r num">${won(k.price)}</td><td>${k.active ? '<span class="badge b-ok">판매</span>' : '<span class="badge b-mute">중지</span>'}</td><td class="r"><button class="btn sm" data-act="editsku" data-id="${esc(k.id)}">${icon('edit', 13)}편집</button></td></tr>`).join('');
    const maps = d.menuMap.map((m) => `<tr><td>${esc(m.menu_name)}</td><td>${m.store_id ? esc(m.store_name) : '<span class="muted">전체 매장</span>'}</td><td>${esc(skuName(m.sku_id))}</td><td class="r num">×${num(m.units, 2)}</td><td class="r"><button class="btn sm" data-act="delmap" data-id="${m.id}">삭제</button></td></tr>`).join('');
    const un = d.unmapped.map((u) => `<tr><td><b class="strong">${esc(u.menu_name)}</b></td><td>${esc(u.store_name)} <span class="muted">${esc(u.store_code)}</span></td><td class="r num">${num(u.qty)}</td><td>${when(H(u.last_seen))}</td><td class="r"><button class="btn sm primary" data-act="addmap" data-menu="${esc(u.menu_name)}" data-store="${u.store_id}">매핑</button></td></tr>`).join('');
    return `<div class="rp-bottom" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)">
      <section class="card"><div class="card-h"><h3>SKU <span class="sub">${d.skus.length}종 · 박스 단가</span></h3><button class="btn primary" data-act="editsku">${icon('plus', 13)}SKU 추가</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>코드</th><th>SKU</th><th class="r">입수</th><th class="r">박스 단가</th><th>상태</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <div style="display:flex;flex-direction:column;gap:14px">
        <section class="card"><div class="card-h"><h3>미매핑 POS 메뉴 <span class="sub">매핑 전까지 재고에 반영되지 않음</span></h3></div>
          <div class="tbl-wrap">${un ? `<table class="tbl"><thead><tr><th>POS 메뉴명</th><th>매장</th><th class="r">판매 수량</th><th>마지막</th><th></th></tr></thead><tbody>${un}</tbody></table>` : `<div class="empty">${icon('check', 22)}미매핑 메뉴가 없습니다</div>`}</div></section>
        <section class="card"><div class="card-h"><h3>메뉴 → SKU 매핑 <span class="sub">${d.menuMap.length}건 · 세트 메뉴는 SKU별로 여러 줄</span></h3><button class="btn" data-act="addmap">${icon('plus', 13)}매핑 추가</button></div>
          <div class="tbl-wrap" style="max-height:360px">${maps ? `<table class="tbl"><thead><tr><th>POS 메뉴명</th><th>적용</th><th>SKU</th><th class="r">수량</th><th></th></tr></thead><tbody>${maps}</tbody></table>` : '<div class="empty">매핑이 없습니다</div>'}</div></section>
      </div></div>`;
  }
  function admDrivers(d) {
    const rows = d.drivers.map((x) => `<tr><td><b class="strong">${esc(x.name)}</b></td><td>${esc(x.phone)}</td><td>${esc((REG[x.region_id] || {}).name || x.region_id)}</td><td>${esc(x.vehicle)}</td><td class="r num">${x.capacity}곳</td><td>${x.active ? '<span class="badge b-ok">운영</span>' : '<span class="badge b-mute">중지</span>'}</td><td class="r"><button class="btn sm" data-act="editdriver" data-id="${x.id}">${icon('edit', 13)}편집</button></td></tr>`).join('');
    const regs = d.regions.map((r) => `<tr><td class="num">${esc(r.id)}</td><td><b class="strong">${esc(r.name)}</b><span class="sub2">${esc(r.area)}</span></td><td>${esc(r.hub_name)}<span class="sub2">${r.hub_lat != null ? num(r.hub_lat, 4) + ', ' + num(r.hub_lng, 4) : '좌표 없음'}</span></td><td class="r num">${num(r.radius_km, 1)}km</td><td class="r">${can('admin') ? `<button class="btn sm" data-act="editregion" data-id="${esc(r.id)}">${icon('edit', 13)}편집</button>` : ''}</td></tr>`).join('');
    return `<div class="rp-bottom" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <section class="card"><div class="card-h"><h3>기사 <span class="sub">권역당 활성 기사 1명이 배차됩니다</span></h3><button class="btn primary" data-act="editdriver">${icon('plus', 13)}기사 추가</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>연락처</th><th>권역</th><th>차량</th><th class="r">용량</th><th>상태</th><th></th></tr></thead><tbody>${rows || ''}</tbody></table></div></section>
      <section class="card"><div class="card-h"><h3>권역 <span class="sub">거점 좌표로 정차 순서를 계산</span></h3>${can('admin') ? `<button class="btn" data-act="editregion">${icon('plus', 13)}권역 추가</button>` : ''}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>코드</th><th>권역</th><th>거점</th><th class="r">반경</th><th></th></tr></thead><tbody>${regs}</tbody></table></div></section></div>`;
  }
  function admUsers(d) {
    const rows = d.users.map((u) => `<tr><td><b class="strong">${esc(u.name)}</b><span class="sub2">${esc(u.email)}</span></td><td>${({ admin: '관리자', ops: '운영자', viewer: '열람' })[u.role]}</td><td>${u.disabled ? '<span class="badge b-mute">비활성</span>' : u.must_change ? '<span class="badge b-warn">비밀번호 변경 대기</span>' : '<span class="badge b-ok">사용</span>'}</td><td>${u.last_login_at ? when(H(u.last_login_at)) : '—'}</td>
      <td class="r">${u.id !== DB.user.id ? `<select class="inp" data-userrole="${u.id}" style="width:auto;height:26px">${['admin', 'ops', 'viewer'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${({ admin: '관리자', ops: '운영자', viewer: '열람' })[r]}</option>`).join('')}</select> <button class="btn sm" data-act="userreset" data-id="${u.id}">비밀번호 초기화</button> <button class="btn sm" data-act="usertoggle" data-id="${u.id}" data-disabled="${u.disabled ? 0 : 1}">${u.disabled ? '활성화' : '비활성화'}</button>` : '<span class="muted">본인</span>'}</td></tr>`).join('');
    return `<section class="card"><div class="card-h"><h3>계정 <span class="sub">관리자: 설정·계정 · 운영자: 운영 조치·매장 관리 · 열람: 조회만 (연락처 가림)</span></h3><button class="btn primary" data-act="adduser">${icon('plus', 13)}계정 추가</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>권한</th><th>상태</th><th>마지막 로그인</th><th class="r"></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }
  const SETTING_GROUPS = [
    ['운영 시간', ['cutoff', 'dispatch', 'delivery_days', 'night_start', 'night_end', 'break_from', 'break_to', 'break_send', 'expire_hours', 'auto_remind_min', 'retry_at']],
    ['추정·발주 모델', ['cover_days', 'lookahead_days', 'safety_days', 'band_w0', 'band_beta', 'alpha_lr', 'default_rate']],
    ['배송', ['driver_capacity', 'drive_min', 'stop_min']],
    ['정산·지표', ['fee_rate', 'settle_lag_days', 'pilot_start', 'target_approval', 'target_stop', 'target_error']],
    ['연동', ['pay_method', 'notifier', 'webhook_url', 'public_base_url']],
  ];
  function admSettings(d) {
    const { values, spec } = d.settings;
    const field = (k) => {
      const s = spec[k], v = values[k];
      const id = 'set-' + k;
      if (s.type === 'enum') return `<label class="fld"><span>${esc(s.label)}</span><select id="${id}" data-setting="${k}">${s.values.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${({ invoice: '후불 청구 (월말)', sandbox_card: '카드 (샌드박스)', console: '콘솔 기록 (수동 전달)', webhook: '웹훅 (알림톡 대행사)' })[o] || o}</option>`).join('')}</select></label>`;
      return `<label class="fld"><span>${esc(s.label)}</span><input id="${id}" data-setting="${k}" value="${esc(v)}" ${s.type === 'num' ? 'inputmode="decimal"' : ''}></label>`;
    };
    return `<section class="card"><div class="card-h"><h3>운영 설정 <span class="sub">저장 즉시 스케줄러에 반영</span></h3><button class="btn primary" data-act="savesettings">${icon('check', 13)}저장</button></div>
      <div class="card-b" style="display:flex;flex-direction:column;gap:18px">${SETTING_GROUPS.map(([g, keys]) => `<div><div class="sec-h">${g}</div><div class="fgrid" style="grid-template-columns:repeat(3,minmax(0,1fr))">${keys.filter((k) => spec[k]).map(field).join('')}</div></div>`).join('')}
      <div class="form-err" id="setErr"></div></div></section>`;
  }
  function admIntegrations(d) {
    const ing = d.ingest;
    const out = d.outbox.map((m) => `<tr><td class="num">#${m.id}</td><td>${esc(m.kind)}</td><td><span class="badge ${m.status === 'failed' ? 'b-bad' : 'b-warn'}">${m.status === 'failed' ? '실패' : '재시도 대기'}</span></td><td class="r num">${m.attempts}</td><td>${esc(m.error || '')}</td></tr>`).join('');
    return `<div class="rp-bottom" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)">
      <div style="display:flex;flex-direction:column;gap:14px">
        <section class="card"><div class="card-h"><h3>티오더 POS 판매 로그 수신</h3></div><div class="card-b" style="display:flex;flex-direction:column;gap:8px;font-size:12.5px">
          ${ing ? `<div>수신 주소 <span class="code">POST ${esc(ing.endpoint)}</span></div>
          <div>서명 키 <span class="code">${esc(ing.secret.slice(0, 6))}…${esc(ing.secret.slice(-4))}</span> <button class="btn sm" data-act="copysecret" data-kind="ingest">${icon('copy', 13)}복사</button> <button class="btn sm" data-act="rotate" data-name="ingest">재발급</button></div>
          <div class="muted" style="font-size:11.5px;line-height:1.6">헤더 <span class="code">X-BevFlow-Timestamp</span>(ms)와 <span class="code">X-BevFlow-Signature: sha256=HMAC(키, 타임스탬프 + "." + 본문)</span>을 붙여 보내면 됩니다. 같은 판매 ID는 한 번만 반영됩니다. 자세한 형식은 docs/INTEGRATIONS.md.</div>` : '<div class="muted">관리자만 볼 수 있습니다</div>'}
        </div></section>
        <section class="card"><div class="card-h"><h3>CSV 가져오기 <span class="sub">연동 전 · 과거 데이터 일괄 입력</span></h3></div><div class="card-b" style="display:flex;flex-direction:column;gap:10px">
          <div class="fgrid"><label class="fld"><span>종류</span><select id="impKind"><option value="stores">매장 (code,name,region_id,type,owner_name,owner_phone,address,lat,lng,pos_store_id,send_pref,skus)</option><option value="menu-map">메뉴 매핑 (menu_name,sku_id,units,store_code)</option><option value="pos-sales">POS 판매 (store,sale_id,sold_at,menu,qty)</option></select></label>
          <label class="fld"><span>파일 (UTF-8 CSV, 첫 줄은 머리글)</span><input type="file" id="impFile" accept=".csv,text/csv"></label></div>
          <div class="hstack"><button class="btn primary" data-act="import">${icon('download', 13)}가져오기</button><span class="muted" id="impMsg" style="font-size:12px"></span></div>
        </div></section>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <section class="card"><div class="card-h"><h3>알림 발송</h3></div><div class="card-b" style="font-size:12.5px;display:flex;flex-direction:column;gap:8px">
          <div>현재 방식: <b>${DB.settings.notifier === 'console' ? '콘솔 기록 (운영자가 링크를 복사해 전달)' : '웹훅 (알림톡 대행사로 전달)'}</b></div>
          ${ing ? `<div>웹훅 서명 키 <span class="code">${esc(ing.webhookSecret.slice(0, 6))}…</span> <button class="btn sm" data-act="copysecret" data-kind="webhook">${icon('copy', 13)}복사</button> <button class="btn sm" data-act="rotate" data-name="webhook">재발급</button></div>` : ''}
          <div class="muted" style="font-size:11.5px">방식·웹훅 URL은 [운영 설정 → 연동]에서 바꿉니다.</div>
          <div class="tbl-wrap">${out ? `<table class="tbl"><thead><tr><th>#</th><th>종류</th><th>상태</th><th class="r">시도</th><th>오류</th></tr></thead><tbody>${out}</tbody></table>` : `<div class="empty">${icon('check', 20)}대기·실패 메시지 없음</div>`}</div>
        </div></section>
        ${can('admin') ? `<section class="card"><div class="card-h"><h3>보안 · 데이터</h3></div><div class="card-b" style="display:flex;flex-direction:column;gap:10px;font-size:12.5px">
          <div class="hstack"><button class="btn" data-act="rotate" data-name="link">링크 서명 키 재발급</button><span class="muted" style="font-size:11.5px">발급된 사장님·기사 링크가 모두 무효가 됩니다</span></div>
          ${DB.settings.sampleData ? `<div class="hstack"><button class="btn bad" data-act="clearsample">샘플 데이터 전체 삭제</button><span class="muted" style="font-size:11.5px">매장·발주·배송·실사 기록을 모두 지웁니다 (계정·설정은 유지)</span></div>` : ''}
        </div></section>` : ''}
      </div></div>`;
  }

  // ── 모달 ───────────────────────────────────────────────────
  function modal({ title, sub = '', body, actions = [], size = 'sm', onAction }) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-bg" data-modal-bg><div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-h"><div>${sub ? `<div class="muted" style="font-size:11.5px">${sub}</div>` : ''}<h2 style="font-size:16px">${esc(title)}</h2></div><button class="xbtn" data-modal-close aria-label="닫기">${icon('x', 18)}</button></div>
      <div class="modal-b">${body}<div class="form-err" id="mErr"></div></div>
      ${actions.length ? `<div class="modal-f">${actions.map((a) => `<button class="btn ${a.cls || ''}" data-modal-act="${a.id}">${a.label}</button>`).join('')}</div>` : ''}</div></div>`;
    const close = () => { root.innerHTML = ''; };
    root.onclick = async (ev) => {
      if (ev.target.matches('[data-modal-bg]') || ev.target.closest('[data-modal-close]')) return close();
      const b = ev.target.closest('[data-modal-act]');
      if (!b) return;
      if (b.dataset.modalAct === 'cancel') return close();
      b.disabled = true;
      try { const r = await onAction(b.dataset.modalAct, root); if (r !== false) close(); } catch (e) { const m = $('#mErr', root); if (m) m.textContent = e.message; }
      if (b.isConnected) b.disabled = false;
    };
    const f = root.querySelector('input:not([readonly]), select, textarea');
    if (f) setTimeout(() => f.focus(), 30);
    return close;
  }
  const closeModal = () => { $('#modalRoot').innerHTML = ''; };
  const val = (root, id) => { const el = $('#' + id, root); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };

  function approveModal(p) {
    const st = S(p.store);
    modal({
      title: '대리 승인', sub: `${esc(st.name)} · ${esc(p.id)}`,
      body: `<p style="margin:0 0 10px;font-size:12.5px">사장님이 전화·방문으로 승인했을 때 사용합니다. 수량을 확인하고 사유를 남겨 주세요.</p>
        <table class="tbl"><thead><tr><th>SKU</th><th class="r">수량(박스)</th></tr></thead><tbody>${p.lines.map((l) => `<tr><td>${esc(skuName(l.sku))}${l.trig ? ' <span class="badge b-bad nodot">트리거</span>' : ''}</td><td class="r"><input class="inp" type="number" min="0" max="200" step="1" data-q="${esc(l.sku)}" value="${l.qty}" style="width:72px;text-align:right"></td></tr>`).join('')}</tbody></table>
        <label class="fld" style="margin-top:10px"><span>사유 (필수)</span><input id="apNote" placeholder="예: 사장님 통화 확인 14:32" maxlength="100"></label>`,
      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '승인 처리', cls: 'primary' }],
      onAction: async (id, root) => {
        const qty = {}; $$('[data-q]', root).forEach((i) => { qty[i.dataset.q] = Number(i.value); });
        await api('POST', `/api/proposals/${p.pid}/approve`, { qty, note: val(root, 'apNote') });
        state.ord.sel = p.pid; justMoved = p.pid;
        await afterAction(`<b>${esc(st.name)}</b> 대리 승인 완료`);
      },
    });
  }
  function countModal(storeId, onboarding) {
    const st = S(storeId) || (state.adm.data && state.adm.data.stores.find((s) => s.id === storeId));
    const items = (S(storeId) ? S(storeId).items.map((it) => ({ id: it.sku.id, name: it.sku.name, pack: it.sku.pack, unit: it.sku.unit, est: it.E })) : []);
    if (!items.length) return toast('취급 SKU를 먼저 지정하세요', 'alert');
    modal({
      title: onboarding ? '초기 잔량 입력' : '실사 입력', sub: esc(st.name),
      body: `<p style="margin:0 0 10px;font-size:12.5px">${onboarding ? '지금 매장에 남아 있는 음료를 세어 입력하면 이 시점부터 재고 추정과 발주 제안이 시작됩니다.' : '직접 센 잔량을 입력하면 추정과 오차 밴드가 리셋되고, 편차로 누수 보정 α를 학습합니다.'} 박스와 낱개로 나눠 입력하세요.</p>
        <div class="cnt-grid" style="grid-template-columns:1fr 70px 70px"><span></span><span class="h">박스</span><span class="h">낱개</span>${items.map((it) => `<span>${esc(it.name)} <small class="muted">${it.pack}${esc(it.unit)}/박스${onboarding ? '' : ' · 추정 ' + box(it.est)}</small></span><input type="number" min="0" step="1" data-cb="${esc(it.id)}" inputmode="numeric" placeholder="0"><input type="number" min="0" step="1" data-cu="${esc(it.id)}" inputmode="numeric" placeholder="0">`).join('')}</div>`,
      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '저장', cls: 'primary' }],
      onAction: async (id, root) => {
        const counts = {};
        for (const it of items) {
          const b = $(`[data-cb="${it.id}"]`, root).value, u = $(`[data-cu="${it.id}"]`, root).value;
          if (b === '' && u === '') { if (onboarding) throw new Error(`${it.name} 잔량을 입력해 주세요 (없으면 0)`); continue; }
          counts[it.id] = (Number(b) || 0) + (Number(u) || 0) / it.pack;
        }
        if (!Object.keys(counts).length) throw new Error('한 개 이상 입력해 주세요');
        await api('POST', `/api/stores/${storeId}/counts`, { counts, onboarding: !!onboarding });
        if (state.adm.data) state.adm.data = null;
        await afterAction(`<b>${esc(st.name)}</b> 잔량 ${Object.keys(counts).length}종 저장`);
      },
    });
  }
  async function linkModal(p) {
    const j = await api('GET', `/api/proposals/${p.pid}/link`);
    const st = S(p.store);
    modal({
      title: '사장님 링크 · 메시지', sub: `${esc(st.name)} · ${esc(st.phone || '연락처 없음')}`,
      body: `<div class="fld"><span>승인 링크 (사장님만 열 수 있게 전달하세요)</span><div class="copybox"><input readonly id="lkUrl" value="${esc(j.url)}"><button class="btn" data-copy="lkUrl">${icon('copy', 13)}복사</button></div></div>
        ${j.text ? `<div class="fld" style="margin-top:12px"><span>발송 메시지 전문</span><div class="pre" id="lkText">${esc(j.text)}</div><div><button class="btn" data-copy-text="1" style="margin-top:6px">${icon('copy', 13)}메시지 복사</button></div></div>` : '<p class="muted" style="font-size:12px">아직 발송되지 않은 제안입니다.</p>'}`,
      actions: [{ id: 'cancel', label: '닫기' }],
      onAction: () => true,
    });
    const root = $('#modalRoot');
    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText($('#' + b.dataset.copy).value, '링크')));
    const ct = root.querySelector('[data-copy-text]'); if (ct) ct.addEventListener('click', () => copyText(j.text, '메시지'));
  }
  async function copyText(text, label) {
    try { await navigator.clipboard.writeText(text); toast(`${esc(label)}를 복사했습니다`, 'copy'); }
    catch { modal({ title: label + ' 복사', body: `<p class="muted" style="font-size:12px">자동 복사가 막혀 있습니다. 아래 내용을 선택해 복사하세요.</p><textarea class="inp" style="height:120px;width:100%" readonly>${esc(text)}</textarea>`, actions: [{ id: 'cancel', label: '닫기' }], onAction: () => true }); const ta = $('#modalRoot textarea'); if (ta) { ta.focus(); ta.select(); } }
  }
  function storeModal(s) {
    const d = state.adm.data;
    const cur = s || { code: '', name: '', region_id: REGIONS[0] ? REGIONS[0].id : '', type: 'L', owner_name: '', owner_phone: '', address: '', lat: '', lng: '', pos_store_id: '', send_pref: 'immediate', review_required: 0, pay_test_fail: 0, active: 1, memo: '' };
    modal({
      title: s ? '매장 편집' : '매장 등록', size: '',
      body: `<div class="fgrid">
        <label class="fld"><span>매장 코드 (영문·숫자·-)</span><input id="f-code" value="${esc(cur.code)}" maxlength="30"></label>
        <label class="fld"><span>매장명</span><input id="f-name" value="${esc(cur.name)}" maxlength="60"></label>
        <label class="fld"><span>권역</span><select id="f-region_id">${d.regions.map((r) => `<option value="${esc(r.id)}" ${r.id === cur.region_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
        <label class="fld"><span>영업 유형</span><select id="f-type"><option value="L" ${cur.type === 'L' ? 'selected' : ''}>점심 중심 (식당)</option><option value="D" ${cur.type === 'D' ? 'selected' : ''}>저녁 중심 (주점·포차)</option></select></label>
        <label class="fld"><span>사장님 성함</span><input id="f-owner_name" value="${esc(cur.owner_name)}" maxlength="30"></label>
        <label class="fld"><span>사장님 휴대폰 (알림 수신)</span><input id="f-owner_phone" value="${esc(cur.owner_phone)}" maxlength="20" placeholder="010-0000-0000"></label>
        <label class="fld full"><span>주소</span><input id="f-address" value="${esc(cur.address)}" maxlength="200"></label>
        <label class="fld"><span>위도 (정차 순서 계산)</span><input id="f-lat" value="${esc(cur.lat ?? '')}" inputmode="decimal"></label>
        <label class="fld"><span>경도</span><input id="f-lng" value="${esc(cur.lng ?? '')}" inputmode="decimal"></label>
        <label class="fld"><span>티오더 매장 ID (POS 로그 연결)</span><input id="f-pos_store_id" value="${esc(cur.pos_store_id || '')}" maxlength="60"></label>
        <label class="fld"><span>발주 제안 발송</span><select id="f-send_pref"><option value="immediate" ${cur.send_pref !== 'break' ? 'selected' : ''}>즉시 발송</option><option value="break" ${cur.send_pref === 'break' ? 'selected' : ''}>점심 피크 생성분은 브레이크타임에</option></select></label>
        <label class="chk"><input type="checkbox" id="f-review_required" ${cur.review_required ? 'checked' : ''}>운영자 검수 후 발송 (추정 편차가 큰 매장)</label>
        <label class="chk"><input type="checkbox" id="f-active" ${cur.active ? 'checked' : ''}>운영 중</label>
        <label class="chk"><input type="checkbox" id="f-pay_test_fail" ${cur.pay_test_fail ? 'checked' : ''}>결제 실패 테스트 (샌드박스 카드)</label>
        <label class="fld full"><span>메모</span><textarea id="f-memo" maxlength="500">${esc(cur.memo || '')}</textarea></label>
        ${s ? '' : `<div class="fld full"><span>취급 SKU</span><div class="chips">${d.skus.filter((k) => k.active).map((k) => `<label class="chk" style="margin-right:10px"><input type="checkbox" data-newsku="${esc(k.id)}" ${['CL125', 'SD150'].includes(k.id) ? 'checked' : ''}>${esc(k.name)}</label>`).join('')}</div></div>`}
      </div>`,
      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: s ? '저장' : '등록', cls: 'primary' }],
      onAction: async (id, root) => {
        const b = {};
        ['code', 'name', 'region_id', 'type', 'owner_name', 'owner_phone', 'address', 'lat', 'lng', 'pos_store_id', 'send_pref', 'memo'].forEach((k) => { b[k] = val(root, 'f-' + k); });
        ['review_required', 'active', 'pay_test_fail'].forEach((k) => { b[k] = val(root, 'f-' + k); });
        if (!s) b.skus = $$('[data-newsku]', root).filter((x) => x.checked).map((x) => x.dataset.newsku);
        await api(s ? 'PUT' : 'POST', s ? `/api/admin/stores/${s.id}` : '/api/admin/stores', b);
        state.adm.data = null;
        await afterAction(s ? '매장 정보를 저장했습니다' : `<b>${esc(b.name)}</b> 등록 — 다음 단계: 초기 잔량 입력`);
      },
    });
  }
  function storeSkuModal(s) {
    const d = state.adm.data;
    const cur = new Map(d.storeSkus.filter((x) => x.store_id === s.id).map((x) => [x.sku_id, x]));
    modal({
      title: '취급 SKU', sub: esc(s.name), size: '',
      body: `<table class="tbl"><thead><tr><th>취급</th><th>SKU</th><th class="r">판매 속도 (POS)</th><th class="r">예상 일 판매 (수동)</th><th class="r">안전재고 수동 (박스)</th></tr></thead><tbody>${d.skus.filter((k) => k.active || cur.has(k.id)).map((k) => { const x = cur.get(k.id) || {}; return `<tr><td><input type="checkbox" data-carried="${esc(k.id)}" ${x.carried ? 'checked' : ''}></td><td>${esc(k.name)}</td><td class="r num">${x.rate != null ? num(x.rate, 2) : '<span class="muted">이력 부족</span>'}</td><td class="r"><input class="inp" data-rate="${esc(k.id)}" value="${x.rate_manual ?? ''}" style="width:80px;text-align:right" placeholder="자동"></td><td class="r"><input class="inp" data-safety="${esc(k.id)}" value="${x.safety_override ?? ''}" style="width:80px;text-align:right" placeholder="자동"></td></tr>`; }).join('')}</tbody></table>
        <p class="muted" style="font-size:11.5px;margin:8px 0 0">판매 이력이 3일 이상 쌓이면 POS 기준 속도를 자동으로 씁니다. 수동값은 새 매장 초기에만 필요합니다. 안전재고를 비우면 판매 속도 × 안전 일수로 자동 계산합니다.</p>`,
      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '저장', cls: 'primary' }],
      onAction: async (id, root) => {
        const items = d.skus.filter((k) => k.active || cur.has(k.id)).map((k) => ({ sku_id: k.id, carried: $(`[data-carried="${k.id}"]`, root).checked, rate_manual: $(`[data-rate="${k.id}"]`, root).value, safety_override: $(`[data-safety="${k.id}"]`, root).value }));
        await api('PUT', `/api/admin/stores/${s.id}/skus`, { items });
        state.adm.data = null;
        await afterAction('취급 SKU를 저장했습니다');
      },
    });
  }
  function simpleForm({ title, fields, url, method, done }) {
    modal({
      title, size: '',
      body: `<div class="fgrid">${fields.map((f) => f.type === 'select' ? `<label class="fld ${f.full ? 'full' : ''}"><span>${f.label}</span><select id="sf-${f.k}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : f.type === 'check' ? `<label class="chk"><input type="checkbox" id="sf-${f.k}" ${f.v ? 'checked' : ''}>${f.label}</label>` : `<label class="fld ${f.full ? 'full' : ''}"><span>${f.label}</span><input id="sf-${f.k}" value="${esc(f.v ?? '')}" ${f.ro ? 'readonly' : ''}></label>`).join('')}</div>`,
      actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '저장', cls: 'primary' }],
      onAction: async (id, root) => {
        const b = {}; fields.forEach((f) => { if (!f.ro || f.send) b[f.k] = val(root, 'sf-' + f.k); });
        const r = await api(method, url, b);
        state.adm.data = null;
        await afterAction(done || '저장했습니다');
        return r;
      },
    });
  }

  // ── 차트 인터랙션 ───────────────────────────────────────────
  const tip = () => $('#tip');
  function showTip(html, ev) {
    const el = tip(); el.innerHTML = html; el.style.display = 'block';
    const r = el.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  const hideTip = () => { tip().style.display = 'none'; };
  const svgPoint = (svg, ev) => { const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; return { x: (ev.clientX - r.left) / r.width * vb.width, y: (ev.clientY - r.top) / r.height * vb.height }; };
  function bindCharts() {
    const inv = $('#invChart');
    if (inv && CHART) {
      const hit = $('#hit', inv), cx = $('#cx', inv), cxd = $('#cxd', inv);
      hit.addEventListener('pointermove', (ev) => {
        const p = svgPoint(inv, ev), c = CHART;
        const tt = c.t0 + (p.x - c.ml) / (c.W - c.ml - c.mr) * (c.t1 - c.t0);
        let best = c.pts[0]; c.pts.forEach((q) => { if (Math.abs(q.t - tt) < Math.abs(best.t - tt)) best = q; });
        const xx = c.x(best.t);
        cx.setAttribute('x1', xx); cx.setAttribute('x2', xx); cx.setAttribute('visibility', 'visible');
        cxd.setAttribute('cx', xx); cxd.setAttribute('cy', c.y(best.E)); cxd.setAttribute('visibility', 'visible');
        const near = c.marks.filter((m) => Math.abs(m.t - best.t) < 3).map((m) => `<div class="tr" style="line-height:1.45;margin-top:4px"><span style="color:var(--ink)">${esc(m.text)}</span></div>`).join('');
        showTip(`<div class="tt">${esc(when(best.t))}${best.f ? ' · 예측' : ''}</div>
          <div class="tr"><i class="k"></i><b>${box(best.E)}박스</b><span>추정 재고</span></div>
          <div class="tr"><i class="k band"></i><b>±${num(best.w, 2)}</b><span>하한 ${box(best.E - best.w)} · 상한 ${box(best.E + best.w)}</span></div>
          <div class="tr"><i class="k dash"></i><b>${box(c.S)}</b><span>안전재고</span></div>${near}`, ev);
      });
      hit.addEventListener('pointerleave', () => { hideTip(); cx.setAttribute('visibility', 'hidden'); cxd.setAttribute('visibility', 'hidden'); });
    }
    const rm = $('#routeMap');
    if (rm) {
      rm.addEventListener('pointermove', (ev) => {
        const p = svgPoint(rm, ev);
        let best = null, bd = 1e9; CHART_ROUTE.forEach((n) => { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } });
        if (best && bd < Math.max(12, best.r + 6)) showTip(best.html, ev); else hideTip();
      });
      rm.addEventListener('pointerleave', hideTip);
    }
    const hc = $('#histChart');
    if (hc) {
      const bars = $$('.hbar', hc);
      hc.addEventListener('pointermove', (ev) => {
        const p = svgPoint(hc, ev);
        const b = CHART_BARS.findIndex((x) => p.x >= x.x && p.x < x.x + x.w);
        bars.forEach((el) => { el.style.opacity = ''; });
        if (b >= 0 && p.y > 10) { showTip(CHART_BARS[b].html, ev); const el = bars.find((e) => +e.dataset.i === b); if (el) el.style.opacity = '.75'; } else hideTip();
      });
      hc.addEventListener('pointerleave', () => { hideTip(); bars.forEach((el) => { el.style.opacity = ''; }); });
    }
    $$('.mhit').forEach((h) => {
      const id = h.dataset.mini, c = CHART_MINI[id], svg = $('#mini-' + id), line = $('#mcx-' + id);
      h.addEventListener('pointermove', (ev) => {
        const p = svgPoint(svg, ev);
        const i = Math.max(0, Math.min(c.vals.length - 1, Math.round((p.x - c.ml) / (c.W - c.ml - c.mr) * (c.vals.length - 1))));
        line.setAttribute('x1', c.x(i)); line.setAttribute('x2', c.x(i)); line.setAttribute('visibility', 'visible');
        const wk = DB.pilot.weeks[c.opt.first - 1 + i];
        showTip(`<div class="tt">W${c.opt.first + i} · ${md(H(wk.start))}–${md(H(wk.start) + 6 * 24)}${c.opt.first + i === DB.pilot.weeks.length ? ' (진행 중)' : ''}</div><div class="tr"><i class="k"></i><b>${c.vals[i] != null ? num(c.vals[i], 1) + c.opt.unit : '—'}</b><span>${c.opt.label}</span></div><div class="tr"><i class="k dash"></i><b>${num(c.opt.target, 0)}${c.opt.unit}</b><span>목표</span></div><div class="tr"><span>표본 ${id === 'err' ? '실사 ' + num(wk.counts) + '건' : id === 'appr' ? '응답 ' + wk.decided + '건' : '정차 ' + wk.stops + '회'}</span></div>`, ev);
      });
      h.addEventListener('pointerleave', () => { hideTip(); line.setAttribute('visibility', 'hidden'); });
    });
  }

  // ── 토스트 ─────────────────────────────────────────────────
  function toast(msg, ic = 'check') {
    const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = icon(ic, 16) + '<span>' + msg + '</span>';
    $('#toasts').appendChild(el); setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3800); setTimeout(() => el.remove(), 4200);
  }

  // ── 이벤트 바인딩 ───────────────────────────────────────────
  function go(tab) { state.tab = tab; state.inv.open = false; hideTip(); try { localStorage.setItem('bf.tab', tab); } catch { /* 무시 */ } render(); $('#main').scrollTop = 0; }
  document.addEventListener('click', async (ev) => {
    if (!DB) return;
    if (ev.target.closest('#modalRoot')) return;
    const el = ev.target.closest('button, a[data-act], [data-order], [data-go], [data-pick-sku], [data-noti], [data-close-drawer]');
    if (!el) { if (state.inv.open && !ev.target.closest('.combo')) { state.inv.open = false; render(); } return; }
    const d = el.dataset;
    if (d.tab) return go(d.tab);
    if (d.region) { state.region = d.region; return render(); }
    if (el.id === 'btnRefresh') { ETAG = null; await sync(true); return toast('최신 데이터로 갱신했습니다'); }
    if (d.act) {
      ev.stopPropagation();
      const a = d.act;
      const p = d.id ? DB.byId.get(+d.id) : null;
      if (a === 'logout') { await api('POST', '/api/auth/logout', {}).catch(() => {}); location.href = '/login'; return; }
      if (a === 'pwchange') { location.href = '/login?change=1'; return; }
      if (a === 'approve' && p) return approveModal(p);
      if (a === 'copylink' && p) return run(null, () => linkModal(p));
      if (a === 'preview' && p) return run(null, async () => { const j = await api('GET', `/api/proposals/${p.pid}/link`); window.open(j.url + '#preview', '_blank', 'noopener'); });
      if (a === 'hold' && p) return run(el, async () => { await api('POST', `/api/proposals/${p.pid}/hold`, {}); await afterAction('보류 처리 · 다음 날 재확인', 'clock'); });
      if (a === 'remind' && p) return run(el, async () => { await api('POST', `/api/proposals/${p.pid}/remind`, {}); await afterAction('리마인드를 보냈습니다', 'send'); });
      if (a === 'repay' && p) return run(el, async () => { const r = await api('POST', `/api/proposals/${p.pid}/retry-payment`, {}); await afterAction(r.result && r.result.status === 'paid' ? '재결제 완료' : '재결제 실패 — 사장님께 결제 수단 확인 요청', r.result && r.result.status === 'paid' ? 'card' : 'alert'); });
      if (a === 'sendnow' && p) return run(el, async () => { await api('POST', `/api/proposals/${p.pid}/send-now`, {}); await afterAction('발주 제안을 발송했습니다', 'send'); });
      if (a === 'cancel' && p) return modal({ title: '발주 취소', sub: esc(p.id), body: '<p style="font-size:12.5px;margin:0">이 발주를 취소할까요? 사장님께 별도 안내가 나가지 않으니 필요하면 직접 연락하세요.</p>', actions: [{ id: 'cancel', label: '닫기' }, { id: 'ok', label: '취소 처리', cls: 'bad' }], onAction: async () => { await api('POST', `/api/proposals/${p.pid}/cancel`, {}); state.ord.sel = null; await afterAction('발주를 취소했습니다', 'x'); } });
      if (a === 'propose') return run(el, async () => { await api('POST', `/api/stores/${d.store}/propose`, {}); await afterAction('선제 제안을 만들었습니다 — [발주 관제 → 제안 생성]에서 확인', 'send'); });
      if (a === 'call') { const st = S(+d.store); return copyText(st && st.phone ? st.phone : '', '사장님 연락처'); }
      if (a === 'count') return countModal(+d.store, d.onb === '1');
      if (a === 'dispatch') return run(el, async () => { const r = await api('POST', '/api/dispatch', {}); const n = r.result.reduce((x, y) => x + y.added, 0); await afterAction(n ? `${n}건 배차했습니다` : '배차할 발주가 없습니다', 'truck'); });
      if (a === 'driverlink') return run(null, async () => { const j = await api('GET', `/api/routes/${d.route}/link`); await copyText(j.url, '기사 링크'); });
      if (a === 'stoparrive') return run(el, async () => { await api('POST', `/api/stops/${d.id}/arrive`, {}); await afterAction('도착 처리했습니다', 'truck'); });
      if (a === 'stopdone') return modal({ title: '하차 완료 (운영자 대리)', body: '<p style="font-size:12.5px;margin:0">기사에게 확인한 잔량이 있으면 [실사 입력]으로 따로 넣어 주세요. 잔량 없이 하차 완료만 처리합니다.</p>', actions: [{ id: 'cancel', label: '닫기' }, { id: 'ok', label: '하차 완료', cls: 'primary' }], onAction: async () => { await api('POST', `/api/stops/${d.id}/complete`, {}); await afterAction('하차 완료 처리했습니다', 'truck'); } });
      if (a === 'stopfail') return modal({ title: '배송 실패', body: '<label class="fld"><span>사유</span><select id="flR"><option>매장 휴무</option><option>사장님 부재 · 연락 두절</option><option>주차 불가</option><option>차량 문제</option><option>기타</option></select></label>', actions: [{ id: 'cancel', label: '닫기' }, { id: 'ok', label: '실패 처리 (다음 배송일 재배차)', cls: 'bad' }], onAction: async (id, root) => { await api('POST', `/api/stops/${d.id}/fail`, { reason: val(root, 'flR') }); await afterAction('다음 배송일로 재배차됩니다', 'alert'); } });
      if (a === 'settlepaid') return run(el, async () => { await api('POST', `/api/settlements/${d.week}/paid`, {}); await afterAction('지급 완료로 표시했습니다'); });
      // 관리
      const ad = state.adm.data;
      if (a === 'editstore') return storeModal(d.id ? ad.stores.find((s) => s.id === +d.id) : null);
      if (a === 'storeskus') return storeSkuModal(ad.stores.find((s) => s.id === +d.id));
      if (a === 'editsku') { const k = d.id ? ad.skus.find((x) => x.id === d.id) : null; return simpleForm({ title: k ? 'SKU 편집' : 'SKU 추가', method: k ? 'PUT' : 'POST', url: k ? `/api/admin/skus/${encodeURIComponent(k.id)}` : '/api/admin/skus', fields: [{ k: 'id', label: 'SKU 코드 (영문 대문자·숫자)', v: k ? k.id : '', ro: !!k }, { k: 'name', label: 'SKU명', v: k ? k.name : '' }, { k: 'pack', label: '박스당 입수', v: k ? k.pack : 12 }, { k: 'unit', label: '단위', v: k ? k.unit : '병' }, { k: 'price', label: '박스 단가 (원)', v: k ? k.price : '' }, { k: 'sort', label: '정렬 순서', v: k ? k.sort : 0 }, { k: 'active', label: '판매 중', type: 'check', v: k ? k.active : 1 }] }); }
      if (a === 'addmap') return simpleForm({ title: '메뉴 → SKU 매핑', method: 'POST', url: '/api/admin/menu-map', done: '매핑을 추가했습니다 — 이후 판매부터 재고에 반영', fields: [{ k: 'menu_name', label: 'POS 메뉴명 (정확히 일치)', v: d.menu || '', full: true }, { k: 'sku_id', label: 'SKU', type: 'select', options: ad.skus.map((k) => [k.id, k.name]) }, { k: 'units', label: '메뉴 1개당 SKU 수량 (병·캔)', v: 1 }, { k: 'store_id', label: '적용 매장', type: 'select', v: d.store || '', options: [['', '전체 매장 공통'], ...ad.stores.map((s) => [s.id, s.name])] }] });
      if (a === 'delmap') return run(el, async () => { await api('DELETE', `/api/admin/menu-map/${d.id}`); state.adm.data = null; await afterAction('매핑을 삭제했습니다'); });
      if (a === 'editdriver') { const x = d.id ? ad.drivers.find((v) => v.id === +d.id) : null; return simpleForm({ title: x ? '기사 편집' : '기사 추가', method: x ? 'PUT' : 'POST', url: x ? `/api/admin/drivers/${x.id}` : '/api/admin/drivers', fields: [{ k: 'name', label: '이름', v: x ? x.name : '' }, { k: 'phone', label: '휴대폰', v: x ? x.phone : '' }, { k: 'region_id', label: '권역', type: 'select', v: x ? x.region_id : '', options: ad.regions.map((r) => [r.id, r.name]) }, { k: 'vehicle', label: '차량', v: x ? x.vehicle : '' }, { k: 'capacity', label: '1일 용량 (곳)', v: x ? x.capacity : 60 }, { k: 'active', label: '운영 중', type: 'check', v: x ? x.active : 1 }] }); }
      if (a === 'editregion') { const r = d.id ? ad.regions.find((v) => v.id === d.id) : null; return simpleForm({ title: r ? '권역 편집' : '권역 추가', method: r ? 'PUT' : 'POST', url: r ? `/api/admin/regions/${encodeURIComponent(r.id)}` : '/api/admin/regions', fields: [{ k: 'id', label: '권역 코드 (영문 대문자)', v: r ? r.id : '', ro: !!r }, { k: 'name', label: '권역명', v: r ? r.name : '' }, { k: 'area', label: '지역 (예: 강남·역삼)', v: r ? r.area : '' }, { k: 'hub_name', label: '거점명', v: r ? r.hub_name : '' }, { k: 'hub_lat', label: '거점 위도', v: r ? r.hub_lat : '' }, { k: 'hub_lng', label: '거점 경도', v: r ? r.hub_lng : '' }, { k: 'radius_km', label: '반경 (km)', v: r ? r.radius_km : 3 }, { k: 'sort', label: '정렬', v: r ? r.sort : 0 }] }); }
      if (a === 'adduser') return modal({ title: '계정 추가', body: `<div class="fgrid"><label class="fld"><span>이름</span><input id="u-name"></label><label class="fld"><span>이메일</span><input id="u-email" type="email"></label><label class="fld"><span>권한</span><select id="u-role"><option value="ops">운영자</option><option value="viewer">열람</option><option value="admin">관리자</option></select></label></div><p class="muted" style="font-size:11.5px">임시 비밀번호가 발급되며, 첫 로그인 때 새 비밀번호로 바꿔야 합니다.</p>`, actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '추가', cls: 'primary' }], onAction: async (id, root) => { const r = await api('POST', '/api/admin/users', { name: val(root, 'u-name'), email: val(root, 'u-email'), role: val(root, 'u-role') }); state.adm.data = null; await sync(true); modal({ title: '임시 비밀번호', body: `<p style="font-size:12.5px">${esc(val(root, 'u-email'))} 계정의 임시 비밀번호입니다. 지금만 표시되니 안전하게 전달하세요.</p><div class="copybox"><input readonly id="tmpPw" value="${esc(r.tempPassword)}"></div>`, actions: [{ id: 'cancel', label: '확인' }], onAction: () => true }); return false; } });
      if (a === 'userreset') return run(el, async () => { const r = await api('PUT', `/api/admin/users/${d.id}`, { resetPassword: true }); state.adm.data = null; await sync(true); modal({ title: '비밀번호 초기화', body: `<p style="font-size:12.5px">새 임시 비밀번호입니다. 지금만 표시됩니다.</p><div class="copybox"><input readonly value="${esc(r.tempPassword)}"></div>`, actions: [{ id: 'cancel', label: '확인' }], onAction: () => true }); });
      if (a === 'usertoggle') return run(el, async () => { await api('PUT', `/api/admin/users/${d.id}`, { disabled: d.disabled === '1' }); state.adm.data = null; await afterAction('계정 상태를 바꿨습니다'); });
      if (a === 'savesettings') return run(el, async () => { const b = {}; $$('[data-setting]').forEach((i) => { const spec = state.adm.data.settings.spec[i.dataset.setting]; b[i.dataset.setting] = spec.type === 'num' ? Number(i.value) : i.value; }); try { await api('PUT', '/api/admin/settings', b); } catch (e) { $('#setErr').textContent = e.message; throw e; } state.adm.data = null; await afterAction('운영 설정을 저장했습니다'); });
      if (a === 'copysecret') return copyText(d.kind === 'ingest' ? state.adm.data.ingest.secret : state.adm.data.ingest.webhookSecret, '서명 키');
      if (a === 'rotate') return modal({ title: '키 재발급', body: `<p style="font-size:12.5px;margin:0">${d.name === 'link' ? '이미 보낸 사장님 승인 링크와 기사 링크가 모두 열리지 않게 됩니다.' : '연동 상대방에도 새 키를 반영해야 수신·발송이 이어집니다.'} 계속할까요?</p>`, actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '재발급', cls: 'bad' }], onAction: async () => { await api('POST', `/api/admin/secrets/${d.name}/rotate`, {}); state.adm.data = null; await afterAction('키를 재발급했습니다'); } });
      if (a === 'clearsample') return modal({ title: '샘플 데이터 삭제', body: `<p style="font-size:12.5px">매장·SKU·권역·기사·발주·배송·실사·POS 기록이 모두 삭제됩니다. 계정과 운영 설정은 남습니다.</p><label class="fld"><span>확인을 위해 <b>샘플 삭제</b>를 입력하세요</span><input id="cfm"></label>`, actions: [{ id: 'cancel', label: '취소' }, { id: 'ok', label: '전체 삭제', cls: 'bad' }], onAction: async (id, root) => { await api('POST', '/api/admin/sample/clear', { confirm: val(root, 'cfm') }); state.adm.data = null; await afterAction('샘플 데이터를 삭제했습니다'); } });
      if (a === 'import') return run(el, async () => { const f = $('#impFile').files[0]; if (!f) throw new Error('CSV 파일을 선택하세요'); const r = await api('POST', `/api/admin/import/${$('#impKind').value}`, await f.text(), { raw: true }); state.adm.data = null; await afterAction(`${r.ok}건 반영${r.errorCount ? ` · 오류 ${r.errorCount}건` : ''}`); if (r.errors.length) modal({ title: '가져오기 오류', body: `<div class="pre">${esc(r.errors.join('\n'))}</div>`, actions: [{ id: 'cancel', label: '닫기' }], onAction: () => true }); });
    }
    if (d.adm) { state.adm.sub = d.adm; return render(); }
    if (d.filterKind) { ev.stopPropagation(); state.actFilter = state.actFilter === d.filterKind ? 'ALL' : d.filterKind; return render(); }
    if (d.actFilter) { state.actFilter = d.actFilter; return render(); }
    if (d.go) {
      const [kind, a, b] = d.go.split(':');
      if (kind === 'order') { state.tab = 'orders'; state.ord.sel = +a; return render(); }
      if (kind === 'inv') { state.tab = 'inventory'; state.inv.store = +a; const st = S(+a); state.inv.sku = b || (st && st.items[0] ? st.items[0].sku.id : null); state.inv.status = 'ALL'; return render(); }
      if (kind === 'admin') { state.tab = 'admin'; state.adm.sub = a; return render(); }
    }
    if (el.id === 'storeBtn') { state.inv.open = !state.inv.open; state.inv.q = ''; render(); const q = $('#storeQ'); if (q) q.focus(); return; }
    if (d.pickStore) { state.inv.store = +d.pickStore; state.inv.open = false; state.inv.status = 'ALL'; const st = S(state.inv.store); if (st && !st.items.some((x) => x.sku.id === state.inv.sku)) state.inv.sku = st.items[0] ? st.items[0].sku.id : null; return render(); }
    if (d.badgeSku) { ev.stopPropagation(); state.inv.sku = d.badgeSku; return render(); }
    if (d.pickSku) { state.inv.sku = d.pickSku; return render(); }
    if (d.invStatus) { state.inv.status = d.invStatus; return render(); }
    if (d.order) { state.ord.sel = state.ord.sel === +d.order ? null : +d.order; return render(); }
    if (d.closeDrawer != null) { state.ord.sel = null; return render(); }
    if (d.notiFilter) { ev.stopPropagation(); state.noti.filter = state.noti.filter === d.notiFilter && el.classList.contains('badge') ? 'ALL' : d.notiFilter; state.noti.sel = null; return render(); }
    if (d.notiDay) { state.noti.day = +d.notiDay; state.noti.filter = 'ALL'; state.noti.sel = null; return render(); }
    if (d.noti) { state.noti.sel = +d.noti; return render(); }
    if (d.delScope) { state.del.scope = d.delScope; return render(); }
    if (d.perf) { state.rep.perf = d.perf; return render(); }
  });
  document.addEventListener('change', async (ev) => {
    if (ev.target.id === 'skuSel') { state.inv.sku = ev.target.value; render(); }
    if (ev.target.dataset && ev.target.dataset.userrole) {
      try { await api('PUT', `/api/admin/users/${ev.target.dataset.userrole}`, { role: ev.target.value }); state.adm.data = null; await afterAction('권한을 바꿨습니다'); } catch (e) { toast(esc(e.message), 'alert'); }
    }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'storeQ') { state.inv.q = ev.target.value; const pos = ev.target.selectionStart; render(); const q = $('#storeQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
    if (ev.target.id === 'admQ') { state.adm.q = ev.target.value; const pos = ev.target.selectionStart; render(); const q = $('#admQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
  });
  document.addEventListener('keydown', (ev) => {
    if (!DB) return;
    if (ev.key === 'Escape') { if ($('#modalRoot').innerHTML) return closeModal(); if (state.inv.open) state.inv.open = false; else state.ord.sel = null; return render(); }
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.order) { ev.target.click(); return; }
    const n = +ev.key; if (n >= 1 && n <= TABS.length && !ev.metaKey && !ev.ctrlKey && !ev.altKey) go(TABS[n - 1].id);
  });

  // ── 주기 작업 ───────────────────────────────────────────────
  setInterval(() => {
    if (!DB) return;
    tickClock();
    const t = nowH();
    $$('[data-since]').forEach((el) => { const s = parseFloat(el.dataset.since); if (isFinite(s)) el.textContent = durTxt((t - s) * 60); });
    if (kstMid(nowTs()) !== TODAY0) sync(true); // 자정이 지나면 날짜 기준 재계산
  }, 1000);
  setInterval(() => { if (document.visibilityState === 'visible') sync(false); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(false); });

  (async () => {
    await sync(true);
    if (DB) $('#boot').classList.add('hide');
  })();
})();
