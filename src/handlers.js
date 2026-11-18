const config = require('./config');
const { queries, log } = require('./db');
const { analyzeConversation } = require('./ai');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertChatFromMessage(client, msg) {
  const chat = await msg.getChat();
  const chatId = chat.id._serialized;
  queries.upsertChat({
    id: chatId,
    name: chat.name || chat.formattedTitle || chatId,
    is_group: chat.isGroup ? 1 : 0,
    updated_at: Date.now(),
  });
  return chat;
}

/**
 * Her mesaj bu fonksiyondan gecer (gelen ve giden).
 * - Gelen mesajlari kaydeder, AI ile analiz eder.
 * - Bekleyen onay listesine cevap taslagi ekler ya da
 *   sohbet "otomatik" listesindeyse insan gibi gecikmeyle kendi gonderir.
 * - Giden mesajlari sadece kaydeder.
 * options.silent = true iken (gecmis yukleme) AI cagrisi ve otomatik cevap yapilmaz.
 */
async function handleIncomingMessage(client, msg, options = {}) {
  const silent = !!options.silent;

  let chat;
  try {
    chat = await upsertChatFromMessage(client, msg);
  } catch (e) {
    log('error', 'Sohbet bilgisi alinamadi: ' + e.message);
    return;
  }

  const chatId = chat.id._serialized;
  const contact = msg.fromMe ? null : await msg.getContact().catch(() => null);

  queries.saveMessage({
    wa_id: msg.id._serialized,
    chat_id: chatId,
    sender: msg.author || msg.from,
    sender_name: msg.fromMe ? config.ownerName : (contact?.pushname || contact?.name || ''),
    body: msg.body || '',
    from_me: msg.fromMe ? 1 : 0,
    type: msg.type || 'chat',
    timestamp: msg.timestamp ? msg.timestamp * 1000 : Date.now(),
    has_media: msg.hasMedia ? 1 : 0,
  });

  if (silent || msg.fromMe) return; // Giden mesajlar sadece kaydedilir

  const recent = queries.recentMessages(chatId, 40);
  const rule = queries.getRule(chatId);

  let analysis;
  try {
    analysis = await analyzeConversation({
      chatName: chat.name || chatId,
      recentMessages: recent,
      instruction: rule?.enabled ? rule.instruction : '',
    });
  } catch (e) {
    log('error', 'AI analizi basarisiz: ' + e.message);
    return;
  }

  queries.updateChatSummary(chatId, analysis.summary, analysis.topic_direction);

  if (rule?.enabled && analysis.suggested_reply) {
    // Otomatik liste: insan gibi gecikme + yazma simulasyonu ile gonder
    const { humanAutoReply } = require('./whatsapp');
    try {
      await humanAutoReply(chatId, analysis.suggested_reply);
      queries.createSuggestion({
        chat_id: chatId,
        trigger_wa_id: msg.id._serialized,
        draft: analysis.suggested_reply,
        summary: analysis.summary,
        topic_direction: analysis.topic_direction,
        status: 'sent',
        sent_at: Date.now(),
        created_at: Date.now(),
      });
      log('info', `Otomatik cevap gonderildi -> ${chat.name}`);
    } catch (e) {
      log('error', 'Otomatik cevap gonderilemedi: ' + e.message);
      queries.createSuggestion({
        chat_id: chatId,
        trigger_wa_id: msg.id._serialized,
        draft: analysis.suggested_reply,
        summary: analysis.summary,
        topic_direction: analysis.topic_direction,
        created_at: Date.now(),
      });
    }
  } else if (analysis.suggested_reply) {
    // Onay listesine ekle
    queries.createSuggestion({
      chat_id: chatId,
      trigger_wa_id: msg.id._serialized,
      draft: analysis.suggested_reply,
      summary: analysis.summary,
      topic_direction: analysis.topic_direction,
      created_at: Date.now(),
    });
    log('info', `Cevap onerisi olusturuldu -> ${chat.name} (panelden onaylayin)`);
  }
}

module.exports = { handleIncomingMessage };
