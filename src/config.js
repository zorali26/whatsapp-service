require('dotenv').config();
const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  panelToken: process.env.PANEL_TOKEN || '',

  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },

  // Asistanin kimligi / tarzi — SAHIBININ birebir kopyasi. DeepSeek promptuna girer.
  ownerName: process.env.OWNER_NAME || 'Kullanici',
  assistantStyle:
    process.env.ASSISTANT_STYLE ||
    'Kisa, oz ve dogal Turkce. Kucuk harflerle yaz, noktalama isareti kullanma, ASLA emoji kullanma. ' +
    'Mesajlar cok kisa: genelde 1-4 kelime ya da tek kisa cumle. Karsi taraf bir bilgi verirse sadece ' +
    '"tamam", "anladim", "olur", "iyi" gibi kisa bir onay yaz ve birak. Basit soru varsa basit ve dogrudan ' +
    'cevap ver (soru: nerdesin -> cevap: okuldayim). Sohbeti uzatmaya calisana kisa cevabi kapat: ' +
    '"suan musait degilim" ya da "sonra bakarim". Asla soru sorma, asla yeni konu acma, asla uzun aciklama yapma.',

  // Insan benzeri davranis ayarlari
  replyDelayMinMs: parseInt(process.env.REPLY_DELAY_MIN_MS || '4000', 10),
  replyDelayMaxMs: parseInt(process.env.REPLY_DELAY_MAX_MS || '15000', 10),
  typingPerCharMs: parseInt(process.env.TYPING_PER_CHAR_MS || '35', 10),

  // Baglanti icin kac gunluk gecmis mesaj yuklensin
  fetchHistoryOnStart: process.env.FETCH_HISTORY_ON_START !== 'false',
  historyLimitPerChat: parseInt(process.env.HISTORY_LIMIT_PER_CHAT || '20', 10),

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },

  // Puppeteer yok; tarayicisiz (Baileys). Bu alan bilerek kaldirildi.
};

if (!config.panelToken) {
  console.warn('[UYARI] PANEL_TOKEN tanimli degil! Panel herkese acik olur. .env dosyasinda PANEL_TOKEN belirleyin.');
}

module.exports = config;
