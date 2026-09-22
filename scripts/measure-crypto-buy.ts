/**
 * measure-crypto-buy.ts — Wie viele ECHTE Nachrichten träfe die Regel zu Unrecht?
 *
 * Marcos Auflage: „Prüf die neue Regel gegen echte vergangene Nachrichten aus
 * den Gruppen und sag mir, wie viele davon fälschlich getroffen würden. Ohne
 * diese Zahl ist die Regel nicht fertig."
 *
 * ZUR GRUNDGESAMTHEIT — die Schwäche zuerst:
 * Shield speichert Nachrichtentexte erst seit dem 11.09.2026, und auch dann
 * nur die ersten fünf je Konto und Gruppe (first_message_samples). Ältere
 * Gruppennachrichten existieren nirgends. Die Messung läuft deshalb über
 * drei Quellen, die zusammen alles sind, was an echtem Text da ist:
 *
 *   A) first_message_samples — echte Gruppennachrichten seit 11.09.
 *   B) user_profiles.bio     — selbstgeschriebener Text echter Mitglieder
 *   C) meldungen.text        — von Menschen gemeldete Betrugsnachrichten
 *
 * Jede Zahl ist COUNT(DISTINCT user_id).
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { getDatabase, isTeamMember } from '../src/db';
import { bewerteKryptoAnkauf, entscheideKryptoAnkauf } from '../src/cryptoBuyRisk';

interface Treffer {
  quelle: string; userId: number; username: string | null;
  punkte: number; gruppen: number; massnahme: string;
  signale: string[]; text: string;
}

function bewerte(text: string) {
  const b = bewerteKryptoAnkauf(text);
  const u = entscheideKryptoAnkauf(b);
  return { punkte: b.punkte, gruppen: b.tragendeGruppen, massnahme: u.massnahme, signale: b.signale };
}

function main(): void {
  const db = getDatabase();
  const sperren: Treffer[] = [];
  const alarme: Treffer[] = [];
  let geprueft = 0;
  const konten = new Set<number>();

  const lauf = (quelle: string, zeilen: any[], textFeld: string) => {
    let n = 0;
    for (const z of zeilen) {
      const text = z[textFeld];
      if (!text || !String(text).trim()) continue;
      if (z.user_id && isTeamMember(z.user_id)) continue;
      n++; geprueft++;
      if (z.user_id) konten.add(z.user_id);
      const r = bewerte(String(text));
      if (r.massnahme === 'keine') continue;
      const t: Treffer = {
        quelle, userId: z.user_id ?? 0, username: z.username ?? null,
        punkte: r.punkte, gruppen: r.gruppen, massnahme: r.massnahme,
        signale: r.signale, text: String(text),
      };
      if (r.massnahme === 'sperren') sperren.push(t); else alarme.push(t);
    }
    console.log(`  ${quelle}: ${n} Texte geprüft`);
  };

  console.log('='.repeat(70));
  console.log('FEHLALARM-MESSUNG: Krypto-Ankauf-Regel gegen echte Texte');
  console.log('='.repeat(70) + '\n');

  const sicher = (sql: string): any[] => { try { return db.prepare(sql).all() as any[]; } catch { return []; } };

  lauf('A) Gruppennachrichten (seit 11.09.)',
    sicher('SELECT user_id, username, text FROM first_message_samples'), 'text');
  lauf('B) Profil-Bios',
    sicher(`SELECT p.user_id, MAX(b.username) AS username, p.bio
            FROM user_profiles p LEFT JOIN baseline_members b ON b.user_id = p.user_id
            WHERE p.bio IS NOT NULL AND p.bio != '' GROUP BY p.user_id`), 'bio');
  lauf('C) Gemeldete Betrugsnachrichten',
    sicher(`SELECT gemeldet_id AS user_id, gemeldet_username AS username, text
            FROM meldungen WHERE text IS NOT NULL AND text != ''`), 'text');

  console.log('\n' + '='.repeat(70));
  console.log('ERGEBNIS');
  console.log('='.repeat(70));
  console.log(`Geprüfte Texte insgesamt:        ${geprueft}`);
  console.log(`von verschiedenen Konten:        ${konten.size}`);
  console.log(`WÜRDEN ALS SPERRWÜRDIG GELTEN:   ${sperren.length}`);
  console.log(`Verdachtsmeldungen:              ${alarme.length}`);

  const zeig = (titel: string, liste: Treffer[]) => {
    console.log(`\n--- ${titel} (${liste.length}) ---`);
    for (const t of liste.slice(0, 25)) {
      console.log(`  ${t.punkte} P., ${t.gruppen}/4 | ${t.quelle} | ${t.userId} @${t.username || '-'}`);
      console.log(`     ${JSON.stringify(t.text.substring(0, 150))}`);
      console.log(`     ${t.signale.join(', ')}`);
    }
    if (liste.length === 0) console.log('  (keine)');
    if (liste.length > 25) console.log(`  … und ${liste.length - 25} weitere`);
  };

  zeig('WÜRDEN GESPERRT — jeder einzelne ist zu prüfen', sperren);
  zeig('NUR GEMELDET', alarme);

  console.log('\n' + '-'.repeat(70));
  console.log('WICHTIG ZUR DEUTUNG: Ein Treffer in Quelle C ist KEIN Fehlalarm —');
  console.log('das sind von Menschen gemeldete Betrugsnachrichten, dort ist ein');
  console.log('Treffer der gewünschte Fall. Fehlalarme sind nur A und B.');
  console.log('-'.repeat(70));

  const fehlalarmSperren = sperren.filter(t => !t.quelle.startsWith('C'));
  const fehlalarmAlarme = alarme.filter(t => !t.quelle.startsWith('C'));
  console.log(`\nFEHLALARME (A+B), Sperre:        ${fehlalarmSperren.length}`);
  console.log(`FEHLALARME (A+B), Meldung:       ${fehlalarmAlarme.length}`);
  console.log(`Richtige Treffer aus C:          ${sperren.filter(t => t.quelle.startsWith('C')).length} Sperren, ${alarme.filter(t => t.quelle.startsWith('C')).length} Meldungen`);

  process.exit(0);
}

main();
