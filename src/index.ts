import { Telegraf, Context } from 'telegraf';
import { config } from './config';
import { initDatabase, registerGroup, closeDatabase, getGroup, getDistinctChatsInWindow, addToBlacklist, isBlacklisted, setUserObserved, isUserObserved, getUserIdsInManagedGroups, getManagedGroups, getOrCreateUser, updateUserStatus, hasRecentEscalation, recordEscalation, getJoinCount24h, hasRecentImpersonationWarning, recordImpersonationWarning, isUsernameBlacklisted, saveBaselineMember, recordJoin, isTeamMember, ensureUserExists, ensureGroupExists, getAllGroups, getDatabase } from './db';
import { isDuplicateJoin, joinDedupManager } from './dedup';
import { assessJoinRisk, runDecayMaintenance } from './risk';
import { runClusterDetection } from './cluster';
import * as cron from 'node-cron';
import { sendWeeklyReport } from './weekly';
import { runBaselineScan } from './scan';
import {
  handleAllowCommand,
  handleBanCommand,
  handleUnrestrictCommand,
  handleGroupsCommand,
  handleManageCommand,
  handleDisableCommand,
  handleUnmanageCommand,
  handleWhereAmICommand,
  handleStatsCommand,
  handleStatsGroupCommand,
  handleWeeklyPreviewCommand,
  handleWeeklyLastCommand,
  handleScanCommand,
  handleTeamAddCommand,
  handleTeamRemoveCommand,
  handleTeamListCommand,
  handleTeamImportCommand,
  handleUnbanCommand,
  handlePardonCommand,
  handleGroupStatusCommand,
  handleGroupEnableCommand,
  handleGroupDisableCommand,
  handleGroupManagedCommand,
  handleWelcomeShowCommand,
  handleWelcomeRefCommand,
  handleWelcomePartnerCommand,
  handleWelcomeTemplateCommand,
  handleWelcomeOnCommand,
  handleWelcomeOffCommand,
  handleWelcomeSetRefCommand,
  handleWelcomeClearRefCommand,
  handleWelcomeTemplateShowCommand,
  handleWelcomeTemplateSetCommand,
  handleWelcomeTemplateClearCommand,
  handleWelcomeTestCommand,
  handleWelcomeSetBrandCommand,
  handleWelcomeSetIntroCommand,
  handleWelcomePreviewCommand,
  handleScamToggleCommand,
  handleScamActionCommand,
  handleScamThresholdCommand,
  handleScamTestCommand,
  handleUrlModeCommand,
  handleUrlAllowlistAddCommand,
  handleUrlAllowlistRemoveCommand,
  handleUrlAllowlistShowCommand,
  handleSetRefCommand,
  handleClearRefCommand,
  handleMyRefCommand,
  handleShieldStatusCommand,
  handleDiagCommand,
  handleDbCheckCommand,
  handleDryRunToggleCommand,
  handleDryRunStatusCommand,
  handleGroupConfigCommand,
  handleSetPartnerCommand,
  handleSetLocationCommand,
  isAdmin,
} from './admin';
import { logAdmin, setBotInstance, unrestrictUserInAllGroups, sendToAdminLogChat, sendJoinLogWithActions, banUserInAllGroups, isUserAdminOrCreatorInGroup, sendEscalationLog, checkImpersonation, sendImpersonationWarning, isBotAdminInGroup, isGroupManaged, isGroupManagedLive } from './telegram';
import { ShieldEvent, createJoinEvent, ShieldEventSource, ShieldEventType, logEvent } from './events';
import { sendWelcomeIfEnabled } from './welcomeNew';
import { updateGroupProfileFromTitle, getAllowedDomains } from './groupIntelligence';
import { startAdminSyncScheduler } from './adminSync';
// TEMPORÄR DEAKTIVIERT: GroupRisk-Features
// import { evaluateGroupRisk } from './groupRisk';

// Initialisiere Datenbank
initDatabase();

// Erstelle Bot-Instanz
const bot = new Telegraf(config.botToken);
setBotInstance(bot);

// Initialisiere Welcome-Templates (Default-Templates)
import('./welcomeTemplates').then(({ initDefaultTemplates }) => {
  initDefaultTemplates();
});

// Führe Startup-Migration durch (Profilierung + Admin-Sync)
import('./migration').then(({ runStartupMigration }) => {
  runStartupMigration(bot);
});

// Letztes Join-Event für /debug last
interface LastJoinEvent {
  userId: number;
  chatId: string;
  source: ShieldEventSource;
  timestamp: number;
  decision: 'ignored' | 'logged' | 'action';
  reason?: string;
  action?: 'ban' | 'restrict' | 'observe';
}

let lastJoinEvent: LastJoinEvent | null = null;

// Update-Tracking für Diagnose
let lastUpdateId: number | null = null;
const botStartTime = Date.now();

// Exportiere für /diag Command
(global as any).lastUpdateId = lastUpdateId;
(global as any).botStartTime = botStartTime;

// Startup-Logging (nach DB-Initialisierung, um getManagedGroups zu nutzen)
function logStartupInfo(): void {
  const managedGroups = getManagedGroups();
  const allGroups = getAllGroups();
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🛡️  GELDHELDEN SHIELD – Bot gestartet');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📋 Konfiguration:`);
  console.log(`   Token: ${config.botToken.substring(0, 6)}...${config.botToken.substring(config.botToken.length - 4)}`);
  console.log(`   Admin IDs: ${config.adminIds.join(', ')}`);
  console.log(`   Admin Log Chat: ${config.adminLogChat}`);
  console.log(`   Action Mode: ${config.actionMode.toUpperCase()}`);
  console.log(`   Join Window: ${config.joinWindowHours}h, Threshold: ${config.joinThreshold}`);
  console.log(`   Timezone: ${config.timezone}`);
  console.log(`📊 Gruppen:`);
  console.log(`   Managed: ${managedGroups.length}`);
  console.log(`   Total: ${allGroups.length}`);
  console.log(`🔧 Feature-Flags:`);
  console.log(`   Welcome: ${config.enableWelcome ? '✅' : '❌'}`);
  console.log(`   Service Cleanup: ${config.enableServiceMessageCleanup ? '✅' : '❌'}`);
  console.log(`   Scam Detection: ${config.enableScamDetection ? '✅' : '❌'}`);
  console.log(`   Panic Mode: ${config.panicMode ? '⚠️  AKTIV' : '✅ Inaktiv'}`);
  console.log(`   Dry-Run Mode: ${config.dryRunMode ? '⚠️  AKTIV' : '✅ Inaktiv'}`);
  console.log(`   Debug Joins: ${config.debugJoins ? '✅' : '❌'}`);
  console.log('═══════════════════════════════════════════════════════════');
}

// Logge Startup-Info
logStartupInfo();

// Graceful Shutdown
process.once('SIGINT', () => {
  console.log('\n[SIGINT] Shutdown signal empfangen...');
  bot.stop('SIGINT');
  closeDatabase();
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('\n[SIGTERM] Shutdown signal empfangen...');
  bot.stop('SIGTERM');
  closeDatabase();
  process.exit(0);
});

// Fehlerbehandlung
bot.catch((err, ctx) => {
  console.error(`[Error] Unerwarteter Fehler für Update ${ctx.update.update_id}:`, err);
});

// ============================================================================
// Join-Event-Handler-Funktionen
// ============================================================================

/**
 * Loggt einen Join-Event in die Konsole
 */
function logJoin(userId: number, chatId: string, managed: boolean, source: ShieldEventSource): void {
  console.log(`[JOIN] user=${userId} chat=${chatId} managed=${managed} source=${source}`);
}

/**
 * Prüft ob Bot Admin-Rechte in einer Gruppe hat
 * Returns: { hasPermission: boolean, isAdmin: boolean, error: string | null }
 */
async function checkBotPermissions(chatId: string, ctx: Context): Promise<{ hasPermission: boolean; isAdmin: boolean; error: string | null }> {
  try {
    const botAdminCheck = await isBotAdminInGroup(chatId, ctx.telegram);
    if (!botAdminCheck.isAdmin) {
      console.warn(`[WARN] Bot has no permission to receive join events in chat ${chatId}`);
      return { hasPermission: false, isAdmin: false, error: botAdminCheck.error };
    }
    return { hasPermission: true, isAdmin: true, error: null };
  } catch (error: any) {
    console.warn(`[WARN] Bot has no permission to receive join events in chat ${chatId}: ${error.message}`);
    return { hasPermission: false, isAdmin: false, error: error.message };
  }
}

/**
 * Zentrale Funktion zur Verarbeitung von Join-Events
 * Erfasst IMMER Join-Events, bewertet Risiko nur wenn managed
 * 
 * Implementiert:
 * - Einheitliches Event-Modell (ShieldEvent)
 * - Deduplication (60s Zeitfenster)
 * - Admin- & Team-Ausnahme (hart)
 * - Managed-Group-Logik (live API-Check)
 * - Saubere DB-Reihenfolge (ensureUser → ensureGroup → insertJoin)
 */
async function handleJoinEvent(
  ctx: Context,
  userId: number,
  chatId: string,
  userInfo: { username?: string; firstName?: string; lastName?: string; isBot?: boolean },
  source: ShieldEventSource
): Promise<void> {
  // Debug-Modus: Raw-Update loggen
  if (config.debugJoins) {
    console.log('[DEBUG RAW UPDATE]', JSON.stringify(ctx.update, null, 2));
  }

  // 1. ADMIN- & TEAM-AUSNAHME (hart, vor allem anderen)
  const userIsAdmin = isAdmin(userId);
  const userIsTeamMember = isTeamMember(userId);
  
  if (userIsAdmin || userIsTeamMember) {
    console.log(`[JOIN][IGNORED] reason=admin user=${userId} chat=${chatId} source=${source}`);
    const event = createJoinEvent(userId, chatId, source, userInfo, userIsAdmin, userIsTeamMember);
    logEvent(event, false, userIsAdmin ? 'admin user' : 'team member');
    // Speichere für /debug last
    lastJoinEvent = { userId, chatId, source, timestamp: Date.now(), decision: 'ignored', reason: userIsAdmin ? 'admin' : 'team' };
    return; // Early return - keine weitere Verarbeitung
  }

  // 2. BOT-REPRÜFUNG (nur Warnung, keine Blockierung)
  await checkBotPermissions(chatId, ctx);

  // 3. DEDUPLIZIERUNG: Fingerprint-basierte Prüfe (VOR DB-Zugriff & Risk-Analyse)
  // (Verhindert doppelte Events von chat_member + new_chat_members)
  const timestamp = Date.now();
  if (isDuplicateJoin(userId, chatId, timestamp)) {
    console.log(`[JOIN][IGNORED] reason=dedup user=${userId} chat=${chatId} source=${source}`);
    // Speichere für /debug last
    lastJoinEvent = { userId, chatId, source, timestamp, decision: 'ignored', reason: 'dedup' };
    return; // Early return - kein DB-Insert, keine Risk-Bewertung
  }

  // 4. SAUBERE DB-REIHENFOLGE: ensureUser → ensureGroup → insertJoin (in Transaktion)
  // (Verhindert FOREIGN KEY constraint failed)
  const title = (ctx.chat && 'title' in ctx.chat ? ctx.chat.title : null) || 'Unbekannt';
  
  // Registriere Gruppe (aktualisiert Title falls nötig)
    const existingGroup = getGroup(chatId);
    if (!existingGroup) {
    registerGroup(chatId, title, 'known'); // Default: known, wird durch live-Check überschrieben
    // K12: Automatische Ort-Extraktion und Brand-Erkennung beim ersten Sehen
    updateGroupProfileFromTitle(chatId, title);
    // K12: Automatische Initialisierung von group_config (Partner-Erkennung)
    const { ensureGroupConfig } = await import('./db');
    ensureGroupConfig(chatId, title);
    // Brand-Erkennung: Erstelle group_settings beim ersten Sehen
    const { getGroupSettings } = await import('./db');
    getGroupSettings(chatId, title); // Auto-create mit Brand-Erkennung
    } else {
    const { statusCodeToString } = await import('./domain/groupProjection');
    registerGroup(chatId, title, statusCodeToString(existingGroup.status));
    // K12: Update Ort/Brand wenn Titel sich geändert hat
    if (title !== existingGroup.title) {
      updateGroupProfileFromTitle(chatId, title);
    }
  }

  // 5. ERFASSE JOIN-EVENT IMMER (unabhängig von managed/known/disabled)
  // recordJoin führt ensureUser + ensureGroup + insertJoin in Transaktion aus
  recordJoin(userId, chatId, title);

  // 6. MANAGED-GROUP-LOGIK: Live API-Check (nicht aus DB)
  const isManaged = await isGroupManagedLive(chatId, ctx);

  // 7. LOGGE EVENT
  const event = createJoinEvent(userId, chatId, source, userInfo, false, false);
  logEvent(event, isManaged);

  // Nur für managed Gruppen: Risikobewertung & Maßnahmen
  if (!isManaged) {
    console.log(`[JOIN][LOGGED] user=${userId} chat=${chatId} source=${source} (not managed)`);
    // Speichere für /debug last
    lastJoinEvent = { userId, chatId, source, timestamp, decision: 'logged', reason: 'not_managed' };
    return; // Früh-Return für nicht-managed Gruppen
  }

  // Prüfe Silent-Mode
  const group = getGroup(chatId);
  const isSilent = group?.silentMode === 1;
  
  // Managed Gruppe - Log (nur wenn nicht silent)
  if (!isSilent) {
    console.log(`[JOIN][LOGGED] user=${userId} chat=${chatId} source=${source} (managed)`);
  }

      // Ignoriere Bot-Joins
  if (userInfo.isBot && ctx.botInfo?.id === userId) {
    return;
  }

  // TEAM-MITGLIED-Protection: Team-Mitglieder sind von allen Maßnahmen ausgeschlossen
  if (isTeamMember(userId)) {
    return; // Skip rest of processing - Team-Mitglieder werden nicht gebannt/restricted
  }

      // AUTO-REJOIN-BLOCK: Prüfe VOR jeglicher anderer Join-Logik
  if (isBlacklisted(userId)) {
        const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
        if (!adminCheck.isAdmin) {
          try {
            const { banUser } = await import('./telegram');
            const banResult = await banUser(chatId, userId, 'auto-rejoin block');
            if (banResult.success) {
          console.log(`[Shield][AUTO-REJOIN] User ${userId} in ${title} (${chatId}) automatisch gebannt`);
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Shield][AUTO-REJOIN] Fehler beim Bannen von ${userId}:`, errorMessage);
          }
      return; // Skip rest of processing
        }
      }

      // USERNAME-BLACKLIST: Prüfe ob Username in Blacklist ist
  if (userInfo.username && isUsernameBlacklisted(userInfo.username)) {
          const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
          if (!adminCheck.isAdmin) {
            try {
              const { banUserGlobally } = await import('./telegram');
        const banResult = await banUserGlobally(userId, `AUTO-BAN (username blacklist): @${userInfo.username}`);
              if (banResult.success) {
          console.log(`[JOIN][ACTION] action=ban user=${userId} chat=${chatId} reason=username-blacklist`);
          lastJoinEvent = { userId, chatId, source, timestamp, decision: 'action', action: 'ban', reason: 'username-blacklist' };
                await sendToAdminLogChat(
                  `🚫 <b>AUTO-BAN (Username Blacklist)</b>\n\n` +
                  `👤 User: <code>${userId}</code>\n` +
            `📛 Username: <code>@${userInfo.username}</code>\n` +
            `📍 Gruppe: <b>${title}</b>\n` +
                  `🆔 Chat ID: <code>${chatId}</code>\n\n` +
                  `User wurde global in ${banResult.groups} Gruppen gebannt.`,
            ctx,
            true
                );
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Shield][AUTO-BAN] Fehler beim Bannen von ${userId} (@${userInfo.username}):`, errorMessage);
      }
      return; // Skip rest of processing
    }
  }

  // Erfasse User in Baseline (nur managed)
        saveBaselineMember(
          chatId,
          userId,
    userInfo.username || null,
    userInfo.firstName || null,
    userInfo.lastName || null,
    userInfo.isBot || false,
          'auto',
          'join'
        );

  // Service-Message-Cleanup (Prompt 6): Lösche Join-Message NACHDEM Event verarbeitet wurde
  try {
    const { cleanupServiceMessages } = await import('./service');
    await cleanupServiceMessages(ctx);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[SERVICE] Fehler bei Service-Message-Cleanup:`, errorMessage);
  }

  // Begrüßung (Prompt E): Neue Welcome Profile Integration
  // Wird nur gesendet wenn: welcome_enabled=true, User nicht flagged, keine Dedup
  // Scam/Risk Check hat bereits stattgefunden
  if (!userInfo.isBot && isManaged) {
    try {
      const groupTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : undefined;
      const welcomeResult = await sendWelcomeIfEnabled(
        chatId,
        userId,
        {
          username: userInfo.username,
          firstName: userInfo.firstName,
          lastName: userInfo.lastName,
        },
        ctx
      );
      
      if (welcomeResult.sent) {
        console.log(`[WELCOME][SENT] user=${userId} chat=${chatId}`);
      }
      
      // DEAKTIVIERT: Group Risk Notifications (READ ONLY - nur Berechnung, keine Notifications)
      
      if (welcomeResult.sent) {
        console.log(`[WELCOME][SENT] user=${userId} chat=${chatId}`);
      } else {
        console.log(`[WELCOME][SKIP] reason=${welcomeResult.reason || 'unknown'} user=${userId} chat=${chatId}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[WELCOME] Fehler bei Begrüßung:`, errorMessage);
      // Fehler stoppt nicht die weitere Verarbeitung
    }
  }

  // Cluster-Erkennung (Prompt 5): Prüfe bei jedem Join
  try {
    const { checkClusterLevel } = await import('./cluster2');
    const clusterResult = await checkClusterLevel(userId, chatId, ctx);
    if (clusterResult.level) {
      // Cluster erkannt - Log bereits in checkClusterLevel
      console.log(`[CLUSTER] Level ${clusterResult.level} erkannt für User ${userId}, ${clusterResult.groupCount} Gruppen`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[CLUSTER] Fehler bei Cluster-Prüfung für User ${userId}:`, errorMessage);
  }

  // Risikobewertung
  await evaluateRiskIfManaged(ctx, userId, chatId, title, userInfo);
}

/**
 * Bewertet Risiko und führt Maßnahmen durch (nur für managed Gruppen)
 */
async function evaluateRiskIfManaged(
  ctx: Context,
  userId: number,
  chatId: string,
  title: string,
  userInfo: { username?: string; firstName?: string; lastName?: string }
): Promise<void> {
  // Risikobewertung
  const assessment = await assessJoinRisk(ctx, userId, chatId, userInfo);

      if (assessment && 'isSuspicious' in assessment && assessment.isSuspicious) {
        const joinCount = 'joinCount' in assessment ? (assessment.joinCount as number) : 0;
        const distinctChats = 'distinctChats' in assessment ? (assessment.distinctChats as number) : 0;
        console.log(
          `[Risk] Verdächtiger User ${userId}: ${joinCount} Joins in ${config.joinWindowHours}h, ` +
          `${distinctChats} verschiedene Gruppen`
        );
      }
      
        // TEAM-MITGLIED-Protection: Prüfe ob User Admin/Creator in der Gruppe ist
        const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
        
        if (adminCheck.isAdmin) {
          // User ist Team-Mitglied - kein Join-Log mit Risiko, nur neutrales Info-Log
    const displayName = userInfo.firstName
      ? `${userInfo.firstName}${userInfo.lastName ? ` ${userInfo.lastName}` : ''}`
      : userInfo.username
      ? `@${userInfo.username}`
            : 'Unbekannt';
          
          await sendToAdminLogChat(
            `ℹ️ <b>Team-Mitglied beigetreten</b>\n\n` +
            `👤 Name: <b>${displayName}</b>\n` +
            `🆔 User ID: <code>${userId}</code>\n` +
      `📍 Gruppe: <b>${title}</b>\n` +
            `👑 Status: <b>${adminCheck.status === 'creator' ? 'Creator' : 'Administrator'}</b>\n\n` +
            `User ist von allen Shield-Maßnahmen ausgeschlossen.`,
            ctx,
            true
          );
          
          console.log(`[Join-Log] Team-Mitglied ${userId} (${adminCheck.status}) in managed Gruppe ${chatId} - neutrales Info-Log gesendet`);
    return;
  }

  // Normale User - hole distinctChatsCount für Risiko-Einstufung
          const distinctChatsInWindow = getDistinctChatsInWindow(userId, config.joinWindowHours);
          let distinctChatsCount = 0;
          for (const chatIdInWindow of distinctChatsInWindow) {
            const groupWindow = getGroup(chatIdInWindow);
            if (groupWindow?.status === 1) { // 1 = managed
              distinctChatsCount++;
            }
          }
          
          // Prüfe ob User bereits beobachtet wird
          const userObserved = isUserObserved(userId);
          
          // ANTI-IMPERSONATION: Prüfe ob User Name/Username gegen geschützte Namen ähnlich ist
          const impersonationCheck = checkImpersonation(
    userInfo.firstName,
    userInfo.lastName,
    userInfo.username,
            config.protectedNames,
            config.impersonationSimilarityThreshold
          );
          
          if (impersonationCheck.isImpersonation && impersonationCheck.matchedName) {
    const hasRecentWarning = hasRecentImpersonationWarning(userId, 24);
            if (!hasRecentWarning) {
              recordImpersonationWarning(userId, chatId);
              await sendImpersonationWarning(
                ctx,
                userId,
                chatId,
        title,
                impersonationCheck.matchedName,
                impersonationCheck.similarity,
        userInfo
      );
              console.log(`[Impersonation] User ${userId} mögliche Identitäts-Täuschung: Ähnlich zu "${impersonationCheck.matchedName}" (${impersonationCheck.similarity.toFixed(1)}% Ähnlichkeit)`);
            } else {
              console.log(`[Impersonation] User ${userId} hat kürzlich Impersonation-Warnung - überspringe (Anti-Spam)`);
            }
          }
          
          // ESKALATIONSLOGIK: Prüfe ob beobachteter User eine Eskalation auslöst
          if (userObserved) {
    const hasRecentEscal = hasRecentEscalation(userId, 24);
            if (!hasRecentEscal) {
              const joinCount24h = getJoinCount24h(userId);
              if (distinctChatsCount > 1) {
                recordEscalation(userId, 'join', chatId);
        await sendEscalationLog(ctx, userId, chatId, title, 'join', joinCount24h, userInfo);
        console.log(`[Escalation] Beobachteter User ${userId} eskaliert: Neue Gruppe ${chatId} (${joinCount24h} Joins in 24h)`);
      } else if (distinctChatsCount >= 2) {
        recordEscalation(userId, 'multi_join', chatId);
        await sendEscalationLog(ctx, userId, chatId, title, 'multi_join', joinCount24h, userInfo);
        console.log(`[Escalation] Beobachteter User ${userId} eskaliert: Mehrfach-Join-Schwellenwert überschritten (${distinctChatsCount} Gruppen, ${joinCount24h} Joins in 24h)`);
      }
    } else {
      console.log(`[Escalation] Beobachteter User ${userId} hat kürzlich Eskalation - überspringe (Anti-Spam)`);
    }
  }

  // Sende strukturierte Join-Log-Nachricht mit Inline-Buttons
  await sendJoinLogWithActions(
                  ctx,
                  userId,
                  chatId,
    title,
    distinctChatsCount || 1,
    userInfo
  );

  console.log(`[Join-Log] Strukturierte Log-Nachricht für User ${userId} in managed Gruppe ${chatId} gesendet (${distinctChatsCount} managed groups)`);
}

// Event: Bot wurde zu einer Gruppe hinzugefügt oder Status geändert (AUTO-MANAGED LOGIK)
// Auto-Profile-Update bei Titel-Änderungen
bot.on('my_chat_member', async (ctx: Context) => {
  try {
    if (!ctx.myChatMember) return;

    const chat = ctx.myChatMember.chat;
    const newStatus = String(ctx.myChatMember.new_chat_member.status || '');
    const oldStatus = String(ctx.myChatMember.old_chat_member.status || '');

    // Nur Gruppen/Supergroups verarbeiten
    if (chat.type !== 'group' && chat.type !== 'supergroup') {
      return;
    }

        const chatId = chat.id.toString();
    const title = 'title' in chat ? chat.title : 'Unbekannt';

    // Registriere Gruppe nur wenn neu - Status wird nicht geändert
    const currentGroup = getGroup(chatId);
    if (!currentGroup) {
      registerGroup(chatId, title || null, 'managed');
      const logMessage = `[Shield] Group onboarded: ${title || 'Unbekannt'} (${chatId}) status=managed`;
      console.log(logMessage);
      await sendToAdminLogChat(logMessage, ctx);
            } else {
      // Bestehende Gruppe - nur Title aktualisieren
      const { statusCodeToString } = await import('./domain/groupProjection');
      registerGroup(chatId, title || null, statusCodeToString(currentGroup.status));
    }
  } catch (error: any) {
    console.error('[Error] Fehler beim Verarbeiten von my_chat_member:', error.message);
    await sendToAdminLogChat(`[Shield][ERROR] my_chat_member error: ${error.message}`, ctx);
  }
});

// Event: Neuer User ist einer Gruppe beigetreten (new_chat_members)
// Auto-Profile-Update bei neuen Mitgliedern (Titel könnte sich geändert haben)
bot.on('new_chat_members', async (ctx: Context) => {
  try {
    if (!ctx.message || !('new_chat_members' in ctx.message)) return;
    
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;

    const newMembers = ctx.message.new_chat_members;

    for (const member of newMembers) {
      const chatId = chat.id.toString();
      
      await handleJoinEvent(
        ctx,
        member.id,
            chatId,
            {
              username: member.username,
              firstName: member.first_name,
              lastName: member.last_name,
          isBot: member.is_bot || false,
        },
        ShieldEventSource.NEW_CHAT_MEMBERS
          );
    }
  } catch (error: any) {
    console.error('[Error] Fehler beim Verarbeiten von new_chat_members:', error.message);
    await sendToAdminLogChat(`[Shield][ERROR] new_chat_members error: ${error.message}`, ctx);
  }
});

// Event: Chat Member Update (chat_member) - für genauere Join-Erkennung
bot.on('chat_member', async (ctx: Context) => {
  try {
    if (!ctx.chatMember) return;

    const chat = ctx.chatMember.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;

    const chatId = chat.id.toString();
    const member = ctx.chatMember.new_chat_member;
    const oldMember = ctx.chatMember.old_chat_member;
    const user = ctx.chatMember.from;

    // Prüfe ob User gerade gejoint ist (von "left" oder "kicked" zu "member" oder "restricted")
    const oldStatus = String(oldMember.status || '');
    const newStatus = String(member.status || '');
    const wasLeft = oldStatus === 'left' || oldStatus === 'kicked';
    const isNowMember = newStatus === 'member' || newStatus === 'restricted';

    if (wasLeft && isNowMember && !user.is_bot) {
      await         handleJoinEvent(
          ctx,
          user.id,
          chatId,
          {
            username: user.username,
            firstName: user.first_name,
            lastName: user.last_name,
            isBot: user.is_bot || false,
          },
          ShieldEventSource.CHAT_MEMBER
        );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ERROR][JOIN_HANDLER] chat_member:', errorMessage);
    try {
      await sendToAdminLogChat(`[Shield][ERROR] chat_member error: ${errorMessage}`, ctx);
    } catch (logError) {
      // Ignoriere Log-Fehler - nicht kritisch
    }
    // Kein weiterwerfen - Event-Handler darf Bot nicht stoppen
  }
});

// Command-Handler: Unterstützt Commands aus Gruppen UND ADMIN_LOG_CHAT
async function handleAdminCommand(
  ctx: Context,
  commandName: string,
  handler: (ctx: Context, ...args: any[]) => Promise<void>,
  getArgs?: (ctx: Context) => string[]
): Promise<void> {
  try {
    // Prüfe Admin-Rechte
    if (!ctx.from || !isAdmin(ctx.from.id)) {
      // In Gruppen: antworten, im Log-Chat: ignorieren
      const chat = ctx.chat;
      if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
      await ctx.reply('❌ Du bist kein Administrator.');
      }
      return;
    }

    // Args extrahieren
    const args = getArgs ? getArgs(ctx) : [];
    await handler(ctx, ...args);
  } catch (error: any) {
    console.error(`[Error] Fehler beim ${commandName}-Command:`, error.message);
    await ctx.reply(`❌ Fehler beim Ausführen des ${commandName}-Commands.`);
  }
}

// Command: /scan [baseline|resume|status|managed]
bot.command('scan', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'scan', async (ctx, scanType?: string) => {
    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    const typeArg = args.length > 0 ? args[0] : undefined;
    
    if (typeArg === 'status') {
      const { handleScanStatusCommand } = await import('./admin');
      await handleScanStatusCommand(ctx, []);
    } else {
      await handleScanCommand(ctx, typeArg);
    }
  }, (ctx) => {
    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    return args;
  });
});

// Command: /team add|remove|list|import <user_id|@username>
bot.command('team', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'team', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    
    if (parts.length < 1) {
      await ctx.reply(
        '❌ Ungültige Verwendung.\n\n' +
        'Verwendung:\n' +
        '• <code>/team add &lt;user_id|@username&gt; [note]</code> - User zum Team hinzufügen\n' +
        '• <code>/team remove &lt;user_id|@username&gt;</code> - User aus Team entfernen\n' +
        '• <code>/team list</code> - Team-Mitglieder auflisten\n' +
        '• <code>/team import</code> - Import aus Textliste (als Reply)',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const subcommand = parts[0];
    
    if (subcommand === 'add' && parts.length >= 2) {
      const note = parts.slice(2).join(' ') || undefined;
      await handleTeamAddCommand(ctx, parts[1], note);
    } else if (subcommand === 'remove' && parts.length >= 2) {
      await handleTeamRemoveCommand(ctx, parts[1]);
    } else if (subcommand === 'list') {
      await handleTeamListCommand(ctx, []);
    } else if (subcommand === 'import') {
      const { handleTeamImportCommand } = await import('./admin');
      await handleTeamImportCommand(ctx, []);
    } else {
      await ctx.reply('❌ Ungültige Verwendung. Verwende /team add, /team remove, /team list oder /team import');
    }
  });
});

// Command: /shield status
bot.command('shield', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'shield', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    
    if (parts.length === 0 || parts[0].toLowerCase() === 'status') {
      await handleShieldStatusCommand(ctx, []);
    } else {
      await ctx.reply('❌ Ungültige Verwendung. Verfügbar: /shield status');
    }
  });
});

// Command: /dryrun
bot.command('dryrun', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'dryrun', async (ctx, ...args) => {
    await handleDryRunToggleCommand(ctx, args);
  });
});

// Command: /health
bot.command('health', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'health', async (ctx) => {
    const managedGroups = getManagedGroups();
    const allGroups = getAllGroups();
    const knownGroups = allGroups.filter(g => g.status === 0); // 0 = known
    
    const lastEventTime = lastJoinEvent ? new Date(lastJoinEvent.timestamp).toISOString() : 'Kein Event';
    const dedupStats = joinDedupManager.getStats();
    
    // Hole Queue-Backlog (wenn verfügbar)
    // Note: Queue-Backlog-Tracking kann später implementiert werden
    const queueBacklog = 0;
    
    await ctx.reply(
      `🛡️ <b>Shield Health Status</b>\n\n` +
      `✅ Bot online\n` +
      `📊 Managed groups: ${managedGroups.length}\n` +
      `📋 Known groups: ${knownGroups.length}\n` +
      `🕐 Last event: ${lastEventTime}\n` +
      `🔄 Queue backlog: ${queueBacklog}\n` +
      `🔍 Active dedup fingerprints: ${dedupStats.activeFingerprints}`,
      { parse_mode: 'HTML' }
    );
  });
});

// Command: /debug last
bot.command('debug', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'debug', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    
    if (parts.length > 0 && parts[0] === 'last') {
      if (!lastJoinEvent) {
        await ctx.reply('❌ Kein Join-Event verfügbar.');
      return;
    }
      
      const event = lastJoinEvent;
      const timeAgo = Math.floor((Date.now() - event.timestamp) / 1000);
      const timeAgoStr = timeAgo < 60 ? `${timeAgo}s` : `${Math.floor(timeAgo / 60)}m`;
      
      await ctx.reply(
        `🔍 <b>Letztes Join-Event</b>\n\n` +
        `👤 User ID: <code>${event.userId}</code>\n` +
        `📍 Chat ID: <code>${event.chatId}</code>\n` +
        `📡 Quelle: <code>${event.source}</code>\n` +
        `🕐 Zeit: ${new Date(event.timestamp).toISOString()} (vor ${timeAgoStr})\n` +
        `✅ Entscheidung: <b>${event.decision}</b>\n` +
        `${event.reason ? `📝 Grund: ${event.reason}\n` : ''}` +
        `${event.action ? `⚡ Aktion: ${event.action}\n` : ''}` +
        `🔍 Dedup-Status: ${isDuplicateJoin(event.userId, event.chatId, event.timestamp) ? 'Duplikat' : 'Neu'}`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply('❌ Verwendung: /debug last');
    }
  }, (ctx) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    return text.split(' ').slice(1);
  });
});

// Command: /panic [on|off]
bot.command('panic', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'panic', async (ctx, ...args) => {
    const { handlePanicCommand } = await import('./admin');
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    const action = parts[0]?.toLowerCase();
    await handlePanicCommand(ctx, action);
  });
});


// Command: /unban <user_id|@username>
bot.command('unban', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'unban', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    
    if (parts.length < 1) {
      await ctx.reply('❌ Ungültige Verwendung. Format: /unban <user_id|@username>');
      return;
    }
    
    await handleUnbanCommand(ctx, parts[0]);
  });
});

// Command: /group status - Zeigt Gruppen-Konfiguration
// K12: /groupconfig - Zeigt Gruppenkonfiguration
bot.command('groupconfig', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'groupconfig', async (ctx) => {
    const { handleGroupConfigCommand } = await import('./admin');
    await handleGroupConfigCommand(ctx, []);
  });
});

bot.command('group', async (ctx: Context) => {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.split(' ').slice(1);
  
  if (parts.length === 0) {
    await ctx.reply('❌ Ungültige Verwendung. Verfügbar: /group status, /group enable <feature>, /group disable <feature>, /group managed <on|off>');
      return;
    }
  
  const subcommand = parts[0].toLowerCase();
  
  if (subcommand === 'status') {
    await handleGroupStatusCommand(ctx, []);
  } else if (subcommand === 'enable') {
    await handleGroupEnableCommand(ctx, parts[1] || undefined);
  } else if (subcommand === 'disable') {
    await handleGroupDisableCommand(ctx, parts[1] || undefined);
  } else if (subcommand === 'managed') {
    await handleGroupManagedCommand(ctx, parts[1] || undefined);
  } else {
    await ctx.reply('❌ Ungültiger Unterbefehl. Verfügbar: status, enable, disable, managed');
  }
});

// Command: /welcome - Welcome-Konfiguration
bot.command('welcome', async (ctx: Context) => {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.split(' ').slice(1);
  
  if (parts.length === 0) {
    await ctx.reply('❌ Ungültige Verwendung. Verfügbar: /welcome show, /welcome ref <CODE|clear>, /welcome partner <on|off>, /welcome template <set|clear|TEXT>');
    return;
  }
  
  const subcommand = parts[0].toLowerCase();
  
  if (subcommand === 'on') {
    await handleWelcomeOnCommand(ctx, parts[1]); // chat_id optional
  } else if (subcommand === 'off') {
    await handleWelcomeOffCommand(ctx, parts[1]); // chat_id optional
  } else if (subcommand === 'preview') {
    await handleWelcomePreviewCommand(ctx, parts[1]); // chat_id optional
  } else if (subcommand === 'setref') {
    await handleWelcomeSetRefCommand(ctx, parts[1], parts[2]); // refCode, chat_id optional
    } else if (subcommand === 'clearref') {
      await handleWelcomeClearRefCommand(ctx, []);
  } else if (subcommand === 'partner') {
    await handleWelcomePartnerCommand(ctx, parts[1]);
  } else if (subcommand === 'template') {
    const templateAction = parts[1]?.toLowerCase();
    if (templateAction === 'set') {
      await handleWelcomeTemplateSetCommand(ctx, []);
    } else if (templateAction === 'clear') {
      await handleWelcomeTemplateClearCommand(ctx, []);
    } else {
      await handleWelcomeTemplateShowCommand(ctx, []);
    }
  } else if (subcommand === 'test') {
    await handleWelcomeTestCommand(ctx, []);
  } else if (subcommand === 'show') {
    // Legacy: Alte Commands für Kompatibilität
    await handleWelcomeShowCommand(ctx, []);
  } else if (subcommand === 'ref') {
    // Legacy: Alte Commands für Kompatibilität
    await handleWelcomeRefCommand(ctx, parts[1]);
  } else {
    await ctx.reply('❌ Ungültiger Unterbefehl. Verfügbar: on, off, preview, setref, clearref, partner, template, test');
  }
});

// K12: /setref <code> - Setzt Affiliate-Ref-Code (nur für geldhelden)
bot.command('setref', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'setref', async (ctx) => {
    const { handleSetRefCommand } = await import('./admin');
    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    await handleSetRefCommand(ctx, args);
  });
});

// K12: /setpartner <geldhelden|staatenlos|coop> - Setzt Partner-Typ
bot.command('setpartner', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'setpartner', async (ctx) => {
    const { handleSetPartnerCommand } = await import('./admin');
    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    await handleSetPartnerCommand(ctx, args);
  });
});

// K12: /setlocation <Ort> - Setzt Ort (überschreibt automatische Erkennung)
bot.command('setlocation', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'setlocation', async (ctx) => {
    const { handleSetLocationCommand } = await import('./admin');
    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    await handleSetLocationCommand(ctx, args);
  });
});

// Legacy: /setbrand (wird zu /setpartner weitergeleitet)
bot.command('setbrand', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'setbrand', async (ctx) => {
    const { handleSetPartnerCommand } = await import('./admin');
    const args = ctx.message && 'text' in ctx.message 
      ? ctx.message.text.split(' ').slice(1) 
      : [];
    await handleSetPartnerCommand(ctx, args);
  });
});

// Command: /setintro <text...> [chat_id] - Setzt Custom Intro
bot.command('setintro', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'setintro', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    if (parts.length === 0) {
      await ctx.reply('❌ Bitte gib einen Intro-Text an: /setintro <text...> [chat_id]');
      return;
    }
    const introText = parts.slice(0, -1).join(' '); // Alles außer letztem Teil (könnte chat_id sein)
    const chatIdStr = parts.length > 1 ? parts[parts.length - 1] : undefined;
    await handleWelcomeSetIntroCommand(ctx, introText, chatIdStr);
  });
});

// Command: /scam - Scam-Detection Konfiguration
bot.command('scam', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'scam', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    
    if (parts.length === 0) {
      await ctx.reply('❌ Ungültige Verwendung. Verfügbar: /scam on|off, /scam action <delete|warn|restrict|kick|ban>, /scam threshold <0-100>, /scam test <text>');
      return;
    }
    
    const subcommand = parts[0].toLowerCase();
    
    if (subcommand === 'on' || subcommand === 'off') {
      await handleScamToggleCommand(ctx, subcommand);
    } else if (subcommand === 'action') {
      await handleScamActionCommand(ctx, parts[1]);
    } else if (subcommand === 'threshold') {
      await handleScamThresholdCommand(ctx, parts[1]);
    } else if (subcommand === 'test') {
      const testText = parts.slice(1).join(' '); // Alles nach "test" als Text
      await handleScamTestCommand(ctx, testText);
    } else {
      await ctx.reply('❌ Ungültiger Unterbefehl. Verfügbar: on, off, action, threshold, test');
    }
  });
});

// Command: /scamtest <text...> - Testet Scam-Erkennung
bot.command('scamtest', async (ctx: Context) => {
  await handleAdminCommand(ctx, 'scamtest', async (ctx, ...args) => {
    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    const parts = text.split(' ').slice(1);
    const testText = parts.join(' '); // Alles nach "scamtest" als Text
    await handleScamTestCommand(ctx, testText);
  });
});

// Command: /url - URL-Policy Konfiguration
bot.command('url', async (ctx: Context) => {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const parts = text.split(' ').slice(1);
  
  if (parts.length === 0) {
    await ctx.reply('❌ Ungültige Verwendung. Verfügbar: /url mode <allow|allowlist|block_all>, /url allowlist add|remove|show <domain>');
    return;
  }
  
  const subcommand = parts[0].toLowerCase();
  
  if (subcommand === 'mode') {
    await handleUrlModeCommand(ctx, parts[1]);
  } else if (subcommand === 'allowlist') {
    const action = parts[1]?.toLowerCase();
    if (action === 'add') {
      await handleUrlAllowlistAddCommand(ctx, parts[2]);
    } else if (action === 'remove') {
      await handleUrlAllowlistRemoveCommand(ctx, parts[2]);
    } else if (action === 'show') {
      await handleUrlAllowlistShowCommand(ctx, []);
    } else {
      await ctx.reply('❌ Ungültiger Unterbefehl. Verfügbar: add, remove, show');
    }
  } else {
    await ctx.reply('❌ Ungültiger Unterbefehl. Verfügbar: mode, allowlist');
  }
});

// Event: Nachrichten (für Baseline-Erfassung + Moderation)
bot.on('message', async (ctx: Context) => {
  try {
    // Service-Message-Cleanup (Prompt F) - ZUERST, aber nach interner Verarbeitung
    const { cleanupServiceMessages } = await import('./serviceCleanup');
    await cleanupServiceMessages(ctx);
    
    // 1. Scam-Erkennung (neue robuste Version) - VOR anderer Moderation
    const { moderateScamMessage } = await import('./scamModeration');
    const scamHandled = await moderateScamMessage(ctx);
    
    // DEAKTIVIERT: Group Risk Notifications (READ ONLY - nur Berechnung, keine Notifications)
    
    // Wenn Scam erkannt und gelöscht, überspringe weitere Moderation
    if (scamHandled) {
      return; // Early return - Scam wurde bereits behandelt
    }
    
    // 2. Link-Policy (Prompt F) - Für neue User
    const { moderateLinkPolicy } = await import('./linkPolicy');
    const linkHandled = await moderateLinkPolicy(ctx);
    if (linkHandled && ctx.message && 'from' in ctx.message) {
      // Eskaliere Risk-Level bei Link-Post
      const userId = ctx.message.from?.id;
      if (userId) {
        const { escalateRiskLevel } = await import('./riskLevel');
        escalateRiskLevel(userId, 'Link gepostet');
      }
      return; // Early return - Link wurde gelöscht
    }
    
    // 3. Anti-Flood (Prompt F) - Leicht, nur Restrict
    const { moderateAntiFlood } = await import('./antiflood');
    await moderateAntiFlood(ctx);
    
    // 4. Legacy Moderation (falls vorhanden)
    try {
      const { moderateMessage } = await import('./moderation');
      await moderateMessage(ctx);
    } catch {
      // Ignoriere wenn moderation.ts nicht existiert
    }

    // 2. Erfasse User aus Nachrichten für Baseline (source: 'message')
    if (ctx.message && 'from' in ctx.message && ctx.message.from) {
      const from = ctx.message.from;
      if (from.is_bot) return; // Bots ignorieren
      
      const chat = ctx.chat;
      if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
      
      const chatId = chat.id.toString();
      const groupCheck = getGroup(chatId);
      
      if (groupCheck?.status === 1) { // 1 = managed
        // Baseline wächst IMMER: ensureUser bei jedem Event
        ensureUserExists(from.id);
        saveBaselineMember(
          chatId,
          from.id,
          from.username || null,
          from.first_name || null,
          from.last_name || null,
          false,
          'auto',
          'message'
        );
        
        // Cluster-Erkennung (Prompt 5): Prüfe bei jeder Message
        try {
          const { checkClusterLevel } = await import('./cluster2');
          await checkClusterLevel(from.id, chatId, ctx);
        } catch (error: unknown) {
          // Ignoriere Fehler - Cluster-Prüfung soll Bot nicht stoppen
        }
      }
    }
  } catch (error: unknown) {
    // Fehler beim Erfassen ignorieren (nicht kritisch)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ERROR][MESSAGE_HANDLER] message:', errorMessage);
    // Kein weiterwerfen - Event-Handler darf Bot nicht stoppen
  }
});

// Event: Bearbeitete Nachrichten (edited_message) - auch Scam-Check
bot.on('edited_message', async (ctx: Context) => {
  try {
    // Scam-Erkennung auch bei bearbeiteten Nachrichten
    const { moderateScamMessage } = await import('./scamModeration');
    const scamHandled = await moderateScamMessage(ctx);
    
    // Wenn Scam erkannt und gelöscht, überspringe weitere Moderation
    if (scamHandled) {
      return; // Early return - Scam wurde bereits behandelt
    }
  } catch (error: unknown) {
    // Fehler beim Scam-Check ignorieren (nicht kritisch)
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ERROR][EDITED_MESSAGE_HANDLER]', errorMessage);
  }
});

// Fallback: Text-Phrase "shield whereami" für /whereami
bot.on('text', async (ctx: Context) => {
  try {
    if (!ctx.message || !('text' in ctx.message)) return;
    
    const text = ctx.message.text.toLowerCase().trim();
    
    // Prüfe auf "shield whereami" Text-Phrase
    if (text === 'shield whereami' || text === '@geldhelden_shield_bot shield whereami') {
      if (!ctx.from || !isAdmin(ctx.from.id)) {
        return; // Ignoriere wenn nicht Admin
      }
      
      await handleWhereAmICommand(ctx, []);
      return;
    }

    // ESKALATIONSLOGIK: Prüfe auf Aktivität von beobachteten Usern in managed Gruppen
    // Nur Gruppen/Supergroups
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return;
    }

    // Nur wenn User vorhanden und kein Bot
    if (!ctx.from || ctx.from.is_bot) {
      return;
    }

    const chatId = chat.id.toString();
    const userId = ctx.from.id;
    const title = 'title' in chat ? chat.title : 'Unbekannt';
    
    // Status wird nur aus DB gelesen, nicht geändert
    const group = getGroup(chatId);
    if (!group || group.status !== 1) { // 1 = managed
      return;
    }

    // TEAM-MITGLIED-Protection: Prüfe ob User Admin/Creator in der Gruppe ist
    const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
    if (adminCheck.isAdmin) {
      return; // Team-Mitglieder werden nicht eskaliert und nicht auf Impersonation geprüft
    }
    
    // ANTI-IMPERSONATION: Prüfe ob User Name/Username gegen geschützte Namen ähnlich ist
    const impersonationCheck = checkImpersonation(
      ctx.from.first_name,
      ctx.from.last_name,
      ctx.from.username,
      config.protectedNames,
      config.impersonationSimilarityThreshold
    );
    
    if (impersonationCheck.isImpersonation && impersonationCheck.matchedName) {
      // Prüfe ob User kürzlich bereits eine Impersonation-Warnung erhalten hat (Anti-Spam)
      const hasRecentWarning = hasRecentImpersonationWarning(userId, 24); // 24 Stunden Zeitfenster
      
      if (!hasRecentWarning) {
        // Speichere Impersonation-Warnung (Anti-Spam)
        recordImpersonationWarning(userId, chatId);
        
        // Sende Impersonation-Warnungs-Log
        await sendImpersonationWarning(
          ctx,
          userId,
          chatId,
          title || 'Unbekannt',
          impersonationCheck.matchedName,
          impersonationCheck.similarity,
          {
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
          }
        );
        
        console.log(`[Impersonation] User ${userId} mögliche Identitäts-Täuschung: Ähnlich zu "${impersonationCheck.matchedName}" (${impersonationCheck.similarity.toFixed(1)}% Ähnlichkeit)`);
      } else {
        console.log(`[Impersonation] User ${userId} hat kürzlich Impersonation-Warnung - überspringe (Anti-Spam)`);
      }
    }
    
    // Prüfe ob User beobachtet wird
    const userObserved = isUserObserved(userId);
    if (!userObserved) {
      return; // Nur beobachtete User werden eskaliert
    }
    
    // Prüfe ob User kürzlich bereits eskaliert wurde (Anti-Spam)
    const hasRecentEscal = hasRecentEscalation(userId, 24); // 24 Stunden Zeitfenster
    if (hasRecentEscal) {
      return; // Anti-Spam: Überspringe wenn kürzlich eskaliert
    }
    
    // Aktivität erkannt → Eskalation auslösen
    const joinCount24h = getJoinCount24h(userId);
    
    // Speichere Eskalation (Anti-Spam)
    recordEscalation(userId, 'activity', chatId);
    
    // Sende Eskalations-Log
    await sendEscalationLog(
      ctx,
      userId,
      chatId,
      title || 'Unbekannt',
      'activity',
      joinCount24h,
      {
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      }
    );
    
    console.log(`[Escalation] Beobachteter User ${userId} eskaliert: Aktivität in Gruppe ${chatId} (${joinCount24h} Joins in 24h)`);
  } catch (error: any) {
    // Leise ignorieren - Eskalationslogik soll Bot nicht stoppen
    console.log(`[Escalation] Fehler bei Aktivitäts-Erkennung:`, error.message);
  }
});

// Callback-Query Handler für Inline-Buttons
bot.on('callback_query', async (ctx: Context) => {
  try {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
    
    const data = ctx.callbackQuery.data;
    const queryId = ctx.callbackQuery.id;
    
    // Parse Callback-Data: Format "action:userId:chatId"
    const parts = data.split(':');
    if (parts.length < 3) {
      await ctx.answerCbQuery('❌ Ungültige Callback-Daten');
      return;
    }
    
    const action = parts[0];
    const userId = parseInt(parts[1], 10);
    const chatId = parts[2];
    
    if (isNaN(userId) || !chatId) {
      await ctx.answerCbQuery('❌ Ungültige User-ID oder Chat-ID');
      return;
    }
    
    // Prüfe Admin-Rechte
    if (!ctx.from || !isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('❌ Du bist kein Administrator');
      return;
    }
    
    // Verarbeite Aktion
    if (action === 'ban_user') {
      // BAN USER - Globale Bannung in allen managed groups
      await ctx.answerCbQuery('⏳ Banne User...', { show_alert: false });
      
      try {
        // Prüfe ob User bereits gebannt ist
        if (isBlacklisted(userId)) {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
          await sendToAdminLogChat(
            `⚠️ User ${userId} ist bereits in der Blacklist.\n` +
            `Aktion abgebrochen durch ${ctx.from.username || ctx.from.first_name || 'Admin'} (${ctx.from.id})`,
            ctx,
            true
          );
          return;
        }
        
      // Globaler Ban
      const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
      const reason = `Manuell durch Admin ${ctx.from.id} (${adminName}): Ban-Button in Join-Log`;
      const { banUserGlobally } = await import('./telegram');
      const banResult = await banUserGlobally(userId, reason);
      
      if (banResult.skipped) {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        await sendToAdminLogChat(
          `⚠️ Bann blockiert: ${banResult.skipReason === 'Admin-User' ? 'Admin-User' : 'Team-Mitglied'}`,
          ctx,
          true
        );
        await ctx.answerCbQuery(`❌ ${banResult.skipReason}`, { show_alert: false });
        return;
      }
      
      // Füge zur Blacklist hinzu (falls noch nicht vorhanden)
      addToBlacklist(userId, ctx.from.id, reason);
      
      const result = {
        success: banResult.groups,
        failed: 0,
        skipped: 0
      };
        
        // Hole Gruppe-Info für Logging
        const group = getGroup(chatId);
        const groupTitle = group?.title || 'Unbekannt';
        
        // Sende Bestätigungs-Log
        await sendToAdminLogChat(
          `🚫 <b>User gebannt</b>\n\n` +
          `👤 Name: User-ID ${userId}\n` +
          `🆔 User ID: <code>${userId}</code>\n` +
          `👥 Betroffene Gruppen: <b>${result.success}</b> (managed)\n` +
          `📍 Ursprungsgruppe: <b>${groupTitle}</b> (<code>${chatId}</code>)\n` +
          `👮 Admin: ${adminName} (${ctx.from.id})\n` +
          `⚠️ Fehler: ${result.failed}, Übersprungen: ${result.skipped}\n\n` +
          `User wurde zur Blacklist hinzugefügt und ist in allen managed groups gebannt.`,
          ctx,
          true
        );
        
        // Entferne Inline-Buttons aus der ursprünglichen Nachricht
        try {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (editError: any) {
          // Ignoriere Fehler beim Entfernen der Buttons
          console.log('[Callback] Konnte Buttons nicht entfernen:', editError.message);
        }
        
        await ctx.answerCbQuery('✅ User gebannt', { show_alert: false });
  } catch (error: any) {
        console.error('[Callback] Fehler beim Bannen von User:', error.message);
        await ctx.answerCbQuery(`❌ Fehler: ${error.message}`, { show_alert: true });
        await sendToAdminLogChat(
          `❌ Fehler beim Bannen von User ${userId}:\n${error.message}`,
          ctx,
          false
        );
      }
    } else if (action === 'observe_user') {
      // BEOBACHTEN - Markiere User als "observed"
      
      // TEAM-MITGLIED-Protection: Prüfe ob User Admin/Creator in der Gruppe ist
      const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
      if (adminCheck.isAdmin) {
        await ctx.answerCbQuery(
          `ℹ️ User ist Team-Mitglied (${adminCheck.status === 'creator' ? 'Creator' : 'Administrator'}) - Beobachtung nicht nötig.`,
          { show_alert: false }
        );
        return;
      }
      
      // Prüfe ob User bereits beobachtet wird
      const alreadyObserved = isUserObserved(userId);
      
      if (alreadyObserved) {
        await ctx.answerCbQuery('✅ User wird bereits beobachtet', { show_alert: false });
        return;
      }
      
      await ctx.answerCbQuery('⏳ Markiere User als beobachtet...', { show_alert: false });
      
      try {
        // Setze observed Status
        setUserObserved(userId, true);
        
        // Hole Gruppe-Info für Logging
        const group = getGroup(chatId);
        const groupTitle = group?.title || 'Unbekannt';
        const adminName = ctx.from.username || ctx.from.first_name || 'Unbekannt';
        
        // Sende Bestätigungs-Log
        await sendToAdminLogChat(
          `🟡 <b>User wird beobachtet</b>\n\n` +
          `👤 User ID: <code>${userId}</code>\n` +
          `📍 Gruppe: <b>${groupTitle}</b> (<code>${chatId}</code>)\n` +
          `👮 Admin: ${adminName} (${ctx.from.id})\n\n` +
          `Alle weiteren Aktivitäten dieses Users werden mit erhöhten Logs versehen.`,
          ctx,
          true
        );
        
        // Aktualisiere Inline-Buttons: BEOBACHTEN wird zu BEOBACHTET
        try {
          const { Markup } = await import('telegraf');
          const updatedKeyboard = Markup.inlineKeyboard([
            [
              Markup.button.callback('🔴 BAN USER', `ban_user:${userId}:${chatId}`),
              Markup.button.callback('✅ BEOBACHTET', `observe_user:${userId}:${chatId}`)
            ]
          ]);
          await ctx.editMessageReplyMarkup(updatedKeyboard.reply_markup);
        } catch (editError: any) {
          // Ignoriere Fehler beim Aktualisieren der Buttons
          console.log('[Callback] Konnte Buttons nicht aktualisieren:', editError.message);
        }
        
        await ctx.answerCbQuery('✅ User wird nun beobachtet', { show_alert: false });
      } catch (error: any) {
        console.error('[Callback] Fehler beim Beobachten von User:', error.message);
        await ctx.answerCbQuery(`❌ Fehler: ${error.message}`, { show_alert: true });
        await sendToAdminLogChat(
          `❌ Fehler beim Beobachten von User ${userId}:\n${error.message}`,
          ctx,
          false
        );
      }
    } else if (action === 'unrestrict') {
      // UNRESTRICT - Entsperre User (via Daily Briefing Button)
      await ctx.answerCbQuery('⏳ Entsperre User...', { show_alert: false });

      try {
        // Restriction in Telegram aufheben
        await ctx.telegram.restrictChatMember(chatId, userId, {
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

        const adminName = ctx.from?.username || ctx.from?.first_name || 'Admin';
        console.log(`[BRIEFING] User ${userId} in Chat ${chatId} entsperrt durch ${adminName}`);

        // Aktualisiere Button zu "Entsperrt"
        try {
          await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
        } catch (editError: any) {
          // Button-Update fehlgeschlagen, ignorieren
        }

        await ctx.answerCbQuery(`✅ User ${userId} wurde entsperrt`, { show_alert: false });
      } catch (error: any) {
        console.error('[BRIEFING] Fehler beim Entsperren:', error.message);
        await ctx.answerCbQuery(`❌ Fehler: ${error.message}`, { show_alert: true });
      }
    } else {
      await ctx.answerCbQuery('❌ Unbekannte Aktion');
    }
  } catch (error: any) {
    console.error('[Callback] Fehler beim Verarbeiten von Callback-Query:', error.message);
    try {
      await ctx.answerCbQuery('❌ Fehler beim Verarbeiten der Anfrage');
    } catch (answerError: any) {
      // Ignoriere Fehler beim Antworten
    }
  }
});

// Wartungsjob: Risk-Decay alle 60 Minuten
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000; // 60 Minuten

async function runMaintenanceJob(): Promise<void> {
  try {
    // Erstelle Context-Objekt für Logging (minimal)
    const dummyCtx = {
      telegram: bot.telegram,
    } as Context;

    const result = await runDecayMaintenance(dummyCtx);
    
    if (result.processed > 0) {
      console.log(`[Maintenance] Verarbeitet: ${result.processed}, Decay: ${result.decayed}, Auto-Unrestrict: ${result.unrestricted}`);
    }
    
    // Cleanup alte Cooldowns (älter als 1 Stunde)
    const { clearOldCooldowns } = await import('./rateLimit');
    clearOldCooldowns(60 * 60 * 1000); // 1 Stunde
  } catch (error: any) {
    console.error('[Maintenance] Fehler beim Wartungsjob:', error.message);
  }
}

// Starte Wartungsjob alle 60 Minuten
setInterval(runMaintenanceJob, MAINTENANCE_INTERVAL_MS);
console.log(`[Startup] Wartungsjob gestartet (alle ${MAINTENANCE_INTERVAL_MS / 1000 / 60} Minuten)`);

// Cluster-Erkennung alle 10 Minuten
const CLUSTER_DETECTION_INTERVAL_MS = 10 * 60 * 1000; // 10 Minuten
setInterval(async () => {
  try {
    const result = await runClusterDetection();
    if (result.l1 > 0 || result.l2 > 0 || result.l3 > 0) {
      console.log(`[Cluster] Batch-Analyse abgeschlossen: L1=${result.l1}, L2=${result.l2}, L3=${result.l3}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Cluster] Fehler bei Batch-Analyse:', errorMessage);
  }
}, CLUSTER_DETECTION_INTERVAL_MS);
console.log(`[Startup] Cluster-Erkennung gestartet (alle ${CLUSTER_DETECTION_INTERVAL_MS / 1000 / 60} Minuten)`);

// DeletedAccount-AutoRemove wurde entfernt:
// Telegram liefert keine zuverlässigen Signale für gelöschte Accounts.
// Die automatische Entfernung basierte auf heuristischen Erkennungen,
// die zu False Positives führen können.

// Startup Self-Check Log (PFLICHT - muss IMMER erscheinen)
async function sendStartupLog(): Promise<void> {
  try {
    const logMessage = `[Shield][BOOT] Bot started successfully.`;
    
    // Sende Startup-Log an ADMIN_LOG_CHAT (mit Failsafe)
    // Verwende bot.telegram direkt, da botInstance bereits gesetzt ist
    const ctx = { telegram: bot.telegram } as Context;
    await sendToAdminLogChat(logMessage, ctx);
    
    console.log('[Startup] Startup-Log gesendet');
  } catch (error: any) {
    console.error('[Startup] Fehler beim Senden des Startup-Logs:', error.message);
    // Nicht weiterwerfen - Bot sollte trotzdem starten
  }
}

// Startup: Status wird nur aus DB gelesen, keine Änderungen
async function checkAllGroupsOnStartup(botId: number) {
  try {
    console.log('[Startup][BOOT] Lade Gruppen aus Datenbank...');
    
    const { getAllGroups } = await import('./db');
    const allGroups = getAllGroups();
    
    if (allGroups.length === 0) {
      console.log('[Startup][BOOT] Keine Gruppen in der Datenbank.');
      return;
    }
    
    console.log(`[Startup][BOOT] ${allGroups.length} Gruppen geladen. Status wird aus DB gelesen.`);
  } catch (error: any) {
    console.error('[Startup][BOOT] Fehler beim Laden der Gruppen:', error.message);
  }
}

// Hauptfunktion: Führt Startup-Checks durch und startet Bot
async function main() {
  try {
    // Führe Startup-Checks durch (NACH Bot-Initialisierung, VOR Event-Handlern und bot.launch)
    const { runStartupChecks } = await import('./startupChecks');
    await runStartupChecks(bot);
    console.log('[STARTUP] Startup-Checks erfolgreich abgeschlossen');
    
    // Starte Bot NACH erfolgreichen Checks
    console.log('[Startup] Starte Bot mit Long Polling...');
    await bot.launch({
      allowedUpdates: ['message', 'my_chat_member', 'chat_member'],
    });
    
    console.log('[Startup] ✅ Bot erfolgreich gestartet!');
    console.log('[Startup] Bot läuft im Long Polling Modus');
    
    // KRITISCH: ERST NACH bot.launch() - Hole Bot-ID mit getMe()
    let BOT_ID: number;
    try {
      console.log('[Startup][BOOT] Ermittle Bot-ID mit getMe()...');
      const me = await bot.telegram.getMe();
      BOT_ID = me.id;
      console.log(`[Startup][BOOT] Bot-ID erfolgreich ermittelt: ${BOT_ID}`);
    } catch (error: any) {
      console.error('[Startup][BOOT] KRITISCHER FEHLER: Kann Bot-ID nicht ermitteln:', error.message);
      // Startup abbrechen, wenn Bot-ID nicht ermittelt werden kann
      throw error;
    }
    
    // Sende Startup-Log
    await sendStartupLog();
    
    // ERST NACH getMe() - Prüfe alle Gruppen und setze Status automatisch basierend auf Bot-Admin-Status
    // Übergib BOT_ID als Parameter (nicht intern holen)
    await checkAllGroupsOnStartup(BOT_ID);
    
    // Führe Wartungsjob einmal beim Start aus
    runMaintenanceJob().catch(err => {
      console.error('[Startup] Fehler beim ersten Wartungsjob:', err);
    });
    
    // Wochenreport: Jeden Sonntag um 20:00 Uhr
    // Cron-Format: "Minute Stunde Tag Monat Wochentag"
    // 0 = Sonntag, 20:00 = 20:00 Uhr
    cron.schedule('0 20 * * 0', async () => {
      try {
        console.log('[Weekly] Starte automatischen Wochenreport...');
        const dummyCtx = { telegram: bot.telegram } as Context;
        await sendWeeklyReport(dummyCtx);
        console.log('[Weekly] Automatischer Wochenreport erfolgreich gesendet');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Weekly] Fehler beim automatischen Wochenreport:', errorMessage);
      }
    }, {
      timezone: config.timezone || 'Europe/Berlin'
    });
    console.log('[Startup] Wochenreport-Job gestartet (jeden Sonntag um 20:00 Uhr)');
    
    // Baseline-Scan: 1× monatlich (am 1. des Monats um 02:00 Uhr)
    // Cron-Format: "Minute Stunde Tag Monat Wochentag"
    cron.schedule('0 2 1 * *', async () => {
      try {
        console.log('[Scan] Starte automatischen monatlichen Baseline-Scan...');
        const dummyCtx = { telegram: bot.telegram } as Context;
        await runBaselineScan(dummyCtx, 'auto');
        console.log('[Scan] Automatischer monatlicher Scan erfolgreich abgeschlossen');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[Scan] Fehler beim automatischen monatlichen Scan:', errorMessage);
      }
    }, {
      timezone: config.timezone || 'Europe/Berlin'
    });
    console.log('[Startup] Baseline-Scan-Job gestartet (monatlich am 1. um 02:00 Uhr)');
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[FATAL] Startup checks failed:', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('[FATAL] Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Starte main() Funktion
main().catch((error: any) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error('[FATAL] Unhandled error in main():', errorMessage);
  if (error instanceof Error && error.stack) {
    console.error('[FATAL] Stack trace:', error.stack);
  }
  process.exit(1);
});
