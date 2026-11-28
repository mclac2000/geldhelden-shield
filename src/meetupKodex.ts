/**
 * meetupKodex.ts — Verhaltenskodex + Verwarnsystem fuer alle GeldHelden-Meetup-Gruppen
 * (Auftrag Marco 27.11.2026).
 *
 * Anlass: In einer Meetup-Gruppe wurden ueber ein anonymes Konto ("R") Investments verkauft, und eine
 * zweite Person wurde ohne Beleg mitgesperrt. Daraus drei Regeln:
 *
 *   1. KODEX. Wer einer Meetup-Gruppe beitritt, darf erst schreiben, wenn er per Knopf bestaetigt:
 *      "Ich verkaufe oder vermittle in den Gruppen und per Privatnachricht an Mitglieder keine Investments
 *      bzw. Finanzprodukte und werbe nicht fuer eigene Angebote. Verstoesse fuehren zum Ausschluss."
 *      Eine Bestaetigung gilt fuer ALLE Meetup-Gruppen. Bestehende Mitglieder werden einmal per
 *      angepinnter Nachricht gebeten (Frist 14 Tage, danach eine Erinnerung) — niemand wird stummgeschaltet.
 *   2. ANONYME KONTEN (kein erkennbarer Name, oder weder @Name noch Profilbild) stellen sich nach dem Kodex
 *      kurz im Privatchat mit dem Bot vor (Name + Bezug zu GeldHelden). Erst dann Schreibrecht.
 *   3. VERWARNSYSTEM wie im Freiheits-Helden-Club, Zaehlung gemeinsam ueber alle Meetup-Gruppen:
 *        Stufe 1 = Verwarnung, Stufe 2 = 7 Tage stumm (in allen Meetup-Gruppen), Stufe 3 = Ausschluss.
 *        Werbung/Investment-Verkauf mit Beleg startet direkt bei Stufe 2.
 *        STUFE 3 = AUSSCHLUSS IN ALLEN GELDHELDEN-GRUPPEN (banUserGlobally, wie ein Admin-Bann; geht auch in die
 *        gemeinsame Sperrliste zu MeinCEO). Entscheidung Marco 28.11.2026 — bewusst so, nicht auf Meetup-Gruppen begrenzen.
 *      KEIN SCHRITT OHNE BELEG: /verwarnen und /werbung gehen nur als Antwort auf die Nachricht (die
 *      Nachricht wird vorher in den Admin-Log weitergeleitet = gespeicherter Beleg) oder mit einer
 *      Meldungsnummer (M123) aus dem Meldeweg (weitergeleitete Privatnachricht / Screenshot).
 *
 * SEIT 28.11.2026 LAEUFT ALLES PRIVAT: Beitritt per Telegram-Beitrittsanfrage (Links mit creates_join_request).
 *   Der Bot schreibt dem Anfragenden privat (Kodex-Knopf, ggf. Vorstellung) und genehmigt erst danach;
 *   nach 48 Std. ohne Antwort wird abgelehnt. In der Gruppe: keine Begruessung, Beitrittsmeldungen werden geloescht.
 *   Direktbeitritt (alte Links): sofort stumm, Kodex privat bzw. 60-s-Hinweis mit Deep-Link (kx_).
 *
 * Schalter (.env):  KODEX_AKTIV=1  -> alle Meetup-Gruppen.   KODEX_TESTCHAT=<chat_id> -> Testgruppe
 * (dort wirken Strafen NUR in der Testgruppe, nie global; Bot-Admins werden dort wie Mitglieder behandelt).
 */
import { Context, Markup, Telegraf } from 'telegraf';
import { config } from './config';
import { getDatabase, isTeamMember } from './db';
import { isAdmin } from './admin';

export const KODEX_TEXT =
  'Ich verkaufe oder vermittle in den Gruppen und per Privatnachricht an Mitglieder keine Investments ' +
  'bzw. Finanzprodukte und werbe nicht für eigene Angebote. Verstöße führen zum Ausschluss.';

const FRIST_TAGE = 14;
const STUMM_TAGE = 7;
const ZUSATZ_LOKALGRUPPEN = ['köln und umland', 'raum hannover', 'geldhelden pattaya'];

// ---------------------------------------------------------------------------------------------
// Tabellen (nur CREATE IF NOT EXISTS / ADD COLUMN nach Pragma-Pruefung)
// ---------------------------------------------------------------------------------------------
let bereit = false;
export function stelleTabellenSicher(): void {
  if (bereit) return;
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS kodex_bestaetigung (
      user_id INTEGER PRIMARY KEY,
      bestaetigt_at INTEGER NOT NULL,
      chat_id TEXT,
      quelle TEXT
    );
    CREATE TABLE IF NOT EXISTS kodex_gate (
      user_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      name TEXT,
      gate_msg_id INTEGER,
      anonym INTEGER NOT NULL DEFAULT 0,
      eingeschraenkt INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'offen',
      vorstellung TEXT,
      freigegeben_at INTEGER,
      PRIMARY KEY (user_id, chat_id)
    );
    CREATE TABLE IF NOT EXISTS kodex_aufruf (
      chat_id TEXT PRIMARY KEY,
      msg_id INTEGER,
      gestartet_at INTEGER NOT NULL,
      frist_at INTEGER NOT NULL,
      erinnert_at INTEGER,
      erinnerung_msg_id INTEGER,
      fehler TEXT
    );
    CREATE TABLE IF NOT EXISTS verwarnungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT,
      chat_id TEXT,
      art TEXT NOT NULL,
      stufe INTEGER NOT NULL,
      grund TEXT,
      beleg_art TEXT NOT NULL,
      beleg_text TEXT,
      beleg_chat_id TEXT,
      beleg_msg_id INTEGER,
      beleg_kopie_msg_id INTEGER,
      meldung_id INTEGER,
      von_id INTEGER NOT NULL,
      von_name TEXT,
      massnahme_ergebnis TEXT,
      test INTEGER NOT NULL DEFAULT 0,
      aufgehoben_at INTEGER,
      aufgehoben_von INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_verwarnungen_user ON verwarnungen(user_id);
    CREATE TABLE IF NOT EXISTS kodex_anfrage (
      user_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      dm_msg_id INTEGER,
      anonym INTEGER NOT NULL DEFAULT 0,
      name TEXT,
      username TEXT,
      vorstellung TEXT,
      entschieden_at INTEGER,
      grund TEXT,
      PRIMARY KEY (user_id, chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kodex_anfrage_status ON kodex_anfrage(status, created_at);
  `);
  // meldungen (aus meldeweg.ts) um Gruppen-Meldungen erweitern — idempotent.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS meldungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, melder_id INTEGER NOT NULL,
      melder_username TEXT, melder_name TEXT, gemeldet_id INTEGER, gemeldet_username TEXT, gemeldet_name TEXT,
      herkunft TEXT NOT NULL, text TEXT, original_datum INTEGER, bearbeitet INTEGER NOT NULL DEFAULT 0, notiz TEXT,
      roh_weiterleitung TEXT, roh_art TEXT)`);
    const spalten = (db.prepare('PRAGMA table_info(meldungen)').all() as Array<{ name: string }>).map((s) => s.name);
    for (const [s, t] of [['quelle_chat_id', 'TEXT'], ['quelle_msg_id', 'INTEGER'], ['beleg_kopie_msg_id', 'INTEGER']]) {
      if (!spalten.includes(s)) db.exec(`ALTER TABLE meldungen ADD COLUMN ${s} ${t}`);
    }
  } catch (e: any) {
    console.warn('[Kodex] meldungen-Erweiterung:', e?.message);
  }
  bereit = true;
}

// ---------------------------------------------------------------------------------------------
// Welche Gruppen
// ---------------------------------------------------------------------------------------------
function testChat(): string | null {
  const t = (process.env.KODEX_TESTCHAT || '').trim();
  return t || null;
}
function kodexAktiv(): boolean {
  return (process.env.KODEX_AKTIV || '').trim() === '1';
}
export function istTestChat(chatId: string | number | null | undefined): boolean {
  const t = testChat();
  return !!t && chatId !== null && chatId !== undefined && String(chatId) === t;
}

/** Alle aktiven Meetup-Gruppen (ohne Testgruppe). */
export function meetupGruppen(): Array<{ chatId: string; title: string }> {
  const db = getDatabase();
  const spalten = (db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>).map((s) => s.name);
  const aufg = spalten.includes('aufgeloest') ? 'AND COALESCE(g.aufgeloest,0) = 0' : '';
  const rows = db.prepare(`
    SELECT g.chat_id AS chatId, COALESCE(g.title,'') AS title,
           (SELECT 1 FROM meetup_group_mapping m WHERE m.chat_id = g.chat_id) AS gemappt
    FROM groups g
    WHERE g.status = 'managed' ${aufg} AND g.chat_id LIKE '-100%'
  `).all() as Array<{ chatId: string; title: string; gemappt: number | null }>;
  return rows
    .filter((r) => {
      const t = r.title.toLowerCase();
      return !!r.gemappt || t.includes('meetup') || ZUSATZ_LOKALGRUPPEN.some((z) => t.includes(z));
    })
    .filter((r) => !istTestChat(r.chatId))
    .map((r) => ({ chatId: r.chatId, title: r.title }));
}

let cacheGruppen: { at: number; ids: Set<string> } | null = null;
export function istKodexGruppe(chatId: string | number): boolean {
  const id = String(chatId);
  if (istTestChat(id)) return true;
  if (!kodexAktiv()) return false;
  if (!cacheGruppen || Date.now() - cacheGruppen.at > 10 * 60 * 1000) {
    cacheGruppen = { at: Date.now(), ids: new Set(meetupGruppen().map((g) => g.chatId)) };
  }
  return cacheGruppen.ids.has(id);
}

/** Wirkungsbereich von Strafen: Testgruppe -> nur Testgruppe; sonst alle Meetup-Gruppen. */
function wirkungsGruppen(ausloeserChat: string | null): string[] {
  if (ausloeserChat && istTestChat(ausloeserChat)) return [ausloeserChat];
  return meetupGruppen().map((g) => g.chatId);
}

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function nameVon(u: { first_name?: string; last_name?: string; username?: string } | null | undefined): string {
  if (!u) return 'Unbekannt';
  const n = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  return n || (u.username ? '@' + u.username : 'Mitglied');
}
function erwaehnung(u: { id: number; first_name?: string; last_name?: string; username?: string }): string {
  return `<a href="tg://user?id=${u.id}">${esc(nameVon(u))}</a>`;
}
function buchstaben(s: string): number {
  return (s.match(/\p{L}/gu) || []).length;
}
let botName: string | null = null;
async function botUsername(telegram: any): Promise<string> {
  if (botName) return botName;
  try { botName = (await telegram.getMe()).username || 'geldhelden_shield_bot'; } catch { botName = 'geldhelden_shield_bot'; }
  return botName as string;
}
function datum(ms: number): string {
  const d = new Date(ms + 3600000); // MEZ reicht fuer ein Datum
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
}
function chatParam(chatId: string): string {
  return chatId.replace('-', 'm');
}
async function adminLog(telegram: any, html: string): Promise<void> {
  try {
    await telegram.sendMessage(config.adminLogChat, html, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e: any) {
    console.error('[Kodex] Admin-Log fehlgeschlagen:', e?.message);
  }
}

const KEINE_RECHTE = {
  can_send_messages: false, can_send_audios: false, can_send_documents: false, can_send_photos: false,
  can_send_videos: false, can_send_video_notes: false, can_send_voice_notes: false, can_send_polls: false,
  can_send_other_messages: false, can_add_web_page_previews: false,
};
const ALLE_RECHTE = {
  can_send_messages: true, can_send_audios: true, can_send_documents: true, can_send_photos: true,
  can_send_videos: true, can_send_video_notes: true, can_send_voice_notes: true, can_send_polls: true,
  can_send_other_messages: true, can_add_web_page_previews: true,
};

export function hatKodexBestaetigt(userId: number): boolean {
  stelleTabellenSicher();
  return !!getDatabase().prepare('SELECT 1 FROM kodex_bestaetigung WHERE user_id = ?').get(userId);
}
function merkeBestaetigung(userId: number, chatId: string, quelle: string): void {
  getDatabase().prepare(
    'INSERT OR IGNORE INTO kodex_bestaetigung (user_id, bestaetigt_at, chat_id, quelle) VALUES (?, ?, ?, ?)'
  ).run(userId, Date.now(), chatId, quelle);
}
function hatVorstellung(userId: number): boolean {
  return !!getDatabase().prepare(
    "SELECT 1 FROM kodex_gate WHERE user_id = ? AND vorstellung IS NOT NULL AND vorstellung <> '' LIMIT 1"
  ).get(userId);
}
function aktivStumm(userId: number): boolean {
  return !!getDatabase().prepare(
    'SELECT 1 FROM verwarnungen WHERE user_id = ? AND stufe >= 2 AND aufgehoben_at IS NULL AND created_at > ? LIMIT 1'
  ).get(userId, Date.now() - STUMM_TAGE * 86400000);
}
function shieldSperre(userId: number): boolean {
  const r = getDatabase().prepare('SELECT status FROM users WHERE user_id = ?').get(userId) as any;
  return !!r && (r.status === 'restricted' || r.status === 'banned');
}

async function istGruppenleiter(telegram: any, chatId: string, userId: number): Promise<boolean> {
  if (isAdmin(userId)) return true;
  try {
    const m = await telegram.getChatMember(chatId, userId);
    return m.status === 'administrator' || m.status === 'creator';
  } catch { return false; }
}
const leiterCache = new Map<number, { at: number; ok: boolean }>();
/** Fuer Befehle im Privatchat: Admin des Bots oder Admin in mindestens einer Meetup-Gruppe. */
async function istLeiterIrgendwo(telegram: any, userId: number): Promise<boolean> {
  if (isAdmin(userId)) return true;
  const c = leiterCache.get(userId);
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.ok;
  let ok = false;
  const t = testChat();
  const ids = [...(t ? [t] : []), ...meetupGruppen().map((g) => g.chatId)];
  for (const id of ids) {
    if (await istGruppenleiter(telegram, id, userId)) { ok = true; break; }
  }
  leiterCache.set(userId, { at: Date.now(), ok });
  return ok;
}

/** Wer ist geschuetzt (nie Gate, nie Strafe)? In der Testgruppe gelten Bot-Admins/Team als Mitglieder. */
async function geschuetzt(telegram: any, chatId: string | null, userId: number, istBot = false): Promise<boolean> {
  if (istBot) return true;
  if (userId <= 0 || userId === 777000 || userId === 1087968824 || userId === 136817688) return true;
  const test = istTestChat(chatId);
  if (!test && (isAdmin(userId) || isTeamMember(userId))) return true;
  if (chatId && !test) {
    try {
      const m = await telegram.getChatMember(chatId, userId);
      if (m.status === 'administrator' || m.status === 'creator') return true;
    } catch { /* kein Mitglied -> nicht geschuetzt */ }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// 1. Beitritt
// ---------------------------------------------------------------------------------------------
export function istAnonym(u: { first_name?: string; last_name?: string; username?: string }, hatFoto: boolean | null): boolean {
  const nameBuchstaben = buchstaben(`${u.first_name || ''}${u.last_name || ''}`);
  if (nameBuchstaben < 3) return true;               // "R", ".", nur Emojis
  if (!u.username && hatFoto === false) return true; // weder @Name noch Profilbild
  return false;
}

export async function aufBeitritt(
  telegram: any, chatId: string,
  user: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
): Promise<void> {
  // Seit 28.11.2026: Normalweg ist die Beitrittsanfrage (siehe aufBeitrittsanfrage) — die Gruppe bleibt still.
  // Hier landet nur, wer DIREKT beitritt (alte Links, oeffentlicher @Name ohne Anfrage): sofort stumm,
  // Kodex privat; geht privat nicht, eine kurze Gruppennachricht mit Deep-Link, die sich nach 60 s loescht.
  try {
    if (!istKodexGruppe(chatId)) return;
    stelleTabellenSicher();
    if (await geschuetzt(telegram, chatId, user.id, !!user.is_bot)) return;
    if (shieldSperre(user.id)) return; // die Scam-Erkennung hat schon gehandelt

    const db = getDatabase();
    // Ueber eine Beitrittsanfrage freigegeben -> alles erledigt.
    const genehmigt = db.prepare("SELECT 1 FROM kodex_anfrage WHERE user_id = ? AND chat_id = ? AND status = 'genehmigt' AND entschieden_at > ?")
      .get(user.id, chatId, Date.now() - 3 * 86400000);
    if (genehmigt) return;

    const vorhanden = db.prepare('SELECT status, created_at FROM kodex_gate WHERE user_id = ? AND chat_id = ?')
      .get(user.id, chatId) as any;
    // new_chat_members und chat_member kommen beide -> nur einmal
    if (vorhanden && vorhanden.status !== 'frei' && Date.now() - vorhanden.created_at < 10 * 60 * 1000) return;

    let hatFoto: boolean | null = null;
    try { hatFoto = (await telegram.getUserProfilePhotos(user.id, 0, 1)).total_count > 0; } catch { hatFoto = null; }
    const anonym = istAnonym(user, hatFoto) && !hatVorstellung(user.id);
    const bestaetigt = hatKodexBestaetigt(user.id);
    if (bestaetigt && !anonym) return; // schon erledigt (z. B. aus einer anderen Meetup-Gruppe)

    let eingeschraenkt = 0;
    try {
      await telegram.restrictChatMember(chatId, user.id, { permissions: KEINE_RECHTE, use_independent_chat_permissions: true });
      eingeschraenkt = 1;
    } catch (e: any) {
      console.log(`[Kodex] restrict ${user.id} in ${chatId} nicht moeglich: ${e?.message}`);
    }
    db.prepare(`
      INSERT INTO kodex_gate (user_id, chat_id, created_at, name, gate_msg_id, anonym, eingeschraenkt, status)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(user_id, chat_id) DO UPDATE SET created_at=excluded.created_at, name=excluded.name,
        gate_msg_id=NULL, anonym=excluded.anonym, eingeschraenkt=excluded.eingeschraenkt,
        status=excluded.status, freigegeben_at=NULL
    `).run(user.id, chatId, Date.now(), nameVon(user), anonym ? 1 : 0, eingeschraenkt, bestaetigt ? 'kodex_ok' : 'offen');

    // 1. Versuch: privat (klappt nur, wenn die Person den Bot schon einmal gestartet hat)
    const titel = await gruppenTitel(telegram, chatId);
    let privat = false;
    try {
      await sendeKodexPrivat(telegram, user.id, chatId, titel, bestaetigt, anonym);
      privat = true;
    } catch { /* noch nie gestartet -> Gruppenhinweis */ }

    // 2. Sonst: kurze Gruppennachricht, loescht sich nach 60 s
    if (!privat) {
      const bu = await botUsername(telegram);
      try {
        const m = await telegram.sendMessage(chatId,
          `👋 ${erwaehnung(user)}, bitte bestätige kurz unseren Verhaltenskodex im Privatchat mit mir – dann kannst du hier schreiben.`,
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.url('📜 Kodex bestätigen', `https://t.me/${bu}?start=kx_${chatParam(chatId)}`)]]) });
        db.prepare('UPDATE kodex_gate SET gate_msg_id = ? WHERE user_id = ? AND chat_id = ?').run(m.message_id, user.id, chatId);
        setTimeout(() => {
          telegram.deleteMessage(chatId, m.message_id).catch(() => {});
          try { getDatabase().prepare('UPDATE kodex_gate SET gate_msg_id = NULL WHERE user_id = ? AND chat_id = ? AND gate_msg_id = ?').run(user.id, chatId, m.message_id); } catch { /* egal */ }
        }, 60 * 1000);
      } catch (e: any) {
        console.error('[Kodex] Hinweis-Nachricht fehlgeschlagen:', e?.message);
      }
    }
    console.log(`[Kodex][DIREKTBEITRITT] user=${user.id} chat=${chatId} anonym=${anonym} bestaetigt=${bestaetigt} restrict=${eingeschraenkt} privat=${privat}`);
  } catch (e: any) {
    console.error('[Kodex] aufBeitritt:', e?.message);
  }
}

/** Schreibrecht zurueckgeben — aber nie gegen eine Stummschaltung oder eine Shield-Sperre. */
async function freischalten(telegram: any, userId: number, chatId: string, vorstellung: string | null): Promise<string> {
  const db = getDatabase();
  const g = db.prepare('SELECT * FROM kodex_gate WHERE user_id = ? AND chat_id = ?').get(userId, chatId) as any;
  if (!g) return 'kein_gate';
  let ergebnis = 'frei';
  if (aktivStumm(userId) || shieldSperre(userId)) {
    ergebnis = 'bleibt_eingeschraenkt (Stummschaltung/Shield-Sperre)';
  } else if (g.eingeschraenkt) {
    try {
      await telegram.restrictChatMember(chatId, userId, { permissions: ALLE_RECHTE, use_independent_chat_permissions: true });
    } catch (e: any) {
      ergebnis = 'unrestrict_fehler: ' + e?.message;
    }
  }
  if (g.gate_msg_id) { try { await telegram.deleteMessage(chatId, g.gate_msg_id); } catch { /* egal */ } }
  db.prepare("UPDATE kodex_gate SET status='frei', freigegeben_at=?, gate_msg_id=NULL, vorstellung=COALESCE(?, vorstellung) WHERE user_id=? AND chat_id=?")
    .run(Date.now(), vorstellung, userId, chatId);
  console.log(`[Kodex][FREI] user=${userId} chat=${chatId} -> ${ergebnis}`);
  return ergebnis;
}

// ---------------------------------------------------------------------------------------------
// 2. Knopf "Ich bestaetige den Kodex"  (kodex_ja:<userId>  bzw.  kodex_ja:0 = angepinnter Aufruf)
// ---------------------------------------------------------------------------------------------
export async function behandleKodexKnopf(ctx: Context): Promise<boolean> {
  const cq: any = ctx.callbackQuery;
  if (!cq || typeof cq.data !== 'string' || !cq.data.startsWith('kodex_ja:')) return false;
  stelleTabellenSicher();
  const ziel = parseInt(cq.data.split(':')[1], 10) || 0;
  const from = ctx.from!;
  const chatId = String(cq.message?.chat?.id ?? '');
  if (ziel !== 0 && ziel !== from.id) {
    await ctx.answerCbQuery('Dieser Knopf gehört dem neuen Mitglied. Du kannst über die angepinnte Nachricht bestätigen.', { show_alert: true }).catch(() => {});
    return true;
  }
  const schon = hatKodexBestaetigt(from.id);
  merkeBestaetigung(from.id, chatId, ziel === 0 ? 'aufruf' : 'beitritt');

  const db = getDatabase();
  const g = db.prepare("SELECT * FROM kodex_gate WHERE user_id = ? AND chat_id = ? AND status <> 'frei'").get(from.id, chatId) as any;
  if (!g) {
    await ctx.answerCbQuery(schon ? 'Du hattest schon bestätigt – danke! ✅' : 'Danke, bestätigt ✅ Das gilt für alle GeldHelden-Meetup-Gruppen.', { show_alert: ziel === 0 }).catch(() => {});
    return true;
  }
  if (g.anonym && !g.vorstellung) {
    db.prepare("UPDATE kodex_gate SET status='kodex_ok' WHERE user_id=? AND chat_id=?").run(from.id, chatId);
    const bu = await botUsername(ctx.telegram);
    const link = `https://t.me/${bu}?start=vs_${chatParam(chatId)}`;
    try {
      if (g.gate_msg_id) {
        await ctx.telegram.editMessageText(chatId, g.gate_msg_id, undefined,
          `Danke, ${erwaehnung(from)} – Kodex bestätigt ✅\n\nJetzt noch kurz vorstellen: Tippe auf den Knopf und schreib mir ` +
          'deinen Vornamen und deinen Bezug zu GeldHelden. Dann bist du freigeschaltet.',
          { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.url('👋 Kurz vorstellen', link)]]) } as any);
      }
    } catch { /* egal */ }
    try {
      await ctx.answerCbQuery(undefined, { url: link } as any);
    } catch {
      await ctx.answerCbQuery('Danke! Tippe jetzt auf „Kurz vorstellen“.').catch(() => {});
    }
    return true;
  }
  const erg = await freischalten(ctx.telegram, from.id, chatId, null);
  await ctx.answerCbQuery(erg === 'frei' ? 'Danke, bestätigt ✅ Du kannst jetzt schreiben. Willkommen!' : 'Danke, bestätigt ✅').catch(() => {});
  if (erg !== 'frei') {
    await adminLog(ctx.telegram, `🛡️ Kodex bestätigt, Schreibrecht aber NICHT zurückgegeben: ${erwaehnung(from)} in <code>${chatId}</code> (${esc(erg)})`);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// 3. Alles Private: Beitrittsanfrage, Kodex-Knopf im Privatchat, Vorstellung  (seit 28.11.2026)
// ---------------------------------------------------------------------------------------------
const ANFRAGE_FRIST_STD = 48;
const titelCache = new Map<string, string>();
async function gruppenTitel(telegram: any, chatId: string): Promise<string> {
  if (titelCache.has(chatId)) return titelCache.get(chatId)!;
  let t = '';
  try { t = (getDatabase().prepare('SELECT title FROM groups WHERE chat_id = ?').get(chatId) as any)?.title || ''; } catch { /* egal */ }
  if (!t) { try { t = (await telegram.getChat(chatId)).title || ''; } catch { /* egal */ } }
  t = t || 'GeldHelden-Meetup';
  titelCache.set(chatId, t);
  return t;
}

/** Kodex (bzw. Vorstellungsbitte) privat schicken. Wirft, wenn Telegram die Nachricht nicht zulaesst. */
async function sendeKodexPrivat(telegram: any, privatChat: number, chatId: string, titel: string, bestaetigt: boolean, anonym: boolean): Promise<number> {
  if (bestaetigt && anonym) {
    const m = await telegram.sendMessage(privatChat,
      `👋 Schön, dass du zu <b>${esc(titel)}</b> möchtest!\n\nDen Verhaltenskodex hast du schon bestätigt – danke. ` +
      'Da wir dein Profil noch nicht zuordnen können: Schreib mir bitte kurz <b>deinen Vornamen und deinen Bezug zu GeldHelden</b> ' +
      '(z. B. Newsletter, Webinar, Club, Empfehlung von …). Dann bist du sofort drin.', { parse_mode: 'HTML' });
    return m.message_id;
  }
  const m = await telegram.sendMessage(privatChat,
    `👋 Schön, dass du zu <b>${esc(titel)}</b> möchtest!\n\n` +
    'In allen GeldHelden-Meetup-Gruppen gilt ein kurzer Verhaltenskodex:\n\n' +
    `<i>„${esc(KODEX_TEXT)}“</i>\n\n` +
    (anonym ? 'Nach der Bestätigung bitte ich dich noch kurz um deinen Vornamen und deinen Bezug zu GeldHelden.\n\n' : '') +
    'Einmal bestätigen reicht für alle Meetup-Gruppen.',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Ich stimme zu', `kjr:${chatParam(chatId)}`)]]) });
  return m.message_id;
}

function istGesperrt(userId: number): boolean {
  const db = getDatabase();
  if (db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(userId)) return true;
  const u = db.prepare('SELECT status FROM users WHERE user_id = ?').get(userId) as any;
  return u?.status === 'banned';
}

/** chat_join_request. true = von hier behandelt (Kodex-Gruppe). */
export async function aufBeitrittsanfrage(telegram: any, anfrage: any): Promise<boolean> {
  const chatId = String(anfrage?.chat?.id ?? '');
  const user = anfrage?.from;
  if (!chatId || !user || !istKodexGruppe(chatId)) return false;
  stelleTabellenSicher();
  const db = getDatabase();
  const ablehnen = async (grund: string) => {
    try { await telegram.declineChatJoinRequest(chatId, user.id); } catch (e: any) { console.log('[Kodex] decline:', e?.message); }
    db.prepare(`INSERT INTO kodex_anfrage (user_id, chat_id, created_at, status, entschieden_at, grund) VALUES (?, ?, ?, 'abgelehnt', ?, ?)
      ON CONFLICT(user_id, chat_id) DO UPDATE SET status='abgelehnt', entschieden_at=excluded.entschieden_at, grund=excluded.grund`)
      .run(user.id, chatId, Date.now(), Date.now(), grund);
    console.log(`[Kodex][ANFRAGE-ABGELEHNT] user=${user.id} chat=${chatId} ${grund}`);
  };
  const genehmigen = async (grund: string) => {
    db.prepare(`INSERT INTO kodex_anfrage (user_id, chat_id, created_at, status, entschieden_at, grund) VALUES (?, ?, ?, 'genehmigt', ?, ?)
      ON CONFLICT(user_id, chat_id) DO UPDATE SET status='genehmigt', entschieden_at=excluded.entschieden_at, grund=excluded.grund`)
      .run(user.id, chatId, Date.now(), Date.now(), grund);
    try { await telegram.approveChatJoinRequest(chatId, user.id); } catch (e: any) { console.log('[Kodex] approve:', e?.message); }
    console.log(`[Kodex][ANFRAGE-GENEHMIGT] user=${user.id} chat=${chatId} ${grund}`);
  };

  if (user.is_bot) { await ablehnen('Bot'); return true; }
  if (istGesperrt(user.id)) { await ablehnen('steht auf der Sperrliste'); return true; }
  if (await geschuetzt(telegram, chatId, user.id)) { await genehmigen('Admin/Team'); return true; }

  let hatFoto: boolean | null = null;
  try { hatFoto = (await telegram.getUserProfilePhotos(user.id, 0, 1)).total_count > 0; } catch { hatFoto = null; }
  const anonym = istAnonym(user, hatFoto) && !hatVorstellung(user.id);
  const bestaetigt = hatKodexBestaetigt(user.id);
  if (bestaetigt && !anonym) { await genehmigen('Kodex schon bestätigt'); return true; }

  const privatChat = Number(anfrage.user_chat_id || user.id);
  let dm: number | null = null;
  let status = bestaetigt ? 'warte_vorstellung' : 'offen';
  try {
    dm = await sendeKodexPrivat(telegram, privatChat, chatId, await gruppenTitel(telegram, chatId), bestaetigt, anonym);
  } catch (e: any) {
    status = 'dm_fehler';
    console.log(`[Kodex] Privatnachricht an Anfragenden ${user.id} fehlgeschlagen: ${e?.message}`);
  }
  db.prepare(`INSERT INTO kodex_anfrage (user_id, chat_id, created_at, status, dm_msg_id, anonym, name, username)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, chat_id) DO UPDATE SET created_at=excluded.created_at, status=excluded.status, dm_msg_id=excluded.dm_msg_id,
      anonym=excluded.anonym, name=excluded.name, username=excluded.username, entschieden_at=NULL, grund=NULL, vorstellung=NULL`)
    .run(user.id, chatId, Date.now(), status, dm, anonym ? 1 : 0, nameVon(user), user.username ?? null);
  console.log(`[Kodex][ANFRAGE] user=${user.id} chat=${chatId} anonym=${anonym} bestaetigt=${bestaetigt} status=${status}`);
  return true;
}

/** Offene Vorgaenge einer Person: zuerst Beitrittsanfrage, sonst Direktbeitritt (Gate). */
function offeneAnfrage(userId: number, chatId?: string): any {
  const db = getDatabase();
  return chatId
    ? db.prepare("SELECT * FROM kodex_anfrage WHERE user_id = ? AND chat_id = ? AND status IN ('offen','warte_vorstellung','dm_fehler')").get(userId, chatId)
    : db.prepare("SELECT * FROM kodex_anfrage WHERE user_id = ? AND status IN ('offen','warte_vorstellung','dm_fehler') ORDER BY created_at DESC LIMIT 1").get(userId);
}
function offenesGate(userId: number, chatId?: string): any {
  const db = getDatabase();
  return chatId
    ? db.prepare("SELECT * FROM kodex_gate WHERE user_id = ? AND chat_id = ? AND status <> 'frei'").get(userId, chatId)
    : db.prepare("SELECT * FROM kodex_gate WHERE user_id = ? AND status <> 'frei' ORDER BY created_at DESC LIMIT 1").get(userId);
}

/** Abschluss: Anfrage genehmigen bzw. Direktbeitritt freischalten. Liefert Text fuer die Person. */
async function abschliessen(telegram: any, userId: number, chatId: string, vorstellung: string | null): Promise<string> {
  const db = getDatabase();
  const a = offeneAnfrage(userId, chatId);
  if (a) {
    let fehler: string | null = null;
    try { await telegram.approveChatJoinRequest(chatId, userId); } catch (e: any) { fehler = String(e?.message || e); }
    if (fehler && !/USER_ALREADY_PARTICIPANT/i.test(fehler)) {
      db.prepare("UPDATE kodex_anfrage SET vorstellung = COALESCE(?, vorstellung), grund = ? WHERE user_id = ? AND chat_id = ?").run(vorstellung, 'approve: ' + fehler, userId, chatId);
      console.log(`[Kodex] approve ${userId} in ${chatId} fehlgeschlagen: ${fehler}`);
      if (/HIDE_REQUESTER_MISSING|REQUEST.*NOT|not found/i.test(fehler)) {
        db.prepare("UPDATE kodex_anfrage SET status='abgelehnt', entschieden_at=? WHERE user_id = ? AND chat_id = ?").run(Date.now(), userId, chatId);
        return 'Danke! Deine Beitrittsanfrage ist leider nicht mehr offen. Tippe einfach noch einmal auf den Einladungslink – dann geht es sofort.';
      }
      return 'Danke! Beim Freischalten hat etwas gehakt – ein Admin schaut gleich drauf.';
    }
    db.prepare("UPDATE kodex_anfrage SET status='genehmigt', entschieden_at=?, vorstellung=COALESCE(?, vorstellung), grund='Kodex bestätigt' WHERE user_id = ? AND chat_id = ?")
      .run(Date.now(), vorstellung, userId, chatId);
    if (vorstellung) {
      // Vorstellung merken, damit das Konto beim naechsten Mal nicht wieder als anonym gilt
      db.prepare(`INSERT INTO kodex_gate (user_id, chat_id, created_at, status, vorstellung, freigegeben_at) VALUES (?, ?, ?, 'frei', ?, ?)
        ON CONFLICT(user_id, chat_id) DO UPDATE SET vorstellung=excluded.vorstellung`).run(userId, chatId, Date.now(), vorstellung, Date.now());
    }
    console.log(`[Kodex][ANFRAGE-GENEHMIGT] user=${userId} chat=${chatId} (Kodex privat bestätigt)`);
    return `Danke! Du bist jetzt in „${await gruppenTitel(telegram, chatId)}“ freigeschaltet. Willkommen! 🎉`;
  }
  if (offenesGate(userId, chatId)) {
    const erg = await freischalten(telegram, userId, chatId, vorstellung);
    if (erg === 'frei') return `Danke! Du kannst jetzt in „${await gruppenTitel(telegram, chatId)}“ schreiben. Willkommen! 🎉`;
    await adminLog(telegram, `🛡️ Kodex privat bestätigt, Schreibrecht NICHT zurückgegeben (${esc(erg)}): <code>${userId}</code> in <code>${chatId}</code>`);
    return 'Danke! Ein Admin schaut kurz drauf und schaltet dich frei.';
  }
  return 'Alles gut – du bist bereits freigeschaltet.';
}

function istAnonymeVorgang(userId: number, chatId: string): boolean {
  const a = offeneAnfrage(userId, chatId);
  if (a) return !!a.anonym && !a.vorstellung;
  const g = offenesGate(userId, chatId);
  return !!g && !!g.anonym && !g.vorstellung;
}

/** Knopf "Ich stimme zu" im Privatchat: kjr:<m100…> */
export async function behandlePrivatKnopf(ctx: Context): Promise<boolean> {
  const cq: any = ctx.callbackQuery;
  if (!cq || typeof cq.data !== 'string' || !cq.data.startsWith('kjr:') || !ctx.from) return false;
  stelleTabellenSicher();
  const chatId = cq.data.slice(4).replace(/^m/, '-');
  const uid = ctx.from.id;
  merkeBestaetigung(uid, chatId, 'privat');
  const db = getDatabase();
  if (!offeneAnfrage(uid, chatId) && !offenesGate(uid, chatId)) {
    await ctx.answerCbQuery('Danke, bestätigt ✅').catch(() => {});
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch { /* egal */ }
    return true;
  }
  if (istAnonymeVorgang(uid, chatId)) {
    db.prepare("UPDATE kodex_anfrage SET status='warte_vorstellung' WHERE user_id = ? AND chat_id = ? AND status IN ('offen','dm_fehler')").run(uid, chatId);
    db.prepare("UPDATE kodex_gate SET status='warte_vorstellung' WHERE user_id = ? AND chat_id = ? AND status <> 'frei'").run(uid, chatId);
    await ctx.answerCbQuery('Danke! ✅').catch(() => {});
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch { /* egal */ }
    await ctx.reply('Danke für deine Bestätigung! ✅\n\nJetzt noch kurz: Wie heißt du (Vorname genügt) und was ist dein Bezug zu GeldHelden ' +
      '(z. B. Newsletter, Webinar, Club, Empfehlung von …)? Schreib es mir einfach in einer Nachricht.');
    return true;
  }
  const text = await abschliessen(ctx.telegram, uid, chatId, null);
  await ctx.answerCbQuery('Danke, bestätigt ✅').catch(() => {});
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch { /* egal */ }
  await ctx.reply(text);
  return true;
}

/** /start vs_… (alt) und /start kx_… (Direktbeitritt). true = erledigt. */
export async function behandleStartParameter(ctx: Context): Promise<boolean> {
  const text: string = (ctx.message as any)?.text || '';
  const m = text.match(/^\/start(?:@\w+)?\s+(?:vs|kx)_(m?\d+)/);
  if (!m || ctx.chat?.type !== 'private' || !ctx.from) return false;
  stelleTabellenSicher();
  const chatId = m[1].replace(/^m/, '-');
  const uid = ctx.from.id;
  if (!offeneAnfrage(uid, chatId) && !offenesGate(uid, chatId)) {
    await ctx.reply('Alles gut – du bist bereits freigeschaltet. Viel Freude in der Gruppe!');
    return true;
  }
  const bestaetigt = hatKodexBestaetigt(uid);
  const anonym = istAnonymeVorgang(uid, chatId);
  if (bestaetigt && !anonym) {
    await ctx.reply(await abschliessen(ctx.telegram, uid, chatId, null));
    return true;
  }
  if (bestaetigt && anonym) {
    getDatabase().prepare("UPDATE kodex_gate SET status='warte_vorstellung' WHERE user_id = ? AND chat_id = ? AND status <> 'frei'").run(uid, chatId);
    getDatabase().prepare("UPDATE kodex_anfrage SET status='warte_vorstellung' WHERE user_id = ? AND chat_id = ? AND status IN ('offen','dm_fehler')").run(uid, chatId);
  }
  await sendeKodexPrivat(ctx.telegram, ctx.chat.id, chatId, await gruppenTitel(ctx.telegram, chatId), bestaetigt, anonym);
  return true;
}

/** Freitext im Privatchat, waehrend eine Vorstellung erwartet wird. true = erledigt. */
export async function behandlePrivatVorstellung(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type !== 'private' || !ctx.from) return false;
  stelleTabellenSicher();
  const db = getDatabase();
  const uid = ctx.from.id;
  const a = db.prepare("SELECT chat_id FROM kodex_anfrage WHERE user_id = ? AND status = 'warte_vorstellung' ORDER BY created_at DESC LIMIT 1").get(uid) as any;
  const g = a ? null : db.prepare("SELECT chat_id FROM kodex_gate WHERE user_id = ? AND status = 'warte_vorstellung' AND created_at > ? ORDER BY created_at DESC LIMIT 1").get(uid, Date.now() - 7 * 86400000) as any;
  const chatId: string | null = a?.chat_id ?? g?.chat_id ?? null;
  if (!chatId) return false;
  const msg: any = ctx.message;
  const text: string = msg?.text || '';
  if (!text || text.startsWith('/') || msg.forward_origin || msg.forward_from || msg.forward_sender_name) return false;
  if (buchstaben(text) < 6) {
    await ctx.reply('Magst du noch etwas mehr schreiben? Vorname und dein Bezug zu GeldHelden reichen völlig.');
    return true;
  }
  const vorstellung = text.slice(0, 500);
  await ctx.reply(await abschliessen(ctx.telegram, uid, chatId, vorstellung));
  await adminLog(ctx.telegram, `👋 Vorstellung (anonymes Konto) für <b>${esc(await gruppenTitel(ctx.telegram, chatId))}</b>: ${erwaehnung(ctx.from)} <code>${uid}</code>\n<i>${esc(vorstellung)}</i>`);
  return true;
}

/** Alle 30 Min.: Anfragen ohne Antwort nach 48 Std. ablehnen; Hinweis-Nachrichten > 2 Min. entfernen. */
export async function lehneAbgelaufeneAb(telegram: any): Promise<{ abgelehnt: number; hinweise: number }> {
  stelleTabellenSicher();
  const db = getDatabase();
  const alt = db.prepare("SELECT * FROM kodex_anfrage WHERE status IN ('offen','warte_vorstellung','dm_fehler') AND created_at < ?")
    .all(Date.now() - ANFRAGE_FRIST_STD * 3600000) as any[];
  for (const a of alt) {
    try { await telegram.declineChatJoinRequest(a.chat_id, a.user_id); } catch { /* evtl. schon erledigt */ }
    db.prepare("UPDATE kodex_anfrage SET status='abgelehnt', entschieden_at=?, grund='48 Std. ohne Bestätigung' WHERE user_id = ? AND chat_id = ?").run(Date.now(), a.user_id, a.chat_id);
    if (a.status !== 'dm_fehler') {
      try {
        await telegram.sendMessage(a.user_id, 'Deine Beitrittsanfrage ist abgelaufen, weil keine Bestätigung kam. ' +
          'Kein Problem: Tippe einfach noch einmal auf den Einladungslink, dann geht es von vorn los.');
      } catch { /* egal */ }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const hinweise = db.prepare("SELECT * FROM kodex_gate WHERE gate_msg_id IS NOT NULL AND created_at < ?").all(Date.now() - 2 * 60000) as any[];
  for (const g of hinweise) {
    try { await telegram.deleteMessage(g.chat_id, g.gate_msg_id); } catch { /* egal */ }
    db.prepare('UPDATE kodex_gate SET gate_msg_id = NULL WHERE user_id = ? AND chat_id = ?').run(g.user_id, g.chat_id);
  }
  return { abgelehnt: alt.length, hinweise: hinweise.length };
}

// ---------------------------------------------------------------------------------------------
// 4. Aufruf an bestehende Mitglieder (angepinnt) + Erinnerung nach 14 Tagen
// ---------------------------------------------------------------------------------------------
function aufrufText(fristAt: number, bu: string): string {
  return [
    '📌 <b>Neu in allen GeldHelden-Meetup-Gruppen: unser Verhaltenskodex</b>',
    '',
    'Leider gab es Fälle, in denen in Gruppen oder per Privatnachricht Investments verkauft wurden. ' +
    'Damit unsere Meetup-Gruppen ein sicherer Ort zum Austausch bleiben, bitten wir alle Mitglieder um eine kurze Bestätigung:',
    '',
    `<i>„${esc(KODEX_TEXT)}“</i>`,
    '',
    `Bitte tippe bis zum <b>${datum(fristAt)}</b> auf den Knopf. Einmal bestätigen reicht für alle Meetup-Gruppen. ` +
    'Niemand wird stummgeschaltet – du schreibst ganz normal weiter.',
    '',
    '🚩 Dir kommt etwas komisch vor? Antworte auf die Nachricht mit /melden – oder leite private Nachrichten ' +
    `einfach an @${bu} weiter.`,
  ].join('\n');
}

export async function starteAufruf(telegram: any, chatId: string): Promise<string> {
  stelleTabellenSicher();
  const db = getDatabase();
  const da = db.prepare('SELECT msg_id FROM kodex_aufruf WHERE chat_id = ? AND msg_id IS NOT NULL').get(chatId) as any;
  if (da) return 'schon_vorhanden';
  const bu = await botUsername(telegram);
  const frist = Date.now() + FRIST_TAGE * 86400000;
  try {
    const m = await telegram.sendMessage(chatId, aufrufText(frist, bu), {
      parse_mode: 'HTML', disable_web_page_preview: true,
      ...Markup.inlineKeyboard([[Markup.button.callback('✅ Ich bestätige den Kodex', 'kodex_ja:0')]]),
    });
    let pin = 'gepinnt';
    try { await telegram.pinChatMessage(chatId, m.message_id, { disable_notification: true }); } catch (e: any) { pin = 'gesendet, pin_fehler: ' + e?.message; }
    db.prepare(`INSERT INTO kodex_aufruf (chat_id, msg_id, gestartet_at, frist_at, fehler) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET msg_id=excluded.msg_id, gestartet_at=excluded.gestartet_at, frist_at=excluded.frist_at, fehler=excluded.fehler`)
      .run(chatId, m.message_id, Date.now(), frist, pin === 'gepinnt' ? null : pin);
    return pin;
  } catch (e: any) {
    db.prepare(`INSERT INTO kodex_aufruf (chat_id, msg_id, gestartet_at, frist_at, fehler) VALUES (?, NULL, ?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET fehler=excluded.fehler`).run(chatId, Date.now(), frist, String(e?.message));
    return 'fehler: ' + e?.message;
  }
}

/** Taeglich: Aufrufe mit abgelaufener Frist einmal erinnern. */
export async function erinnereFaelligeAufrufe(telegram: any): Promise<number> {
  stelleTabellenSicher();
  const db = getDatabase();
  const faellig = db.prepare(
    'SELECT * FROM kodex_aufruf WHERE msg_id IS NOT NULL AND erinnert_at IS NULL AND frist_at <= ?'
  ).all(Date.now()) as any[];
  const anzahl = (db.prepare('SELECT COUNT(*) n FROM kodex_bestaetigung').get() as any).n;
  let n = 0;
  for (const a of faellig) {
    if (!istKodexGruppe(a.chat_id)) continue;
    try {
      const m = await telegram.sendMessage(a.chat_id,
        '⏰ <b>Kurze Erinnerung:</b> Bitte bestätige unseren Verhaltenskodex – ein Tipp auf den Knopf genügt ' +
        `(einmal für alle Meetup-Gruppen). Schon ${anzahl} Mitglieder haben bestätigt. Danke dir!`,
        { parse_mode: 'HTML', reply_parameters: { message_id: a.msg_id, allow_sending_without_reply: true },
          ...Markup.inlineKeyboard([[Markup.button.callback('✅ Ich bestätige den Kodex', 'kodex_ja:0')]]) } as any);
      db.prepare('UPDATE kodex_aufruf SET erinnert_at = ?, erinnerung_msg_id = ? WHERE chat_id = ?').run(Date.now(), m.message_id, a.chat_id);
      n++;
    } catch (e: any) {
      db.prepare('UPDATE kodex_aufruf SET fehler = ? WHERE chat_id = ?').run('erinnerung: ' + e?.message, a.chat_id);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return n;
}

/** Gate-Nachrichten, die nach 3 Tagen noch offen sind, aufraeumen (die Person kann ueber den Pin bestaetigen). */
export async function raeumeAlteGatesAuf(telegram: any): Promise<number> {
  stelleTabellenSicher();
  const db = getDatabase();
  const alt = db.prepare("SELECT * FROM kodex_gate WHERE status <> 'frei' AND gate_msg_id IS NOT NULL AND created_at < ?")
    .all(Date.now() - 3 * 86400000) as any[];
  for (const g of alt) {
    try { await telegram.deleteMessage(g.chat_id, g.gate_msg_id); } catch { /* egal */ }
    db.prepare('UPDATE kodex_gate SET gate_msg_id = NULL WHERE user_id = ? AND chat_id = ?').run(g.user_id, g.chat_id);
  }
  return alt.length;
}

// ---------------------------------------------------------------------------------------------
// 5. Verwarnsystem
// ---------------------------------------------------------------------------------------------
function stufeAus(userId: number, test: boolean): number {
  stelleTabellenSicher();
  const r = getDatabase().prepare(
    'SELECT MAX(stufe) s FROM verwarnungen WHERE user_id = ? AND aufgehoben_at IS NULL AND test = ?'
  ).get(userId, test ? 1 : 0) as any;
  return r?.s || 0;
}
export function aktuelleStufe(userId: number): number { return stufeAus(userId, false); }
export function naechsteStufe(aktuell: number, art: 'verwarnung' | 'werbung'): number {
  const n = art === 'werbung' ? Math.max(aktuell + 1, 2) : aktuell + 1;
  return Math.min(n, 3);
}

interface Beleg {
  art: 'nachricht' | 'meldung';
  text: string | null;
  chatId: string | null;
  msgId: number | null;
  kopieMsgId: number | null;
  meldungId: number | null;
}
interface Ziel { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }

async function verhaengen(
  telegram: any, ziel: Ziel, art: 'verwarnung' | 'werbung', grund: string, beleg: Beleg,
  von: { id: number; first_name?: string; last_name?: string; username?: string }, ausloeserChat: string | null,
): Promise<{ stufe: number; ergebnis: string; text: string }> {
  stelleTabellenSicher();
  const test = istTestChat(ausloeserChat);
  const vorher = stufeAus(ziel.id, test);
  const stufe = naechsteStufe(vorher, art);
  const gruppen = wirkungsGruppen(ausloeserChat);
  let ergebnis = '';

  if (stufe === 2) {
    const bis = Math.floor(Date.now() / 1000) + STUMM_TAGE * 86400;
    let ok = 0, fehl = 0;
    for (const g of gruppen) {
      try {
        await telegram.restrictChatMember(g, ziel.id, { permissions: KEINE_RECHTE, until_date: bis, use_independent_chat_permissions: true });
        ok++;
      } catch { fehl++; }
      await new Promise((r) => setTimeout(r, 120));
    }
    ergebnis = `7 Tage stumm in ${ok} Gruppe(n)` + (fehl ? ` (${fehl} nicht möglich bzw. kein Mitglied)` : '');
  } else if (stufe === 3) {
    if (test) {
      try { await telegram.banChatMember(ausloeserChat, ziel.id); ergebnis = 'Ausschluss (nur Testgruppe)'; }
      catch (e: any) { ergebnis = 'Ausschluss in Testgruppe nicht möglich: ' + e?.message; }
    } else {
      const { banUserGlobally } = await import('./telegram');
      const r = await banUserGlobally(ziel.id, `Verwarnsystem Stufe 3 (${art}): ${grund}`.slice(0, 300), true);
      ergebnis = r.skipped ? `Ausschluss übersprungen (${r.skipReason})` : `Ausschluss in ${r.groups} Gruppen`;
    }
  } else {
    ergebnis = 'Verwarnung ausgesprochen';
  }

  const db = getDatabase();
  const info = db.prepare(`
    INSERT INTO verwarnungen (created_at, user_id, user_name, chat_id, art, stufe, grund, beleg_art, beleg_text,
      beleg_chat_id, beleg_msg_id, beleg_kopie_msg_id, meldung_id, von_id, von_name, massnahme_ergebnis, test)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Date.now(), ziel.id, nameVon(ziel), ausloeserChat, art, stufe, grund, beleg.art, beleg.text ? beleg.text.slice(0, 4000) : null,
    beleg.chatId, beleg.msgId, beleg.kopieMsgId, beleg.meldungId, von.id, nameVon(von), ergebnis, test ? 1 : 0);
  if (beleg.meldungId) db.prepare('UPDATE meldungen SET bearbeitet = 1 WHERE id = ?').run(beleg.meldungId);

  const stufenText: Record<number, string> = {
    1: '⚠️ <b>Verwarnung (Stufe 1 von 3)</b>',
    2: '🔇 <b>Stufe 2 von 3: 7 Tage stummgeschaltet</b> (in allen Meetup-Gruppen)',
    3: '⛔ <b>Stufe 3 von 3: Ausschluss</b>',
  };
  const folge: Record<number, string> = {
    1: 'Bitte halte dich an unseren Verhaltenskodex. Beim nächsten Verstoß folgt eine Stummschaltung für 7 Tage.',
    2: 'Beim nächsten Verstoß folgt der Ausschluss.',
    3: 'Der Ausschluss gilt für die GeldHelden-Gruppen.',
  };
  const text = `${stufenText[stufe]} für ${erwaehnung(ziel)}\nGrund: ${esc(grund)}${art === 'werbung' ? ' (Werbung/Investment-Angebot)' : ''}\n\n${folge[stufe]}`;

  await adminLog(telegram,
    `🛡️ <b>Verwarnsystem${test ? ' [TEST]' : ''}</b> #V${info.lastInsertRowid}\n` +
    `👤 ${erwaehnung(ziel)} <code>${ziel.id}</code>${ziel.username ? ' @' + esc(ziel.username) : ''}\n` +
    `📈 Stufe ${vorher} → <b>${stufe}</b> (${art})\n📝 ${esc(grund)}\n` +
    `📎 Beleg: ${beleg.art === 'meldung' ? 'Meldung M' + beleg.meldungId : 'Nachricht (oben weitergeleitet)'}\n` +
    `👮 von ${erwaehnung(von)}${ausloeserChat ? ' in <code>' + ausloeserChat + '</code>' : ' (Privatchat)'}\n` +
    `⚙️ ${esc(ergebnis)}\n↩️ Rücknahme: /aufheben V${info.lastInsertRowid}`);
  try {
    await telegram.sendMessage(ziel.id, text.replace(/<a href[^>]*>|<\/a>/g, '') +
      '\n\nUnser Kodex: „' + esc(KODEX_TEXT) + '“', { parse_mode: 'HTML' });
  } catch { /* hat den Bot nie gestartet */ }
  return { stufe, ergebnis, text };
}

/** Beleg sichern: Nachricht in den Admin-Log weiterleiten (Kopie, falls Weiterleiten gesperrt ist). */
async function sichereBeleg(telegram: any, chatId: string, msgId: number): Promise<number | null> {
  try {
    const f = await telegram.forwardMessage(config.adminLogChat, chatId, msgId);
    return f.message_id;
  } catch {
    try { const c = await telegram.copyMessage(config.adminLogChat, chatId, msgId); return c.message_id; } catch { return null; }
  }
}

function argumente(ctx: Context): string[] {
  const t: string = (ctx.message as any)?.text || '';
  return t.split(/\s+/).slice(1).filter(Boolean);
}
async function kurzAntwort(ctx: Context, text: string, sekunden = 25): Promise<void> {
  try {
    const m = await ctx.reply(text, { parse_mode: 'HTML', disable_web_page_preview: true } as any);
    if (ctx.chat && ctx.chat.type !== 'private') {
      const cid = ctx.chat.id;
      setTimeout(() => { ctx.telegram.deleteMessage(cid, m.message_id).catch(() => {}); }, sekunden * 1000);
    }
  } catch { /* egal */ }
}
async function loescheBefehl(ctx: Context): Promise<void> {
  if (ctx.chat?.type === 'private') return;
  try { await ctx.deleteMessage(); } catch { /* egal */ }
}

/** /melden — fuer alle Mitglieder, als Antwort auf eine Nachricht. */
export async function befehlMelden(ctx: Context): Promise<void> {
  stelleTabellenSicher();
  const msg: any = ctx.message;
  if (!ctx.from || !ctx.chat) return;
  if (ctx.chat.type === 'private') {
    await ctx.reply('So meldest du etwas:\n\n• In der Gruppe: auf die Nachricht antworten und /melden schreiben.\n' +
      '• Privatnachricht bekommen? Einfach hier an mich weiterleiten (lange tippen → Weiterleiten).\n' +
      '• Screenshot? Schick ihn mir hier, gern mit einem kurzen Satz dazu.');
    return;
  }
  const chatId = String(ctx.chat.id);
  if (!istKodexGruppe(chatId)) return;
  const ziel = msg?.reply_to_message;
  await loescheBefehl(ctx);
  if (!ziel || !ziel.from || ziel.from.is_bot) {
    await kurzAntwort(ctx, 'Bitte antworte mit /melden direkt <b>auf die Nachricht</b>, die du melden willst – sonst fehlt der Beleg.');
    return;
  }
  const grund = argumente(ctx).join(' ').slice(0, 300) || null;
  const kopie = await sichereBeleg(ctx.telegram, chatId, ziel.message_id);
  const zieltext: string = ziel.text || ziel.caption || '';
  const db = getDatabase();
  const info = db.prepare(`
    INSERT INTO meldungen (created_at, melder_id, melder_username, melder_name, gemeldet_id, gemeldet_username, gemeldet_name,
      herkunft, text, original_datum, notiz, quelle_chat_id, quelle_msg_id, beleg_kopie_msg_id, roh_art)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'gruppe', ?, ?, ?, ?, ?, ?, 'gruppe')
  `).run(Date.now(), ctx.from.id, ctx.from.username ?? null, nameVon(ctx.from), ziel.from.id, ziel.from.username ?? null,
    nameVon(ziel.from), zieltext.slice(0, 4000), ziel.date ? ziel.date * 1000 : null, grund, chatId, ziel.message_id, kopie);
  const mid = Number(info.lastInsertRowid);
  const titel = (ctx.chat as any).title || chatId;
  try {
    await ctx.telegram.sendMessage(config.adminLogChat,
      `🚩 <b>Meldung M${mid}</b> aus <b>${esc(titel)}</b>${istTestChat(chatId) ? ' [TEST]' : ''}\n` +
      `Betrifft: ${erwaehnung(ziel.from)} <code>${ziel.from.id}</code>\nGemeldet von: ${erwaehnung(ctx.from)}\n` +
      (grund ? `Grund: ${esc(grund)}\n` : '') +
      `Beleg: ${kopie ? 'oben weitergeleitet' : 'Weiterleitung fehlgeschlagen – Text: ' + esc(zieltext.slice(0, 500))}\n\n` +
      'Es passiert nichts automatisch. Entscheiden:',
      { parse_mode: 'HTML', ...Markup.inlineKeyboard([[
        Markup.button.callback('⚠️ Verwarnen', `kv:v:${mid}`),
        Markup.button.callback('📢 Werbung', `kv:w:${mid}`),
        Markup.button.callback('✖️ Verwerfen', `kv:x:${mid}`),
      ]]) });
  } catch (e: any) { console.error('[Kodex] Meldung an Admins:', e?.message); }
  await kurzAntwort(ctx, `Danke, ${esc(nameVon(ctx.from))} – deine Meldung (M${mid}) ist bei den Admins angekommen. 🙏`);
}

/** /verwarnen und /werbung — fuer Gruppenleiter und Admins. */
export async function befehlVerwarnen(ctx: Context, art: 'verwarnung' | 'werbung'): Promise<void> {
  stelleTabellenSicher();
  const msg: any = ctx.message;
  if (!ctx.from || !ctx.chat) return;
  const privat = ctx.chat.type === 'private';
  const chatId = privat ? null : String(ctx.chat.id);
  const args = argumente(ctx);
  const befehl = art === 'werbung' ? '/werbung' : '/verwarnen';

  if (!privat && !istKodexGruppe(chatId!)) return;
  const berechtigt = privat ? await istLeiterIrgendwo(ctx.telegram, ctx.from.id) : await istGruppenleiter(ctx.telegram, chatId!, ctx.from.id);
  if (!berechtigt) {
    await loescheBefehl(ctx);
    await kurzAntwort(ctx, `${befehl} können nur Gruppenleiter und Admins nutzen. Melden kannst du mit /melden (als Antwort auf die Nachricht).`);
    return;
  }

  let ziel: Ziel | null = null;
  let beleg: Beleg | null = null;
  let grundTeile = args;

  // Variante A: Antwort auf die Nachricht in der Gruppe
  if (!privat && msg?.reply_to_message?.from && !msg.reply_to_message.from.is_bot) {
    const r = msg.reply_to_message;
    const kopie = await sichereBeleg(ctx.telegram, chatId!, r.message_id);
    if (kopie || r.text || r.caption) {
      ziel = r.from;
      beleg = { art: 'nachricht', text: r.text || r.caption || null, chatId, msgId: r.message_id, kopieMsgId: kopie, meldungId: null };
      if (art === 'werbung') { try { await ctx.telegram.deleteMessage(chatId!, r.message_id); } catch { /* egal */ } }
    }
  }
  // Variante B: Meldungsnummer (M123), optional mit Konto-ID
  if (!ziel && args[0] && /^M\d+$/i.test(args[0])) {
    const mid = parseInt(args[0].slice(1), 10);
    const mel = getDatabase().prepare('SELECT * FROM meldungen WHERE id = ?').get(mid) as any;
    if (mel) {
      let zid: number | null = mel.gemeldet_id;
      grundTeile = args.slice(1);
      if (grundTeile[0] && /^\d{5,}$/.test(grundTeile[0])) { zid = parseInt(grundTeile[0], 10); grundTeile = grundTeile.slice(1); }
      if (!zid) {
        await loescheBefehl(ctx);
        await kurzAntwort(ctx, `Meldung M${mid} lässt sich keinem Konto zuordnen (Weiterleitungs-Schutz). Bitte so: <code>${befehl} M${mid} &lt;Konto-ID&gt; Grund</code>`, 60);
        return;
      }
      ziel = { id: zid, first_name: mel.gemeldet_name || undefined, username: mel.gemeldet_username || undefined };
      beleg = { art: 'meldung', text: mel.text, chatId: mel.quelle_chat_id, msgId: mel.quelle_msg_id, kopieMsgId: mel.beleg_kopie_msg_id, meldungId: mid };
    }
  }

  await loescheBefehl(ctx);
  if (!ziel || !beleg) {
    await kurzAntwort(ctx,
      `<b>Kein Schritt ohne Beleg.</b> So geht ${befehl}:\n` +
      `• in der Gruppe als <b>Antwort auf die Nachricht</b>: <code>${befehl} Grund</code>\n` +
      `• mit Meldungsnummer (weitergeleitete Privatnachricht oder Screenshot): <code>${befehl} M123 Grund</code>`, 60);
    return;
  }
  if (await geschuetzt(ctx.telegram, chatId, ziel.id, !!ziel.is_bot)) {
    await kurzAntwort(ctx, 'Admins, Gruppenleiter, Team-Mitglieder und Bots werden über das Verwarnsystem nicht verwarnt.');
    return;
  }
  const grund = grundTeile.join(' ').slice(0, 300) || (art === 'werbung' ? 'Werbung bzw. Investment-Angebot' : 'Verstoß gegen den Verhaltenskodex');
  const r = await verhaengen(ctx.telegram, ziel, art, grund, beleg, ctx.from, chatId);
  if (chatId) {
    try { await ctx.telegram.sendMessage(chatId, r.text, { parse_mode: 'HTML' }); } catch { /* egal */ }
  } else {
    await ctx.reply(`Erledigt: Stufe ${r.stufe} für ${nameVon(ziel)} (${r.ergebnis}).`);
  }
}

/** Knoepfe unter einer Meldung im Admin-Log: kv:v|w|x:<meldungId> */
export async function behandleMeldungsKnopf(ctx: Context): Promise<boolean> {
  const cq: any = ctx.callbackQuery;
  if (!cq || typeof cq.data !== 'string' || !cq.data.startsWith('kv:')) return false;
  stelleTabellenSicher();
  if (!ctx.from || !isAdmin(ctx.from.id)) { await ctx.answerCbQuery('Nur für Admins').catch(() => {}); return true; }
  const [, aktion, idStr] = cq.data.split(':');
  const mid = parseInt(idStr, 10);
  const db = getDatabase();
  const mel = db.prepare('SELECT * FROM meldungen WHERE id = ?').get(mid) as any;
  if (!mel) { await ctx.answerCbQuery('Meldung nicht gefunden').catch(() => {}); return true; }
  if (mel.bearbeitet) {
    await ctx.answerCbQuery('Schon bearbeitet').catch(() => {});
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch { /* egal */ }
    return true;
  }
  if (aktion === 'x') {
    db.prepare("UPDATE meldungen SET bearbeitet = 1, notiz = COALESCE(notiz,'') || ' [verworfen]' WHERE id = ?").run(mid);
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch { /* egal */ }
    await ctx.answerCbQuery('Verworfen').catch(() => {});
    return true;
  }
  if (!mel.gemeldet_id) {
    await ctx.answerCbQuery(`Kein Konto zuordenbar – bitte /werbung M${mid} <Konto-ID>`, { show_alert: true }).catch(() => {});
    return true;
  }
  const ausloeser = istTestChat(mel.quelle_chat_id) ? mel.quelle_chat_id : null;
  const ziel: Ziel = { id: mel.gemeldet_id, first_name: mel.gemeldet_name || undefined, username: mel.gemeldet_username || undefined };
  if (await geschuetzt(ctx.telegram, ausloeser ?? mel.quelle_chat_id ?? null, ziel.id)) {
    await ctx.answerCbQuery('Geschütztes Konto (Admin/Gruppenleiter/Team)', { show_alert: true }).catch(() => {});
    return true;
  }
  const art = aktion === 'w' ? 'werbung' : 'verwarnung';
  const beleg: Beleg = { art: 'meldung', text: mel.text, chatId: mel.quelle_chat_id, msgId: mel.quelle_msg_id, kopieMsgId: mel.beleg_kopie_msg_id, meldungId: mid };
  const r = await verhaengen(ctx.telegram, ziel, art, art === 'werbung' ? 'Werbung bzw. Investment-Angebot' : 'Verstoß gegen den Verhaltenskodex', beleg, ctx.from, ausloeser);
  if (mel.quelle_chat_id) {
    try { await ctx.telegram.sendMessage(mel.quelle_chat_id, r.text, { parse_mode: 'HTML' }); } catch { /* egal */ }
    if (art === 'werbung' && mel.quelle_msg_id) { try { await ctx.telegram.deleteMessage(mel.quelle_chat_id, mel.quelle_msg_id); } catch { /* egal */ } }
  }
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch { /* egal */ }
  await ctx.answerCbQuery(`Stufe ${r.stufe}: ${r.ergebnis}`.slice(0, 190), { show_alert: true }).catch(() => {});
  return true;
}

/** /aufheben V12 — nur Bot-Admins. Hebt eine Verwarnung auf (Stummschaltung wird beendet). */
export async function befehlAufheben(ctx: Context): Promise<void> {
  stelleTabellenSicher();
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  const a = argumente(ctx)[0] || '';
  const id = parseInt(a.replace(/^V/i, ''), 10);
  const db = getDatabase();
  const v = db.prepare('SELECT * FROM verwarnungen WHERE id = ?').get(id) as any;
  if (!v) { await ctx.reply('Nicht gefunden. Format: /aufheben V12'); return; }
  db.prepare('UPDATE verwarnungen SET aufgehoben_at = ?, aufgehoben_von = ? WHERE id = ?').run(Date.now(), ctx.from.id, id);
  let hinweis = '';
  if (v.stufe === 2) {
    let ok = 0;
    for (const g of wirkungsGruppen(v.test ? v.chat_id : null)) {
      try { await ctx.telegram.restrictChatMember(g, v.user_id, { permissions: ALLE_RECHTE, use_independent_chat_permissions: true } as any); ok++; } catch { /* kein Mitglied */ }
    }
    hinweis = ` Stummschaltung in ${ok} Gruppe(n) beendet.`;
  }
  if (v.stufe === 3) hinweis = ` Den Ausschluss bitte zusätzlich mit /unban ${v.user_id} aufheben.`;
  await ctx.reply(`V${id} aufgehoben. Neue Stufe: ${stufeAus(v.user_id, !!v.test)}.${hinweis}`);
}

/** /verwarnstatus <id> oder als Antwort — Gruppenleiter/Admins. */
export async function befehlStatus(ctx: Context): Promise<void> {
  stelleTabellenSicher();
  if (!ctx.from || !ctx.chat) return;
  const privat = ctx.chat.type === 'private';
  const ok = privat ? await istLeiterIrgendwo(ctx.telegram, ctx.from.id) : await istGruppenleiter(ctx.telegram, String(ctx.chat.id), ctx.from.id);
  if (!ok) return;
  const r = (ctx.message as any)?.reply_to_message;
  const uid = r?.from?.id || parseInt(argumente(ctx)[0] || '', 10);
  await loescheBefehl(ctx);
  if (!uid) { await kurzAntwort(ctx, 'Format: als Antwort /verwarnstatus oder /verwarnstatus &lt;Konto-ID&gt;'); return; }
  const test = !privat && istTestChat(String(ctx.chat.id));
  const liste = getDatabase().prepare('SELECT * FROM verwarnungen WHERE user_id = ? AND test = ? ORDER BY id').all(uid, test ? 1 : 0) as any[];
  const zeilen = liste.map((v) => `V${v.id} ${datum(v.created_at)} Stufe ${v.stufe} (${v.art})${v.aufgehoben_at ? ' – aufgehoben' : ''}: ${esc(v.grund || '')}`);
  await kurzAntwort(ctx, `Konto <code>${uid}</code>: aktuelle Stufe <b>${stufeAus(uid, test)}</b> von 3, Kodex ${hatKodexBestaetigt(uid) ? 'bestätigt ✅' : 'noch nicht bestätigt'}\n` +
    (zeilen.length ? zeilen.join('\n') : 'Keine Verwarnungen.'), 90);
}

/** /kodex — zeigt den Kodex; Bot-Admins: /kodex aufruf [chat_id|alle] */
export async function befehlKodex(ctx: Context): Promise<void> {
  stelleTabellenSicher();
  if (!ctx.from || !ctx.chat) return;
  const args = argumente(ctx);
  if (args[0] === 'aufruf' && isAdmin(ctx.from.id)) {
    const ziel = args[1] || (ctx.chat.type !== 'private' ? String(ctx.chat.id) : '');
    if (!ziel) { await ctx.reply('Format: /kodex aufruf <chat_id|alle>'); return; }
    await loescheBefehl(ctx);
    const ids = ziel === 'alle' ? meetupGruppen().map((g) => g.chatId) : [ziel];
    const ergebnisse: string[] = [];
    for (const id of ids) {
      if (!istKodexGruppe(id)) { ergebnisse.push(`${id}: keine Kodex-Gruppe`); continue; }
      ergebnisse.push(`${id}: ${await starteAufruf(ctx.telegram, id)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
    await ctx.telegram.sendMessage(ctx.from.id, 'Kodex-Aufruf:\n' + ergebnisse.join('\n')).catch(() => {});
    return;
  }
  await loescheBefehl(ctx);
  await kurzAntwort(ctx, `📜 <b>Verhaltenskodex der GeldHelden-Meetup-Gruppen</b>\n\n<i>„${esc(KODEX_TEXT)}“</i>\n\n` +
    'Verstöße bitte mit /melden (als Antwort auf die Nachricht) melden oder private Nachrichten an mich weiterleiten.', 90);
}

// ---------------------------------------------------------------------------------------------
// Einbindung
// ---------------------------------------------------------------------------------------------
export function registriereMeetupKodex(bot: Telegraf): void {
  // Tabellen erst nach dem Start anlegen (DB ist dann sicher initialisiert); jeder Handler prueft ohnehin selbst.
  setTimeout(() => { try { stelleTabellenSicher(); } catch (e: any) { console.error('[Kodex] Tabellen:', e?.message); } }, 3000);
  const fang = (name: string) => (e: any) => console.error(`[Kodex] /${name}:`, e?.message);
  bot.command('melden', (ctx) => befehlMelden(ctx).catch(fang('melden')));
  bot.command('verwarnen', (ctx) => befehlVerwarnen(ctx, 'verwarnung').catch(fang('verwarnen')));
  bot.command('werbung', (ctx) => befehlVerwarnen(ctx, 'werbung').catch(fang('werbung')));
  bot.command('aufheben', (ctx) => befehlAufheben(ctx).catch(fang('aufheben')));
  bot.command('verwarnstatus', (ctx) => befehlStatus(ctx).catch(fang('verwarnstatus')));
  bot.command('kodex', (ctx) => befehlKodex(ctx).catch(fang('kodex')));
  console.log(`[Kodex] registriert. aktiv=${kodexAktiv()} testchat=${testChat() || '-'}`);
}
