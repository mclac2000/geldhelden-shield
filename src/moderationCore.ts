/**
 * Zentrale Moderationsfunktion
 * 
 * Alle Moderationsaktionen laufen über diese Funktion.
 * Enthält alle Guardrails und Sicherheitsprüfungen.
 */

import { Context } from 'telegraf';
import { config } from './config';
import {
  canPerformAction,
  recordAction,
  isUserProtected,
  handleFloodWait,
  ModerationSeverity,
} from './guardrails';
import { sendToAdminLogChat } from './telegram';

export interface ModerationAction {
  type: 'delete' | 'restrict' | 'kick' | 'ban';
  chatId: string;
  userId: number;
  reason: string;
  severity: ModerationSeverity;
  messageId?: number;
  telegram?: any;
}

export interface ModerationResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  error?: string;
  dryRun?: boolean;
}

/**
 * Zentrale Moderationsfunktion mit allen Guardrails
 */
export async function executeModerationAction(
  action: ModerationAction
): Promise<ModerationResult> {
  const { type, chatId, userId, reason, severity, messageId, telegram } = action;
  
  // ========================================================================
  // Guardrail 1: Panic Mode Check
  // ========================================================================
  if (config.panicMode) {
    console.log(`[GUARD][PANIC] Blocked ${type} for user ${userId} in ${chatId}: ${reason}`);
    return {
      success: false,
      skipped: true,
      reason: 'panic_mode',
    };
  }
  
  // ========================================================================
  // Guardrail 2: Dry-Run Mode Check
  // ========================================================================
  const isDryRun = config.dryRunMode;
  if (isDryRun) {
    console.log(`[DRYRUN] Would ${type.toUpperCase()} user ${userId} in ${chatId}: ${reason}`);
    return {
      success: false,
      skipped: true,
      reason: 'dry_run',
      dryRun: true,
    };
  }
  
  // ========================================================================
  // Guardrail 3: Admin & Team Protection
  // ========================================================================
  const protectionCheck = await isUserProtected(userId, chatId, telegram);
  if (protectionCheck.protected) {
    console.log(`[GUARD] Team member protected: user=${userId} chat=${chatId} reason=${protectionCheck.reason}`);
    return {
      success: false,
      skipped: true,
      reason: `protected_${protectionCheck.reason}`,
    };
  }
  
  // ========================================================================
  // Guardrail 4: Rate Limiter
  // ========================================================================
  const rateLimitCheck = canPerformAction(chatId, type);
  if (!rateLimitCheck.allowed) {
    console.log(`[GUARD] Rate limit hit: chat=${chatId} action=${type} reason=${rateLimitCheck.reason}`);
    return {
      success: false,
      skipped: true,
      reason: `rate_limit_${rateLimitCheck.reason}`,
    };
  }
  
  // ========================================================================
  // Guardrail 5: Severity-basierte Entscheidung
  // ========================================================================
  // SOFT: Nur Message löschen (wenn messageId vorhanden)
  if (severity === ModerationSeverity.SOFT) {
    if (messageId && telegram) {
      try {
        await telegram.deleteMessage(chatId, messageId);
        recordAction(chatId, 'delete');
        console.log(`[ACTION][SOFT][DELETE] chat=${chatId} user=${userId} message=${messageId} reason=${reason}`);
        return { success: true, skipped: false };
      } catch (error: unknown) {
        const floodWait = handleFloodWait(error, chatId);
        if (floodWait.handled) {
          return {
            success: false,
            skipped: true,
            reason: 'flood_wait',
            error: `FloodWait: ${floodWait.retryAfter}s`,
          };
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[ACTION][SOFT][DELETE] Error: chat=${chatId} user=${userId}`, errorMessage);
        return { success: false, skipped: false, error: errorMessage };
      }
    }
    // Kein messageId: Nur markieren/loggen
    console.log(`[ACTION][SOFT][MARK] chat=${chatId} user=${userId} reason=${reason}`);
    return { success: true, skipped: false };
  }
  
  // MEDIUM: Restrict temporär
  if (severity === ModerationSeverity.MEDIUM) {
    if (!telegram) {
      return { success: false, skipped: false, error: 'No telegram instance' };
    }
    
    try {
      // Message löschen (wenn vorhanden)
      if (messageId) {
        try {
          await telegram.deleteMessage(chatId, messageId);
        } catch (error) {
          // Ignoriere delete-Fehler
        }
      }
      
      // Restrict User (24 Stunden)
      await telegram.restrictChatMember(chatId, userId, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false,
        },
        until_date: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 Stunden
      });
      
      recordAction(chatId, 'restrict');
      console.log(`[ACTION][MEDIUM][RESTRICT] chat=${chatId} user=${userId} reason=${reason}`);
      return { success: true, skipped: false };
    } catch (error: unknown) {
      const floodWait = handleFloodWait(error, chatId);
      if (floodWait.handled) {
        return {
          success: false,
          skipped: true,
          reason: 'flood_wait',
          error: `FloodWait: ${floodWait.retryAfter}s`,
        };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ACTION][MEDIUM][RESTRICT] Error: chat=${chatId} user=${userId}`, errorMessage);
      return { success: false, skipped: false, error: errorMessage };
    }
  }
  
  // HARD: Ban permanent
  if (severity === ModerationSeverity.HARD) {
    if (!telegram) {
      return { success: false, skipped: false, error: 'No telegram instance' };
    }
    
    try {
      // Message löschen (wenn vorhanden)
      if (messageId) {
        try {
          await telegram.deleteMessage(chatId, messageId);
        } catch (error) {
          // Ignoriere delete-Fehler
        }
      }
      
      // Ban User
      await telegram.banChatMember(chatId, userId, {
        until_date: 0, // Permanent
      });
      
      recordAction(chatId, 'ban');
      console.log(`[ACTION][HARD][BAN] chat=${chatId} user=${userId} reason=${reason}`);
      return { success: true, skipped: false };
    } catch (error: unknown) {
      const floodWait = handleFloodWait(error, chatId);
      if (floodWait.handled) {
        return {
          success: false,
          skipped: true,
          reason: 'flood_wait',
          error: `FloodWait: ${floodWait.retryAfter}s`,
        };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ACTION][HARD][BAN] Error: chat=${chatId} user=${userId}`, errorMessage);
      return { success: false, skipped: false, error: errorMessage };
    }
  }
  
  // Unbekannte Severity
  return {
    success: false,
    skipped: false,
    error: `Unknown severity: ${severity}`,
  };
}

/**
 * Bestimmt ModerationSeverity basierend auf Kontext
 */
export function determineSeverity(
  score: number,
  reasons: string[],
  isRepeated: boolean = false,
  multipleGroups: boolean = false
): ModerationSeverity {
  // HARD: Klarer Scam + Wiederholung oder mehrere Gruppen
  if (score >= 18 && (isRepeated || multipleGroups)) {
    return ModerationSeverity.HARD;
  }
  
  // HARD: Sehr hoher Score
  if (score >= 25) {
    return ModerationSeverity.HARD;
  }
  
  // MEDIUM: Mittlerer Score oder erste Warnung
  if (score >= 10) {
    return ModerationSeverity.MEDIUM;
  }
  
  // SOFT: Niedriger Score, nur Message löschen
  return ModerationSeverity.SOFT;
}
