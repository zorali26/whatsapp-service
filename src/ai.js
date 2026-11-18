const config = require('./config');

/**
 * DeepSeek API (OpenAI-uyumlu chat completions).
 * https://api-docs.deepseek.com
 */
async function chatCompletion(messages, { temperature = 0.7, maxTokens = 1200, json = false } = {}) {
  if (!config.deepseek.apiKey) {
    throw new Error('DEEPSEEK_API_KEY tanimli degil. .env dosyasina ekleyin.');
  }
  const body = {
    model: config.deepseek.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseek.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DeepSeek API hatasi ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function formatTranscript(messages) {
  return messages
    .map((m) => `[${m.from_me ? config.ownerName : (m.sender_name || m.sender || 'Karsi taraf')}]: ${m.body || '(medya)'}`)
    .join('\n');
}

/**
 * Sohbetin ozetini, konunun gittigi yonu ve cevap taslagini uretir.
 * JSON doner: { summary, topic_direction, suggested_reply }
 */
async function analyzeConversation({ chatName, recentMessages, instruction }) {
  const transcript = formatTranscript(recentMessages);

  // Sahibinin gercek mesajlarini "taklit ornegi" olarak promptta kullan
  const ownSamples = (recentMessages || [])
    .filter((m) => m.from_me && m.body && m.body.trim().length > 0)
    .slice(-15)
    .map((m) => '- "' + m.body.slice(0, 140) + '"')
    .join('\n');

  const system = [
    'Sen kullanicinin sahsi WhatsApp kopyasisin — onun yerine, onun agziyla yazarsin, bir asistan gibi degil.',
    `Kullanicinin adi: ${config.ownerName}.`,
    `Yazma tarzi / kisiligi: ${config.assistantStyle}`,
    'KESIN KURALLAR:',
    '- Kucuk harflerle yaz, noktalama isareti kullanma, ASLA emoji kullanma.',
    '- Cevap COK KISA olsun: genelde 1-5 kelime, en fazla tek kisa cumle.',
    '- Karsi tarafin soyledigi seyi ayni kelimelerle geri besleme (echo YAPMA). Dogal ve dusuk seste yaz.',
    '- Karsi taraf bilgi/haber verdiyse: sadece kisa bir onay ("tamam", "anladim", "olur") yaz.',
    '- Basit soruya basit ve dogrudan cevap ver.',
    '- Sohbeti uzatmak isteyene kisa kapat: "suan musait degilim" / "sonra bakarim".',
    '- Uzun aciklama yapma. Asla konu acma. Gereksiz soru sorma.',
    'DOGAL CEVAP ORNEKLERI:',
    '- "naber" -> "iyiyim senden"',
    '- "nasilsin" -> "iyiyim senden naber"',
    '- "anahtarları ayakkabı içine koydum" -> "tamam"',
    '- "nerdesin" -> "okulda"',
    '- "geliyor musun" -> "bak bakarim"',
    '- "bugun planin ne" -> "birsey yok"',
    '- "(sohbeti uzatmak ister / icraat ister)" -> "suan musait degilim"',
    ownSamples ? `SENIN GERCEK SON MESAJLARIN (birebir taklit et — ayni uzunluk, ayni tarz, ayni kelimeler):\n${ownSamples}` : '',
    instruction ? `Bu sohbet icin ozel talimat: ${instruction}` : '',
    'Yalnizca gecerli JSON don, baskaca hicbir sey yazma. Format:',
    '{"summary": "...", "topic_direction": "...", "suggested_reply": "..."}',
    'summary ve topic_direction Turkce, kisa (1-3 cumle) olsun. suggested_reply yukaridaki tum kurallara uyacak, kullanicinin birebir agzindan cikmis gibi kisa bir WhatsApp mesaji olsun.',
  ].filter(Boolean).join('\n');

  const user = `Sohbet: ${chatName}\n\nSon mesajlar:\n${transcript}\n\nJSON dondur.`;

  const raw = await chatCompletion(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.6, maxTokens: 900, json: true }
  );

  try {
    const parsed = JSON.parse(raw);
    return {
      summary: (parsed.summary || '').slice(0, 2000),
      topic_direction: (parsed.topic_direction || '').slice(0, 2000),
      suggested_reply: (parsed.suggested_reply || '').slice(0, 2000),
    };
  } catch (_) {
    // Model JSON yerine duz metin dondiyse en azindan cevap taslagi olarak kullan
    return { summary: '', topic_direction: '', suggested_reply: raw.slice(0, 2000) };
  }
}

/** Serbest soru: "Bu sohbette konu nereye gidiyor?" gibi sorular icin. */
async function askAboutChat({ chatName, recentMessages, question }) {
  const transcript = formatTranscript(recentMessages);
  return chatCompletion(
    [
      { role: 'system', content: `Kullanicinin kisisel WhatsApp asistanisin. ${config.ownerName} adina dusunuyorsun. Turkce, kisa ve net cevap ver.` },
      { role: 'user', content: `Sohbet: ${chatName}\n\nGecmis:\n${transcript}\n\nSoru: ${question}` },
    ],
    { temperature: 0.4, maxTokens: 700 }
  );
}

module.exports = { analyzeConversation, askAboutChat, chatCompletion };
