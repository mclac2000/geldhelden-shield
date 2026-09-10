/**
 * Messskript: Was wuerde das Einschalten des Kontoalter-Bonus bewirken?
 *
 * Hintergrund: RISK_ACCOUNT_AGE_BONUS steht auf 0, der Faktor ist also
 * abgeschaltet. Die Reparatur der Alters-Schaetzung aendert deshalb am
 * Live-Verhalten NICHTS. Dieses Skript zeigt, was passieren WUERDE, wenn man
 * ihn einschaltet - damit die Schwelle eine bewusste Entscheidung wird und
 * keine Ueberraschung.
 *
 * Aufruf:  npx tsx scripts/measure-age-bonus-impact.ts
 * Aendert nichts. Reine Messung.
 */
import Database from 'better-sqlite3';
import path from 'path';
import { estimateAccountCreatedAt } from '../src/accountAge';

const DB_PFAD = process.env.SHIELD_DB || path.join(process.cwd(), 'data', 'shield.db');
const db = new Database(DB_PFAD, { readonly: true });
const TAG = 24 * 60 * 60 * 1000;
const SONDER = new Set([777000, 42777, 136817688, 1087968824, 1271266957, 5434988373]);

const RESTRICT_SCHWELLE = Number(process.env.RISK_RESTRICT_THRESHOLD || 60);
const BAN_SCHWELLE = Number(process.env.RISK_BAN_THRESHOLD || 120);

console.log('='.repeat(78));
console.log('AUSWIRKUNG DES KONTOALTER-BONUS');
console.log(`Schwellen aktuell: einschraenken ab ${RESTRICT_SCHWELLE}, bannen ab ${BAN_SCHWELLE}`);
console.log('='.repeat(78));

// --- Teil 1: Aendert die Reparatur allein etwas? ---------------------------
const bonusJetzt = Number(process.env.RISK_ACCOUNT_AGE_BONUS ?? '0');
console.log(`\n--- Teil 1: Live-Auswirkung der reinen Reparatur ---`);
console.log(`RISK_ACCOUNT_AGE_BONUS = ${bonusJetzt}`);
if (bonusJetzt === 0) {
  console.log('=> Der Faktor vergibt 0 Punkte. Die korrigierte Schaetzung aendert an keinem');
  console.log('   einzigen Risiko-Score etwas. Die Reparatur ist im Live-Betrieb wirkungslos');
  console.log('   - genau das ist beabsichtigt.');
} else {
  console.log(`=> ACHTUNG: Der Faktor ist aktiv (+${bonusJetzt}). Die Reparatur AENDERT das`);
  console.log('   Live-Verhalten. Teil 2 unten zeigt, wie stark.');
}

// --- Teil 2: Was waere, wenn? ---------------------------------------------
interface U { user_id: number; risk_score: number; status: string; has_username: number; has_profile_photo: number }

// Nur Nutzer, die in den letzten 90 Tagen tatsaechlich beigetreten sind -
// bei aelteren ist der gespeicherte Score durch Decay nicht mehr aussagekraeftig.
const kandidaten = db.prepare(`
  SELECT u.user_id, u.risk_score, u.status, u.has_username, u.has_profile_photo,
         MIN(j.joined_at) AS jat
  FROM users u
  JOIN joins j ON j.user_id = u.user_id
  WHERE j.joined_at >= ?
    AND date(j.joined_at/1000,'unixepoch') <> '2026-08-27'
    AND u.user_id > 0
  GROUP BY u.user_id
`).all(Date.now() - 90 * TAG) as (U & { jat: number })[];

const auffaellig = new Set<number>(
  (db.prepare(`SELECT user_id FROM scam_events
               UNION SELECT user_id FROM blacklist
               UNION SELECT user_id FROM escalations`).all() as { user_id: number }[]).map((r) => r.user_id)
);

console.log(`\n--- Teil 2: Wenn der Bonus eingeschaltet wuerde (n=${kandidaten.length} Beitritte, 90 Tage) ---`);
console.log('  Schwelle   Bonus   zusaetzlich    davon spaeter    davon UNBESCHOLTEN');
console.log('                     eingeschraenkt   auffaellig     (Fehlalarme)');

for (const schwelleTage of [90, 182, 365, 730]) {
  for (const bonus of [15, 30]) {
    let zusaetzlich = 0, davonAuffaellig = 0;
    for (const k of kandidaten) {
      const erstellt = estimateAccountCreatedAt(k.user_id);
      if (erstellt === null) continue;
      const alterBeiBeitritt = (k.jat - erstellt) / TAG;
      if (alterBeiBeitritt >= schwelleTage) continue;
      // Wuerde der Bonus diesen Nutzer ueber die Einschraenkungsschwelle heben?
      const vorher = k.risk_score;
      const nachher = vorher + bonus;
      if (vorher < RESTRICT_SCHWELLE && nachher >= RESTRICT_SCHWELLE) {
        zusaetzlich++;
        if (auffaellig.has(k.user_id)) davonAuffaellig++;
      }
    }
    const fehl = zusaetzlich - davonAuffaellig;
    const genauigkeit = zusaetzlich ? (100 * davonAuffaellig / zusaetzlich).toFixed(1) + ' %' : '-';
    console.log(
      `  ${String(schwelleTage).padStart(5)}d ${String(bonus).padStart(7)} ${String(zusaetzlich).padStart(14)}` +
      ` ${String(davonAuffaellig).padStart(14)} ${genauigkeit.padStart(8)} ${String(fehl).padStart(10)}`
    );
  }
}

// --- Teil 3: Wie sieht die Altersverteilung der Neuzugaenge aus? -----------
console.log('\n--- Teil 3: Altersverteilung der Beitritte (letzte 90 Tage) ---');
const eimer: Record<string, { n: number; a: number }> = {};
for (const k of kandidaten) {
  const erstellt = estimateAccountCreatedAt(k.user_id);
  if (erstellt === null) continue;
  const j = (k.jat - erstellt) / TAG / 365;
  const key = j < 0.25 ? 'a) unter 3 Monate'
    : j < 0.5 ? 'b) 3-6 Monate'
    : j < 1 ? 'c) 6-12 Monate'
    : j < 2 ? 'd) 1-2 Jahre'
    : j < 5 ? 'e) 2-5 Jahre' : 'f) ueber 5 Jahre';
  eimer[key] = eimer[key] || { n: 0, a: 0 };
  eimer[key].n++;
  if (auffaellig.has(k.user_id)) eimer[key].a++;
}
for (const key of Object.keys(eimer).sort()) {
  const e = eimer[key];
  console.log(`  ${key.padEnd(22)} ${String(e.n).padStart(5)}  davon auffaellig ${String(e.a).padStart(4)}  ${(100 * e.a / e.n).toFixed(1).padStart(5)} %`);
}

console.log('');
db.close();
