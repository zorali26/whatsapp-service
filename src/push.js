const webpush = require('web-push');
const config = require('./config');
const { queries, log } = require('./db');

function configured() {
  return !!(config.vapid.publicKey && config.vapid.privateKey);
}

if (configured()) {
  try {
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  } catch (e) {
    log('error', 'VAPID ayarlanamadi: ' + e.message);
  }
} else {
  log('info', 'VAPID anahtari yok — Web Push bildirimleri kapali. (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)');
}

/** Tum kayitli cihazlara bildirim gonderir. */
async function notifyAll(title, body, url = '/') {
  if (!configured()) return;
  const subs = queries.listPushSubscriptions();
  if (subs.length === 0) return;
  const payload = JSON.stringify({ title, body, url });
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Abonelik artik gecersiz — temizle
          queries.deletePushSubscription(JSON.stringify(sub));
        } else {
          log('error', 'Push gonderilemedi: ' + e.message);
        }
      }
    })
  );
}

module.exports = { notifyAll, configured, vapidPublicKey: () => config.vapid.publicKey };
