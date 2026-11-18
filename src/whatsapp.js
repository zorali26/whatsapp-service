const fs = require('fs');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const config = require('./config');
const { queries, log } = require('./db');
const { analyzeAndMaybeRespond } = require('./handlers');

const AUTH_DIR = path.join(config.dataDir, 'baileys_auth');

const state = {
  status: 'starting', // starting | qr | authenticated | ready | disconnected | auth_failure | error
  qrDataUrl: null,
  me: null,
};

let sock = null;
let reconnectAttempts = 0;
const groupNameCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractText(raw) {
  const m = raw.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.templateButtonReplyMessage?.selectedId ||
    m.listResponseMessage?.title ||
    m.interactiveResponseMessage?.body?.text ||
    m.reactionMessage?.text ||
    ''
  );
}

function messageType(raw) {
  const m = raw.message || {};
  const key = Object.keys(m).find((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
  return key || 'unknown';
}

function hasMedia(raw) {
  const m = raw.message || {};
  return ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].some((k) => m[k]);
}

async function resolveChatName(chatId, pushName) {
  if (chatId.endsWith('@g.us')) {
    if (groupNameCache.has(chatId)) return groupNameCache.get(chatId);
    try {
      const meta = await sock.groupMetadata(chatId);
      const name = meta?.subject || chatId;
      groupNameCache.set(chatId, name);
      return name;
    } catch (_) {
      return chatId;
    }
  }
  if (pushName) return pushName;
  return chatId.split('@')[0];
}

async function handleMessage(raw, { silent = false } = {}) {
  if (!raw?.message || !raw?.key?.remoteJid) return;
  const chatId = raw.key.remoteJid;
  if (chatId === 'status@broadcast' || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast')) return;

  const fromMe = !!raw.key.fromMe;
  const body = extractText(raw) || (hasMedia(raw) ? '(medya)' : '');
  const sender = raw.key.participant || (fromMe ? state.me : chatId);
  const timestamp = Number(raw.messageTimestamp || 0) * 1000 || Date.now();

  const name = await resolveChatName(chatId, fromMe ? null : raw.pushName);

  queries.upsertChat({
    id: chatId,
    name,
    is_group: chatId.endsWith('@g.us') ? 1 : 0,
    updated_at: Date.now(),
  });

  queries.saveMessage({
    wa_id: raw.key.id,
    chat_id: chatId,
    sender: sender || chatId,
    sender_name: fromMe ? config.ownerName : (raw.pushName || ''),
    body,
    from_me: fromMe ? 1 : 0,
    type: messageType(raw),
    timestamp,
    has_media: hasMedia(raw) ? 1 : 0,
  });

  if (fromMe || silent) return;

  await analyzeAndMaybeRespond({
    chatId,
    chatName: name,
    triggerWaId: raw.key.id,
    silent: false,
    humanSend: humanAutoReply,
  });
}

async function start() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  let version;
  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version;
  } catch (_) {
    version = undefined; // varsayilan surumle devam et
  }

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    version,
    auth: authState,
    browser: ['WhatsApp Asistan', 'Chrome', '120.0.0'],
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      state.status = 'qr';
      qrcodeTerminal.generate(qr, { small: true });
      QRCode.toDataURL(qr, { width: 320 })
        .then((url) => { state.qrDataUrl = url; })
        .catch((e) => log('error', 'QR gorsel olusturulamadi: ' + e.message));
      log('info', 'QR kod uretildi. Telefondan WhatsApp > Bagli Cihazlar > Cihaz Bagla ile okutun (panelde /qr sayfasi da guncel).');
    }

    if (connection === 'open') {
      state.status = 'ready';
      state.qrDataUrl = null;
      reconnectAttempts = 0;
      const id = sock.user?.id || '';
      state.me = id.split('@')[0].split(':')[0] || null;
      log('info', `WhatsApp hazir. Bagli numara: ${state.me || 'bilinmiyor'}`);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      state.status = loggedOut ? 'auth_failure' : 'disconnected';

      if (loggedOut) {
        log('error', 'Oturum kapatilmis (logged out). Oturum dosyalari silinip yeniden QR uretilecek.');
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
        process.exit(1); // Render servisi yeniden baslatir -> taze QR
      }

      reconnectAttempts += 1;
      const wait = Math.min(30000, 2000 * reconnectAttempts);
      log('error', `Baglanti koptu (kod: ${code ?? 'bilinmiyor'}). ${Math.round(wait / 1000)} sn sonra yeniden baglanilacak (deneme ${reconnectAttempts}).`);
      setTimeout(() => start().catch((e) => log('error', 'Yeniden baglanma hatasi: ' + e.message)), wait);
    }
  });

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    for (const m of messages || []) {
      try {
        await handleMessage(m);
      } catch (e) {
        log('error', 'Mesaj islenirken hata: ' + e.message);
      }
    }
  });

  // Baglanti acildiginda gecmis mesajlar gelirse sessizce kaydet (AI cagrisi yapma)
  sock.ev.on('messaging-history.set', async ({ messages } = {}) => {
    try {
      const list = Array.isArray(messages) ? messages : [];
      log('info', `Gecmis mesajlar alindi: ${list.length} adet (AI cagrisi yapilmadan kaydedildi).`);
      for (const m of list.slice(-500)) {
        await handleMessage(m, { silent: true }).catch(() => {});
      }
    } catch (e) {
      log('error', 'Gecmis mesaj kaydi basarisiz: ' + e.message);
    }
  });

  return sock;
}

/** Insan gibi: once "yaziyor..." goster, mesajin uzunluguna gore bekle, sonra gonder. */
async function humanSendMessage(chatId, body) {
  if (!sock) throw new Error('WhatsApp henuz hazir degil');
  await sock.sendPresenceUpdate('composing', chatId).catch(() => {});
  const typingTime = Math.min(Math.max(body.length * config.typingPerCharMs, 1500), 12000);
  await sleep(typingTime + Math.random() * 1500);
  await sock.sendPresenceUpdate('paused', chatId).catch(() => {});
  return sock.sendMessage(chatId, { text: body });
}

async function humanAutoReply(chatId, body) {
  const delay = config.replyDelayMinMs + Math.random() * (config.replyDelayMaxMs - config.replyDelayMinMs);
  await sleep(delay);
  return humanSendMessage(chatId, body);
}

/**
 * Mesaj sil.
 * NOT: Bu modda (Baileys) yalnizca KENDI mesajinizi HERKESTEN silebilirsiniz.
 * Karsi tarafin mesajini sizden bile kaldirmanin garantili bir yolu yoktur.
 */
async function deleteMessage(waId, target = 'everyone') {
  if (!sock) throw new Error('WhatsApp henuz hazir degil');
  const stored = queries.getMessageByWaId(waId);
  if (!stored) throw new Error('Mesaj kaydi bulunamadi.');
  if (!stored.from_me) {
    throw new Error('Karsi tarafin mesajini bu modda silemezsiniz. Yalnizca kendi mesajlarinizi herkesten silebilirsiniz.');
  }
  await sock.sendMessage(stored.chat_id, {
    delete: { remoteJid: stored.chat_id, id: stored.wa_id, fromMe: true },
  });
  return { ok: true, deleted: 'everyone' };
}

function getStatus() {
  return { ...state, aiConfigured: !!config.deepseek.apiKey };
}

module.exports = { start, getStatus, humanSendMessage, humanAutoReply, deleteMessage };
