/**
 * kalibriere-an-meldungen.ts — Die Erstnachrichten-Regel gegen echte,
 * von Menschen bestätigte Betrugsnachrichten halten.
 *
 * DIE VERBINDUNG ZWISCHEN ZWEI ARBEITEN:
 *
 * Der Meldeweg (docs/MELDEWEG.md) sammelt seit dem 11.09.2026 den Wortlaut
 * privater Betrugsnachrichten — weitergeleitet von Mitgliedern, die sie
 * bekommen haben. Das ist die einzige Quelle echter Betrugstexte im System,
 * denn 91,4 % der Fälle passieren privat, wo der Bot nie mitliest.
 *
 * Die Erstnachrichten-Regel hat das umgekehrte Problem: Sie sieht nur
 * Gruppennachrichten und kennt einen engen Wortschatz (Handel mit
 * Zahlungskonten). Ob dieser Wortschatz die tatsächlichen Maschen trifft,
 * war bis jetzt nicht prüfbar.
 *
 * Dieses Skript hält beides gegeneinander: Jede gemeldete Nachricht wird
 * durch `bewerteErstnachricht` geschickt. Die Punktzahl sagt, ob die Regel
 * dieselbe Nachricht in einer Gruppe erkannt hätte.
 *
 * Es ÄNDERT NICHTS — es liest nur und rechnet.
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { getDatabase } from '../src/db';
import {
  bewerteErstnachricht, entscheideErstnachricht,
  SCHWELLE_SPERRE, SCHWELLE_ALARM,
} from '../src/firstMessageRisk';

function main(): void {
  const db = getDatabase();

  let meldungen: any[] = [];
  try {
    meldungen = db.prepare(`
      SELECT id, created_at, gemeldet_id, gemeldet_username, gemeldet_name,
             herkunft, text
      FROM meldungen
      WHERE text IS NOT NULL AND text != ''
      ORDER BY created_at DESC
    `).all() as any[];
  } catch {
    console.log('Die Tabelle "meldungen" gibt es noch nicht — der Meldeweg');
    console.log('hat noch keine Nachricht erhalten. Nichts zu kalibrieren.');
    process.exit(0);
  }

  console.log('='.repeat(70));
  console.log('KALIBRIERUNG an gemeldeten Betrugsnachrichten');
  console.log('='.repeat(70));
  console.log(`Schwellen: Alarm ab ${SCHWELLE_ALARM}, Sperre ab ${SCHWELLE_SPERRE} Punkten`);
  console.log(`und mindestens 2 inhaltliche Signalgruppen.\n`);
  console.log(`Gemeldete Nachrichten mit Wortlaut: ${meldungen.length}\n`);

  if (meldungen.length === 0) {
    console.log('Noch keine Meldung mit Text eingegangen.');
    console.log('Sobald Mitglieder anfangen weiterzuleiten, wird diese Messung');
    console.log('aussagekräftig — vorher nicht.');
    process.exit(0);
  }

  let haetteGesperrt = 0, haetteGemeldet = 0, unerkannt = 0;
  const unerkannteTexte: any[] = [];

  for (const m of meldungen) {
    const name = m.gemeldet_name || '';
    const b = bewerteErstnachricht({
      text: m.text, anzeigename: name, minutenSeitBeitritt: 5, nachrichtNr: 1,
    });
    const u = entscheideErstnachricht(b);

    const sym = u.massnahme === 'sperren' ? '✅' : u.massnahme === 'alarm' ? '⚠️ ' : '❌';
    console.log(`${sym} ${b.punkte} P., ${b.inhaltlicheGruppen} Gr. — @${m.gemeldet_username || '-'} "${name}"`);
    console.log(`   ${JSON.stringify(String(m.text).substring(0, 140))}`);
    if (b.signale.length > 0) console.log(`   Signale: ${b.signale.join(', ')}`);

    if (u.massnahme === 'sperren') haetteGesperrt++;
    else if (u.massnahme === 'alarm') haetteGemeldet++;
    else { unerkannt++; unerkannteTexte.push({ ...m, punkte: b.punkte }); }
  }

  const quote = (n: number) => `${n} (${Math.round(n / meldungen.length * 100)} %)`;

  console.log('\n' + '='.repeat(70));
  console.log('ERGEBNIS');
  console.log('='.repeat(70));
  console.log(`Hätte gesperrt:   ${quote(haetteGesperrt)}`);
  console.log(`Hätte gemeldet:   ${quote(haetteGemeldet)}`);
  console.log(`NICHT erkannt:    ${quote(unerkannt)}`);

  if (unerkannt > 0) {
    console.log('\n--- Die unerkannten Maschen: hier fehlt der Regel der Wortschatz ---');
    for (const t of unerkannteTexte.slice(0, 20)) {
      console.log(`  ${t.punkte} P. | ${JSON.stringify(String(t.text).substring(0, 160))}`);
    }
    console.log('\nAchtung vor dem Schluss, die Regel müsse erweitert werden:');
    console.log('Diese Nachrichten kamen PRIVAT. Die Erstnachrichten-Regel greift');
    console.log('nur in Gruppen. Eine Masche, die ausschließlich privat läuft,');
    console.log('gehört in den Meldeweg, nicht in den Wortschatz der Regel —');
    console.log('sonst wächst die Regel um Muster, die sie nie zu sehen bekommt,');
    console.log('und jedes zusätzliche Muster ist ein zusätzliches Fehlalarmrisiko.');
  }

  process.exit(0);
}

main();
