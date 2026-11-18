const path = require('path');
const express = require('express');
const config = require('./config');
const { queries, log } = require('./db');
const { getStatus, humanSendMessage, deleteMessage } = require('./whatsapp');
const { askAboutChat, analyzeConversation } = require('./ai');
const { vapidPublicKey } = require('./push');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Basit Auth (kullanici adi: admin, sifre: PANEL_TOKEN) ----------
function auth(req, res, next) {
  if (!config.panelToken) return next(); // token yoksa acik (gelistirme)
  const header = req.headers.authorization || '';
  const queryToken = req.query.token;
  if (header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const password = decoded.slice(idx + 1);
      if (password === config.panelToken) return next();
    } catch (_) { /* gec */ }
  }
  if (queryToken && queryToken === config.panelToken) return next();
  res.set('WWW-Authenticate', 'Basic realm="WhatsApp Asistan"');
  return res.status(401).send('Yetkisiz giris');
}

app.use(auth);
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- API ----------

app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

// Dashboard istatistikleri
app.get('/api/stats', (req, res) => {
  res.json(queries.stats());
});

// Canli akisi besle: son mesaj + bekleyen taslak sayisi
app.get('/api/poll', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  res.json({
    messages: queries.latestMessagesSince(since),
    pendingSuggestions: queries.listSuggestions('pending').length,
  });
});

// Dashboard icin son aktiviteler
app.get('/api/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '15', 10), 50);
  res.json(queries.activityFeed(limit));
});

// Web Push abonelikleri
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ key: vapidPublicKey() });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Gecersiz abonelik' });
  queries.savePushSubscription(JSON.stringify(sub));
  log('info', 'Yeni push aboneligi kaydedildi');
  res.json({ ok: true });
});

// Paneldeki guncel QR (telefonla taramak icin)
app.get('/qr', (req, res) => {
  const { qrDataUrl, status } = getStatus();
  if (qrDataUrl) {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>QR - WhatsApp Asistan</title>
      <style>body{font-family:sans-serif;background:#0b141a;color:#e9edef;display:flex;flex-direction:column;align-items:center;padding:40px;gap:16px}img{border-radius:12px;background:#fff;padding:12px}</style></head>
      <body><h1>WhatsApp Asistan - Cihaz Bagla</h1>
      <p>Telefonunuzda WhatsApp &gt; Bagli Cihazlar &gt; Cihaz Bagla ile bu kodu okutun.</p>
      <img src="${qrDataUrl}" alt="QR Kod" width="320" height="320" />
      <p>Durum: ${status}</p></body></html>`);
  } else {
    res.send(`QR hazir degil. Mevcut durum: ${status}. Sayfayi yenileyin.`);
  }
});

app.get('/api/chats', (req, res) => {
  res.json(queries.listChats());
});

app.get('/api/chats/:id/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '60', 10), 200);
  res.json(queries.recentMessages(req.params.id, limit));
});

// On-demand ozet / analiz
app.post('/api/chats/:id/analyze', async (req, res) => {
  try {
    const chatId = req.params.id;
    const chats = queries.listChats();
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) return res.status(404).json({ error: 'Sohbet bulunamadi' });
    const recent = queries.recentMessages(chatId, 60);
    if (recent.length === 0) return res.status(400).json({ error: 'Mesaj yok' });
    const rule = queries.getRule(chatId);
    const memory = queries.getChatNote(chatId);
    const analysis = await analyzeConversation({
      chatName: chat.name,
      recentMessages: recent,
      instruction: rule?.instruction || '',
      memory,
    });
    queries.updateChatSummary(chatId, analysis.summary, analysis.topic_direction);
    if (analysis.note) queries.updateChatNote(chatId, analysis.note);
    res.json(analysis);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// "Bu sohbette konu nereye gidiyor?" gibi serbest sorular
app.post('/api/chats/:id/ask', async (req, res) => {
  try {
    const question = (req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question alani gerekli' });
    const chatId = req.params.id;
    const chat = queries.listChats().find((c) => c.id === chatId);
    if (!chat) return res.status(404).json({ error: 'Sohbet bulunamadi' });
    const recent = queries.recentMessages(chatId, 60);
    const memory = queries.getChatNote(chatId);
    const answer = await askAboutChat({ chatName: chat.name, recentMessages: recent, question, memory });
    res.json({ answer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/suggestions', (req, res) => {
  res.json(queries.listSuggestions(req.query.status || 'pending'));
});

// Onerilen cevabi onayla (isterseniz duzenleyerek) ve gonder
app.post('/api/suggestions/:id/send', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const s = queries.getSuggestion(id);
    if (!s) return res.status(404).json({ error: 'Oneri bulunamadi' });
    const body = (req.body?.body || s.draft || '').trim();
    if (!body) return res.status(400).json({ error: 'Gonderilecek metin bos' });
    await humanSendMessage(s.chat_id, body);
    queries.setSuggestionStatus(id, 'sent');
    log('info', `Onaylanan cevap gonderildi -> ${s.chat_name}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/suggestions/:id/discard', (req, res) => {
  queries.setSuggestionStatus(parseInt(req.params.id, 10), 'discarded');
  res.json({ ok: true });
});

// Serbest mesaj gonder
app.post('/api/send', async (req, res) => {
  try {
    const { chatId, body } = req.body || {};
    if (!chatId || !body?.trim()) return res.status(400).json({ error: 'chatId ve body gerekli' });
    await humanSendMessage(chatId, body.trim());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mesaj sil: kendi mesajiniz -> herkesten sil; karsi taraf -> sadece sizden sil
app.post('/api/messages/delete', async (req, res) => {
  try {
    const { waId, target } = req.body || {};
    if (!waId) return res.status(400).json({ error: 'waId gerekli' });
    const result = await deleteMessage(waId, target || 'auto');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Otomatik yanit listesi (whitelist)
app.put('/api/rules/:chatId', (req, res) => {
  const { enabled, instruction } = req.body || {};
  queries.setRule(req.params.chatId, !!enabled, instruction || '');
  res.json({ ok: true });
});

// Kara liste (bu sohbete asla cevap verilmez)
app.put('/api/blocks/:chatId', (req, res) => {
  const { blocked, reason } = req.body || {};
  if (blocked) queries.setBlock(req.params.chatId, reason || '');
  else queries.removeBlock(req.params.chatId);
  res.json({ ok: true });
});

app.get('/api/blocks', (req, res) => {
  res.json(queries.listBlocks());
});

app.get('/api/rules', (req, res) => {
  res.json(queries.listRules());
});

app.get('/api/logs', (req, res) => {
  res.json(queries.recentLogs(parseInt(req.query.limit || '100', 10)));
});

function startServer() {
  app.listen(config.port, () => {
    log('info', `Panel http://localhost:${config.port} adresinde calisiyor.`);
  });
}

module.exports = { startServer };
