/**
 * livetest-kodex.ts — Abnahme gegen das ECHTE Telegram, in einer Testgruppe (Standard: Admin-Log-Chat).
 *
 * Laeuft mit eigener, leerer Datenbank (keine Spuren in shield.db). Prueft mit echten API-Aufrufen:
 *   Willkommensnachricht mit Knopf (HTML, Erwaehnung), Knopf -> Umschalten auf "Kurz vorstellen" (URL-Knopf),
 *   Vorstellung -> Willkommensnachricht wird geloescht, Aufruf senden + still anpinnen, /melden sichert den
 *   Beleg per Weiterleitung und legt die Meldung mit Knoepfen vor, /werbung wirkt nur in der Testgruppe.
 * Raeumt seine Nachrichten am Ende wieder ab (Pin wird geloest).
 *
 * Aufruf (im Container):  npx ts-node --transpile-only scripts/livetest-kodex.ts [<testchat>]
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kodex-live-'));
process.env.DB_PATH = path.join(tmp, 'shield.db');
const TESTCHAT = process.argv[2] || process.env.ADMIN_LOG_CHAT || '';
process.env.KODEX_TESTCHAT = TESTCHAT;
process.env.KODEX_AKTIV = '';

import { Telegraf } from 'telegraf';
import { config } from '../src/config';
import { getDatabase } from '../src/db';
import * as K from '../src/meetupKodex';

const ergebnis: string[] = [];
const fehler: string[] = [];
const ok = (b: boolean, t: string) => { (b ? ergebnis : fehler).push((b ? '✅ ' : '❌ ') + t); };

async function main(): Promise<void> {
  const bot = new Telegraf(config.botToken);
  const { setBotInstance } = await import('../src/telegram');
  setBotInstance(bot);
  const tg: any = bot.telegram;
  getDatabase();
  const zuLoeschen: number[] = [];
  const me = await tg.getMe();
  const marco = { id: config.adminIds[0], first_name: 'R' }; // als "anonymes Konto" behandelt

  // Rechte des Bots in der Testgruppe
  const botMember: any = await tg.getChatMember(TESTCHAT, me.id);
  ok(botMember.status === 'administrator', `Bot ist Admin in der Testgruppe (${botMember.status})`);

  // 1. Direktbeitritt (Fallback): Einschraenkung schlaegt bei einem Admin erwartbar fehl; Kodex privat ODER 60-s-Hinweis
  await K.aufBeitritt(tg, TESTCHAT, marco);
  const db = getDatabase();
  let g = db.prepare('SELECT * FROM kodex_gate WHERE user_id = ? AND chat_id = ?').get(marco.id, TESTCHAT) as any;
  ok(!!g && g.anonym === 1, 'Direktbeitritt erfasst, Konto "R" als anonym erkannt');
  if (g?.gate_msg_id) zuLoeschen.push(g.gate_msg_id);

  // 2. Knopf "Ich stimme zu" privat (Antworten als Attrappe) -> Vorstellung -> Freischaltung
  const replies: string[] = [];
  const priv = (text: string): any => ({ from: marco, chat: { id: marco.id, type: 'private' }, telegram: tg,
    message: { text }, reply: async (t: string) => { replies.push(t); return { message_id: 0 }; } });
  const knopf: any = { from: marco, telegram: tg, chat: { id: marco.id, type: 'private' },
    callbackQuery: { data: 'kjr:' + TESTCHAT.replace('-', 'm'), message: { chat: { id: marco.id } } },
    answerCbQuery: async () => true, editMessageReplyMarkup: async () => true, reply: async (t: string) => { replies.push(t); return { message_id: 0 }; } };
  await K.behandlePrivatKnopf(knopf);
  ok(K.hatKodexBestaetigt(marco.id), 'Kodex-Bestätigung (privat) gespeichert');
  ok(await K.behandlePrivatVorstellung(priv('Livetest: Marco, GeldHelden-Gründer')), 'Vorstellung angenommen');
  g = db.prepare('SELECT * FROM kodex_gate WHERE user_id = ? AND chat_id = ?').get(marco.id, TESTCHAT) as any;
  ok(g?.status === 'frei', 'Direktbeitritt freigeschaltet');

  // 3. Beitrittsanfrage mit echtem Telegram: Link mit creates_join_request, Kodex privat an Marco, Genehmigen
  const link: any = await tg.createChatInviteLink(TESTCHAT, { name: 'Livetest Anfrage', creates_join_request: true });
  ok(!!link?.invite_link && link.creates_join_request === true, 'Einladungslink mit Beitrittsanfrage erzeugt');
  db.prepare('DELETE FROM kodex_bestaetigung WHERE user_id = ?').run(marco.id);
  const behandelt = await K.aufBeitrittsanfrage(tg, { chat: { id: Number(TESTCHAT) }, from: { id: marco.id, first_name: 'Marco', last_name: 'Livetest', username: 'mclac2000_test' }, user_chat_id: marco.id });
  const an = db.prepare('SELECT * FROM kodex_anfrage WHERE user_id = ? AND chat_id = ?').get(marco.id, TESTCHAT) as any;
  ok(behandelt && !!an, 'Anfrage erfasst (Status ' + an?.status + ')');
  ok(an?.status === 'offen' || an?.status === 'dm_fehler', 'Kodex privat zugestellt bzw. als nicht zustellbar vermerkt: ' + an?.status);
  if (an?.dm_msg_id) { try { await tg.deleteMessage(marco.id, an.dm_msg_id); } catch { /* egal */ } }
  replies.length = 0;
  await K.behandlePrivatKnopf(knopf);
  ok(replies.some((r) => /nicht mehr offen|bereits|freigeschaltet|gehakt/.test(r)), 'Genehmigen gegen echtes Telegram verarbeitet: ' + replies[0]);
  try { await tg.revokeChatInviteLink(TESTCHAT, link.invite_link); } catch { /* egal */ }

  // 4. Aufruf an Bestandsmitglieder
  const pin = await K.starteAufruf(tg, TESTCHAT);
  ok(pin === 'gepinnt', 'Aufruf gesendet und still angepinnt: ' + pin);
  const aufruf = db.prepare('SELECT * FROM kodex_aufruf WHERE chat_id = ?').get(TESTCHAT) as any;
  if (aufruf?.msg_id) zuLoeschen.push(aufruf.msg_id);
  // Frist kuenstlich ablaufen lassen -> Erinnerung
  db.prepare('UPDATE kodex_aufruf SET frist_at = ? WHERE chat_id = ?').run(Date.now() - 1000, TESTCHAT);
  const n = await K.erinnereFaelligeAufrufe(tg);
  ok(n === 1, 'Erinnerung nach Fristablauf gesendet');
  const er = db.prepare('SELECT erinnerung_msg_id FROM kodex_aufruf WHERE chat_id = ?').get(TESTCHAT) as any;
  if (er?.erinnerung_msg_id) zuLoeschen.push(er.erinnerung_msg_id);
  ok((await K.erinnereFaelligeAufrufe(tg)) === 0, 'Erinnerung kommt nur einmal');

  // 5. /melden auf eine (Bot-)Testnachricht, die einem erfundenen Mitglied zugeschrieben wird
  const test = await tg.sendMessage(TESTCHAT, '🧪 Livetest Kodex: Beispiel-Werbung „Investiere jetzt, 10 % im Monat“ (wird gleich gelöscht)');
  zuLoeschen.push(test.message_id);
  const fake = { id: 999000111, first_name: 'Testkonto', is_bot: false };
  const gruppe: any = { id: Number(TESTCHAT), type: 'supergroup', title: 'Testgruppe' };
  const kurz: string[] = [];
  const ctxGruppe = (from: any, text: string): any => ({
    from, chat: gruppe, telegram: tg, message: { text, reply_to_message: { message_id: test.message_id, from: fake, text: 'Investiere jetzt' } },
    reply: async (t: string) => { kurz.push(t); const m = await tg.sendMessage(TESTCHAT, t, { parse_mode: 'HTML' }); zuLoeschen.push(m.message_id); return m; },
    deleteMessage: async () => true,
  });
  await K.befehlMelden(ctxGruppe({ id: marco.id, first_name: 'Marco' }, '/melden Livetest'));
  const mel = db.prepare("SELECT * FROM meldungen WHERE herkunft = 'gruppe' ORDER BY id DESC LIMIT 1").get() as any;
  ok(!!mel && mel.gemeldet_id === fake.id, 'Meldung gespeichert (M' + (mel?.id ?? '?') + ')');
  ok(!!mel?.beleg_kopie_msg_id, 'Beleg in den Admin-Log weitergeleitet');

  // 6. /werbung als Antwort -> Stufe 2, wirkt nur in der Testgruppe
  await K.befehlVerwarnen(ctxGruppe({ id: marco.id, first_name: 'Marco' }, '/werbung Livetest'), 'werbung');
  const v = db.prepare('SELECT * FROM verwarnungen WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(fake.id) as any;
  ok(v?.stufe === 2 && v?.test === 1, 'Werbung -> Stufe 2, als Test markiert');
  ok(/1 Gruppe|0 Gruppe/.test(v?.massnahme_ergebnis || ''), 'Stummschaltung nur in der Testgruppe versucht: ' + v?.massnahme_ergebnis);

  // Aufraeumen
  try { await tg.unpinChatMessage(TESTCHAT, aufruf?.msg_id); } catch { /* egal */ }
  for (const id of zuLoeschen) { try { await tg.deleteMessage(TESTCHAT, id); } catch { /* evtl. schon geloescht */ } }

  console.log(ergebnis.concat(fehler).join('\n'));
  console.log(fehler.length ? `\n❌ ${fehler.length} Prüfung(en) rot` : '\n✅ Livetest grün');
  process.exit(fehler.length ? 1 : 0);
}
main().catch((e) => { console.error('❌ Livetest abgebrochen:', e?.message || e); process.exit(1); });
