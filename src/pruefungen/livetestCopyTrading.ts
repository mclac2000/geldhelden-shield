/**
 * livetestCopyTrading.ts — der Nachweis an echten Telegram-Nachrichten
 *
 *   docker exec geldhelden-shield-bot node /app/dist/pruefungen/livetestCopyTrading.js
 *
 * Was hier echt ist und was nicht — das gehört vor jedes Ergebnis:
 *
 *   ECHT: die Telegram-Gruppe, das Bild-Album aus zwei Fotos, die
 *         Bildunterschrift im Wortlaut, der ausgelieferte Erkenner im
 *         laufenden Container, die Löschaufrufe an die Telegram-API, die
 *         Sperre in allen bewachten Gruppen, die Zeile in der Datenbank.
 *
 *   NICHT ECHT: der Absender der Nachricht. Ein Bot kann keine Nachricht im
 *         Namen eines fremden Kontos schicken — also schickt der Bot sie
 *         selbst und der Erkenner wird mit dem Konto des echten Betrügers
 *         (8536848765 / @KryptoEuleStefanV7) darauf angesetzt. Das ist der
 *         einzige nachgestellte Teil, und er steht hier, damit niemand später
 *         mehr hineinliest, als gemessen wurde.
 *
 * Gegenprobe: drei echte Mitglieder-Sätze über Trading gehen denselben Weg,
 * als Nachrichten in derselben Gruppe, und müssen stehenbleiben. Sie laufen
 * unter einem Konto, über das nichts bekannt ist — also OHNE den
 * Mitgliedsrabatt. Wer so durchkommt, kommt als Mitglied erst recht durch.
 *
 * Geprüft wird nicht der Rückgabewert des Löschbefehls, sondern ob die
 * Nachricht danach noch da ist: Ein Weiterleitungsversuch auf eine gelöschte
 * Nachricht scheitert, auf eine vorhandene nicht.
 */

import { Telegraf } from 'telegraf';
import zlib from 'zlib';
import { config } from './../config';
import { setBotInstance } from './../telegram';
import { pruefeCopyTrading } from './../copyTradingGuard';

const TESTGRUPPE = process.env.LIVETEST_CHAT || config.adminLogChat;
const SCAM_KONTO = 8536848765;
const SCAM_KENNUNG = 'KryptoEuleStefanV7';
const UNBEKANNTES_KONTO = 990000001; // erfunden, damit kein echter Mensch berührt wird

const SCAM_UNTERSCHRIFT =
  'Best regards……I only listen to Suitable Win Trade\n' +
  '98% win rate in one month of copying his trades\n\n' +
  '@SuitableWinTrade';

const GEGENPROBEN = [
  'Ich habe gestern zum ersten Mal mit Hebel 3x gehandelt und prompt Verlust gemacht. Mache ich nicht nochmal.',
  'Wie versteuert man eigentlich Gewinne aus Krypto, wenn man in Thailand lebt? Mein BTC steht 40 % im Plus.',
  'Hat jemand Erfahrung mit BingX? Ich suche eine Börse, die auch ohne KYC funktioniert.',
];

// ---------------------------------------------------------------------------
// Ein gültiges PNG ohne Bildbibliothek. Zwei verschiedene Farben, damit die
// beiden Albumbilder unterscheidbar sind.
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(typ: string, daten: Buffer): Buffer {
  const laenge = Buffer.alloc(4);
  laenge.writeUInt32BE(daten.length);
  const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const pruefsumme = Buffer.alloc(4);
  pruefsumme.writeUInt32BE(crc32(koerper));
  return Buffer.concat([laenge, koerper, pruefsumme]);
}

function png(breite: number, hoehe: number, r: number, g: number, b: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8;  // Bittiefe
  ihdr[9] = 2;  // Farbtyp RGB
  const roh = Buffer.alloc(hoehe * (1 + breite * 3));
  let p = 0;
  for (let y = 0; y < hoehe; y++) {
    roh[p++] = 0; // Filter: keiner
    for (let x = 0; x < breite; x++) { roh[p++] = r; roh[p++] = g; roh[p++] = b; }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(roh)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

function baueKontext(bot: Telegraf, nachricht: any, absender: { id: number; username?: string; first_name: string }): any {
  return {
    telegram: bot.telegram,
    update: { message: nachricht },
    message: nachricht,
    chat: nachricht.chat,
    from: { ...absender, is_bot: false },
  };
}

/** Ist die Nachricht noch da? Gemessen, nicht geglaubt. */
async function nachrichtVorhanden(bot: Telegraf, chatId: string, messageId: number): Promise<boolean> {
  try {
    const kopie: any = await bot.telegram.copyMessage(chatId, chatId, messageId, { disable_notification: true } as any);
    // Die Probe hat eine Kopie erzeugt — die räumen wir sofort namentlich weg.
    if (kopie?.message_id) {
      await bot.telegram.deleteMessage(chatId, kopie.message_id).catch(() => undefined);
    }
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
  console.log('LIVETEST Copy-Trading — Auftrag #125');
  console.log('='.repeat(78));
  const gruppe: any = await bot.telegram.getChat(TESTGRUPPE);
  console.log(`Testgruppe:  ${gruppe.title} (${TESTGRUPPE})`);
  console.log(`Erkenner:    ${require.resolve('./../copyTradingRisk')}`);
  console.log(`Schalter:    Erkennung=${config.copyTradingCheckEnabled}, AutoSperre=${config.copyTradingAutoBan}`);

  // --- Wiederholungsbremse lösen -------------------------------------------
  // banUserGlobally überspringt Konten, die schon in fast allen Gruppen
  // gesperrt sind — eine Bremse gegen Flood-Limits, hier aber gerade das, was
  // die Messung stumm machen würde. Das Konto ist am 27.09. von Hand gesperrt
  // worden; die Sperren in Telegram bleiben davon unberührt, nur unser
  // Merkzettel wird zurückgesetzt, damit der automatische Weg wirklich läuft.
  const { removeFromBlacklist, isBlacklisted } = await import('./../db');
  const warGesperrt = isBlacklisted(SCAM_KONTO);
  if (warGesperrt) {
    removeFromBlacklist(SCAM_KONTO);
    console.log(`Hinweis:     Sperrvermerk für ${SCAM_KONTO} vorübergehend entfernt, damit die`);
    console.log(`             Wiederholungsbremse den automatischen Weg nicht überspringt.`);
  }

  // --- 1. Das Album -------------------------------------------------------
  console.log(`\n${'-'.repeat(78)}\n1. ECHTES ALBUM AUS ZWEI BILDERN, Unterschrift am ZWEITEN Bild\n${'-'.repeat(78)}`);

  const album: any[] = await bot.telegram.sendMediaGroup(TESTGRUPPE, [
    { type: 'photo', media: { source: png(360, 360, 30, 34, 44) } as any },
    { type: 'photo', media: { source: png(360, 360, 44, 34, 30) } as any, caption: SCAM_UNTERSCHRIFT },
  ] as any);

  console.log(`Gesendet: ${album.length} Nachrichten, media_group_id=${album[0].media_group_id}`);
  console.log(`  [1] msg=${album[0].message_id}  caption=${album[0].caption ? 'ja' : 'NEIN'}`);
  console.log(`  [2] msg=${album[1].message_id}  caption=${album[1].caption ? 'ja' : 'NEIN'}`);

  // Genau die Reihenfolge, in der Telegram sie ausliefert: erst das Bild ohne
  // Unterschrift. Wer nur auf die Unterschrift wartet, hat dieses Bild schon
  // verpasst.
  for (const [i, m] of album.entries()) {
    const ergebnis = await pruefeCopyTrading(baueKontext(bot, m, {
      id: SCAM_KONTO, username: SCAM_KENNUNG, first_name: 'KryptoEule',
    }));
    console.log(`  Nachricht ${i + 1} → ${ergebnis.massnahme.toUpperCase()}` +
                `${ergebnis.grund ? ' — ' + ergebnis.grund : ''}`);
  }

  // --- 2. Sind die Bilder wirklich weg? -----------------------------------
  console.log(`\n${'-'.repeat(78)}\n2. GEMESSEN, NICHT GEGLAUBT: sind die Nachrichten weg?\n${'-'.repeat(78)}`);
  for (const [i, m] of album.entries()) {
    const da = await nachrichtVorhanden(bot, TESTGRUPPE, m.message_id);
    console.log(`  ${da ? '❌' : '✅'} Bild ${i + 1} (msg ${m.message_id}): ${da ? 'STEHT NOCH DA' : 'gelöscht'}`);
    if (da) fehler.push(`Bild ${i + 1} wurde nicht gelöscht`);
  }

  // --- 3. Ist der Absender gesperrt? --------------------------------------
  console.log(`\n${'-'.repeat(78)}\n3. IST DAS KONTO GESPERRT?\n${'-'.repeat(78)}`);
  const { getBannedGroupCount, getManagedGroups } = await import('./../db');
  const gesperrtIn = getBannedGroupCount(SCAM_KONTO);
  const bewacht = getManagedGroups().length;
  const nunGesperrt = isBlacklisted(SCAM_KONTO);
  console.log(`  Sperrliste:  ${nunGesperrt ? '✅ eingetragen' : '❌ NICHT eingetragen'}`);
  console.log(`  Gruppen:     ${gesperrtIn} von ${bewacht} bewachten`);
  if (!nunGesperrt) fehler.push('Konto steht nicht auf der Sperrliste');
  if (gesperrtIn < 1) fehler.push('Konto in keiner Gruppe gesperrt');

  // --- 4. Gegenprobe ------------------------------------------------------
  console.log(`\n${'-'.repeat(78)}\n4. GEGENPROBE: drei echte Mitglieder-Sätze über Trading\n` +
              `   (unter einem Konto OHNE Mitgliedsrabatt — der strengere Fall)\n${'-'.repeat(78)}`);

  for (const [i, satz] of GEGENPROBEN.entries()) {
    const m: any = await bot.telegram.sendMessage(TESTGRUPPE, satz, { disable_notification: true } as any);
    const ergebnis = await pruefeCopyTrading(baueKontext(bot, m, {
      id: UNBEKANNTES_KONTO, first_name: 'Testkonto',
    }));
    const da = await nachrichtVorhanden(bot, TESTGRUPPE, m.message_id);
    const ok = ergebnis.massnahme === 'keine' && da;
    if (!ok) fehler.push(`Gegenprobe ${i + 1} hat angeschlagen (${ergebnis.massnahme})`);
    console.log(`\n  ${ok ? '✅' : '❌'} „${satz.substring(0, 82)}…"`);
    console.log(`     Urteil: ${ergebnis.massnahme.toUpperCase()}, Nachricht danach: ${da ? 'steht da' : 'WEG'}`);
    // Aufräumen: namentlich, nur die eine Nachricht, die dieses Skript angelegt hat.
    await bot.telegram.deleteMessage(TESTGRUPPE, m.message_id).catch(() => undefined);
  }

  // --- 5. Das Protokoll ---------------------------------------------------
  console.log(`\n${'-'.repeat(78)}\n5. PROTOKOLL in copy_trading_events\n${'-'.repeat(78)}`);
  const { getCopyTradingEvents } = await import('./../db');
  const zeilen = getCopyTradingEvents(5);
  if (!zeilen.length) fehler.push('keine Zeile in copy_trading_events');
  for (const z of zeilen) {
    console.log(`  ${new Date(z.created_at).toISOString().substring(0, 19)}  ${String(z.massnahme).padEnd(9)} ` +
                `${String(z.punkte).padStart(4)} Pkt  ${z.tragende_gruppen}/5  ` +
                `gelöscht=${z.geloeschte_nachrichten}  gesperrt=${z.gesperrt_in_gruppen} Gruppen  ` +
                `Unterschrift=${z.aus_bildunterschrift ? 'ja' : 'nein'}  ${z.chat_titel || ''}`);
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
  console.log('✅ LIVETEST BESTANDEN: Album erkannt, beide Bilder gelöscht, Konto gesperrt,');
  console.log('   drei echte Trading-Beiträge unangetastet, alles protokolliert.');
  process.exit(0);
}

main().catch(e => {
  console.error('LIVETEST abgebrochen:', e?.message || e);
  process.exit(1);
});
