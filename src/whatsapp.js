const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const path = require('path');
const config = require('./config');
const { queries, log } = require('./db');
const { handleIncomingMessage } = require('./handlers');

const state = {
  status: 'starting', // starting | qr | authenticated | ready | disconnected | auth_failure
  qrDataUrl: null,
  me: null,
};

let client = null;

function createClient() {
  client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'asistan',
      dataPath: path.join(config.dataDir, 'wwebjs_auth'),
    }),
    puppeteer: {
      headless: true,
      executablePath: config.puppeteerExecutablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,768',
      ],
    },
  });

  client.on('loading_screen', (percent, message) => {
    log('info', `WhatsApp Web yukleniyor: %${percent} ${message || ''}`);
  });

  client.on('qr', (qr) => {
    state.status = 'qr';
    qrcodeTerminal.generate(qr, { small: true });
    QRCode.toDataURL(qr, { width: 320 })
      .then((url) => { state.qrDataUrl = url; })
      .catch((e) => log('error', 'QR gorsel olusturulamadi: ' + e.message));
    log('info', 'QR kod uretildi. Telefondan WhatsApp > Bagli Cihazlar > Cihaz Bagla ile tarayin.');
  });

  client.on('authenticated', () => {
    state.status = 'authenticated';
    state.qrDataUrl = null;
    log('info', 'WhatsApp dogrulandi.');
  });

  client.on('auth_failure', (msg) => {
    state.status = 'auth_failure';
    log('error', 'WhatsApp kimlik dogrulama hatasi: ' + msg);
  });

  client.on('ready', async () => {
    state.status = 'ready';
    state.me = client.info?.wid?.user || null;
    log('info', `WhatsApp hazir. Bagli numara: ${state.me || 'bilinmiyor'}`);
    if (config.fetchHistoryOnStart) {
      await fetchHistory().catch((e) => log('error', 'Gecmis mesajlar yuklenemedi: ' + e.message));
    }
  });

  client.on('disconnected', (reason) => {
    state.status = 'disconnected';
    log('error', 'WhatsApp baglantisi koptu: ' + reason + ' - Uygulama yeniden baslatilacak.');
    // Render uctan uca yeniden baslatir; yerelde de process cikisi yapalim
    setTimeout(() => process.exit(1), 3000);
  });

  client.on('message_create', async (msg) => {
    try {
      if (!msg.from || msg.from === 'status@broadcast' || msg.from.endsWith('@newsletter')) return;
      if (msg.from.endsWith('@broadcast')) return;
      await handleIncomingMessage(client, msg);
    } catch (e) {
      log('error', 'Mesaj islenirken hata: ' + e.message);
    }
  });

  return client;
}

async function fetchHistory() {
  log('info', 'Gecmis mesajlar yukleniyor...');
  const chats = await client.getChats();
  const sorted = chats
    .filter((c) => c.id?._serialized)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 30);

  for (const chat of sorted) {
    queries.upsertChat({
      id: chat.id._serialized,
      name: chat.name || chat.formattedTitle || chat.id.user,
      is_group: chat.isGroup ? 1 : 0,
      updated_at: Date.now(),
    });
    try {
      const msgs = await chat.fetchMessages({ limit: config.historyLimitPerChat });
      for (const m of msgs) await handleIncomingMessage(client, m, { silent: true });
    } catch (e) {
      log('error', `Gecmis yuklenemedi (${chat.name}): ${e.message}`);
    }
  }
  log('info', 'Gecmis mesajlar yuklendi.');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Insan gibi: once "yaziyor..." goster, mesaji yaziyor gibi bekle, sonra gonder. */
async function humanSendMessage(chatId, body) {
  const chat = await client.getChatById(chatId);
  await chat.sendStateTyping();
  const typingTime = Math.min(Math.max(body.length * config.typingPerCharMs, 1500), 12000);
  await sleep(typingTime + Math.random() * 1500);
  const sent = await client.sendMessage(chatId, body);
  await chat.clearState().catch(() => {});
  return sent;
}

async function humanAutoReply(chatId, body) {
  const delay = config.replyDelayMinMs + Math.random() * (config.replyDelayMaxMs - config.replyDelayMinMs);
  await sleep(delay);
  return humanSendMessage(chatId, body);
}

/**
 * Mesaj silme.
 * - from_me = true  -> hedef='everyone': herkesten sil (yaklasik 2 gun icinde)
 * - from_me = false -> hedef='me': sadece sizin ekraninizdan sil
 * Karsi tarafin mesajini herkes icin silmek WhatsApp'ta mumkun degildir.
 */
async function deleteMessage(waId, target = 'auto') {
  const stored = queries.getMessageByWaId(waId);
  const msg = await client.getMessageById(waId).catch(() => null);
  if (!msg) throw new Error('Mesaj bulunamadi (suresi gecmis ya da silinmis olabilir).');

  const everyone = target === 'everyone' || (target === 'auto' && stored?.from_me);
  if (everyone && !stored?.from_me) {
    throw new Error('Karsi tarafin mesajini herkesten silemezsiniz. Sadece "benden sil" yapilabilir.');
  }
  await msg.delete(!!everyone);
  return { ok: true, deleted: everyone ? 'everyone' : 'me' };
}

function getStatus() {
  return { ...state, aiConfigured: !!config.deepseek.apiKey };
}

function start() {
  log('info', 'Chrome yolu: ' + (config.puppeteerExecutablePath || 'puppeteer varsayilani'));
  createClient();
  client.initialize().catch((e) => {
    state.status = 'error';
    console.error('WHATSAPP HATASI DETAY:', e);
    const detail = (e && (e.stack || e.message)) || (typeof e === 'object' ? JSON.stringify(e) : String(e));
    log('error', 'WhatsApp baslatilamadi: ' + detail);
  });
  return client;
}

module.exports = { start, getStatus, humanSendMessage, humanAutoReply, deleteMessage };
