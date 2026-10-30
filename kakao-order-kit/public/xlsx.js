'use strict';
// 엑셀(.xlsx)·CSV 파일 읽기 — 관리자 [엑셀 파일 올리기]에서만 불러온다 (외부 라이브러리 없이)
// window.readSheet(file) → Promise<string[][]>  (첫 번째 시트의 줄·칸. n번째 줄 = 엑셀 n행)
(() => {
  const td = new TextDecoder();

  // .xlsx 는 zip 파일: 목차(central directory)를 읽고 필요한 XML 만 꺼낸다
  function unzip(buf) {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let end = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('엑셀(.xlsx) 파일이 아니에요. 엑셀에서 [다른 이름으로 저장] → "Excel 통합 문서(.xlsx)"로 저장해 주세요');
    const count = dv.getUint16(end + 10, true);
    let p = dv.getUint32(end + 16, true);
    const files = {};
    for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
      const nameLen = dv.getUint16(p + 28, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      files[name] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    return async (name) => {
      const f = files[name];
      if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const data = u8.subarray(start, start + f.size);
      if (f.method === 0) return td.decode(data);
      if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('이 브라우저에서는 엑셀 파일을 열 수 없어요. 크롬 최신 버전으로 열어 주세요');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    };
  }

  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const text = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');
  const colNo = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

  async function readXlsx(buf) {
    const get = unzip(buf);
    // 첫 번째 시트 찾기 (workbook.xml → 관계 파일)
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = await get('xl/workbook.xml');
    const rels = await get('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = xml(wb).getElementsByTagName('sheet')[0];
      const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rel = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) {
        const t = rel.getAttribute('Target');
        sheetPath = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
      }
    }
    const shared = [];
    const ss = await get('xl/sharedStrings.xml');
    if (ss) for (const si of xml(ss).getElementsByTagName('si')) shared.push(text(si));
    const sheet = await get(sheetPath);
    if (!sheet) throw new Error('엑셀 파일에서 시트를 찾지 못했어요');
    const rows = [];
    for (const row of xml(sheet).getElementsByTagName('row')) {
      const rn = Number(row.getAttribute('r')) || rows.length + 1; // 엑셀 줄 번호 그대로 (틀린 줄 안내용)
      const cells = [];
      let auto = 0;
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r');
        const i = ref ? colNo(ref) : auto;
        auto = i + 1;
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's') val = v ? shared[Number(v.textContent)] ?? '' : '';
        else if (t === 'inlineStr') val = text(c);
        else if (t === 'b') val = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
        else val = v ? v.textContent : '';
        cells[i] = val;
      }
      rows[rn - 1] = Array.from(cells, (x) => x ?? '');
    }
    return Array.from(rows, (r) => r || []);
  }

  // CSV: 엑셀이 저장한 한글 CSV 는 EUC-KR 인 경우가 많아 둘 다 시도
  function readCsv(buf) {
    let s;
    try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { s = new TextDecoder('euc-kr').decode(buf); }
    s = s.replace(/^﻿/, '');
    const rows = [];
    let row = []; let cur = ''; let q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  window.readSheet = async (file) => {
    const buf = await file.arrayBuffer();
    if (/\.xls$/i.test(file.name)) throw new Error('예전 엑셀(.xls) 파일이에요. 엑셀에서 [다른 이름으로 저장] → "Excel 통합 문서(.xlsx)"로 저장해 주세요');
    const rows = /\.csv$/i.test(file.name) ? readCsv(buf) : await readXlsx(buf);
    const out = rows.map((r) => r.map((x) => String(x).replace(/[\t\r\n]+/g, ' ').trim()));
    while (out.length && !out[out.length - 1].some(Boolean)) out.pop(); // 끝의 빈 줄만 지움 (줄 번호는 엑셀과 같게)
    return out;
  };
})();
