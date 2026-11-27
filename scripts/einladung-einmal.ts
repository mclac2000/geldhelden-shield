/** Einmal-Einladungslink (1 Person, 7 Tage) fuer eine Gruppe. Aufruf: einladung-einmal.ts <chatId> <name> */
process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';
import { Telegraf } from 'telegraf';
import { config } from '../src/config';
async function main() {
  const [chat, name] = process.argv.slice(2);
  const bot = new Telegraf(config.botToken);
  const l = await bot.telegram.createChatInviteLink(chat, { name: name, member_limit: 1, expire_date: Math.floor(Date.now() / 1000) + 7 * 86400 });
  console.log(chat + ' ' + l.invite_link);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
