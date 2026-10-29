/**
 * rohUpdates.ts — Roh-Protokoll aller Updates einer Gruppe, 48 h lang (Diagnose).
 *
 * Anlass 29.10.2026: Werbe-Spam stand in der Hauptgruppe, im Bot-Log war nur "UPD: message" zu sehen.
 * Ohne das Roh-Update ließ sich nicht klären, wer gesendet hat (Nutzer, Kanal, Bot, via_bot).
 * Gespeichert wird das Update-JSON in der Tabelle raw_updates; älter als 48 h wird gelöscht.
 * Gruppen: Umgebung RAW_LOG_CHATS (Kommagetrennt), Standard = Hauptgruppe.
 */
import { getDatabase } from './db';

const STANDARD = '-1002854099024';
const BEHALTEN_MS = 48 * 3600 * 1000;
let tabelleDa = false;
let letzteAufraeumung = 0;

function chats(): Set<string> {
  const s = new Set<string>((process.env.RAW_LOG_CHATS || STANDARD).split(',').map(x => x.trim()).filter(Boolean));
  return s;
}

export function updateChatId(update: any): string | null {
  const u = update || {};
  const m = u.message || u.edited_message || u.channel_post || u.edited_channel_post || u.business_message
    || u.my_chat_member || u.chat_member || u.chat_join_request || u.callback_query?.message;
  return m?.chat?.id !== undefined ? String(m.chat.id) : null;
}

export function protokolliereRoh(update: any): void {
  try {
    const chatId = updateChatId(update);
    if (!chatId || !chats().has(chatId)) return;
    const db = getDatabase();
    if (!tabelleDa) {
      db.exec(`CREATE TABLE IF NOT EXISTS raw_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, update_id INTEGER, chat_id TEXT, art TEXT, json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_raw_created ON raw_updates(created_at)`);
      tabelleDa = true;
    }
    const art = Object.keys(update).find(k => k !== 'update_id') || '?';
    db.prepare('INSERT INTO raw_updates (created_at, update_id, chat_id, art, json) VALUES (?,?,?,?,?)')
      .run(Date.now(), update.update_id ?? null, chatId, art, JSON.stringify(update));
    if (Date.now() - letzteAufraeumung > 10 * 60 * 1000) {
      letzteAufraeumung = Date.now();
      db.prepare('DELETE FROM raw_updates WHERE created_at < ?').run(Date.now() - BEHALTEN_MS);
    }
  } catch (e: unknown) {
    console.error('[RohUpdates] Fehler:', e instanceof Error ? e.message : String(e));
  }
}
