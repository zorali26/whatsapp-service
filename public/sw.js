self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { /* bos payload */ }
  const title = data.title || 'WhatsApp Asistan';
  const options = {
    body: data.body || '',
    icon: '/logo-icon.svg',
    badge: '/logo-icon.svg',
    tag: 'whatsapp-asistan',
    renotify: true,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow((event.notification.data && event.notification.data.url) || '/'));
});
