/**
 * livetestFremdschrift.ts — Nachweis an echten Telegram-Nachrichten
 *
 *   docker exec geldhelden-shield-bot node /app/dist/pruefungen/livetestFremdschrift.js
 *
 * ECHT: Testgruppe (Shield-Logs), Nachrichten, ausgelieferter Erkenner im
 *       laufenden Container, Löschaufrufe, Sperre, Zeile in fremdschrift_events.
 * NICHT ECHT: der Absender. Der Bot schickt die Nachricht selbst, der Guard
 *       wird mit einer Absender-ID darauf angesetzt (wie livetestOtcAnkauf).
 *
 * Sperrweg am bereits gesperrten Betrugskonto 8536848765 (Copy-Trading,
 * 27.09.2026) — niemand wird neu betroffen. Gelöscht werden nur Nachrichten,
 * die dieses Skript selbst geschickt hat.
 */

import { Telegraf } from 'telegraf';
import { config } from './../config';
import { setBotInstance } from './../telegram';
import { pruefeFremdschrift, getFremdschriftEvents } from './../fremdschriftGuard';

const TESTGRUPPE = process.env.LIVETEST_CHAT || config.adminLogChat;
const ECHTES_BETRUGSKONTO = 8536848765;
const WEGWERF_KONTO = 8999000333;
const MITGLIED_KONTO = 8999000444;

const SPAM: Array<[string, string, number, boolean]> = [
  ['Original 12.10.2026', '今日由码徕收洣   @Dl88o', ECHTES_BETRUGSKONTO, true],
  ['Kyrillisch + Link', 'Удалённая работа! Заработок от 5000 руб в день, пиши в лс https://t.me/rabota_online', WEGWERF_KONTO, false],
  ['Homoglyphen + Kennung', 'Vеrdiеnе jеtzt 500€ pro Tаg mit Krypto, schrеib mir: @Profit_Coach_DE', WEGWERF_KONTO, false],
];

const GEGENPROBEN = [
  'War letzte Woche in Shanghai, die Leute sagen ständig 谢谢 – total freundlich dort.',
  'Hier in Tiflis spricht fast jeder Russisch. Ein "Спасибо" hilft beim Einkaufen enorm.',
  'Super Abend gestern beim Meetup 🎉🍻 Anmeldung fürs nächste Mal über @GeldheldenBot',
];

function kontext(bot: Telegraf, nachricht: any, userId: number, vorname: string): any {
  return { telegram: bot.telegram, update: { message: nachricht }, message: nachricht,
           chat: nachricht.chat, from: { id: userId, first_name: vorname, is_bot: false } };
}

async function nochDa(bot: Telegraf, chatId: string, messageId: number): Promise<boolean> {
  try {
    const k: any = await bot.telegram.copyMessage(chatId, chatId, messageId, { disable_notification: true } as any);
    if (k?.message_id) await bot.telegram.deleteMessage(chatId, k.message_id).catch(() => undefined);
    return true;
  } catch { return false; }
}

async function main(): Promise<void> {
  const fehler: string[] = [];
  const bot = new Telegraf(config.botToken);
  setBotInstance(bot);
  const gruppe: any = await bot.telegram.getChat(TESTGRUPPE);
  console.log('='.repeat(78));
  console.log(`LIVETEST Fremdschrift — Testgruppe: ${gruppe.title}`);
  console.log(`Schalter: Erkennung=${config.fremdschriftCheckEnabled}, AutoSperre=${config.fremdschriftAutoBan}`);
  const { removeFromBlacklist, isBlacklisted, getBannedGroupCount } = await import('./../db');

  for (const [name, text, konto, sperrePruefen] of SPAM) {
    if (sperrePruefen && isBlacklisted(konto)) removeFromBlacklist(konto);
    const m: any = await bot.telegram.sendMessage(TESTGRUPPE, text, { disable_notification: true } as any);
    const r = await pruefeFremdschrift(kontext(bot, m, konto, 'Fremdschrift-Test'));
    const da = await nochDa(bot, TESTGRUPPE, m.message_id);
    const gesperrt = isBlacklisted(konto);
    const gruppen = getBannedGroupCount(konto);
    console.log(`\n${name}\n  Urteil: ${r.massnahme.toUpperCase()} — ${r.grund}\n  Nachricht: ${da ? '❌ STEHT NOCH DA' : '✅ gelöscht'}` +
                (sperrePruefen ? `\n  Sperre: ${gesperrt ? '✅' : '❌'} (Gruppen: ${gruppen})` : ''));
    if (r.massnahme !== 'sperren') fehler.push(`${name}: Urteil ${r.massnahme}`);
    if (da) { fehler.push(`${name}: nicht gelöscht`); await bot.telegram.deleteMessage(TESTGRUPPE, m.message_id).catch(() => undefined); }
    if (sperrePruefen && (!gesperrt || gruppen < 1)) fehler.push(`${name}: Sperre nicht nachgewiesen`);
  }

  console.log(`\nGEGENPROBE`);
  for (const satz of GEGENPROBEN) {
    const m: any = await bot.telegram.sendMessage(TESTGRUPPE, satz, { disable_notification: true } as any);
    const r = await pruefeFremdschrift(kontext(bot, m, MITGLIED_KONTO, 'Mitglied-Test'));
    const da = await nochDa(bot, TESTGRUPPE, m.message_id);
    const ok = r.massnahme === 'keine' && da;
    if (!ok) fehler.push(`Gegenprobe angeschlagen: ${satz.substring(0, 40)} (${r.massnahme})`);
    console.log(`  ${ok ? '✅' : '❌'} ${r.massnahme.toUpperCase()} „${satz.substring(0, 60)}…" — ${da ? 'steht da' : 'WEG'}`);
    await bot.telegram.deleteMessage(TESTGRUPPE, m.message_id).catch(() => undefined);
  }
  if (isBlacklisted(MITGLIED_KONTO)) fehler.push('Gegenproben-Konto gesperrt');

  const zeilen = getFremdschriftEvents(5);
  console.log(`\nPROTOKOLL fremdschrift_events (letzte ${zeilen.length}):`);
  for (const z of zeilen) console.log(`  ${new Date(z.created_at).toISOString().substring(0, 19)} ${z.massnahme} ${z.schrift ?? '-'} durchgesetzt=${z.durchgesetzt} user=${z.user_id}`);
  if (!zeilen.some((z: any) => z.durchgesetzt === 1)) fehler.push('keine durchgesetzte Zeile protokolliert');

  console.log('\n' + '='.repeat(78));
  if (fehler.length) { console.log(`❌ LIVETEST NICHT BESTANDEN:\n${fehler.map(f => '   • ' + f).join('\n')}`); process.exit(1); }
  console.log('✅ LIVETEST BESTANDEN'); process.exit(0);
}

main().catch(e => { console.error('LIVETEST abgebrochen:', e?.message || e); process.exit(1); });
