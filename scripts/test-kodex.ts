/**
 * test-kodex.ts — Verhaltenskodex + Verwarnsystem der Meetup-Gruppen (27.11.2026)
 *
 * Aufruf:  npm run test:kodex
 * Echte (temporaere) SQLite-Datenbank, Telegram als Attrappe. Prueft:
 *   1. Gruppenauswahl: Meetup-Titel, Mapping, Lokalgruppen ja; Hauptchat, Inner Circle, aufgeloeste nein,
 *   2. ohne KODEX_AKTIV wirkt nichts ausser der Testgruppe,
 *   3. anonym-Erkennung ("R", Emoji, ohne @Name und ohne Bild),
 *   4. Direktbeitritt: stumm + Kodex privat (sonst 60-s-Hinweis mit kx_-Link); kein zweites Gate,
 *  8a. Beitrittsanfragen: Bots/Gesperrte abgelehnt, Bestaetigte sofort genehmigt, sonst Kodex privat ->
 *      genehmigt erst nach Knopf (anonym: nach Vorstellung), nach 48 Std. abgelehnt,
 *   5. Admins/Team werden nie eingeschraenkt (ausser in der Testgruppe),
 *   6. Knopf eines Fremden wirkt nicht; eigener Knopf -> Bestaetigung + Freischaltung + Gate geloescht,
 *   7. anonym: nach Knopf noch KEIN Schreibrecht, erst nach Vorstellung im Privatchat,
 *   8. bereits bestaetigt + nicht anonym -> beim naechsten Beitritt kein Gate,
 *   9. Stufen: verwarnen 0->1->2->3, Werbung 0->2, gemeinsame Zaehlung ueber Gruppen,
 *  10. /verwarnen ohne Antwort und ohne Meldungsnummer -> nichts passiert (kein Schritt ohne Beleg),
 *  11. /verwarnen von Nicht-Leiter -> nichts passiert,
 *  12. Stufe 2 schaltet in allen Meetup-Gruppen stumm, Testgruppe nur in der Testgruppe,
 *  13. Freischalten hebt eine laufende Stummschaltung NICHT auf.
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kodex-'));
process.env.DB_PATH = path.join(tmp, 'shield.db');
process.env.BOT_TOKEN = '123456:testtoken-nicht-echt';
process.env.ADMIN_LOG_CHAT = '-100999';
process.env.ADMIN_IDS = '1';
process.env.KODEX_AKTIV = '';
process.env.KODEX_TESTCHAT = '-100777';

import { getDatabase, addTeamMember, addToBlacklist } from '../src/db';
import * as K from '../src/meetupKodex';

const fehler: string[] = [];
const pruefe = (ok: boolean, text: string) => { if (!ok) fehler.push(text); };

// ---- Telegram-Attrappe ---------------------------------------------------------------------
type Aufruf = { m: string; a: any[] };
const aufrufe: Aufruf[] = [];
let msgId = 100;
const leiter = new Set<string>(); // `${chat}:${user}`
const dmGesperrt = new Set<number>();
const tg: any = new Proxy({}, {
  get: (_t, name: string) => async (...a: any[]) => {
    aufrufe.push({ m: name, a });
    if (name === 'getMe') return { id: 42, username: 'testbot' };
    if (name === 'getChatMember') return { status: leiter.has(`${a[0]}:${a[1]}`) ? 'administrator' : 'member' };
    if (name === 'getUserProfilePhotos') return { total_count: a[0] === 3003 ? 0 : 1 };
    if (name === 'sendMessage' && dmGesperrt.has(a[0])) throw new Error('403: Forbidden: bot can\'t initiate conversation with a user');
    if (name === 'sendMessage' || name === 'forwardMessage' || name === 'copyMessage') return { message_id: ++msgId };
    return true;
  },
});
const zaehle = (m: string, f?: (a: any[]) => boolean) => aufrufe.filter((x) => x.m === m && (!f || f(x.a))).length;
const reset = () => { aufrufe.length = 0; };

function ctxKnopf(from: any, chatId: string, data: string): any {
  const antworten: any[] = [];
  return {
    from, telegram: tg, callbackQuery: { data, message: { chat: { id: Number(chatId) } } },
    answerCbQuery: async (...a: any[]) => { antworten.push(a); }, antworten,
    editMessageReplyMarkup: async () => true,
  };
}
function ctxPrivKnopf(from: any, data: string): any {
  return {
    from, telegram: tg, chat: { id: from.id, type: 'private' }, callbackQuery: { data, message: { chat: { id: from.id } } },
    answerCbQuery: async () => true, editMessageReplyMarkup: async () => true,
    reply: async () => ({ message_id: ++msgId }),
  };
}
function ctxText(from: any, chat: any, text: string, reply?: any): any {
  const antworten: string[] = [];
  return {
    from, chat, telegram: tg, message: { text, message_id: ++msgId, reply_to_message: reply },
    reply: async (t: string) => { antworten.push(t); return { message_id: ++msgId }; },
    deleteMessage: async () => true, antworten,
  };
}

async function main(): Promise<void> {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS meetup_group_mapping (chat_id TEXT PRIMARY KEY, location TEXT NOT NULL)`);
  const gruppe = (id: string, title: string, status = 'managed') =>
    db.prepare('INSERT OR REPLACE INTO groups (chat_id, title, added_at, status) VALUES (?, ?, ?, ?)').run(id, title, Date.now(), status);
  gruppe('-1001', 'Geldhelden Meetup Düsseldorf');
  gruppe('-1002', 'Geldhelden - Köln und Umland');
  gruppe('-1003', 'Geldhelden Chat');
  gruppe('-1004', 'Geldhelden Inner Circle – Die Freiheits-Macher');
  gruppe('-1005', 'Ortsgruppe ohne Stichwort');
  db.prepare("INSERT INTO meetup_group_mapping VALUES ('-1005', 'Irgendwo')").run();
  gruppe('-1006', 'Geldhelden Meetup Alt', 'disabled');
  gruppe('-100777', 'Testgruppe Kodex');
  const neuerUser = (id: number, status = 'ok') => db.prepare('INSERT OR IGNORE INTO users (user_id, first_seen, status) VALUES (?, ?, ?)').run(id, Date.now(), status);
  [1, 2001, 2002, 3003, 4004, 5005, 6006].forEach((i) => neuerUser(i));

  // 1. Gruppenauswahl
  const ids = K.meetupGruppen().map((g) => g.chatId).sort();
  pruefe(JSON.stringify(ids) === JSON.stringify(['-1001', '-1002', '-1005']), '1: Gruppenauswahl falsch: ' + JSON.stringify(ids));

  // 2. ohne Schalter
  pruefe(!K.istKodexGruppe('-1001'), '2: ohne KODEX_AKTIV darf Meetup-Gruppe nicht aktiv sein');
  pruefe(K.istKodexGruppe('-100777'), '2: Testgruppe muss aktiv sein');
  reset();
  await K.aufBeitritt(tg, '-1001', { id: 2001, first_name: 'Anna', last_name: 'Muster', username: 'anna' });
  pruefe(zaehle('restrictChatMember') === 0, '2: ohne Schalter darf niemand eingeschraenkt werden');
  process.env.KODEX_AKTIV = '1';

  // 3. anonym
  pruefe(K.istAnonym({ first_name: 'R' }, true), '3: "R" muss anonym sein');
  pruefe(K.istAnonym({ first_name: '🦁✨' }, true), '3: Emoji-Name muss anonym sein');
  pruefe(K.istAnonym({ first_name: 'Ruslan' }, false), '3: ohne @Name und ohne Bild = anonym');
  pruefe(!K.istAnonym({ first_name: 'Ruslan' }, true), '3: Name + Bild = nicht anonym');
  pruefe(!K.istAnonym({ first_name: 'Ruslan', username: 'ruslan_x' }, false), '3: Name + @Name = nicht anonym');

  // 4. Direktbeitritt (Fallback): stumm + Kodex PRIVAT, keine Gruppennachricht; doppeltes Ereignis -> einmal
  reset();
  const anna = { id: 2001, first_name: 'Anna', last_name: 'Muster', username: 'anna' };
  await K.aufBeitritt(tg, '-1001', anna);
  await K.aufBeitritt(tg, '-1001', anna);
  pruefe(zaehle('restrictChatMember') === 1, '4: genau eine Einschraenkung erwartet, war ' + zaehle('restrictChatMember'));
  pruefe(zaehle('sendMessage', (a) => a[0] === 2001) === 1, '4: Kodex muss genau einmal privat kommen');
  pruefe(zaehle('sendMessage', (a) => String(a[0]) === '-1001') === 0, '4: keine Nachricht in der Gruppe, wenn privat moeglich');

  // 4b. Direktbeitritt, privat gesperrt -> kurze Gruppennachricht mit Deep-Link kx_
  reset();
  dmGesperrt.add(2002);
  await K.aufBeitritt(tg, '-1001', { id: 2002, first_name: 'Bob', username: 'bob' });
  const hinweis = aufrufe.find((x) => x.m === 'sendMessage' && String(x.a[0]) === '-1001');
  pruefe(!!hinweis && JSON.stringify(hinweis.a[2]).includes('start=kx_m1001'), '4b: Gruppenhinweis mit Deep-Link kx_ fehlt');
  dmGesperrt.delete(2002);

  // 5. Admin / Team
  reset();
  await K.aufBeitritt(tg, '-1001', { id: 1, first_name: 'Marco' });
  addTeamMember(6006, 1);
  await K.aufBeitritt(tg, '-1001', { id: 6006, first_name: 'Teamler' });
  leiter.add('-1001:5005');
  await K.aufBeitritt(tg, '-1001', { id: 5005, first_name: 'Gruppenleiter' });
  pruefe(zaehle('restrictChatMember') === 0, '5: Admin/Team/Gruppenleiter duerfen nie eingeschraenkt werden');
  await K.aufBeitritt(tg, '-100777', { id: 1, first_name: 'Marco', username: 'mclac' });
  pruefe(zaehle('restrictChatMember') === 1, '5: in der Testgruppe wird auch der Admin behandelt wie ein Mitglied');

  // 6. Knopf "Ich stimme zu" privat -> Bestaetigung + Freischaltung
  reset();
  const privKnopf = ctxPrivKnopf(anna, 'kjr:m1001');
  await K.behandlePrivatKnopf(privKnopf);
  pruefe(K.hatKodexBestaetigt(2001), '6: Bestaetigung fehlt');
  pruefe(zaehle('restrictChatMember', (a) => a[2]?.permissions?.can_send_messages === true) === 1, '6: Freischaltung fehlt');
  // Fremder Knopf in der Gruppe (alte Begruessungen) wirkt nicht
  reset();
  const fremd = ctxKnopf({ id: 2009, first_name: 'Fremd' }, '-1001', 'kodex_ja:2001');
  await K.behandleKodexKnopf(fremd);
  pruefe(!K.hatKodexBestaetigt(2009), '6: fremder Gruppenknopf darf nichts bewirken');

  // 7. anonym, Direktbeitritt: nach Knopf noch KEIN Schreibrecht, erst nach Vorstellung
  reset();
  const r = { id: 3003, first_name: 'R' };
  await K.aufBeitritt(tg, '-1002', r);
  await K.behandlePrivatKnopf(ctxPrivKnopf(r, 'kjr:m1002'));
  pruefe(zaehle('restrictChatMember', (a) => a[2]?.permissions?.can_send_messages === true) === 0, '7: anonym darf nach Knopf noch nicht schreiben');
  await K.behandlePrivatVorstellung(ctxText(r, { id: 3003, type: 'private' }, 'hi'));
  pruefe(zaehle('restrictChatMember', (a) => a[2]?.permissions?.can_send_messages === true) === 0, '7: zu kurze Vorstellung darf nicht freischalten');
  pruefe(await K.behandlePrivatVorstellung(ctxText(r, { id: 3003, type: 'private' }, 'Ich bin Rainer, kenne GeldHelden aus dem Newsletter')), '7: Vorstellung nicht angenommen');
  pruefe(zaehle('restrictChatMember', (a) => a[2]?.permissions?.can_send_messages === true) === 1, '7: nach Vorstellung keine Freischaltung');
  pruefe(zaehle('sendMessage', (a) => String(a[0]) === '-1002') === 0, '7: keine Vorstellungs-Nachricht in der Gruppe');
  pruefe(!(await K.behandlePrivatVorstellung(ctxText(r, { id: 3003, type: 'private' }, 'noch eine Nachricht'))), '7: danach muss der Privatchat wieder normal laufen');

  // 8. schon bestaetigt -> beim naechsten Direktbeitritt nichts
  reset();
  await K.aufBeitritt(tg, '-1005', anna);
  pruefe(zaehle('restrictChatMember') === 0, '8: bereits bestaetigt -> kein Gate in weiterer Gruppe');

  // 8a. BEITRITTSANFRAGEN
  reset();
  const anfrage = (u: any, chat = '-1001') => ({ chat: { id: Number(chat) }, from: u, user_chat_id: u.id, date: 0 });
  pruefe(!(await K.aufBeitrittsanfrage(tg, anfrage({ id: 7001, first_name: 'Gast' }, '-1003'))), '8a: Nicht-Meetup-Gruppe darf nicht behandelt werden');
  await K.aufBeitrittsanfrage(tg, anfrage({ id: 7002, first_name: 'Spam', is_bot: true }));
  pruefe(zaehle('declineChatJoinRequest', (a) => a[1] === 7002) === 1, '8a: Bot-Anfrage muss abgelehnt werden');
  neuerUser(7003); addToBlacklist(7003, 0, 'Betrug');
  await K.aufBeitrittsanfrage(tg, anfrage({ id: 7003, first_name: 'Betrueger' }));
  pruefe(zaehle('declineChatJoinRequest', (a) => a[1] === 7003) === 1, '8a: gesperrtes Konto muss abgelehnt werden');
  await K.aufBeitrittsanfrage(tg, anfrage(anna, '-1002'));
  pruefe(zaehle('approveChatJoinRequest', (a) => a[1] === 2001) === 1, '8a: bestaetigtes Konto sofort genehmigen');

  reset();
  const neu = { id: 7004, first_name: 'Neu', last_name: 'Mitglied', username: 'neu_m' };
  await K.aufBeitrittsanfrage(tg, anfrage(neu));
  const dm = aufrufe.find((x) => x.m === 'sendMessage' && x.a[0] === 7004);
  pruefe(!!dm && JSON.stringify(dm.a[2]).includes('kjr:m1001'), '8a: Kodex privat mit Knopf fehlt');
  pruefe(zaehle('approveChatJoinRequest') === 0, '8a: vor Bestaetigung darf nicht genehmigt werden');
  pruefe(zaehle('sendMessage', (a) => String(a[0]) === '-1001') === 0, '8a: keine Gruppennachricht bei Anfrage');
  await K.behandlePrivatKnopf(ctxPrivKnopf(neu, 'kjr:m1001'));
  pruefe(zaehle('approveChatJoinRequest', (a) => a[1] === 7004) === 1, '8a: nach Knopf genehmigen');
  // danach Beitritt -> kein Gate mehr
  reset();
  await K.aufBeitritt(tg, '-1001', neu);
  pruefe(zaehle('restrictChatMember') === 0 && zaehle('sendMessage') === 0, '8a: nach genehmigter Anfrage kein Gate beim Beitritt');

  // anonyme Anfrage: Knopf -> Vorstellung -> genehmigen
  reset();
  const anon = { id: 3003 + 5000, first_name: 'X' };
  await K.aufBeitrittsanfrage(tg, anfrage(anon));
  await K.behandlePrivatKnopf(ctxPrivKnopf(anon, 'kjr:m1001'));
  pruefe(zaehle('approveChatJoinRequest') === 0, '8a: anonym nach Knopf noch nicht genehmigen');
  await K.behandlePrivatVorstellung(ctxText(anon, { id: anon.id, type: 'private' }, 'Xaver, über das Webinar zu GeldHelden gekommen'));
  pruefe(zaehle('approveChatJoinRequest', (a) => a[1] === anon.id) === 1, '8a: anonym nach Vorstellung genehmigen');

  // 48 Std. ohne Antwort -> ablehnen; DM nicht moeglich -> trotzdem nach 48 Std. ablehnen
  reset();
  dmGesperrt.add(7006);
  await K.aufBeitrittsanfrage(tg, anfrage({ id: 7005, first_name: 'Schlaefer', username: 'zzz' }));
  await K.aufBeitrittsanfrage(tg, anfrage({ id: 7006, first_name: 'Stumm', username: 'stumm' }));
  const st = getDatabase().prepare("SELECT status FROM kodex_anfrage WHERE user_id = 7006").get() as any;
  pruefe(st?.status === 'dm_fehler', '8a: DM-Fehler nicht vermerkt: ' + st?.status);
  getDatabase().prepare('UPDATE kodex_anfrage SET created_at = ? WHERE user_id IN (7005, 7006)').run(Date.now() - 49 * 3600000);
  const ab = await K.lehneAbgelaufeneAb(tg);
  pruefe(ab.abgelehnt === 2 && zaehle('declineChatJoinRequest') === 2, '8a: nach 48 Std. muss abgelehnt werden: ' + JSON.stringify(ab));
  dmGesperrt.delete(7006);

  // 9.-12. Stufen
  pruefe(K.naechsteStufe(0, 'verwarnung') === 1 && K.naechsteStufe(1, 'verwarnung') === 2 && K.naechsteStufe(2, 'verwarnung') === 3 && K.naechsteStufe(3, 'verwarnung') === 3, '9: Stufenfolge Verwarnung');
  pruefe(K.naechsteStufe(0, 'werbung') === 2 && K.naechsteStufe(2, 'werbung') === 3, '9: Werbung startet bei 2');

  leiter.add('-1001:5005');
  leiter.add('-1002:5005');
  const host = { id: 5005, first_name: 'Host' };
  const bob = { id: 2002, first_name: 'Bob', username: 'bob' };

  reset();
  const ohneBeleg = ctxText(host, { id: -1001, type: 'supergroup', title: 'X' }, '/verwarnen Spam');
  await K.befehlVerwarnen(ohneBeleg, 'verwarnung');
  pruefe(K.aktuelleStufe(2002) === 0, '10: ohne Beleg darf keine Verwarnung entstehen');

  const nichtLeiter = ctxText({ id: 4004, first_name: 'Eve' }, { id: -1001, type: 'supergroup', title: 'X' }, '/verwarnen', { message_id: 7, from: bob, text: 'kauf mein Coin' });
  await K.befehlVerwarnen(nichtLeiter, 'verwarnung');
  pruefe(K.aktuelleStufe(2002) === 0, '11: Nicht-Leiter darf nicht verwarnen');

  const v1 = ctxText(host, { id: -1001, type: 'supergroup', title: 'X' }, '/verwarnen unfreundlich', { message_id: 8, from: bob, text: 'blabla' });
  await K.befehlVerwarnen(v1, 'verwarnung');
  pruefe(K.aktuelleStufe(2002) === 1, '9: nach erster Verwarnung Stufe 1 erwartet, ist ' + K.aktuelleStufe(2002));
  pruefe(zaehle('forwardMessage', (a) => a[0] === '-100999') >= 1, '9: Beleg wurde nicht in den Admin-Log weitergeleitet');

  reset();
  const v2 = ctxText(host, { id: -1002, type: 'supergroup', title: 'Y' }, '/verwarnen nochmal', { message_id: 9, from: bob, text: 'blabla 2' });
  await K.befehlVerwarnen(v2, 'verwarnung');
  pruefe(K.aktuelleStufe(2002) === 2, '9: gemeinsame Zaehlung ueber Gruppen – Stufe 2 erwartet');
  const stumm = aufrufe.filter((x) => x.m === 'restrictChatMember' && x.a[1] === 2002 && x.a[2]?.until_date).map((x) => x.a[0]).sort();
  pruefe(JSON.stringify(stumm) === JSON.stringify(['-1001', '-1002', '-1005']), '12: Stufe 2 muss in allen Meetup-Gruppen stummschalten: ' + JSON.stringify(stumm));

  // 13. Freischalten hebt Stummschaltung nicht auf
  reset();
  db.prepare("INSERT OR REPLACE INTO kodex_gate (user_id, chat_id, created_at, status, eingeschraenkt) VALUES (2002, '-1001', ?, 'offen', 1)").run(Date.now());
  await K.behandleKodexKnopf(ctxKnopf(bob, '-1001', 'kodex_ja:2002'));
  pruefe(zaehle('restrictChatMember', (a) => a[2]?.permissions?.can_send_messages === true) === 0, '13: Freischaltung darf Stummschaltung nicht aufheben');

  // Werbung direkt Stufe 2 bei neuem Konto, ueber Meldungsnummer
  reset();
  const mid = (db.prepare(`INSERT INTO meldungen (created_at, melder_id, gemeldet_id, gemeldet_name, herkunft, text)
    VALUES (?, 2001, 4004, 'Eve', 'kennung', 'Investiere jetzt 10 % pro Monat')`).run(Date.now())).lastInsertRowid;
  const w = ctxText(host, { id: 5005, type: 'private' }, `/werbung M${mid} DM-Angebot`);
  await K.befehlVerwarnen(w, 'werbung');
  pruefe(K.aktuelleStufe(4004) === 2, '9: Werbung mit Meldung muss bei Stufe 2 starten, ist ' + K.aktuelleStufe(4004));

  // Testgruppe: Strafe nur dort und getrennt gezaehlt
  reset();
  const t1 = ctxText({ id: 1, first_name: 'Marco' }, { id: -100777, type: 'supergroup', title: 'T' }, '/werbung test', { message_id: 11, from: { id: 6006, first_name: 'Teamler' }, text: 'Werbung' });
  await K.befehlVerwarnen(t1, 'werbung');
  const tStumm = aufrufe.filter((x) => x.m === 'restrictChatMember' && x.a[2]?.until_date).map((x) => x.a[0]);
  pruefe(JSON.stringify(tStumm) === JSON.stringify(['-100777']), '12: Testgruppe darf nur in der Testgruppe wirken: ' + JSON.stringify(tStumm));
  pruefe(K.aktuelleStufe(6006) === 0, '12: Test-Verwarnungen duerfen die echte Zaehlung nicht beruehren');
  pruefe(zaehle('banChatMember') === 0, '12: keine Sperre in Stufe 2');

  if (fehler.length) {
    console.error('❌ test-kodex: ' + fehler.length + ' Fehler\n - ' + fehler.join('\n - '));
    process.exit(1);
  }
  console.log('✅ test-kodex: alle Prüfungen grün');
  process.exit(0);
}
main().catch((e) => { console.error('❌ test-kodex abgebrochen:', e); process.exit(1); });
