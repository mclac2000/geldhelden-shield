/**
 * Einmalig (Auftrag Marco 27.11.2026): Ruslan (@ruslan_a_ma, 8677854959) war per Username-Ban
 * global gesperrt, weil vermutet wurde, er stecke hinter dem Konto "R" (7956759557). Fuer Ruslan
 * gibt es keinen Beleg -> Sperre komplett zuruecknehmen. "R" bleibt gesperrt.
 */
process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';
import { Telegraf } from 'telegraf';
import { config } from '../src/config';
import { getDatabase } from '../src/db';

const RUSLAN = 8677854959;
const R = 7956759557;

async function main(): Promise<void> {
  const db = getDatabase();
  const bot = new Telegraf(config.botToken);
  const { setBotInstance, unbanUserInAllGroups } = await import('../src/telegram');
  setBotInstance(bot);

  const tx = db.transaction(() => {
    const a = db.prepare('DELETE FROM blacklist WHERE user_id = ?').run(RUSLAN).changes;
    const b = db.prepare("DELETE FROM username_blacklist WHERE username = 'ruslan_a_ma'").run().changes;
    const c = db.prepare("DELETE FROM pending_username_blacklist WHERE username = 'ruslan_a_ma'").run().changes;
    const d = db.prepare("UPDATE users SET status = 'ok', is_observed = 0, username = COALESCE(username,'ruslan_a_ma'), has_username = 1 WHERE user_id = ?").run(RUSLAN).changes;
    console.log('DB: blacklist -' + a + ', username_blacklist -' + b + ', pending -' + c + ', users upd ' + d);
  });
  tx();

  const res = await unbanUserInAllGroups(RUSLAN, 'Sperre aufgehoben (Marco 27.11.2026): Verdacht ohne Beleg');
  console.log('Telegram-Unban: ' + JSON.stringify(res));

  const rStill = db.prepare('SELECT 1 FROM blacklist WHERE user_id = ?').get(R);
  console.log('R weiterhin auf Blacklist: ' + (rStill ? 'ja' : 'NEIN'));

  for (const chat of ['-1002865825213', '-1002712368584']) {
    try {
      const m = await bot.telegram.getChatMember(chat, RUSLAN);
      console.log('Status in ' + chat + ': ' + m.status);
    } catch (e: any) { console.log('Status in ' + chat + ': ' + e.message); }
    try {
      const m = await bot.telegram.getChatMember(chat, R);
      console.log('R in ' + chat + ': ' + m.status);
    } catch (e: any) { console.log('R in ' + chat + ': ' + e.message); }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
