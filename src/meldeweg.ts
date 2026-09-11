/**
 * meldeweg.ts — Ein Mitglied meldet eine private Betrugsnachricht.
 *
 * ==========================================================================
 * WARUM DAS DER WICHTIGSTE TEIL DES SYSTEMS IST
 * ==========================================================================
 *
 * Messung vom 11.09.2026: Von 477 gesperrten Konten gehen 441 (92,5 %) auf eine
 * menschliche Entscheidung zurueck. Davon hatte der Bot vorher 38 erkannt.
 *
 *   => In 91,4 % der von Menschen gemeldeten Faelle war der Bot blind.
 *
 * Der Grund ist strukturell und durch keine Regel zu beheben: Der Bot sieht
 * Inhalte IN GRUPPEN. Die Taeter schreiben PRIVAT. Eine Privatnachricht zwischen
 * zwei Menschen bekommt ein Bot nie zu sehen — nicht aus einer Luecke heraus,
 * sondern weil Telegram das so gebaut hat und gut daran tut.
 *
 * Solange das so ist, ist jede Zutrittsregel Kosmetik. Der einzige Hebel ist,
 * dass ein Mitglied mit EINEM Handgriff sagen kann: "Der hier hat mich
 * angeschrieben."
 *
 * ==========================================================================
 * WAS DIESE DATEI BEWUSST NICHT TUT
 * ==========================================================================
 *
 * Sie sperrt niemanden. Kein Automatismus, keine Schwelle, kein Punktesystem.
 *
 * Erst Sichtbarkeit, dann Automatik. Umgekehrt sperrt der Bot Unschuldige, und
 * das kostet Mitglieder statt Betrueger. Eine Meldung ist eine Behauptung eines
 * Menschen ueber einen anderen Menschen — sie gehoert einem Admin vorgelegt,
 * nicht sofort vollstreckt. Wer spaeter Automatik will, hat dann Daten dafuer;
 * heute haetten wir nur eine Vermutung.
 *
 * ==========================================================================
 * DER WEG
 * ==========================================================================
 *
 * Das Mitglied leitet die Betrugsnachricht an den Bot weiter. Fertig.
 * Kein Formular, keine Felder, keine Rueckfragen. Was drei Schritte braucht,
 * benutzt niemand — und dann messen wir wieder nur unsere eigene Blindheit.
 *
 * GRENZFALL, der oft eintritt: Wer die Weiterleitungs-Privatsphaere aktiviert
 * hat (bei Telegram Premium ueblich, und Betrueger nutzen das), erscheint beim
 * Weiterleiten NUR mit Anzeigenamen — Telegram liefert dann keine Kennung.
 * Solche Meldungen sind trotzdem wertvoll, aber sie sind keinem Konto
 * zuzuordnen. Das steht so in der Meldung an die Admins, damit niemand denkt,
 * der Bot koenne da etwas tun.
 */
import { Context } from 'telegraf';
import { getDatabase } from './db';
import { config } from './config';

let tabelleBereit = false;

function stelleTabelleSicher(): void {
  if (tabelleBereit) return;
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS meldungen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      melder_id INTEGER NOT NULL,
      melder_username TEXT,
      melder_name TEXT,
      gemeldet_id INTEGER,
      gemeldet_username TEXT,
      gemeldet_name TEXT,
      -- 'kennung' = Konto eindeutig bestimmbar
      -- 'nur_name' = Weiterleitungs-Privatsphaere aktiv, keine Kennung
      -- 'kanal' = aus einem Kanal weitergeleitet
      -- 'unbekannt' = keine Herkunft erkennbar
      herkunft TEXT NOT NULL,
      text TEXT,
      original_datum INTEGER,
      bearbeitet INTEGER NOT NULL DEFAULT 0,
      notiz TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_meldungen_created ON meldungen(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meldungen_gemeldet ON meldungen(gemeldet_id);
    CREATE INDEX IF NOT EXISTS idx_meldungen_melder ON meldungen(melder_id);
  `);
  tabelleBereit = true;
}

interface Herkunft {
  art: 'kennung' | 'nur_name' | 'kanal' | 'unbekannt';
  id: number | null;
  username: string | null;
  name: string | null;
  datum: number | null;
}

/**
 * Wer hat die weitergeleitete Nachricht urspruenglich geschrieben?
 * Beruecksichtigt die neue Form (forward_origin) und die alten Felder.
 */
export function leseHerkunft(msg: any): Herkunft {
  const leer: Herkunft = { art: 'unbekannt', id: null, username: null, name: null, datum: null };
  if (!msg) return leer;

  const o = msg.forward_origin;
  if (o) {
    if (o.type === 'user' && o.sender_user) {
      const u = o.sender_user;
      return {
        art: 'kennung',
        id: u.id,
        username: u.username ?? null,
        name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || null,
        datum: o.date ? o.date * 1000 : null,
      };
    }
    if (o.type === 'hidden_user') {
      return {
        art: 'nur_name', id: null, username: null,
        name: o.sender_user_name ?? null,
        datum: o.date ? o.date * 1000 : null,
      };
    }
    if (o.type === 'channel' || o.type === 'chat') {
      const c = o.chat ?? o.sender_chat;
      return {
        art: 'kanal', id: c?.id ?? null,
        username: c?.username ?? null,
        name: c?.title ?? null,
        datum: o.date ? o.date * 1000 : null,
      };
    }
  }

  // Aeltere Telegram-Fassungen
  if (msg.forward_from) {
    const u = msg.forward_from;
    return {
      art: 'kennung', id: u.id, username: u.username ?? null,
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || null,
      datum: msg.forward_date ? msg.forward_date * 1000 : null,
    };
  }
  if (msg.forward_sender_name) {
    return {
      art: 'nur_name', id: null, username: null, name: msg.forward_sender_name,
      datum: msg.forward_date ? msg.forward_date * 1000 : null,
    };
  }
  if (msg.forward_from_chat) {
    const c = msg.forward_from_chat;
    return {
      art: 'kanal', id: c.id, username: c.username ?? null, name: c.title ?? null,
      datum: msg.forward_date ? msg.forward_date * 1000 : null,
    };
  }
  return leer;
}

function istWeitergeleitet(msg: any): boolean {
  return !!(msg?.forward_origin || msg?.forward_from || msg?.forward_from_chat
    || msg?.forward_sender_name || msg?.forward_date);
}

// Bewusst in den Wörtern, die auf dem Bildschirm stehen: In Telegram heißt der
// Knopf „Weiterleiten". Wer eine andere Vokabel liest, sucht.
const HILFE =
  'Wenn dich jemand aus unseren Gruppen privat anschreibt und dir etwas andreht:\n\n' +
  '➡️ Lange auf die Nachricht tippen → „Weiterleiten" → mich auswählen.\n\n' +
  'Mehr nicht. Ich lege sie unseren Admins vor. Du musst nichts erklären und ' +
  'nichts ausfüllen — und es wird nichts automatisch gesperrt, ein Mensch schaut darauf.';

/**
 * Nimmt eine Meldung entgegen. Gibt true zurueck, wenn die Nachricht als
 * Meldung behandelt wurde (dann ist im Privatchat nichts weiter zu tun).
 */
export async function behandleMeldung(ctx: Context): Promise<boolean> {
  const msg: any = ctx.message;
  if (!msg || !ctx.from || ctx.from.is_bot) return false;
  if (ctx.chat?.type !== 'private') return false;

  // Befehle laufen weiter an ihre eigenen Handler.
  const text: string = msg.text || msg.caption || '';
  if (text.startsWith('/') && !istWeitergeleitet(msg)) return false;

  if (!istWeitergeleitet(msg)) {
    // Jemand schreibt dem Bot einfach so. Kurz erklaeren, wie es geht.
    try { await ctx.reply(HILFE); } catch { /* egal */ }
    return true;
  }

  stelleTabelleSicher();
  const h = leseHerkunft(msg);
  const melderName = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || null;

  // Leichte Doppelung abfangen: dieselbe Meldung derselben Person innerhalb
  // von zehn Minuten nur einmal. Kein Rate-Limit, nur gegen Doppelklicks.
  const db = getDatabase();
  const schon = db.prepare(`
    SELECT id FROM meldungen
    WHERE melder_id = ? AND COALESCE(text,'') = ? AND created_at > ?
    LIMIT 1
  `).get(ctx.from.id, text.slice(0, 4000), Date.now() - 10 * 60 * 1000) as any;

  if (!schon) {
    db.prepare(`
      INSERT INTO meldungen
        (created_at, melder_id, melder_username, melder_name,
         gemeldet_id, gemeldet_username, gemeldet_name, herkunft, text, original_datum)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(), ctx.from.id, ctx.from.username ?? null, melderName,
      h.id, h.username, h.name, h.art, text.slice(0, 4000), h.datum
    );
  }

  // Dem Mitglied sofort antworten. Wer keine Rueckmeldung bekommt, meldet nie wieder.
  try {
    await ctx.reply(
      'Danke — angekommen. Ich habe die Nachricht unseren Admins vorgelegt.\n\n' +
      'Du musst nichts weiter tun. Falls dich jemand unter Druck setzt oder ' +
      'Geld verlangt: geh bitte auf nichts ein.'
    );
  } catch { /* egal */ }

  if (!schon) await meldeAnAdmins(ctx, h, text, melderName);
  return true;
}

async function meldeAnAdmins(
  ctx: Context, h: Herkunft, text: string, melderName: string | null
): Promise<void> {
  const ziel = config.adminLogChat;
  if (!ziel || !ziel.trim()) return;

  const melder = ctx.from!.username ? `@${ctx.from!.username}` : (melderName || String(ctx.from!.id));

  let wer: string;
  if (h.art === 'kennung') {
    wer = `${h.name || 'ohne Namen'}${h.username ? ' (@' + h.username + ')' : ''}\n` +
      `   Kennung: ${h.id}`;
  } else if (h.art === 'nur_name') {
    wer = `${h.name || 'ohne Namen'}\n` +
      '   ⚠️ KEINE Kennung — die Person hat die Weiterleitungs-Privatsphäre aktiviert.\n' +
      '   Das Konto ist daraus nicht bestimmbar. Der Bot kann hier von sich aus nichts tun.';
  } else if (h.art === 'kanal') {
    wer = `Kanal: ${h.name || h.id}`;
  } else {
    wer = 'Herkunft nicht erkennbar';
  }

  const zeilen = [
    '[Shield][MELDUNG] Ein Mitglied meldet eine private Nachricht',
    '',
    `Gemeldet von: ${melder}  (Kennung ${ctx.from!.id})`,
    '',
    `Betrifft: ${wer}`,
    '',
    '--- Nachricht ---',
    text ? text.slice(0, 1500) : '(kein Text — Bild, Sprachnachricht o.ä.)',
    '',
    'Es wurde NICHTS automatisch gesperrt. Bitte schaut jemand darauf.',
  ];

  try {
    await ctx.telegram.sendMessage(ziel, zeilen.join('\n'), {
      disable_web_page_preview: true,
    } as any);
  } catch (error: any) {
    console.error('[Meldeweg] Admin-Meldung fehlgeschlagen:', error?.message);
  }
}

/** Kurzer Text für /start und /help im Privatchat. */
export const MELDEWEG_HILFE = HILFE;
