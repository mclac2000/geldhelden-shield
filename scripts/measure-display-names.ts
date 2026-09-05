/**
 * measure-display-names.ts — Wie viele ECHTE Mitglieder hätte die
 * Namensprüfung getroffen?
 *
 * Anders als bei Nachrichtentexten liegen Anzeigenamen vollständig in der
 * Datenbank. Diese Messung ist deshalb sofort möglich und rückwirkend
 * vollständig — sie deckt alle bekannten Konten ab, nicht nur die letzten Tage.
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { getDatabase, isTeamMember } from '../src/db';
import { istVerfremdeterName } from '../src/firstMessageRisk';

const GESPERRTE_WELLE = new Set([
  2093115204, 6392030661, 6543426390, 7312392658, 7419001827, 7929723698,
]);

function main(): void {
  const db = getDatabase();
  const mitglieder = db.prepare(`
    SELECT user_id,
           MAX(username)   AS username,
           MAX(first_name) AS first_name,
           MAX(last_name)  AS last_name,
           COUNT(DISTINCT chat_id) AS gruppen,
           MIN(first_seen_at) AS erster
    FROM baseline_members
    WHERE is_bot = 0
    GROUP BY user_id
  `).all() as any[];

  console.log(`Geprüfte Konten (COUNT DISTINCT user_id): ${mitglieder.length}\n`);

  const treffer: any[] = [];
  let team = 0;

  for (const m of mitglieder) {
    const name = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    if (!name) continue;
    const b = istVerfremdeterName(name);
    if (!b.verfremdet) continue;
    if (isTeamMember(m.user_id)) { team++; continue; }
    treffer.push({ ...m, name, grund: b.grund, punkte: b.punkte, bekannt: GESPERRTE_WELLE.has(m.user_id) });
  }

  const bekannt = treffer.filter(t => t.bekannt).length;
  const neu = treffer.filter(t => !t.bekannt);

  console.log('='.repeat(70));
  console.log('ERGEBNIS: Namensprüfung am gesamten Bestand');
  console.log('='.repeat(70));
  console.log(`Konten mit verfremdetem Namen:        ${treffer.length}`);
  console.log(`davon bereits gesperrte Betrüger:     ${bekannt}`);
  console.log(`davon Team (ausgenommen):             ${team}`);
  console.log(`ÜBRIGE — potenzielle Fehlalarme:      ${neu.length}\n`);
  const stark = neu.filter(t => t.punkte >= 20);
  console.log(`davon mit STARKEM Signal (20 Punkte): ${stark.length}`);
  console.log(`davon mit schwachem Signal (8 Punkte): ${neu.length - stark.length}\n`);

  console.log('--- Die übrigen im Wortlaut ---');
  for (const t of neu) {
    console.log(`  ${t.user_id} @${t.username || '-'} "${t.name}"`);
    console.log(`     ${t.gruppen} Gruppen | seit ${t.erster ? new Date(t.erster).toISOString().substring(0, 10) : '?'} | ${t.grund}`);
  }
  if (neu.length === 0) console.log('  (keine)');

  console.log('\nHINWEIS: Ein verfremdeter Name allein sperrt NIE — er ist 20 von');
  console.log('70 nötigen Punkten und zählt nicht als inhaltliche Signalgruppe.');
  process.exit(0);
}

main();
