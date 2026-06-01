import { Context } from 'telegraf';
import { config } from './config';

// ============================================================================
// Command Handler Type Definition
// ============================================================================

/**
 * Einheitliches Interface für alle Admin-Command-Handler
 * Alle Commands erhalten exakt: (ctx: Context, args: string[])
 */
export type AdminCommandHandler = (
  ctx: Context,
  args: string[]
) => Promise<void>;
import {
  getUser,
  getOrCreateUser,
  updateUserStatus,
  getRecentActions,
  getGroupCount,
  getAllGroups,
  getGroup,
  setGroupStatus,
  GroupStatus,
  addToBlacklist,
  isBlacklisted,
  getBlacklistEntry,
  addTeamMember,
  removeTeamMember,
  normalizeBrand,
  isTeamMember,
  getTeamMembers,
  removeFromBlacklist,
  setUserObserved,
  addPendingTeamUsername,
  removePendingTeamUsername,
  getPendingTeamUsernames,
  addPendingUsernameBlacklist,
  removePendingUsernameBlacklist,
} from './db';
import { getJoinStats } from './risk';
import {
  unrestrictUserInAllGroups,
  banUserInAllGroups,
  unbanUserInAllGroups,
  logAdmin,
  isUserAdminOrCreatorInGroup,
} from './telegram';
import { getShieldStatistics, getLastScanStats, updateGroupConfig, getGroupConfig, ensureGroupConfig, FeatureName, getOrCreateGroupProfile, getGroupProfile, updateGroupProfile, GroupConfig } from './db';
// TEMPORÄR DEAKTIVIERT: GroupRiskLevel
import { testWelcomeTemplate } from './welcomeProfile';
import { generateWeeklyReport, sendWeeklyReport } from './weekly';
import { runBaselineScan } from './scan';
import { sendToAdminLogChat } from './telegram';
import { previewWelcomeText } from './welcome';

export function isAdmin(userId: number): boolean {
  return config.adminIds.includes(userId);
}

/**
 * Prüft ob ein User Admin-Rechte für einen bestimmten Scope hat
 * 
 * @param ctx - Telegram Context
 * @param scope - 'global' für Super-Admins, 'group' für Group-Admins
 * @param chatId - Optional: Chat ID für Group-Scope
 * @returns { hasPermission: boolean, isSuperAdmin: boolean, error?: string }
 */
export async function assertAdmin(
  ctx: Context,
  scope: 'global' | 'group',
  chatId?: string
): Promise<{ hasPermission: boolean; isSuperAdmin: boolean; error?: string }> {
  if (!ctx.from) {
    return { hasPermission: false, isSuperAdmin: false, error: 'Kein User gefunden' };
  }
  
  const userId = ctx.from.id;
  
  // Super-Admins (env ADMIN_IDS) dürfen alles
  if (isAdmin(userId)) {
    return { hasPermission: true, isSuperAdmin: true };
  }
  
  // Für global scope: nur Super-Admins erlaubt
  if (scope === 'global') {
    return { hasPermission: false, isSuperAdmin: false, error: 'Nur Super-Admins dürfen globale Befehle ausführen' };
  }
  
  // Für group scope: prüfe ob User Group-Admin ist
  if (scope === 'group') {
    if (!chatId) {
      // Versuche chatId aus Context zu extrahieren
      if (ctx.chat && ('id' in ctx.chat)) {
        chatId = ctx.chat.id.toString();
      } else {
        return { hasPermission: false, isSuperAdmin: false, error: 'Keine Chat ID gefunden' };
      }
    }
    
    // Prüfe ob User Admin/Creator in der Gruppe ist
    const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
    
    if (adminCheck.isAdmin) {
      return { hasPermission: true, isSuperAdmin: false };
  } else {
      return { hasPermission: false, isSuperAdmin: false, error: adminCheck.error || 'Keine Admin-Rechte in dieser Gruppe' };
    }
  }
  
  return { hasPermission: false, isSuperAdmin: false, error: 'Ungültiger Scope' };
}

// Admin Command Handlers
// All handlers follow the unified signature: (ctx: Context, args: string[]) or specific typed parameters

export async function handleStatusCommand(ctx: Context, userIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleStatusCommand: Implementation missing - please restore from backup');
}

export async function handleAllowCommand(ctx: Context, userIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleAllowCommand: Implementation missing - please restore from backup');
}

function isUser(obj: unknown): obj is { id: number; is_bot: boolean; username?: string; first_name?: string; last_name?: string } {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'is_bot' in obj && typeof (obj as { id: unknown }).id === 'number';
}

function extractUserIdFromMessage(ctx: Context): number | null {
  if (!ctx.message) {
    return null;
  }
  if ('reply_to_message' in ctx.message && ctx.message.reply_to_message) {
    const replyMsg = ctx.message.reply_to_message;
    if (replyMsg.from && isUser(replyMsg.from) && !replyMsg.from.is_bot) {
      return replyMsg.from.id;
    }
    if ('forward_from' in replyMsg && replyMsg.forward_from) {
      const forwardFrom = replyMsg.forward_from;
      if (isUser(forwardFrom) && !forwardFrom.is_bot) {
        return forwardFrom.id;
      }
    }
  }
  if ('forward_from' in ctx.message && ctx.message.forward_from) {
    const forwardFrom = ctx.message.forward_from;
    if (isUser(forwardFrom) && !forwardFrom.is_bot) {
      return forwardFrom.id;
    }
  }
  return null;
}

export async function handleBanCommand(ctx: Context, userIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  let userId: number | null = null;
  const extractedUserId = extractUserIdFromMessage(ctx);
  if (extractedUserId) {
    userId = extractedUserId;
  } else if (userIdStr) {
    const parsedUserId = parseInt(userIdStr, 10);
    if (!isNaN(parsedUserId)) {
      userId = parsedUserId;
    }
  }

  // Prüfe ob es ein Username-Ban ist (@username oder plain username)
  // Auch ohne @ behandeln, wenn es keine Zahl ist
  if (!userId && userIdStr && (userIdStr.startsWith('@') || (userIdStr.trim().length > 0 && isNaN(parseInt(userIdStr, 10))))) {
    const username = userIdStr.replace(/^@/, '').trim();
    if (username) {
      // Username-Ban für unbekannte User
      const { addUsernameToBlacklist, getUsersByUsername, getOrCreateUser } = await import('./db');
      const { banUserGlobally } = await import('./telegram');
      
      // Füge Username zur Blacklist hinzu
      const success = addUsernameToBlacklist(username, ctx.from.id);
      if (!success) {
        await ctx.reply('❌ Fehler beim Hinzufügen des Usernames zur Blacklist.');
        return;
      }
      
      // Prüfe ob User bereits bekannt ist
      const knownUserIds = getUsersByUsername(username);
      
      if (knownUserIds.length > 0) {
        // User ist bekannt - banne sofort
        let bannedCount = 0;
        for (const uid of knownUserIds) {
          const result = await banUserGlobally(uid, `Username-Ban: @${username}`);
          if (result.success) {
            bannedCount++;
          }
        }
        
    await ctx.reply(
          `✅ <b>Username-Ban ausgeführt</b>\n\n` +
          `📛 Username: <code>@${username}</code>\n` +
          `👥 Bekannte User: ${knownUserIds.length}\n` +
          `🚫 Gebannt: ${bannedCount} User\n\n` +
          `Username wird auch bei zukünftigen Auftreten automatisch gebannt.`,
      { parse_mode: 'HTML' }
    );
      } else {
        // User ist unbekannt - speichere als external
        // Erstelle einen Platzhalter-User mit external=true
        const placeholderUserId = -Math.abs(username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0));
        getOrCreateUser(placeholderUserId);
        
        // Speichere in pending_username_blacklist
        const banReason = `Manuell durch Admin ${ctx.from.id}`;
        const success = addPendingUsernameBlacklist(username, ctx.from.id, banReason);
        
        if (success) {
          await ctx.reply(
            `✅ <b>Username vorgemerkt</b>\n\n` +
            `📛 Username: <code>@${username}</code>\n` +
            `👤 Status: User noch nicht bekannt\n\n` +
            `⚠️ Sobald dieser User irgendwo sichtbar wird (join/message), wird er automatisch global gebannt.\n` +
            `📝 Grund: ${banReason}`,
            { parse_mode: 'HTML' }
          );
          
          const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
          await sendToAdminLogChat(
            `🚫 <b>Username-Ban vorgemerkt</b>\n\n` +
            `👤 Admin: ${adminName} (<code>${ctx.from.id}</code>)\n` +
            `📛 Username: @${username}\n` +
            `📝 Grund: ${banReason}\n\n` +
            `ℹ️ Sobald dieser User sichtbar wird, wird er automatisch gebannt.`,
            ctx,
            true
          );
          
          console.log(`[BAN] Username vorgemerkt: @${username} by admin ${ctx.from.id}`);
        } else {
          await ctx.reply('❌ Fehler beim Vormerken des Usernames.');
        }
      }
      
      const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
      await logAdmin({
        action: 'BANNED',
        userId: knownUserIds[0] || 0,
        reason: `Username-Ban: @${username}${knownUserIds.length > 0 ? ` (${knownUserIds.length} User gebannt)` : ' (vorgemerkt)'}`,
        adminId: ctx.from.id,
        adminName,
      }, ctx);
      
      return;
    }
  }
  
  if (!userId) {
    await ctx.reply('❌ Keine User-ID gefunden.');
    return;
  }
  
  // TEAM-MITGLIED-Protection
  if (isTeamMember(userId)) {
    await ctx.reply(
      `⛔ <b>BAN BLOCKIERT – Teammitglied</b>\n\n` +
      `User ID: <code>${userId}</code>\n\n` +
      `Teammitglieder können nicht gebannt werden.`,
      { parse_mode: 'HTML' }
    );
    const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
    await logAdmin({
        action: 'WARNING',
        userId,
      reason: `⛔ BAN BLOCKIERT – Teammitglied`,
        adminId: ctx.from.id,
        adminName,
    }, ctx);
    console.log(`⛔ BAN BLOCKIERT – Teammitglied\nUser ID: ${userId}`);
    return;
  }

  // Global Ban durchführen
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.split(' ').slice(1);
  const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
  const reason = parts.length > 1 ? parts.slice(1).join(' ') : `Manuell durch Admin ${ctx.from.id} (${adminName})`;
  
  // Füge zu Blacklist hinzu
  addToBlacklist(userId, ctx.from.id, reason);
  
  // Ban in allen managed Gruppen
  const result = await banUserInAllGroups(userId, reason);
  
  await logAdmin({
    action: 'BANNED',
    userId,
    reason: `${reason}\nGlobal Ban: ${result.success} Erfolg, ${result.failed} Fehler, ${result.skipped} Übersprungen`,
    adminId: ctx.from.id,
    adminName,
  }, ctx);

    await ctx.reply(
    `✅ <b>User global gebannt</b>\n\n` +
    `🆔 User ID: <code>${userId}</code>\n` +
    `📊 Gruppen: ${result.success} erfolgreich, ${result.failed} Fehler, ${result.skipped} übersprungen\n\n` +
    `📝 Grund: ${reason}\n` +
    `🗑️ Zur Blacklist hinzugefügt`,
    { parse_mode: 'HTML' }
  );
}

export async function handleUnrestrictCommand(ctx: Context, userIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleUnrestrictCommand: Implementation missing - please restore from backup');
}

export async function handleGroupsCommand(ctx: Context, pageOrAll?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleGroupsCommand: Implementation missing - please restore from backup');
}

export async function handleManageCommand(ctx: Context, chatIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleManageCommand: Implementation missing - please restore from backup');
}

export async function handleDisableCommand(ctx: Context, chatIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleDisableCommand: Implementation missing - please restore from backup');
}

export async function handleUnmanageCommand(ctx: Context, chatIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleUnmanageCommand: Implementation missing - please restore from backup');
}


export async function handleStatsCommand(ctx: Context, period?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const { getManagedGroups, getBaselineUserCount, getNewUserStats, getAllGroups, getClusterStats } = await import('./db');
  
  const managedGroups = getManagedGroups();
  const allGroups = getAllGroups();
  const knownGroups = allGroups.filter(g => g.status === 0); // 0 = known
  const baselineUsers = getBaselineUserCount();
  const newUserStats = getNewUserStats();
  const clusterStats = getClusterStats();
  
  // GroupRisk-Statistiken (READ ONLY)
  const { getGroupRiskStatistics, getAllGroupsWithRiskLevel } = await import('./groupRisk');
  const riskStats = getGroupRiskStatistics();
  
  // Gruppen-Risiko-Übersicht (sortiert nach höchstem Risiko)
  const groupsWithRisk = getAllGroupsWithRiskLevel();
  const riskOrder: Record<import('./db').GroupRiskLevel, number> = { "STABLE": 0, "ATTENTION": 1, "WARNING": 2, "CRITICAL": 3 };
  const sortedGroups = groupsWithRisk
    .filter(g => managedGroups.some(mg => String(mg.chatId) === g.stats.group_id))
    .sort((a, b) => riskOrder[b.level] - riskOrder[a.level])
    .slice(0, 10); // Top 10 riskanteste Gruppen
  
  let riskOverview = '';
  if (sortedGroups.length > 0) {
    riskOverview = `\n⚠️ <b>Gruppen-Risiko (Top 10):</b>\n`;
    for (const { stats, level } of sortedGroups) {
      const emoji = level === 'CRITICAL' ? '🔴' : level === 'WARNING' ? '🟠' : level === 'ATTENTION' ? '🟡' : '🟢';
      riskOverview += `   ${emoji} ${stats.group_name || 'Unbekannt'}: ${level}\n`;
      riskOverview += `      └ Joins 24h: ${stats.joins_24h} | Bans 24h: ${stats.bans_24h} | Score: ${stats.risk_score}\n`;
    }
  }
  
    await ctx.reply(
    `📊 <b>Shield Statistiken</b>\n\n` +
    `👥 <b>Baseline Users (seen):</b> ${baselineUsers.total}\n` +
    `   └ +${newUserStats.totalJoins} neue Joins\n\n` +
    `📊 <b>Gruppen:</b>\n` +
    `   └ Managed: ${managedGroups.length}\n` +
    `   └ Known: ${knownGroups.length}\n\n` +
    `🔄 <b>Joins:</b>\n` +
    `   └ Gesamt: ${newUserStats.totalJoins}\n` +
    `   └ Joins letzte Stunde: ${newUserStats.joinsInLastHour}\n\n` +
    `🔗 <b>Cluster-Status:</b>\n` +
    `   └ L1 (auffällig): ${clusterStats.l1}\n` +
    `   └ L2 (Netzwerk): ${clusterStats.l2}\n` +
    `   └ L3 (Global): ${clusterStats.l3}\n\n` +
    `⚠️ <b>Gruppen-Risiko (24h)</b>\n` +
    `   └ 🟢 Stabil: ${riskStats.stable}\n` +
    `   └ 🟡 Attention: ${riskStats.attention}\n` +
    `   └ 🟠 Warning: ${riskStats.warning}\n` +
    `   └ 🔴 Critical: ${riskStats.critical}\n` +
    riskOverview +
    `\nℹ️ <i>Baseline = alle User die jemals sichtbar waren (Join, Message, Ban, Report)</i>`,
    { parse_mode: 'HTML' }
  );
}

export const handleWhereAmICommand: AdminCommandHandler = async (ctx, args) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleWhereAmICommand: Implementation missing - please restore from backup');
};

export const handleWeeklyPreviewCommand: AdminCommandHandler = async (ctx, args) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleWeeklyPreviewCommand: Implementation missing - please restore from backup');
};

export const handleWeeklyLastCommand: AdminCommandHandler = async (ctx, args) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleWeeklyLastCommand: Implementation missing - please restore from backup');
};

export async function handleScanCommand(ctx: Context, scanType?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  if (scanType === 'groups') {
    // /scan groups - Zeigt Status ohne API-Fetch
    const { getManagedGroups, getBaselineUserCount, getAllGroups } = await import('./db');
    const managedGroups = getManagedGroups();
    const allGroups = getAllGroups();
    const knownGroups = allGroups.filter(g => g.status === 0); // 0 = known
    const baselineUsers = getBaselineUserCount();
    
    await ctx.reply(
      `📊 <b>Baseline Scan Status</b>\n\n` +
      `✅ Scan gestartet\n` +
      `📊 Managed Gruppen: ${managedGroups.length}\n` +
      `👥 Baseline Users: ${baselineUsers.total}\n` +
      `📋 Known Gruppen: ${knownGroups.length}\n` +
      `👥 Baseline Users (seen): ${baselineUsers}\n\n` +
      `ℹ️ <i>Baseline wächst mit jedem Join, Post, Ban & Report</i>\n` +
      `ℹ️ <i>Keine API-Fetches - nur sichtbare User werden erfasst</i>`,
      { parse_mode: 'HTML' }
    );
    return;
  }
  
  // Alte Scan-Funktion für Kompatibilität
  await runBaselineScan(ctx, 'manual');
}

export async function handleScanStatusCommand(ctx: Context, args: string[]): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  await ctx.reply('⚠️ handleScanStatusCommand: Implementation missing - please restore from backup');
}

// Team Commands (implemented)
export async function handleTeamAddCommand(ctx: Context, userIdOrUsername: string, note?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  // Prüfe ob @username oder user_id
  if (userIdOrUsername.startsWith('@')) {
    // Username
    const username = userIdOrUsername.replace('@', '').trim();
    
    // Versuche user_id zu resolven
    let userId: number | null = null;
    
    try {
      // Versuche getChat (funktioniert nur wenn Bot mit User interagiert hat)
      const chat = await ctx.telegram.getChat(`@${username}`);
      if ('id' in chat) {
        userId = chat.id;
      }
    } catch {
      // getChat fehlgeschlagen - versuche getChatMember wenn in Gruppe
      const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
      if (chatId) {
        try {
          // Versuche über getChatMember (nur wenn User in Gruppe ist)
          // Da wir keine user_id haben, müssen wir durch alle managed groups iterieren
          // Für jetzt: speichere als pending
        } catch {
          // Ignoriere
        }
      }
    }
    
    if (userId) {
      // User-ID gefunden - direkt hinzufügen
      getOrCreateUser(userId);
      const success = addTeamMember(userId, ctx.from.id, { username }, note);
      
      if (success) {
        const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
        await logAdmin({
          action: 'TEAM_ADD',
      userId,
          reason: `User @${username} zum Team hinzugefügt durch Admin ${ctx.from.id} (${adminName})`,
      adminId: ctx.from.id,
      adminName,
        }, ctx);

        await ctx.reply(
          `✅ User @${username} (<code>${userId}</code>) wurde zum Team hinzugefügt.\n\n` +
          `Team-Mitglieder sind von allen Shield-Maßnahmen ausgeschlossen.`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply('❌ Fehler beim Hinzufügen zum Team.');
      }
    } else {
      // User-ID nicht auflösbar - speichere als pending
      const success = addPendingTeamUsername(username, ctx.from.id, note);
      
      if (success) {
        const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
        await sendToAdminLogChat(
          `👥 <b>Team-Username vorgemerkt</b>\n\n` +
          `👤 Admin: ${adminName} (<code>${ctx.from.id}</code>)\n` +
          `📛 Username: @${username}\n` +
          `ℹ️ Sobald dieser User sichtbar wird (join/message), wird er automatisch zum Team hinzugefügt.`,
          ctx,
          true
  );

  await ctx.reply(
          `✅ Username @${username} wurde vorgemerkt.\n\n` +
          `Sobald dieser User irgendwo sichtbar wird (join/message), wird er automatisch zum Team hinzugefügt.`,
    { parse_mode: 'HTML' }
  );
      } else {
        await ctx.reply('❌ Fehler beim Vormerken des Usernames.');
      }
    }
  } else {
    // User-ID
    const userId = parseInt(userIdOrUsername, 10);
    if (isNaN(userId)) {
      await ctx.reply('❌ Ungültige User-ID oder Username. Format: /team add <user_id|@username> [note]');
      return;
    }

    getOrCreateUser(userId);
    const success = addTeamMember(userId, ctx.from.id, undefined, note);
    
    if (success) {
      const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
      await logAdmin({
        action: 'TEAM_ADD',
          userId,
        reason: `User zum Team hinzugefügt durch Admin ${ctx.from.id} (${adminName})`,
        adminId: ctx.from.id,
        adminName,
      }, ctx);

      await ctx.reply(
        `✅ User <code>${userId}</code> wurde zum Team hinzugefügt.\n\n` +
        `Team-Mitglieder sind von allen Shield-Maßnahmen ausgeschlossen.`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply('❌ Fehler beim Hinzufügen zum Team.');
    }
  }
}

export async function handleTeamRemoveCommand(ctx: Context, userIdOrUsername: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  // Prüfe ob @username oder user_id
  if (userIdOrUsername.startsWith('@')) {
    // Username
    const username = userIdOrUsername.replace('@', '').trim();
    
    // Prüfe ob in pending
    const pendingRemoved = removePendingTeamUsername(username);
    
    if (pendingRemoved) {
      await ctx.reply(`✅ Username @${username} wurde aus pending Team-Liste entfernt.`, { parse_mode: 'HTML' });
      return;
    }
    
    // Versuche user_id zu finden
    const { getUsersByUsername } = await import('./db');
    const userIds = getUsersByUsername(username);
    
    if (userIds.length === 0) {
      await ctx.reply(`❌ Username @${username} nicht gefunden (weder im Team noch pending).`);
      return;
    }
    
    // Entferne alle gefundenen User-IDs (sollte normalerweise nur eine sein)
    let removed = false;
    for (const userId of userIds) {
      if (removeTeamMember(userId)) {
        removed = true;
      }
    }
    
    if (removed) {
      const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
      await logAdmin({
        action: 'TEAM_REMOVE',
        userId: userIds[0],
        reason: `User @${username} aus Team entfernt durch Admin ${ctx.from.id} (${adminName})`,
        adminId: ctx.from.id,
        adminName,
      }, ctx);

      await ctx.reply(
        `✅ User @${username} wurde aus dem Team entfernt.`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ User @${username} ist nicht im Team.`);
    }
  } else {
    // User-ID
    const userId = parseInt(userIdOrUsername, 10);
    if (isNaN(userId)) {
      await ctx.reply('❌ Ungültige User-ID oder Username. Format: /team remove <user_id|@username>');
      return;
    }

    const success = removeTeamMember(userId);
    
    if (success) {
      const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
      await logAdmin({
        action: 'TEAM_REMOVE',
        userId,
        reason: `User aus Team entfernt durch Admin ${ctx.from.id} (${adminName})`,
        adminId: ctx.from.id,
        adminName,
      }, ctx);

      await ctx.reply(
        `✅ User <code>${userId}</code> wurde aus dem Team entfernt.`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ User ${userId} ist nicht im Team.`);
    }
  }
}

export const handleTeamListCommand: AdminCommandHandler = async (ctx, args) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const teamMembers = getTeamMembers();
  const pendingUsernames = getPendingTeamUsernames();
  
  if (teamMembers.length === 0 && pendingUsernames.length === 0) {
    await ctx.reply('📋 Keine Team-Mitglieder vorhanden.');
    return;
  }

  let message = '📋 <b>Team-Mitglieder</b>\n\n';
  
  if (teamMembers.length > 0) {
    message += `<b>Aktive Mitglieder (${teamMembers.length}):</b>\n`;
    for (const member of teamMembers) {
      message += `• <code>${member.user_id}</code>`;
      if (member.username) {
        message += ` @${member.username}`;
      }
      if (member.first_name) {
        message += ` (${member.first_name}${member.last_name ? ' ' + member.last_name : ''})`;
      }
      if (member.note) {
        message += `\n  📝 ${member.note}`;
      }
      const addedDate = new Date(member.added_at).toLocaleDateString('de-DE');
      message += `\n  ➕ ${addedDate}\n\n`;
    }
  }
  
  if (pendingUsernames.length > 0) {
    message += `\n<b>Vorgemerkte Usernames (${pendingUsernames.length}):</b>\n`;
    for (const pending of pendingUsernames) {
      message += `• @${pending.username}`;
      if (pending.note) {
        message += `\n  📝 ${pending.note}`;
      }
      const addedDate = new Date(pending.added_at).toLocaleDateString('de-DE');
      message += `\n  ➕ ${addedDate}\n\n`;
    }
  }

  await ctx.reply(message, { parse_mode: 'HTML' });
};

/**
 * /team import - Importiert Team-Mitglieder aus Textliste
 */
export async function handleTeamImportCommand(ctx: Context, args: string[]): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  // Prüfe ob Reply auf eine Nachricht
  if (!ctx.message || !('reply_to_message' in ctx.message) || !ctx.message.reply_to_message) {
    await ctx.reply(
      `📥 <b>Team-Import</b>\n\n` +
      `Sende eine Nachricht mit einer Liste von User-IDs oder Usernames (ein pro Zeile) und antworte darauf mit /team import.\n\n` +
      `Beispiel:\n` +
      `<code>123456789\n@username1\n987654321\n@username2</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const replyMessage = ctx.message.reply_to_message;
  const text = 'text' in replyMessage ? replyMessage.text : 'caption' in replyMessage ? replyMessage.caption : null;
  
  if (!text) {
    await ctx.reply('❌ Kein Text in der geantworteten Nachricht gefunden.');
    return;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let added = 0;
  let pending = 0;
  let errors = 0;
  const errorsList: string[] = [];

  for (const line of lines) {
    try {
      if (line.startsWith('@')) {
        // Username
        const username = line.replace('@', '').trim();
        
        // Versuche user_id zu resolven
        let userId: number | null = null;
        try {
          const chat = await ctx.telegram.getChat(`@${username}`);
          if ('id' in chat) {
            userId = chat.id;
          }
        } catch {
          // Nicht auflösbar - pending
        }
        
        if (userId) {
          getOrCreateUser(userId);
          if (addTeamMember(userId, ctx.from.id, { username })) {
            added++;
          }
        } else {
          if (addPendingTeamUsername(username, ctx.from.id)) {
            pending++;
          }
        }
      } else {
        // User-ID
        const userId = parseInt(line, 10);
        if (isNaN(userId)) {
          errors++;
          errorsList.push(`Ungültig: ${line}`);
      continue;
    }

        getOrCreateUser(userId);
        if (addTeamMember(userId, ctx.from.id)) {
          added++;
        }
      }
    } catch (error: any) {
      errors++;
      errorsList.push(`Fehler bei ${line}: ${error.message}`);
    }
  }

  const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
  await sendToAdminLogChat(
    `👥 <b>Team-Import abgeschlossen</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from.id}</code>)\n` +
    `✅ Hinzugefügt: ${added}\n` +
    `⏳ Vorgemerkt: ${pending}\n` +
    `❌ Fehler: ${errors}\n` +
    (errorsList.length > 0 ? `\nFehler:\n${errorsList.slice(0, 5).join('\n')}` : ''),
    ctx,
    true
  );

  await ctx.reply(
    `✅ Team-Import abgeschlossen:\n\n` +
    `✅ Hinzugefügt: ${added}\n` +
    `⏳ Vorgemerkt: ${pending}\n` +
    `❌ Fehler: ${errors}`,
    { parse_mode: 'HTML' }
  );
}

// Unban Command (implemented)
export async function handlePanicCommand(ctx: Context, action?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const { config } = await import('./config');
  let newPanicMode: boolean;
  
  if (action === 'on') {
    newPanicMode = true;
  } else if (action === 'off') {
    newPanicMode = false;
  } else {
    // Toggle wenn kein Parameter
    newPanicMode = !config.panicMode;
  }
  
  // Setze Panic-Mode (über Environment Variable - muss in .env gesetzt werden)
  // Für jetzt: Log nur
  console.log(`[PANIC] Panic-Mode ${newPanicMode ? 'AKTIVIERT' : 'DEAKTIVIERT'} durch Admin ${ctx.from.id}`);
  
  await ctx.reply(
    `🧯 <b>Panic-Mode ${newPanicMode ? 'AKTIVIERT' : 'DEAKTIVIERT'}</b>\n\n` +
    `${newPanicMode ? '⚠️' : '✅'} Auto-Bans: ${newPanicMode ? 'GESTOPPT' : 'AKTIV'}\n` +
    `${newPanicMode ? '⚠️' : '✅'} Cluster-Eskalation: ${newPanicMode ? 'GESTOPPT' : 'AKTIV'}\n` +
    `${newPanicMode ? '✅' : '⚠️'} Logs + Beobachtung: ${newPanicMode ? 'AKTIV' : 'NORMAL'}\n\n` +
    `ℹ️ <i>Hinweis: Panic-Mode muss in .env gesetzt werden (PANIC_MODE=true/false)</i>`,
    { parse_mode: 'HTML' }
  );
  
    const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
  await logAdmin({
    action: 'INFO',
    userId: 0,
    reason: `Panic-Mode ${newPanicMode ? 'AKTIVIERT' : 'DEAKTIVIERT'}`,
    adminId: ctx.from.id,
    adminName,
  }, ctx);
}

export async function handleUnbanCommand(ctx: Context, userIdOrUsername: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  let userId: number | null = null;

  // Prüfe ob @username oder user_id
  if (userIdOrUsername.startsWith('@')) {
    // Username
    const username = userIdOrUsername.replace('@', '').trim();
    
    // Prüfe ob in pending username blacklist
    const pendingRemoved = removePendingUsernameBlacklist(username);
    if (pendingRemoved) {
      await ctx.reply(`✅ Username @${username} wurde aus pending Blacklist entfernt.`, { parse_mode: 'HTML' });
      return;
    }
    
    // Versuche user_id zu resolven
    try {
      const chat = await ctx.telegram.getChat(`@${username}`);
      if ('id' in chat) {
        userId = chat.id;
      }
    } catch {
      // Nicht auflösbar
    }
    
    if (!userId) {
      // Versuche über getUsersByUsername
      const { getUsersByUsername } = await import('./db');
      const userIds = getUsersByUsername(username);
      if (userIds.length > 0) {
        userId = userIds[0];
      }
    }
    
    if (!userId) {
      await ctx.reply(`❌ User-ID für @${username} nicht auflösbar. Bitte User-ID schicken oder User muss zuerst sichtbar werden.`, { parse_mode: 'HTML' });
      return;
    }
  } else {
    // User-ID
    userId = parseInt(userIdOrUsername, 10);
    if (isNaN(userId)) {
      await ctx.reply('❌ Ungültige User-ID oder Username. Format: /unban <user_id|@username>');
      return;
    }
  }

  // Entferne aus Blacklist
  removeFromBlacklist(userId);
  setUserObserved(userId, false);
  
  // Entferne auch aus username_blacklist falls vorhanden
  const { removeUsernameFromBlacklist } = await import('./db');
  const username = (await import('./db')).getUser(userId)?.has_username ? `@${userId}` : null;
  if (username) {
    removeUsernameFromBlacklist(username);
  }

  const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
  const reason = `Manuell durch Admin ${ctx.from.id} (${adminName}): Unban-Command`;
  const result = await unbanUserInAllGroups(userId, reason);

  await logAdmin({
    action: 'UNBANNED',
    userId,
    reason: `${reason}\nUnban: ${result.success} Erfolg, ${result.failed} Fehler, ${result.skipped} Übersprungen\nAus Blacklist entfernt`,
      adminId: ctx.from.id,
      adminName,
  }, ctx);

  await ctx.reply(
    `✅ <b>User global entbannt</b>\n\n` +
    `🆔 User ID: <code>${userId}</code>\n` +
    `📊 Gruppen: ${result.success} erfolgreich, ${result.failed} Fehler, ${result.skipped} übersprungen\n\n` +
    `User wurde aus der Blacklist entfernt und in allen managed Gruppen entbannt.`,
    { parse_mode: 'HTML' }
  );
}

/**
 * /pardon <user_id> - Entfernt User komplett aus allen Listen (clean slate)
 */
export async function handlePardonCommand(ctx: Context, userIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  if (!userIdStr) {
    await ctx.reply('❌ Bitte gib eine User-ID an: /pardon <user_id>');
    return;
  }

  const userId = parseInt(userIdStr, 10);
  if (isNaN(userId)) {
    await ctx.reply('❌ Ungültige User-ID.');
    return;
  }

  // Entferne aus allen Listen
  removeFromBlacklist(userId);
  setUserObserved(userId, false);
  
  // Entferne auch aus username_blacklist falls vorhanden
  const { removeUsernameFromBlacklist, getUser } = await import('./db');
  const user = getUser(userId);
  if (user && user.has_username) {
    // Username kann nicht direkt aus User abgeleitet werden, aber wir können versuchen
    // TODO: Username aus DB holen falls vorhanden
  }

  // Unban in allen Gruppen
  const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
  const reason = `Manuell durch Admin ${ctx.from.id} (${adminName}): Pardon-Command`;
  const result = await unbanUserInAllGroups(userId, reason);

  await logAdmin({
    action: 'UNBANNED',
      userId,
    reason: `${reason}\nPardon: ${result.success} Erfolg, ${result.failed} Fehler, ${result.skipped} Übersprungen\nAus allen Listen entfernt`,
      adminId: ctx.from.id,
      adminName,
  }, ctx);

  await ctx.reply(
    `✅ <b>User komplett freigegeben (Pardon)</b>\n\n` +
    `🆔 User ID: <code>${userId}</code>\n` +
    `📊 Gruppen: ${result.success} erfolgreich, ${result.failed} Fehler, ${result.skipped} übersprungen\n\n` +
    `User wurde aus allen Listen entfernt und in allen managed Gruppen entbannt.`,
    { parse_mode: 'HTML' }
  );
}

/**
 * /shield status - Zeigt Bot-Status und Miss-Rose-Empfehlung
 */
// Stub functions for missing commands
// ============================================================================
// New Welcome System Commands (group_settings)
// ============================================================================

/**
 * Helper: Resolve chat_id from command or context
 */
async function resolveChatIdForWelcome(ctx: Context, chatIdStr?: string): Promise<string | null> {
  // Wenn chat_id explizit angegeben, verwende das
  if (chatIdStr) {
    return chatIdStr;
  }
  
  // Wenn in Gruppenchat, verwende aktuelle Gruppe
  if (ctx.chat && 'id' in ctx.chat) {
    return ctx.chat.id.toString();
  }
  
  // Wenn in privatem Chat, gib null zurück (wird später behandelt)
  return null;
}

/**
 * Helper: Zeige Top 10 Managed Gruppen als Inline Buttons
 */
async function showGroupSelection(ctx: Context, action: string): Promise<void> {
  const { getManagedGroups } = await import('./db');
  const managedGroups = getManagedGroups().slice(0, 10);
  
  if (managedGroups.length === 0) {
    await ctx.reply('❌ Keine managed Gruppen gefunden.');
    return;
  }
  
  // TODO: Inline Keyboard mit Gruppen-Auswahl implementieren
  // Für jetzt: Zeige Liste
  const groupList = managedGroups.map((g, i) => `${i + 1}. ${g.title || String(g.chatId)} (<code>${g.chatId}</code>)`).join('\n');
  await ctx.reply(
    `📋 <b>Wähle eine Gruppe:</b>\n\n${groupList}\n\n` +
    `ℹ️ Verwende: <code>/${action} &lt;chat_id&gt;</code>`,
    { parse_mode: 'HTML' }
  );
}

/**
 * /welcome on [chat_id] - Aktiviert Welcome für eine Gruppe
 */
export async function handleWelcomeOnCommand(ctx: Context, chatIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const chatId = await resolveChatIdForWelcome(ctx, chatIdStr);
  if (!chatId) {
    await showGroupSelection(ctx, 'welcome on');
    return;
  }
  
  const { upsertGroupSettings, getGroup } = await import('./db');
  const group = getGroup(chatId);
  if (!group) {
    await ctx.reply(`❌ Gruppe ${chatId} nicht gefunden.`);
    return;
  }

  upsertGroupSettings(chatId, { welcome_enabled: true });
  await ctx.reply(`✅ Welcome aktiviert für Gruppe: ${group.title || chatId}`);
}

/**
 * /welcome off [chat_id] - Deaktiviert Welcome für eine Gruppe
 */
export async function handleWelcomeOffCommand(ctx: Context, chatIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  
  const chatId = await resolveChatIdForWelcome(ctx, chatIdStr);
  if (!chatId) {
    await showGroupSelection(ctx, 'welcome off');
    return;
  }
  
  const { upsertGroupSettings, getGroup } = await import('./db');
  const group = getGroup(chatId);
  if (!group) {
    await ctx.reply(`❌ Gruppe ${chatId} nicht gefunden.`);
    return;
  }
  
  upsertGroupSettings(chatId, { welcome_enabled: false });
  await ctx.reply(`❌ Welcome deaktiviert für Gruppe: ${group.title || chatId}`);
}

/**
 * /setref <refcode> [chat_id] - Setzt Ref-Code für eine Gruppe
 */
export async function handleWelcomeSetRefCommand(ctx: Context, refCodeStr?: string, chatIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
      await ctx.reply('❌ Du bist kein Administrator.');
      return;
    }
  
  if (!refCodeStr) {
    await ctx.reply('❌ Bitte gib einen Ref-Code an: /setref <refcode> [chat_id]');
      return;
    }
  
  const chatId = await resolveChatIdForWelcome(ctx, chatIdStr);
  if (!chatId) {
    await showGroupSelection(ctx, 'setref');
    return;
  }
  
  const { upsertGroupSettings, getGroup } = await import('./db');
  const group = getGroup(chatId);
  if (!group) {
    await ctx.reply(`❌ Gruppe ${chatId} nicht gefunden.`);
    return;
  }
  
  upsertGroupSettings(chatId, { ref_code: refCodeStr.trim() });
  await ctx.reply(`✅ Ref-Code gesetzt: <code>${refCodeStr.trim()}</code> für Gruppe: ${group.title || chatId}`, { parse_mode: 'HTML' });
}

/**
 * /setbrand geldhelden|coop [chat_id] - Setzt Brand-Modus
 */
export async function handleWelcomeSetBrandCommand(ctx: Context, brandStr?: string, chatIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  
  if (!brandStr) {
    await ctx.reply('❌ Bitte gib einen Brand-Modus an: /setbrand geldhelden|coop [chat_id]');
    return;
  }
  
  const brandMode = brandStr.toLowerCase() === 'coop' ? 'STAATENLOS_COOP' : 'GELDHELDEN';
  
  const chatId = await resolveChatIdForWelcome(ctx, chatIdStr);
  if (!chatId) {
    await showGroupSelection(ctx, 'setbrand');
    return;
  }
  
  const { upsertGroupSettings, getGroup } = await import('./db');
  const group = getGroup(chatId);
  if (!group) {
    await ctx.reply(`❌ Gruppe ${chatId} nicht gefunden.`);
    return;
  }
  
  upsertGroupSettings(chatId, { brand_mode: brandMode });
  await ctx.reply(`✅ Brand-Modus gesetzt: <b>${brandMode}</b> für Gruppe: ${group.title || chatId}`, { parse_mode: 'HTML' });
}

/**
 * /setintro <text...> [chat_id] - Setzt Custom Intro
 */
export async function handleWelcomeSetIntroCommand(ctx: Context, introText?: string, chatIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  if (!introText) {
    await ctx.reply('❌ Bitte gib einen Intro-Text an: /setintro <text...> [chat_id]');
    return;
  }
  
  const chatId = await resolveChatIdForWelcome(ctx, chatIdStr);
  if (!chatId) {
    await showGroupSelection(ctx, 'setintro');
    return;
  }

  const { upsertGroupSettings, getGroup } = await import('./db');
  const group = getGroup(chatId);
  if (!group) {
    await ctx.reply(`❌ Gruppe ${chatId} nicht gefunden.`);
    return;
  }
  
  upsertGroupSettings(chatId, { custom_intro: introText.trim() });
  await ctx.reply(`✅ Custom Intro gesetzt für Gruppe: ${group.title || chatId}`);
}

/**
 * /welcome preview [chat_id] - Zeigt Vorschau des Welcome-Textes
 */
export async function handleWelcomePreviewCommand(ctx: Context, chatIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const chatId = await resolveChatIdForWelcome(ctx, chatIdStr);
  if (!chatId) {
    await showGroupSelection(ctx, 'welcome preview');
    return;
  }

  const { previewWelcomeText } = await import('./welcomeNew');
  const preview = previewWelcomeText(chatId, { firstName: ctx.from.first_name, username: ctx.from.username });
  
  if (!preview) {
    await ctx.reply(`❌ Fehler beim Erstellen der Vorschau für Gruppe ${chatId}.`);
    return;
  }
  
  await ctx.reply(`📋 <b>Welcome-Vorschau:</b>\n\n<pre>${preview}</pre>`, { parse_mode: 'HTML' });
}

export async function handleWelcomeClearRefCommand(ctx: Context, args: string[]): Promise<void> {
  await handleWelcomeRefCommand(ctx, 'clear');
}

export async function handleWelcomeTemplateShowCommand(ctx: Context, args: string[]): Promise<void> {
  await handleWelcomeTemplateCommand(ctx, 'show');
}

export async function handleWelcomeTemplateSetCommand(ctx: Context, args: string[]): Promise<void> {
  await handleWelcomeTemplateCommand(ctx, 'set');
}

export async function handleWelcomeTemplateClearCommand(ctx: Context, args: string[]): Promise<void> {
  await handleWelcomeTemplateCommand(ctx, 'clear');
}

export async function handleWelcomeTestCommand(ctx: Context, args: string[]): Promise<void> {
  await handleWelcomeTemplateCommand(ctx, 'test');
}

// K12: Alte handleSetRefCommand und handleSetPartnerCommand entfernt - werden durch neue Versionen weiter unten ersetzt

// K12: Alte handleSetLocationCommand entfernt - wird durch neue Version weiter unten ersetzt

export async function handleClearRefCommand(ctx: Context, args: string[]): Promise<void> {
  await handleWelcomeRefCommand(ctx, 'clear');
}

export async function handleMyRefCommand(ctx: Context, refCodeStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  // TODO: Implement personal admin ref
  await ctx.reply('⚠️ Persönliche Admin-Refs sind noch nicht implementiert.');
}

/**
 * /stats group [chat_id] - Zeigt GroupRisk-Informationen für eine Gruppe (READ ONLY)
 */
export async function handleStatsGroupCommand(ctx: Context, chatIdStr?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }
  
  const { getGroup, getGroupStats } = await import('./db');
  const { getGroupRiskLevel } = await import('./groupRisk');
  
  const chatId = chatIdStr || (ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : null);
  
  if (!chatId) {
    await ctx.reply('❌ Bitte gib eine Chat-ID an oder verwende den Befehl in einer Gruppe.');
    return;
  }

  const group = getGroup(chatId);
  if (!group) {
    await ctx.reply(`❌ Gruppe ${chatId} nicht gefunden.`);
    return;
  }
  
  // READ ONLY: Nur Stats lesen, keine Berechnung mit Side-Effects
  const stats = getGroupStats(chatId);
  if (!stats) {
    await ctx.reply(`ℹ️ Keine Risk-Statistiken für Gruppe ${group.title || chatId} verfügbar.`);
    return;
  }
  
  // Risk-Level aus Score berechnen (READ ONLY)
  const riskLevel = getGroupRiskLevel(stats.risk_score);
  const emoji = riskLevel === 'CRITICAL' ? '🔴' : riskLevel === 'WARNING' ? '🟠' : riskLevel === 'ATTENTION' ? '🟡' : '🟢';
  
  await ctx.reply(
    `📊 <b>Group Risk Status</b>\n\n` +
    `📋 <b>Gruppe:</b> ${group.title || 'Unbekannt'}\n` +
    `🆔 <b>Chat ID:</b> <code>${chatId}</code>\n\n` +
    `${emoji} <b>Risk-Level:</b> ${riskLevel}\n` +
    `📈 <b>Risk-Score:</b> ${stats.risk_score}\n\n` +
    `📊 <b>Statistiken (24h):</b>\n` +
    `   └ Joins: ${stats.joins_24h}\n` +
    `   └ HIGH-Risk Users: ${stats.high_risk_users_24h}\n` +
    `   └ Bans: ${stats.bans_24h}\n\n` +
    `🕐 <b>Letzte Aktualisierung:</b> ${new Date(stats.last_updated).toLocaleString('de-DE')}\n\n` +
    `ℹ️ <i>Nur Anzeige - keine automatischen Maßnahmen</i>`,
    { parse_mode: 'HTML' }
  );
  //   await ctx.reply(`❌ Gruppe ${chatId} nicht gefunden.`);
  //   return;
  // }
  // 
  // const assessment = evaluateGroupRisk(chatId);
  // const level = getGroupRiskLevel(assessment.score);
  // 
  // const levelEmoji = {
  //   'STABLE': '🟢',
  //   'ATTENTION': '🟡',
  //   'WARNING': '🟠',
  //   'CRITICAL': '🔴',
  // }[level] || '⚪';
  // 
  // await ctx.reply(
  //   `${levelEmoji} <b>Gruppen-Risiko-Status</b>\n\n` +
  //   `📍 Gruppe: <b>${group.title || 'Unbekannt'}</b> (<code>${chatId}</code>)\n` +
  //   `📈 Risk-Level: <b>${level}</b> (Score: ${assessment.score})\n\n` +
  //   `<b>Empfehlungen:</b>\n` +
  //   assessment.recommendations.map(r => `• ${r}`).join('\n'),
  //   { parse_mode: 'HTML' }
  // );
}

export async function handleDiagCommand(ctx: Context, args: string[]): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  try {
    const { getManagedGroups, getDatabase } = await import('./db');
    const { config } = await import('./config');
    
    // Uptime (wird von index.ts gesetzt)
    const botStartTime = (global as any).botStartTime || Date.now();
    const uptime = Math.floor((Date.now() - botStartTime) / 1000);
    const uptimeMinutes = Math.floor(uptime / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);
    const uptimeStr = uptimeDays > 0
      ? `${uptimeDays}d ${uptimeHours % 24}h ${uptimeMinutes % 60}m`
      : uptimeHours > 0
      ? `${uptimeHours}h ${uptimeMinutes % 60}m`
      : `${uptimeMinutes}m`;
    
    // Version/Commit (aus package.json oder ENV)
    let version = 'unknown';
    let commitHash = 'unknown';
    try {
      const packageJson = require('../package.json');
      version = packageJson.version || process.env.npm_package_version || 'unknown';
    } catch {
      version = process.env.npm_package_version || 'unknown';
    }
    commitHash = process.env.COMMIT_HASH || process.env.GIT_COMMIT || 'unknown';
    
    // Managed Groups
    const managedGroups = getManagedGroups();
    
    // DB-Status
    let dbOk = false;
    try {
      const db = getDatabase();
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch (error) {
      dbOk = false;
    }
    
    // Last Update ID (wird von index.ts gesetzt)
    const lastUpdateId = (global as any).lastUpdateId || null;
    
    // Action Mode
    const actionMode = config.actionMode.toUpperCase();
    
    await ctx.reply(
      `🔍 <b>Shield Diagnose</b>\n\n` +
      `⏱️  Uptime: <code>${uptimeStr}</code>\n` +
      `📦 Version: <code>${version}</code>\n` +
      `🔖 Commit: <code>${commitHash.substring(0, 7)}</code>\n` +
      `📊 Managed Groups: <code>${managedGroups.length}</code>\n` +
      `💾 DB Status: ${dbOk ? '✅ OK' : '❌ ERROR'}\n` +
      `🔄 Last Update ID: <code>${lastUpdateId || 'none'}</code>\n` +
      `⚙️  Action Mode: <code>${actionMode}</code>`,
      { parse_mode: 'HTML' }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Diag] Fehler:', errorMessage);
    await ctx.reply(`❌ Fehler beim Abrufen der Diagnose: ${errorMessage}`);
  }
}

export async function handleDbCheckCommand(ctx: Context, args: string[]): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  try {
    const { getDatabase, getAllGroups, getManagedGroups } = await import('./db');
    const db = getDatabase();
    
    // User Count
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    
    // Join Count
    const joinCount = db.prepare('SELECT COUNT(*) as count FROM joins').get() as { count: number };
    
    // Managed Groups Count
    const managedGroups = getManagedGroups();
    const allGroups = getAllGroups();
    
    // Last Join Time
    const lastJoin = db.prepare('SELECT MAX(joined_at) as last_join FROM joins').get() as { last_join: number | null };
    const lastJoinTime = lastJoin.last_join 
      ? new Date(lastJoin.last_join).toISOString() 
      : 'Kein Join';
    
    // Duplicate Detection (Joins mit gleichem user_id + chat_id + minute_bucket)
    // Prüfe auf potenzielle Duplikate (gleicher user_id + chat_id innerhalb 1 Minute)
    const duplicateCheck = db.prepare(`
      SELECT user_id, chat_id, COUNT(*) as count
      FROM joins
      GROUP BY user_id, chat_id, (joined_at / 60000)
      HAVING count > 1
      LIMIT 10
    `).all() as Array<{ user_id: number; chat_id: string; count: number }>;
    
    const duplicateCount = duplicateCheck.length;
    const duplicateDetails = duplicateCheck.length > 0
      ? duplicateCheck.map(d => `  - user=${d.user_id} chat=${d.chat_id} count=${d.count}`).join('\n')
      : '  Keine Duplikate gefunden';
    
    await ctx.reply(
      `🔍 <b>DB Check</b>\n\n` +
      `👥 User Count: <code>${userCount.count}</code>\n` +
      `🔄 Join Count: <code>${joinCount.count}</code>\n` +
      `📊 Managed Groups: <code>${managedGroups.length}</code>\n` +
      `📋 Total Groups: <code>${allGroups.length}</code>\n` +
      `🕐 Last Join: <code>${lastJoinTime}</code>\n` +
      `🔍 Duplicates Detected: <code>${duplicateCount}</code>\n` +
      (duplicateCount > 0 ? `\n<pre>${duplicateDetails}</pre>` : ''),
      { parse_mode: 'HTML' }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DbCheck] Fehler:', errorMessage);
    await ctx.reply(`❌ Fehler beim DB-Check: ${errorMessage}`);
  }
}

export async function handleDryRunToggleCommand(ctx: Context, args: string[]): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const { isDryRunMode, setDryRunMode } = await import('./config');
  const input = args.length > 0 ? args[0]?.trim()?.toLowerCase() : null;

  if (!input || (input !== 'on' && input !== 'off')) {
    const currentStatus = isDryRunMode() ? 'AKTIV' : 'INAKTIV';
    await ctx.reply(
      `🔍 <b>Dry-Run Mode</b>\n\n` +
      `Aktueller Status: <b>${currentStatus}</b>\n\n` +
      `Verwendung:\n` +
      `<code>/dryrun on</code> - Aktiviert Dry-Run Mode\n` +
      `<code>/dryrun off</code> - Deaktiviert Dry-Run Mode`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const enabled = input === 'on';
  setDryRunMode(enabled);
  
  const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
  console.log(`[DRYRUN] ${enabled ? 'AKTIVIERT' : 'DEAKTIVIERT'} durch Admin ${adminName} (${ctx.from.id})`);
  
  await sendToAdminLogChat(
    `🔍 <b>Dry-Run Mode ${enabled ? 'AKTIVIERT' : 'DEAKTIVIERT'}</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from.id}</code>)\n` +
    `⚙️ Status: <b>${enabled ? 'AKTIV' : 'INAKTIV'}</b>\n\n` +
    (enabled 
      ? `⚠️ Keine echten Aktionen (ban/restrict/kick) werden ausgeführt.\nAlle Aktionen werden nur geloggt.`
      : `✅ Echte Aktionen werden wieder ausgeführt.`),
    ctx,
    true
  );

  await ctx.reply(
    `✅ Dry-Run Mode wurde <b>${enabled ? 'AKTIVIERT' : 'DEAKTIVIERT'}</b>.\n\n` +
    (enabled 
      ? `⚠️ Keine echten Aktionen werden ausgeführt. Alle Aktionen werden nur geloggt mit <code>[DRYRUN]</code> Tag.`
      : `✅ Echte Aktionen werden wieder ausgeführt.`),
    { parse_mode: 'HTML' }
  );
}

export async function handleDryRunStatusCommand(ctx: Context, args: string[]): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const { isDryRunMode, config } = await import('./config');
  const enabled = isDryRunMode();
  const runtimeOverride = (global as any).runtimeDryRunMode !== undefined;

  await ctx.reply(
    `🔍 <b>Dry-Run Status</b>\n\n` +
    `⚙️ Aktueller Status: <b>${enabled ? '✅ AKTIV' : '❌ INAKTIV'}</b>\n` +
    `📋 Config (ENV): ${config.dryRunMode ? '✅ Aktiv' : '❌ Inaktiv'}\n` +
    (runtimeOverride ? `🔄 Runtime-Override: <b>${enabled ? '✅ Aktiv' : '❌ Inaktiv'}</b>\n` : '🔄 Runtime-Override: <i>Nicht gesetzt (Config wird verwendet)</i>\n') +
    `\n` +
    (enabled 
      ? `⚠️ <b>Dry-Run aktiv:</b> Keine echten Aktionen (ban/restrict/kick) werden ausgeführt.\nAlle Aktionen werden nur geloggt mit <code>[DRYRUN]</code> Tag.`
      : `✅ <b>Dry-Run inaktiv:</b> Echte Aktionen werden ausgeführt.`),
    { parse_mode: 'HTML' }
  );
}

export async function handleShieldStatusCommand(ctx: Context, args: string[]): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  const { getManagedGroups, getGroupConfig } = await import('./db');
  const managedGroups = getManagedGroups();
  
  let welcomeActive = 0;
  let linkPolicyActive = 0;
  let scamFilterActive = 0;
  let antiFloodActive = 0;

  for (const group of managedGroups) {
    const config = getGroupConfig(String(group.chatId));
    if (config) {
      if (config.enable_welcome) welcomeActive++;
      if (config.enable_link_policy) linkPolicyActive++;
      if (config.enable_scam_detection) scamFilterActive++;
      if (config.antiflood_enabled) antiFloodActive++;
    }
  }

  let statusText = `🛡️ <b>Geldhelden Shield Status</b>\n\n`;
  statusText += `📊 <b>Managed Gruppen:</b> ${managedGroups.length}\n\n`;
  statusText += `🎛️ <b>Feature-Status:</b>\n`;
  statusText += `👋 Welcome: ${welcomeActive} Gruppen aktiv\n`;
  statusText += `🔗 Link-Policy: ${linkPolicyActive} Gruppen aktiv\n`;
  statusText += `🚫 Scam-Filter: ${scamFilterActive} Gruppen aktiv\n`;
  statusText += `⚡ Anti-Flood: ${antiFloodActive} Gruppen aktiv\n\n`;
  
  // Miss-Rose-Empfehlung
  if (welcomeActive > 0 && linkPolicyActive > 0 && scamFilterActive > 0) {
    statusText += `✅ <b>Miss Rose kann entfernt werden</b>\n`;
    statusText += `Shield übernimmt alle Kernfunktionen.`;
  } else {
    statusText += `⚠️ <b>Miss Rose noch aktiv erkannt</b>\n`;
    statusText += `Einige Features sind noch nicht vollständig aktiviert.`;
  }

  await ctx.reply(statusText, { parse_mode: 'HTML' });
}

// ============================================================================
// Group Config Commands
// ============================================================================

/**
 * /group status - Zeigt die aktuelle Konfiguration einer Gruppe
 */
export async function handleGroupStatusCommand(ctx: Context, args: string[]): Promise<void> {
  // Prüfe Admin-Rechte (Super-Admin oder Group-Admin)
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }

  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  // Stelle sicher, dass Config existiert
  const currentGroup = getGroup(chatId);
  ensureGroupConfig(chatId, currentGroup?.title || undefined);
  const config = getGroupConfig(chatId);
  
  if (!config) {
    await ctx.reply('❌ Fehler beim Laden der Konfiguration.');
    return;
  }
  
  const groupTitle = currentGroup?.title || 'Unbekannt';
  
  // Baue Status-Nachricht
  let statusText = `⚙️ <b>Gruppen-Konfiguration</b>\n\n`;
  statusText += `📋 Gruppe: <b>${groupTitle}</b>\n`;
  statusText += `🆔 Chat ID: <code>${chatId}</code>\n\n`;
  statusText += `🔧 <b>Status:</b>\n`;
  statusText += `${config.managed ? '✅' : '❌'} Managed: ${config.managed ? 'JA' : 'NEIN'}\n\n`;
  statusText += `🎛️ <b>Feature Flags:</b>\n`;
  statusText += `${config.enable_welcome ? '✅' : '❌'} Welcome: ${config.enable_welcome ? 'AKTIV' : 'INAKTIV'}\n`;
  statusText += `${config.enable_service_cleanup ? '✅' : '❌'} Service Cleanup: ${config.enable_service_cleanup ? 'AKTIV' : 'INAKTIV'}\n`;
  statusText += `${config.enable_link_policy ? '✅' : '❌'} Link Policy: ${config.enable_link_policy ? 'AKTIV' : 'INAKTIV'}\n`;
  statusText += `${config.enable_scam_detection ? '✅' : '❌'} Scam Detection: ${config.enable_scam_detection ? 'AKTIV' : 'INAKTIV'}\n`;
  statusText += `${config.enable_warns ? '✅' : '❌'} Warns: ${config.enable_warns ? 'AKTIV' : 'INAKTIV'}\n\n`;
  statusText += `🕐 Letzte Änderung: ${new Date(config.updated_at).toLocaleString('de-DE')}`;
  
  await ctx.reply(statusText, { parse_mode: 'HTML' });
}

/**
 * /group enable <feature> - Aktiviert ein Feature für die Gruppe
 */
export async function handleGroupEnableCommand(ctx: Context, featureNameStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
      return;
    }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
      return;
    }
  
  // Defensive: Prüfe ob featureNameStr vorhanden ist
  const featureNameInput = featureNameStr?.trim() ?? null;
  if (!featureNameInput) {
    await ctx.reply('❌ Bitte gib ein Feature an: welcome, cleanup, links, scam, warns');
    return;
  }
  
  const featureMap: Record<string, FeatureName> = {
    'welcome': 'welcome',
    'cleanup': 'cleanup',
    'links': 'links',
    'scam': 'scam',
    'warns': 'warns',
  };
  
  const featureName = featureMap[featureNameInput.toLowerCase()];
  if (!featureName) {
    await ctx.reply('❌ Ungültiges Feature. Verfügbar: welcome, cleanup, links, scam, warns');
    return;
  }
  
  // Mappe Feature-Name zu DB-Feld
  const updateMap: Record<FeatureName, Partial<{ enable_welcome: boolean; enable_service_cleanup: boolean; enable_link_policy: boolean; enable_scam_detection: boolean; enable_warns: boolean }>> = {
    'welcome': { enable_welcome: true },
    'cleanup': { enable_service_cleanup: true },
    'links': { enable_link_policy: true },
    'scam': { enable_scam_detection: true },
    'warns': { enable_warns: true },
  };
  
  const success = updateGroupConfig(chatId, updateMap[featureName]);
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Aktivieren des Features.');
    return;
  }
  
  const group = getGroup(chatId);
  const groupTitle = group?.title || 'Unbekannt';
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  // Logge Änderung
  console.log(`[GROUP_CONFIG] Feature aktiviert: chat=${chatId} feature=${featureName} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `⚙️ <b>Feature aktiviert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${groupTitle} (<code>${chatId}</code>)\n` +
    `✅ Feature: <b>${featureName}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Feature <b>${featureName}</b> wurde aktiviert.`, { parse_mode: 'HTML' });
}

/**
 * /group disable <feature> - Deaktiviert ein Feature für die Gruppe
 */
export async function handleGroupDisableCommand(ctx: Context, featureNameStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }

  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }

  // Defensive: Prüfe ob featureNameStr vorhanden ist
  const featureNameInput = featureNameStr?.trim() ?? null;
  if (!featureNameInput) {
    await ctx.reply('❌ Bitte gib ein Feature an: welcome, cleanup, links, scam, warns');
    return;
  }
  
  const featureMap: Record<string, FeatureName> = {
    'welcome': 'welcome',
    'cleanup': 'cleanup',
    'links': 'links',
    'scam': 'scam',
    'warns': 'warns',
  };
  
  const featureName = featureMap[featureNameInput.toLowerCase()];
  if (!featureName) {
    await ctx.reply('❌ Ungültiges Feature. Verfügbar: welcome, cleanup, links, scam, warns');
    return;
  }
  
  // Mappe Feature-Name zu DB-Feld
  const updateMap: Record<FeatureName, Partial<{ enable_welcome: boolean; enable_service_cleanup: boolean; enable_link_policy: boolean; enable_scam_detection: boolean; enable_warns: boolean }>> = {
    'welcome': { enable_welcome: false },
    'cleanup': { enable_service_cleanup: false },
    'links': { enable_link_policy: false },
    'scam': { enable_scam_detection: false },
    'warns': { enable_warns: false },
  };
  
  const success = updateGroupConfig(chatId, updateMap[featureName]);
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Deaktivieren des Features.');
    return;
  }

  const group = getGroup(chatId);
  const groupTitle = group?.title || 'Unbekannt';
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  // Logge Änderung
  console.log(`[GROUP_CONFIG] Feature deaktiviert: chat=${chatId} feature=${featureName} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `⚙️ <b>Feature deaktiviert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${groupTitle} (<code>${chatId}</code>)\n` +
    `❌ Feature: <b>${featureName}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`❌ Feature <b>${featureName}</b> wurde deaktiviert.`, { parse_mode: 'HTML' });
}

/**
 * /group managed on|off - Aktiviert/Deaktiviert managed Status für die Gruppe
 */
export async function handleGroupManagedCommand(ctx: Context, stateStr?: string): Promise<void> {
  // Nur Super-Admins dürfen managed Status ändern
  const adminCheck = await assertAdmin(ctx, 'global');
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Nur Super-Admins dürfen den managed Status ändern'}`);
    return;
  }
  
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }

  // Defensive: Prüfe ob stateStr vorhanden ist
  const state = stateStr?.trim()?.toLowerCase() ?? null;
  if (!state || (state !== 'on' && state !== 'off')) {
    await ctx.reply('❌ Bitte gib einen Status an: on oder off');
    return;
  }
  
  const managed = state === 'on';
  const success = updateGroupConfig(chatId, { managed });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Ändern des managed Status.');
    return;
  }
  
  const group = getGroup(chatId);
  const groupTitle = group?.title || 'Unbekannt';
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  // Logge Änderung
  console.log(`[GROUP_CONFIG] Managed Status geändert: chat=${chatId} managed=${managed} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `⚙️ <b>Managed Status geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${groupTitle} (<code>${chatId}</code>)\n` +
    `${managed ? '✅' : '❌'} Managed: <b>${managed ? 'AKTIVIERT' : 'DEAKTIVIERT'}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(
    `${managed ? '✅' : '❌'} Managed Status wurde ${managed ? 'aktiviert' : 'deaktiviert'}.`,
    { parse_mode: 'HTML' }
  );
}

// ============================================================================
// Welcome Commands
// ============================================================================

/**
 * /welcome show - Zeigt aktuellen Welcome-Status und Vorschau
 */
export async function handleWelcomeShowCommand(ctx: Context, args: string[]): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }

  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }

  const currentGroup = getGroup(chatId);
  ensureGroupConfig(chatId, currentGroup?.title || undefined);
  const config = getGroupConfig(chatId);
  
  if (!config || !currentGroup) {
    await ctx.reply('❌ Fehler beim Laden der Konfiguration.');
    return;
  }
  
  // Baue Status-Text
  let statusText = `👋 <b>Welcome-Konfiguration</b>\n\n`;
  statusText += `📋 Gruppe: <b>${currentGroup.title || 'Unbekannt'}</b>\n`;
  statusText += `🆔 Chat ID: <code>${chatId}</code>\n\n`;
  statusText += `🔧 <b>Status:</b>\n`;
  statusText += `${config.managed ? '✅' : '❌'} Managed: ${config.managed ? 'JA' : 'NEIN'}\n`;
  statusText += `${config.enable_welcome ? '✅' : '❌'} Welcome aktiviert: ${config.enable_welcome ? 'JA' : 'NEIN'}\n\n`;
  statusText += `🎛️ <b>Welcome-Einstellungen:</b>\n`;
  statusText += `Partner: ${config.welcome_partner || '<i>nicht gesetzt</i>'}\n`;
  statusText += `Ref-Code: ${config.welcome_ref_code ? `<code>${config.welcome_ref_code}</code>` : '<i>nicht gesetzt</i>'}\n`;
  statusText += `Custom Template: ${config.welcome_template ? '✅ Gesetzt' : '❌ Nicht gesetzt'}\n\n`;
  
  // Vorschau
  const preview = previewWelcomeText(chatId, { firstName: 'Max', username: 'maxmustermann' });
  if (preview) {
    statusText += `📝 <b>Vorschau:</b>\n`;
    statusText += `<code>${preview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;
  }
  
  await ctx.reply(statusText, { parse_mode: 'HTML' });
}

/**
 * /welcome ref <CODE> - Setzt Ref-Code
 * /welcome ref clear - Entfernt Ref-Code
 */
export async function handleWelcomeRefCommand(ctx: Context, refCodeStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }

  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  if (!refCodeStr || refCodeStr.toLowerCase() === 'clear') {
    // Ref-Code entfernen
    const success = updateGroupConfig(chatId, { welcome_ref_code: null });
    
    if (!success) {
      await ctx.reply('❌ Fehler beim Entfernen des Ref-Codes.');
      return;
    }
    
    const group = getGroup(chatId);
    const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
    
    console.log(`[WELCOME] Ref-Code entfernt: chat=${chatId} by=${ctx.from?.id}`);
    await sendToAdminLogChat(
      `👋 <b>Welcome Ref-Code entfernt</b>\n\n` +
      `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
      `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n`,
      ctx,
      true
    );
    
    await ctx.reply('✅ Ref-Code wurde entfernt.');
    return;
  }
  
  // Ref-Code setzen
  const refCode = refCodeStr.trim();
  if (refCode.length === 0) {
    await ctx.reply('❌ Ref-Code darf nicht leer sein.');
    return;
  }
  
  const success = updateGroupConfig(chatId, { welcome_ref_code: refCode });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Setzen des Ref-Codes.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[WELCOME] Ref-Code gesetzt: chat=${chatId} ref=${refCode} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `👋 <b>Welcome Ref-Code gesetzt</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `🔗 Ref-Code: <code>${refCode}</code>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Ref-Code wurde auf <code>${refCode}</code> gesetzt.`, { parse_mode: 'HTML' });
}

/**
 * /welcome partner on - Aktiviert Partner-Modus
 * /welcome partner off - Deaktiviert Partner-Modus
 */
export async function handleWelcomePartnerCommand(ctx: Context, stateStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  if (!stateStr) {
    await ctx.reply('❌ Bitte gib einen Status an: on oder off');
    return;
  }
  
  const state = stateStr.toLowerCase();
  if (state !== 'on' && state !== 'off') {
    await ctx.reply('❌ Ungültiger Status. Verwende: on oder off');
    return;
  }
  
  const partnerValue = state === 'on' ? 'staatenlos' : null;
  const success = updateGroupConfig(chatId, { welcome_partner: partnerValue });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Ändern des Partner-Modus.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[WELCOME] Partner-Modus geändert: chat=${chatId} partner=${partnerValue} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `👋 <b>Welcome Partner-Modus geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `${partnerValue ? '✅' : '❌'} Partner: <b>${partnerValue || 'DEAKTIVIERT'}</b>\n`,
    ctx,
    true
  );
      
      await ctx.reply(
    `${partnerValue ? '✅' : '❌'} Partner-Modus wurde ${partnerValue ? 'aktiviert' : 'deaktiviert'}.`,
        { parse_mode: 'HTML' }
      );
}

/**
 * /welcome template set - Startet Template-Erfassung
 * /welcome template clear - Entfernt Custom Template
 */
export async function handleWelcomeTemplateCommand(ctx: Context, actionStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }

  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }

  if (!actionStr || actionStr.toLowerCase() === 'clear') {
    // Template entfernen
    const success = updateGroupConfig(chatId, { welcome_template: null });
    
    if (!success) {
      await ctx.reply('❌ Fehler beim Entfernen des Templates.');
      return;
    }
    
    const group = getGroup(chatId);
    const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
    
    console.log(`[WELCOME] Template entfernt: chat=${chatId} by=${ctx.from?.id}`);
    await sendToAdminLogChat(
      `👋 <b>Welcome Template entfernt</b>\n\n` +
      `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
      `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n`,
      ctx,
      true
    );
    
    await ctx.reply('✅ Custom Template wurde entfernt. Es wird wieder das Standard-Template verwendet.');
    return;
  }
  
  if (actionStr.toLowerCase() === 'set') {
    // Template-Erfassung starten
    // Für jetzt: einfache Anleitung, später könnte man Conversation State nutzen
      await ctx.reply(
      `📝 <b>Custom Template setzen</b>\n\n` +
      `Sende mir eine Nachricht mit dem Template-Text.\n\n` +
      `Verfügbare Platzhalter:\n` +
      `• <code>{first}</code> - Vorname (Fallback: "Freund")\n` +
      `• <code>{username}</code> - @username (oder leer)\n` +
      `• <code>{bio_link}</code> - Link zu geldhelden.org/bio (mit Ref-Code falls gesetzt)\n\n` +
      `Beispiel:\n` +
      `<code>Hey {first} 👋\n\nWillkommen in unserer Gruppe!\n\nMehr Infos: {bio_link}</code>\n\n` +
      `⚠️ Wichtig: Sende die Nachricht als Antwort auf diese Nachricht.`,
        { parse_mode: 'HTML' }
      );
      
    // TODO: Conversation State für Template-Erfassung implementieren
    // Für jetzt: Admin muss /welcome template set <TEXT> verwenden
    return;
  }
  
  // Template direkt setzen (wenn als Parameter übergeben)
  const template = actionStr.trim();
  if (template.length === 0) {
    await ctx.reply('❌ Template darf nicht leer sein.');
    return;
  }
  
  const success = updateGroupConfig(chatId, { welcome_template: template });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Setzen des Templates.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[WELCOME] Template gesetzt: chat=${chatId} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `👋 <b>Welcome Template gesetzt</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n`,
    ctx,
    true
  );
  
  await ctx.reply('✅ Custom Template wurde gesetzt.');
}

// ============================================================================
// Scam Detection Commands
// ============================================================================

/**
 * /scam on|off - Aktiviert/Deaktiviert Scam-Detection
 */
export async function handleScamToggleCommand(ctx: Context, stateStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  if (!stateStr) {
    await ctx.reply('❌ Bitte gib einen Status an: on oder off');
    return;
  }
  
  const state = stateStr.toLowerCase();
  if (state !== 'on' && state !== 'off') {
    await ctx.reply('❌ Ungültiger Status. Verwende: on oder off');
    return;
  }
  
  const enabled = state === 'on';
  
  // Update group_settings (neue Tabelle)
  const { upsertGroupSettings } = await import('./db');
  upsertGroupSettings(chatId, { scam_enabled: enabled });
  
  // Auch group_config für Kompatibilität
  const success = updateGroupConfig(chatId, { enable_scam_detection: enabled });
  
  if (!success) {
    await ctx.reply('⚠️ Scam-Detection in group_settings gesetzt, aber group_config Update fehlgeschlagen.');
  }

  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[SCAM] Detection ${enabled ? 'aktiviert' : 'deaktiviert'}: chat=${chatId} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🚫 <b>Scam-Detection ${enabled ? 'aktiviert' : 'deaktiviert'}</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Scam-Detection wurde ${enabled ? 'aktiviert' : 'deaktiviert'}.`, { parse_mode: 'HTML' });
}

/**
 * /scam action <delete|warn|restrict|kick|ban> - Setzt Scam-Aktion
 */
export async function handleScamActionCommand(ctx: Context, actionStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  if (!actionStr) {
    await ctx.reply('❌ Bitte gib eine Aktion an: delete, warn, restrict, kick, ban');
    return;
  }
  
  const actionInput = actionStr.toLowerCase();
  const validActions: Array<'delete' | 'warn' | 'restrict' | 'kick' | 'ban'> = ['delete', 'warn', 'restrict', 'kick', 'ban'];
  
  if (!validActions.includes(actionInput as any)) {
    await ctx.reply('❌ Ungültige Aktion. Verfügbar: delete, warn, restrict, kick, ban');
    return;
  }
  
  // Explizite Typ-Zuweisung mit Fallback
  const action: 'delete' | 'warn' | 'restrict' | 'kick' | 'ban' = validActions.includes(actionInput as any) 
    ? (actionInput as 'delete' | 'warn' | 'restrict' | 'kick' | 'ban')
    : 'restrict'; // Fallback
  
  const success = updateGroupConfig(chatId, { scam_action: action });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Setzen der Aktion.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[SCAM] Aktion gesetzt: chat=${chatId} action=${action} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🚫 <b>Scam-Aktion geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `🎯 Aktion: <b>${action}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Scam-Aktion wurde auf <b>${action}</b> gesetzt.`, { parse_mode: 'HTML' });
}

/**
 * /scam threshold <0-100> - Setzt Scam-Threshold
 */
export async function handleScamThresholdCommand(ctx: Context, thresholdStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  // Defensive: Prüfe ob thresholdStr vorhanden ist
  const thresholdInput = thresholdStr?.trim() ?? null;
  if (!thresholdInput) {
    await ctx.reply('❌ Bitte gib einen Threshold an (0-100)');
    return;
  }
  
  const threshold = parseInt(thresholdInput, 10);
  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    await ctx.reply('❌ Ungültiger Threshold. Muss zwischen 0 und 100 liegen.');
    return;
  }

  const success = updateGroupConfig(chatId, { scam_threshold: threshold });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Setzen des Thresholds.');
    return;
  }

  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[SCAM] Threshold gesetzt: chat=${chatId} threshold=${threshold} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🚫 <b>Scam-Threshold geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `📊 Threshold: <b>${threshold}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Scam-Threshold wurde auf <b>${threshold}</b> gesetzt.`, { parse_mode: 'HTML' });
}

/**
 * /scam test <text> - Testet Scam-Erkennung
 */
/**
 * /scamtest <text...> - Testet Scam-Erkennung ohne Aktion
 */
export async function handleScamTestCommand(ctx: Context, testText?: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Du bist kein Administrator.');
    return;
  }

  if (!testText) {
    await ctx.reply('❌ Bitte gib einen Text zum Testen an: /scamtest <text...>');
    return;
  }
  
  const { scoreScam, extractUrls, normalizeText } = await import('./scam');
  
  // Extrahiere URLs
  const urls = extractUrls(testText);
  
  // Meta-Informationen (simuliert)
  const meta = {
    isForwarded: false,
    hasEntities: false,
  };
  
  // Score Scam
  const result = scoreScam(testText, urls, meta);
  
  // Formatiere Antwort
  const severityEmoji = result.severity === 'HIGH' ? '🔴' : result.severity === 'MEDIUM' ? '🟠' : '🟡';
  const response = 
    `🧪 <b>Scam-Test Ergebnis</b>\n\n` +
    `${severityEmoji} <b>Severity:</b> ${result.severity}\n` +
    `📊 <b>Score:</b> ${result.score}\n` +
    `📝 <b>Gründe:</b> ${result.reasons.length > 0 ? result.reasons.join(', ') : 'Keine'}\n` +
    `🔗 <b>URLs gefunden:</b> ${urls.length > 0 ? urls.join(', ') : 'Keine'}\n\n` +
    `💬 <b>Normalisierter Text:</b>\n<code>${normalizeText(testText)}</code>`;
  
  await ctx.reply(response, { parse_mode: 'HTML' });
}

// ============================================================================
// K12: Welcome Engine 2.0 Admin Commands
// ============================================================================

/**
 * K12: /groupconfig - Zeigt aktuelle Gruppenkonfiguration
 */
export async function handleGroupConfigCommand(ctx: Context, args: string[]): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  const group = getGroup(chatId);
  const config = getGroupConfig(chatId);
  
  if (!group) {
    await ctx.reply('❌ Gruppe nicht gefunden.');
    return;
  }
  
  // Partner bestimmen
  const brand = group.baseBrand;
  const partner = config?.welcome_partner || 
    (brand === 'staatenlos' ? 'staatenlos' : 
     brand === 'mixed' ? 'coop' : 'geldhelden');
  
  // Ort bestimmen
  const location = group.location || config?.welcome_partner || 'Nicht gesetzt';
  
  // Ref-Code
  const refCode = config?.welcome_ref_code || 'Nicht gesetzt';
  
  const response = 
    `📋 <b>Gruppenkonfiguration</b>\n\n` +
    `👥 <b>Gruppe:</b> ${group.title || 'Unbekannt'}\n` +
    `🤝 <b>Partner:</b> ${partner}\n` +
    `📍 <b>Ort:</b> ${location}\n` +
    `🔗 <b>Ref:</b> ${refCode}\n\n` +
    `💡 <i>Verwende /setpartner, /setlocation, /setref zum Ändern</i>`;
  
  await ctx.reply(response, { parse_mode: 'HTML' });
}

/**
 * K12: /setref <code> - Setzt Affiliate-Ref-Code (nur für geldhelden)
 */
export async function handleSetRefCommand(ctx: Context, args: string[]): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  // Defensive: Prüfe ob refCode vorhanden ist
  const refCodeInput = args.length > 0 ? args[0]?.trim() : null;
  if (!refCodeInput) {
    await ctx.reply('❌ Bitte gib einen Ref-Code an: /setref <code>');
    return;
  }
  
  const group = getGroup(chatId);
  const config = getGroupConfig(chatId);
  
  // Partner bestimmen
  const brand = group ? group.baseBrand : 'geldhelden';
  const partner = config?.welcome_partner || 
    (brand === 'staatenlos' ? 'staatenlos' : 
     brand === 'mixed' ? 'coop' : 'geldhelden');
  
  // K12: Ref-Code nur für geldhelden erlaubt
  if (partner !== 'geldhelden') {
    await ctx.reply(`❌ Ref-Code ist nur für Partner "geldhelden" erlaubt. Aktueller Partner: ${partner}`);
    return;
  }
  
  const success = updateGroupConfig(chatId, { welcome_ref_code: refCodeInput });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Setzen des Ref-Codes.');
    return;
  }
  
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  console.log(`[K12] Ref-Code gesetzt: chat=${chatId} ref=${refCodeInput} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🔗 <b>Ref-Code geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `🔗 Ref-Code: <b>${refCodeInput}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Ref-Code wurde auf <b>${refCodeInput}</b> gesetzt.`, { parse_mode: 'HTML' });
}

/**
 * K12: /setpartner <geldhelden|staatenlos|coop> - Setzt Partner-Typ
 */
export async function handleSetPartnerCommand(ctx: Context, args: string[]): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  // Defensive: Prüfe ob partnerStr vorhanden ist
  const partnerInput = args.length > 0 ? args[0]?.trim()?.toLowerCase() : null;
  if (!partnerInput) {
    await ctx.reply('❌ Bitte gib einen Partner an: /setpartner <geldhelden|staatenlos|coop>');
    return;
  }
  
  const validPartners: Array<'geldhelden' | 'staatenlos' | 'coop'> = ['geldhelden', 'staatenlos', 'coop'];
  if (!validPartners.includes(partnerInput as any)) {
    await ctx.reply('❌ Ungültiger Partner. Verfügbar: geldhelden, staatenlos, coop');
    return;
  }
  
  const partner = partnerInput as 'geldhelden' | 'staatenlos' | 'coop';
  
  // Wenn Partner auf staatenlos oder coop geändert wird, Ref-Code löschen
  const config = getGroupConfig(chatId);
  let updates: Partial<GroupConfig> = { welcome_partner: partner };
  if (partner !== 'geldhelden' && config?.welcome_ref_code) {
    updates.welcome_ref_code = null;
  }
  
  const success = updateGroupConfig(chatId, updates);
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Setzen des Partners.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  console.log(`[K12] Partner gesetzt: chat=${chatId} partner=${partner} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🤝 <b>Partner geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `🤝 Partner: <b>${partner}</b>\n` +
    (partner !== 'geldhelden' && config?.welcome_ref_code ? `\n⚠️ Ref-Code wurde entfernt (nur für geldhelden erlaubt)` : ''),
    ctx,
    true
  );
  
  await ctx.reply(`✅ Partner wurde auf <b>${partner}</b> gesetzt.`, { parse_mode: 'HTML' });
}

/**
 * K12: /setlocation <Ort> - Setzt Ort (überschreibt automatische Erkennung)
 */
export async function handleSetLocationCommand(ctx: Context, args: string[]): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  // Defensive: Prüfe ob locationStr vorhanden ist
  const locationInput = args.length > 0 ? args.join(' ').trim() : null;
  if (!locationInput) {
    await ctx.reply('❌ Bitte gib einen Ort an: /setlocation <Ort>');
    return;
  }
  
  // Update groups Tabelle (location Feld)
  const db = require('./db').getDatabase();
  try {
    const stmt = db.prepare('UPDATE groups SET location = ?, updated_at = ? WHERE chat_id = ?');
    stmt.run(locationInput, Date.now(), chatId);
  } catch (error: any) {
    console.error(`[K12] Fehler beim Setzen des Orts: chat=${chatId}`, error.message);
    await ctx.reply('❌ Fehler beim Setzen des Orts.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  console.log(`[K12] Ort gesetzt: chat=${chatId} location=${locationInput} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `📍 <b>Ort geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `📍 Ort: <b>${locationInput}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Ort wurde auf <b>${locationInput}</b> gesetzt.`, { parse_mode: 'HTML' });
}

// ============================================================================
// URL Policy Commands
// ============================================================================

/**
 * /url mode <allow|allowlist|block_all> - Setzt URL-Policy-Modus
 */
export async function handleUrlModeCommand(ctx: Context, modeStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }

  if (!modeStr) {
    await ctx.reply('❌ Bitte gib einen Modus an: allow, allowlist, block_all');
    return;
  }
  
  const mode = modeStr.toLowerCase();
  const validModes: Array<'allow' | 'allowlist' | 'block_all'> = ['allow', 'allowlist', 'block_all'];
  
  if (!validModes.includes(mode as any)) {
    await ctx.reply('❌ Ungültiger Modus. Verfügbar: allow, allowlist, block_all');
    return;
  }
  
  const success = updateGroupConfig(chatId, { url_policy_mode: mode as any });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Setzen des Modus.');
    return;
  }

  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[URL] Policy-Modus gesetzt: chat=${chatId} mode=${mode} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🔗 <b>URL-Policy-Modus geändert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `🎯 Modus: <b>${mode}</b>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ URL-Policy-Modus wurde auf <b>${mode}</b> gesetzt.`, { parse_mode: 'HTML' });
}

/**
 * /url allowlist add <domain> - Fügt Domain zur Allowlist hinzu
 */
export async function handleUrlAllowlistAddCommand(ctx: Context, domainStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }

  if (!domainStr) {
    await ctx.reply('❌ Bitte gib eine Domain an: /url allowlist add <domain>');
    return;
  }
  
  const domain = domainStr.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  
  const config = getGroupConfig(chatId);
  if (!config) {
    await ctx.reply('❌ Fehler beim Laden der Konfiguration.');
    return;
  }
  
  const currentAllowlist = (config.url_allowlist || 'geldhelden.org,t.me,telegram.me').split(',').map(d => d.trim());
  
  if (currentAllowlist.includes(domain)) {
    await ctx.reply(`ℹ️ Domain <code>${domain}</code> ist bereits in der Allowlist.`, { parse_mode: 'HTML' });
    return;
  }
  
  const newAllowlist = [...currentAllowlist, domain].join(',');
  const success = updateGroupConfig(chatId, { url_allowlist: newAllowlist });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Hinzufügen der Domain.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[URL] Domain hinzugefügt: chat=${chatId} domain=${domain} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🔗 <b>URL-Allowlist erweitert</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `➕ Domain: <code>${domain}</code>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Domain <code>${domain}</code> wurde zur Allowlist hinzugefügt.`, { parse_mode: 'HTML' });
}

/**
 * /url allowlist remove <domain> - Entfernt Domain aus Allowlist
 */
export async function handleUrlAllowlistRemoveCommand(ctx: Context, domainStr?: string): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }
  
  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  if (!domainStr) {
    await ctx.reply('❌ Bitte gib eine Domain an: /url allowlist remove <domain>');
    return;
  }
  
  const domain = domainStr.trim().toLowerCase();
  
  const config = getGroupConfig(chatId);
  if (!config) {
    await ctx.reply('❌ Fehler beim Laden der Konfiguration.');
    return;
  }
  
  const currentAllowlist = (config.url_allowlist || 'geldhelden.org,t.me,telegram.me').split(',').map(d => d.trim());
  
  if (!currentAllowlist.includes(domain)) {
    await ctx.reply(`ℹ️ Domain <code>${domain}</code> ist nicht in der Allowlist.`, { parse_mode: 'HTML' });
    return;
  }
  
  const newAllowlist = currentAllowlist.filter(d => d !== domain).join(',');
  const success = updateGroupConfig(chatId, { url_allowlist: newAllowlist });
  
  if (!success) {
    await ctx.reply('❌ Fehler beim Entfernen der Domain.');
    return;
  }
  
  const group = getGroup(chatId);
  const adminName = ctx.from?.username || ctx.from?.first_name || 'Unbekannt';
  
  console.log(`[URL] Domain entfernt: chat=${chatId} domain=${domain} by=${ctx.from?.id}`);
  await sendToAdminLogChat(
    `🔗 <b>URL-Allowlist gekürzt</b>\n\n` +
    `👤 Admin: ${adminName} (<code>${ctx.from?.id}</code>)\n` +
    `📋 Gruppe: ${group?.title || 'Unbekannt'} (<code>${chatId}</code>)\n` +
    `➖ Domain: <code>${domain}</code>\n`,
    ctx,
    true
  );
  
  await ctx.reply(`✅ Domain <code>${domain}</code> wurde aus der Allowlist entfernt.`, { parse_mode: 'HTML' });
}

/**
 * /url allowlist show - Zeigt aktuelle Allowlist
 */
export async function handleUrlAllowlistShowCommand(ctx: Context, args: string[]): Promise<void> {
  const chatId = ctx.chat && 'id' in ctx.chat ? ctx.chat.id.toString() : undefined;
  const adminCheck = await assertAdmin(ctx, 'group', chatId);
  
  if (!adminCheck.hasPermission) {
    await ctx.reply(`❌ ${adminCheck.error || 'Keine Berechtigung'}`);
    return;
  }

  if (!chatId) {
    await ctx.reply('❌ Keine Chat ID gefunden. Dieser Befehl muss in einer Gruppe ausgeführt werden.');
    return;
  }
  
  const config = getGroupConfig(chatId);
  if (!config) {
    await ctx.reply('❌ Fehler beim Laden der Konfiguration.');
    return;
  }
  
  const allowlist = (config.url_allowlist || 'geldhelden.org,t.me,telegram.me').split(',').map(d => d.trim());
  const mode = config.url_policy_mode || 'allowlist';
  
  let response = `🔗 <b>URL-Policy</b>\n\n`;
  response += `📋 Gruppe: <code>${chatId}</code>\n`;
  response += `🎯 Modus: <b>${mode}</b>\n\n`;
  response += `✅ Allowlist (${allowlist.length} Domains):\n`;
  for (const domain of allowlist) {
    response += `• <code>${domain}</code>\n`;
  }
  
  await ctx.reply(response, { parse_mode: 'HTML' });
}
