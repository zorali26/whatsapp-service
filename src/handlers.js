const config = require('./config');
const { queries, log } = require('./db');
const { analyzeConversation } = require('./ai');

/**
 * Kaydedilen son mesajdan sonra AI analizi yapar:
 * - Sohbet ozeti + konunun gittigi yon -> chats tablosuna yazar
 * - Kural ACIK ise (whitelist): insan gibi gecikmeyle otomatik gonderir
 * - Kural KAPALI ise: cevabi "onay bekleyenler" listesine ekler
 */
async function analyzeAndMaybeRespond({ chatId, chatName, triggerWaId, silent, humanSend }) {
  if (silent) return;

  const recent = queries.recentMessages(chatId, 40);
  if (recent.length === 0) return;

  const rule = queries.getRule(chatId);

  let analysis;
  try {
    analysis = await analyzeConversation({
      chatName,
      recentMessages: recent,
      instruction: rule?.enabled ? rule.instruction : '',
    });
  } catch (e) {
    log('error', 'AI analizi basarisiz: ' + e.message);
    return;
  }

  queries.updateChatSummary(chatId, analysis.summary, analysis.topic_direction);
  if (!analysis.suggested_reply) return;

  const base = {
    chat_id: chatId,
    trigger_wa_id: triggerWaId,
    draft: analysis.suggested_reply,
    summary: analysis.summary,
    topic_direction: analysis.topic_direction,
    created_at: Date.now(),
  };

  if (rule?.enabled) {
    try {
      await humanSend(chatId, analysis.suggested_reply);
      queries.createSuggestion({ ...base, status: 'sent', sent_at: Date.now() });
      log('info', `Otomatik cevap gonderildi -> ${chatName}`);
    } catch (e) {
      log('error', 'Otomatik cevap gonderilemedi: ' + e.message);
      queries.createSuggestion(base); // gonderilemediyse onaya dusur
    }
  } else {
    queries.createSuggestion(base);
    log('info', `Cevap onerisi olusturuldu -> ${chatName} (panelden onaylayin)`);
  }
}

module.exports = { analyzeAndMaybeRespond };
