/**
 * fremdschriftGuard.ts — Durchsetzung der Fremdschrift-Erkennung
 *
 * Gleiche Logik wie copyTradingGuard.ts, gleiche Ausnahmen, gleiche drei
 * Stufen:
 *   sperren  = löschen und global sperren (rückholbar per Knopf)
 *   loeschen = löschen und vorlegen
 *   melden   = nur vorlegen, nichts angefasst
 *
 * Ausgenommen sind — vor jeder Bewertung — geschützte Konten, Bot-Admins,
 * Team-Mitglieder, Identitäts-Ausnahmen und Admins der jeweiligen Gruppe.
 * Ein eingesessenes Mitglied (≥ 20 Nachrichten in der Gruppe) wird höchstens
 * gemeldet.
 *
 * Jede Bewertung mit Befund steht in fremdschrift_events — auch die, bei denen
 * nichts getan wurde. Daran lässt sich später nachrechnen, ob die Schwelle
 * richtig steht.
 */

import { Context } from 'telegraf';
import { config } from './config';
import { bewerteFremdschrift, bewerteAnzeigename, bewerteBotKette, entscheideFremdschrift, FremdschriftMassnahme, schriftName } from './fremdschriftRisk';
import type { Absender } from './copyTradingRisk';

export interface FremdschriftErgebnis {
  massnahme: FremdschriftMassnahme;
  grund: string;
  erledigt: boolean;
}

const KEINE: FremdschriftErgebnis = { massnahme: 'keine', grund: '', erledigt: false };

// ---------------------------------------------------------------------------
// Protokoll
// ---------------------------------------------------------------------------

let tabelleDa = false;
function tabelle(): any {
  const { getDatabase } = require('./db');
  const db = getDatabase();
  if (!tabelleDa) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fremdschrift_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        chat_id TEXT,
        chat_titel TEXT,
        message_id INTEGER,
        username TEXT,
        anzeigename TEXT,
        schrift TEXT,
        anteil_fremd REAL,
        punkte INTEGER NOT NULL,
        eingesessen INTEGER NOT NULL DEFAULT 0,
        nachrichten_in_gruppe INTEGER,
        massnahme TEXT NOT NULL,
        grund TEXT,
        signale TEXT,
        belege TEXT,
        text TEXT,
        geloescht INTEGER NOT NULL DEFAULT 0,
        gesperrt INTEGER NOT NULL DEFAULT 0,
        gesperrt_in_gruppen INTEGER NOT NULL DEFAULT 0,
        durchgesetzt INTEGER NOT NULL DEFAULT 0,
        rueckgenommen INTEGER NOT NULL DEFAULT 0,
        rueckgenommen_am INTEGER,
        rueckgenommen_von INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_fs_created ON fremdschrift_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_fs_user ON fremdschrift_events(user_id);
    `);
    tabelleDa = true;
  }
  return db;
}

function protokolliere(e: Record<string, any>): void {
  try {
    tabelle().prepare(`
      INSERT INTO fremdschrift_events
        (created_at, user_id, chat_id, chat_titel, message_id, username, anzeigename,
         schrift, anteil_fremd, punkte, eingesessen, nachrichten_in_gruppe,
         massnahme, grund, signale, belege, text, geloescht, gesperrt,
         gesperrt_in_gruppen, durchgesetzt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      Date.now(), e.userId, e.chatId, e.chatTitel, e.messageId, e.username, e.anzeigename,
      e.schrift, e.anteilFremd, e.punkte, e.eingesessen ? 1 : 0, e.nachrichtenInGruppe,
      e.massnahme, e.grund, JSON.stringify(e.signale), JSON.stringify(e.belege),
      String(e.text || '').substring(0, 2000), e.geloescht ? 1 : 0, e.gesperrt ? 1 : 0,
      e.gesperrtInGruppen, (e.geloescht || e.gesperrt) ? 1 : 0,
    );
  } catch (err: unknown) {
    console.error('[Fremdschrift] Protokoll fehlgeschlagen:', err instanceof Error ? err.message : String(err));
  }
}

/** Rücknahme vermerken. Wird vom pardon_user-Knopf gerufen. */
export function vermerkeFremdschriftRuecknahme(userId: number, durchWen: number): number {
  try {
    const r = tabelle().prepare(`
      UPDATE fremdschrift_events
         SET rueckgenommen = 1, rueckgenommen_am = ?, rueckgenommen_von = ?
       WHERE user_id = ? AND rueckgenommen = 0 AND durchgesetzt = 1
    `).run(Date.now(), durchWen, userId);
    return r.changes ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Beitritt mit Spam-Namen („天赐代发👉@xxin7👈Direct"): sofort in allen Gruppen sperren.
 * Gibt true zurück, wenn gesperrt wurde. Admins/Team/Eingesessene sind vom Aufrufer bzw. hier ausgenommen.
 */
export async function pruefeBeitrittsname(
  ctx: Context, userId: number, chatId: string, chatTitel: string,
  name: { username?: string; firstName?: string; lastName?: string },
): Promise<boolean> {
  try {
    if (!config.fremdschriftCheckEnabled) return false;
    const anzeige = `${name.firstName || ''} ${name.lastName || ''}`.trim();
    const nb = bewerteAnzeigename(anzeige);
    if (!nb.spam) return false;
    const { isAdmin } = await import('./admin');
    if (isAdmin(userId) || config.protectedUserIds.includes(userId)) return false;
    const { isUserAdminOrCreatorInGroup } = await import('./telegram');
    if ((await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram)).isAdmin) return false;
    const { isPanicMode } = await import('./config');
    const panik = isPanicMode();
    let gesperrt = false;
    let gruppen = 0;
    if (config.fremdschriftAutoBan && !panik) {
      const { banUserGlobally } = await import('./telegram');
      const r = await banUserGlobally(userId, 'Fremdschrift-Spam: Spam-Name beim Beitritt');
      gesperrt = !r.skipped;
      gruppen = r.groups ?? 0;
    }
    protokolliere({
      userId, chatId, chatTitel, messageId: null, username: name.username ?? null, anzeigename: anzeige,
      schrift: 'cjk', anteilFremd: 0, punkte: 50, eingesessen: false, nachrichtenInGruppe: 0,
      massnahme: 'sperren', grund: 'Spam-Name beim Beitritt', signale: ['name_spam', 'beitritt'], belege: nb.belege,
      text: '', geloescht: false, gesperrt, gesperrtInGruppen: gruppen,
    });
    console.log(`[Fremdschrift][BEITRITT] user=${userId} chat=${chatId} name=${anzeige.slice(0, 50)} gesperrt=${gesperrt ? gruppen : 'nein'}${panik ? ' (PANIK)' : ''}`);
    return gesperrt;
  } catch (e: unknown) {
    console.error('[Fremdschrift] Beitrittsprüfung Fehler:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Zeile(n) für den Tagesbericht: erledigte Fremdschrift-Sperren der letzten 24 h. */
export function fremdschriftTagesZeilen(): string[] {
  try {
    const seit = Date.now() - 24 * 3600 * 1000;
    const r: any = tabelle().prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(geloescht),0) AS g, COALESCE(SUM(gesperrt),0) AS b
         FROM fremdschrift_events WHERE created_at >= ? AND massnahme IN ('loeschen','sperren')`
    ).get(seit);
    if (!r || !r.n) return ['• Werbe-Spam (fremde Schrift): keiner'];
    return [`• Werbe-Spam (fremde Schrift): ${r.n} erkannt, ${r.g} gelöscht, ${r.b} gesperrt`];
  } catch {
    return [];
  }
}

export function getFremdschriftEvents(limit = 25): any[] {
  try {
    return tabelle().prepare('SELECT * FROM fremdschrift_events ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------

/**
 * Telegram-Scheinabsender für Nachrichten „im Namen eines Kanals/der Gruppe":
 * 777000 (automatische Weiterleitung), 136817688 (Channel_Bot), 1087968824 (anonymer Admin).
 * 29.10.2026: 777000 stand in team_members — jede Nachricht mit diesem Absender galt als Team
 * und ging an ALLEN Prüfungen vorbei. Chinesischer Werbe-Spam kam so ungehindert in die
 * Hauptgruppe. Für diese Absender zählt nicht der Scheinabsender, sondern der Kanal dahinter.
 */
const SCHEINABSENDER = new Set<number>([777000, 136817688, 1087968824]);

/** Eigene Kanäle, die in den Gruppen schreiben dürfen (Hauptkanal). Weitere per Umgebung EIGENE_KANAL_IDS. */
function eigeneKanaele(): Set<string> {
  const s = new Set<string>(['-1001848781746']);
  for (const x of (process.env.EIGENE_KANAL_IDS || '').split(',')) if (x.trim()) s.add(x.trim());
  return s;
}

const verknuepftCache = new Map<string, { id: string | null; bis: number }>();
async function verknuepfterKanal(ctx: Context, chatId: string): Promise<string | null> {
  const c = verknuepftCache.get(chatId);
  if (c && c.bis > Date.now()) return c.id;
  let id: string | null = null;
  try {
    const info: any = await ctx.telegram.getChat(chatId);
    id = info?.linked_chat_id ? String(info.linked_chat_id) : null;
  } catch { /* unbekannt = kein verknüpfter Kanal */ }
  verknuepftCache.set(chatId, { id, bis: Date.now() + 60 * 60 * 1000 });
  return id;
}

/**
 * Räumt Antworten fremder Bots hinter einer Auslöser-Nachricht ab. Der Shield sieht Bot-Nachrichten nie; die IDs
 * direkt nach dem Auslöser werden deshalb über eine Weiterleitung in den Admin-Log-Chat geprüft (Kopie sofort gelöscht)
 * und gelöscht, wenn der Absender ein Bot ist oder die Nachricht über einen Bot lief.
 */
export async function raeumeBotAntworten(telegram: any, chatId: string, ausloeserId: number, spanne = 10): Promise<number> {
  let geloescht = 0;
  for (let id = ausloeserId + 1; id <= ausloeserId + spanne; id++) {
    try {
      const k = await telegram.callApi('forwardMessage', { chat_id: config.adminLogChat, from_chat_id: chatId, message_id: id, disable_notification: true });
      try { await telegram.deleteMessage(config.adminLogChat, k.message_id); } catch { /* Kopie bleibt höchstens stehen */ }
      const fo: any = k.forward_origin || {};
      const eigen = fo.type === 'user' && fo.sender_user?.id === telegram.botInfo?.id;
      const inhalt = `${k.text || ''}${k.caption || ''}`;
      const werbung = /[\p{Script=Han}]{3,}/u.test(inhalt) || !!k.reply_markup || !!k.via_bot;
      const vonBot = !eigen && werbung && ((fo.type === 'user' && fo.sender_user?.is_bot) || !!k.via_bot || !!k.reply_markup);
      if (vonBot) {
        await telegram.deleteMessage(chatId, id);
        geloescht++;
        console.log(`[Fremdschrift][BOT-ANTWORT] gelöscht chat=${chatId} msg=${id} von=${fo.sender_user?.username ?? fo.sender_user?.first_name ?? '?'} via=${k.via_bot?.username ?? '-'}`);
      }
    } catch (e: any) {
      const code = e?.response?.error_code;
      if (code === 429) await new Promise(r => setTimeout(r, ((e.response?.parameters?.retry_after ?? 2) + 1) * 1000));
      // 400 = Nachricht existiert nicht (mehr): weiter
    }
  }
  return geloescht;
}

/** Sperrt einen Kanal als Absender in allen verwalteten Gruppen. */
export async function sperreKanalGlobal(telegram: any, kanalId: number): Promise<number> {
  const { getManagedGroups } = await import('./db');
  let n = 0;
  for (const g of getManagedGroups()) {
    try {
      await telegram.callApi('banChatSenderChat', { chat_id: String(g.chatId), sender_chat_id: kanalId });
      n++;
    } catch (e: any) {
      const code = e?.response?.error_code;
      if (code === 429) {
        const warte = (e.response?.parameters?.retry_after ?? 3) + 1;
        await new Promise(r => setTimeout(r, warte * 1000));
        try { await telegram.callApi('banChatSenderChat', { chat_id: String(g.chatId), sender_chat_id: kanalId }); n++; } catch { /* nächste Gruppe */ }
      }
      // 400/403 (Bot dort kein Admin, Kanal nicht dort aktiv): überspringen
    }
  }
  return n;
}

export async function pruefeFremdschrift(ctx: Context): Promise<FremdschriftErgebnis> {
  try {
    if (!config.fremdschriftCheckEnabled) return KEINE;

    const msg: any = ctx.message || ('edited_message' in (ctx.update as any) ? (ctx.update as any).edited_message : null);
    if (!msg || !ctx.from) return KEINE;
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return KEINE;

    // Nachricht im Namen eines Kanals? Dann entscheidet der Kanal, nicht der Scheinabsender.
    const senderChat: any = msg.sender_chat && msg.sender_chat.id !== chat.id ? msg.sender_chat : null;
    const scheinAbsender = SCHEINABSENDER.has(ctx.from.id);
    if (ctx.from.is_bot && !scheinAbsender && ctx.from.id === ((ctx as any).botInfo?.id ?? (ctx.telegram as any)?.botInfo?.id)) return KEINE;
    if (msg.sender_chat && msg.sender_chat.id === chat.id) return KEINE; // anonymer Admin der Gruppe selbst
    if (senderChat) {
      const eigene = eigeneKanaele();
      if (eigene.has(String(senderChat.id)) || String(senderChat.id) === await verknuepfterKanal(ctx, String(chat.id))) return KEINE;
    } else if (scheinAbsender && ctx.from.id !== 777000) {
      return KEINE; // anonymer Admin ohne sender_chat: nichts zu prüfen
    }
    const kanalTitel: string = senderChat ? `${senderChat.title || ''} ${senderChat.username ? '@' + senderChat.username : ''}`.trim() : '';
    if (senderChat || scheinAbsender) {
      console.log(`[Fremdschrift][KANAL] from=${ctx.from.id} sender_chat=${senderChat?.id ?? '-'} titel=${kanalTitel.slice(0, 60)} chat=${chat.id} msg=${msg.message_id} thread=${msg.message_thread_id ?? '-'} fwd=${msg.forward_origin?.type ?? '-'}`);
    }

    // Text erst prüfen — billig, und die allermeisten Nachrichten enden hier.
    const ausBildunterschrift = !msg.text && typeof msg.caption === 'string';
    const textOhneTasten: string = msg.text || msg.caption || '';
    // Inline-Tasten (URL-Buttons) gehören zur Werbung: Tastentexte und Ziele zählen als Text.
    const tasten: string[] = [];
    for (const zeile of msg.reply_markup?.inline_keyboard || []) for (const t of zeile) { if (t?.text) tasten.push(t.text); if (t?.url) tasten.push(t.url); }
    const viaBot: any = msg.via_bot || null;
    const text: string = tasten.length ? `${textOhneTasten}\n${tasten.join('\n')}` : textOhneTasten;
    const botKette = bewerteBotKette(textOhneTasten);

    // Anzeigename: bei Kanälen der Kanalname, sonst Vor-/Nachname. Der Name ist oft die eigentliche Anzeige.
    const anzeigeText = senderChat ? kanalTitel : `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();
    const nameBefund = bewerteAnzeigename(anzeigeText);
    if (!text.trim() && !nameBefund.spam) return KEINE;
    if (viaBot || tasten.length) console.log(`[Fremdschrift][TASTEN] from=${ctx.from.id} via_bot=${viaBot?.username ?? '-'} tasten=${tasten.length} chat=${chat.id} msg=${msg.message_id}`);

    // Schnellfilter: ohne Zielschrift, ohne Verschleierungszeichen kein Befund.
    if (!nameBefund.spam && !botKette.treffer && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Greek}­​-‏‪-‮⁠-⁤﻿\u{1D400}-\u{1D7FF}Ａ-ｚ]/u.test(text)) {
      return KEINE;
    }

    const chatId = String(chat.id);
    const messageId: number = msg.message_id;

    const { getGroup } = await import('./db');
    if (getGroup(chatId)?.status !== 1) return KEINE;

    // Ausnahmen — dieselben wie überall, und vor allem anderen.
    // NICHT für Kanal-Nachrichten und Scheinabsender: dort sagt die Kennung (z. B. 777000 im Team-Verzeichnis) nichts über den Verfasser.
    const userId = ctx.from.id;
    if (!senderChat && !scheinAbsender) {
      if (config.protectedUserIds.includes(userId)) return KEINE;
      const { isAdmin } = await import('./admin');
      if (isAdmin(userId)) return KEINE;
      const { isTeamMember, isIdentityExempt } = await import('./db');
      if (isTeamMember(userId) || isIdentityExempt(userId)) return KEINE;
      try {
        const { isUserAdminOrCreatorInGroup } = await import('./telegram');
        if ((await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram)).isAdmin) return KEINE;
      } catch { /* im Zweifel weiterprüfen */ }
    }

    // Versteckte Links und Erwähnungen ohne @ stecken in den Entities.
    const entities: any[] = (ausBildunterschrift ? msg.caption_entities : msg.entities) || [];
    const entityLinks = entities.filter(e => e.type === 'text_link').length;
    const entityKennungen = entities
      .filter(e => e.type === 'text_mention' && e.user)
      .map(e => (e.user.username ? '@' + e.user.username : `id:${e.user.id}`));

    const { leseNachrichtenStand } = await import('./db');
    // Kanäle und Scheinabsender haben keinen Verlauf als „eingesessenes Mitglied".
    const absender: Absender = { nachrichtenInGruppe: (senderChat || scheinAbsender) ? 0 : leseNachrichtenStand(userId, chatId), kontoAlterTage: null };

    const befund = bewerteFremdschrift(text, { absender, entityLinks, entityKennungen });
    let urteil = entscheideFremdschrift(befund, absender);
    // Spam-Name: eindeutig genug zum Sperren, außer bei eingesessenen Mitgliedern (die nur gemeldet werden).
    if (nameBefund.spam && urteil.massnahme !== 'sperren') {
      if (befund.eingesessen) {
        if (urteil.massnahme === 'keine') urteil = { massnahme: 'melden', grund: 'Anzeigename wie Werbe-Spam, aber eingesessenes Mitglied', belege: nameBefund.belege };
      } else {
        urteil = { massnahme: 'sperren', grund: 'Werbe-Spam im Anzeigenamen (fremde Schrift mit Kontakt/Werbewort)', belege: [...nameBefund.belege, ...urteil.belege] };
      }
    }
    if (botKette.treffer && urteil.massnahme !== 'sperren') {
      urteil = { massnahme: 'sperren', grund: 'Kette von Bot-Erwähnungen (löst Werbe-Antworten fremder Bots aus)', belege: [`Bots: ${botKette.bots.slice(0, 4).join(', ')}`, ...urteil.belege] };
    }
    if (viaBot && urteil.massnahme === 'melden') {
      urteil = { massnahme: 'sperren', grund: `Werbe-Nachricht über Bot @${viaBot.username || viaBot.id}`, belege: urteil.belege };
    }
    if (urteil.massnahme === 'keine') return KEINE;

    const chatTitel = 'title' in chat ? chat.title || '' : '';
    const anzeigename = senderChat ? `Kanal: ${kanalTitel}` : `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    // ---- Durchsetzung ----
    const { deleteMessage, banUserGlobally } = await import('./telegram');
    const { isPanicMode } = await import('./config');
    const panik = isPanicMode();

    let geloescht = false;
    let gesperrt = false;
    let gesperrtInGruppen = 0;

    if ((urteil.massnahme === 'loeschen' || urteil.massnahme === 'sperren') && !panik) {
      geloescht = await deleteMessage(chatId, messageId).catch(() => false);
    }

    if (urteil.massnahme === 'sperren' && config.fremdschriftAutoBan && !panik) {
      try {
        if (senderChat) {
          // Kanal als Absender: Kanal sperren (der Scheinabsender 777000 darf nie gebannt werden)
          gesperrtInGruppen = await sperreKanalGlobal(ctx.telegram, senderChat.id);
          gesperrt = gesperrtInGruppen > 0;
        } else if (scheinAbsender) {
          console.log('[Fremdschrift] Scheinabsender ohne Kanal: Nachricht gelöscht, kein Bann möglich');
        } else {
          const r = await banUserGlobally(userId, `Fremdschrift-Spam: ${urteil.grund}`);
          gesperrt = true;
          gesperrtInGruppen = r.groups ?? 0;
        }
      } catch (e: any) {
        console.error('[Fremdschrift] Sperre fehlgeschlagen:', e?.message);
      }
    }

    protokolliere({
      userId: senderChat ? senderChat.id : userId, chatId, chatTitel, messageId, username: (senderChat ? senderChat.username : ctx.from.username) ?? null, anzeigename,
      schrift: befund.schrift, anteilFremd: Math.round(befund.anteilFremd * 1000) / 1000,
      punkte: befund.punkte, eingesessen: befund.eingesessen,
      nachrichtenInGruppe: absender.nachrichtenInGruppe,
      massnahme: urteil.massnahme, grund: urteil.grund, signale: befund.signale, belege: urteil.belege,
      text, geloescht, gesperrt, gesperrtInGruppen,
    });

    console.log(
      `[Fremdschrift][${urteil.massnahme.toUpperCase()}] user=${userId} chat=${chatId} ` +
      `schrift=${befund.schrift ?? '-'} anteil=${Math.round(befund.anteilFremd * 100)}% ` +
      `signale=${befund.signale.join(',')} geloescht=${geloescht} gesperrt=${gesperrt ? gesperrtInGruppen : 'nein'}` +
      (panik ? ' (PANIKMODUS: nichts durchgesetzt)' : '')
    );

    if (botKette.treffer && geloescht && !panik) {
      for (const warte of [4000, 12000]) setTimeout(() => { raeumeBotAntworten(ctx.telegram, chatId, messageId).catch(() => {}); }, warte);
    }

    // Erledigte Sperren stehen nur im Shield-Log (fremdschrift_events) und im Tagesbericht,
    // keine Einzelmeldung. Einzeln gemeldet wird nur, was ein Mensch ansehen muss.
    const erledigt = urteil.massnahme === 'sperren' && geloescht && gesperrt && !panik;
    if (!erledigt) await melde(ctx, {
      userId: senderChat ? senderChat.id : userId, chatTitel, anzeigename, urteil, text, geloescht, gesperrt, gesperrtInGruppen, panik,
      schrift: befund.schrift ? schriftName(befund.schrift) : null,
      anteil: befund.anteilFremd, eingesessen: befund.eingesessen,
    });

    return { massnahme: urteil.massnahme, grund: urteil.grund, erledigt: geloescht };
  } catch (error: unknown) {
    console.error('[Fremdschrift] Fehler:', error instanceof Error ? error.message : String(error));
    return KEINE;
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function melde(ctx: Context, d: {
  userId: number; chatTitel: string; anzeigename: string;
  urteil: { massnahme: FremdschriftMassnahme; grund: string; belege: string[] };
  text: string; geloescht: boolean; gesperrt: boolean; gesperrtInGruppen: number; panik: boolean;
  schrift: string | null; anteil: number; eingesessen: boolean;
}): Promise<void> {
  try {
    const { Markup } = await import('telegraf');
    const kopf = d.gesperrt
      ? '🚫 <b>GESPERRT: Fremdschrift-Spam</b>\n\n'
      : d.urteil.massnahme === 'sperren'
        ? '🈲 <b>FREMDSCHRIFT-SPAM — Sperre nicht ausgeführt</b>\n\n'
        : d.urteil.massnahme === 'loeschen'
          ? '🈲 <b>Fremdschrift-Nachricht entfernt — bitte prüfen</b>\n\n'
          : '⚠️ <b>Verdacht: Fremdschrift-/verschleierte Nachricht</b>\n\n';

    let m = kopf;
    m += `🆔 User ID: <code>${d.userId}</code>\n`;
    if (ctx.from?.username) m += `👤 Benutzername: @${esc(ctx.from.username)}\n`;
    if (d.anzeigename) m += `📛 Anzeigename: <code>${esc(d.anzeigename)}</code>\n`;
    if (d.chatTitel) m += `📍 Gruppe: <b>${esc(d.chatTitel)}</b>\n`;
    if (d.schrift) m += `🔤 Schrift: ${esc(d.schrift)}, ${Math.round(d.anteil * 100)} % der Buchstaben\n`;
    if (d.eingesessen) m += `🧑‍🤝‍🧑 <b>Eingesessenes Mitglied — wird von dieser Regel nie angefasst.</b>\n`;
    m += `📋 ${esc(d.urteil.grund)}\n\n`;
    m += `<b>Gefunden:</b>\n${d.urteil.belege.slice(0, 8).map(b => `• ${esc(b)}`).join('\n')}\n`;
    m += `\n<b>Wortlaut:</b>\n<code>${esc(d.text.substring(0, 600))}</code>\n\n`;

    if (d.panik) {
      m += `<i>Panikmodus: es wurde nichts gelöscht und niemand gesperrt.</i>`;
    } else {
      m += d.geloescht ? '🗑 Nachricht entfernt.\n' : '<i>Es wurde nichts gelöscht.</i>\n';
      m += d.gesperrt
        ? `🚫 In ${d.gesperrtInGruppen} Gruppen gesperrt — mit dem Knopf unten rückholbar.`
        : '<i>Niemand gesperrt.</i>';
    }

    const knopf = d.gesperrt
      ? [[Markup.button.callback('↩️ SPERRE AUFHEBEN', `pardon_user:${d.userId}`)]]
      : [[Markup.button.callback('🔴 KONTO SPERREN', `profil_ban:${d.userId}`),
          Markup.button.callback('✅ HARMLOS', `pardon_user:${d.userId}`)]];

    await ctx.telegram.sendMessage(config.adminLogChat, m, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(knopf).reply_markup,
      link_preview_options: { is_disabled: true },
    } as any);
  } catch (e: any) {
    console.error('[Fremdschrift] Meldung fehlgeschlagen:', e?.message);
  }
}
