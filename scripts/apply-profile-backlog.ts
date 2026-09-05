/**
 * apply-profile-backlog.ts — Wendet die Profilprüfung auf bereits bekannte
 * Bestandskonten an.
 *
 * Der laufende Bot prüft nur bei Beitritt und Nachricht. Konten, die schon
 * drin sind, würden nie geprüft. Dieses Skript reicht das für eine
 * ausdrücklich genannte Liste nach — durch DIESELBE Logik wie im Betrieb,
 * also mit Protokoll (profile_events), Meldung im Admin-Chat und
 * Rücknahmeknopf.
 *
 * Aufruf:  npx ts-node scripts/apply-profile-backlog.ts <userId> [<userId> ...]
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { Telegraf } from 'telegraf';
import { config } from '../src/config';
import { pruefeProfil } from '../src/profileGuard';
import { getDatabase } from '../src/db';

async function main(): Promise<void> {
  const ids = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (ids.length === 0) {
    console.error('Keine User-IDs angegeben.');
    process.exit(1);
  }

  const bot = new Telegraf(config.botToken);
  // Ohne das kann banUserGlobally() nicht sperren — im Betrieb erledigt das
  // index.ts beim Start, im Skript muss es hier passieren.
  const { setBotInstance } = await import('../src/telegram');
  setBotInstance(bot);

  console.log(`Nachträgliche Profilprüfung für ${ids.length} Konten`);
  console.log(`PROFILE_AUTO_BAN=${config.profileAutoBan} PROFILE_STRICT_MODE=${config.profileStrictMode}\n`);

  const db = getDatabase();
  const holeUsername = (id: number): string | null => {
    const r = db.prepare(
      'SELECT MAX(username) AS u FROM baseline_members WHERE user_id = ?'
    ).get(id) as any;
    return r?.u ?? null;
  };

  for (const userId of ids) {
    try {
      const username = holeUsername(userId);
      const r = await pruefeProfil(bot.telegram, userId, null, 'Bestandsprüfung', username, 'bestand');
      console.log(`${userId}: ${r.massnahme.toUpperCase()} ${r.grund || ''}`);
    } catch (e: any) {
      console.log(`${userId}: FEHLER ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\nFertig.');
  process.exit(0);
}

main().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
