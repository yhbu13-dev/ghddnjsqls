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
