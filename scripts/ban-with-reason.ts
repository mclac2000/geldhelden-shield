/**
 * ban-with-reason.ts — Sperrt Konten mit ausdrücklichem, protokolliertem Grund.
 *
 * Für Fälle, die eindeutig sind, aber (noch) von keiner automatischen Regel
 * erfasst werden. Jede Sperre landet in `profile_events` mit dem Wortlaut der
 * Bio als Beleg und ist über `pardon_user:<id>` bzw. das `reverted`-Flag
 * rücknehmbar — dieselben Wege wie bei der automatischen Profilprüfung.
 *
 * Aufruf:
 *   npx ts-node scripts/ban-with-reason.ts "<Grund>" <userId> [<userId> ...]
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { Telegraf } from 'telegraf';
import { config } from '../src/config';
import { getDatabase, logProfileEvent } from '../src/db';

async function main(): Promise<void> {
  const [grund, ...rest] = process.argv.slice(2);
  const ids = rest.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!grund || ids.length === 0) {
    console.error('Aufruf: ban-with-reason.ts "<Grund>" <userId> [...]');
    process.exit(1);
  }

  const bot = new Telegraf(config.botToken);
  const { setBotInstance, banUserGlobally } = await import('../src/telegram');
  setBotInstance(bot);

  const db = getDatabase();
  console.log(`Sperre ${ids.length} Konten. Grund: ${grund}\n`);

  for (const userId of ids) {
    const info = db.prepare(`
      SELECT MAX(username) AS username,
             MAX(first_name) AS first_name,
             MAX(last_name) AS last_name
      FROM baseline_members WHERE user_id = ?
    `).get(userId) as any;
    const profil = db.prepare(
      'SELECT bio FROM user_profiles WHERE user_id = ?'
    ).get(userId) as any;

    const name = `${info?.first_name || ''} ${info?.last_name || ''}`.trim();
    const bio = profil?.bio ?? null;
    const belege = [
      `Anzeigename: ${name || '(keiner)'}`,
      bio ? `Bio im Wortlaut: ${bio}` : 'Bio: (leer oder nicht abrufbar)',
    ];

    // ERST protokollieren, DANN sperren — sonst fehlt der Beleg, falls die
    // Sperre mittendrin abbricht.
    logProfileEvent(userId, null, 'sperren', grund, belege, bio, info?.username ?? null);

    try {
      const r = await banUserGlobally(userId, grund);
      console.log(`${userId} @${info?.username || '-'} "${name}": in ${r.groups} Gruppen gesperrt`);
    } catch (e: any) {
      console.log(`${userId}: FEHLER ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\nFertig. Rücknahme: /pardon <userId> oder reverted-Flag in profile_events.');
  process.exit(0);
}

main().catch(e => { console.error('FEHLER:', e.message); process.exit(1); });
