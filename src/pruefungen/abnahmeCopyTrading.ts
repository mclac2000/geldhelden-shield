/**
 * abnahmeCopyTrading.ts — die Abnahmebedingung von Auftrag #125
 *
 * Läuft IM CONTAINER gegen den AUSGELIEFERTEN Erkenner:
 *
 *   docker exec geldhelden-shield-bot node /app/dist/pruefungen/abnahmeCopyTrading.js
 *
 * Das ist der Unterschied, auf den es ankommt. Ein Test, der im Arbeitsbaum
 * auf dem Mac läuft, prüft eine Kopie; hier wird geprüft, was der Bot in
 * diesem Moment wirklich benutzt. „Geändert ist nicht ausgeliefert."
 *
 * Exit 0 nur, wenn ALLE vier Teile stimmen:
 *
 *   1. Die echte Nachricht aus Koh Phangan ergibt „sperren".
 *   2. Drei echte Mitglieder-Beiträge über Trading ergeben „keine".
 *   3. POSITIVKONTROLLE: Ein absichtlich erfundener Satz, der greifen MUSS.
 *      Ohne ihn wäre „nichts gefunden" auch dann ein grüner Haken, wenn der
 *      Erkenner gar nicht geladen ist.
 *   4. In copy_trading_events steht mindestens eine durchgesetzte Zeile —
 *      der Nachweis, dass die Regel nicht nur rechnet, sondern gewirkt hat.
 */


import {
  bewerteCopyTrading, entscheideCopyTrading,
  CopyTradingMassnahme, Absender,
} from '../copyTradingRisk';

const FREMD: Absender = { nachrichtenInGruppe: 1, kontoAlterTage: 4 };
const MITGLIED: Absender = { nachrichtenInGruppe: 340, kontoAlterTage: 1900 };

interface Fall { was: string; text: string; bild?: boolean; absender: Absender; erwartet: CopyTradingMassnahme; }

const FAELLE: Fall[] = [
  {
    was: '1. Die echte Nachricht (Koh Phangan, 27.09.2026)',
    text: 'Best regards……I only listen to Suitable Win Trade 98% win rate in one month of copying his trades\n@SuitableWinTrade',
    bild: true, absender: FREMD, erwartet: 'sperren',
  },
  {
    was: '2a. Mitglied über einen kleinen Hebel',
    text: 'Ich habe gestern zum ersten Mal mit Hebel 3x gehandelt und prompt Verlust gemacht. Mache ich nicht nochmal.',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: '2b. Mitglied mit Steuerfrage und realistischem Kursplus',
    text: 'Wie versteuert man eigentlich Gewinne aus Krypto, wenn man in Thailand lebt? Mein BTC steht 40 % im Plus.',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: '2c. Mitglied fragt nach einer Börse (eine Namensliste würde hier falsch greifen)',
    text: 'Hat jemand Erfahrung mit BingX? Ich suche eine Börse, die auch ohne KYC funktioniert.',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: '3. POSITIVKONTROLLE — muss greifen, sonst ist der Messweg tot',
    text: 'Copy my trades! +900% profit last week, 99% win rate, leverage 75x. Referral code ZZQQ7788, dm me @NichtEchtBot',
    bild: true, absender: FREMD, erwartet: 'sperren',
  },
];

let fehler: string[] = [];

console.log('='.repeat(78));
console.log('ABNAHME Auftrag #125 — Copy-Trading-Erkennung, gegen das AUSGELIEFERTE dist/');
console.log(`Erkenner geladen aus: ${require.resolve('../copyTradingRisk')}`);
console.log('='.repeat(78));

for (const f of FAELLE) {
  const b = bewerteCopyTrading(f.text, { alsBildunterschrift: f.bild, absender: f.absender });
  const u = entscheideCopyTrading(b);
  const ok = u.massnahme === f.erwartet;
  if (!ok) fehler.push(`${f.was}: erwartet ${f.erwartet}, war ${u.massnahme}`);
  console.log(`\n${ok ? '✅' : '❌'} ${f.was}`);
  console.log(`   ${u.massnahme.toUpperCase()} — ${b.punkte} Punkte, ${b.tragendeGruppen}/5 Merkmale ` +
              `(erwartet: ${f.erwartet})`);
  if (b.signale.length) console.log(`   Signale: ${b.signale.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 4. Die Wirkung, nicht die Rechnung: eine durchgesetzte Zeile in der Datenbank
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(78)}\n4. Durchgesetzte Maßnahme in copy_trading_events\n${'='.repeat(78)}`);

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const dbPfad = process.env.DB_PATH || '/data/shield.db';
  const db = new Database(dbPfad, { readonly: true, fileMustExist: true });

  const tabelle = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='copy_trading_events'"
  ).get();
  if (!tabelle) {
    fehler.push('Tabelle copy_trading_events existiert nicht');
    console.log('❌ Tabelle copy_trading_events fehlt');
  } else {
    const z = db.prepare(
      'SELECT COUNT(*) AS n FROM copy_trading_events WHERE durchgesetzt = 1'
    ).get() as any;
    const letzte = db.prepare(
      `SELECT datetime(created_at/1000,'unixepoch') AS t, chat_titel, massnahme, punkte,
              geloeschte_nachrichten, gesperrt_in_gruppen, rueckgenommen
         FROM copy_trading_events ORDER BY created_at DESC LIMIT 5`
    ).all() as any[];

    console.log(`Datenbank: ${dbPfad}`);
    console.log(`Durchgesetzte Zeilen: ${z?.n ?? 0}`);
    for (const r of letzte) {
      console.log(`   ${r.t}  ${r.massnahme.padEnd(9)} ${String(r.punkte).padStart(4)} Pkt  ` +
                  `${r.geloeschte_nachrichten} gelöscht, ${r.gesperrt_in_gruppen} Gruppen gesperrt` +
                  `${r.rueckgenommen ? '  [ZURÜCKGENOMMEN]' : ''}  ${r.chat_titel || ''}`);
    }
    if ((z?.n ?? 0) < 1) {
      fehler.push('keine durchgesetzte Zeile in copy_trading_events — die Regel hat noch nie gewirkt');
      console.log('❌ Keine durchgesetzte Zeile.');
    } else {
      console.log('✅ Mindestens eine durchgesetzte Maßnahme protokolliert.');
    }
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
