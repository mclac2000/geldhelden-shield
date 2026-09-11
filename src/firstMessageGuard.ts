/**
 * firstMessageGuard.ts — Durchsetzung der Erstnachrichten-Prüfung
 *
 * Bewertet die ersten Nachrichten eines Kontos in einer Gruppe. Jede
 * Bewertung oberhalb der Alarmschwelle wird MIT NACHRICHTENTEXT protokolliert
 * (`first_message_events`), damit die Regel nachträglich an echten Daten
 * kalibriert werden kann — vor dieser Prüfung hat Shield nirgends
 * Nachrichtentexte gespeichert, weshalb eine rückwirkende Messung unmöglich
 * war.
 */

import { Context } from 'telegraf';
import { config } from './config';
import { bewerteErstnachricht, entscheideErstnachricht } from './firstMessageRisk';

export interface ErstnachrichtErgebnis {
  massnahme: 'keine' | 'alarm' | 'sperren';
  grund: string;
  /** true, wenn gesperrt wurde und die weitere Verarbeitung entfallen kann */
  erledigt: boolean;
}

const KEINE: ErstnachrichtErgebnis = { massnahme: 'keine', grund: '', erledigt: false };

/**
 * Nur die ersten N Nachrichten eines Kontos je Gruppe werden geprüft. Danach
 * ist das Konto kein Neuzugang mehr und andere Mechanismen greifen.
 */
export const GEPRUEFTE_NACHRICHTEN = 5;

export async function pruefeErstnachricht(ctx: Context): Promise<ErstnachrichtErgebnis> {
  try {
    if (!config.firstMessageCheckEnabled) return KEINE;

    const msg: any = ctx.message;
    if (!msg || !ctx.from || ctx.from.is_bot) return KEINE;
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return KEINE;

    const text: string = msg.text || msg.caption || '';
    if (!text.trim()) return KEINE;

    const userId = ctx.from.id;
    const chatId = String(chat.id);

    // Nur verwaltete Gruppen
    const { getGroup } = await import('./db');
    if (getGroup(chatId)?.status !== 1) return KEINE;

    // Ausnahmen — dieselben wie überall im System
    if (config.protectedUserIds.includes(userId)) return KEINE;
    const { isAdmin } = await import('./admin');
    if (isAdmin(userId)) return KEINE;
    const {
      isTeamMember, isIdentityExempt, zaehleUndHoleNachrichtNr,
      logFirstMessageEvent,
    } = await import('./db');
    if (isTeamMember(userId) || isIdentityExempt(userId)) return KEINE;
    try {
      const { isUserAdminOrCreatorInGroup } = await import('./telegram');
      if ((await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram)).isAdmin) return KEINE;
    } catch { /* im Zweifel weiterprüfen */ }

    // Wievielte Nachricht ist das? Zählt hoch und liefert den neuen Stand.
    const { nummer, ersterKontakt } = zaehleUndHoleNachrichtNr(userId, chatId);
    if (nummer > GEPRUEFTE_NACHRICHTEN) return KEINE;

    const minutenSeitBeitritt = ersterKontakt
      ? Math.max(0, (Date.now() - ersterKontakt) / 60000)
      : null;

    const anzeigename = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    const befund = bewerteErstnachricht({
      text, anzeigename, minutenSeitBeitritt, nachrichtNr: nummer,
    });
    const urteil = entscheideErstnachricht(befund);

    // Lernprotokoll: JEDE bewertete Nachricht, auch die unauffällige.
    // Ohne das lässt sich nur beantworten, was die Regel gefunden hat — nie,
    // was sie übersehen hat. Siehe Kommentar an der Tabelle in db.ts.
    const { logFirstMessageSample } = await import('./db');
    logFirstMessageSample({
      userId, chatId, username: ctx.from.username ?? null, anzeigename,
      nachrichtNr: nummer, punkte: befund.punkte,
      inhaltlicheGruppen: befund.inhaltlicheGruppen,
      signale: befund.signale, text,
    });

    if (urteil.massnahme === 'keine') return KEINE;

    const gruppentitel = 'title' in chat ? chat.title || '' : '';

    // IMMER protokollieren — auch im reinen Beobachtungsmodus. Genau diese
    // Sammlung ist die Datengrundlage, die vorher gefehlt hat.
    logFirstMessageEvent({
      userId, chatId, username: ctx.from.username ?? null, anzeigename,
      nachrichtNr: nummer, punkte: befund.punkte,
      inhaltlicheGruppen: befund.inhaltlicheGruppen,
      massnahme: urteil.massnahme, grund: urteil.grund,
      signale: befund.signale, belege: urteil.belege, text,
      durchgesetzt: urteil.massnahme === 'sperren' && config.firstMessageAutoBan,
    });

    if (urteil.massnahme === 'sperren') {
      const { isPanicMode } = await import('./config');
      if (!config.firstMessageAutoBan) {
        console.log(`[Erstnachricht][SPERRE-BEREIT] user=${userId} ${befund.punkte} Punkte — FIRST_MESSAGE_AUTO_BAN ist aus, nur Meldung`);
        await melde(ctx, userId, gruppentitel, urteil, befund, text, true);
        return { massnahme: 'alarm', grund: urteil.grund, erledigt: false };
      }
      if (isPanicMode()) {
        await melde(ctx, userId, gruppentitel, urteil, befund, text, true);
        return { massnahme: 'alarm', grund: urteil.grund, erledigt: false };
      }

      // Erst die Nachricht entfernen, dann sperren — sonst bleibt die Werbung
      // stehen, während das Konto schon weg ist.
      try {
        await ctx.telegram.deleteMessage(chat.id, msg.message_id);
      } catch { /* evtl. schon gelöscht */ }

      const { banUserGlobally } = await import('./telegram');
      const r = await banUserGlobally(userId, `Erstnachricht: ${urteil.grund}`);
      console.log(`[Erstnachricht][SPERRE] user=${userId} punkte=${befund.punkte} groups=${r.groups}`);
      await melde(ctx, userId, gruppentitel, urteil, befund, text, false, r.groups);
      return { massnahme: 'sperren', grund: urteil.grund, erledigt: true };
    }

    await melde(ctx, userId, gruppentitel, urteil, befund, text, true);
    return { massnahme: 'alarm', grund: urteil.grund, erledigt: false };
  } catch (error: unknown) {
    console.error('[Erstnachricht] Fehler:', error instanceof Error ? error.message : String(error));
    return KEINE;
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function melde(
  ctx: Context, userId: number, gruppentitel: string,
  urteil: { grund: string; belege: string[]; punkte: number },
  befund: { punkte: number; inhaltlicheGruppen: number },
  text: string, nurVerdacht: boolean, gruppen?: number
): Promise<void> {
  try {
    const { Markup } = await import('telegraf');
    // In den ersten 48 Stunden nach dem Scharfschalten ist jede Sperre eine
    // Stichprobe auf die neue Regel — sie wird deshalb ausdrücklich als solche
    // gekennzeichnet, statt in der Masse der Meldungen unterzugehen.
    const inProbezeit = config.firstMessageArmedAt !== null
      && Date.now() - config.firstMessageArmedAt < 48 * 3600 * 1000;

    let m = nurVerdacht
      ? '⚠️ <b>VERDACHT: Werbung in der Erstnachricht</b>\n\n'
      : '🚫 <b>GESPERRT: Werbung in der Erstnachricht</b>\n\n';
    if (inProbezeit && !nurVerdacht) {
      const stunden = Math.floor((Date.now() - (config.firstMessageArmedAt as number)) / 3600000);
      m = '🔬 <b>STICHPROBE — neue Regel, Stunde ' + stunden + ' von 48</b>\n' +
          '<i>Bitte prüfen: war diese Sperre richtig?</i>\n\n' + m;
    }
    m += `🆔 User ID: <code>${userId}</code>\n`;
    if (ctx.from?.username) m += `👤 Benutzername: @${esc(ctx.from.username)}\n`;
    const anzeige = `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim();
    if (anzeige) m += `📛 Anzeigename: <code>${esc(anzeige)}</code>\n`;
    if (gruppentitel) m += `📍 Gruppe: <b>${esc(gruppentitel)}</b>\n`;
    m += `📊 ${befund.punkte} Punkte aus ${befund.inhaltlicheGruppen} inhaltlichen Signalgruppen\n\n`;
    m += `<b>Gefunden:</b>\n${urteil.belege.map(b => `• ${esc(b)}`).join('\n')}\n`;
    m += `\n<b>Nachricht im Wortlaut:</b>\n<code>${esc(text.substring(0, 500))}</code>\n`;
    if (typeof gruppen === 'number') m += `\n✅ In ${gruppen} Gruppen gesperrt, Nachricht entfernt.`;
    if (nurVerdacht) m += `\n<i>Es wurde niemand gesperrt und nichts gelöscht.</i>`;

    const knopf = nurVerdacht
      ? [[Markup.button.callback('🔴 JETZT SPERREN', `profil_ban:${userId}`),
          Markup.button.callback('✅ HARMLOS', `pardon_user:${userId}`)]]
      : [[Markup.button.callback('↩️ SPERRE AUFHEBEN', `pardon_user:${userId}`)]];

    await ctx.telegram.sendMessage(config.adminLogChat, m, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(knopf).reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[Erstnachricht] Meldung fehlgeschlagen:', e.message);
  }
}
