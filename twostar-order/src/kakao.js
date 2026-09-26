'use strict';
// 카카오톡 챗봇 (카카오 i 오픈빌더 스킬 서버)
// 점주는 글자를 치지 않고 버튼만 눌러 발주한다. (처음 한 번만 연결 코드 6자리 입력)
// 모든 버튼은 오픈빌더의 "발주" 블록으로 돌아오고, 어떤 화면을 보여줄지는 extra.s 로 정한다.
//
// 요청: POST /kakao/skill?key=<SKILL_KEY>  (오픈빌더 스킬 서버 형식)
// 응답: SkillResponse v2.0 — simpleText · textCard · carousel · quickReplies
// 오픈빌더 제한: 캐러셀 10장 · 카드 버튼 3개 · 버튼 글자 14자 · 바로가기 10개 · 5초 안에 응답

const O = require('./order');

const PAGE = 9; // 캐러셀 10장 = 품목 9장 + [다음]
const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

function ui(blockId) {
  const btn = (label, extra, text) => (blockId
    ? { label: cut(label, 14), action: 'block', blockId, extra, messageText: text || label }
    : { label: cut(label, 14), action: 'message', messageText: text || label });
  const link = (label, url) => ({ label: cut(label, 14), action: 'webLink', webLinkUrl: url });
  const text = (t) => ({ simpleText: { text: cut(t, 1000) } });
  const card = (title, description, buttons = []) => ({
    textCard: { title: cut(title, 50), description: cut(description, 400), buttons: buttons.slice(0, 3) },
  });
  const carousel = (cards) => ({
    carousel: { type: 'textCard', items: cards.slice(0, 10).map((c) => c.textCard) },
  });
  const res = (outputs, quickReplies = []) => ({
    version: '2.0',
    template: { outputs: outputs.slice(0, 3), quickReplies: quickReplies.slice(0, 10) },
  });
  return { btn, link, text, card, carousel, res };
}

function lineText(l) {
  return `· ${l.name} ${l.qty}${l.unit}  ${O.won(l.price * l.qty)}`;
}

/**
 * 스킬 처리. ctx = { db, blockId, orderLink(storeId), minAmount, guest: { label, url }, now }
 */
function skill(ctx, body) {
  const { db } = ctx;
  const now = ctx.now || Date.now();
  const U = ui(ctx.blockId);
  const userKey = String(body?.userRequest?.user?.id || '').slice(0, 128);
  const utter = String(body?.userRequest?.utterance || '').trim();
  const x = body?.action?.clientExtra || {};
  if (!userKey) return U.res([U.text('사용자 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.')]);

  const home = U.btn('처음으로', { s: 'home' });
  let store = O.storeByUser(db, userKey);

  // ── 연결 전: 연결 코드 6자리 ─────────────────────
  if (!store) {
    const code = utter.replace(/\s/g, '');
    if (/^\d{6}$/.test(code)) {
      if (limited(userKey, now)) return U.res([U.text('입력 횟수를 넘었어요. 10분 뒤에 다시 입력해 주세요.')]);
      store = O.linkUser(db, userKey, code, now);
      if (!store) return U.res([U.text('연결 코드가 맞지 않아요. 투스타글로벌 담당자에게 받은 6자리 숫자를 다시 입력해 주세요.')]);
      return U.res([
        U.text(`✅ ${store.name} 매장과 연결되었어요.\n이제부터 버튼만 눌러 발주하시면 됩니다.`),
        homeCard(ctx, U, store),
      ], homeQuick(U));
    }
    const out = [U.card('투스타글로벌 발주', '처음 오셨네요!\n담당자에게 받은 연결 코드 6자리를 채팅창에 입력해 주세요.\n(처음 한 번만 입력하면 됩니다)')];
    const quick = ctx.guest?.url ? [U.link(ctx.guest.label || '쇼핑몰 문의하기', ctx.guest.url)] : [];
    if (quick.length) out[0].textCard.buttons = quick;
    return U.res(out);
  }

  try {
    return step(ctx, U, store, x, now) || U.res([homeCard(ctx, U, store)], homeQuick(U));
  } catch (e) {
    if (e instanceof O.UserError) return U.res([U.text(`⚠️ ${e.message}`)], [U.btn('장바구니', { s: 'cart' }), home]);
    throw e;
  }
}

function homeCard(ctx, U, store) {
  const cart = O.cartOf(ctx.db, store);
  const desc = cart.count
    ? `🛒 장바구니 ${cart.count}품목 · ${O.won(cart.total)}`
    : '[📋 발주하기]를 누르면 전체 품목이 한 화면에 나와요.';
  // 주 경로는 발주서(한 화면에서 +/−). 대화창에 메시지가 쌓이지 않는다
  return U.card(`${store.name} 사장님, 안녕하세요`, desc, [
    U.link('📋 발주하기', ctx.orderLink(store.id)),
    U.btn(cart.count ? `장바구니 (${cart.count})` : '장바구니', { s: 'cart' }),
    U.btn('지난 발주 그대로', { s: 'reorder' }),
  ]);
}

function homeQuick(U) {
  return [
    U.btn('카톡에서 고르기', { s: 'cats' }),
    U.btn('발주 내역', { s: 'history' }),
    U.btn('품목 추가 신청', { s: 'req' }),
  ];
}

function step(ctx, U, store, x, now) {
  const { db } = ctx;
  const home = U.btn('처음으로', { s: 'home' });
  const toCart = (cart) => U.btn(cart.count ? `장바구니 (${cart.count})` : '장바구니', { s: 'cart' });

  switch (x.s) {
    case 'cats': {
      const cats = O.categoriesOf(db, store);
      if (cats.length === 1) return step(ctx, U, store, { s: 'groups', c: cats[0] }, now);
      return U.res([U.carousel(cats.map((c) => U.card(O.CATEGORIES[c], `${O.itemsFor(db, store, c).length}개 품목`, [
        U.btn('보기', { s: 'groups', c }, `${O.CATEGORIES[c]} 보기`),
      ])))], [home]);
    }

    case 'groups': {
      const c = String(x.c || '');
      const groups = O.groupsFor(db, store, c);
      if (!groups.length) return U.res([U.text('발주할 수 있는 품목이 없어요.')], [home]);
      const cart = O.cartOf(db, store);
      // 분류가 10개를 넘으면 바로가기에서 나머지를 고른다
      return U.res([
        U.text(`${O.CATEGORIES[c] || ''} — 분류를 고르세요`),
        U.carousel(groups.slice(0, 10).map((g) => U.card(g.name, `${g.count}개 품목`, [
          U.btn('품목 보기', { s: 'items', c, g: g.name }, `${g.name} 보기`),
        ]))),
      ], [...groups.slice(10).map((g) => U.btn(g.name, { s: 'items', c, g: g.name })), toCart(cart), home]);
    }

    case 'items': {
      // o = 캐러셀 첫 장이 될 품목 순번. 담기 버튼을 누르면 그 품목부터 다시 보여줘서
      // 새 캐러셀이 항상 대화 맨 아래 · 방금 누른 품목이 첫 장에 온다 (위로 올려서 찾을 필요 없음)
      const c = String(x.c || '');
      const g = String(x.g || '');
      const all = O.itemsFor(db, store, c).filter((i) => i.grp === g);
      if (!all.length) return U.res([U.text('품목이 없어요.')], [home]);
      const o = Math.min(Math.max(0, Math.trunc(Number(x.o ?? (Number(x.p) || 0) * PAGE) || 0)), all.length - 1);
      const cart = O.cartOf(db, store);
      const inCart = new Map(cart.lines.map((l) => [l.item_id, l.qty]));
      const page = all.slice(o, o + PAGE);
      const cards = page.map((i, k) => {
        const at = o + k;
        const q = inCart.get(i.id);
        return U.card(`${q ? '✅ ' : ''}${i.name}`,
          `${i.spec ? `${i.spec} · ` : ''}${O.won(i.price)}\n${q ? `🛒 담음 ${q}${i.unit}` : '　'}`, [
            U.btn(`+1${i.unit}`, { s: 'add', i: i.id, n: 1, c, g, o: at }, `${i.name} +1`),
            U.btn(`+5${i.unit}`, { s: 'add', i: i.id, n: 5, c, g, o: at }, `${i.name} +5`),
            U.btn(q ? '빼기' : '+10', q ? { s: 'add', i: i.id, n: -999, c, g, o: at } : { s: 'add', i: i.id, n: 10, c, g, o: at },
              q ? `${i.name} 빼기` : `${i.name} +10`),
          ]);
      });
      const rest = all.length - (o + page.length);
      if (rest > 0) cards.push(U.card('다음 품목', `${rest}개 더 있어요`, [U.btn('다음 보기', { s: 'items', c, g, o: o + PAGE }, '다음 품목')]));
      const head = x.msg ? `${x.msg}\n` : '';
      return U.res([
        U.text(`${head}${g} ${o + 1}~${o + page.length} / ${all.length}${cart.count ? `  ·  🛒 ${cart.count}품목 ${O.won(cart.total)}` : ''}`),
        U.carousel(cards),
      ], [
        ...(cart.count ? [U.btn('주문하기', { s: 'confirm' })] : []),
        ...(o > 0 ? [U.btn('처음 품목부터', { s: 'items', c, g, o: 0 })] : []),
        U.btn('다른 분류', { s: 'groups', c }),
        toCart(cart),
        home,
      ]);
    }

    case 'add': {
      const it = O.orderableItem(db, store, Number(x.i));
      if (!it) throw new O.UserError('발주할 수 없는 품목입니다');
      const qty = O.addQty(db, store, it.id, Math.trunc(Number(x.n) || 0));
      const msg = qty ? `✔ ${it.name} ${qty}${it.unit} 담았어요` : `✔ ${it.name} 뺐어요`;
      // 같은 캐러셀을 방금 누른 품목부터 다시 보여줌
      if (x.g) return step(ctx, U, store, { s: 'items', c: x.c || it.category, g: x.g, o: x.o, msg }, now);
      const cart = O.cartOf(db, store);
      return U.res([U.text(`${msg}\n장바구니 ${cart.count}품목 · ${O.won(cart.total)}`)], [
        ...(cart.count ? [U.btn('주문하기', { s: 'confirm' })] : []),
        toCart(cart),
        home,
      ]);
    }

    case 'cart': {
      const cart = O.cartOf(db, store);
      if (!cart.count) {
        return U.res([U.card('장바구니가 비어 있어요', '품목을 골라 담거나 지난 발주를 불러오세요.', [
          U.btn('품목 골라 담기', { s: 'cats' }),
          U.btn('지난 발주 그대로', { s: 'reorder' }),
          U.link('📋 발주서 열기', ctx.orderLink(store.id)),
        ])], [home]);
      }
      return U.res([
        U.text(`🛒 장바구니 (${cart.count}품목)\n\n${cart.lines.map(lineText).join('\n')}`),
        U.card(`합계 ${O.won(cart.total)}`, '수량을 바꾸려면 발주서를 열어 주세요.', [
          U.btn('주문하기', { s: 'confirm' }),
          U.link('📋 발주서에서 수정', ctx.orderLink(store.id)),
          U.btn('모두 비우기', { s: 'clear' }),
        ]),
      ], [U.btn('더 담기', { s: 'cats' }), home]);
    }

    case 'clear': {
      O.clearCart(db, store);
      return U.res([U.text('장바구니를 비웠어요.')], [U.btn('품목 골라 담기', { s: 'cats' }), home]);
    }

    case 'reorder': {
      const n = O.reorder(db, store);
      if (!n) return U.res([U.text('불러올 지난 발주가 없어요.')], [U.btn('품목 골라 담기', { s: 'cats' }), home]);
      return step(ctx, U, store, { s: 'cart' }, now);
    }

    case 'confirm': {
      const cart = O.cartOf(db, store);
      if (!cart.count) return step(ctx, U, store, { s: 'cart' }, now);
      if (cart.total < (ctx.minAmount || 0)) {
        throw new O.UserError(`최소 발주 금액은 ${O.won(ctx.minAmount)}입니다 (현재 ${O.won(cart.total)})`);
      }
      const top = cart.lines.slice(0, 5).map(lineText).join('\n');
      const rest = cart.count > 5 ? `\n외 ${cart.count - 5}품목` : '';
      return U.res([U.card('이대로 주문할까요?', `${top}${rest}\n\n합계 ${O.won(cart.total)}`, [
        U.btn('✅ 주문 확정', { s: 'submit', r: cart.rev }, '주문 확정'),
        U.btn('장바구니 보기', { s: 'cart' }),
      ])], [home]);
    }

    case 'submit': {
      const { order, duplicate } = O.submit(db, store, x.r, { via: 'chat', minAmount: ctx.minAmount || 0 }, now);
      ctx.onOrder?.(order, duplicate);
      return U.res([U.card(duplicate ? '이미 접수된 주문이에요' : '✅ 주문이 접수되었어요',
        `주문번호 ${order.no}\n합계 ${O.won(order.total)}\n\n담당자가 확인하면 알려 드릴게요.`, [
          U.btn('발주 내역', { s: 'history' }),
        ])], [home]);
    }

    case 'history': {
      const list = O.ordersOf(db, store, 5);
      if (!list.length) return U.res([U.text('아직 발주 내역이 없어요.')], [home]);
      const lines = list.map((o) => `${o.no}  ${O.STATUS[o.status]}  ${O.won(o.total)}`);
      return U.res([U.text(`📦 최근 발주\n\n${lines.join('\n')}`)], [U.btn('지난 발주 그대로', { s: 'reorder' }), home]);
    }

    case 'req': {
      const states = O.accessStates(db, store).filter((a) => a.state !== 'base');
      const label = { none: '신청 가능', pending: '⏳ 승인 대기 중', approved: '✅ 이용 중', rejected: '반려됨 · 다시 신청 가능' };
      return U.res([
        U.text('다른 품목도 발주하시려면 신청해 주세요.\n담당자 승인 후 발주 목록에 나타납니다.'),
        U.carousel(states.map((a) => U.card(a.label, label[a.state],
          a.state === 'none' || a.state === 'rejected' ? [U.btn('신청하기', { s: 'reqgo', c: a.category }, `${a.label} 신청`)] : []))),
      ], [home]);
    }

    case 'reqgo': {
      const r = O.requestAccess(db, store, String(x.c || ''), now);
      if (r === 'requested') ctx.onAccess?.(store, x.c);
      return U.res([U.text(r === 'pending'
        ? '이미 신청되어 승인을 기다리고 있어요.'
        : `📨 ${O.CATEGORIES[x.c]} 이용을 신청했어요.\n승인되면 발주 목록에 바로 나타납니다.`)], [home]);
    }

    default:
      return null;
  }
}

// 연결 코드 대입 방지: 사용자당 10분에 5번
const tries = new Map();
function limited(key, now, max = 5, windowMs = 10 * 60e3) {
  const arr = (tries.get(key) || []).filter((t) => now - t < windowMs);
  if (tries.size > 5000) tries.clear();
  tries.set(key, arr);
  if (arr.length >= max) return true;
  arr.push(now);
  return false;
}

module.exports = { skill };
