import { Context } from 'telegraf';
import {
  getManagedGroups,
  saveBaselineMember,
  setGroupScanStatus,
  getGroupScanStatus,
  getGroupsWithActiveScan,
  getBaselineMembersForGroup,
  getScanStatistics,
  updateGroupScanMemberCount,
  getOrCreateUser,
  getGroup,
} from './db';
import { isBotAdminInGroup, sendToAdminLogChat } from './telegram';
import { isAdmin } from './admin';

export interface ScanResult {
  totalGroups: number;
  scannedGroups: number;
  newMembers: number;
  errors: number;
  rateLimited: boolean;
}

/**
 * Erfasst sichtbare Mitglieder aus bekannten Quellen (Events, Nachrichten, Admins)
 * KEINE verbotenen API-Aufrufe wie getChatMembers
 */
async function collectVisibleMembers(
  chatId: string,
  telegram: any,
  botId: number
): Promise<{
  members: Array<{
    user_id: number;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    is_bot: boolean;
    source: 'join' | 'message' | 'admin' | 'scan';
  }>;
  rateLimited: boolean;
}> {
  const members = new Map<number, {
    user_id: number;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    is_bot: boolean;
    source: 'join' | 'message' | 'admin' | 'scan';
  }>();
  
  let rateLimited = false;
  
  // 1. Bekannte Mitglieder aus baseline_members (bereits erfasst)
  const knownMembers = getBaselineMembersForGroup(chatId);
  for (const member of knownMembers) {
    members.set(member.user_id, {
      user_id: member.user_id,
      username: member.username,
      first_name: member.first_name,
      last_name: member.last_name,
      is_bot: false, // Wird später aktualisiert wenn möglich
      source: member.source as 'join' | 'message' | 'admin' | 'scan',
    });
  }
  
  // 2. Admins der Gruppe (sichtbar via getChatAdministrators - erlaubt)
  try {
    const admins = await telegram.getChatAdministrators(chatId);
    for (const admin of admins) {
      const user = admin.user;
      if (user.id === botId) continue; // Bot selbst ignorieren
      if (isAdmin(user.id)) continue; // Admin-User ignorieren
      
      members.set(user.id, {
        user_id: user.id,
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
        is_bot: user.is_bot || false,
        source: 'admin',
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any)?.response?.error_code;
    
    if (errorCode === 429) {
      rateLimited = true;
      console.log(`[Scan] Rate-Limit bei getChatAdministrators für ${chatId}`);
    } else {
      console.log(`[Scan] Fehler bei getChatAdministrators für ${chatId}: ${errorMessage}`);
    }
  }
  
  // 3. Bekannte User aus joins, actions, baseline_members (bereits in knownMembers)
  // Diese werden nicht nochmal hinzugefügt, da sie bereits erfasst sind
  
  return {
    members: Array.from(members.values()),
    rateLimited,
  };
}

/**
 * Führt einen realistischen Baseline-Scan für alle managed Gruppen durch
 * Erfasst nur sichtbare Mitglieder (keine verbotenen API-Aufrufe)
 */
export async function runBaselineScan2(
  ctx: Context,
  resume: boolean = false
): Promise<ScanResult> {
  const managedGroups = getManagedGroups();
  const telegram = ctx.telegram;
  
  // Hole Bot-ID
  const me = await telegram.getMe();
  const botId = me.id;
  
  const result: ScanResult = {
    totalGroups: managedGroups.length,
    scannedGroups: 0,
    newMembers: 0,
    errors: 0,
    rateLimited: false,
  };
  
  if (managedGroups.length === 0) {
    await sendToAdminLogChat('[Scan] Keine managed Gruppen gefunden.', ctx);
    return result;
  }
  
  // Prüfe ob Scan wiederaufgenommen werden soll
  let startIndex = 0;
  if (resume) {
    const activeScans = getGroupsWithActiveScan();
    if (activeScans.length > 0) {
      const lastGroup = activeScans[0].chat_id;
      const index = managedGroups.findIndex(g => String(g.chatId) === lastGroup);
      if (index >= 0) {
        startIndex = index;
        await sendToAdminLogChat(
          `[Scan] Wiederaufnahme bei Gruppe ${startIndex + 1}/${managedGroups.length}: ${managedGroups[startIndex].title || 'Unbekannt'}`,
          ctx
        );
      }
    }
  }
  
  await sendToAdminLogChat(
    `[Scan] Baseline-Scan 2.0 gestartet: ${managedGroups.length} managed Gruppen\n` +
    `⚠️ Erfasst nur sichtbare Mitglieder (Events, Nachrichten, Admins)`,
    ctx
  );
  
  let progressCounter = startIndex;
  
  for (let i = startIndex; i < managedGroups.length; i++) {
    const group = managedGroups[i];
    
    try {
      // Prüfe ob Bot Admin ist
      const chatIdStr = String(group.chatId);
      const botAdminCheck = await isBotAdminInGroup(chatIdStr, telegram);
      if (!botAdminCheck.isAdmin) {
        console.log(`[Scan] Bot ist kein Admin in ${chatIdStr}, überspringe`);
        result.errors++;
        continue;
      }
      
      // Setze Scan-Status auf "running"
      setGroupScanStatus(chatIdStr, 'running');
      
      // Erfasse sichtbare Mitglieder
      const collection = await collectVisibleMembers(chatIdStr, telegram, botId);
      
      if (collection.rateLimited) {
        // Rate-Limit erreicht - pausiere Scan
        setGroupScanStatus(chatIdStr, 'rate_limited');
        result.rateLimited = true;
        
        await sendToAdminLogChat(
          `[Scan] Rate-Limit erreicht bei Gruppe ${i + 1}/${managedGroups.length}\n` +
          `Scan wird pausiert und kann später fortgesetzt werden.`,
          ctx
        );
        break; // Stoppe Scan
      }
      
      // Speichere/aktualisiere Mitglieder
      let newMembersInGroup = 0;
      for (const member of collection.members) {
        // Prüfe ob bereits existiert
        const existing = getBaselineMembersForGroup(chatIdStr).find(
          m => m.user_id === member.user_id
        );
        
        if (!existing) {
          newMembersInGroup++;
          result.newMembers++;
        }
        
        saveBaselineMember(
          chatIdStr,
          member.user_id,
          member.username,
          member.first_name,
          member.last_name,
          member.is_bot,
          'manual',
          member.source
        );
      }
      
      // Aktualisiere Scan-Status
      setGroupScanStatus(chatIdStr, 'idle', Date.now());
      updateGroupScanMemberCount(chatIdStr);
      
      result.scannedGroups++;
      progressCounter++;
      
      // Fortschritts-Log alle 5 Gruppen
      if (progressCounter % 5 === 0 || newMembersInGroup > 0) {
        const stats = getScanStatistics();
        await sendToAdminLogChat(
          `[Scan] Fortschritt: ${progressCounter}/${managedGroups.length} Gruppen\n` +
          `Neue Mitglieder in dieser Gruppe: ${newMembersInGroup}\n` +
          `Gesamt bekannte Mitglieder: ${stats.totalKnownMembers}`,
          ctx
        );
      }
      
      // Rate-Limit-Schutz: 200ms Delay zwischen Gruppen
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const chatIdStr = String(group.chatId);
      console.error(`[Scan] Fehler bei Gruppe ${chatIdStr}:`, errorMessage);
      setGroupScanStatus(chatIdStr, 'idle'); // Setze zurück auf idle bei Fehler
      result.errors++;
    }
  }
  
  // Abschluss-Log
  const stats = getScanStatistics();
  await sendToAdminLogChat(
    `[Scan] Baseline-Scan 2.0 abgeschlossen:\n` +
    `✅ Gruppen gescannt: ${result.scannedGroups}/${result.totalGroups}\n` +
    `👥 Neue Mitglieder erfasst: ${result.newMembers}\n` +
    `📊 Gesamt bekannte Mitglieder: ${stats.totalKnownMembers}\n` +
    `${result.rateLimited ? '⚠️ Rate-Limit erreicht - Scan kann fortgesetzt werden' : ''}\n` +
    `${result.errors > 0 ? `❌ Fehler: ${result.errors}` : ''}\n\n` +
    `ℹ️ Baseline enthält nur sichtbar gewordene Mitglieder. Stille Alt-Mitglieder werden beim ersten Ereignis erfasst.`,
    ctx
  );
  
  return result;
}

/**
 * Alte runBaselineScan Funktion (für Kompatibilität)
 */
export async function runBaselineScan(
  ctx: Context,
  scanSource: 'manual' | 'auto' = 'manual'
): Promise<ScanResult> {
  // Rufe neue Scan-Funktion auf
  return runBaselineScan2(ctx, false);
}
