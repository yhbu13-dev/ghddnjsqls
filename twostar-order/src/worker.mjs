// 투스타 발주 — Cloudflare Workers 입구. 요청 처리는 src/app.js (내 컴퓨터 서버와 같은 코드).
//   DB: Cloudflare D1 (env.DB)   화면 파일: public/ (env.ASSETS)
//   비밀값: ADMIN_PASSWORD (wrangler secret). 스킬 키·서명 키는 처음 켤 때 D1 에 만들어 보관.
import { createHandler } from './app.js';
import { d1 } from './d1.js';

let handle = null;

function configFrom(env) {
  return {
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''), // 비우면 요청 주소(https://twostar-order.○○.workers.dev)를 그대로 씀
    adminPassword: env.ADMIN_PASSWORD || '',
    skillKey: env.SKILL_KEY || '',
    secret: env.SECRET || '',
    blockId: env.BLOCK_ID || '',
    minAmount: Number(env.MIN_ORDER || 0),
    guest: { label: env.GUEST_LABEL || '쇼핑몰 문의하기', url: env.GUEST_URL || '' },
    seedSample: env.SEED_SAMPLE === '1',
  };
}

export default {
  async fetch(request, env) {
    handle ??= createHandler({
      db: d1(env.DB),
      cfg: configFrom(env),
      async assets(name) {
        const r = await env.ASSETS.fetch(new Request(`https://assets.local/${name}`));
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      },
    });
    return handle(request, { ip: request.headers.get('cf-connecting-ip') || '' });
  },
};
