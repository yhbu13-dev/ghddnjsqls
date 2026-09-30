'use strict';
// 발주 확인서 · 거래명세서 화면 도우미
//  - [PDF 저장]: 인쇄 창 없이 휴대폰에서 바로 PDF 파일을 만든다 (카카오톡 안 브라우저는 인쇄가 막혀 있음)
//  - 카카오톡 안에서는 파일 내려받기도 막혀 있어서, 문서 그림을 띄워 '길게 눌러 저장' + 다른 브라우저로 열기를 안내
//  - 종이 양식(760px)은 휴대폰 폭에 맞게 줄여서 보여 준다
(() => {
  const inKakao = /KAKAOTALK/i.test(navigator.userAgent);

  // ── 휴대폰 폭에 맞추기 ──
  const form = document.getElementById('fdoc');
  const wrap = form && form.parentElement;
  const fit = () => {
    if (!form) return;
    form.style.transform = '';
    form.style.margin = '';
    wrap.style.height = '';
    const k = Math.min(1, (wrap.clientWidth - 24) / form.offsetWidth);
    if (k < 1) {
      form.style.transform = `scale(${k})`;
      form.style.margin = '0';
      wrap.style.height = `${form.offsetHeight * k + 48}px`;
    }
  };
  fit();
  window.addEventListener('resize', fit);

  // ── PDF 만들기 ──
  const load = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PDF 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요'));
    document.head.append(s);
  });

  async function snapshot() {
    await load('/assets/html2canvas.min.js');
    const target = form || document.querySelector('.doc');
    const saved = target.style.transform;
    target.style.transform = ''; // 줄이지 않은 원래 크기로 찍는다
    try {
      return await window.html2canvas(target, { scale: 2, backgroundColor: '#ffffff', logging: false });
    } finally {
      target.style.transform = saved;
    }
  }

  // A4 한 장씩 잘라 그림 목록으로 (긴 명세서는 여러 장)
  function pages(canvas) {
    const pageRatio = 281 / 194; // A4 여백 뺀 세로/가로
    const pageH = Math.floor(canvas.width * pageRatio);
    const out = [];
    for (let y = 0; y < canvas.height; y += pageH) {
      const h = Math.min(pageH, canvas.height - y);
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, h);
      g.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      out.push({ url: c.toDataURL('image/jpeg', 0.92), w: c.width, h });
    }
    return out;
  }

  async function makePdf(name) {
    const list = pages(await snapshot());
    await load('/assets/jspdf.umd.min.js');
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    list.forEach((p, i) => {
      if (i) pdf.addPage();
      pdf.addImage(p.url, 'JPEG', 8, 8, 194, (p.h * 194) / p.w);
    });
    // 파일 이름을 직접 붙여 내려받기 (휴대폰 '파일'·'다운로드'에 저장됨)
    const url = URL.createObjectURL(pdf.output('blob'));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // 카카오톡 안: 문서 그림을 띄워 길게 눌러 저장 / 다른 브라우저에서 PDF 저장
  async function showImage() {
    const list = pages(await snapshot());
    const box = document.getElementById('pdfout');
    const ext = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`;
    box.replaceChildren();
    const head = document.createElement('div');
    head.className = 'pdfout-hd';
    const msg = document.createElement('p');
    msg.textContent = '아래 문서 그림을 길게 눌러 [이미지 저장] 하세요. PDF 파일이 필요하면 다른 브라우저에서 열어 [PDF 저장]을 누르세요.';
    const open = document.createElement('a');
    open.className = 'tbtn primary';
    open.href = ext;
    open.textContent = '다른 브라우저에서 PDF 저장';
    const close = document.createElement('button');
    close.className = 'tbtn';
    close.type = 'button';
    close.textContent = '닫기';
    close.addEventListener('click', () => { box.hidden = true; });
    head.append(msg, open, close);
    box.append(head, ...list.map((p) => { const img = new Image(); img.src = p.url; img.alt = '문서'; return img; }));
    box.hidden = false;
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pdf]');
    if (!btn || btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    try {
      if (inKakao) await showImage();
      else await makePdf(btn.dataset.pdf || '문서');
    } catch (err) {
      alert(err.message || 'PDF를 만들지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
})();
