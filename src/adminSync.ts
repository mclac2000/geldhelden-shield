/**
 * Auto-Admin-Sync
 * 
 * Synchronisiert Gruppen-Admins automatisch als Team-Mitglieder
 */

import { Telegraf } from 'telegraf';
import { getAllGroups, getGroupConfig, addTeamMember, removeTeamMember, isTeamMember, getTeamMembers } from './db';
import { isGroupManaged } from './groupConfig';
import { config } from './config';

interface AdminSyncResult {
  chatId: string;
  synced: number;
  removed: number;
  errors: number;
}

/**
 * Synchronisiert Admins einer Gruppe als Team-Mitglieder
 */
export async function syncAdminsForGroup(
  bot: Telegraf,
  chatId: string
): Promise<AdminSyncResult> {
  const result: AdminSyncResult = {
    chatId,
    synced: 0,
    removed: 0,
    errors: 0,
  };
  
  try {
    // Prüfe ob Gruppe managed ist
    if (!isGroupManaged(chatId)) {
      return result; // Skip nicht-managed Gruppen
    }
    
    // Hole Chat-Administratoren
    const administrators = await bot.telegram.getChatAdministrators(chatId);
    
    // Hole aktuelle Team-Mitglieder für diese Gruppe (nur auto-synced)
    const allTeamMembers = getTeamMembers();
    const currentAdmins = new Set<number>();
    
    // Erstelle Set von Admin-IDs
    for (const admin of administrators) {
      if ('user' in admin) {
        currentAdmins.add(admin.user.id);
      }
    }
    
    // Füge alle Admins als Team-Mitglieder hinzu
    for (const admin of administrators) {
      if ('user' in admin) {
        const userId = admin.user.id;
        // Behandle username, first_name und last_name als optional, verwende leeren String wenn fehlend
        // Alle drei Felder sind optional - AdminSync muss auch funktionieren, wenn alle leer sind
        const userInfo: { username?: string; firstName?: string; lastName?: string } = {};
        
        // Nur Felder hinzufügen, die tatsächlich existieren und nicht leer sind
        // Aber auch leere Strings sind erlaubt (wenn explizit vorhanden)
        if (admin.user.username !== undefined) {
          userInfo.username = admin.user.username ?? '';
        }
        if (admin.user.first_name !== undefined) {
          userInfo.firstName = admin.user.first_name ?? '';
        }
        if (admin.user.last_name !== undefined) {
          userInfo.lastName = admin.user.last_name ?? '';
        }
        
        // Prüfe ob bereits im Team (nicht auto-synced)
        if (!isTeamMember(userId)) {
          // addTeamMember behandelt fehlende Felder resilient (verwendet leere Strings)
          const success = addTeamMember(userId, 0, userInfo, 'auto_admin_sync');
          if (success) {
            result.synced++;
          } else {
            result.errors++;
          }
        }
      }
    }
    
    // Entferne Team-Mitglieder, die keine Admins mehr sind (nur auto-synced)
    // Note: Wir entfernen nur, wenn sie explizit als auto-synced markiert sind
    // Für jetzt: Wir entfernen nicht automatisch, da manuelle Team-Mitglieder auch existieren können
    
    console.log(`[ADMIN_SYNC] chat=${chatId} synced=${result.synced} errors=${result.errors}`);
    
    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ADMIN_SYNC] Fehler bei chat=${chatId}:`, errorMessage);
    result.errors++;
    return result;
  }
}

/**
 * Synchronisiert Admins für alle managed Gruppen
 */
export async function syncAllAdmins(bot: Telegraf): Promise<{
  total: number;
  synced: number;
  removed: number;
  errors: number;
}> {
  // Maßgeblich ist groups.status — dieselbe Liste, die auch Sperren, Scans und
  // die Wellen-Erkennung verwenden (getManagedGroups()).
  //
  // Vorher lief hier isGroupManaged() aus groupConfig.ts. Das liest ein ANDERES
  // Feld (group_config.managed) und liefert für Gruppen ohne Eintrag "true".
  // Dadurch wurden auch deaktivierte Gruppen abgefragt, was bei jedem Lauf
  // Fehler erzeugte ("member list is inaccessible" für einen deaktivierten
  // Kanal). Dauerfehler in einem Bericht führen dazu, dass niemand mehr
  // hinsieht, wenn ein echter Fehler dazukommt.
  const { getManagedGroups } = await import('./db');
  const managedGroups = getManagedGroups();

  let totalSynced = 0;
  let totalRemoved = 0;
  let totalErrors = 0;
  
  console.log(`[ADMIN_SYNC] Starte Sync für ${managedGroups.length} managed Gruppen...`);
  
  for (const group of managedGroups) {
    const result = await syncAdminsForGroup(bot, String(group.chatId));
    totalSynced += result.synced;
    totalRemoved += result.removed;
    totalErrors += result.errors;
    
    // Rate Limit: 1 Request pro Sekunde
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`[ADMIN_SYNC] Abgeschlossen: synced=${totalSynced} removed=${totalRemoved} errors=${totalErrors}`);
  
  return {
    total: managedGroups.length,
    synced: totalSynced,
    removed: totalRemoved,
    errors: totalErrors,
  };
}

/**
 * Startet periodischen Admin-Sync (alle 6 Stunden)
 */
export function startAdminSyncScheduler(bot: Telegraf): void {
  // Sofort beim Start
  syncAllAdmins(bot).catch(error => {
    console.error('[ADMIN_SYNC] Fehler beim initialen Sync:', error);
  });
  
  // Dann alle 6 Stunden
  const intervalMs = 6 * 60 * 60 * 1000; // 6 Stunden
  setInterval(() => {
    syncAllAdmins(bot).catch(error => {
      console.error('[ADMIN_SYNC] Fehler beim periodischen Sync:', error);
    });
  }, intervalMs);
  
  console.log('[ADMIN_SYNC] Scheduler gestartet (alle 6 Stunden)');
}
