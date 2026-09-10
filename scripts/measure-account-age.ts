/**
 * Messskript: Kontoalter-Schaetzung alt vs. neu.
 *
 * Beantwortet drei Fragen, jede mit einer Zahl:
 *   1. Wie oft war die ALTE Schaetzung unmoeglich (Konto angeblich juenger als
 *      der Zeitpunkt, an dem wir es zum ersten Mal gesehen haben)?
 *   2. Wie oft ist die NEUE Schaetzung unmoeglich? (Muss deutlich kleiner sein,
 *      sonst taugt die neue Tabelle nichts.)
 *   3. Trennt das korrigierte Kontoalter spaeter auffaellige Konten von
 *      unauffaelligen - und bei welcher Schwelle?
 *
 * Aufruf:  npx tsx scripts/measure-account-age.ts
 * Aendert nichts. Reine Messung.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { estimateAccountCreatedAt, estimateAccountAgeDays } from '../src/accountAge';

const DB_PFAD = process.env.SHIELD_DB || path.join(process.cwd(), 'data', 'shield.db');
const db = new Database(DB_PFAD, { readonly: true });

/** Die alte, kaputte Schaetzung - unveraendert uebernommen, zum Vergleich. */
function alteSchaetzung(userId: number): number | null {
  if (userId < 10000000) return new Date('2009-01-01').getTime();
  if (userId < 50000000) return new Date('2012-01-01').getTime();
  if (userId < 200000000) return new Date('2016-01-01').getTime();
  if (userId < 1000000000) return new Date('2019-01-01').getTime();
  const daysSince2020 = Math.floor((userId - 1000000000) / 100000);
  const d = new Date('2020-01-01');
  d.setDate(d.getDate() + daysSince2020);
  return Math.min(d.getTime(), Date.now());
}

const TAG = 24 * 60 * 60 * 1000;
const SONDER = new Set([777000, 42777, 136817688, 1087968824, 1271266957, 5434988373]);

interface Zeile { user_id: number; first_seen: number }
const users = db.prepare('SELECT user_id, first_seen FROM users').all() as Zeile[];

console.log('='.repeat(78));
console.log(`Datenbank: ${DB_PFAD}`);
console.log(`Nutzer insgesamt: ${users.length}`);
console.log('='.repeat(78));

// --- Frage 1 + 2: Wie viele Schaetzungen sind unmoeglich? -------------------
// Ein Konto kann nicht NACH dem Zeitpunkt angelegt worden sein, an dem wir es
// zum ersten Mal gesehen haben. Toleranz 1 Tag fuer Zeitzonen-Rauschen.
let altUnmoeglich = 0, neuUnmoeglich = 0, neuNull = 0, geprueft = 0;
let altSummeFehlerTage = 0, neuSummeFehlerTage = 0;

for (const u of users) {
  if (u.user_id <= 0 || SONDER.has(u.user_id)) continue;
  geprueft++;

  const alt = alteSchaetzung(u.user_id);
  if (alt !== null && alt > u.first_seen + TAG) {
    altUnmoeglich++;
    altSummeFehlerTage += (alt - u.first_seen) / TAG;
  }

  const neu = estimateAccountCreatedAt(u.user_id);
  if (neu === null) { neuNull++; continue; }
  if (neu > u.first_seen + TAG) {
    neuUnmoeglich++;
    neuSummeFehlerTage += (neu - u.first_seen) / TAG;
  }
}

console.log('\n--- PLAUSIBILITAETSTEST: Anmeldung nach Erstsichtung? (unmoeglich) ---');
console.log(`geprueft (ohne Sonder-/Nicht-Nutzer-IDs): ${geprueft}`);
console.log(`ALT  unmoeglich: ${altUnmoeglich} (${(100 * altUnmoeglich / geprueft).toFixed(1)} %)` +
  (altUnmoeglich ? `, im Schnitt ${(altSummeFehlerTage / altUnmoeglich).toFixed(0)} Tage daneben` : ''));
console.log(`NEU  unmoeglich: ${neuUnmoeglich} (${(100 * neuUnmoeglich / geprueft).toFixed(1)} %)` +
  (neuUnmoeglich ? `, im Schnitt ${(neuSummeFehlerTage / neuUnmoeglich).toFixed(0)} Tage daneben` : ''));
console.log(`NEU  nicht schaetzbar (bewusst): ${neuNull}`);

// --- Wie alt erscheinen die Konten, alt vs. neu? ---------------------------
function verteilung(f: (id: number) => number | null, titel: string) {
  const eimer: Record<string, number> = {
    'a) unter 6 Monate': 0, 'b) 6-12 Monate': 0, 'c) 1-2 Jahre': 0,
    'd) 2-5 Jahre': 0, 'e) ueber 5 Jahre': 0, 'f) nicht schaetzbar': 0,
  };
  const jetzt = Date.now();
  for (const u of users) {
    if (u.user_id <= 0 || SONDER.has(u.user_id)) continue;
    const t = f(u.user_id);
    if (t === null) { eimer['f) nicht schaetzbar']++; continue; }
    const j = (jetzt - t) / TAG / 365;
    if (j < 0.5) eimer['a) unter 6 Monate']++;
    else if (j < 1) eimer['b) 6-12 Monate']++;
    else if (j < 2) eimer['c) 1-2 Jahre']++;
    else if (j < 5) eimer['d) 2-5 Jahre']++;
    else eimer['e) ueber 5 Jahre']++;
  }
  console.log(`\n--- Altersverteilung ${titel} ---`);
  for (const [k, v] of Object.entries(eimer)) {
    console.log(`  ${k.padEnd(22)} ${String(v).padStart(6)}  ${(100 * v / geprueft).toFixed(1)} %`);
  }
}
verteilung(alteSchaetzung, 'ALT (kaputt)');
verteilung(estimateAccountCreatedAt, 'NEU');

// --- Frage 3: Trennschaerfe ------------------------------------------------
// Grundgesamtheit: Beitritte, die mindestens 30 Tage zurueckliegen (Nachlaufzeit),
// ohne den Importtag 27.08.2026.
const auffaellig = new Set<number>(
  (db.prepare(`
    SELECT user_id FROM scam_events
    UNION SELECT user_id FROM blacklist
    UNION SELECT user_id FROM escalations
  `).all() as { user_id: number }[]).map((r) => r.user_id)
);
const gebannt = new Set<number>(
  (db.prepare('SELECT user_id FROM blacklist').all() as { user_id: number }[]).map((r) => r.user_id)
);

const joiner = db.prepare(`
  SELECT DISTINCT j.user_id AS user_id, MIN(j.joined_at) AS jat
  FROM joins j
  WHERE j.joined_at <= ?
    AND date(j.joined_at/1000,'unixepoch') <> '2026-08-27'
  GROUP BY j.user_id
`).all(Date.now() - 30 * TAG) as { user_id: number; jat: number }[];

const proben = joiner
  .filter((r) => r.user_id > 0 && !SONDER.has(r.user_id))
  .map((r) => ({
    id: r.user_id,
    alterBeiBeitritt: (() => {
      const c = estimateAccountCreatedAt(r.user_id);
      return c === null ? null : (r.jat - c) / TAG;
    })(),
    auffaellig: auffaellig.has(r.user_id),
    gebannt: gebannt.has(r.user_id),
  }))
  .filter((p) => p.alterBeiBeitritt !== null) as
  { id: number; alterBeiBeitritt: number; auffaellig: boolean; gebannt: boolean }[];

console.log(`\n--- TRENNSCHAERFE: geschaetztes Kontoalter BEIM BEITRITT (n=${proben.length}) ---`);
const grenzen = [
  ['a) unter 3 Monate', -Infinity, 90],
  ['b) 3-6 Monate', 90, 182],
  ['c) 6-12 Monate', 182, 365],
  ['d) 1-2 Jahre', 365, 730],
  ['e) 2-5 Jahre', 730, 1825],
  ['f) ueber 5 Jahre', 1825, Infinity],
] as [string, number, number][];

console.log('  Gruppe                     n   auffaellig      %   gebannt      %');
for (const [name, von, bis] of grenzen) {
  const g = proben.filter((p) => p.alterBeiBeitritt >= von && p.alterBeiBeitritt < bis);
  if (!g.length) { console.log(`  ${name.padEnd(22)} ${String(0).padStart(5)}  (keine Faelle)`); continue; }
  const a = g.filter((p) => p.auffaellig).length;
  const b = g.filter((p) => p.gebannt).length;
  console.log(
    `  ${name.padEnd(22)} ${String(g.length).padStart(5)} ${String(a).padStart(11)} ${(100 * a / g.length).toFixed(1).padStart(6)} ${String(b).padStart(9)} ${(100 * b / g.length).toFixed(1).padStart(6)}`
  );
}

// --- Was wuerde eine Schwelle kosten und bringen? --------------------------
console.log('\n--- WAS EINE SCHWELLE BEDEUTEN WUERDE ---');
console.log('  (Wie viele Auffaellige wuerde sie erwischen, wie viele Unauffaellige mittreffen?)');
console.log('  Schwelle        betroffen        davon                Fehlalarme   erwischte');
console.log('                   gesamt     auffaellig  (Genauigkeit)             Auffaellige');
const gesamtAuffaellig = proben.filter((p) => p.auffaellig).length;
for (const tage of [30, 90, 182, 365, 730]) {
  const betroffen = proben.filter((p) => p.alterBeiBeitritt < tage);
  if (!betroffen.length) continue;
  const treffer = betroffen.filter((p) => p.auffaellig).length;
  const fehl = betroffen.length - treffer;
  console.log(
    `  juenger als ${String(tage).padStart(4)}d ${String(betroffen.length).padStart(9)} ${String(treffer).padStart(12)}` +
    ` ${(100 * treffer / betroffen.length).toFixed(1).padStart(11)} % ${String(fehl).padStart(11)}` +
    ` ${(100 * treffer / gesamtAuffaellig).toFixed(1).padStart(10)} %`
  );
}
console.log(`\n  Zum Vergleich - Grundquote: ${(100 * gesamtAuffaellig / proben.length).toFixed(1)} % aller Beitretenden wurden auffaellig.`);
console.log('  Eine Schwelle lohnt nur, wenn ihre Genauigkeit klar darueber liegt.\n');

db.close();
