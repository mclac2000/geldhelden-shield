/**
 * Proaktive Admin-Pings für Group Risk
 * 
 * Sendet gedrosselte Empfehlungen an Admins bei Status-Wechseln
 */

import { Context } from 'telegraf';
import { getGroupStats, GroupStats } from './db';
import { evaluateGroupRisk } from './groupRisk';
import { GroupRiskLevel } from './db';
import { sendToAdminLogChat } from './telegram';
import { getGroup } from './db';

interface GroupRiskNotificationState {
  lastLevel: GroupRiskLevel | null;
  lastNotificationTime: number;
}

const notificationStates = new Map<string, GroupRiskNotificationState>();

/**
 * Prüft ob eine Benachrichtigung gesendet werden sollte
 * Max 1 Empfehlung / Gruppe / 12h
 * Nur bei Status-Wechsel
 */
export function shouldSendRiskNotification(chatId: string, newLevel: GroupRiskLevel): boolean {
  const state = notificationStates.get(chatId) || {
    lastLevel: null,
    lastNotificationTime: 0,
  };
  
  const now = Date.now();
  const hoursSinceLastNotification = (now - state.lastNotificationTime) / (1000 * 60 * 60);
  
  // Max 1 Empfehlung / Gruppe / 12h
  if (hoursSinceLastNotification < 12) {
    return false;
  }
  
  // Nur bei Status-Wechsel
  if (state.lastLevel === newLevel) {
    return false;
  }
  
  return true;
}

/**
 * Sendet Admin-Empfehlung für Group Risk
 */
export async function sendGroupRiskNotification(
  bot: any,
  chatId: string,
  assessment: { level: GroupRiskLevel; score: number; recommendations: string[] }
): Promise<void> {
  if (!shouldSendRiskNotification(chatId, assessment.level)) {
    return;
  }
  
  const group = getGroup(chatId);
  const groupName = group?.title || 'Unbekannt';
  
  // Emoji für Risk-Level
  let levelEmoji = '🟢';
  let levelName = 'STABLE';
  if (assessment.level === "ATTENTION") {
    levelEmoji = '🟡';
    levelName = 'ATTENTION';
  } else if (assessment.level === "WARNING") {
    levelEmoji = '🟠';
    levelName = 'WARNING';
  } else if (assessment.level === "CRITICAL") {
    levelEmoji = '🔴';
    levelName = 'CRITICAL';
  }
  
  let message = `${levelEmoji} <b>Gruppen-Risiko: ${levelName}</b>\n\n`;
  message += `📍 Gruppe: <b>${groupName}</b> (<code>${chatId}</code>)\n`;
  message += `📊 Risk-Score: <b>${assessment.score}</b>\n\n`;
  
  if (assessment.recommendations.length > 0) {
    message += `<b>Empfehlung:</b>\n`;
    assessment.recommendations.forEach(rec => {
      message += `• ${rec}\n`;
    });
  }
  
  await sendToAdminLogChat(message, null, true);
  
  // Update State
  notificationStates.set(chatId, {
    lastLevel: assessment.level,
    lastNotificationTime: Date.now(),
  });
  
  console.log(`[ADMIN-ADVICE] sent level=${levelName} chat=${chatId}`);
}

/**
 * Prüft alle Gruppen und sendet Benachrichtigungen bei Bedarf
 */
export async function checkAndNotifyGroupRisks(bot: any, ctx?: Context): Promise<void> {
  const { getAllGroupsWithRiskLevel } = await import('./groupRisk');
  const groupsWithRisk = getAllGroupsWithRiskLevel();
  
  for (const { stats, level } of groupsWithRisk) {
    if (level === "STABLE") {
      continue; // Keine Benachrichtigung für stabile Gruppen
    }
    
    // TEMPORÄR DEAKTIVIERT: GroupRisk-Benachrichtigungen
    // const assessment = evaluateGroupRisk(stats.group_id);
    // await sendGroupRiskNotification(bot, stats.group_id, assessment);
  }
}
