'use strict';
// 문서 화면의 [인쇄 · PDF 저장] 버튼 (보안 정책상 인라인 스크립트를 쓰지 않음)
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});
