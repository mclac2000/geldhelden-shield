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
import { bewerteFremdschrift, entscheideFremdschrift, FremdschriftMassnahme, schriftName } from './fremdschriftRisk';
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

export function getFremdschriftEvents(limit = 25): any[] {
  try {
    return tabelle().prepare('SELECT * FROM fremdschrift_events ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------

export async function pruefeFremdschrift(ctx: Context): Promise<FremdschriftErgebnis> {
  try {
    if (!config.fremdschriftCheckEnabled) return KEINE;

    const msg: any = ctx.message || ('edited_message' in (ctx.update as any) ? (ctx.update as any).edited_message : null);
    if (!msg || !ctx.from || ctx.from.is_bot) return KEINE;
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return KEINE;

    // Text erst prüfen — billig, und die allermeisten Nachrichten enden hier.
    const ausBildunterschrift = !msg.text && typeof msg.caption === 'string';
    const text: string = msg.text || msg.caption || '';
    if (!text.trim()) return KEINE;

    // Schnellfilter: ohne Zielschrift, ohne Verschleierungszeichen kein Befund.
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Greek}­​-‏‪-‮⁠-⁤﻿\u{1D400}-\u{1D7FF}Ａ-ｚ]/u.test(text)) {
      return KEINE;
    }

    const chatId = String(chat.id);
    const messageId: number = msg.message_id;

    const { getGroup } = await import('./db');
    if (getGroup(chatId)?.status !== 1) return KEINE;

    // Ausnahmen — dieselben wie überall, und vor allem anderen.
    const userId = ctx.from.id;
    if (config.protectedUserIds.includes(userId)) return KEINE;
    const { isAdmin } = await import('./admin');
    if (isAdmin(userId)) return KEINE;
    const { isTeamMember, isIdentityExempt } = await import('./db');
    if (isTeamMember(userId) || isIdentityExempt(userId)) return KEINE;
    try {
      const { isUserAdminOrCreatorInGroup } = await import('./telegram');
      if ((await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram)).isAdmin) return KEINE;
    } catch { /* im Zweifel weiterprüfen */ }

    // Versteckte Links und Erwähnungen ohne @ stecken in den Entities.
    const entities: any[] = (ausBildunterschrift ? msg.caption_entities : msg.entities) || [];
    const entityLinks = entities.filter(e => e.type === 'text_link').length;
    const entityKennungen = entities
      .filter(e => e.type === 'text_mention' && e.user)
      .map(e => (e.user.username ? '@' + e.user.username : `id:${e.user.id}`));

    const { leseNachrichtenStand } = await import('./db');
    const absender: Absender = { nachrichtenInGruppe: leseNachrichtenStand(userId, chatId), kontoAlterTage: null };

    const befund = bewerteFremdschrift(text, { absender, entityLinks, entityKennungen });
    const urteil = entscheideFremdschrift(befund, absender);
    if (urteil.massnahme === 'keine') return KEINE;

    const chatTitel = 'title' in chat ? chat.title || '' : '';
    const anzeigename = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

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
        const r = await banUserGlobally(userId, `Fremdschrift-Spam: ${urteil.grund}`);
        gesperrt = true;
        gesperrtInGruppen = r.groups ?? 0;
      } catch (e: any) {
        console.error('[Fremdschrift] Sperre fehlgeschlagen:', e?.message);
      }
    }

    protokolliere({
      userId, chatId, chatTitel, messageId, username: ctx.from.username ?? null, anzeigename,
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

    await melde(ctx, {
      userId, chatTitel, anzeigename, urteil, text, geloescht, gesperrt, gesperrtInGruppen, panik,
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
