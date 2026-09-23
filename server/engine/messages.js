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
  const vars = { store: store.name, owner: store.owner_name, code: p.code, amount: won(p.amount), link };
  let text = '';
  const who = store.owner_name ? `${store.owner_name} 사장님` : '사장님';
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
      text = `[BevFlow 발주 확정]\n✓ ${p.code} 발주가 확정됐어요 — ${vars.arrive}\n합계 ${vars.amount}${p.pay_method === 'invoice' ? ' (월말 청구)' : ''}\n▶ ${link}`;
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
      text = `[BevFlow 배송 완료]\n${stop ? T.fmtTime(stop.departed_at) : ''} ${stop ? stop.boxes : ''}박스 하차했어요. 기사님이 음료 잔량도 함께 확인했어요.`;
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

module.exports = { enqueue, flushOutbox, ownerLink, build, TEMPLATES, linesOf };
