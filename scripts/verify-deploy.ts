/**
 * verify-deploy.ts — Abnahmeprüfung nach dem Deploy.
 *
 * Prüft, dass die Zutrittsregel wirklich aus ist, dass die reparierte
 * Kontoalter-Schätzung plausible Werte liefert, dass Nicht-Nutzer-Kennungen
 * abgewiesen werden und dass das Protokoll der Zutrittsregel anlegbar ist.
 *
 * Aufruf:  docker exec geldhelden-shield-bot npx tsx scripts/verify-deploy.ts
 * Ändert nichts ausser dem Anlegen der (leeren) Protokolltabelle.
 */
process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { estimateAccountCreatedAt, describeAccountAge } from '../src/accountAge';
import { config } from '../src/config';
import { gateStatus } from '../src/usernameGate';
import { getDatabase } from '../src/db';

let fehlerGesamt = 0;
function pruefe(bedingung: boolean, text: string): void {
  if (!bedingung) fehlerGesamt++;
  console.log('  ' + (bedingung ? 'OK  ' : 'FEHLER  ') + text);
}

console.log('=== 1. Zutrittsregel und Risiko-Schalter ===');
console.log('  ' + gateStatus());
pruefe(config.usernameGateEnabled === false, 'USERNAME_GATE_ENABLED ist false (Regel wirkt nicht)');
pruefe(config.usernameGateGroups.length === 0, 'USERNAME_GATE_GROUPS ist leer');

// Seit 10.09.2026 bewusst scharf: Schwelle 365 Tage, Bonus 15.
// Die Schwelle MUSS mindestens 90 betragen - darunter ist die Alters-Schaetzung
// nicht entscheidbar (+/- 2-3 Monate), die Regel wuerde Rauschen bewerten.
pruefe(config.riskAccountAgeBonus === 15,
  'RISK_ACCOUNT_AGE_BONUS ist 15 (gelesen: ' + config.riskAccountAgeBonus + ')');
pruefe(config.riskAccountAgeThreshold === 365,
  'RISK_ACCOUNT_AGE_THRESHOLD ist 365 Tage (gelesen: ' + config.riskAccountAgeThreshold + ')');
pruefe(config.riskAccountAgeBonus === 0 || config.riskAccountAgeThreshold >= 90,
  'Schwelle ist grob genug fuer die Genauigkeit der Schaetzung (>= 90 Tage)');

console.log('');
console.log('=== 2. Kontoalter: Stichproben ===');
const proben: Array<[string, number, string]> = [
  ['sehr altes Konto (2013)', 2768409, '2013'],
  ['Konto von 2016', 222021233, '2016'],
  ['Konto von 2020', 1227964864, '2020'],
  ['letztes vor dem Sprung', 2138472342, '2021'],
  ['erstes nach dem Sprung', 5031711230, '2021'],
  ['Konto von 2024', 7357703634, '2024'],
  ['ganz frisches Konto', 8990000000, '2026'],
];
for (const eintrag of proben) {
  const name = eintrag[0];
  const id = eintrag[1];
  const erwartetesJahr = eintrag[2];
  const t = estimateAccountCreatedAt(id);
  const datum = t === null ? 'null' : new Date(t).toISOString().slice(0, 10);
  const passt = datum.slice(0, 4) === erwartetesJahr;
  if (!passt) fehlerGesamt++;
  console.log(
    '  ' + (passt ? 'OK  ' : 'FEHLER  ') + name.padEnd(26) +
    String(id).padStart(13) + ' -> ' + datum + '   ' + describeAccountAge(id)
  );
}

console.log('');
console.log('=== 3. Muss null liefern (keine echten Nutzerkonten) ===');
const nichtNutzer: Array<[string, number]> = [
  ['negativ (Kanal/Gruppe)', -1001234567890],
  ['Sonderkennung 777000', 777000],
  ['Sonderkennung Anonym', 1087968824],
  ['in der uebersprungenen Luecke', 3000000000],
];
for (const eintrag of nichtNutzer) {
  const r = estimateAccountCreatedAt(eintrag[1]);
  pruefe(r === null, eintrag[0] + ' -> null');
}

console.log('');
console.log('=== 4. Monotonie: aeltere Kennung darf nie juenger datiert sein ===');
let rueckwaerts = 0;
let geprueft = 0;
let vorher = -Infinity;
for (let id = 100000000; id < 9000000000; id += 37000000) {
  if (id > 2145338053 && id < 5000000000) continue;
  const t = estimateAccountCreatedAt(id);
  if (t === null) continue;
  geprueft++;
  if (t < vorher) {
    rueckwaerts++;
    console.log('    Rueckwaerts-Sprung bei Kennung ' + id);
  }
  vorher = t;
}
pruefe(rueckwaerts === 0, geprueft + ' Stichproben geprueft, ' + rueckwaerts + ' Rueckwaerts-Spruenge');

console.log('');
console.log('=== 5. Protokoll der Zutrittsregel ===');
try {
  getDatabase().exec(
    'CREATE TABLE IF NOT EXISTS username_gate_log (' +
    'id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, user_id INTEGER NOT NULL, ' +
    'chat_id TEXT NOT NULL, gruppentitel TEXT, hat_username INTEGER NOT NULL, entscheidung TEXT NOT NULL, ' +
    'grund TEXT, hinweis_zugestellt INTEGER NOT NULL DEFAULT 0, hinweis_fehler TEXT, ' +
    'regel_aktiv INTEGER NOT NULL DEFAULT 0)'
  );
  const zeile = getDatabase().prepare('SELECT COUNT(*) AS n FROM username_gate_log').get() as { n: number };
  pruefe(true, 'Tabelle username_gate_log vorhanden, ' + zeile.n + ' Eintraege (0 ist richtig)');
} catch (e: any) {
  pruefe(false, 'Protokolltabelle: ' + (e && e.message ? e.message : String(e)));
}

console.log('');
console.log('='.repeat(60));
console.log(fehlerGesamt === 0 ? 'ABNAHME BESTANDEN - keine Abweichung' : 'ABNAHME FEHLGESCHLAGEN: ' + fehlerGesamt + ' Abweichung(en)');
console.log('='.repeat(60));
process.exit(fehlerGesamt === 0 ? 0 : 1);
