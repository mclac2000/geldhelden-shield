/**
 * cryptoBuyGuard.ts — Durchsetzung der Krypto-Ankauf-Erkennung
 *
 * WICHTIG — ANDERE BETRIEBSART ALS DIE ÜBRIGEN PRÜFUNGEN:
 * Dieser Erkenner sperrt niemanden und löscht nichts. Er meldet in den
 * Admin-Chat und legt dem Menschen die Entscheidung vor. Marco hat das für
 * diesen Fall ausdrücklich so verlangt: „Wenn du meinst, dass der Post oder
 * das Konto entfernt gehört, legst du es mir vor."
 *
 * Der Schalter CRYPTO_BUY_AUTO_BAN existiert, steht auf false und wird nicht
 * von einer Sitzung umgelegt, sondern von Marco.
 *
 * Zweiter Unterschied: Die Prüfung gilt für JEDE Nachricht, nicht nur die
 * ersten fünf eines Kontos. Dieser Scam kommt auch von Konten, die lange
 * still mitgelesen haben.
 */

import { Context } from 'telegraf';
import { config } from './config';
import { bewerteKryptoAnkauf, entscheideKryptoAnkauf } from './cryptoBuyRisk';

export interface KryptoErgebnis {
  massnahme: 'keine' | 'alarm' | 'sperren';
  grund: string;
  erledigt: boolean;
}

const KEINE: KryptoErgebnis = { massnahme: 'keine', grund: '', erledigt: false };

export async function pruefeKryptoAnkauf(ctx: Context): Promise<KryptoErgebnis> {
  try {
    if (!config.cryptoBuyCheckEnabled) return KEINE;

    const msg: any = ctx.message;
    if (!msg || !ctx.from || ctx.from.is_bot) return KEINE;
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return KEINE;

    const text: string = msg.text || msg.caption || '';
    if (!text.trim()) return KEINE;

    const userId = ctx.from.id;
    const chatId = String(chat.id);

    const { getGroup } = await import('./db');
    if (getGroup(chatId)?.status !== 1) return KEINE;

    // Ausnahmen — dieselben wie überall
    if (config.protectedUserIds.includes(userId)) return KEINE;
    const { isAdmin } = await import('./admin');
    if (isAdmin(userId)) return KEINE;
    const { isTeamMember, isIdentityExempt, logCryptoEvent } = await import('./db');
    if (isTeamMember(userId) || isIdentityExempt(userId)) return KEINE;
    try {
      const { isUserAdminOrCreatorInGroup } = await import('./telegram');
      if ((await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram)).isAdmin) return KEINE;
    } catch { /* im Zweifel weiterprüfen */ }

    const befund = bewerteKryptoAnkauf(text);
    const urteil = entscheideKryptoAnkauf(befund);
    if (urteil.massnahme === 'keine') return KEINE;

    const gruppentitel = 'title' in chat ? chat.title || '' : '';

    logCryptoEvent({
      userId, chatId, username: ctx.from.username ?? null,
      anzeigename: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
      punkte: befund.punkte, tragendeGruppen: befund.tragendeGruppen,
      massnahme: urteil.massnahme, grund: urteil.grund,
      signale: befund.signale, belege: urteil.belege, text,
      durchgesetzt: false,
    });

    // Sperren nur, wenn Marco den Schalter selbst umgelegt hat.
    const sperrenErlaubt = urteil.massnahme === 'sperren' && config.cryptoBuyAutoBan;
    if (sperrenErlaubt) {
      const { isPanicMode } = await import('./config');
      if (!isPanicMode()) {
        const { banUserGlobally } = await import('./telegram');
        const r = await banUserGlobally(userId, `Krypto-Ankauf-Betrug: ${urteil.grund}`);
        console.log(`[KryptoAnkauf][SPERRE] user=${userId} punkte=${befund.punkte} groups=${r.groups}`);
        await melde(ctx, userId, gruppentitel, urteil, befund, text, false, r.groups);
        return { massnahme: 'sperren', grund: urteil.grund, erledigt: true };
      }
    }

    console.log(`[KryptoAnkauf][${urteil.massnahme.toUpperCase()}] user=${userId} punkte=${befund.punkte} gruppen=${befund.tragendeGruppen}/4`);
    await melde(ctx, userId, gruppentitel, urteil, befund, text, true);
    return { massnahme: 'alarm', grund: urteil.grund, erledigt: false };
  } catch (error: unknown) {
    console.error('[KryptoAnkauf] Fehler:', error instanceof Error ? error.message : String(error));
    return KEINE;
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function melde(
  ctx: Context, userId: number, gruppentitel: string,
  urteil: { grund: string; belege: string[] },
  befund: { punkte: number; tragendeGruppen: number },
  text: string, nurMeldung: boolean, gruppen?: number
): Promise<void> {
  try {
    const { Markup } = await import('telegraf');
    const schwer = befund.tragendeGruppen >= 3;

    let m = nurMeldung
      ? (schwer
          ? '🪙 <b>KRYPTO-ANKAUF-BETRUG — bitte entscheiden</b>\n\n'
          : '⚠️ <b>Verdacht: Krypto-Ankaufangebot</b>\n\n')
      : '🚫 <b>GESPERRT: Krypto-Ankauf-Betrug</b>\n\n';

    m += `🆔 User ID: <code>${userId}</code>\n`;
    if (ctx.from?.username) m += `👤 Benutzername: @${esc(ctx.from.username)}\n`;
    const anzeige = `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim();
    if (anzeige) m += `📛 Anzeigename: <code>${esc(anzeige)}</code>\n`;
    if (gruppentitel) m += `📍 Gruppe: <b>${esc(gruppentitel)}</b>\n`;
    m += `📊 ${befund.punkte} Punkte, ${befund.tragendeGruppen} von 4 tragenden Merkmalen\n\n`;
    m += `<b>Gefunden:</b>\n${urteil.belege.slice(0, 8).map(b => `• ${esc(b)}`).join('\n')}\n`;
    m += `\n<b>Nachricht im Wortlaut:</b>\n<code>${esc(text.substring(0, 600))}</code>\n`;

    if (typeof gruppen === 'number') {
      m += `\n✅ In ${gruppen} Gruppen gesperrt.`;
    } else {
      m += `\n<i>Es wurde nichts gelöscht und niemand gesperrt.</i>`;
      if (schwer) m += `\n<i>Die Knöpfe unten führen die Maßnahme aus.</i>`;
    }

    const knopf = nurMeldung
      ? [[Markup.button.callback('🔴 KONTO SPERREN', `profil_ban:${userId}`),
          Markup.button.callback('✅ HARMLOS', `pardon_user:${userId}`)]]
      : [[Markup.button.callback('↩️ SPERRE AUFHEBEN', `pardon_user:${userId}`)]];

    await ctx.telegram.sendMessage(config.adminLogChat, m, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(knopf).reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[KryptoAnkauf] Meldung fehlgeschlagen:', e.message);
  }
}
