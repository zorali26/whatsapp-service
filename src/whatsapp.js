const fs = require('fs');
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const config = require('./config');
const { queries, log } = require('./db');
const { analyzeAndMaybeRespond } = require('./handlers');
const { notifyAll } = require('./push');

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

function formatPhone(jid) {
  const digits = (jid.split('@')[0] || '').replace(/\D/g, '');
  return digits ? '+' + digits : jid;
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
      return 'Grup ' + chatId.split('@')[0].slice(0, 10);
    }
  }
  if (pushName) return pushName;
  const c = queries.getContactByJid(chatId) || queries.getContactByLid(chatId);
  if (c) {
    if (c.name) return c.name;
    const phoneSrc = c.phone || (c.jid.endsWith('@s.whatsapp.net') ? c.jid : null);
    if (phoneSrc) return formatPhone(phoneSrc);
  }
  if (chatId.endsWith('@s.whatsapp.net')) return formatPhone(chatId);
  return 'Kişi ' + chatId.split('@')[0].slice(0, 8);
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

  // Canli bildirim — gecmis senkronundaki eski mesajlar icin push yollama
  const age = Date.now() - timestamp;
  if (!silent && body && age < 120000) {
    const preview = body.length > 90 ? body.slice(0, 90) + '…' : body;
    const title = fromMe ? `${config.ownerName} (sen)` : name;
    notifyAll(title, preview, '/').catch(() => {});
  }

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
    syncFullHistory: true, // tum gecmisi senkronla (ilk baglanti uzun surebilir)
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
    // "notify" = gelen mesaj, "append" = senin (telefondan ya da bottan) attigin mesajlar
    if (type !== 'notify' && type !== 'append') return;
    for (const m of messages || []) {
      try {
        await handleMessage(m);
      } catch (e) {
        log('error', 'Mesaj islenirken hata: ' + e.message);
      }
    }
  });

  // Telefonunda ya da karsi tarafinda silinen mesajlari veritabanindan da kaldir
  sock.ev.on('message-delete', (item) => {
    try {
      const id = item?.key?.id || item?.key?.id;
      if (id) {
        queries.deleteMessageByWaId(id);
        log('info', 'Silinen mesaj DBden kaldirildi: ' + id);
      }
    } catch (_) { /* sessiz */ }
  });

  // Baglanti acildiginda gecmis mesajlar gelirse sessizce kaydet (AI cagrisi yapma)
  sock.ev.on('messaging-history.set', async ({ chats, contacts, messages } = {}) => {
    try {
      // 1) KISILER — LID <-> isim / numara eslemesi (WhatsApp'in dahili numaralari icin)
      for (const c of contacts || []) {
        if (!c?.id) continue;
        const name = c.name || c.notify || c.verifiedName || '';
        const id = c.id;
        const lid = c.lid || (id.endsWith('@lid') ? id : '');
        const phone = id.endsWith('@s.whatsapp.net') ? id : (c.phone || '');
        queries.saveContact({ jid: id, name, lid, phone });
      }
      // 2) SOHBETLER — isimli olanlari isimle kaydet
      for (const ch of chats || []) {
        if (!ch?.id) continue;
        let name = ch.name || ch.subject || ch.formattedTitle || null;
        if (!name) {
          if (ch.id.endsWith('@g.us')) name = 'Grup ' + ch.id.split('@')[0].slice(0, 10);
          else {
            const c = queries.getContactByJid(ch.id) || queries.getContactByLid(ch.id);
            name = c?.name || (ch.id.endsWith('@s.whatsapp.net') ? formatPhone(ch.id) : 'Kişi ' + ch.id.split('@')[0].slice(0, 8));
          }
        }
        queries.upsertChat({ id: ch.id, name, is_group: ch.id.endsWith('@g.us') ? 1 : 0, updated_at: Date.now() });
      }
      // 3) Eski mesajlar — sessizce kaydet, isme cozulmemis "9053..." gorunumlerini duzelt
      queries.repairChatNames();
      const list = Array.isArray(messages) ? messages : [];
      log('info', `Gecmis senkronu: ${(contacts || []).length} kisi, ${(chats || []).length} sohbet, ${list.length} mesaj (AI cagrisi yok).`);
      for (const m of list.slice(-800)) {
        await handleMessage(m, { silent: true }).catch(() => {});
      }
      queries.repairChatNames(); // mesaj pushName'leri cozumlenmis olabilir
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
  const sent = await sock.sendMessage(chatId, { text: body });
  // Mesaji kaydet (append eventi tetiklenmezse de garantide kalalim)
  if (sent) {
    handleMessage(sent, { silent: true }).catch(() => {});
  }
  return sent;
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
