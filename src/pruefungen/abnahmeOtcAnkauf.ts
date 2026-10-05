/**
 * abnahmeOtcAnkauf.ts — die Abnahmebedingung von Auftrag #275
 *
 *   docker exec geldhelden-shield-bot node /app/dist/pruefungen/abnahmeOtcAnkauf.js
 *
 * Läuft IM CONTAINER gegen den AUSGELIEFERTEN Erkenner. Ein Test im
 * Arbeitsbaum prüft eine Kopie; hier wird geprüft, was der Bot in diesem
 * Augenblick wirklich benutzt.
 *
 * Exit 0 nur, wenn alle vier Teile stimmen:
 *
 *   1. Der gemeldete Originaltext wird gelöscht oder gesperrt.
 *   2. Vier Varianten (eine deutsch) ebenso.
 *   3. Fünf normale Club-Nachrichten zu Krypto ergeben „keine".
 *   4. POSITIVKONTROLLE plus eine durchgesetzte Zeile in crypto_events —
 *      ohne beides wäre „nichts gefunden" auch dann grün, wenn der Erkenner
 *      gar nicht geladen ist oder nie etwas bewirkt hat.
 */

import {
  bewerteKryptoAnkauf, entscheideKryptoAnkauf,
  KryptoMassnahme, Absender,
} from '../cryptoBuyRisk';

const FREMD: Absender = { nachrichtenInGruppe: 1, kontoAlterTage: 5 };
const MITGLIED: Absender = { nachrichtenInGruppe: 280, kontoAlterTage: 1500 };

const ORIGINAL = `I am from China. 💵💵💵❤️❤️❤️💵💵
My company is engaged in international trade. Many of our overseas partners need to use USDT for payments to avoid tariffs. However, due to Chinese policy restrictions on large-scale purchases, we are unable to buy USDT in bulk through standard channels; consequently, we have to acquire it at prices 5%–20% above the market rate.
(We offer the best rates and the most secure transaction methods available.)
Once we confirm you hold the USDT, we will make the payment first, and then you transfer the USDT to us.
If you are a seller looking to sell USDT,
please contact me 👉 Telegram: @YLPAY618`;

interface Fall { was: string; text: string; absender: Absender; erwartet: KryptoMassnahme[]; }

const GREIFT: KryptoMassnahme[] = ['sperren', 'loeschen'];

const FAELLE: Fall[] = [
  { was: '1. Der gemeldete Originaltext (05.10.2026)', text: ORIGINAL, absender: FREMD, erwartet: GREIFT },

  { was: '2a. Variante DEUTSCH', absender: FREMD, erwartet: GREIFT,
    text: 'Guten Tag. Unsere Handelsgesellschaft benötigt laufend USDT für Zahlungen an Lieferanten in Asien, um Zölle zu vermeiden. ' +
          'Wegen behördlicher Beschränkungen können wir nicht über die üblichen Börsen kaufen und zahlen deshalb 8 % über dem Marktpreis. ' +
          'Wir überweisen zuerst, Sie senden die Coins danach. Wer USDT verkaufen möchte, schreibt mir bitte direkt: @otc_ankauf_eu' },

  { was: '2b. Variante knapp, mit Emoji-Kette', absender: FREMD, erwartet: GREIFT,
    text: 'Buying USDT in bulk. We pay 12% above market rate. Payment first, then you transfer. Sellers welcome, DM @usdt_desk_asia 💵💵💵💵' },

  { was: '2c. Variante USDC, Steuern statt Zölle', absender: FREMD, erwartet: GREIFT,
    text: 'Our trading house must source USDC outside the official channels because of capital control limits. ' +
          'We offer the best rates available, a premium of 15%, and we pay you first — you transfer the coins afterwards. ' +
          'Are you a seller? Contact me on Telegram: @usdc_bulk_office' },

  { was: '2d. Variante ohne Prozentzahl', absender: FREMD, erwartet: GREIFT,
    text: 'Wir kaufen große Mengen Kryptowährungen an, über dem Marktpreis, weil wir die Einfuhrabgaben umgehen müssen. ' +
          'Die Zahlung erfolgt zuerst, danach überweisen Sie uns die Coins. Verkäufer gesucht — jetzt melden bei @ankauf_otc_24' },

  { was: '3a. Mitglied will selbst USDT verkaufen', absender: MITGLIED, erwartet: ['keine'],
    text: 'Ich möchte einen Teil meiner USDT verkaufen. Wo bekommt man aktuell den besten Kurs, ohne viel Gebühren zu zahlen?' },

  { was: '3b. Steuerfrage mit Zoll und Krypto', absender: MITGLIED, erwartet: ['keine'],
    text: 'Weiß jemand, wie das steuerlich läuft, wenn eine Firma in Asien in USDT bezahlt? Fallen da Zölle oder Einfuhrabgaben an?' },

  { was: '3c. Kursgespräch mit Prozentangabe', absender: MITGLIED, erwartet: ['keine'],
    text: 'Der USDT-Kurs lag heute kurz 2 % über dem Marktpreis auf der kleinen Börse. Arbitrage lohnt sich bei den Gebühren aber nicht.' },

  { was: '3d. Mitglied plant einen größeren Kauf', absender: MITGLIED, erwartet: ['keine'],
    text: 'Wir überlegen, als Familie eine größere Menge Bitcoin zu kaufen. Lieber in Tranchen oder auf einmal? 💵' },

  { was: '3e. Erklärung von OTC-Handel', absender: MITGLIED, erwartet: ['keine'],
    text: 'OTC heißt einfach, dass man außerhalb der Börse direkt mit einer Gegenpartei handelt. Bei großen Summen ist das üblich und völlig legal.' },

  { was: '4. POSITIVKONTROLLE — muss greifen, sonst ist der Messweg tot', absender: FREMD, erwartet: ['sperren'],
    text: 'We are buying large quantities of USDT in bulk, 25% above the market rate, to avoid customs duties. ' +
          'We pay you first, you transfer the coins afterwards. Sellers welcome — contact me @NichtEchtesKonto 💵💵💵' },
];

let fehler: string[] = [];

console.log('='.repeat(78));
console.log('ABNAHME Auftrag #275 — OTC-/USDT-Ankauf über Marktpreis, gegen das AUSGELIEFERTE dist/');
console.log(`Erkenner geladen aus: ${require.resolve('../cryptoBuyRisk')}`);
console.log('='.repeat(78));

for (const f of FAELLE) {
  const b = bewerteKryptoAnkauf(f.text, { absender: f.absender });
  const u = entscheideKryptoAnkauf(b);
  const ok = f.erwartet.includes(u.massnahme);
  if (!ok) fehler.push(`${f.was}: erwartet ${f.erwartet.join('|')}, war ${u.massnahme}`);
  console.log(`\n${ok ? '✅' : '❌'} ${f.was}`);
  console.log(`   ${u.massnahme.toUpperCase()} — ${b.punkte} Punkte, ${b.tragendeGruppen}/6 Merkmale ` +
              `(erwartet: ${f.erwartet.join(' oder ')})`);
  if (b.signale.length) console.log(`   Signale: ${b.signale.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Die Wirkung, nicht die Rechnung
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(78)}\nDurchgesetzte Maßnahme in crypto_events\n${'='.repeat(78)}`);

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPfad = process.env.DB_PATH || '/data/shield.db';
  const db = new Database(dbPfad, { readonly: true, fileMustExist: true });

  const z = db.prepare('SELECT COUNT(*) AS n FROM crypto_events WHERE durchgesetzt = 1').get() as any;
  const letzte = db.prepare(
    `SELECT datetime(created_at/1000,'unixepoch') AS t, chat_id, massnahme, punkte,
            tragende_gruppen, durchgesetzt
       FROM crypto_events ORDER BY created_at DESC LIMIT 5`
  ).all() as any[];

  console.log(`Datenbank: ${dbPfad}`);
  console.log(`Durchgesetzte Zeilen: ${z?.n ?? 0}`);
  for (const r of letzte) {
    console.log(`   ${r.t}  ${String(r.massnahme).padEnd(9)} ${String(r.punkte).padStart(4)} Pkt  ` +
                `${r.tragende_gruppen}/6  ${r.durchgesetzt ? 'durchgesetzt' : 'nur gemeldet'}  ${r.chat_id}`);
  }
  if ((z?.n ?? 0) < 1) {
    fehler.push('keine durchgesetzte Zeile in crypto_events — die Regel hat noch nie gewirkt');
    console.log('❌ Keine durchgesetzte Zeile.');
  } else {
    console.log('✅ Mindestens eine durchgesetzte Maßnahme protokolliert.');
  }
  db.close();
} catch (e: any) {
  fehler.push(`Datenbank nicht prüfbar: ${e?.message}`);
  console.log(`❌ Datenbank nicht prüfbar: ${e?.message}`);
}

console.log(`\n${'='.repeat(78)}`);
if (fehler.length) {
  console.log(`❌ ABNAHME NICHT BESTANDEN — ${fehler.length} Punkt(e):`);
  for (const f of fehler) console.log(`   • ${f}`);
  process.exit(1);
}
console.log('✅ ABNAHME BESTANDEN.');
process.exit(0);
