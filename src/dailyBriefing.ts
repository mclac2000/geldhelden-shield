/**
 * Daily Briefing – Täglicher Status-Report für den Admin
 *
 * Sendet jeden Tag um 08:00 Uhr einen Report direkt an @mclac2000 mit:
 * - Zusammenfassung der letzten 24h
 * - Liste aller Restricts mit Kontext
 * - Inline-Buttons zum Entsperren bei False Positives
 * - Anomalie-Warnungen
 */

import { Telegraf, Markup } from 'telegraf';
import {
  getDatabase,
  Action,
  User,
  Join,
} from './db';

// Deine Telegram User-ID
const ADMIN_USER_ID = 382863507;

// Callback-Prefix für Unrestrict-Buttons
export const UNRESTRICT_CALLBACK_PREFIX = 'unrestrict:';

/**
 * Statistiken für den Daily Report
 */
interface DailyStats {
  periodStart: Date;
  periodEnd: Date;
  totalJoins: number;
  totalRestricts: number;
  totalBans: number;
  totalUnrestricts: number;
  welcomesSent: number;
  uniqueGroups: number;
  restrictsDetails: RestrictDetail[];
  anomalies: string[];
}

/**
 * Details zu einem Restrict für die Kontrolle
 */
interface RestrictDetail {
  actionId: number;
  userId: number;
  username: string | null;
  firstName: string | null;
  chatId: string;
  chatTitle: string | null;
  reason: string | null;
  restrictedAt: Date;
  memberSince: Date | null;
  groupCount: number;
  riskLevel: string;
}

/**
 * Holt Statistiken der letzten 24 Stunden aus der Datenbank
 */
export function getDailyStats(): DailyStats {
  const db = getDatabase();
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

  // Joins der letzten 24h
  const joinsResult = db.prepare(`
    SELECT COUNT(*) as count FROM joins
    WHERE joined_at >= ?
  `).get(twentyFourHoursAgo) as { count: number };

  // Unique Gruppen mit Aktivität
  const groupsResult = db.prepare(`
    SELECT COUNT(DISTINCT chat_id) as count FROM joins
    WHERE joined_at >= ?
  `).get(twentyFourHoursAgo) as { count: number };

  // Actions der letzten 24h
  const actionsResult = db.prepare(`
    SELECT action, COUNT(*) as count FROM actions
    WHERE created_at >= ?
    GROUP BY action
  `).all(twentyFourHoursAgo) as Array<{ action: string; count: number }>;

  const actionCounts: Record<string, number> = {};
  for (const row of actionsResult) {
    actionCounts[row.action] = row.count;
  }

  // Restrict-Details mit Kontext
  const restrictsDetails = getRestrictDetails(twentyFourHoursAgo);

  // Anomalie-Erkennung
  const anomalies = detectAnomalies(joinsResult.count, actionCounts, restrictsDetails);

  return {
    periodStart: new Date(twentyFourHoursAgo),
    periodEnd: new Date(now),
    totalJoins: joinsResult.count,
    totalRestricts: actionCounts['restrict'] || 0,
    totalBans: actionCounts['ban'] || 0,
    totalUnrestricts: actionCounts['unrestrict'] || 0,
    welcomesSent: joinsResult.count, // Approximation: 1 Welcome pro Join
    uniqueGroups: groupsResult.count,
    restrictsDetails,
    anomalies,
  };
}

/**
 * Holt Details zu allen Restricts der letzten 24h
 */
function getRestrictDetails(since: number): RestrictDetail[] {
  const db = getDatabase();

  const restricts = db.prepare(`
    SELECT
      a.id as action_id,
      a.user_id,
      a.chat_id,
      a.reason,
      a.created_at,
      u.username,
      u.risk_level,
      g.title as chat_title,
      (SELECT MIN(joined_at) FROM joins WHERE user_id = a.user_id AND chat_id = a.chat_id) as first_join,
      (SELECT COUNT(DISTINCT chat_id) FROM joins WHERE user_id = a.user_id) as group_count
    FROM actions a
    LEFT JOIN users u ON a.user_id = u.user_id
    LEFT JOIN groups g ON a.chat_id = g.chat_id
    WHERE a.action = 'restrict' AND a.created_at >= ?
    ORDER BY a.created_at DESC
  `).all(since) as Array<{
    action_id: number;
    user_id: number;
    chat_id: string;
    reason: string | null;
    created_at: number;
    username: string | null;
    risk_level: string | null;
    chat_title: string | null;
    first_join: number | null;
    group_count: number;
  }>;

  return restricts.map(r => ({
    actionId: r.action_id,
    userId: r.user_id,
    username: r.username,
    firstName: null, // Nicht in DB gespeichert
    chatId: r.chat_id,
    chatTitle: r.chat_title,
    reason: r.reason,
    restrictedAt: new Date(r.created_at),
    memberSince: r.first_join ? new Date(r.first_join) : null,
    groupCount: r.group_count,
    riskLevel: r.risk_level || 'UNKNOWN',
  }));
}

/**
 * Erkennt Anomalien in den Tagesstatistiken
 */
function detectAnomalies(
  joins: number,
  actions: Record<string, number>,
  restricts: RestrictDetail[]
): string[] {
  const anomalies: string[] = [];

  // Anomalie: Ungewöhnlich viele Joins
  if (joins > 500) {
    anomalies.push(`⚠️ Hohe Aktivität: ${joins} Joins in 24h (normal: <200)`);
  }

  // Anomalie: Viele Restricts im Verhältnis zu Joins
  const restrictRate = joins > 0 ? (actions['restrict'] || 0) / joins : 0;
  if (restrictRate > 0.1 && joins > 20) {
    anomalies.push(`⚠️ Hohe Restrict-Rate: ${(restrictRate * 100).toFixed(1)}% der Joins wurden restricted`);
  }

  // Anomalie: Lange bestehender Nutzer wurde restricted
  const longTermRestricts = restricts.filter(r => {
    if (!r.memberSince) return false;
    const membershipDays = (r.restrictedAt.getTime() - r.memberSince.getTime()) / (1000 * 60 * 60 * 24);
    return membershipDays > 7; // Mehr als 7 Tage Mitglied
  });

  if (longTermRestricts.length > 0) {
    anomalies.push(`⚠️ ${longTermRestricts.length} Nutzer mit >7 Tagen Mitgliedschaft wurden restricted – bitte prüfen`);
  }

  // Anomalie: Keine Aktivität
  if (joins === 0) {
    anomalies.push(`ℹ️ Keine Joins in den letzten 24h – ist der Bot aktiv?`);
  }

  return anomalies;
}

/**
 * Formatiert die Mitgliedschaftsdauer
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/**
 * Generiert den Daily Briefing Text
 */
export function generateBriefingText(stats: DailyStats): string {
  const lines: string[] = [];

  // Header
  const dateStr = stats.periodEnd.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
  lines.push(`🛡️ *Shield Briefing* – ${dateStr}`);
  lines.push('');

  // Status-Indikator
  const hasIssues = stats.anomalies.length > 0 || stats.restrictsDetails.length > 0;
  const statusEmoji = hasIssues ? '🟡' : '🟢';
  const statusText = hasIssues ? 'PRÜFEN' : 'ALLES OK';
  lines.push(`*Status:* ${statusEmoji} ${statusText}`);
  lines.push('');

  // Zusammenfassung
  lines.push('📊 *ZUSAMMENFASSUNG (24h)*');
  lines.push(`• Neue Mitglieder: ${stats.totalJoins}`);
  lines.push(`• Aktive Gruppen: ${stats.uniqueGroups}`);
  lines.push(`• Restricts: ${stats.totalRestricts}`);
  lines.push(`• Bans: ${stats.totalBans}`);
  lines.push(`• Entsperrt: ${stats.totalUnrestricts}`);
  lines.push('');

  // Anomalien
  if (stats.anomalies.length > 0) {
    lines.push('🚨 *ACHTUNG*');
    for (const anomaly of stats.anomalies) {
      lines.push(anomaly);
    }
    lines.push('');
  }

  // Restricts zur Kontrolle
  if (stats.restrictsDetails.length > 0) {
    lines.push(`👤 *RESTRICTS ZUR KONTROLLE (${stats.restrictsDetails.length})*`);
    lines.push('');

    for (const r of stats.restrictsDetails.slice(0, 10)) { // Max 10 anzeigen
      const userDisplay = r.username ? `@${r.username}` : `ID: ${r.userId}`;
      const groupDisplay = r.chatTitle || r.chatId;
      const membershipDuration = r.memberSince
        ? formatDuration(r.restrictedAt.getTime() - r.memberSince.getTime())
        : 'neu';

      lines.push(`*${userDisplay}*`);
      lines.push(`├ Gruppe: ${groupDisplay}`);
      lines.push(`├ Grund: ${r.reason || 'Nicht angegeben'}`);
      lines.push(`├ Mitglied seit: ${membershipDuration}`);
      lines.push(`├ Risk: ${r.riskLevel} | Gruppen: ${r.groupCount}`);
      lines.push(`└ _Button unten zum Entsperren_`);
      lines.push('');
    }

    if (stats.restrictsDetails.length > 10) {
      lines.push(`_...und ${stats.restrictsDetails.length - 10} weitere_`);
      lines.push('');
    }
  } else {
    lines.push('✅ *Keine Restricts zur Kontrolle*');
    lines.push('_Alle automatischen Aktionen waren eindeutig._');
    lines.push('');
  }

  // Footer
  lines.push('───────────────────');
  lines.push('_Shield Briefing v1.0_');

  return lines.join('\n');
}

/**
 * Erstellt Inline-Buttons für jeden Restrict
 */
export function generateUnrestrictButtons(restricts: RestrictDetail[]): ReturnType<typeof Markup.inlineKeyboard> | null {
  if (restricts.length === 0) {
    return null;
  }

  // Maximal 10 Buttons (Telegram-Limit)
  const buttons = restricts.slice(0, 10).map(r => {
    const label = r.username ? `✅ @${r.username}` : `✅ ${r.userId}`;
    const callbackData = `${UNRESTRICT_CALLBACK_PREFIX}${r.userId}:${r.chatId}`;
    return [Markup.button.callback(label, callbackData)];
  });

  return Markup.inlineKeyboard(buttons);
}

/**
 * Sendet das Daily Briefing an den Admin
 */
export async function sendDailyBriefing(bot: Telegraf): Promise<void> {
  console.log('[BRIEFING] Erstelle Daily Briefing...');

  try {
    const stats = getDailyStats();
    const text = generateBriefingText(stats);
    const buttons = generateUnrestrictButtons(stats.restrictsDetails);

    if (buttons) {
      await bot.telegram.sendMessage(ADMIN_USER_ID, text, {
        parse_mode: 'Markdown',
        ...buttons,
      });
    } else {
      await bot.telegram.sendMessage(ADMIN_USER_ID, text, {
        parse_mode: 'Markdown',
      });
    }

    console.log('[BRIEFING] Daily Briefing gesendet an Admin');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[BRIEFING][ERROR] Fehler beim Senden:', errorMessage);
  }
}

/**
 * Verarbeitet den Unrestrict-Callback von einem Button-Klick
 */
export async function handleUnrestrictCallback(
  bot: Telegraf,
  callbackData: string,
  callbackQueryId: string
): Promise<{ success: boolean; message: string }> {
  // Parse callback data: "unrestrict:userId:chatId"
  const parts = callbackData.replace(UNRESTRICT_CALLBACK_PREFIX, '').split(':');
  if (parts.length !== 2) {
    return { success: false, message: 'Ungültige Callback-Daten' };
  }

  const userId = parseInt(parts[0], 10);
  const chatId = parts[1];

  if (isNaN(userId)) {
    return { success: false, message: 'Ungültige User-ID' };
  }

  try {
    // Restriction in Telegram aufheben
    await bot.telegram.restrictChatMember(chatId, userId, {
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: true,
        can_pin_messages: false,
      },
    });

    // Action in DB loggen
    const db = getDatabase();
    db.prepare(`
      INSERT INTO actions (user_id, chat_id, action, reason, created_at)
      VALUES (?, ?, 'unrestrict', 'Manual unrestrict via Daily Briefing', ?)
    `).run(userId, chatId, Date.now());

    // User-Status in DB aktualisieren
    db.prepare(`
      UPDATE users SET status = 'ok' WHERE user_id = ?
    `).run(userId);

    console.log(`[BRIEFING] User ${userId} in Chat ${chatId} entsperrt (via Button)`);
    return { success: true, message: `✅ User ${userId} wurde entsperrt` };

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[BRIEFING][ERROR] Unrestrict fehlgeschlagen:`, errorMessage);
    return { success: false, message: `❌ Fehler: ${errorMessage}` };
  }
}

/**
 * Startet den Daily Briefing Scheduler
 * Sendet jeden Tag um 08:00 Uhr (Server-Zeit)
 */
export function startBriefingScheduler(bot: Telegraf): void {
  const scheduleTime = '0 8 * * *'; // 08:00 Uhr täglich

  // Berechne nächste Ausführung
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(8, 0, 0, 0);
  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const msUntilNextRun = nextRun.getTime() - now.getTime();

  console.log(`[BRIEFING] Scheduler gestartet`);
  console.log(`[BRIEFING] Nächster Report: ${nextRun.toLocaleString('de-DE')}`);

  // Erster Timer bis 08:00
  setTimeout(() => {
    sendDailyBriefing(bot);

    // Danach alle 24h
    setInterval(() => {
      sendDailyBriefing(bot);
    }, 24 * 60 * 60 * 1000);

  }, msUntilNextRun);
}
