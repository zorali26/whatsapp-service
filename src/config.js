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

  // Asistanin kimligi / tarzi. DeepSeek promptuna girer.
  ownerName: process.env.OWNER_NAME || 'Kullanici',
  assistantStyle:
    process.env.ASSISTANT_STYLE ||
    'Samimi, kisa ve dogal Turkce yaz. Emojiyi nadiren ve yerinde kullan. Resmi olma, ama saygisiz da olma.',

  // Insan benzeri davranis ayarlari
  replyDelayMinMs: parseInt(process.env.REPLY_DELAY_MIN_MS || '4000', 10),
  replyDelayMaxMs: parseInt(process.env.REPLY_DELAY_MAX_MS || '15000', 10),
  typingPerCharMs: parseInt(process.env.TYPING_PER_CHAR_MS || '35', 10),

  // Baglanti icin kac gunluk gecmis mesaj yuklensin
  fetchHistoryOnStart: process.env.FETCH_HISTORY_ON_START !== 'false',
  historyLimitPerChat: parseInt(process.env.HISTORY_LIMIT_PER_CHAT || '20', 10),

  // Puppeteer / Chrome
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
};

if (!config.panelToken) {
  console.warn('[UYARI] PANEL_TOKEN tanimli degil! Panel herkese acik olur. .env dosyasinda PANEL_TOKEN belirleyin.');
}

module.exports = config;
