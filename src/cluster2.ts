/**
 * Cluster-Erkennung 2.0 (Prompt 5)
 * 
 * Erkennt Scam-Netzwerke basierend auf User-Aktivität in mehreren Gruppen
 * L1: ≥3 Gruppen in 24h → markieren, beobachten
 * L2: ≥5 Gruppen in 24h → Auto-Restrict oder Soft-Ban
 * L3: ≥7 Gruppen in 24h → Global Ban
 */

import { Context } from 'telegraf';
import {
  getDistinctManagedGroupsIn24h,
  recordUserGroupActivity,
  saveCluster,
  setUserObserved,
  isUserObserved,
  getOrCreateUser,
} from './db';
import { isAdmin } from './admin';
import { isTeamMember } from './db';
import { banUserGlobally, restrictUser, sendToAdminLogChat } from './telegram';
import { config, isPanicMode } from './config';

export type ClusterLevel = 1 | 2 | 3;

export interface ClusterDetectionResult {
  level: ClusterLevel | null;
  groupCount: number;
  clusterId: number | null;
  actionTaken: boolean;
}

/**
 * Generiert eine Cluster-ID (einfache Hash-basierte ID)
 */
function generateClusterId(userId: number, groupCount: number, timestamp: number): string {
  const hash = `${userId}-${groupCount}-${Math.floor(timestamp / 1000)}`;
  return hash.substring(0, 12);
}

/**
 * Prüft Cluster-Level für einen User (Echtzeit)
 * Returns: ClusterDetectionResult
 */
export async function checkClusterLevel(
  userId: number,
  chatId: string,
  ctx?: Context
): Promise<ClusterDetectionResult> {
  // Schutz: Admins und Team-Mitglieder IMMER ausnehmen
  if (isAdmin(userId) || isTeamMember(userId)) {
    console.log(`[CLUSTER] Admin-User übersprungen user=${userId}`);
    return { level: null, groupCount: 0, clusterId: null, actionTaken: false };
  }

  // Erfasse User-Gruppen-Aktivität
  recordUserGroupActivity(userId, chatId);

  // Hole distinct managed Gruppen in letzten 24h
  const groups = getDistinctManagedGroupsIn24h(userId);
  const groupCount = groups.length;

  // Prüfe Cluster-Level
  let level: ClusterLevel | null = null;
  if (groupCount >= 7) {
    level = 3; // L3: Global Scam
  } else if (groupCount >= 5) {
    level = 2; // L2: Netzwerk
  } else if (groupCount >= 3) {
    level = 1; // L1: Auffällig
  }

  if (!level) {
    return { level: null, groupCount, clusterId: null, actionTaken: false };
  }

  // Cluster erkannt - führe Aktion aus
  const clusterId = generateClusterId(userId, groupCount, Date.now());
  let actionTaken = false;

  try {
    if (level === 1) {
      // L1: Markieren, beobachten
      if (!isUserObserved(userId)) {
        setUserObserved(userId, true);
        actionTaken = true;
      }
      
      // Speichere Cluster
      const savedClusterId = saveCluster(1, [userId], groups, false, `L1: ${groupCount} Gruppen in 24h`);
      
      console.log(`[CLUSTER L1] user=${userId} groups=${groupCount} window=24h cluster=${clusterId}`);
      
      if (ctx) {
        await sendToAdminLogChat(
          `🟡 <b>Cluster erkannt – Stufe L1</b>\n\n` +
          `👤 User: <code>${userId}</code>\n` +
          `👥 Gruppen: ${groupCount} in 24h\n` +
          `🧩 Cluster-ID: <code>${clusterId}</code>\n\n` +
          `Aktion: <b>Markiert & Beobachtet</b>`,
          ctx,
          true
        );
      }
      
      return { level: 1, groupCount, clusterId: savedClusterId, actionTaken };
    } else if (level === 2) {
      // L2: Auto-Restrict oder Soft-Ban
      const savedClusterId = saveCluster(2, [userId], groups, false, `L2: ${groupCount} Gruppen in 24h`);
      
      // Restrict in aktueller Gruppe
      if (ctx) {
        const restrictResult = await restrictUser(chatId, userId, `Cluster L2: ${groupCount} Gruppen in 24h`);
        actionTaken = restrictResult.success;
        
        console.log(`[CLUSTER L2] user=${userId} groups=${groupCount} cluster=${clusterId} action=restrict`);
        
        await sendToAdminLogChat(
          `🟠 <b>Cluster erkannt – Stufe L2</b>\n\n` +
          `👤 User: <code>${userId}</code>\n` +
          `👥 Gruppen: ${groupCount} in 24h\n` +
          `🧩 Cluster-ID: <code>${clusterId}</code>\n\n` +
          `Aktion: <b>RESTRICT</b>\n` +
          `Empfehlung: Beobachten / Hochstufen`,
          ctx,
          true
        );
      }
      
      return { level: 2, groupCount, clusterId: savedClusterId, actionTaken };
    } else if (level === 3) {
      // L3: Global Ban
      const savedClusterId = saveCluster(3, [userId], groups, true, `L3: ${groupCount} Gruppen in 24h - GLOBAL BAN`);
      
      // Panic-Mode Check (Prompt 6): Stoppt Auto-Bans
      if (isPanicMode()) {
        console.log(`[CLUSTER L3][PANIC] Auto-Ban gestoppt für User ${userId} (Panic-Mode aktiv)`);
        if (ctx) {
          await sendToAdminLogChat(
            `🔴 <b>Cluster erkannt – Stufe L3 (PANIC-MODE)</b>\n\n` +
            `👤 User: <code>${userId}</code>\n` +
            `👥 Gruppen: ${groupCount} in 24h\n` +
            `🧩 Cluster-ID: <code>${clusterId}</code>\n\n` +
            `⚠️ <b>Auto-Ban GESTOPPT</b> (Panic-Mode aktiv)\n` +
            `✅ Nur Logs + Beobachtung`,
            ctx,
            true
          );
        }
        return { level: 3, groupCount, clusterId: savedClusterId, actionTaken: false };
      }
      
      // Global Ban
      const banResult = await banUserGlobally(userId, `Cluster L3: ${groupCount} Gruppen in 24h`);
      actionTaken = banResult.success;
      
      console.log(`[CLUSTER L3] user=${userId} GLOBAL BAN groups=${groupCount} cluster=${clusterId}`);
      
      if (ctx) {
        await sendToAdminLogChat(
          `🔴 <b>Cluster erkannt – Stufe L3</b>\n\n` +
          `👤 User: <code>${userId}</code>\n` +
          `👥 Gruppen: ${groupCount} in 24h\n` +
          `🧩 Cluster-ID: <code>${clusterId}</code>\n\n` +
          `Aktion: <b>GLOBAL BAN</b>\n` +
          `✅ User wurde in ${banResult.groups} Gruppen gebannt`,
          ctx,
          true
        );
      }
      
      return { level: 3, groupCount, clusterId: savedClusterId, actionTaken };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[CLUSTER] Fehler bei Cluster-Aktion für User ${userId}:`, errorMessage);
  }

  return { level, groupCount, clusterId: null, actionTaken: false };
}
