/**
 * Guardrails & Notfallmechanismen
 * 
 * Zentrale Schutzmechanismen für Stabilität und Schadensbegrenzung.
 */

import { config } from './config';
import { isTeamMember } from './db';
import { isAdmin } from './admin';

// ============================================================================
// Moderation Severity Levels
// ============================================================================

export enum ModerationSeverity {
  SOFT = 'SOFT',    // Message löschen, markieren, risk erhöhen
  MEDIUM = 'MEDIUM', // Restrict temporär
  HARD = 'HARD'     // Ban permanent
}

// ============================================================================
// Rate Limiter für Aktionen
// ============================================================================

interface ActionRecord {
  timestamp: number;
  chatId: string;
  action: string;
}

// Rate Limit Tracking
const actionHistory: ActionRecord[] = [];
const groupActionHistory = new Map<string, ActionRecord[]>(); // chatId -> records[]

// Rate Limit Config
const MAX_ACTIONS_PER_GROUP_PER_MINUTE = 5;
const MAX_ACTIONS_GLOBAL_PER_MINUTE = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 Minute

// Cooldown Tracking
const groupCooldowns = new Map<string, number>(); // chatId -> cooldownUntil timestamp

// Admin Notification Tracking (max 1x pro 10 Minuten)
let lastRateLimitNotification = 0;
const RATE_LIMIT_NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000; // 10 Minuten

/**
 * Prüft ob eine Aktion innerhalb der Rate Limits liegt
 */
export function canPerformAction(chatId: string, action: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  
  // Prüfe Cooldown
  const cooldownUntil = groupCooldowns.get(chatId);
  if (cooldownUntil && now < cooldownUntil) {
    return { allowed: false, reason: 'cooldown' };
  }
  
  // Prüfe Group-Level Rate Limit
  const groupActions = groupActionHistory.get(chatId) || [];
  const recentGroupActions = groupActions.filter(r => now - r.timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentGroupActions.length >= MAX_ACTIONS_PER_GROUP_PER_MINUTE) {
    // Setze Cooldown (5 Minuten)
    groupCooldowns.set(chatId, now + 5 * 60 * 1000);
    console.log(`[GUARD] Rate limit hit (group): chat=${chatId} actions=${recentGroupActions.length}`);
    return { allowed: false, reason: 'group_rate_limit' };
  }
  
  // Prüfe Global-Level Rate Limit
  const recentGlobalActions = actionHistory.filter(r => now - r.timestamp < RATE_LIMIT_WINDOW_MS);
  
  if (recentGlobalActions.length >= MAX_ACTIONS_GLOBAL_PER_MINUTE) {
    console.log(`[GUARD] Rate limit hit (global): actions=${recentGlobalActions.length}`);
    
    // Benachrichtige Admin (max 1x pro 10 Minuten)
    if (now - lastRateLimitNotification > RATE_LIMIT_NOTIFICATION_COOLDOWN_MS) {
      lastRateLimitNotification = now;
      // Notification wird von aufrufender Funktion gesendet
    }
    
    return { allowed: false, reason: 'global_rate_limit' };
  }
  
  return { allowed: true };
}

/**
 * Registriert eine durchgeführte Aktion (für Rate Limit Tracking)
 */
export function recordAction(chatId: string, action: string): void {
  const now = Date.now();
  const record: ActionRecord = { timestamp: now, chatId, action };
  
  // Group-Level Tracking
  const groupActions = groupActionHistory.get(chatId) || [];
  groupActions.push(record);
  // Cleanup alte Einträge
  const filteredGroup = groupActions.filter(r => now - r.timestamp < RATE_LIMIT_WINDOW_MS * 2);
  groupActionHistory.set(chatId, filteredGroup);
  
  // Global-Level Tracking
  actionHistory.push(record);
  // Cleanup alte Einträge
  const filteredGlobal = actionHistory.filter(r => now - r.timestamp < RATE_LIMIT_WINDOW_MS * 2);
  actionHistory.length = 0;
  actionHistory.push(...filteredGlobal);
}

/**
 * Prüft ob eine Gruppe im Cooldown ist
 */
export function isGroupInCooldown(chatId: string): boolean {
  const cooldownUntil = groupCooldowns.get(chatId);
  if (!cooldownUntil) {
    return false;
  }
  const now = Date.now();
  if (now >= cooldownUntil) {
    groupCooldowns.delete(chatId);
    return false;
  }
  return true;
}

/**
 * Setzt einen Cooldown für eine Gruppe
 */
export function setGroupCooldown(chatId: string, minutes: number): void {
  const cooldownUntil = Date.now() + minutes * 60 * 1000;
  groupCooldowns.set(chatId, cooldownUntil);
}

/**
 * Holt Cooldown-Status für eine Gruppe
 */
export function getGroupCooldown(chatId: string): number | null {
  const cooldownUntil = groupCooldowns.get(chatId);
  if (!cooldownUntil) {
    return null;
  }
  const now = Date.now();
  if (now >= cooldownUntil) {
    groupCooldowns.delete(chatId);
    return null;
  }
  return cooldownUntil;
}

// ============================================================================
// Admin & Team Protection
// ============================================================================

/**
 * Prüft ob ein User geschützt ist (Admin, Team, Owner, Whitelist)
 */
export async function isUserProtected(
  userId: number,
  chatId: string,
  telegram?: any
): Promise<{ protected: boolean; reason?: string }> {
  // Super-Admin Check
  if (isAdmin(userId)) {
    return { protected: true, reason: 'admin' };
  }
  
  // Team-Member Check
  if (isTeamMember(userId)) {
    return { protected: true, reason: 'team_member' };
  }
  
  // Group Admin/Owner Check (wenn telegram verfügbar)
  if (telegram) {
    try {
      const member = await telegram.getChatMember(chatId, userId);
      const status = String(member.status || '');
      if (status === 'administrator' || status === 'creator') {
        return { protected: true, reason: 'group_admin' };
      }
    } catch (error) {
      // Fehler ignorieren, weiter mit anderen Checks
    }
  }
  
  return { protected: false };
}

/**
 * Prüft ob ein User Admin/Creator in einer Gruppe ist ODER in der Team-Liste steht
 * Returns: boolean (true wenn User moderieren kann, false bei Fehler)
 * Wirft KEINE Fehler - gibt bei API-Fehlern false zurück
 */
export async function canModerate(
  bot: any,
  chatId: number,
  userId: number
): Promise<boolean> {
  try {
    // 1. Prüfe ob User in der internen Team-Liste steht
    if (isTeamMember(userId)) {
      return true;
    }
    
    // 2. Prüfe ob User Admin oder Creator der Gruppe ist
    const member = await bot.getChatMember(chatId, userId);
    const status = String(member.status || '');
    
    if (status === 'administrator' || status === 'creator') {
      return true;
    }
    
    return false;
  } catch (error: any) {
    // Bei API-Fehler → return false (kein Throw)
    return false;
  }
}

/**
 * Loggt eine verweigerte Permission-Aktion
 * Wirft KEINE Fehler
 */
export function logPermissionDenied(
  action: string,
  chatId: number,
  userId: number
): void {
  try {
    console.log(`[PERMISSION] ${action} denied for user ${userId} in chat ${chatId}`);
  } catch (error: any) {
    // Kein Throw - Logging-Fehler sollten den Prozess nicht stoppen
    // Fehler wird ignoriert
  }
}

// ============================================================================
// FloodWait & Telegram API Protection
// ============================================================================

interface FloodWaitError extends Error {
  retry_after?: number;
  parameters?: { retry_after?: number };
}

/**
 * Prüft ob ein Fehler ein FloodWait ist
 */
export function isFloodWaitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  
  const err = error as any;
  
  // Telegram API FloodWait Pattern
  if (err.message && (
    err.message.includes('FLOOD_WAIT') ||
    err.message.includes('Too Many Requests') ||
    err.message.includes('retry_after')
  )) {
    return true;
  }
  
  if (err.code === 429 || err.error_code === 429) {
    return true;
  }
  
  return false;
}

/**
 * Extrahiert retry_after aus einem FloodWait-Fehler
 */
export function getRetryAfter(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  
  const err = error as any;
  
  // Prüfe verschiedene Stellen
  if (err.retry_after) {
    return err.retry_after;
  }
  
  if (err.parameters?.retry_after) {
    return err.parameters.retry_after;
  }
  
  if (err.response?.parameters?.retry_after) {
    return err.response.parameters.retry_after;
  }
  
  // Fallback: Parse aus Message
  if (err.message) {
    const match = err.message.match(/retry_after[=:]\s*(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  
  return null;
}

/**
 * Behandelt FloodWait-Fehler: Setzt Cooldown und gibt Info zurück
 */
export function handleFloodWait(error: unknown, chatId: string): { handled: boolean; retryAfter?: number } {
  if (!isFloodWaitError(error)) {
    return { handled: false };
  }
  
  const retryAfter = getRetryAfter(error);
  if (retryAfter) {
    // Setze Cooldown (retry_after + 10 Sekunden Buffer)
    setGroupCooldown(chatId, Math.ceil((retryAfter + 10) / 60));
    console.log(`[GUARD] FloodWait erkannt: chat=${chatId} retry_after=${retryAfter}s`);
    return { handled: true, retryAfter };
  }
  
  // Fallback: 1 Minute Cooldown
  setGroupCooldown(chatId, 1);
  return { handled: true, retryAfter: 60 };
}

// ============================================================================
// Action Statistics
// ============================================================================

/**
 * Holt Statistiken über Aktionen (für /status)
 */
export function getActionStats(): {
  actionsLastHour: number;
  actionsBlocked: number;
  activeCooldowns: number;
  rateLimitHits: number;
} {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  
  const actionsLastHour = actionHistory.filter(r => r.timestamp >= oneHourAgo).length;
  const activeCooldowns = Array.from(groupCooldowns.values()).filter(until => until > now).length;
  
  // TODO: Blocked actions tracking (wenn implementiert)
  const actionsBlocked = 0;
  const rateLimitHits = 0;
  
  return {
    actionsLastHour,
    actionsBlocked,
    activeCooldowns,
    rateLimitHits,
  };
}
