/**
 * rueckschauCopyTrading.ts — zwei Fragen an die Vergangenheit
 *
 *   docker exec geldhelden-shield-bot node /app/dist/pruefungen/rueckschauCopyTrading.js
 *
 * 1. RÜCKWIRKEND: Lief dieselbe Masche in den letzten Wochen auch in anderen
 *    Gruppen? Mit Gruppe, Datum, Konto und Fundstelle.
 *
 * 2. FEHLALARM: Wie viele der gespeicherten ECHTEN Nachrichten hätte die neue
 *    Regel gelöscht oder gesperrt? Gemessen an echten Texten, nicht an
 *    erfundenen.
 *
 * WAS DIESE PRÜFUNG NICHT KANN — und das gehört vor jede Zahl, die sie nennt:
 * Der Bot speichert keine Gruppenverläufe. Durchsucht wird nur, was ohnehin
 * in der Datenbank steht:
 *
 *   • first_message_samples — die ersten Nachrichten NEUER Konten, seit dem
 *     11.09.2026, auch die harmlosen
 *   • crypto_events         — was der Krypto-Ankauf-Erkenner gemeldet hat
 *   • meldungen             — was Mitglieder dem Bot weitergeleitet haben
 *
 * Alles, was ein LANGE BESTEHENDES Konto in einer Gruppe geschrieben hat, ist
 * nirgends gespeichert und kann hier auch nicht gefunden werden. Ein leeres
 * Ergebnis für eine Gruppe heißt deshalb „in den gespeicherten Texten nichts",
 * nicht „dort war nichts". Der Copy-Trading-Fall vom 27.09.2026 ist nur
 * deshalb auffindbar, weil das Konto neu war.
 */

import {
  bewerteCopyTrading, entscheideCopyTrading, Absender,
} from '../copyTradingRisk';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || '/data/shield.db', { readonly: true, fileMustExist: true });

function zeit(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

const gruppentitel = new Map<string, string>();
for (const r of db.prepare('SELECT chat_id, title FROM groups').all() as any[]) {
  gruppentitel.set(String(r.chat_id), r.title || '');
}

interface Zeile {
  quelle: string; created_at: number; user_id: number; chat_id: string | null;
  username: string | null; anzeigename: string | null; text: string;
  nachrichtNr: number | null;
}

const zeilen: Zeile[] = [];

for (const r of db.prepare(
  'SELECT created_at, user_id, chat_id, username, anzeigename, nachricht_nr, text FROM first_message_samples WHERE text IS NOT NULL'
).all() as any[]) {
  zeilen.push({
    quelle: 'erstnachricht', created_at: r.created_at, user_id: r.user_id,
    chat_id: r.chat_id ? String(r.chat_id) : null, username: r.username,
    anzeigename: r.anzeigename, text: r.text, nachrichtNr: r.nachricht_nr,
  });
}

for (const r of db.prepare(
  'SELECT created_at, user_id, chat_id, username, anzeigename, text FROM crypto_events WHERE text IS NOT NULL'
).all() as any[]) {
  zeilen.push({
    quelle: 'krypto-meldung', created_at: r.created_at, user_id: r.user_id,
    chat_id: r.chat_id ? String(r.chat_id) : null, username: r.username,
    anzeigename: r.anzeigename, text: r.text, nachrichtNr: null,
  });
}

try {
  const spalten = (db.prepare('PRAGMA table_info(meldungen)').all() as any[]).map(c => c.name);
  const textspalte = ['text', 'inhalt', 'nachricht', 'wortlaut'].find(s => spalten.includes(s));
  if (textspalte) {
    for (const r of db.prepare(
      `SELECT created_at, ${textspalte} AS text FROM meldungen WHERE ${textspalte} IS NOT NULL`
    ).all() as any[]) {
      zeilen.push({
        quelle: 'mitglieder-meldung', created_at: r.created_at, user_id: 0,
        chat_id: null, username: null, anzeigename: null, text: r.text, nachrichtNr: null,
      });
    }
  }
} catch { /* Tabelle sieht anders aus als erwartet — dann eben ohne */ }

console.log('='.repeat(78));
console.log('RÜCKSCHAU Copy-Trading — Auftrag #125');
console.log('='.repeat(78));
console.log(`Durchsuchte Texte: ${zeilen.length}`);
if (zeilen.length) {
  const von = Math.min(...zeilen.map(z => z.created_at));
  const bis = Math.max(...zeilen.map(z => z.created_at));
  console.log(`Zeitraum:          ${zeit(von)}  bis  ${zeit(bis)}`);
}
console.log(`Bekannte Gruppen:  ${gruppentitel.size}`);
console.log('\nWICHTIG: Gruppenverläufe werden nicht gespeichert. Ein leeres Ergebnis');
console.log('für eine Gruppe heisst "in den gespeicherten Texten nichts" — nicht');
console.log('"dort war nichts". Nachrichten eingesessener Konten stehen nirgends.\n');

// ---------------------------------------------------------------------------
// 1. Rückwirkend: was hätte die neue Regel gefunden?
// ---------------------------------------------------------------------------

interface Treffer { z: Zeile; massnahme: string; punkte: number; signale: string[]; }
const treffer: Treffer[] = [];

for (const z of zeilen) {
  // Rückwirkend wird bewusst OHNE Absenderbonus gerechnet: Was damals über
  // das Konto bekannt war, wissen wir heute nicht mehr. Ohne Bonus ist die
  // Bewertung strenger gegen uns — sie zeigt eher zu viel als zu wenig.
  const absender: Absender = { nachrichtenInGruppe: z.nachrichtNr, kontoAlterTage: null };
  const b = bewerteCopyTrading(z.text, { absender });
  const u = entscheideCopyTrading(b);
  if (u.massnahme !== 'keine') {
    treffer.push({ z, massnahme: u.massnahme, punkte: b.punkte, signale: b.signale });
  }
}

treffer.sort((a, c) => c.punkte - a.punkte);

console.log('-'.repeat(78));
console.log(`1. TREFFER DER NEUEN REGEL IN GESPEICHERTEN TEXTEN: ${treffer.length}`);
console.log('-'.repeat(78));

for (const t of treffer) {
  const g = t.z.chat_id ? (gruppentitel.get(t.z.chat_id) || t.z.chat_id) : '(privat/gemeldet)';
  console.log(`\n▸ ${t.massnahme.toUpperCase()}  ${t.punkte} Punkte  [${t.z.quelle}]`);
  console.log(`  Datum:   ${zeit(t.z.created_at)}`);
  console.log(`  Gruppe:  ${g}`);
  console.log(`  Konto:   ${t.z.user_id}${t.z.username ? ' / @' + t.z.username : ''}` +
              `${t.z.anzeigename ? ' / ' + t.z.anzeigename : ''}`);
  console.log(`  Signale: ${t.signale.join(', ')}`);
  console.log(`  Text:    ${t.z.text.replace(/\s+/g, ' ').substring(0, 180)}`);
}

// ---------------------------------------------------------------------------
// 2. Dieselben Kennungen, Codes, Formulierungen — wörtlich gesucht
// ---------------------------------------------------------------------------

const SPUREN: Array<[string, RegExp]> = [
  ['Kennung @SuitableWinTrade', /suitablewintrade/i],
  ['Werbecode LHVUGTBO', /lhvugtbo/i],
  ['Formel "only listen to"', /only\s+(?:listen|follow|trust)/i],
  ['"win rate"', /win\s*-?\s*rate/i],
  ['"copy" + "trades"', /copy\w*[^.\n]{0,20}trades?/i],
  ['Werbe-/Einladungscode', /(?:referral|invite|promo|bonus|einladungs|empfehlungs)[\s_-]*code/i],
];

console.log(`\n${'-'.repeat(78)}`);
console.log('2. WÖRTLICHE SPUREN — dieselben Handles, Codes, Formulierungen');
console.log('-'.repeat(78));

for (const [name, re] of SPUREN) {
  const funde = zeilen.filter(z => re.test(z.text));
  console.log(`\n${name}: ${funde.length} Fund(e)`);
  for (const f of funde.slice(0, 8)) {
    const g = f.chat_id ? (gruppentitel.get(f.chat_id) || f.chat_id) : '(privat/gemeldet)';
    console.log(`   ${zeit(f.created_at)}  ${g}  ` +
                `${f.user_id}${f.username ? '/@' + f.username : ''}  ` +
                `„${f.text.replace(/\s+/g, ' ').substring(0, 90)}"`);
  }
}

// ---------------------------------------------------------------------------
// 3. Fehlalarm — gemessen an echten Texten
// ---------------------------------------------------------------------------

console.log(`\n${'-'.repeat(78)}`);
console.log('3. FEHLALARM-MESSUNG an echten Texten');
console.log('-'.repeat(78));

const zaehler = { keine: 0, melden: 0, loeschen: 0, sperren: 0 };
for (const z of zeilen) {
  const absender: Absender = { nachrichtenInGruppe: z.nachrichtNr, kontoAlterTage: null };
  const u = entscheideCopyTrading(bewerteCopyTrading(z.text, { absender }));
  zaehler[u.massnahme]++;
}
console.log(`durchgelassen (keine):   ${zaehler.keine} von ${zeilen.length}`);
console.log(`nur vorgelegt (melden):  ${zaehler.melden}`);
console.log(`gelöscht (loeschen):     ${zaehler.loeschen}`);
console.log(`gesperrt (sperren):      ${zaehler.sperren}`);

// Positivkontrolle: Ohne sie wäre „0 Treffer" auch dann ein gutes Ergebnis,
// wenn der Erkenner überhaupt nicht geladen wäre.
const probe = entscheideCopyTrading(bewerteCopyTrading(
  'Copy my trades! +900% profit, 99% win rate, leverage 75x. Referral code ZZQQ7788, dm me @NichtEchtBot',
  { alsBildunterschrift: true, absender: { nachrichtenInGruppe: 1, kontoAlterTage: 3 } }
));
console.log(`\nPositivkontrolle (erfundener Scam): ${probe.massnahme.toUpperCase()} — ` +
            `${probe.massnahme === 'sperren' ? 'Messweg lebt ✅' : 'MESSWEG TOT ❌'}`);

db.close();
process.exit(probe.massnahme === 'sperren' ? 0 : 1);
