/**
 * profileGuard.ts — Durchsetzung der Profilprüfung beim Beitritt
 *
 * Holt Bio und Profilbild über getChat, wertet sie mit profileRisk aus und
 * setzt die Maßnahme durch. Jede Entscheidung wird mit dem gefundenen Text
 * protokolliert (profile_events), damit ein Fehlalarm nachvollziehbar und über
 * den Knopf in der Meldung rücknehmbar ist.
 */

import { Context } from 'telegraf';
import { config } from './config';
import { analysiereProfil, entscheideProfil, ProfilBefund } from './profileRisk';

export interface ProfilPruefErgebnis {
  massnahme: 'keine' | 'alarm' | 'sperren';
  grund: string;
  /** true, wenn gesperrt wurde und die weitere Verarbeitung entfallen kann */
  erledigt: boolean;
}

const KEINE: ProfilPruefErgebnis = { massnahme: 'keine', grund: '', erledigt: false };

/**
 * Prüft das Profil eines Users.
 *
 * @param source 'join' | 'message' | 'rename' — nur für das Protokoll
 */
export async function pruefeProfil(
  telegram: any,
  userId: number,
  chatId: string | null,
  groupTitle: string,
  username: string | null | undefined,
  source: string
): Promise<ProfilPruefErgebnis> {
  try {
    if (!config.profileCheckEnabled) return KEINE;

    // Ausnahmen zuerst — dieselben wie überall im System
    if (config.protectedUserIds.includes(userId)) return KEINE;
    const { isAdmin } = await import('./admin');
    if (isAdmin(userId)) return KEINE;
    const {
      isTeamMember, isIdentityExempt, isLinkAllowlisted, saveUserProfile,
      getUsersWithSamePhoto, logProfileEvent,
    } = await import('./db');
    if (isTeamMember(userId) || isIdentityExempt(userId)) return KEINE;
    if (chatId) {
      try {
        const { isUserAdminOrCreatorInGroup } = await import('./telegram');
        if ((await isUserAdminOrCreatorInGroup(chatId, userId, telegram)).isAdmin) return KEINE;
      } catch { /* im Zweifel weiterprüfen */ }
    }

    // Profil holen. Ein Fehlschlag ist KEIN Signal — bei privaten Einstellungen
    // liefert Telegram schlicht nichts.
    let bio: string | null = null;
    let foto: string | null = null;
    let privateForwards: boolean | null = null;
    try {
      const chat: any = await telegram.getChat(userId);
      bio = chat?.bio ?? null;
      foto = chat?.photo?.big_file_unique_id ?? null;
      privateForwards = chat?.has_private_forwards ?? null;
    } catch {
      return KEINE;
    }

    // Profil merken — auch das ist die Grundlage für die Bild-Dubletten-Erkennung
    saveUserProfile(userId, bio, foto, privateForwards);

    const dubletten = foto ? getUsersWithSamePhoto(foto, userId) : [];

    const befund: ProfilBefund = analysiereProfil({
      bio, username, istLinkFreigegeben: isLinkAllowlisted, fotoDublettenIds: dubletten,
    });
    const urteil = entscheideProfil(befund, config.profileStrictMode);

    if (urteil.massnahme === 'keine') return KEINE;

    logProfileEvent(userId, chatId, urteil.massnahme, urteil.grund, urteil.belege, bio, username ?? null);

    if (urteil.massnahme === 'sperren') {
      const { isPanicMode } = await import('./config');
      if (!config.profileAutoBan) {
        console.log(`[Profil][SPERRE-BEREIT] user=${userId} ${urteil.grund} — PROFILE_AUTO_BAN ist aus, nur Meldung`);
        await melde(telegram, userId, chatId, groupTitle, urteil, bio, username, true);
        return { massnahme: 'alarm', grund: urteil.grund, erledigt: false };
      }
      if (isPanicMode()) {
        console.log(`[Profil][PANIC] user=${userId} Sperre unterdrückt: ${urteil.grund}`);
        await melde(telegram, userId, chatId, groupTitle, urteil, bio, username, true);
        return { massnahme: 'alarm', grund: urteil.grund, erledigt: false };
      }

      const { banUserGlobally } = await import('./telegram');
      const r = await banUserGlobally(userId, `Profilprüfung: ${urteil.grund}`);
      console.log(`[Profil][SPERRE] user=${userId} groups=${r.groups} grund=${urteil.grund}`);
      await melde(telegram, userId, chatId, groupTitle, urteil, bio, username, false, r.groups);
      return { massnahme: 'sperren', grund: urteil.grund, erledigt: r.success };
    }

    await melde(telegram, userId, chatId, groupTitle, urteil, bio, username, true);
    return { massnahme: 'alarm', grund: urteil.grund, erledigt: false };
  } catch (error: unknown) {
    console.error('[Profil] Fehler:', error instanceof Error ? error.message : String(error));
    return KEINE;
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function melde(
  telegram: any, userId: number, chatId: string | null, groupTitle: string,
  urteil: { grund: string; belege: string[] }, bio: string | null,
  username: string | null | undefined, nurVerdacht: boolean, gruppen?: number
): Promise<void> {
  try {
    const { Markup } = await import('telegraf');
    let m = nurVerdacht
      ? '⚠️ <b>VERDACHT: Anwerbe-Profil</b>\n\n'
      : '🚫 <b>GESPERRT: Anwerbe-Profil</b>\n\n';
    m += `🆔 User ID: <code>${userId}</code>\n`;
    if (username) m += `👤 Benutzername: @${esc(username)}\n`;
    if (groupTitle) m += `📍 Beitritt in: <b>${esc(groupTitle)}</b>\n`;
    m += `📝 Grund: ${esc(urteil.grund)}\n\n`;
    m += `<b>Gefunden:</b>\n${urteil.belege.map(b => `• ${esc(b)}`).join('\n')}\n`;
    if (bio) m += `\n<b>Bio im Wortlaut:</b>\n<code>${esc(bio.substring(0, 300))}</code>\n`;
    if (typeof gruppen === 'number') m += `\n✅ In ${gruppen} Gruppen gesperrt.`;
    if (nurVerdacht) m += `\n<i>Es wurde niemand gesperrt.</i>`;

    const knopf = nurVerdacht
      ? [[Markup.button.callback('🔴 JETZT SPERREN', `profil_ban:${userId}`),
          Markup.button.callback('✅ HARMLOS', `pardon_user:${userId}`)]]
      : [[Markup.button.callback('↩️ SPERRE AUFHEBEN', `pardon_user:${userId}`)]];

    await telegram.sendMessage(config.adminLogChat, m, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(knopf).reply_markup,
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[Profil] Meldung fehlgeschlagen:', e.message);
  }
}
