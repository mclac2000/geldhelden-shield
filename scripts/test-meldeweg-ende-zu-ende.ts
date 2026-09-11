/**
 * test-meldeweg-ende-zu-ende.ts — Der ganze Weg, von der Meldung bis zum Eintrag.
 *
 * Spielt zwei Weiterleitungen durch, so wie Telegram sie liefert:
 *   Fall A: Absender sichtbar        -> Konto ist bestimmbar
 *   Fall B: Weiterleitungs-Privatsphäre aktiv -> nur ein Name, keine Kennung
 *           (genau der Fall, den beide von Marco gemeldeten Profile hätten)
 *
 * Prüft jeweils: Eintrag in der Datenbank, Antwort an das meldende Mitglied,
 * Meldung an die Admins. Schickt dabei ECHT nach Telegram — eine Zustellung,
 * die man nicht nachgesehen hat, ist keine Zustellung.
 *
 * Räumt seine Testeinträge danach wieder weg.
 *
 * Aufruf: docker exec geldhelden-shield-bot npx tsx scripts/test-meldeweg-ende-zu-ende.ts
 */
process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { behandleMeldung, leseHerkunft } from '../src/meldeweg';
import { getDatabase } from '../src/db';
import { config } from '../src/config';

let fehler = 0;
function pruefe(ok: boolean, text: string): void {
  if (!ok) fehler++;
  console.log('  ' + (ok ? 'OK  ' : 'FEHLER  ') + text);
}

const MELDER_ID = 999000111; // erfundene Kennung, existiert nicht
const MARKE = 'MELDEWEG-TEST-' + Date.now();

/** Ein Kontext, der sich verhält wie Telegraf — aber echt nach Telegram sendet. */
function baueKontext(msg: any) {
  const antworten: string[] = [];
  const adminMeldungen: string[] = [];
  return {
    ctx: {
      message: msg,
      from: msg.from,
      chat: msg.chat,
      reply: async (t: string) => { antworten.push(t); return {} as any; },
      telegram: {
        sendMessage: async (chatId: any, t: string) => {
          adminMeldungen.push(t);
          // Echt senden, damit die Zustellung nachgewiesen ist.
          const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: t, disable_web_page_preview: true }),
          });
          const j: any = await r.json();
          if (!j.ok) throw new Error(j.description);
          return j.result;
        },
      },
    } as any,
    antworten,
    adminMeldungen,
  };
}

async function main() {
  console.log('Admin-Chat: ' + (config.adminLogChat || '(nicht gesetzt)'));
  console.log('');

  // ---------------------------------------------------------------- Fall A
  console.log('=== Fall A: Absender sichtbar ===');
  const a = baueKontext({
    message_id: 1,
    chat: { id: MELDER_ID, type: 'private' },
    from: { id: MELDER_ID, is_bot: false, first_name: 'Test', last_name: 'Melderin', username: 'testmelderin' },
    text: `${MARKE} Hallo, ich habe ein Angebot fuer dich: 300% Rendite mit CFD-Trading, schreib mir!`,
    forward_origin: {
      type: 'user',
      date: Math.floor(Date.now() / 1000) - 600,
      sender_user: { id: 8888777666, is_bot: false, first_name: 'Anneliese', last_name: 'Schoen', username: 'anneliese_cfd' },
    },
  });

  const behandeltA = await behandleMeldung(a.ctx);
  pruefe(behandeltA === true, 'Nachricht wurde als Meldung behandelt');
  pruefe(a.antworten.length === 1, 'Mitglied hat genau eine Bestätigung bekommen');
  pruefe(/angekommen/i.test(a.antworten[0] || ''), 'Bestätigung sagt, dass es angekommen ist');
  pruefe(a.adminMeldungen.length === 1, 'Admins wurden benachrichtigt (echt zugestellt)');
  pruefe(/8888777666/.test(a.adminMeldungen[0] || ''), 'Kennung des Gemeldeten steht in der Admin-Meldung');

  const db = getDatabase();
  const eintragA = db.prepare(
    'SELECT * FROM meldungen WHERE text LIKE ? ORDER BY id DESC LIMIT 1'
  ).get(MARKE + '%') as any;
  pruefe(!!eintragA, 'Eintrag in der Tabelle meldungen angelegt');
  if (eintragA) {
    pruefe(eintragA.melder_id === MELDER_ID, 'Melder gespeichert');
    pruefe(eintragA.gemeldet_id === 8888777666, 'Gemeldeter gespeichert: ' + eintragA.gemeldet_id);
    pruefe(eintragA.gemeldet_username === 'anneliese_cfd', 'Benutzername des Gemeldeten gespeichert');
    pruefe(eintragA.herkunft === 'kennung', 'Herkunft als "kennung" vermerkt');
    pruefe(eintragA.bearbeitet === 0, 'Meldung steht als unbearbeitet — nichts automatisch passiert');

    // Die Rohdaten sind der entscheidende Teil: ohne sie liesse sich bei einer
    // echten Meldung nicht unterscheiden, ob Telegram nichts geliefert hat oder
    // ob mein Auswerter ein Feld nicht kennt.
    pruefe(!!eintragA.roh_weiterleitung, 'Rohdaten der Weiterleitung gespeichert');
    if (eintragA.roh_weiterleitung) {
      const roh = JSON.parse(eintragA.roh_weiterleitung);
      pruefe(roh.forward_origin?.type === 'user',
        'Rohdaten enthalten unveraendert, was Telegram schickte');
      pruefe(roh.forward_origin?.sender_user?.id === 8888777666,
        'auch die Kennung steht roh drin, nicht nur gedeutet');
    }
    pruefe(eintragA.roh_art === 'text', 'Nachrichtenart festgehalten: ' + eintragA.roh_art);
  }

  // ---------------------------------------------------------------- Fall B
  console.log('');
  console.log('=== Fall B: Weiterleitungs-Privatsphäre aktiv (keine Kennung) ===');
  const b = baueKontext({
    message_id: 2,
    chat: { id: MELDER_ID, type: 'private' },
    from: { id: MELDER_ID, is_bot: false, first_name: 'Test', last_name: 'Melderin', username: 'testmelderin' },
    text: `${MARKE}-B Guten Tag, darf ich Ihnen eine Anlagemoeglichkeit vorstellen?`,
    forward_origin: {
      type: 'hidden_user',
      date: Math.floor(Date.now() / 1000) - 300,
      sender_user_name: 'Anni Weninger',
    },
  });

  const behandeltB = await behandleMeldung(b.ctx);
  pruefe(behandeltB === true, 'Nachricht wurde als Meldung behandelt');
  pruefe(b.adminMeldungen.length === 1, 'Admins wurden benachrichtigt');
  pruefe(/KEINE Kennung/i.test(b.adminMeldungen[0] || ''),
    'Admin-Meldung weist ausdrücklich darauf hin, dass keine Kennung vorliegt');

  const eintragB = db.prepare(
    'SELECT * FROM meldungen WHERE text LIKE ? ORDER BY id DESC LIMIT 1'
  ).get(MARKE + '-B%') as any;
  pruefe(!!eintragB, 'Eintrag angelegt');
  if (eintragB) {
    pruefe(eintragB.gemeldet_id === null, 'keine Kennung gespeichert (richtig)');
    pruefe(eintragB.gemeldet_name === 'Anni Weninger', 'Anzeigename gespeichert: ' + eintragB.gemeldet_name);
    pruefe(eintragB.herkunft === 'nur_name', 'Herkunft als "nur_name" vermerkt');
    pruefe(!!eintragB.roh_weiterleitung, 'auch hier sind die Rohdaten da');
  }

  // ---------------------------------------------------- Fall B2: alles leer
  // Der wichtigste Fall fuer die freie Wildbahn: Telegram liefert zur Herkunft
  // gar nichts. Dann muss die Meldung trotzdem ankommen — und die Rohdaten
  // muessen zeigen, dass die Leere von Telegram kam und nicht von mir.
  console.log('');
  console.log('=== Fall B2: Telegram liefert KEINE Herkunft ===');
  const b2 = baueKontext({
    message_id: 22,
    chat: { id: MELDER_ID, type: 'private' },
    from: { id: MELDER_ID, is_bot: false, first_name: 'Test', username: 'testmelderin' },
    text: `${MARKE}-B2 Nachricht ohne jede Herkunftsangabe`,
    forward_date: Math.floor(Date.now() / 1000) - 100,
  });
  await behandleMeldung(b2.ctx);
  const eintragB2 = db.prepare(
    'SELECT * FROM meldungen WHERE text LIKE ? ORDER BY id DESC LIMIT 1'
  ).get(MARKE + '-B2%') as any;
  pruefe(!!eintragB2, 'Meldung wird auch ohne Herkunft gespeichert');
  if (eintragB2) {
    pruefe(eintragB2.herkunft === 'unbekannt', 'als "unbekannt" vermerkt');
    const roh = JSON.parse(eintragB2.roh_weiterleitung || '{}');
    const gefuellt = Object.entries(roh).filter(([, v]) => v !== null && v !== undefined);
    pruefe(gefuellt.length === 1 && gefuellt[0][0] === 'forward_date',
      'Rohdaten belegen: nur forward_date kam an, sonst nichts — die Leere ist Telegrams');
  }

  // ------------------------------------------------- Fall C: keine Weiterleitung
  console.log('');
  console.log('=== Fall C: jemand schreibt dem Bot einfach so ===');
  const c = baueKontext({
    message_id: 3,
    chat: { id: MELDER_ID, type: 'private' },
    from: { id: MELDER_ID, is_bot: false, first_name: 'Test' },
    text: 'Hallo?',
  });
  const behandeltC = await behandleMeldung(c.ctx);
  pruefe(behandeltC === true, 'wurde behandelt');
  pruefe(/weiterleit/i.test(c.antworten[0] || ''), 'Bot erklärt, wie man meldet');
  const zaehlerC = db.prepare(
    "SELECT COUNT(*) AS n FROM meldungen WHERE melder_id = ? AND text = 'Hallo?'"
  ).get(MELDER_ID) as any;
  pruefe(zaehlerC.n === 0, 'kein Eintrag für eine Nicht-Meldung');

  // ------------------------------------------------- Doppelung
  console.log('');
  console.log('=== Fall D: dieselbe Meldung zweimal (Doppelklick) ===');
  const vorher = (db.prepare('SELECT COUNT(*) AS n FROM meldungen WHERE text LIKE ?')
    .get(MARKE + '%') as any).n;
  const d = baueKontext({
    message_id: 4,
    chat: { id: MELDER_ID, type: 'private' },
    from: { id: MELDER_ID, is_bot: false, first_name: 'Test', username: 'testmelderin' },
    text: `${MARKE} Hallo, ich habe ein Angebot fuer dich: 300% Rendite mit CFD-Trading, schreib mir!`,
    forward_origin: {
      type: 'user', date: Math.floor(Date.now() / 1000) - 600,
      sender_user: { id: 8888777666, is_bot: false, first_name: 'Anneliese', username: 'anneliese_cfd' },
    },
  });
  await behandleMeldung(d.ctx);
  const nachher = (db.prepare('SELECT COUNT(*) AS n FROM meldungen WHERE text LIKE ?')
    .get(MARKE + '%') as any).n;
  pruefe(nachher === vorher, 'kein zweiter Eintrag');
  pruefe(d.adminMeldungen.length === 0, 'Admins nicht doppelt benachrichtigt');
  pruefe(d.antworten.length === 1, 'Mitglied bekommt trotzdem eine Bestätigung');

  // ------------------------------------------------- Herkunft direkt
  console.log('');
  console.log('=== Fall E: Herkunft aus einem Kanal ===');
  const h = leseHerkunft({
    forward_origin: { type: 'channel', date: 1700000000, chat: { id: -100123, title: 'Krypto Signale', username: 'kryptosignale' }, message_id: 5 },
  });
  pruefe(h.art === 'kanal', 'als Kanal erkannt');
  pruefe(h.name === 'Krypto Signale', 'Kanalname gelesen');

  // ------------------------------------------------- Aufräumen
  console.log('');
  console.log('=== Aufräumen ===');
  const weg = db.prepare('DELETE FROM meldungen WHERE melder_id = ?').run(MELDER_ID);
  pruefe(weg.changes >= 2, weg.changes + ' Testeinträge entfernt');
  const rest = (db.prepare('SELECT COUNT(*) AS n FROM meldungen WHERE melder_id = ?')
    .get(MELDER_ID) as any).n;
  pruefe(rest === 0, 'keine Testdaten zurückgelassen');

  console.log('');
  console.log('='.repeat(64));
  console.log(fehler === 0 ? 'MELDEWEG BESTANDEN — Meldung, Eintrag, Admin-Meldung, Bestätigung'
    : 'FEHLGESCHLAGEN: ' + fehler + ' Abweichung(en)');
  console.log('='.repeat(64));
  process.exit(fehler === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
