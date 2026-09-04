/**
 * test-startup-order.ts — Schützt vor der teuersten Falle dieses Projekts
 *
 * Aufruf:  npm run test:startup
 *
 * HINTERGRUND
 * bot.launch() löst im Long-Polling-Betrieb NIE auf. Alles, was im selben
 * Block dahinter steht, wird in keinem einzigen Start ausgeführt.
 *
 * Das ist acht Monate lang unbemerkt geblieben. Dahinter standen unter anderem:
 *   - der Wochenbericht-Cron (sonntags 20:00)  → nie registriert
 *   - der monatliche Baseline-Scan             → nie registriert
 * Die Folge war ein System, das aussah, als liefe es: die Mitgliederbasis
 * wurde von Januar bis September 2026 nicht ein einziges Mal aufgefrischt.
 *
 * Dieser Test liest index.ts als Text und stellt sicher, dass hinter
 * `await bot.launch(` nichts steht, was ausgeführt werden müsste.
 * Er braucht keine Datenbank, kein Netz und keinen laufenden Bot.
 */

import * as fs from 'fs';
import * as path from 'path';

// Optionaler Pfad als Argument — wird gebraucht, um den Test selbst gegen eine
// absichtlich kaputte Fassung zu prüfen (siehe npm run test:startup:selbsttest).
const INDEX = process.argv[2] || path.join(__dirname, '..', 'src', 'index.ts');

/** Was hinter bot.launch() niemals stehen darf, mit Begründung */
const VERBOTEN: Array<{ muster: RegExp; was: string }> = [
  { muster: /\bcron\.schedule\s*\(/, was: 'cron.schedule — der Job würde nie registriert' },
  { muster: /\bsetInterval\s*\(/, was: 'setInterval — würde nie starten' },
  { muster: /\bsetTimeout\s*\(/, was: 'setTimeout — würde nie starten' },
  { muster: /\bstart[A-Z]\w*Scheduler\s*\(/, was: 'Scheduler-Start — würde nie laufen' },
  { muster: /\bawait\s+(?!next\(\))/, was: 'await — der Aufruf würde nie stattfinden' },
];

/**
 * Zeilen, die dort stehen dürfen: reine Ausgaben, Kommentare, Blockenden.
 * Sie tun nichts, was jemand vermissen würde.
 */
function istUnbedenklich(zeile: string): boolean {
  const z = zeile.trim();
  if (z === '') return true;
  if (z.startsWith('//') || z.startsWith('*') || z.startsWith('/*')) return true;
  if (/^console\.(log|info|warn|error)\(/.test(z)) return true;
  if (/^[})\];,]*$/.test(z)) return true;
  return false;
}

function main(): void {
  const quelle = fs.readFileSync(INDEX, 'utf-8');
  const zeilen = quelle.split('\n');

  const launchIdx = zeilen.findIndex(z => /await\s+bot\.launch\s*\(/.test(z));
  if (launchIdx === -1) {
    console.error('✗ Kein "await bot.launch(" in index.ts gefunden — Test kann nicht greifen.');
    console.error('  Wurde der Start umgebaut? Dann diesen Test anpassen.');
    process.exit(1);
  }

  // Ende des launch()-Aufrufs finden (die Zeile mit der schließenden Klammer)
  let ende = launchIdx;
  while (ende < zeilen.length && !/\}\s*\)\s*;/.test(zeilen[ende]) && !/\)\s*;/.test(zeilen[ende])) {
    ende++;
  }

  // Nur bis zum Ende der main()-Funktion prüfen: ab dem catch-Block ist
  // Fehlerbehandlung, die sehr wohl läuft.
  let mainEnde = ende;
  while (mainEnde < zeilen.length && !/^\s*\}\s*catch\s*\(/.test(zeilen[mainEnde])) {
    mainEnde++;
  }

  const funde: string[] = [];
  for (let i = ende + 1; i < mainEnde; i++) {
    const zeile = zeilen[i];
    if (istUnbedenklich(zeile)) continue;
    for (const { muster, was } of VERBOTEN) {
      if (muster.test(zeile)) {
        funde.push(`  index.ts:${i + 1}  ${was}\n      ${zeile.trim().substring(0, 90)}`);
        break;
      }
    }
  }

  console.log(`\nbot.launch() steht in index.ts:${launchIdx + 1}`);
  console.log(`Geprüfter Bereich: Zeile ${ende + 2} bis ${mainEnde} (bis zum catch-Block)\n`);

  if (funde.length > 0) {
    console.error('✗ FEHLER: Hinter bot.launch() steht Code, der niemals ausgeführt wird:\n');
    console.error(funde.join('\n\n'));
    console.error('\n  bot.launch() löst im Long-Polling nicht auf.');
    console.error('  Diese Zeilen gehören VOR den launch()-Aufruf.\n');
    process.exit(1);
  }

  console.log('✓ Hinter bot.launch() steht nur noch Unbedenkliches (Ausgaben, Kommentare).');
  console.log('✓ Kein Cron, kein Timer, kein await — nichts, was jemand vermissen würde.\n');
}

main();
