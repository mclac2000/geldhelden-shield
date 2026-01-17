import { Context, Telegraf, Markup } from 'telegraf';
import { config, isDryRunMode } from './config';
import { getManagedGroups, logAction } from './db';
import { isAdmin } from './admin';

// ============================================================================
// Fehlerklassen
// ============================================================================

export class TelegramForbiddenError extends Error {
  constructor(message: string, public readonly chatId?: string) {
    super(message);
    this.name = 'TelegramForbiddenError';
  }
}

export class TelegramBadRequestError extends Error {
  constructor(message: string, public readonly chatId?: string) {
    super(message);
    this.name = 'TelegramBadRequestError';
  }
}

export class TelegramRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfter: number,
    public readonly chatId?: string
  ) {
    super(message);
    this.name = 'TelegramRateLimitError';
  }
}

export class TelegramChatMigratedError extends Error {
  constructor(
    message: string,
    public readonly newChatId: number,
    public readonly chatId?: string
  ) {
    super(message);
    this.name = 'TelegramChatMigratedError';
  }
}

// ============================================================================
// Rate-Limit-Queue
// ============================================================================

class ActionQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private readonly delayMs: number;

  constructor(delayMs: number = 350) {
    this.delayMs = delayMs;
  }

  async enqueue<T>(action: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await action();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const action = this.queue.shift();
      if (action) {
        try {
          await action();
        } catch (error) {
          // Fehler werden bereits an den Aufrufer weitergegeben
        }
        // Warte zwischen Aktionen
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.delayMs));
        }
      }
    }

    this.processing = false;
  }
}

// Globale Queue-Instanz
const actionQueue = new ActionQueue(350);

// ============================================================================
// Rate-Limit-Queue für Admin-Logs (max 1/Sekunde, Retry bei 429)
// ============================================================================

class AdminLogQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private readonly delayMs: number = 1000; // 1 Sekunde
  private lastSentAt: number = 0;

  async enqueue(action: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await action();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const action = this.queue.shift();
      if (action) {
        try {
          // Warte bis 1 Sekunde seit letztem Send vergangen ist
          const now = Date.now();
          const timeSinceLastSend = now - this.lastSentAt;
          if (timeSinceLastSend < this.delayMs) {
            await new Promise(resolve => setTimeout(resolve, this.delayMs - timeSinceLastSend));
          }
          
          await action();
          this.lastSentAt = Date.now();
        } catch (error: any) {
          // Retry bei 429 (Rate Limit)
          if (error.response?.error_code === 429) {
            const retryAfter = error.response?.parameters?.retry_after || 1;
            console.log(`[AdminLogQueue] Rate-Limit, warte ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            
            // Re-queue die Aktion
            this.queue.unshift(action);
          } else {
            // Andere Fehler: nur loggen, nicht re-queue
            console.error('[AdminLogQueue] Fehler beim Senden:', error.message);
          }
        }
      }
    }

    this.processing = false;
  }
}

// Globale Admin-Log-Queue-Instanz
const adminLogQueue = new AdminLogQueue();

// ============================================================================
// Helper-Funktionen
// ============================================================================

let botInstance: Telegraf | null = null;

export function setBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

export function getBotTelegram(): any {
  if (botInstance) {
    return botInstance.telegram;
  }
  throw new Error('Bot-Instanz nicht initialisiert. setBotInstance() muss zuerst aufgerufen werden.');
}

/**
 * Prüft ob der Bot Moderationsrechte in einer Gruppe hat (für interne Verwendung)
 * Returns: { canModerate: boolean, error?: string }
 */
async function canBotModerate(
  chatId: string,
  action: string,
  telegram: any
): Promise<{ canModerate: boolean; error?: string }> {
  try {
    // Hole Bot-Info
    const me = await telegram.getMe();
    const botId = me.id;
    
    // Prüfe Bot-Status in der Gruppe (ob Bot Admin ist)
    const botMember = await telegram.getChatMember(chatId, botId);
    const botStatus = String(botMember.status || '');
    
    // Bot muss Admin oder Creator sein, um zu moderieren
    if (botStatus !== 'administrator' && botStatus !== 'creator') {
      return {
        canModerate: false,
        error: `Bot ist nicht Admin in Gruppe ${chatId} (Status: ${botStatus})`
      };
    }
    
    // Prüfe ob Bot spezifische Rechte hat (je nach Action)
    if (action === 'restrict' && !botMember.can_restrict_members) {
      return {
        canModerate: false,
        error: `Bot hat keine can_restrict_members Rechte in ${chatId}`
      };
    }
    
    if ((action === 'ban' || action === 'kick') && !botMember.can_restrict_members) {
      return {
        canModerate: false,
        error: `Bot hat keine can_restrict_members Rechte in ${chatId}`
      };
    }
    
    if (action === 'delete' && !botMember.can_delete_messages) {
      return {
        canModerate: false,
        error: `Bot hat keine can_delete_messages Rechte in ${chatId}`
      };
    }
    
    return { canModerate: true };
  } catch (error: any) {
    // Bei API-Fehler: return false (kein Throw)
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      canModerate: false,
      error: `API-Fehler beim Prüfen der Moderation-Rechte: ${errorMessage}`
    };
  }
}


function formatUserInfo(userId: number, username?: string, firstName?: string, lastName?: string): string {
  const name = firstName || username || 'Unbekannt';
  const fullName = lastName ? `${firstName} ${lastName}` : name;
  return username
    ? `<a href="tg://user?id=${userId}">${fullName}</a> (@${username})`
    : `<a href="tg://user?id=${userId}">${fullName}</a>`;
}

/**
 * Prüft ob der Bot Admin oder Creator in einer Gruppe ist
 * Returns: { isAdmin: boolean, status: string | null, error: string | null }
 */
export async function isBotAdminInGroup(
  chatId: string,
  telegram?: any
): Promise<{ isAdmin: boolean; status: string | null; error: string | null }> {
  const telegramInstance = telegram || getBotTelegram();
  
  try {
    // Hole Bot-Info
    const me = await telegramInstance.getMe();
    const botId = me.id;
    
    // Prüfe Bot-Status in der Gruppe
    const member = await telegramInstance.getChatMember(chatId, botId);
    const status = String(member.status || '');
    
    const isAdminOrCreator = status === 'administrator' || status === 'creator';
    
    return { isAdmin: isAdminOrCreator, status, error: null };
  } catch (error: any) {
    const errorCode = error.response?.error_code;
    const errorDescription = error.response?.description || error.message;
    
    // USER_NOT_PARTICIPANT oder ähnliche Fehler bedeuten, dass Bot nicht in der Gruppe ist
    if (errorCode === 400 || errorCode === 403) {
      return { isAdmin: false, status: null, error: errorDescription };
    }
    
    // Bei anderen Fehlern vorsichtshalber als nicht-Admin behandeln
    return { isAdmin: false, status: null, error: errorDescription };
  }
}

/**
 * Prüft ob eine Gruppe managed ist (Bot ist Admin ODER Status in DB ist 'managed')
 * Diese Funktion ersetzt die einfache Status-Prüfung und prüft automatisch den Bot-Admin-Status
 * Returns: { isManaged: boolean, botIsAdmin: boolean, dbStatus: string | null }
 */
export async function isGroupManaged(
  chatId: string,
  telegram?: any
): Promise<{ isManaged: boolean; botIsAdmin: boolean; dbStatus: string | null }> {
  // Prüfe zuerst ob Bot Admin in der Gruppe ist
  const botAdminCheck = await isBotAdminInGroup(chatId, telegram);
  const botIsAdmin = botAdminCheck.isAdmin;
  
  // Wenn Bot Admin ist, ist Gruppe automatisch managed
  if (botIsAdmin) {
    return { isManaged: true, botIsAdmin: true, dbStatus: 'managed' };
  }
  
  // Fallback: Prüfe Status in DB (für Gruppen wo Bot noch nicht Admin ist)
  const { getGroup } = await import('./db');
  const { statusCodeToString } = await import('./domain/groupProjection');
  const group = getGroup(chatId);
  const dbStatus = group ? statusCodeToString(group.status) : null;
  const isManaged = group?.status === 1; // 1 = managed
  
  return { isManaged, botIsAdmin: false, dbStatus };
}

/**
 * Prüft live ob eine Gruppe managed ist (Bot hat Admin-Rechte)
 * Korrigiert DB-Status wenn falsch
 * Returns: boolean (true wenn managed)
 */
export async function isGroupManagedLive(
  chatId: string,
  ctx?: Context
): Promise<boolean> {
  const telegram = ctx?.telegram || getBotTelegram();
  
  try {
    // Live API-Check: Prüfe ob Bot Admin ist
    const botAdminCheck = await isBotAdminInGroup(chatId, telegram);
    const botIsAdmin = botAdminCheck.isAdmin;
    
    // Hole DB-Status
    const { getGroup, registerGroup } = await import('./db');
    const { statusCodeToString } = await import('./domain/groupProjection');
    const group = getGroup(chatId);
    const dbStatus = group ? statusCodeToString(group.status) : null;
    
    // Realität: Bot ist Admin → Gruppe ist managed
    if (botIsAdmin) {
      // DB korrigieren wenn falsch
      if (group?.status !== 1) { // 1 = managed
        const title = group?.title || null;
        registerGroup(chatId, title, 'managed');
        console.warn(`[MANAGED][CORRECT] DB korrigiert: ${chatId} von '${dbStatus}' zu 'managed' (Bot ist Admin)`);
      }
      return true;
    }
    
    // Realität: Bot ist NICHT Admin
    // DB korrigieren wenn DB sagt "managed" aber Bot ist nicht Admin
    if (group?.status === 1) { // 1 = managed
      const title = group?.title || null;
      registerGroup(chatId, title, 'known');
      console.warn(`[MANAGED][CORRECT] DB korrigiert: ${chatId} von 'managed' zu 'known' (Bot ist nicht Admin)`);
    }
    
    return false;
  } catch (error: any) {
    // Bei Fehler: Fallback auf DB-Status
    const { getGroup } = await import('./db');
    const { statusCodeToString } = await import('./domain/groupProjection');
    const group = getGroup(chatId);
    const dbStatus = group ? statusCodeToString(group.status) : null;
    const isManaged = group?.status === 1; // 1 = managed
    console.error(`[MANAGED][ERROR] Fehler bei Live-Check für ${chatId}:`, error.message);
    return isManaged;
  }
}

/**
 * Prüft ob ein User Admin oder Creator in einer Gruppe ist
 * Returns: { isAdmin: boolean, status: string | null, error: string | null }
 */
export async function isUserAdminOrCreatorInGroup(
  chatId: string,
  userId: number,
  telegram?: any
): Promise<{ isAdmin: boolean; status: string | null; error: string | null }> {
  const telegramInstance = telegram || getBotTelegram();
  
  try {
    const member = await telegramInstance.getChatMember(chatId, userId);
    const status = String(member.status || '');
    
    const isAdminOrCreator = status === 'administrator' || status === 'creator';
    
    return { isAdmin: isAdminOrCreator, status, error: null };
  } catch (error: any) {
    const errorCode = error.response?.error_code;
    const errorDescription = error.response?.description || error.message;
    
    // USER_NOT_PARTICIPANT oder ähnliche Fehler bedeuten, dass User nicht in der Gruppe ist
    // In diesem Fall ist er kein Admin
    if (errorCode === 400 || errorCode === 403) {
      return { isAdmin: false, status: null, error: errorDescription };
    }
    
    // Bei anderen Fehlern vorsichtshalber als nicht-Admin behandeln
    return { isAdmin: false, status: null, error: errorDescription };
  }
}

/**
 * Prüft ob ein User ein Admin ist oder der Bot selbst
 */
async function shouldSkipUser(telegram: any, chatId: string, userId: number): Promise<{ skip: boolean; reason?: string }> {
  // Bot selbst nicht bannen/restricten
  try {
    const me = await telegram.getMe();
    if (userId === me.id) {
      return { skip: true, reason: 'Bot selbst' };
    }
  } catch (error) {
    // Ignorieren falls Fehler
  }

  // Admin-IDs prüfen
  if (isAdmin(userId)) {
    return { skip: true, reason: 'Admin-User' };
  }

  // Prüfe ob User Admin in der Gruppe ist
  try {
    const member = await telegram.getChatMember(chatId, userId);
    const status = String(member.status || '');
    if (status === 'administrator' || status === 'creator') {
      return { skip: true, reason: 'Gruppen-Admin' };
    }
  } catch (error) {
    // Wenn Prüfung fehlschlägt, überspringen wir vorsichtshalber
    // (kann bei USER_NOT_PARTICIPANT passieren)
  }

  return { skip: false };
}

/**
 * Parse Telegram API Error und wirft entsprechende Fehlerklasse
 */
function handleTelegramError(error: any, chatId: string): never {
  const errorCode = error.response?.error_code;
  const description = error.response?.description || error.message || 'Unknown error';

  // FloodWait / Rate-Limit
  if (errorCode === 429 || description.includes('FLOOD') || description.includes('retry_after')) {
    const retryAfter = error.response?.parameters?.retry_after || 1;
    throw new TelegramRateLimitError(
      `Rate limit exceeded. Retry after ${retryAfter}s`,
      retryAfter,
      chatId
    );
  }

  // Forbidden (fehlende Rechte, USER_NOT_PARTICIPANT, etc.)
  if (errorCode === 403 || 
      description.includes('USER_NOT_PARTICIPANT') ||
      description.includes('chat not found') ||
      description.includes('not enough rights')) {
    throw new TelegramForbiddenError(description, chatId);
  }

  // Bad Request (ungültige Parameter, etc.)
  if (errorCode === 400 || description.includes('BAD REQUEST')) {
    throw new TelegramBadRequestError(description, chatId);
  }

  // Andere Fehler als generischer Error
  throw new Error(`Telegram API Error: ${description} (code: ${errorCode})`);
}

// ============================================================================
// Telegram Action Wrapper
// ============================================================================

interface ActionResult {
  success: boolean;
  skipped: boolean;
  error?: string;
}

/**
 * Shadow-Restrict: Restrictiert User mit allen Permissions auf false
 * until_date = 0 bedeutet permanent
 */
export async function restrictUser(
  chatId: string,
  userId: number,
  reason: string,
  durationMinutes?: number
): Promise<ActionResult> {
  return actionQueue.enqueue(async () => {
    const telegram = getBotTelegram();

    // Prüfe ob User übersprungen werden soll
    const skipCheck = await shouldSkipUser(telegram, chatId, userId);
    if (skipCheck.skip) {
      console.log(`[Shield] SKIP restrict ${userId} in ${chatId}: ${skipCheck.reason}`);
      return { success: false, skipped: true, error: skipCheck.reason };
    }

    // Prüfe ob Bot Moderation-Rechte hat
    const permCheck = await canBotModerate(chatId, 'restrict', telegram);
    if (!permCheck.canModerate) {
      console.log(`[PERMISSION] restrict denied for bot in chat ${chatId}: ${permCheck.error || 'Fehlende Rechte'}`);
      return { success: false, skipped: true, error: permCheck.error || 'Fehlende Rechte' };
    }

    // Dry-Run Mode Check
    if (isDryRunMode()) {
      const durationInfo = durationMinutes ? ` (${durationMinutes} min)` : '';
      console.log(`[DRYRUN] action=restrict user=${userId} chat=${chatId} reason="${reason}"${durationInfo}`);
      return { success: true, skipped: false }; // Simuliere Erfolg
    }

    try {
      // Berechne until_date: 0 = permanent, sonst Unix-Timestamp in Sekunden
      const untilDate = durationMinutes
        ? Math.floor(Date.now() / 1000) + durationMinutes * 60
        : 0;

      await telegram.restrictChatMember(chatId, userId, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_polls: false,
          can_add_web_page_previews: false,
          can_invite_users: false,
          can_pin_messages: false,
          can_change_info: false,
        },
        until_date: untilDate,
      });

      logAction(userId, chatId, 'restrict', reason);
      return { success: true, skipped: false };
    } catch (error: any) {
      try {
        handleTelegramError(error, chatId);
      } catch (handledError: any) {
        // TelegramForbiddenError -> leise abbrechen
        if (handledError instanceof TelegramForbiddenError) {
          console.log(`[Shield] SKIP restrict ${userId} in ${chatId}: ${handledError.message}`);
          return { success: false, skipped: true, error: handledError.message };
        }

        // TelegramRateLimitError -> retry einmal
        if (handledError instanceof TelegramRateLimitError) {
          console.log(`[Shield] Rate-Limit bei restrict ${userId} in ${chatId}, warte ${handledError.retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, handledError.retryAfter * 1000));
          
          try {
            const untilDate = durationMinutes
              ? Math.floor(Date.now() / 1000) + durationMinutes * 60
              : 0;
            
            await telegram.restrictChatMember(chatId, userId, {
              permissions: {
                can_send_messages: false,
                can_send_media_messages: false,
                can_send_polls: false,
                can_add_web_page_previews: false,
                can_invite_users: false,
                can_pin_messages: false,
                can_change_info: false,
              },
              until_date: untilDate,
            });
            logAction(userId, chatId, 'restrict', reason);
            return { success: true, skipped: false };
          } catch (retryError: any) {
            console.error(`[Shield] Retry fehlgeschlagen bei restrict ${userId} in ${chatId}:`, retryError.message);
            return { success: false, skipped: false, error: retryError.message };
          }
        }

        // Andere Fehler
        console.error(`[Shield] Fehler beim restrict ${userId} in ${chatId}:`, handledError.message);
        return { success: false, skipped: false, error: handledError.message };
      }
    }

    return { success: false, skipped: false, error: 'Unknown error' };
  });
}

/**
 * Unrestrict: Setzt alle Permissions auf true
 */
export async function unrestrictUser(
  chatId: string,
  userId: number,
  reason: string
): Promise<ActionResult> {
  return actionQueue.enqueue(async () => {
    const telegram = getBotTelegram();

    // Prüfe ob User übersprungen werden soll
    const skipCheck = await shouldSkipUser(telegram, chatId, userId);
    if (skipCheck.skip) {
      console.log(`[Shield] SKIP unrestrict ${userId} in ${chatId}: ${skipCheck.reason}`);
      return { success: false, skipped: true, error: skipCheck.reason };
    }

    try {
      await telegram.restrictChatMember(chatId, userId, {
        permissions: {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_polls: true,
          can_add_web_page_previews: true,
          can_invite_users: true,
          can_pin_messages: true,
          can_change_info: true,
        },
      });

      logAction(userId, chatId, 'unrestrict', reason);
      return { success: true, skipped: false };
    } catch (error: any) {
      try {
        handleTelegramError(error, chatId);
      } catch (handledError: any) {
        if (handledError instanceof TelegramForbiddenError) {
          console.log(`[Shield] SKIP unrestrict ${userId} in ${chatId}: ${handledError.message}`);
          return { success: false, skipped: true, error: handledError.message };
        }

        if (handledError instanceof TelegramRateLimitError) {
          console.log(`[Shield] Rate-Limit bei unrestrict ${userId} in ${chatId}, warte ${handledError.retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, handledError.retryAfter * 1000));
          
          try {
            await telegram.restrictChatMember(chatId, userId, {
              permissions: {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_polls: true,
                can_add_web_page_previews: true,
                can_invite_users: true,
                can_pin_messages: true,
                can_change_info: true,
              },
            });
            logAction(userId, chatId, 'unrestrict', reason);
            return { success: true, skipped: false };
          } catch (retryError: any) {
            console.error(`[Shield] Retry fehlgeschlagen bei unrestrict ${userId} in ${chatId}:`, retryError.message);
            return { success: false, skipped: false, error: retryError.message };
          }
        }

        console.error(`[Shield] Fehler beim unrestrict ${userId} in ${chatId}:`, handledError.message);
        return { success: false, skipped: false, error: handledError.message };
      }
    }

    return { success: false, skipped: false, error: 'Unknown error' };
  });
}

/**
 * Ban: Bannt User permanent
 */
export async function banUser(
  chatId: string,
  userId: number,
  reason: string
): Promise<ActionResult> {
  return actionQueue.enqueue(async () => {
    const telegram = getBotTelegram();

    // Prüfe ob User übersprungen werden soll
    const skipCheck = await shouldSkipUser(telegram, chatId, userId);
    if (skipCheck.skip) {
      console.log(`[Shield] SKIP ban ${userId} in ${chatId}: ${skipCheck.reason}`);
      return { success: false, skipped: true, error: skipCheck.reason };
    }

    // Dry-Run Mode Check
    if (isDryRunMode()) {
      console.log(`[DRYRUN] action=ban user=${userId} chat=${chatId} reason="${reason}"`);
      return { success: true, skipped: false }; // Simuliere Erfolg
    }

    try {
      await telegram.banChatMember(chatId, userId, {
        until_date: 0, // Permanent
      });

      logAction(userId, chatId, 'ban', reason);
      return { success: true, skipped: false };
    } catch (error: any) {
      try {
        handleTelegramError(error, chatId);
      } catch (handledError: any) {
        if (handledError instanceof TelegramForbiddenError) {
          console.log(`[Shield] SKIP ban ${userId} in ${chatId}: ${handledError.message}`);
          return { success: false, skipped: true, error: handledError.message };
        }

        if (handledError instanceof TelegramRateLimitError) {
          console.log(`[Shield] Rate-Limit bei ban ${userId} in ${chatId}, warte ${handledError.retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, handledError.retryAfter * 1000));
          
          try {
            await telegram.banChatMember(chatId, userId, {
              until_date: 0,
            });
            logAction(userId, chatId, 'ban', reason);
            return { success: true, skipped: false };
          } catch (retryError: any) {
            console.error(`[Shield] Retry fehlgeschlagen bei ban ${userId} in ${chatId}:`, retryError.message);
            return { success: false, skipped: false, error: retryError.message };
          }
        }

        console.error(`[Shield] Fehler beim ban ${userId} in ${chatId}:`, handledError.message);
        return { success: false, skipped: false, error: handledError.message };
      }
    }

    return { success: false, skipped: false, error: 'Unknown error' };
  });
}

// ============================================================================
// Globale Aktionen (über alle Gruppen)
// ============================================================================

export interface GlobalActionResult {
  success: number;
  failed: number;
  skipped: number;
}

export async function restrictUserInAllGroups(
  userId: number,
  reason: string
): Promise<GlobalActionResult> {
  const groups = getManagedGroups(); // Nur managed Gruppen
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const group of groups) {
    const result = await restrictUser(String(group.chatId), userId, reason);
    if (result.success) {
      success++;
    } else if (result.skipped) {
      skipped++;
    } else {
      failed++;
    }
  }

  return { success, failed, skipped };
}

export async function unrestrictUserInAllGroups(
  userId: number,
  reason: string
): Promise<GlobalActionResult> {
  const groups = getManagedGroups(); // Nur managed Gruppen
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const group of groups) {
    const result = await unrestrictUser(String(group.chatId), userId, reason);
    if (result.success) {
      success++;
    } else if (result.skipped) {
      skipped++;
    } else {
      failed++;
    }
  }

  return { success, failed, skipped };
}

export async function banUserInAllGroups(
  userId: number,
  reason: string,
  telegram?: any
): Promise<GlobalActionResult> {
  const telegramInstance = telegram || getBotTelegram();
  const groups = getManagedGroups(); // Hole alle Gruppen aus DB
  
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const details: Array<{ chatId: string; result: 'success' | 'forbidden' | 'not_member' | 'error' }> = [];

  // Prüfe für jede Gruppe live, ob Bot Admin ist
  for (const group of groups) {
    try {
      // Live-Check: Ist Bot Admin in dieser Gruppe?
      const chatIdStr = String(group.chatId);
      const botAdminCheck = await isBotAdminInGroup(chatIdStr, telegramInstance);
      
      if (!botAdminCheck.isAdmin) {
        // Bot ist nicht Admin → skip
        skipped++;
        details.push({ chatId: chatIdStr, result: 'forbidden' });
        console.log(`[BAN][SKIP] Bot ist nicht Admin in ${chatIdStr}`);
        continue;
      }

      // Bot ist Admin → versuche Ban
      const result = await banUser(chatIdStr, userId, reason);
      
      if (result.success) {
        success++;
        details.push({ chatId: chatIdStr, result: 'success' });
        console.log(`[BAN] User ${userId} gebannt in ${chatIdStr}`);
      } else if (result.skipped) {
        skipped++;
        details.push({ chatId: chatIdStr, result: 'forbidden' });
        console.log(`[BAN][SKIP] User ${userId} in ${chatIdStr}: ${result.error || 'skipped'}`);
      } else {
        failed++;
        details.push({ chatId: chatIdStr, result: 'error' });
        console.error(`[BAN][ERROR] User ${userId} in ${chatIdStr}: ${result.error || 'unknown error'}`);
      }
    } catch (error: any) {
      failed++;
      const chatIdStr = String(group.chatId);
      details.push({ chatId: chatIdStr, result: 'error' });
      console.error(`[BAN][ERROR] Exception bei ${chatIdStr}:`, error.message);
    }
  }

  console.log(`[BAN][GLOBAL] User ${userId}: ${success} erfolgreich, ${failed} Fehler, ${skipped} übersprungen`);
  
  return { success, failed, skipped };
}

/**
 * Unban: Entbannt einen User in einer Gruppe
 */
export async function unbanUser(
  chatId: string,
  userId: number,
  reason: string
): Promise<ActionResult> {
  return actionQueue.enqueue(async () => {
    const telegram = getBotTelegram();

    try {
      await telegram.unbanChatMember(chatId, userId, {
        only_if_banned: true,
      });

      logAction(userId, chatId, 'allow', reason);
      return { success: true, skipped: false };
    } catch (error: any) {
      try {
        handleTelegramError(error, chatId);
      } catch (handledError: any) {
        if (handledError instanceof TelegramForbiddenError) {
          console.log(`[Shield] SKIP unban ${userId} in ${chatId}: ${handledError.message}`);
          return { success: false, skipped: true, error: handledError.message };
        }

        if (handledError instanceof TelegramRateLimitError) {
          console.log(`[Shield] Rate-Limit bei unban ${userId} in ${chatId}, warte ${handledError.retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, handledError.retryAfter * 1000));
          
          try {
            await telegram.unbanChatMember(chatId, userId, {
              only_if_banned: true,
            });
            logAction(userId, chatId, 'allow', reason);
            return { success: true, skipped: false };
          } catch (retryError: any) {
            console.error(`[Shield] Retry fehlgeschlagen bei unban ${userId} in ${chatId}:`, retryError.message);
            return { success: false, skipped: false, error: retryError.message };
          }
        }

        console.error(`[Shield] Fehler beim unban ${userId} in ${chatId}:`, handledError.message);
        return { success: false, skipped: false, error: handledError.message };
      }
    }

    return { success: false, skipped: false, error: 'Unknown error' };
  });
}

/**
 * Globaler Unban - Entbannt User in allen managed Gruppen
 */
export async function unbanUserInAllGroups(
  userId: number,
  reason: string
): Promise<GlobalActionResult> {
  const groups = getManagedGroups(); // Nur managed Gruppen
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const group of groups) {
    const chatIdStr = String(group.chatId);
    const result = await unbanUser(chatIdStr, userId, reason);
    if (result.success) {
      success++;
      console.log(`[UNBAN] User ${userId} unbanned in ${chatIdStr}`);
    } else if (result.skipped) {
      skipped++;
    } else {
      failed++;
    }
  }

  return { success, failed, skipped };
}

/**
 * Löscht eine Nachricht
 */
export async function deleteMessage(chatId: string, messageId: number): Promise<boolean> {
  return actionQueue.enqueue(async () => {
    const telegram = getBotTelegram();
    try {
      await telegram.deleteMessage(chatId, messageId);
      return true;
    } catch (error: any) {
      const errorCode = error.response?.error_code;
      // 400 = Nachricht nicht gefunden oder bereits gelöscht - OK
      if (errorCode === 400) {
        return true; // Bereits gelöscht - OK
      }
      // 403 = Keine Rechte - leise überspringen
      if (errorCode === 403) {
        console.log(`[Shield] SKIP delete message ${messageId} in ${chatId}: Keine Rechte`);
        return false;
      }
      console.error(`[Shield] Fehler beim Löschen der Nachricht ${messageId} in ${chatId}:`, error.message);
      return false;
    }
  });
}

/**
 * Kickt einen User (unban sofort danach, damit er wieder beitreten kann)
 */
export async function kickUser(
  chatId: string,
  userId: number,
  reason: string
): Promise<ActionResult> {
  return actionQueue.enqueue(async () => {
    const telegram = getBotTelegram();

    // Prüfe ob User übersprungen werden soll
    const skipCheck = await shouldSkipUser(telegram, chatId, userId);
    if (skipCheck.skip) {
      console.log(`[Shield] SKIP kick ${userId} in ${chatId}: ${skipCheck.reason}`);
      return { success: false, skipped: true, error: skipCheck.reason };
    }

    // Dry-Run Mode Check
    if (isDryRunMode()) {
      console.log(`[DRYRUN] action=kick user=${userId} chat=${chatId} reason="${reason}"`);
      return { success: true, skipped: false }; // Simuliere Erfolg
    }

    try {
      // Ban + sofort unban = Kick
      await telegram.banChatMember(chatId, userId, {
        until_date: Math.floor(Date.now() / 1000) + 1, // 1 Sekunde
      });
      
      // Unban sofort (damit User wieder beitreten kann)
      try {
        await telegram.unbanChatMember(chatId, userId, {
          only_if_banned: true,
        });
      } catch (unbanError: any) {
        // Ignoriere Unban-Fehler
      }

      logAction(userId, chatId, 'ban', reason); // Log als ban (Kick ist technisch ein kurzer Ban)
      return { success: true, skipped: false };
    } catch (error: any) {
      try {
        handleTelegramError(error, chatId);
      } catch (handledError: any) {
        if (handledError instanceof TelegramForbiddenError) {
          console.log(`[Shield] SKIP kick ${userId} in ${chatId}: ${handledError.message}`);
          return { success: false, skipped: true, error: handledError.message };
        }

        if (handledError instanceof TelegramRateLimitError) {
          console.log(`[Shield] Rate-Limit bei kick ${userId} in ${chatId}, warte ${handledError.retryAfter}s...`);
          await new Promise(resolve => setTimeout(resolve, handledError.retryAfter * 1000));
          
          try {
            await telegram.banChatMember(chatId, userId, {
              until_date: Math.floor(Date.now() / 1000) + 1,
            });
            try {
              await telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
            } catch (unbanError: any) {
              // Ignoriere
            }
            logAction(userId, chatId, 'ban', reason);
            return { success: true, skipped: false };
          } catch (retryError: any) {
            console.error(`[Shield] Retry fehlgeschlagen bei kick ${userId} in ${chatId}:`, retryError.message);
            return { success: false, skipped: false, error: retryError.message };
          }
        }

        console.error(`[Shield] Fehler beim kick ${userId} in ${chatId}:`, handledError.message);
        return { success: false, skipped: false, error: handledError.message };
      }
    }

    return { success: false, skipped: false, error: 'Unknown error' };
  });
}

/**
 * Globaler Ban - Banned User in allen managed Gruppen und fügt zur Blacklist hinzu
 * Prüft Admin-Status und Team-Mitglied-Status vor dem Ban
 */
export async function banUserGlobally(
  userId: number,
  reason: string = 'global ban'
): Promise<{ success: boolean; groups: number; skipped: boolean; skipReason?: string }> {
  const { isAdmin } = await import('./admin');
  const { getManagedGroups, addToBlacklist, isBlacklisted, getOrCreateUser, updateUserStatus, isTeamMember } = await import('./db');
  
  // 1. Admin-Check
  if (isAdmin(userId)) {
    console.log(`[SKIP][ADMIN] user=${userId}`);
    return { success: false, groups: 0, skipped: true, skipReason: 'Admin-User' };
  }
  
  // 2. Team-Mitglied-Check: Prüfe ob User im Team-Whitelist ist
  if (isTeamMember(userId)) {
    console.log(`[SKIP][TEAM-MEMBER] user=${userId}`);
    return { success: false, groups: 0, skipped: true, skipReason: 'Team-Mitglied' };
  }
  
  // 3. User zur Blacklist hinzufügen (falls noch nicht vorhanden)
  if (!isBlacklisted(userId)) {
    addToBlacklist(userId, 0, reason); // banned_by = 0 für automatische Bans
  }
  
  // 4. Erstelle User falls nicht vorhanden
  getOrCreateUser(userId);
  updateUserStatus(userId, 'banned');
  
  // 5. Banne in allen managed Gruppen
  const result = await banUserInAllGroups(userId, reason);
  
  console.log(`[BAN][GLOBAL] user=${userId} groups=${result.success}`);
  
  return {
    success: result.success > 0,
    groups: result.success,
    skipped: false
  };
}

// DeletedAccount-AutoRemove Funktionen wurden entfernt:
// - removeUserFromGroup()
// - checkIfAccountDeleted()
// 
// Grund: Telegram liefert keine zuverlässigen Signale für gelöschte Accounts.
// Die automatische Entfernung basierte auf heuristischen Erkennungen,
// die zu False Positives führen können.

// ============================================================================
// Logging
// ============================================================================

export interface AdminLogEvent {
  action: 'RESTRICTED' | 'BANNED' | 'UNRESTRICTED' | 'ALLOW' | 'WARNING' | 'TEAM_ADD' | 'TEAM_REMOVE' | 'UNBANNED' | 'INFO';
  userId: number;
  chatId?: string;
  reason?: string;
  joinCount?: number;
  windowHours?: number;
  adminId?: number;
  adminName?: string;
  userInfo?: {
    username?: string;
    firstName?: string;
    lastName?: string;
  };
}

/**
 * Sendet eine Nachricht an ADMIN_LOG_CHAT mit Failsafe
 * Falls ADMIN_LOG_CHAT nicht erreichbar, sendet an ADMIN_IDS als Direktnachricht
 * Nutzt Rate-Limit-Queue (max 1/Sekunde, Retry bei 429)
 */
export async function sendToAdminLogChat(message: string, ctx?: Context, useHtml: boolean = false): Promise<void> {
  const telegram = ctx?.telegram || getBotTelegram();
  
  return adminLogQueue.enqueue(async () => {
    try {
      const options: any = {};
      if (useHtml) {
        options.parse_mode = 'HTML';
      }
      await telegram.sendMessage(config.adminLogChat, message, options);
    } catch (error: any) {
      // Retry wird bereits in der Queue gehandhabt
      // Bei anderen Fehlern: Failsafe
      const errorCode = error.response?.error_code;
      if (errorCode !== 429) {
        console.error('[Shield] Fehler beim Senden an ADMIN_LOG_CHAT:', error.message);
        
        // Failsafe: Sende an ADMIN_IDS als Direktnachricht
        try {
          for (const adminId of config.adminIds) {
            try {
              await telegram.sendMessage(adminId, `[Failsafe] ${message}`, {});
            } catch (dmError: any) {
              console.error(`[Shield] Fehler beim Senden an Admin ${adminId}:`, dmError.message);
            }
          }
        } catch (failsafeError: any) {
          console.error('[Shield] Failsafe fehlgeschlagen:', failsafeError.message);
        }
      } else {
        // 429 wird in der Queue behandelt, aber wir werfen es weiter für Retry
        throw error;
      }
    }
  });
}

export async function logAdmin(event: AdminLogEvent, ctx?: Context): Promise<void> {
  try {
    const telegram = ctx?.telegram || getBotTelegram();
    const userFormatted = formatUserInfo(
      event.userId,
      event.userInfo?.username,
      event.userInfo?.firstName,
      event.userInfo?.lastName
    );

    let message = '';

    switch (event.action) {
      case 'RESTRICTED':
        message = `[Shield] User ${event.userId} → RESTRICTED`;
        if (event.joinCount !== undefined && event.windowHours !== undefined) {
          message += ` (${event.joinCount} Joins / ${event.windowHours}h)`;
        }
        if (event.reason) {
          message += `\nGrund: ${event.reason}`;
        }
        if (event.chatId) {
          message += `\nChat: ${event.chatId}`;
        }
        message += `\nUser: ${userFormatted}`;
        break;

      case 'BANNED':
        message = `[Shield] User ${event.userId} → BANNED`;
        if (event.adminId) {
          message += ` (Admin Action)`;
        } else if (event.joinCount !== undefined) {
          message += ` (${event.joinCount} Joins / ${event.windowHours || config.joinWindowHours}h)`;
        }
        if (event.reason) {
          message += `\nGrund: ${event.reason}`;
        }
        if (event.chatId) {
          message += `\nChat: ${event.chatId}`;
        }
        message += `\nUser: ${userFormatted}`;
        if (event.adminId && event.adminName) {
          message += `\nAdmin: ${event.adminName} (${event.adminId})`;
        }
        break;

      case 'UNRESTRICTED':
        message = `[Shield] User ${event.userId} → UNRESTRICTED`;
        if (event.reason) {
          message += `\nGrund: ${event.reason}`;
        }
        message += `\nUser: ${userFormatted}`;
        if (event.adminId && event.adminName) {
          message += `\nAdmin: ${event.adminName} (${event.adminId})`;
        }
        break;

      case 'ALLOW':
        message = `[Shield] User ${event.userId} → ALLOW (Status: ok)`;
        if (event.reason) {
          message += `\nGrund: ${event.reason}`;
        }
        message += `\nUser: ${userFormatted}`;
        if (event.adminId && event.adminName) {
          message += `\nAdmin: ${event.adminName} (${event.adminId})`;
        }
        break;

      case 'WARNING':
        message = `[Shield] ⚠️ WARNING: User ${event.userId}`;
        if (event.reason) {
          message += `\n${event.reason}`;
        }
        if (event.chatId) {
          message += `\nChat: ${event.chatId}`;
        }
        message += `\nUser: ${userFormatted}`;
        break;

      case 'TEAM_ADD':
        message = `[Shield] ✅ Team hinzugefügt: User ${event.userId}`;
        if (event.reason) {
          message += `\n${event.reason}`;
        }
        message += `\nUser: ${userFormatted}`;
        if (event.adminId && event.adminName) {
          message += `\nAdmin: ${event.adminName} (${event.adminId})`;
        }
        break;

      case 'TEAM_REMOVE':
        message = `[Shield] ❌ Team entfernt: User ${event.userId}`;
        if (event.reason) {
          message += `\n${event.reason}`;
        }
        message += `\nUser: ${userFormatted}`;
        if (event.adminId && event.adminName) {
          message += `\nAdmin: ${event.adminName} (${event.adminId})`;
        }
        break;

      case 'UNBANNED':
        message = `[Shield] ✅ User ${event.userId} → UNBANNED (global)`;
        if (event.reason) {
          message += `\n${event.reason}`;
        }
        message += `\nUser: ${userFormatted}`;
        if (event.adminId && event.adminName) {
          message += `\nAdmin: ${event.adminName} (${event.adminId})`;
        }
        break;

      case 'INFO':
        message = `[Shield] ℹ️ INFO: User ${event.userId}`;
        if (event.reason) {
          message += `\n${event.reason}`;
        }
        if (event.chatId) {
          message += `\nChat: ${event.chatId}`;
        }
        message += `\nUser: ${userFormatted}`;
        if (event.adminId && event.adminName) {
          message += `\nAdmin: ${event.adminName} (${event.adminId})`;
        }
        break;
    }

    message += `\nZeit: ${new Date().toISOString()}`;

    await sendToAdminLogChat(message, ctx, true);
  } catch (error: any) {
    console.error('[Shield] Fehler beim Senden des Admin-Logs:', error.message);
    // Nicht weiterwerfen, um Bot-Lauf nicht zu stören
  }
}

// ============================================================================
// Legacy-Funktionen für Backward-Kompatibilität (werden entfernt)
// ============================================================================

/**
 * @deprecated Verwende restrictUser() stattdessen
 */
export async function shadowRestrictUser(ctx: Context, userId: number, chatId: string, reason: string): Promise<boolean> {
  const result = await restrictUser(chatId, userId, reason);
  return result.success && !result.skipped;
}

/**
 * Sendet eine strukturierte Join-Log-Nachricht mit Inline-Buttons
 * Erscheint nur für managed groups
 */
export async function sendJoinLogWithActions(
  ctx: Context,
  userId: number,
  chatId: string,
  groupTitle: string,
  distinctChatsCount: number,
  userInfo: { username?: string; firstName?: string; lastName?: string }
): Promise<void> {
  const telegram = ctx?.telegram || getBotTelegram();
  
  // Bestimme Risiko-Einstufung basierend auf distinctChatsCount
  let riskLevel: string;
  if (distinctChatsCount === 1) {
    riskLevel = 'OK';
  } else if (distinctChatsCount >= 2 && distinctChatsCount <= 3) {
    riskLevel = 'Mehrfach-Join';
  } else {
    riskLevel = 'Hochrisiko';
  }
  
  // Formatiere Anzeigename
  const displayName = userInfo.firstName 
    ? `${userInfo.firstName}${userInfo.lastName ? ` ${userInfo.lastName}` : ''}`
    : userInfo.username 
    ? `@${userInfo.username}`
    : 'Unbekannt';
  
  // Baue strukturierte Log-Nachricht
  let message = '🚨 <b>Neuer Nutzer beigetreten</b>\n\n';
  message += `👤 Name: <b>${displayName}</b>\n`;
  message += `🆔 User ID: <code>${userId}</code>\n`;
  message += `👥 Gruppen: <b>${distinctChatsCount}</b> (im Join-Zeitfenster)\n`;
  message += `📍 Gruppe: <b>${groupTitle}</b>\n`;
  message += `🔗 Profil: <a href="https://t.me/user?id=${userId}">https://t.me/user?id=${userId}</a>\n\n`;
  message += `⚠️ Auffällig: <b>${riskLevel}</b>`;
  
  // Erstelle Inline-Keyboard mit Buttons
  // Callback-Data Format: "action:userId:chatId" (z.B. "ban:123456:-1001234567890")
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🔴 BAN USER', `ban_user:${userId}:${chatId}`),
      Markup.button.callback('🟡 BEOBACHTEN', `observe_user:${userId}:${chatId}`)
    ]
  ]);
  
  try {
    const options: any = {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
      disable_web_page_preview: false,
    };
    
    await telegram.sendMessage(config.adminLogChat, message, options);
  } catch (error: any) {
    console.error('[Shield] Fehler beim Senden von Join-Log:', error.message);
    
    // Failsafe: Sende ohne Buttons
    try {
      await telegram.sendMessage(config.adminLogChat, message, { parse_mode: 'HTML' });
    } catch (failsafeError: any) {
      console.error('[Shield] Failsafe fehlgeschlagen:', failsafeError.message);
    }
  }
}

/**
 * Sendet eine Eskalations-Log-Nachricht für beobachtete User
 */
export async function sendEscalationLog(
  ctx: Context,
  userId: number,
  chatId: string,
  groupTitle: string,
  triggerType: 'join' | 'activity' | 'multi_join',
  joinCount24h: number,
  userInfo: { username?: string; firstName?: string; lastName?: string }
): Promise<void> {
  const telegram = ctx?.telegram || getBotTelegram();
  
  // Bestimme Auslöser-Text
  let triggerText: string;
  switch (triggerType) {
    case 'join':
      triggerText = 'neue Gruppe';
      break;
    case 'activity':
      triggerText = 'Aktivität in Gruppe';
      break;
    case 'multi_join':
      triggerText = 'Mehrfach-Join-Schwellenwert überschritten';
      break;
    default:
      triggerText = 'unbekannt';
  }
  
  // Formatiere Anzeigename
  const displayName = userInfo.firstName 
    ? `${userInfo.firstName}${userInfo.lastName ? ` ${userInfo.lastName}` : ''}`
    : userInfo.username 
    ? `@${userInfo.username}`
    : 'Unbekannt';
  
  // Baue Eskalations-Log-Nachricht
  let message = '🚨 <b>BEOBACHTETER USER – ESKALATION</b>\n\n';
  message += `👤 Name: <b>${displayName}</b>\n`;
  message += `🆔 User ID: <code>${userId}</code>\n`;
  message += `📍 Auslöser: <b>${triggerText}</b>\n`;
  message += `📊 Gruppen-Joins (24h): <b>${joinCount24h}</b>\n`;
  message += `⚠️ Status: <b>HOCHRISIKO</b>\n\n`;
  message += `🔗 Profil:\nhttps://t.me/user?id=${userId}\n\n`;
  message += `<b>Aktionen:</b>`;
  
  // Erstelle Inline-Keyboard mit BAN USER Button
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🔴 BAN USER', `ban_user:${userId}:${chatId}`)
    ]
  ]);
  
  try {
    const options: any = {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
      disable_web_page_preview: false,
    };
    
    await telegram.sendMessage(config.adminLogChat, message, options);
  } catch (error: any) {
    console.error('[Shield] Fehler beim Senden von Eskalations-Log:', error.message);
    
    // Failsafe: Sende ohne Buttons
    try {
      await telegram.sendMessage(config.adminLogChat, message, { parse_mode: 'HTML' });
    } catch (failsafeError: any) {
      console.error('[Shield] Failsafe fehlgeschlagen:', failsafeError.message);
    }
  }
}

/**
 * Berechnet Levenshtein-Distanz zwischen zwei Strings
 * Returns: Ähnlichkeit als Prozent (0-100)
 */
function calculateLevenshteinSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 100;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  const maxLen = Math.max(s1.length, s2.length);
  const matrix: number[][] = [];
  
  // Initialisiere Matrix
  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }
  
  // Berechne Levenshtein-Distanz
  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      const cost = s2[i - 1] === s1[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,        // Deletion
        matrix[i][j - 1] + 1,        // Insertion
        matrix[i - 1][j - 1] + cost  // Substitution
      );
    }
  }
  
  const distance = matrix[s2.length][s1.length];
  const similarity = ((maxLen - distance) / maxLen) * 100;
  return Math.max(0, Math.min(100, similarity));
}

/**
 * Normalisiert Zeichenersetzungen (l/I, o/0, etc.)
 */
function normalizeSimilarChars(str: string): string {
  return str
    .replace(/[Il1|]/g, 'i')  // l, I, 1, | → i
    .replace(/[o0]/g, 'o')    // o, 0 → o
    .replace(/[a@]/g, 'a')    // a, @ → a
    .replace(/[e3]/g, 'e')    // e, 3 → e
    .replace(/[s5$]/g, 's')   // s, 5, $ → s
    .replace(/[z2]/g, 'z')    // z, 2 → z
    .toLowerCase()
    .trim();
}

/**
 * Prüft ob ein User-Name/Username gegen geschützte Namen ähnlich ist
 * Returns: { isImpersonation: boolean, matchedName: string | null, similarity: number }
 */
export function checkImpersonation(
  firstName: string | undefined,
  lastName: string | undefined,
  username: string | undefined,
  protectedNames: string[],
  similarityThreshold: number
): { isImpersonation: boolean; matchedName: string | null; similarity: number } {
  const displayName = `${firstName || ''} ${lastName || ''}`.trim();
  const fullName = displayName || username || '';
  
  if (!fullName) {
    return { isImpersonation: false, matchedName: null, similarity: 0 };
  }
  
  const normalizedFullName = normalizeSimilarChars(fullName);
  const normalizedUsername = username ? normalizeSimilarChars(username) : '';
  
  let maxSimilarity = 0;
  let matchedName: string | null = null;
  
  // Prüfe gegen alle geschützten Namen
  for (const protectedName of protectedNames) {
    const normalizedProtected = normalizeSimilarChars(protectedName);
    
    // 1. Case-Insensitive Match (exakt)
    if (normalizedFullName === normalizedProtected || 
        (normalizedUsername && normalizedUsername === normalizedProtected)) {
      return { isImpersonation: true, matchedName: protectedName, similarity: 100 };
    }
    
    // 2. Enthält geschützten Begriff (Substring-Match)
    if (normalizedFullName.includes(normalizedProtected) || 
        normalizedProtected.includes(normalizedFullName) ||
        (normalizedUsername && (normalizedUsername.includes(normalizedProtected) || normalizedProtected.includes(normalizedUsername)))) {
      return { isImpersonation: true, matchedName: protectedName, similarity: 95 };
    }
    
    // 3. Levenshtein-Ähnlichkeit
    const similarityFullName = calculateLevenshteinSimilarity(fullName, protectedName);
    const similarityUsername = username ? calculateLevenshteinSimilarity(username, protectedName) : 0;
    const similarity = Math.max(similarityFullName, similarityUsername);
    
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      matchedName = protectedName;
    }
  }
  
  // Prüfe ob Ähnlichkeit über Schwelle liegt
  const isImpersonation = maxSimilarity >= similarityThreshold;
  
  return {
    isImpersonation,
    matchedName: isImpersonation ? matchedName : null,
    similarity: maxSimilarity
  };
}

/**
 * Sendet eine Impersonation-Warnungs-Log-Nachricht
 */
export async function sendImpersonationWarning(
  ctx: Context,
  userId: number,
  chatId: string,
  groupTitle: string,
  matchedName: string,
  similarity: number,
  userInfo: { username?: string; firstName?: string; lastName?: string }
): Promise<void> {
  const telegram = ctx?.telegram || getBotTelegram();
  
  // Formatiere Anzeigename
  const displayName = userInfo.firstName 
    ? `${userInfo.firstName}${userInfo.lastName ? ` ${userInfo.lastName}` : ''}`
    : userInfo.username 
    ? `@${userInfo.username}`
    : 'Unbekannt';
  
  // Baue Impersonation-Warnungs-Log-Nachricht
  let message = '🚨 <b>MÖGLICHE IDENTITÄTS-TÄUSCHUNG</b>\n\n';
  message += `👤 Name: <b>${displayName}</b>\n`;
  message += `🆔 User ID: <code>${userId}</code>\n`;
  message += `📍 Gruppe: <b>${groupTitle}</b>\n`;
  message += `🔎 Ähnlich zu: <b>${matchedName}</b>\n`;
  message += `📊 Ähnlichkeit: <b>${similarity.toFixed(1)}%</b>\n`;
  message += `⚠️ Risiko: <b>IDENTITÄTSMISSBRAUCH</b>\n\n`;
  message += `🔗 Profil:\nhttps://t.me/user?id=${userId}\n\n`;
  message += `<b>Aktionen:</b>`;
  
  // Erstelle Inline-Keyboard mit Buttons
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🔴 BAN USER', `ban_user:${userId}:${chatId}`),
      Markup.button.callback('🟡 BEOBACHTEN', `observe_user:${userId}:${chatId}`)
    ]
  ]);
  
  try {
    const options: any = {
      parse_mode: 'HTML',
      reply_markup: keyboard.reply_markup,
      disable_web_page_preview: false,
    };
    
    await telegram.sendMessage(config.adminLogChat, message, options);
  } catch (error: any) {
    console.error('[Shield] Fehler beim Senden von Impersonation-Warnung:', error.message);
    
    // Failsafe: Sende ohne Buttons
    try {
      await telegram.sendMessage(config.adminLogChat, message, { parse_mode: 'HTML' });
    } catch (failsafeError: any) {
      console.error('[Shield] Failsafe fehlgeschlagen:', failsafeError.message);
    }
  }
}

// Legacy-Funktion entfernt - verwende logAdmin() oder sendToAdminLogChat()

/**
 * @deprecated Verwende formatUserInfo() direkt
 */
export { formatUserInfo };
