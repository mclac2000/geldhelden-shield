/**
 * test-kanal-spam.ts — Simulation des Update-Handlers für Werbe-Spam
 *
 * Anlass 29.10.2026: Spam von „天赐代发…" in der Hauptgruppe wurde nicht entfernt, weil der
 * Scheinabsender 777000 in team_members stand (alle Prüfungen übersprungen).
 * Prüft pruefeFremdschrift() mit gespielten Updates gegen eine leere Wegwerf-Datenbank;
 * Telegram-Aufrufe sind Attrappen und werden aufgezeichnet.
 * Aufruf:  npx ts-node scripts/test-kanal-spam.ts
 * NICHT in `npm test`: das Host-Modul better-sqlite3 auf geldhelden-aps ist gegen eine andere Node-Version gebaut
 * (libnode.so.72) und kann keine Datenbank öffnen. Lauf im Bot-Image: siehe Commit 29.10.2026 / docker run --entrypoint sh geldheldenshield-bot.
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const dbDatei = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'sim-')), 'sim.db');
process.env.DB_PATH = dbDatei;
process.env.BOT_TOKEN = process.env.BOT_TOKEN || '1234567890:TEST_ATTRAPPE_KEIN_ECHTER_TOKEN';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '1';
process.env.ADMIN_LOG_CHAT = process.env.ADMIN_LOG_CHAT || '-100999';

const CHAT = '-1002854099024';
const SPAM = '天赐代发团队 🩵\n🚀 Telegram 社群推广引流 🚀\n👑天赐团队 Telegram 社群24小时自动推广引流服务…\n💎TG代发广告…\n⚠️极速代发…\n速度联系 @xxin7';
const DEUTSCH = '🚀 Hallo zusammen 👋 Das Meetup am Freitag ist klasse, Infos unter https://geldhelden.org/meetups 🙌 Fragen gern an @GeldheldenTeam';

interface Aufruf { was: string; arg?: any }

async function main() {
  const db = await import('../src/db');
  db.initDatabase();
  db.registerGroup(CHAT, 'Geldhelden – Gemeinschaft', 'managed');
  db.getDatabase().prepare('INSERT OR IGNORE INTO users (user_id, first_seen) VALUES (?,?)').run(777000, Date.now());
  db.getDatabase().prepare('INSERT OR IGNORE INTO team_members (user_id, added_by, added_at) VALUES (?,?,?)').run(777000, 382863507, Date.now()); // wie in der Produktion seit 12.01.2026
  if (!db.isTeamMember(777000)) { console.log('❌ Vorbedingung: 777000 nicht als Team eingetragen'); process.exit(1); }

  const tg: any = await import('../src/telegram');
  const aufrufe: Aufruf[] = [];
  tg.deleteMessage = async (c: string, m: number) => { aufrufe.push({ was: 'delete', arg: [c, m] }); return true; };
  tg.banUserGlobally = async (u: number) => { aufrufe.push({ was: 'banUser', arg: u }); return { success: true, groups: 5, skipped: false }; };
  tg.isUserAdminOrCreatorInGroup = async () => ({ isAdmin: false });

  const { pruefeFremdschrift, pruefeBeitrittsname } = await import('../src/fremdschriftGuard');

  const mkCtx = (from: any, msg: any): any => ({
    from, chat: { id: Number(CHAT), type: 'supergroup', title: 'T' },
    message: { message_id: 4711, message_thread_id: 3, ...msg },
    update: {},
    telegram: {
      botInfo: { id: 42 },
      getChat: async () => ({}),
      deleteMessage: async (c: any, m: number) => { aufrufe.push({ was: 'telegramDelete', arg: [c, m] }); return true; },
      callApi: async (m: string, p: any) => {
        aufrufe.push({ was: m, arg: p });
        if (m === 'forwardMessage') {
          if (p.message_id === 4715) return { message_id: 90003, forward_origin: { type: 'hidden_user', sender_user_name: 'x' }, via_bot: { id: 7, is_bot: true, username: 'Dhm_z_bot' }, text: '推广引流 代发广告 24小时' };
          if (p.message_id === 4716) return { message_id: 90004, forward_origin: { type: 'user', sender_user: { id: 42, is_bot: true, username: 'eigener_bot' } }, text: '推广引流 代发广告', reply_markup: { inline_keyboard: [[{ text: 'x', url: 'https://x.y' }]] } };
          return p.message_id === 4712
            ? { message_id: 90001, forward_origin: { type: 'user', sender_user: { id: 8000000001, is_bot: true, username: 'Dhm_x_bot' } }, text: '天赐代发团队 Telegram 社群推广引流 @xxin7', reply_markup: { inline_keyboard: [[{ text: '专业代发广告', url: 'https://t.me/xxin7' }]] } }
            : { message_id: 90002, forward_origin: { type: 'user', sender_user: { id: 123, is_bot: false, first_name: 'Rolf' } }, text: 'Danke euch!' };
        }
        return true;
      },
      sendMessage: async () => ({}),
    },
  });
  const mensch = (id: number, vor: string) => ({ id, is_bot: false, first_name: vor });

  const faelle: Array<{ was: string; ctx: any; geloescht: boolean; kanalGebannt?: boolean; nutzerGebannt?: boolean }> = [
    { was: 'Kanal-Beitrag via 777000 (Team-Eintrag!) mit Spam', ctx: mkCtx({ id: 777000, is_bot: false, first_name: 'Telegram' }, { text: SPAM, sender_chat: { id: -1009990001, type: 'channel', title: '天赐代发👉@xxin7👈Direct' } }), geloescht: true, kanalGebannt: true },
    { was: 'Kanal-Beitrag via Channel_Bot mit Spam', ctx: mkCtx({ id: 136817688, is_bot: true, first_name: 'Channel' }, { text: SPAM, sender_chat: { id: -1009990002, type: 'channel', title: 'Irgendwas' } }), geloescht: true, kanalGebannt: true },
    { was: 'Scheinabsender 777000 ohne sender_chat, Spam', ctx: mkCtx({ id: 777000, is_bot: false, first_name: 'Telegram' }, { text: SPAM }), geloescht: true },
    { was: 'Mensch mit Spam-Namen, Text harmlos-leer (nur Bild-Beschriftung)', ctx: mkCtx({ id: 8800000001, is_bot: false, first_name: '天赐代发👉@xxin7👈Direct🔺ad' }, { caption: 'Hallo' }), geloescht: true, nutzerGebannt: true },
    { was: 'Mensch mit Spam-Text (neues Konto)', ctx: mkCtx(mensch(8800000002, 'Li'), { text: SPAM }), geloescht: true, nutzerGebannt: true },
    { was: 'Anonymer Admin der Gruppe selbst (sender_chat = Gruppe)', ctx: mkCtx({ id: 1087968824, is_bot: true, first_name: 'Group' }, { text: SPAM, sender_chat: { id: Number(CHAT), type: 'supergroup', title: 'T' } }), geloescht: false },
    { was: 'Eigener Hauptkanal (Auto-Weiterleitung 777000)', ctx: mkCtx({ id: 777000, is_bot: false, first_name: 'Telegram' }, { text: SPAM, sender_chat: { id: -1001848781746, type: 'channel', title: 'Geldhelden' } }), geloescht: false },
    { was: 'Normales Mitglied, deutsch mit Emojis/Link', ctx: mkCtx(mensch(945531725, 'Rolf T.'), { text: DEUTSCH }), geloescht: false },
    { was: 'Normales Mitglied mit chinesischem Namen, deutscher Text', ctx: mkCtx(mensch(945531726, '李小明'), { text: DEUTSCH }), geloescht: false },
    { was: 'Kanal mit deutschem Text, harmlosem Namen', ctx: mkCtx({ id: 136817688, is_bot: true, first_name: 'Channel' }, { text: DEUTSCH, sender_chat: { id: -1009990003, type: 'channel', title: 'Freiheit Podcast' } }), geloescht: false },
    { was: 'Bot-Kette: nur @…bot-Erwähnungen (Gast-Bots)', ctx: mkCtx(mensch(5449050949, 'Sushil Kumar'), { text: '@Dhm_d161b2acbot  @Dhm_210e889cbot  @Dhm_83c549debot' }), geloescht: true, nutzerGebannt: true },
    { was: 'Mensch: eine Bot-Erwähnung im deutschen Satz', ctx: mkCtx(mensch(945531728, 'Karl'), { text: 'Nutzt dafür doch den @GeldheldenBot, der erklärt alles.' }), geloescht: false },
    { was: 'Mensch: zwei Bots, aber mit Erklärung', ctx: mkCtx(mensch(945531729, 'Uta'), { text: 'Ich nutze @GeldheldenBot und @wetter_bot jeden Tag, beide sind super und kostenlos.' }), geloescht: false },
    { was: 'Nachricht über Bot (via_bot) mit CJK-Text und URL-Tasten', ctx: mkCtx(mensch(8800000020, 'Max'), { text: '专业代发广告 推广引流', via_bot: { id: 1, is_bot: true, username: 'Dhm_y_bot' }, reply_markup: { inline_keyboard: [[{ text: '售卖广告群1000个30u', url: 'https://t.me/xxin7' }]] } }), geloescht: true, nutzerGebannt: true },
    { was: 'Mensch: deutscher Text mit URL-Taste (Bot-Post)', ctx: mkCtx(mensch(945531730, 'Eva'), { text: 'Hier der Link zur Anmeldung', reply_markup: { inline_keyboard: [[{ text: 'Zur Anmeldung', url: 'https://geldhelden.org/meetups' }]] } }), geloescht: false },
    { was: 'Spam NUR in URL-Tasten (Text harmlos)', ctx: mkCtx(mensch(8800000021, 'Lea'), { text: 'Hallo', reply_markup: { inline_keyboard: [[{ text: '售卖广告群1000个30u', url: 'https://t.me/xxin7' }], [{ text: '专业推广引流', url: 'https://t.me/xxin7' }]] } }), geloescht: true, nutzerGebannt: true },
    { was: 'Fremder Bot schreibt Spam (is_bot)', ctx: mkCtx({ id: 8000000002, is_bot: true, first_name: 'Dhm', username: 'Dhm_q_bot' }, { text: SPAM }), geloescht: true, nutzerGebannt: true },
    { was: 'Eigener Bot (id 42) schreibt Text', ctx: mkCtx({ id: 42, is_bot: true, first_name: 'Shield' }, { text: SPAM }), geloescht: false },
    { was: 'Mensch: nur Emoji', ctx: mkCtx(mensch(945531727, 'Anna'), { text: '👍👍' }), geloescht: false },
  ];

  const fehler: string[] = [];
  for (const f of faelle) {
    aufrufe.length = 0;
    const r = await pruefeFremdschrift(f.ctx);
    const geloescht = aufrufe.some(a => a.was === 'delete');
    const kanal = aufrufe.some(a => a.was === 'banChatSenderChat');
    const nutzer = aufrufe.some(a => a.was === 'banUser');
    const ok = geloescht === f.geloescht && (!!f.kanalGebannt === kanal) && (!!f.nutzerGebannt === nutzer);
    console.log(`${ok ? '✅' : '❌'} ${f.was}  → massnahme=${r.massnahme} geloescht=${geloescht} kanalBann=${kanal} nutzerBann=${nutzer}`);
    if (!ok) fehler.push(f.was);
  }

  // Aufräumen der Bot-Antworten hinter einem Auslöser (4711): nur ID 4712 ist Bot-Werbung
  aufrufe.length = 0;
  const { raeumeBotAntworten } = await import('../src/fremdschriftGuard');
  const n = await raeumeBotAntworten(mkCtx(mensch(1, 'x'), {}).telegram, CHAT, 4711, 5);
  const geloeschteIds = aufrufe.filter(a => a.was === 'telegramDelete' && String(a.arg[0]) === CHAT).map(a => a.arg[1]);
  const okRaeumen = n === 2 && geloeschteIds.length === 2 && geloeschteIds.includes(4712) && geloeschteIds.includes(4715);
  console.log(`${okRaeumen ? '✅' : '❌'} Bot-Antwort aufräumen: nur 4712 (Bot+Tasten) und 4715 (via_bot) gelöscht, 4713/4714 (Menschen) und 4716 (eigener Bot) nicht → gelöscht=${JSON.stringify(geloeschteIds)}`);
  if (!okRaeumen) fehler.push('Bot-Antworten aufräumen');

  // Beitritt mit Spam-Namen
  aufrufe.length = 0;
  const gebannt = await pruefeBeitrittsname(mkCtx(mensch(8800000009, 'x'), {}), 8800000009, CHAT, 'T', { firstName: '天赐代发👉@xxin7👈Direct' });
  const normal = await pruefeBeitrittsname(mkCtx(mensch(8800000010, 'x'), {}), 8800000010, CHAT, 'T', { firstName: 'Marco', lastName: 'Müller' });
  const cn = await pruefeBeitrittsname(mkCtx(mensch(8800000011, 'x'), {}), 8800000011, CHAT, 'T', { firstName: '李小明' });
  for (const [was, ist, soll] of [['Beitritt Spam-Name', gebannt, true], ['Beitritt deutscher Name', normal, false], ['Beitritt chinesischer Name', cn, false]] as Array<[string, boolean, boolean]>) {
    console.log(`${ist === soll ? '✅' : '❌'} ${was} → gesperrt=${ist}`);
    if (ist !== soll) fehler.push(was);
  }

  fs.rmSync(path.dirname(dbDatei), { recursive: true, force: true });
  if (fehler.length) { console.log(`\n❌ ${fehler.length} Abweichungen: ${fehler.join('; ')}`); process.exit(1); }
  console.log('\n✅ Alle Simulationsfälle wie erwartet.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
