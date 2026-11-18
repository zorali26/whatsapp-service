const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

let db = null;

function init() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(path.join(config.dataDir, 'asistan.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER DEFAULT 0,
      summary TEXT,
      topic_direction TEXT,
      summary_updated_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      wa_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender TEXT,
      sender_name TEXT,
      body TEXT,
      from_me INTEGER DEFAULT 0,
      type TEXT,
      timestamp INTEGER,
      has_media INTEGER DEFAULT 0,
      FOREIGN KEY (chat_id) REFERENCES chats(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      trigger_wa_id TEXT,
      draft TEXT NOT NULL,
      summary TEXT,
      topic_direction TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS rules (
      chat_id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      instruction TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT,
      message TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocks (
      chat_id TEXT PRIMARY KEY,
      reason TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      lid TEXT DEFAULT '',
      phone TEXT DEFAULT ''
    );
  `);

  // Migrasyon: eski veritabanlarina living_note kolonu ekle
  try {
    db.prepare('ALTER TABLE chats ADD COLUMN living_note TEXT').run();
  } catch (e) {
    if (!/duplicate column/i.test(String(e.message))) throw e;
  }
  return db;
}

function log(level, message) {
  const entry = `[${level}] ${message}`;
  if (level === 'error') console.error(entry); else console.log(entry);
  try {
    db.prepare('INSERT INTO logs (level, message, created_at) VALUES (?, ?, ?)').run(
      level, String(message).slice(0, 2000), Date.now()
    );
  } catch (_) { /* db henuz hazir degilse sessiz gec */ }
}

const queries = {
  upsertChat(chat) {
    db.prepare(`
      INSERT INTO chats (id, name, is_group, updated_at)
      VALUES (@id, @name, @is_group, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        is_group = excluded.is_group,
        updated_at = excluded.updated_at
    `).run(chat);
  },
  saveMessage(msg) {
    db.prepare(`
      INSERT INTO messages (wa_id, chat_id, sender, sender_name, body, from_me, type, timestamp, has_media)
      VALUES (@wa_id, @chat_id, @sender, @sender_name, @body, @from_me, @type, @timestamp, @has_media)
      ON CONFLICT(wa_id) DO NOTHING
    `).run(msg);
  },
  recentMessages(chatId, limit) {
    return db.prepare(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(chatId, limit).reverse();
  },
  listChats() {
    return db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM suggestions s WHERE s.chat_id = c.id AND s.status = 'pending') AS pending_suggestions,
        (SELECT MAX(timestamp) FROM messages m WHERE m.chat_id = c.id) AS last_message_at,
        COALESCE((SELECT enabled FROM rules r WHERE r.chat_id = c.id), 0) AS auto_enabled,
        COALESCE((SELECT instruction FROM rules r WHERE r.chat_id = c.id), '') AS auto_instruction,
        COALESCE((SELECT 1 FROM blocks b WHERE b.chat_id = c.id), 0) AS blacklisted
      FROM chats c
      ORDER BY last_message_at DESC
    `).all();
  },
  updateChatSummary(chatId, summary, topicDirection) {
    db.prepare(`
      UPDATE chats SET summary = ?, topic_direction = ?, summary_updated_at = ?, updated_at = ?
      WHERE id = ?
    `).run(summary, topicDirection, Date.now(), Date.now(), chatId);
  },
  updateChatNote(chatId, note) {
    db.prepare('UPDATE chats SET living_note = ?, updated_at = ? WHERE id = ?')
      .run(String(note || '').slice(0, 4000), Date.now(), chatId);
  },
  getChatNote(chatId) {
    return db.prepare('SELECT living_note FROM chats WHERE id = ?').get(chatId)?.living_note || '';
  },
  createSuggestion(s) {
    db.prepare(`
      INSERT INTO suggestions (chat_id, trigger_wa_id, draft, summary, topic_direction, status, created_at, sent_at)
      VALUES (@chat_id, @trigger_wa_id, @draft, @summary, @topic_direction, @status, @created_at, @sent_at)
    `).run({
      status: 'pending',
      sent_at: null,
      ...s,
    });
  },
  listSuggestions(status) {
    return db.prepare(`
      SELECT s.*, c.name AS chat_name FROM suggestions s
      JOIN chats c ON c.id = s.chat_id
      WHERE s.status = ? ORDER BY s.created_at DESC
    `).all(status);
  },
  getSuggestion(id) {
    return db.prepare('SELECT s.*, c.name AS chat_name FROM suggestions s JOIN chats c ON c.id = s.chat_id WHERE s.id = ?').get(id);
  },
  setSuggestionStatus(id, status) {
    db.prepare('UPDATE suggestions SET status = ?, sent_at = ? WHERE id = ?')
      .run(status, status === 'sent' ? Date.now() : null, id);
  },
  getRule(chatId) {
    return db.prepare('SELECT * FROM rules WHERE chat_id = ?').get(chatId);
  },
  getBlock(chatId) {
    return db.prepare('SELECT * FROM blocks WHERE chat_id = ?').get(chatId);
  },
  saveContact({ jid, name, lid, phone }) {
    db.prepare(`
      INSERT INTO contacts (jid, name, lid, phone) VALUES (@jid, @name, @lid, @phone)
      ON CONFLICT(jid) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        lid = CASE WHEN excluded.lid != '' THEN excluded.lid ELSE contacts.lid END,
        phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE contacts.phone END
    `).run({ jid, name: name || '', lid: lid || '', phone: phone || '' });
  },
  getContactByJid(jid) {
    return db.prepare('SELECT * FROM contacts WHERE jid = ?').get(jid);
  },
  getContactByLid(lid) {
    return db.prepare('SELECT * FROM contacts WHERE lid = ?').get(lid);
  },
  repairChatNames() {
    // Cozulmus kisilerden isim geldi; hala "9053..." veya "Kisi ..." gorunen sohbetleri duzelt
    return db.prepare(`
      UPDATE chats
      SET name = (
        SELECT c.name FROM contacts c
        WHERE (c.jid = chats.id OR c.lid = chats.id) AND c.name != ''
        LIMIT 1
      )
      WHERE (name GLOB '[0-9]*' OR name LIKE 'Kişi %')
        AND EXISTS (
          SELECT 1 FROM contacts c
          WHERE (c.jid = chats.id OR c.lid = chats.id) AND c.name != ''
        )
    `).run();
  },
  setBlock(chatId, reason) {
    db.prepare(`
      INSERT INTO blocks (chat_id, reason, created_at) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET reason = excluded.reason
    `).run(chatId, reason || '', Date.now());
  },
  removeBlock(chatId) {
    db.prepare('DELETE FROM blocks WHERE chat_id = ?').run(chatId);
  },
  listBlocks() {
    return db.prepare(`
      SELECT b.*, c.name AS chat_name FROM blocks b
      LEFT JOIN chats c ON c.id = b.chat_id
    `).all();
  },
  setRule(chatId, enabled, instruction) {
    db.prepare(`
      INSERT INTO rules (chat_id, enabled, instruction) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET enabled = excluded.enabled, instruction = excluded.instruction
    `).run(chatId, enabled ? 1 : 0, instruction || '');
  },
  listRules() {
    return db.prepare('SELECT r.*, c.name AS chat_name FROM rules r JOIN chats c ON c.id = r.chat_id WHERE r.enabled = 1').all();
  },
  recentLogs(limit) {
    return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit);
  },
  getMessageByWaId(waId) {
    return db.prepare('SELECT * FROM messages WHERE wa_id = ?').get(waId);
  },
  latestMessagesSince(ms) {
    return db.prepare(`
      SELECT m.*, c.name AS chat_name FROM messages m
      JOIN chats c ON c.id = m.chat_id
      WHERE m.timestamp > ?
      ORDER BY m.timestamp ASC
      LIMIT 30
    `).all(ms);
  },
  stats() {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return {
      chats: db.prepare('SELECT COUNT(*) AS c FROM chats').get().c,
      todayMessages: db.prepare('SELECT COUNT(*) AS c FROM messages WHERE timestamp > ?').get(dayAgo).c,
      pending: db.prepare("SELECT COUNT(*) AS c FROM suggestions WHERE status = 'pending'").get().c,
      autoOn: db.prepare('SELECT COUNT(*) AS c FROM rules WHERE enabled = 1').get().c,
    };
  },
  activityFeed(limit) {
    return db.prepare(`
      SELECT m.*, c.name AS chat_name FROM messages m
      JOIN chats c ON c.id = m.chat_id
      ORDER BY m.timestamp DESC
      LIMIT ?
    `).all(limit);
  },
  savePushSubscription(json) {
    db.prepare('INSERT OR IGNORE INTO push_subscriptions (data, created_at) VALUES (?, ?)').run(json, Date.now());
  },
  listPushSubscriptions() {
    return db.prepare('SELECT data FROM push_subscriptions').all().map((r) => JSON.parse(r.data));
  },
  deletePushSubscription(json) {
    db.prepare('DELETE FROM push_subscriptions WHERE data = ?').run(json);
  },
  recentChatsWithMessages(limit) {
    return db.prepare('SELECT * FROM chats ORDER BY updated_at DESC LIMIT ?').all(limit);
  },
};

module.exports = { init, queries, log };
