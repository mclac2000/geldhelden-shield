/**
 * measure-first-message.ts — Was hätte die Erstnachrichten-Regel getroffen?
 *
 * ZUR AUSSAGEKRAFT — bitte vor dem Lesen der Zahlen beachten:
 *
 * Shield hat vor dem 05.09.2026 nirgends Nachrichtentext gespeichert. Eine
 * rückwirkende Messung an echten Nachrichten ist deshalb unmöglich. Diese
 * Messung nutzt drei Quellen, alle mit ihrer eigenen Schwäche:
 *
 *   A) Die seit dem Scharfschalten der ERFASSUNG gesammelten Bewertungen.
 *      Echte Nachrichten, aber wenige Stunden Datenbasis.
 *   B) Die Bios echter Mitglieder als ERSATZSTICHPROBE. Keine Nachrichten,
 *      aber selbstgeschriebener Text echter Menschen — brauchbar für die
 *      Frage „schlägt die Regel bei normalem Text an?".
 *   C) Die bekannten Betrugsnachrichten als Positivkontrolle.
 *
 * Alle Zahlen sind COUNT(DISTINCT user_id).
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { getDatabase, isTeamMember } from '../src/db';
import { bewerteErstnachricht, entscheideErstnachricht } from '../src/firstMessageRisk';

function main(): void {
  const db = getDatabase();

  // ---- A) Tatsächlich gesammelte Bewertungen ------------------------------
  console.log('='.repeat(70));
  console.log('A) ECHTE NACHRICHTEN seit Beginn der Erfassung');
  console.log('='.repeat(70));

  const geprueft = db.prepare(
    'SELECT COUNT(DISTINCT user_id) AS personen, SUM(anzahl) AS nachrichten FROM first_message_counts'
  ).get() as any;
  console.log(`Geprüfte Nachrichten:            ${geprueft?.nachrichten ?? 0}`);
  console.log(`von verschiedenen Konten:        ${geprueft?.personen ?? 0}`);

  const zaehle = (m: string) => (db.prepare(
    'SELECT COUNT(DISTINCT user_id) AS n FROM first_message_events WHERE massnahme = ?'
  ).get(m) as any)?.n ?? 0;
  const wuerdenGesperrt = zaehle('sperren');
  const alarme = zaehle('alarm');
  console.log(`WÜRDEN GESPERRT:                 ${wuerdenGesperrt} Personen`);
  console.log(`Nur Alarm:                       ${alarme} Personen`);

  const details = db.prepare(
    'SELECT * FROM first_message_events ORDER BY created_at DESC LIMIT 20'
  ).all() as any[];
  for (const e of details) {
    console.log(`  ${e.massnahme.toUpperCase()} ${e.user_id} @${e.username || '-'} — ${e.punkte} P., ${e.inhaltliche_gruppen} Gr.`);
    console.log(`     ${JSON.stringify(String(e.text || '').substring(0, 120))}`);
  }
  if (details.length === 0) console.log('  (noch keine Bewertung über der Alarmschwelle)');

  // ---- B) Ersatzstichprobe: Bios echter Mitglieder -------------------------
  console.log('\n' + '='.repeat(70));
  console.log('B) ERSATZSTICHPROBE: Bios echter Mitglieder als Texteingabe');
  console.log('='.repeat(70));
  console.log('Keine Nachrichten, aber echter selbstgeschriebener Text.');
  console.log('Bewertet mit „gerade beigetreten, erste Nachricht" — also im');
  console.log('ungünstigsten Fall, mit allen Zeitpunkt-Zuschlägen.\n');

  const GESPERRT = new Set([2093115204, 6392030661, 6543426390, 7312392658, 7419001827, 7929723698]);

  const profile = db.prepare(`
    SELECT p.user_id, p.bio,
           MAX(b.first_name) AS first_name, MAX(b.last_name) AS last_name,
           MAX(b.username) AS username
    FROM user_profiles p
    LEFT JOIN baseline_members b ON b.user_id = p.user_id
    WHERE p.bio IS NOT NULL AND p.bio != ''
    GROUP BY p.user_id
  `).all() as any[];

  let echteGeprueft = 0;
  const echteTreffer: any[] = [];
  const echteAlarme: any[] = [];
  const betrueger: any[] = [];

  for (const p of profile) {
    if (isTeamMember(p.user_id)) continue;
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    const b = bewerteErstnachricht({
      text: p.bio, anzeigename: name, minutenSeitBeitritt: 1, nachrichtNr: 1,
    });
    const u = entscheideErstnachricht(b);
    const eintrag = { ...p, name, punkte: b.punkte, gruppen: b.inhaltlicheGruppen, signale: b.signale, massnahme: u.massnahme };

    if (GESPERRT.has(p.user_id)) { betrueger.push(eintrag); continue; }
    echteGeprueft++;
    if (u.massnahme === 'sperren') echteTreffer.push(eintrag);
    else if (u.massnahme === 'alarm') echteAlarme.push(eintrag);
  }

  console.log(`Bios echter Mitglieder geprüft:  ${echteGeprueft}`);
  console.log(`WÜRDEN GESPERRT:                 ${echteTreffer.length}`);
  console.log(`Nur Alarm:                       ${echteAlarme.length}\n`);

  for (const t of echteTreffer) {
    console.log(`  ❌ SPERRE ${t.user_id} @${t.username || '-'} "${t.name}" — ${t.punkte} P., ${t.gruppen} Gr.`);
    console.log(`     ${JSON.stringify(String(t.bio).substring(0, 130))}`);
    console.log(`     ${t.signale.join(', ')}`);
  }
  for (const t of echteAlarme) {
    console.log(`  ⚠️  ALARM ${t.user_id} @${t.username || '-'} "${t.name}" — ${t.punkte} P., ${t.gruppen} Gr.`);
    console.log(`     ${JSON.stringify(String(t.bio).substring(0, 130))}`);
    console.log(`     ${t.signale.join(', ')}`);
  }
  if (echteTreffer.length === 0 && echteAlarme.length === 0) console.log('  (keine)');

  // ---- C) Positivkontrolle -----------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log('C) POSITIVKONTROLLE: die heute gesperrten Betrüger');
  console.log('='.repeat(70));
  let erkannt = 0;
  for (const t of betrueger) {
    const sym = t.massnahme === 'sperren' ? '✅' : t.massnahme === 'alarm' ? '⚠️ ' : '❌';
    if (t.massnahme === 'sperren') erkannt++;
    console.log(`  ${sym} ${t.user_id} @${t.username || '-'} — ${t.punkte} P., ${t.gruppen} Gr. -> ${t.massnahme}`);
  }
  console.log(`\nVon ${betrueger.length} bekannten Betrügern über die Bio erkannt: ${erkannt}`);
  console.log('(Die Bio ist kürzer als ihre Werbenachricht — die eigentliche');
  console.log(' Nachricht aus dem Screenshot erreicht 160 Punkte.)');

  process.exit(0);
}

main();
