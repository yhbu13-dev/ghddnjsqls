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
