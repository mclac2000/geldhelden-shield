/**
 * copyTradingGuard.ts — Durchsetzung der Copy-Trading-Erkennung
 *
 * DREI DINGE, DIE HIER ANDERS SIND ALS IN DEN ÜBRIGEN PRÜFUNGEN:
 *
 * 1. DER TEXT STECKT IN DER BILDUNTERSCHRIFT.
 *    Dieser Scam kommt als Album aus zwei Bildern mit einer kurzen
 *    Bildunterschrift. Wer nur `message.text` liest, sieht eine leere
 *    Nachricht und lässt sie durch — bei der englischen Gobinar-Übersetzung
 *    und beim Geckli-Agenten ist auf genau diese Weise schon einmal alles
 *    lautlos verlorengegangen. Hier wird `caption` gelesen, und die
 *    Erwähnungen kommen aus `caption_entities`, nicht aus `entities`.
 *
 * 2. EIN ALBUM IST MEHRERE NACHRICHTEN, DIE UNTERSCHRIFT HAT NUR EINE.
 *    Telegram schickt jedes Bild eines Albums als eigene Nachricht mit
 *    gemeinsamer `media_group_id`. Nur eine davon trägt die Bildunterschrift.
 *    Wer nur diese löscht, lässt das zweite Gewinnbild — samt QR-Code und
 *    Werbecode — in der Gruppe stehen. Deshalb führt diese Datei ein kurzes
 *    Gedächtnis über Alben und löscht die Geschwister mit; Geschwister, die
 *    erst NACH der Erkennung ankommen, werden über eine Merkliste ebenfalls
 *    erfasst.
 *
 * 3. ES GIBT DREI STUFEN, NICHT ZWEI.
 *    sperren = löschen und global sperren. loeschen = löschen und vorlegen.
 *    melden = nur vorlegen, nichts angefasst. Eine gelöschte Nachricht eines
 *    echten Mitglieds ist teurer als ein durchgerutschter Spam: Sie ist weg,
 *    das Mitglied merkt es, und niemand erfährt warum.
 *
 * Jede Maßnahme steht in copy_trading_events und ist über den Knopf in der
 * Meldung rückholbar.
 */

import { Context } from 'telegraf';
import { config } from './config';
import {
  bewerteCopyTrading, entscheideCopyTrading,
  CopyTradingMassnahme, Absender,
} from './copyTradingRisk';

export interface CopyTradingErgebnis {
  massnahme: CopyTradingMassnahme;
  grund: string;
  /** true, wenn weitere Prüfungen übersprungen werden sollen (Nachricht ist weg). */
  erledigt: boolean;
}

const KEINE: CopyTradingErgebnis = { massnahme: 'keine', grund: '', erledigt: false };

// ---------------------------------------------------------------------------
// Albumgedächtnis
// ---------------------------------------------------------------------------
// Klein, im Arbeitsspeicher, zwei Minuten. Ein Album kommt in Sekunden an;
// was länger her ist, gehört nicht mehr dazu. Beides absichtlich flüchtig:
// Ein Neustart des Bots darf keine alten Löschaufträge wiederbeleben.

const ALBUM_TTL_MS = 2 * 60 * 1000;
const albumNachrichten = new Map<string, { ids: number[]; zeit: number }>();
const verbrannteAlben = new Map<string, number>();

function albumSchluessel(chatId: string, mediaGroupId: string): string {
  return `${chatId}:${mediaGroupId}`;
}

function aufraeumen(): void {
  const grenze = Date.now() - ALBUM_TTL_MS;
  for (const [k, v] of albumNachrichten) if (v.zeit < grenze) albumNachrichten.delete(k);
  for (const [k, t] of verbrannteAlben) if (t < grenze) verbrannteAlben.delete(k);
}

function merkeAlbumNachricht(chatId: string, mediaGroupId: string, messageId: number): void {
  aufraeumen();
  const k = albumSchluessel(chatId, mediaGroupId);
  const e = albumNachrichten.get(k);
  if (e) {
    if (!e.ids.includes(messageId)) e.ids.push(messageId);
    e.zeit = Date.now();
  } else {
    albumNachrichten.set(k, { ids: [messageId], zeit: Date.now() });
  }
}

function albumGeschwister(chatId: string, mediaGroupId: string, ausser: number): number[] {
  const e = albumNachrichten.get(albumSchluessel(chatId, mediaGroupId));
  return e ? e.ids.filter(id => id !== ausser) : [];
}

// ---------------------------------------------------------------------------

export async function pruefeCopyTrading(ctx: Context): Promise<CopyTradingErgebnis> {
  try {
    if (!config.copyTradingCheckEnabled) return KEINE;

    const msg: any = ctx.message || ('edited_message' in (ctx.update as any) ? (ctx.update as any).edited_message : null);
    if (!msg || !ctx.from || ctx.from.is_bot) return KEINE;
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return KEINE;

    const chatId = String(chat.id);
    const messageId: number = msg.message_id;
    const mediaGroupId: string | null = msg.media_group_id ? String(msg.media_group_id) : null;

    // Jede Albumnachricht wird gemerkt — auch die ohne Unterschrift, auch
    // wenn sie selbst völlig harmlos aussieht. Genau die ist später das
    // zweite Gewinnbild, das sonst stehen bleibt.
    if (mediaGroupId) merkeAlbumNachricht(chatId, mediaGroupId, messageId);

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

    // Ein Geschwisterbild eines bereits erkannten Albums: sofort weg, ohne
    // neue Bewertung und ohne zweite Meldung.
    if (mediaGroupId) {
      aufraeumen();
      if (verbrannteAlben.has(albumSchluessel(chatId, mediaGroupId))) {
        const { deleteMessage } = await import('./telegram');
        await deleteMessage(chatId, messageId).catch(() => false);
        console.log(`[CopyTrading] Geschwisterbild entfernt chat=${chatId} msg=${messageId}`);
        return { massnahme: 'loeschen', grund: 'Geschwisterbild eines erkannten Albums', erledigt: true };
      }
    }

    // ---- DER TEXT: erst text, dann caption. Nie nur eines von beiden. ----
    const ausBildunterschrift = !msg.text && typeof msg.caption === 'string';
    const text: string = msg.text || msg.caption || '';
    if (!text.trim()) return KEINE;

    // ---- Wer schreibt ----
    const { leseNachrichtenStand } = await import('./db');
    let kontoAlterTage: number | null = null;
    try {
      const { estimateAccountAgeDays } = await import('./accountAge');
      kontoAlterTage = estimateAccountAgeDays(userId);
    } catch { /* Alter ist eine Schätzung, kein Muss */ }
    const absender: Absender = {
      nachrichtenInGruppe: leseNachrichtenStand(userId, chatId),
      kontoAlterTage,
    };

    const befund = bewerteCopyTrading(text, { alsBildunterschrift: ausBildunterschrift, absender });
    const urteil = entscheideCopyTrading(befund);
    if (urteil.massnahme === 'keine') return KEINE;

    const chatTitel = 'title' in chat ? chat.title || '' : '';
    const anzeigename = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();

    // ---- Durchsetzung ----
    const { deleteMessage, banUserGlobally } = await import('./telegram');
    const { isPanicMode } = await import('./config');
    const panik = isPanicMode();

    let geloescht = false;
    let geloeschteNachrichten = 0;
    let gesperrt = false;
    let gesperrtInGruppen = 0;

    const sollLoeschen = (urteil.massnahme === 'loeschen' || urteil.massnahme === 'sperren') && !panik;

    if (sollLoeschen) {
      if (await deleteMessage(chatId, messageId).catch(() => false)) {
        geloescht = true;
        geloeschteNachrichten++;
      }
      // Das ganze Album, nicht nur die Nachricht mit der Unterschrift.
      if (mediaGroupId) {
        verbrannteAlben.set(albumSchluessel(chatId, mediaGroupId), Date.now());
        for (const id of albumGeschwister(chatId, mediaGroupId, messageId)) {
          if (await deleteMessage(chatId, id).catch(() => false)) geloeschteNachrichten++;
        }
      }
    }

    if (urteil.massnahme === 'sperren' && config.copyTradingAutoBan && !panik) {
      try {
        const r = await banUserGlobally(userId, `Copy-Trading-Betrug: ${urteil.grund}`);
        gesperrt = true;
        gesperrtInGruppen = r.groups ?? 0;
      } catch (e: any) {
        console.error('[CopyTrading] Sperre fehlgeschlagen:', e?.message);
      }
    }

    const durchgesetzt = geloescht || gesperrt;

    const { logCopyTradingEvent } = await import('./db');
    logCopyTradingEvent({
      userId, chatId, chatTitel, messageId, mediaGroupId,
      username: ctx.from.username ?? null, anzeigename,
      punkte: befund.punkte, tragendeGruppen: befund.tragendeGruppen,
      leitsignal: befund.leitsignal, eingesessen: befund.eingesessen,
      nachrichtenInGruppe: absender.nachrichtenInGruppe, kontoAlterTage,
      massnahme: urteil.massnahme, grund: urteil.grund,
      signale: befund.signale, belege: urteil.belege,
      text, ausBildunterschrift,
      geloescht, geloeschteNachrichten, gesperrt, gesperrtInGruppen, durchgesetzt,
    });

    console.log(
      `[CopyTrading][${urteil.massnahme.toUpperCase()}] user=${userId} chat=${chatId} ` +
      `punkte=${befund.punkte} gruppen=${befund.tragendeGruppen}/5 ` +
      `geloescht=${geloeschteNachrichten} gesperrt=${gesperrt ? gesperrtInGruppen : 'nein'}` +
      (panik ? ' (PANIKMODUS: nichts durchgesetzt)' : '')
    );

    await melde(ctx, {
      userId, chatTitel, anzeigename, urteil, befund, text,
      geloeschteNachrichten, gesperrt, gesperrtInGruppen, panik, ausBildunterschrift,
    });

    return { massnahme: urteil.massnahme, grund: urteil.grund, erledigt: geloescht };
  } catch (error: unknown) {
    console.error('[CopyTrading] Fehler:', error instanceof Error ? error.message : String(error));
    return KEINE;
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function melde(ctx: Context, d: {
  userId: number; chatTitel: string; anzeigename: string;
  urteil: { massnahme: CopyTradingMassnahme; grund: string; belege: string[] };
  befund: { punkte: number; tragendeGruppen: number; eingesessen: boolean; hebel: number | null };
  text: string; geloeschteNachrichten: number; gesperrt: boolean;
  gesperrtInGruppen: number; panik: boolean; ausBildunterschrift: boolean;
}): Promise<void> {
  try {
    const { Markup } = await import('telegraf');

    const kopf = d.gesperrt
      ? '🚫 <b>GESPERRT: Copy-Trading-Betrug</b>\n\n'
      : d.urteil.massnahme === 'sperren'
        ? '📈 <b>COPY-TRADING-BETRUG — Sperre nicht ausgeführt</b>\n\n'
        : d.urteil.massnahme === 'loeschen'
          ? '📈 <b>Copy-Trading-Werbung entfernt — bitte prüfen</b>\n\n'
          : '⚠️ <b>Verdacht: Copy-Trading-Werbung</b>\n\n';

    let m = kopf;
    m += `🆔 User ID: <code>${d.userId}</code>\n`;
    if (ctx.from?.username) m += `👤 Benutzername: @${esc(ctx.from.username)}\n`;
    if (d.anzeigename) m += `📛 Anzeigename: <code>${esc(d.anzeigename)}</code>\n`;
    if (d.chatTitel) m += `📍 Gruppe: <b>${esc(d.chatTitel)}</b>\n`;
    m += `📊 ${d.befund.punkte} Punkte, ${d.befund.tragendeGruppen} von 5 tragenden Merkmalen\n`;
    if (d.befund.hebel !== null) m += `📐 Höchster genannter Hebel: ${d.befund.hebel}x\n`;
    if (d.befund.eingesessen) m += `🧑‍🤝‍🧑 <b>Eingesessenes Mitglied — wird von dieser Regel nie gesperrt.</b>\n`;
    if (d.ausBildunterschrift) m += `🖼 Text kam als <b>Bildunterschrift</b>\n`;
    m += '\n';

    m += `<b>Gefunden:</b>\n${d.urteil.belege.slice(0, 9).map(b => `• ${esc(b)}`).join('\n')}\n`;
    m += `\n<b>Wortlaut:</b>\n<code>${esc(d.text.substring(0, 600))}</code>\n\n`;

    if (d.panik) {
      m += `<i>Panikmodus: es wurde nichts gelöscht und niemand gesperrt.</i>`;
    } else {
      m += d.geloeschteNachrichten > 0
        ? `🗑 ${d.geloeschteNachrichten} Nachricht${d.geloeschteNachrichten === 1 ? '' : 'en'} entfernt`
          + (d.geloeschteNachrichten > 1 ? ' (ganzes Album).' : '.') + '\n'
        : `<i>Es wurde nichts gelöscht.</i>\n`;
      m += d.gesperrt
        ? `🚫 In ${d.gesperrtInGruppen} Gruppen gesperrt — mit dem Knopf unten rückholbar.`
        : `<i>Niemand gesperrt.</i>`;
    }

    const knopf = d.gesperrt
      ? [[Markup.button.callback('↩️ SPERRE AUFHEBEN', `pardon_user:${d.userId}`)]]
      : [[Markup.button.callback('🔴 KONTO SPERREN', `profil_ban:${d.userId}`),
          Markup.button.callback('✅ HARMLOS', `pardon_user:${d.userId}`)]];

    await ctx.telegram.sendMessage(config.adminLogChat, m, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(knopf).reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[CopyTrading] Meldung fehlgeschlagen:', e?.message);
  }
}

/** Nur für Prüfskripte: setzt das Albumgedächtnis zurück. */
export const _intern = { albumNachrichten, verbrannteAlben, merkeAlbumNachricht, albumGeschwister };
