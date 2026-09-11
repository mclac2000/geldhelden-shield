/**
 * identitaet.ts — Anzeigename, Benutzername und Premium-Status mitschreiben.
 *
 * WARUM (11.09.2026)
 * ------------------
 * Marco hat zwei Betrugsprofile als Bildschirmfoto gemeldet. Beide liessen sich
 * in unseren Daten NICHT wiederfinden — nicht weil sie fehlten, sondern weil das
 * System keine Namen speichert: `users.username`, `first_name` und `last_name`
 * waren bei allen 7.590 Konten leer, `user_name_history` hatte 37 Zeilen.
 * Eine Meldung aus der Community war damit keinem Konto zuzuordnen.
 *
 * Beide Profile hatten ausserdem Telegram-Premium. Ob Premium Betrueger von
 * normalen Mitgliedern trennt, liess sich nicht pruefen, weil der Status
 * nirgends festgehalten wurde — `isPremium` existierte nur als fluechtige
 * Eingabe der Betrugsbewertung.
 *
 * Diese Datei schliesst beides. Rueckwirkend geht nichts; ab jetzt entsteht die
 * Datenbasis, die heute gefehlt hat.
 *
 * WAS SIE TUT
 * -----------
 * - Schreibt den aktuellen Stand in `users` (username, first_name, last_name,
 *   is_premium).
 * - Legt in `user_name_history` eine Zeile an, wenn sich etwas GEAENDERT hat.
 *   Das ist der Namenswechsel-Verlauf, der bei Identitaetsmissbrauch zaehlt.
 * - Fasst niemanden an und trifft keine Entscheidung. Reines Mitschreiben.
 */
import { getDatabase } from './db';

export interface Identitaet {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isPremium?: boolean | null;
}

let spaltenGeprueft = false;

/**
 * Ergaenzt fehlende Spalten. `is_premium` gab es vor dem 11.09.2026 nicht.
 * ALTER TABLE ist in SQLite billig und laeuft nur einmal pro Prozess.
 */
function stelleSpaltenSicher(): void {
  if (spaltenGeprueft) return;
  const db = getDatabase();
  try {
    const spalten = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    const hat = (n: string) => spalten.some((s) => s.name === n);
    if (!hat('is_premium')) {
      db.exec('ALTER TABLE users ADD COLUMN is_premium INTEGER');
      console.log('[Identitaet] Spalte users.is_premium ergaenzt');
    }
    if (!hat('identitaet_gesehen_at')) {
      db.exec('ALTER TABLE users ADD COLUMN identitaet_gesehen_at INTEGER');
      console.log('[Identitaet] Spalte users.identitaet_gesehen_at ergaenzt');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_unh_user ON user_name_history(user_id)');
    spaltenGeprueft = true;
  } catch (error: any) {
    console.warn('[Identitaet] Spaltenpruefung fehlgeschlagen:', error?.message);
  }
}

function sauber(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined) return null;
  const t = String(wert).trim();
  return t.length ? t.slice(0, 200) : null;
}

/**
 * Schreibt den aktuellen Identitaetsstand eines Kontos mit.
 * Still im Fehlerfall: das Mitschreiben darf nie eine Moderation verhindern.
 */
export function merkeIdentitaet(userId: number, ident: Identitaet): void {
  if (!Number.isFinite(userId) || userId <= 0) return;
  try {
    stelleSpaltenSicher();
    const db = getDatabase();

    const username = sauber(ident.username);
    const firstName = sauber(ident.firstName);
    const lastName = sauber(ident.lastName);
    const premium = ident.isPremium === undefined || ident.isPremium === null
      ? null : (ident.isPremium ? 1 : 0);

    const vorher = db.prepare(
      'SELECT username, first_name, last_name, is_premium FROM users WHERE user_id = ?'
    ).get(userId) as any;

    // Kein Datensatz: der Nutzer ist dem System noch unbekannt. Dann legt ihn
    // getOrCreateUser an anderer Stelle an - hier nichts erfinden.
    if (!vorher) return;

    const geaendert =
      (username !== null && username !== vorher.username) ||
      (firstName !== null && firstName !== vorher.first_name) ||
      (lastName !== null && lastName !== vorher.last_name);

    db.prepare(`
      UPDATE users SET
        username   = COALESCE(?, username),
        first_name = COALESCE(?, first_name),
        last_name  = COALESCE(?, last_name),
        is_premium = COALESCE(?, is_premium),
        has_username = CASE WHEN ? IS NOT NULL THEN 1 ELSE has_username END,
        identitaet_gesehen_at = ?
      WHERE user_id = ?
    `).run(username, firstName, lastName, premium, username, Date.now(), userId);

    if (geaendert) {
      db.prepare(`
        INSERT INTO user_name_history (user_id, username, first_name, last_name, seen_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, username, firstName, lastName, Date.now());
    }
  } catch (error: any) {
    // Bewusst nur eine Warnung: ein Fehler beim Mitschreiben darf den
    // Nachrichtenweg nicht anhalten.
    console.warn('[Identitaet] konnte nicht mitgeschrieben werden:', error?.message);
  }
}

/**
 * Bequemer Aufruf direkt aus einem Telegraf-Kontext.
 * `from` ist das Telegram-User-Objekt.
 */
export function merkeAusFrom(from: any): void {
  if (!from || from.is_bot) return;
  merkeIdentitaet(from.id, {
    username: from.username ?? null,
    firstName: from.first_name ?? null,
    lastName: from.last_name ?? null,
    isPremium: typeof from.is_premium === 'boolean' ? from.is_premium : null,
  });
}
