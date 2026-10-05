/**
 * cryptoBuyGuard.ts — Durchsetzung der Krypto-Ankauf-Erkennung
 *
 * ## Betriebsart geändert am 05.10.2026 (Auftrag #275)
 *
 * Bis dahin stand hier: „Dieser Erkenner sperrt niemanden und löscht nichts."
 * Das war richtig und Marcos ausdrückliche Entscheidung vom September:
 * melden, Mensch entscheidet.
 *
 * **Marco hat es am 05.10.2026 widerrufen**, nach einem OTC-Ankaufpost, der
 * stehen blieb: „soll solche Nachrichten als Spam erkennen und behandeln
 * (löschen, Absender sperren, so wie bei den Copy-Trading-Fällen)". Deshalb
 * löscht dieser Guard jetzt, und `CRYPTO_BUY_AUTO_BAN` steht auf true.
 *
 * Das ist hier vermerkt, weil der alte Satz eine begründete Entscheidung war
 * und nicht aus Versehen umgedreht werden darf. Wer ihn wieder umlegen will,
 * braucht wieder Marco.
 *
 * ## Drei Stufen, wie bei Copy-Trading
 *
 *   sperren  — löschen und in allen Gruppen sperren
 *   loeschen — löschen und vorlegen, niemand gesperrt
 *   alarm    — NUR vorlegen, nichts angefasst
 *
 * Die Stufe „alarm" bleibt, und sie ist kein Rest: Eine gelöschte Nachricht
 * eines echten Mitglieds ist teurer als ein durchgerutschter Spam — sie ist
 * weg, das Mitglied merkt es, und niemand erfährt warum.
 *
 * ## Zwei Dinge, die so bleiben
 *
 * Die Prüfung gilt für JEDE Nachricht, nicht nur die ersten fünf eines
 * Kontos — dieser Scam kommt auch von Konten, die lange still mitgelesen
 * haben. Und der Text wird aus `text` ODER `caption` gelesen: Diese Posts
 * kommen auch als Bild mit Unterschrift.
 */

import { Context } from 'telegraf';
import { config } from './config';
import { bewerteKryptoAnkauf, entscheideKryptoAnkauf } from './cryptoBuyRisk';

export interface KryptoErgebnis {
  massnahme: 'keine' | 'alarm' | 'loeschen' | 'sperren';
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

    // Wer schreibt, zählt mit. Gelesen, nicht mitgezählt: leseNachrichtenStand()
    // schreibt bewusst nichts — die hochzählende Variante gehört der
    // Erstnachrichten-Regel, und ein zweiter Aufruf würde deren Nummerierung
    // lautlos um eins verschieben.
    const { leseNachrichtenStand } = await import('./db');
    let kontoAlterTage: number | null = null;
    try {
      const { estimateAccountAgeDays } = await import('./accountAge');
      kontoAlterTage = estimateAccountAgeDays(userId);
    } catch { /* Alter ist eine Schätzung, kein Muss */ }

    const befund = bewerteKryptoAnkauf(text, {
      absender: { nachrichtenInGruppe: leseNachrichtenStand(userId, chatId), kontoAlterTage },
    });
    const urteil = entscheideKryptoAnkauf(befund);
    if (urteil.massnahme === 'keine') return KEINE;

    const gruppentitel = 'title' in chat ? chat.title || '' : '';
    const messageId: number = msg.message_id;

    const { isPanicMode } = await import('./config');
    const panik = isPanicMode();

    // ---- Löschen -----------------------------------------------------------
    let geloescht = false;
    if ((urteil.massnahme === 'loeschen' || urteil.massnahme === 'sperren') && !panik) {
      const { deleteMessage } = await import('./telegram');
      geloescht = await deleteMessage(chatId, messageId).catch(() => false);
    }

    // ---- Sperren -----------------------------------------------------------
    let gesperrt = false;
    let gesperrtInGruppen = 0;
    if (urteil.massnahme === 'sperren' && config.cryptoBuyAutoBan && !panik) {
      try {
        const { banUserGlobally } = await import('./telegram');
        const r = await banUserGlobally(userId, `Krypto-Ankauf-Betrug: ${urteil.grund}`);
        gesperrt = true;
        gesperrtInGruppen = r.groups ?? 0;
      } catch (e: any) {
        console.error('[KryptoAnkauf] Sperre fehlgeschlagen:', e?.message);
      }
    }

    logCryptoEvent({
      userId, chatId, username: ctx.from.username ?? null,
      anzeigename: `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim(),
      punkte: befund.punkte, tragendeGruppen: befund.tragendeGruppen,
      massnahme: urteil.massnahme, grund: urteil.grund,
      signale: befund.signale, belege: urteil.belege, text,
      durchgesetzt: geloescht || gesperrt,
    });

    console.log(
      `[KryptoAnkauf][${urteil.massnahme.toUpperCase()}] user=${userId} chat=${chatId} ` +
      `punkte=${befund.punkte} gruppen=${befund.tragendeGruppen}/6 ` +
      `geloescht=${geloescht ? 'ja' : 'nein'} gesperrt=${gesperrt ? gesperrtInGruppen : 'nein'}` +
      (panik ? ' (PANIKMODUS: nichts durchgesetzt)' : '')
    );

    await melde(ctx, userId, gruppentitel, urteil, befund, text, !gesperrt,
                gesperrt ? gesperrtInGruppen : undefined, geloescht, panik);

    return { massnahme: urteil.massnahme, grund: urteil.grund, erledigt: geloescht };
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
  befund: { punkte: number; tragendeGruppen: number; eingesessen?: boolean },
  text: string, nurMeldung: boolean, gruppen?: number,
  geloescht: boolean = false, panik: boolean = false
): Promise<void> {
  try {
    const { Markup } = await import('telegraf');
    const schwer = befund.tragendeGruppen >= 3;

    let m = nurMeldung
      ? (geloescht
          ? '🪙 <b>Krypto-Ankaufangebot entfernt — bitte prüfen</b>\n\n'
          : schwer
            ? '🪙 <b>KRYPTO-ANKAUF-BETRUG — bitte entscheiden</b>\n\n'
            : '⚠️ <b>Verdacht: Krypto-Ankaufangebot</b>\n\n')
      : '🚫 <b>GESPERRT: Krypto-Ankauf-Betrug</b>\n\n';

    m += `🆔 User ID: <code>${userId}</code>\n`;
    if (ctx.from?.username) m += `👤 Benutzername: @${esc(ctx.from.username)}\n`;
    const anzeige = `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim();
    if (anzeige) m += `📛 Anzeigename: <code>${esc(anzeige)}</code>\n`;
    if (gruppentitel) m += `📍 Gruppe: <b>${esc(gruppentitel)}</b>\n`;
    m += `📊 ${befund.punkte} Punkte, ${befund.tragendeGruppen} von 6 tragenden Merkmalen\n`;
    if (befund.eingesessen) {
      m += `🧑‍🤝‍🧑 <b>Eingesessenes Mitglied — wird von dieser Regel nie gesperrt.</b>\n`;
    }
    m += '\n';
    m += `<b>Gefunden:</b>\n${urteil.belege.slice(0, 8).map(b => `• ${esc(b)}`).join('\n')}\n`;
    m += `\n<b>Nachricht im Wortlaut:</b>\n<code>${esc(text.substring(0, 600))}</code>\n`;

    if (panik) {
      m += `\n<i>Panikmodus: es wurde nichts gelöscht und niemand gesperrt.</i>`;
    } else if (typeof gruppen === 'number') {
      m += `\n🗑 Nachricht entfernt.\n🚫 In ${gruppen} Gruppen gesperrt — mit dem Knopf unten rückholbar.`;
    } else {
      m += geloescht ? `\n🗑 Nachricht entfernt, <i>niemand gesperrt.</i>`
                     : `\n<i>Es wurde nichts gelöscht und niemand gesperrt.</i>`;
      if (schwer && !geloescht) m += `\n<i>Die Knöpfe unten führen die Maßnahme aus.</i>`;
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
