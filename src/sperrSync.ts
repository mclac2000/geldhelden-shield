/**
 * sperrSync.ts — gemeinsame Sperrliste: GeldHelden-Shield -> MeinCEO-Community-Bot (Auftrag Marco 14.11.2026).
 *
 * Einweg und nur Sperrdaten: Telegram-ID, @Benutzername, Grund, Zeitpunkt. Keine Namen, Nachrichten,
 * Gruppen oder Kundendaten. MeinCEO bleibt ein getrenntes System und holt nichts zurueck.
 *
 * Alle 5 Minuten (und beim Start) wird gesendet, was sich seit dem letzten erfolgreichen Senden geaendert hat:
 *   Quelle = blacklist (Cross-Ban/Admin-Ban) UND users.status='banned' (Sperren ohne Blacklist-Zeile).
 *   Stand je Konto in `sperrsync_stand` (user_id, username, gesendet_at); neu oder anderer @Name = senden.
 * Idempotent: MeinCEO legt je Telegram-ID genau einen Eintrag an; mehrfaches Senden aendert nichts.
 * Entsperren wird seit 28.11.2026 gespiegelt (Feld `entsperren`): Wer im Stand steht, aber nicht mehr gesperrt ist.
 * MeinCEO nimmt dabei NUR Eintraege herunter, die vom GH-Shield stammen (eigene MeinCEO-Sperren bleiben).
 * Schutz gegen einen Lesefehler, der die Liste leeren wuerde: hoechstens MAX_ENTSPERREN je Lauf, und nur wenn
 * die aktuelle Sperrliste nicht auf weniger als die Haelfte des gesendeten Stands geschrumpft ist.
 * Der Stand wird erst geloescht, wenn MeinCEO die Entsperrungen bestaetigt (Antwortfeld `entsperrt`).
 *
 * Ohne MEINCEO_SPERRSYNC_URL und MEINCEO_SPERRSYNC_TOKEN tut der Job nichts. Fehler gehen als [Shield][ERROR]
 * ins Log (Melder), je Fehlerart hoechstens 1x/30 Min.
 */
import { createHash } from 'crypto';
import { getDatabase, isTeamMember } from './db';
import { isAdmin } from './admin';

export interface SperrEintrag {
  tg_user_id: number;
  username: string | null;
  grund: string | null;
  gesperrt_at: number | null; // Epoch-Millisekunden
}

const BATCH = 500;
let letzteFehlerMeldung = 0;

function stelleTabelleSicher(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS sperrsync_stand (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      gesendet_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sperrsync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      gesendet INTEGER NOT NULL,
      neu INTEGER NOT NULL,
      aktualisiert INTEGER NOT NULL,
      fehler TEXT
    );
  `);
}

function bereinigeName(n: unknown): string | null {
  if (typeof n !== 'string') return null;
  const t = n.trim().replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{3,64}$/.test(t) ? t : null;
}

/** Alle gesperrten Konten; Admins und Team-Mitglieder nie. Reine Lesefunktion. */
export function sammleSperren(): SperrEintrag[] {
  const db = getDatabase();
  const spalten = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map((s) => s.name);
  const nameSql = spalten.includes('username') ? 'u.username' : 'NULL';
  const zeilen = db
    .prepare(
      `SELECT x.user_id AS user_id, ${nameSql} AS username, b.reason AS grund, b.banned_at AS zeit
       FROM (SELECT user_id FROM blacklist UNION SELECT user_id FROM users WHERE status = 'banned') x
       LEFT JOIN blacklist b ON b.user_id = x.user_id
       LEFT JOIN users u ON u.user_id = x.user_id`
    )
    .all() as Array<{ user_id: number; username: string | null; grund: string | null; zeit: number | null }>;

  const aus: SperrEintrag[] = [];
  for (const z of zeilen) {
    if (!Number.isFinite(z.user_id) || z.user_id <= 0) continue;
    if (isAdmin(z.user_id) || isTeamMember(z.user_id)) continue;
    aus.push({
      tg_user_id: z.user_id,
      username: bereinigeName(z.username),
      grund: z.grund ? String(z.grund).slice(0, 200) : null,
      gesperrt_at: z.zeit ?? null,
    });
  }
  return aus;
}

/** Was ist seit dem letzten Senden neu oder hat einen neuen @Namen? */
export function offeneEintraege(alle: SperrEintrag[]): { neu: SperrEintrag[]; geaendert: SperrEintrag[] } {
  const db = getDatabase();
  const stand = new Map<number, string | null>();
  for (const r of db.prepare('SELECT user_id, username FROM sperrsync_stand').all() as Array<{ user_id: number; username: string | null }>) {
    stand.set(r.user_id, r.username);
  }
  const neu: SperrEintrag[] = [];
  const geaendert: SperrEintrag[] = [];
  for (const e of alle) {
    if (!stand.has(e.tg_user_id)) neu.push(e);
    else if (e.username && stand.get(e.tg_user_id) !== e.username) geaendert.push(e);
  }
  return { neu, geaendert };
}

const MAX_ENTSPERREN = 50;

/** Konten, die an MeinCEO gesendet wurden, aber nicht mehr gesperrt sind. Leer bei unplausibler Lage. */
export function offeneEntsperrungen(alle: SperrEintrag[]): { ids: number[]; grund: string | null } {
  const db = getDatabase();
  const stand = (db.prepare('SELECT user_id FROM sperrsync_stand').all() as Array<{ user_id: number }>).map((r) => r.user_id);
  if (stand.length === 0) return { ids: [], grund: null };
  if (alle.length < stand.length / 2) {
    return { ids: [], grund: `Sperrliste unplausibel klein (${alle.length} gegen ${stand.length} gesendete) - keine Entsperrungen` };
  }
  const aktuell = new Set(alle.map((e) => e.tg_user_id));
  const weg = stand.filter((id) => !aktuell.has(id) && !isAdmin(id) && !isTeamMember(id));
  if (weg.length > MAX_ENTSPERREN) {
    return { ids: [], grund: `${weg.length} Entsperrungen auf einmal (Grenze ${MAX_ENTSPERREN}) - bitte pruefen, nichts gesendet` };
  }
  return { ids: weg, grund: null };
}

export function unterschrift(secret: string, zeit: number, body: string): string {
  return createHash('sha256').update(`${secret}.${zeit}.${body}`).digest('hex');
}

function fehlerLog(text: string): void {
  const jetzt = Date.now();
  if (jetzt - letzteFehlerMeldung > 30 * 60 * 1000) {
    letzteFehlerMeldung = jetzt;
    console.error(`[Shield][ERROR] Sperrlisten-Sync zu MeinCEO: ${text}`);
  } else {
    console.warn(`[SperrSync] ${text}`);
  }
}

export async function runSperrSync(): Promise<{ gesendet: number; neu: number; aktualisiert: number } | null> {
  const url = process.env.MEINCEO_SPERRSYNC_URL;
  const token = process.env.MEINCEO_SPERRSYNC_TOKEN;
  if (!url || !token) return null;

  try {
    stelleTabelleSicher();
    const db = getDatabase();
    const alle = sammleSperren();
    const { neu, geaendert } = offeneEintraege(alle);
    const zuSenden = [...neu, ...geaendert];
    const ent = offeneEntsperrungen(alle);
    if (ent.grund) fehlerLog(ent.grund);
    let entsperren = ent.ids;
    if (zuSenden.length === 0 && entsperren.length === 0) return { gesendet: 0, neu: 0, aktualisiert: 0 };

    let neuMc = 0;
    let aktMc = 0;
    let gesendet = 0;
    let entsperrt = 0;
    for (let i = 0; i < Math.max(zuSenden.length, 1); i += BATCH) {
      const teil = zuSenden.slice(i, i + BATCH);
      const mitEntsperren = i === 0 && entsperren.length > 0 ? entsperren : null;
      const body = JSON.stringify(mitEntsperren ? { quelle: 'gh-shield', eintraege: teil, entsperren: mitEntsperren } : { quelle: 'gh-shield', eintraege: teil });
      const zeit = Math.floor(Date.now() / 1000);
      const antwort = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Sync-Zeit': String(zeit),
          'X-Sync-Signatur': unterschrift(token, zeit, body),
        },
        body,
        signal: AbortSignal.timeout(30000),
      });
      if (!antwort.ok) {
        throw new Error(`HTTP ${antwort.status} von MeinCEO`);
      }
      const j = (await antwort.json()) as { neu?: number; aktualisiert?: number; verarbeitet?: number; entsperrt?: number; entsperren_uebersprungen?: number };
      if (typeof j.verarbeitet !== 'number' || j.verarbeitet !== teil.length) {
        throw new Error(`MeinCEO bestaetigt ${j.verarbeitet} von ${teil.length} Eintraegen`);
      }
      neuMc += j.neu ?? 0;
      aktMc += j.aktualisiert ?? 0;
      gesendet += teil.length;
      const merke = db.prepare('INSERT INTO sperrsync_stand (user_id, username, gesendet_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, gesendet_at = excluded.gesendet_at');
      const jetzt = Date.now();
      db.transaction(() => { for (const e of teil) merke.run(e.tg_user_id, e.username, jetzt); })();
      if (mitEntsperren) {
        if (typeof j.entsperrt === 'number') {
          // MeinCEO hat die Entsperrungen angenommen (auch "uebersprungen" = dort nicht mehr gelistet) -> Stand weg.
          const loesche = db.prepare('DELETE FROM sperrsync_stand WHERE user_id = ?');
          db.transaction(() => { for (const id of mitEntsperren) loesche.run(id); })();
          entsperrt += j.entsperrt;
          console.log(`[SperrSync] ${mitEntsperren.length} Entsperrung(en) an MeinCEO (dort entfernt: ${j.entsperrt}, nicht gelistet: ${j.entsperren_uebersprungen ?? 0})`);
        } else {
          fehlerLog('MeinCEO kennt das Feld "entsperren" noch nicht - Entsperrungen bleiben offen');
        }
      }
    }
    db.prepare('INSERT INTO sperrsync_log (created_at, gesendet, neu, aktualisiert, fehler) VALUES (?, ?, ?, ?, NULL)').run(Date.now(), gesendet, neuMc, aktMc);
    if (gesendet > 0) console.log(`[SperrSync] ${gesendet} Sperren an MeinCEO gesendet (neu ${neuMc}, aktualisiert ${aktMc})`);
    void entsperrt;
    return { gesendet, neu: neuMc, aktualisiert: aktMc };
  } catch (error: unknown) {
    const text = error instanceof Error ? error.message : String(error);
    try {
      stelleTabelleSicher();
      getDatabase().prepare('INSERT INTO sperrsync_log (created_at, gesendet, neu, aktualisiert, fehler) VALUES (?, 0, 0, 0, ?)').run(Date.now(), text.slice(0, 300));
    } catch { /* Protokoll darf nie stoeren */ }
    fehlerLog(text);
    return null;
  }
}
