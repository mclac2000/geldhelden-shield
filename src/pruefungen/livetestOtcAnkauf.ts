/**
 * livetestOtcAnkauf.ts — der Nachweis an echten Telegram-Nachrichten
 *
 *   docker exec geldhelden-shield-bot node /app/dist/pruefungen/livetestOtcAnkauf.js
 *
 * Was echt ist und was nicht — das gehört vor jedes Ergebnis:
 *
 *   ECHT: die Telegram-Gruppe, die Nachrichten, der ausgelieferte Erkenner im
 *         laufenden Container, die Löschaufrufe an die Telegram-API, die
 *         Sperre in allen bewachten Gruppen, die Zeile in crypto_events.
 *
 *   NICHT ECHT: der Absender. Ein Bot kann keine Nachricht im Namen eines
 *         fremden Kontos schicken — also schickt der Bot sie selbst, und der
 *         Erkenner wird mit einer Wegwerf-Kennung darauf angesetzt. Das steht
 *         hier, damit niemand später mehr hineinliest als gemessen wurde.
 *
 * Geprüft wird nicht der Rückgabewert des Löschbefehls, sondern ob die
 * Nachricht danach noch da ist.
 */

import { Telegraf } from 'telegraf';
import { config } from './../config';
import { setBotInstance } from './../telegram';
import { pruefeKryptoAnkauf } from './../cryptoBuyGuard';

const TESTGRUPPE = process.env.LIVETEST_CHAT || config.adminLogChat;

/**
 * Wegwerf-Kennung für den Scam-Teil. Eine erfundene, sehr hohe User-ID: Sie
 * gehört keinem Menschen, und eine Sperre darauf schadet niemandem. Der Preis
 * dafür ist, dass Telegram die Sperre in den meisten Gruppen ablehnt — was
 * genau deshalb hier KEIN Fehlschlag ist. Gemessen wird die Löschung und der
 * Eintrag auf der Sperrliste, nicht die Zahl der Gruppen.
 */
const WEGWERF_KONTO = 8999000111;
const MITGLIED_KONTO = 8999000222;

const ORIGINAL = `I am from China. 💵💵💵❤️❤️❤️💵💵
My company is engaged in international trade. Many of our overseas partners need to use USDT for payments to avoid tariffs. However, due to Chinese policy restrictions on large-scale purchases, we are unable to buy USDT in bulk through standard channels; consequently, we have to acquire it at prices 5%–20% above the market rate.
(We offer the best rates and the most secure transaction methods available.)
Once we confirm you hold the USDT, we will make the payment first, and then you transfer the USDT to us.
If you are a seller looking to sell USDT,
please contact me 👉 Telegram: @YLPAY618`;

const VARIANTE_DEUTSCH =
  'Guten Tag. Unsere Handelsgesellschaft benötigt laufend USDT für Zahlungen an Lieferanten in Asien, um Zölle zu vermeiden. ' +
  'Wegen behördlicher Beschränkungen können wir nicht über die üblichen Börsen kaufen und zahlen deshalb 8 % über dem Marktpreis. ' +
  'Wir überweisen zuerst, Sie senden die Coins danach. Wer USDT verkaufen möchte, schreibt mir bitte direkt: @otc_ankauf_eu';

const GEGENPROBEN = [
  'Ich möchte einen Teil meiner USDT verkaufen. Wo bekommt man aktuell den besten Kurs, ohne viel Gebühren zu zahlen?',
  'Weiß jemand, wie das steuerlich läuft, wenn eine Firma in Asien in USDT bezahlt? Fallen da Zölle oder Einfuhrabgaben an?',
  'Der USDT-Kurs lag heute kurz 2 % über dem Marktpreis auf der kleinen Börse. Arbitrage lohnt sich bei den Gebühren aber nicht.',
  'Wir überlegen, als Familie eine größere Menge Bitcoin zu kaufen. Lieber in Tranchen oder auf einmal? 💵',
  'OTC heißt einfach, dass man außerhalb der Börse direkt mit einer Gegenpartei handelt. Bei großen Summen ist das üblich und völlig legal.',
];

function kontext(bot: Telegraf, nachricht: any, userId: number, vorname: string): any {
  return {
    telegram: bot.telegram,
    update: { message: nachricht },
    message: nachricht,
    chat: nachricht.chat,
    from: { id: userId, first_name: vorname, is_bot: false },
  };
}

/** Ist die Nachricht noch da? Gemessen, nicht geglaubt. */
async function nochDa(bot: Telegraf, chatId: string, messageId: number): Promise<boolean> {
  try {
    const kopie: any = await bot.telegram.copyMessage(chatId, chatId, messageId, { disable_notification: true } as any);
    if (kopie?.message_id) await bot.telegram.deleteMessage(chatId, kopie.message_id).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const fehler: string[] = [];
  const bot = new Telegraf(config.botToken);
  setBotInstance(bot);

  console.log('='.repeat(78));
  console.log('LIVETEST OTC-/USDT-Ankauf — Auftrag #275');
  console.log('='.repeat(78));
  const gruppe: any = await bot.telegram.getChat(TESTGRUPPE);
  console.log(`Testgruppe: ${gruppe.title} (${TESTGRUPPE})`);
  console.log(`Erkenner:   ${require.resolve('./../cryptoBuyRisk')}`);
  console.log(`Schalter:   Erkennung=${config.cryptoBuyCheckEnabled}, AutoSperre=${config.cryptoBuyAutoBan}`);

  const { removeFromBlacklist, isBlacklisted, getBannedGroupCount } = await import('./../db');

  // --- 1. Der Originaltext und die deutsche Variante -----------------------
  const scamFaelle: Array<[string, string]> = [
    ['Originaltext (englisch, mit Emoji-Kette)', ORIGINAL],
    ['Variante auf Deutsch', VARIANTE_DEUTSCH],
  ];

  for (const [name, text] of scamFaelle) {
    console.log(`\n${'-'.repeat(78)}\n${name}\n${'-'.repeat(78)}`);
    // Sperrvermerk zurücksetzen, damit die Wiederholungsbremse den
    // automatischen Weg nicht überspringt.
    if (isBlacklisted(WEGWERF_KONTO)) removeFromBlacklist(WEGWERF_KONTO);

    const m: any = await bot.telegram.sendMessage(TESTGRUPPE, text, { disable_notification: true } as any);
    console.log(`  gesendet: msg=${m.message_id}`);

    const r = await pruefeKryptoAnkauf(kontext(bot, m, WEGWERF_KONTO, 'OTC-Testkonto'));
    const da = await nochDa(bot, TESTGRUPPE, m.message_id);
    const gesperrt = isBlacklisted(WEGWERF_KONTO);

    console.log(`  Urteil:        ${r.massnahme.toUpperCase()}${r.grund ? ' — ' + r.grund : ''}`);
    console.log(`  Nachricht:     ${da ? '❌ STEHT NOCH DA' : '✅ gelöscht'}`);
    console.log(`  Sperrliste:    ${gesperrt ? '✅ eingetragen' : '❌ nicht eingetragen'}` +
                `  (Gruppen: ${getBannedGroupCount(WEGWERF_KONTO)})`);

    if (r.massnahme !== 'sperren' && r.massnahme !== 'loeschen') fehler.push(`${name}: Urteil ${r.massnahme}`);
    if (da) { fehler.push(`${name}: Nachricht wurde nicht gelöscht`); await bot.telegram.deleteMessage(TESTGRUPPE, m.message_id).catch(() => undefined); }
    if (r.massnahme === 'sperren' && !gesperrt) fehler.push(`${name}: Konto nicht gesperrt`);
  }

  // --- 2. Gegenprobe ------------------------------------------------------
  console.log(`\n${'-'.repeat(78)}\nGEGENPROBE: fünf normale Club-Nachrichten zu Krypto\n` +
              `(unter einem Konto OHNE Mitgliedsrabatt — der strengere Fall)\n${'-'.repeat(78)}`);

  for (const [i, satz] of GEGENPROBEN.entries()) {
    const m: any = await bot.telegram.sendMessage(TESTGRUPPE, satz, { disable_notification: true } as any);
    const r = await pruefeKryptoAnkauf(kontext(bot, m, MITGLIED_KONTO, 'Mitglied-Testkonto'));
    const da = await nochDa(bot, TESTGRUPPE, m.message_id);
    const ok = r.massnahme === 'keine' && da;
    if (!ok) fehler.push(`Gegenprobe ${i + 1} hat angeschlagen (${r.massnahme}, Nachricht ${da ? 'da' : 'WEG'})`);
    console.log(`\n  ${ok ? '✅' : '❌'} „${satz.substring(0, 78)}…"`);
    console.log(`     Urteil: ${r.massnahme.toUpperCase()}, Nachricht danach: ${da ? 'steht da' : 'WEG'}`);
    // Namentlich aufräumen: nur die Nachricht, die dieses Skript angelegt hat.
    await bot.telegram.deleteMessage(TESTGRUPPE, m.message_id).catch(() => undefined);
  }

  if (isBlacklisted(MITGLIED_KONTO)) fehler.push('Das Gegenproben-Konto wurde gesperrt — das darf nie passieren');

  // --- 3. Protokoll -------------------------------------------------------
  console.log(`\n${'-'.repeat(78)}\nPROTOKOLL in crypto_events\n${'-'.repeat(78)}`);
  const { getCryptoEvents } = await import('./../db');
  const zeilen = getCryptoEvents(5);
  for (const z of zeilen) {
    console.log(`  ${new Date(z.created_at).toISOString().substring(0, 19)}  ${String(z.massnahme).padEnd(9)} ` +
                `${String(z.punkte).padStart(4)} Pkt  ${z.tragende_gruppen}/6  ` +
                `${z.durchgesetzt ? 'durchgesetzt' : 'nur gemeldet'}  user=${z.user_id}`);
  }
  const durchgesetzt = zeilen.filter((z: any) => z.durchgesetzt === 1).length;
  console.log(`  durchgesetzte Zeilen unter den letzten 5: ${durchgesetzt}`);
  if (durchgesetzt < 1) fehler.push('keine durchgesetzte Zeile protokolliert');

  console.log(`\n${'='.repeat(78)}`);
  if (fehler.length) {
    console.log(`❌ LIVETEST NICHT BESTANDEN — ${fehler.length} Punkt(e):`);
    for (const f of fehler) console.log(`   • ${f}`);
    process.exit(1);
  }
  console.log('✅ LIVETEST BESTANDEN: Original und deutsche Variante erkannt und gelöscht,');
  console.log('   Absender gesperrt, fünf normale Krypto-Nachrichten unangetastet, protokolliert.');
  process.exit(0);
}

main().catch(e => {
  console.error('LIVETEST abgebrochen:', e?.message || e);
  process.exit(1);
});
