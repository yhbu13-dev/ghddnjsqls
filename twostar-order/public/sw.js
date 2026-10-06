'use strict';
// 휴대폰 알림 받기 (웹 푸시). 발주서에서 [알림 켜기]를 누르면 등록된다.
// 서버가 "발주가 확인되었어요" 같은 알림을 보내면 휴대폰 화면 위에 띄우고, 누르면 발주 확인서를 연다.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { /* 내용이 없으면 기본 문구 */ }
  e.waitUntil(self.registration.showNotification(m.title || '투스타 발주', {
    body: m.body || '새 알림이 있어요',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: m.tag || undefined,
    renotify: Boolean(m.tag),
    data: { url: m.url || '' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;
  e.waitUntil((async () => {
    if (url) return self.clients.openWindow(url);
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (list[0]) return list[0].focus();
    return undefined;
  })());
});
