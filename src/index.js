const { init, log } = require('./db');
const { startServer } = require('./server');
const whatsapp = require('./whatsapp');

init();
startServer();
whatsapp.start();

process.on('unhandledRejection', (err) => {
  log('error', 'Beklenmeyen hata: ' + (err?.message || err));
});
