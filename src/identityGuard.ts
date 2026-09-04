/**
 * identityGuard.ts — Durchsetzung des Impersonations-Schutzes
 *
 * Wird beim Beitritt und bei der ersten Nachricht eines Users aufgerufen.
 * Läuft in drei Schritten:
 *   1. Namensanalyse (billig, lokal)
 *   2. Profilfoto-Fingerabdruck über getChat (ein API-Call, nur wenn nötig)
 *   3. Entscheidung + Durchsetzung + Protokoll
 *
 * Grundsatz: Ein automatischer Ban erfolgt nur bei Beweis — entweder identisches
 * Profilfoto wie ein geschützter Account, oder ein buchstabengenauer Namenstreffer,
 * der erst nach dem Entfernen von Verschleierungszeichen zustande kommt.
 * Reine Namensähnlichkeit erzeugt ausschließlich einen Alarm.
 */

import { Context } from 'telegraf';
import { config, isPanicMode } from './config';
import { analyzeIdentity, decideImpersonation, IdentityAnalysis } from './identity';
import { logIdentityEvent } from './db';

/** Wie lange ein Foto-Fingerabdruck zwischengespeichert wird (ms) */
const PHOTO_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 Stunden
/** Wie lange nach einem Alarm für denselben User kein neuer Alarm ausgelöst wird (ms) */
const ALARM_COOLDOWN = 24 * 60 * 60 * 1000;
/**
 * Nach wie vielen Tagen eine vorgemerkte Username-Sperre verfällt.
 * Telegram gibt Benutzernamen gelöschter Konten wieder frei — eine unbefristete
 * Vormerkung würde irgendwann den falschen Menschen treffen.
 */
const PENDING_MAX_AGE_DAYS = 90;

const photoCache = new Map<number, { fingerprint: string | null; at: number }>();
const alarmCooldown = new Map<number, number>();

/** Begrenzt das Wachstum der Caches */
function prune(map: Map<number, any>, maxSize = 5000): void {
  if (map.size <= maxSize) return;
  const cutoff = map.size - maxSize;
  let i = 0;
  for (const key of map.keys()) {
    if (i++ >= cutoff) break;
    map.delete(key);
  }
}

/**
 * Holt den Profilfoto-Fingerabdruck, mit Cache.
 * Ein Fehlschlag (Privatsphäre, unbekannter Chat) liefert null und ist KEIN Signal.
 */
async function getPhotoFingerprint(telegram: any, userId: number): Promise<string | null> {
  const cached = photoCache.get(userId);
  if (cached && Date.now() - cached.at < PHOTO_CACHE_TTL) {
    return cached.fingerprint;
  }
  const { getProfilePhotoFingerprint } = await import('./telegram');
  const res = await getProfilePhotoFingerprint(telegram, userId);

  // Nur ERFOLGREICHE Abfragen zwischenspeichern. Ein vorübergehender Fehler
  // (429, Netzwerk) würde sonst den Fotoabgleich für diesen User 6 Stunden lang
  // ausblenden — genau in dem Zeitfenster, in dem ein Angreifer aktiv ist.
  if (res.ok) {
    photoCache.set(userId, { fingerprint: res.fingerprint, at: Date.now() });
    prune(photoCache);
  }
  return res.fingerprint;
}

export interface GuardResult {
  action: 'none' | 'alarm' | 'ban';
  reason: string;
  /** true, wenn der User gesperrt wurde und die weitere Verarbeitung entfallen kann */
  handled: boolean;
}

/**
 * Prüft einen User auf Identitäts-Täuschung und setzt die Maßnahme durch.
 *
 * @param source 'join' | 'message' | 'rename' | 'scan' — nur für das Protokoll
 */
export async function guardIdentity(
  ctx: Context | null,
  telegram: any,
  userId: number,
  chatId: string | null,
  groupTitle: string,
  userInfo: { username?: string | null; firstName?: string | null; lastName?: string | null },
  source: string
): Promise<GuardResult> {
  const none: GuardResult = { action: 'none', reason: '', handled: false };

  try {
    // Der echte Account und alle Admins sind immer ausgenommen
    if (config.protectedUserIds.includes(userId)) return none;
    const { isAdmin } = await import('./admin');
    if (isAdmin(userId)) return none;
    const { isTeamMember, isIdentityExempt } = await import('./db');
    if (isTeamMember(userId)) return none;

    // Wer per /pardon entsperrt wurde, wird nicht erneut automatisch gesperrt.
    // Ohne diese Prüfung wäre jede Rücknahme beim nächsten Beitritt hinfällig.
    if (isIdentityExempt(userId)) {
      console.log(`[Identity][EXEMPT] user=${userId} ist von der Automatik ausgenommen`);
      return none;
    }

    // Gruppen-Admins und -Inhaber sind ebenfalls ausgenommen. Ohne diese Prüfung
    // würde ein Moderator, der nicht in ADMIN_IDS steht (z.B. "Geldhelden Support"),
    // in den 61 anderen Gruppen gesperrt.
    if (chatId) {
      try {
        const { isUserAdminOrCreatorInGroup } = await import('./telegram');
        const groupAdmin = await isUserAdminOrCreatorInGroup(chatId, userId, telegram);
        if (groupAdmin.isAdmin) return none;
      } catch {
        // Prüfung fehlgeschlagen — im Zweifel weiterprüfen, der Ban braucht ohnehin
        // einen Beweis (Foto oder nachgewiesene Verschleierung).
      }
    }

    // 1. Namensanalyse
    const analysis: IdentityAnalysis = analyzeIdentity(
      userInfo.firstName,
      userInfo.lastName,
      userInfo.username,
      config.protectedNames,
      config.impersonationSimilarityThreshold
    );

    // 2. Fotoabgleich — nur wenn Referenzfotos konfiguriert sind UND die echten
    //    Accounts bekannt sind (sonst würde sich der echte Account selbst sperren)
    let photoMatch = false;
    let fingerprint: string | null = null;
    const photoCheckEnabled =
      config.protectedPhotoIds.length > 0 && config.protectedUserIds.length > 0;

    if (photoCheckEnabled) {
      fingerprint = await getPhotoFingerprint(telegram, userId);
      if (fingerprint && config.protectedPhotoIds.includes(fingerprint)) {
        photoMatch = true;
      }
    }

    // 3. Entscheidung
    const verdict = decideImpersonation(analysis, photoMatch, userId, config.protectedUserIds);

    if (verdict.action === 'none') return none;

    // Protokoll IMMER schreiben, auch im Dry-Run und bei Panic
    logIdentityEvent({
      userId,
      chatId,
      source,
      action: verdict.action,
      confidence: verdict.confidence,
      reason: verdict.reason,
      matchedName: analysis.matchedName,
      similarity: analysis.similarity,
      matchType: analysis.matchType,
      invisibleChars: analysis.invisibleChars,
      mixedScript: analysis.mixedScript,
      photoMatch,
      photoFingerprint: fingerprint,
      username: userInfo.username || null,
      firstName: userInfo.firstName || null,
      lastName: userInfo.lastName || null,
    });

    // --- Ban ---
    if (verdict.action === 'ban') {
      if (!config.impersonationAutoBan) {
        console.log(`[Identity][BAN-BEREIT] user=${userId} ${verdict.reason} — IMPERSONATION_AUTO_BAN ist aus, nur Alarm`);
        await sendAlarm(telegram, userId, chatId, groupTitle, verdict.reason, analysis, photoMatch, true);
        return { action: 'alarm', reason: verdict.reason, handled: false };
      }
      if (isPanicMode()) {
        console.log(`[Identity][PANIC] user=${userId} Ban unterdrückt: ${verdict.reason}`);
        await sendAlarm(telegram, userId, chatId, groupTitle, verdict.reason, analysis, photoMatch, true);
        return { action: 'alarm', reason: verdict.reason, handled: false };
      }

      const { banUserGlobally } = await import('./telegram');
      const result = await banUserGlobally(userId, `Identitäts-Täuschung: ${verdict.reason}`);
      console.log(`[Identity][BAN] user=${userId} groups=${result.groups} reason=${verdict.reason}`);

      await sendAlarm(telegram, userId, chatId, groupTitle, verdict.reason, analysis, photoMatch, false, result.groups);
      return { action: 'ban', reason: verdict.reason, handled: result.success };
    }

    // --- Alarm ---
    const last = alarmCooldown.get(userId);
    if (last && Date.now() - last < ALARM_COOLDOWN) {
      return { action: 'alarm', reason: verdict.reason, handled: false };
    }
    alarmCooldown.set(userId, Date.now());
    prune(alarmCooldown);

    await sendAlarm(telegram, userId, chatId, groupTitle, verdict.reason, analysis, photoMatch, true);
    return { action: 'alarm', reason: verdict.reason, handled: false };
  } catch (error: unknown) {
    console.error('[Identity] Fehler in guardIdentity:', error instanceof Error ? error.message : String(error));
    return none;
  }
}

/** Meldung in den Admin-Log-Chat, mit Aktions-Buttons */
async function sendAlarm(
  telegram: any,
  userId: number,
  chatId: string | null,
  groupTitle: string,
  reason: string,
  analysis: IdentityAnalysis,
  photoMatch: boolean,
  isSuspicionOnly: boolean,
  groupsBanned?: number
): Promise<void> {
  try {
    const { Markup } = await import('telegraf');
    const header = isSuspicionOnly
      ? '⚠️ <b>VERDACHT: Identitäts-Täuschung</b>'
      : '🚫 <b>GESPERRT: Identitäts-Täuschung</b>';

    let msg = `${header}\n\n`;
    msg += `🆔 User ID: <code>${userId}</code>\n`;
    if (groupTitle) msg += `📍 Gruppe: <b>${groupTitle}</b>\n`;
    msg += `📝 Grund: ${reason}\n`;
    if (photoMatch) msg += `🖼 <b>Profilfoto identisch mit geschütztem Account</b>\n`;
    if (analysis.mixedScript) msg += `🔤 Gemischte Schriftsysteme im Namen\n`;
    if (analysis.invisibleChars) msg += `👻 Unsichtbare Steuerzeichen im Namen\n`;
    if (typeof groupsBanned === 'number') msg += `\n✅ In ${groupsBanned} Gruppen gesperrt.\n`;
    msg += `\n🔗 https://t.me/user?id=${userId}`;

    if (isSuspicionOnly) {
      msg += `\n\n<i>Kein automatischer Ban — Namensähnlichkeit allein ist kein Beweis.</i>`;
    }

    const keyboard = isSuspicionOnly
      ? Markup.inlineKeyboard([[
          Markup.button.callback('🔴 BAN USER', `ban_user:${userId}:${chatId || ''}`),
          Markup.button.callback('🟡 BEOBACHTEN', `observe_user:${userId}:${chatId || ''}`),
        ]])
      : Markup.inlineKeyboard([[
          Markup.button.callback('↩️ SPERRE AUFHEBEN', `pardon_user:${userId}`),
        ]]);

    await telegram.sendMessage(config.adminLogChat, msg, {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
      disable_web_page_preview: true,
    });
  } catch (error: unknown) {
    console.error('[Identity] Alarm konnte nicht gesendet werden:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Wertet die pending_username_blacklist aus.
 *
 * Wenn ein Admin `/ban @name` für einen unbekannten Username abgesetzt hat, landet
 * der Name in pending_username_blacklist mit der Zusage "sobald dieser User
 * irgendwo sichtbar wird, wird er automatisch global gebannt". Diese Auswertung
 * fehlte bisher komplett — die Zusage wurde nie eingelöst.
 *
 * @returns true, wenn der User gesperrt wurde
 */
export async function checkPendingUsernameBan(
  telegram: any,
  userId: number,
  username: string | null | undefined,
  chatId: string | null,
  source: string
): Promise<boolean> {
  if (!username) return false;

  try {
    const {
      isPendingUsernameBlacklisted, getPendingUsernameBlacklistEntry,
      removePendingUsernameBlacklist, addToBlacklist, logPendingBan,
      isTeamMember, isIdentityExempt,
    } = await import('./db');
    const { isAdmin } = await import('./admin');

    if (config.protectedUserIds.includes(userId)) return false;
    if (isAdmin(userId) || isTeamMember(userId) || isIdentityExempt(userId)) return false;
    if (!isPendingUsernameBlacklisted(username)) return false;

    const pending = getPendingUsernameBlacklistEntry(username);
    if (!pending) return false;

    // Verfallsfrist gegen Username-Recycling.
    // Telegram gibt Benutzernamen gelöschter Konten wieder frei. Ohne Frist
    // würde ein Mitglied, das Monate später einen freigewordenen Namen übernimmt,
    // allein wegen der Zeichenkette in 62 Gruppen gesperrt.
    const ageDays = (Date.now() - pending.created_at) / 86400000;
    if (ageDays > PENDING_MAX_AGE_DAYS) {
      removePendingUsernameBlacklist(username);
      console.log(`[PendingBan] @${username} verfallen (${ageDays.toFixed(0)} Tage alt) — Eintrag entfernt, kein Ban`);
      try {
        await telegram.sendMessage(
          config.adminLogChat,
          `ℹ️ Vorgemerkter Username-Ban <code>@${username}</code> ist nach ${ageDays.toFixed(0)} Tagen verfallen ` +
            `und wurde entfernt. Grund: Benutzernamen werden von Telegram wiederverwendet — ` +
            `der heutige Inhaber (<code>${userId}</code>) ist mit hoher Wahrscheinlichkeit nicht der gemeinte.`,
          { parse_mode: 'HTML' }
        );
      } catch { /* nicht kritisch */ }
      return false;
    }

    // ERST sperren, DANN den Vormerk-Eintrag verbrauchen.
    // Andersherum ginge die Vormerkung verloren, falls der Ban nicht durchläuft.
    const { banUserGlobally } = await import('./telegram');
    const result = await banUserGlobally(userId, `Vorgemerkter Username-Ban: @${username}`, true);

    if (!result.success && result.skipped) {
      console.log(`[PendingBan] @${username} -> user=${userId}: Ban übersprungen (${result.skipReason}) — Vormerkung bleibt bestehen`);
      return false;
    }

    addToBlacklist(userId, pending.created_by, pending.reason);
    removePendingUsernameBlacklist(username);
    const converted = { reason: pending.reason };

    logPendingBan(userId, username, chatId, source, converted.reason, result.groups);
    console.log(`[PendingBan] @${username} -> user=${userId} in ${result.groups} Gruppen gesperrt (${source})`);

    try {
      const { Markup } = await import('telegraf');
      await telegram.sendMessage(
        config.adminLogChat,
        `🚫 <b>Vorgemerkter Username-Ban ausgeführt</b>\n\n` +
          `📛 Username: <code>@${username}</code>\n` +
          `🆔 User ID: <code>${userId}</code>\n` +
          `📍 Erkannt bei: ${source}\n` +
          `📝 Ursprünglicher Grund: ${converted.reason || 'unbekannt'}\n` +
          `✅ In ${result.groups} Gruppen gesperrt.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[
            Markup.button.callback('↩️ SPERRE AUFHEBEN', `pardon_user:${userId}`),
          ]]).reply_markup,
        }
      );
    } catch {
      /* Meldung ist nicht kritisch */
    }

    return result.success;
  } catch (error: unknown) {
    console.error('[PendingBan] Fehler:', error instanceof Error ? error.message : String(error));
    return false;
  }
}
