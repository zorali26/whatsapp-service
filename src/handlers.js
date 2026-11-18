const config = require('./config');
const { queries, log } = require('./db');
const { analyzeConversation } = require('./ai');
const { notifyAll } = require('./push');

/**
 * Kaydedilen son mesajdan sonra AI analizi yapar:
 * - Sohbet ozeti + konunun gittigi yon -> chats tablosuna yazar
 * - Kural ACIK ise (whitelist): insan gibi gecikmeyle otomatik gonderir
 * - Kural KAPALI ise: cevabi "onay bekleyenler" listesine ekler
 */
async function analyzeAndMaybeRespond({ chatId, chatName, triggerWaId, silent, humanSend }) {
  if (silent) return;

  const recent = queries.recentMessages(chatId, 60); // daha genis pencere — daha fazla hakim
  if (recent.length === 0) return;

  const rule = queries.getRule(chatId);
  const block = queries.getBlock(chatId);
  const memory = queries.getChatNote(chatId);

  let analysis;
  try {
    analysis = await analyzeConversation({
      chatName,
      recentMessages: recent,
      instruction: rule?.instruction || '', // kisisel talimat her durumda AI'ya gider
      memory,
    });
  } catch (e) {
    log('error', 'AI analizi basarisiz: ' + e.message);
    return;
  }

  queries.updateChatSummary(chatId, analysis.summary, analysis.topic_direction);
  if (analysis.note) queries.updateChatNote(chatId, analysis.note);

  // Kara liste: ozet guncellenir ama HICBIR cevap taslagi uretilmez, otomatik de gonderilmez
  if (block) {
    log('info', `Kara liste: ${chatName} icin cevap uretilmedi.`);
    return;
  }
  if (!analysis.suggested_reply) return;

  // Sessiz saatler: aktifse otomatik gönderme, cevabı onay listesine düş
  const quietEnabled = queries.getSetting('quiet_enabled') === '1';
  let inQuiet = false;
  if (quietEnabled) {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    const start = parseFloat(queries.getSetting('quiet_start') || '23');
    const end = parseFloat(queries.getSetting('quiet_end') || '7');
    inQuiet = start > end ? (h >= start || h < end) : (h >= start && h < end);
    if (inQuiet) log('info', `Sessiz saat (${start}:00-${end}:00) — ${chatName} cevabi onaya alindi`);
  }

  const base = {
    chat_id: chatId,
    trigger_wa_id: triggerWaId,
    draft: analysis.suggested_reply,
    summary: analysis.summary,
    topic_direction: analysis.topic_direction,
    created_at: Date.now(),
  };

  if (rule?.enabled && !inQuiet) {
    try {
      await humanSend(chatId, analysis.suggested_reply);
      queries.createSuggestion({ ...base, status: 'sent', sent_at: Date.now() });
      log('info', `Otomatik cevap gonderildi -> ${chatName}`);
      notifyAll(chatName, `Mayis WP otomatik cevapladi: ${analysis.suggested_reply.slice(0, 80)}`, '/').catch(() => {});
    } catch (e) {
      console.error('AUTO SEND HATASI DETAY:', e);
      log('error', 'Otomatik cevap gonderilemedi: ' + ((e && (e.message || e.stack)) || String(e)));
      queries.createSuggestion(base); // gonderilemediyse onaya dusur
      notifyAll(chatName, 'Otomatik cevap gonderilemedi — onayinizi bekliyor', '/').catch(() => {});
    }
  } else {
    queries.createSuggestion(base);
    log('info', `Cevap onerisi olusturuldu -> ${chatName} (panelden onaylayin)`);
    notifyAll(chatName, `Yeni cevap taslagi: ${analysis.suggested_reply.slice(0, 80)}`, '/').catch(() => {});
  }
}

module.exports = { analyzeAndMaybeRespond };
