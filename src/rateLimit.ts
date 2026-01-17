/**
 * Rate Limits & Cooldowns
 * 
 * Verhindert Doppelaktionen und Spam durch in-memory Cooldowns.
 * Rein im Speicher, pro Prozess, nicht persistent.
 */

export type CooldownKey = string;

// Cooldown Storage (in-memory)
const cooldowns = new Map<CooldownKey, number>();

/**
 * Prüft ob ein Cooldown aktiv ist
 * 
 * @param key - Cooldown-Key (z.B. "user:12345:scam" oder "usergroup:12345:-100987654:ban")
 * @param windowMs - Cooldown-Fenster in Millisekunden
 * @returns true wenn Cooldown aktiv ist, false sonst
 */
export function isCooldownActive(
  key: CooldownKey,
  windowMs: number
): boolean {
  const now = Date.now();
  const last = cooldowns.get(key);
  if (!last) {
    return false;
  }
  return now - last < windowMs;
}

/**
 * Setzt einen Cooldown (aktualisiert Timestamp)
 * 
 * @param key - Cooldown-Key
 */
export function touchCooldown(key: CooldownKey): void {
  cooldowns.set(key, Date.now());
}

/**
 * Entfernt einen Cooldown explizit
 * 
 * @param key - Cooldown-Key
 */
export function clearCooldown(key: CooldownKey): void {
  cooldowns.delete(key);
}

/**
 * Räumt alte Cooldowns auf (älter als maxAgeMs)
 * 
 * @param maxAgeMs - Maximale Alter in Millisekunden (default: 1 Stunde)
 */
export function clearOldCooldowns(maxAgeMs: number = 60 * 60 * 1000): void {
  const now = Date.now();
  let cleared = 0;
  
  for (const [key, ts] of cooldowns.entries()) {
    if (now - ts > maxAgeMs) {
      cooldowns.delete(key);
      cleared++;
    }
  }
  
  if (cleared > 0) {
    console.log(`[RATELIMIT] Cleaned up ${cleared} old cooldowns`);
  }
}

/**
 * Holt Cooldown-Statistiken (für Debugging/Monitoring)
 */
export function getCooldownStats(): {
  total: number;
  oldest: number | null;
  newest: number | null;
} {
  if (cooldowns.size === 0) {
    return { total: 0, oldest: null, newest: null };
  }
  
  const timestamps = Array.from(cooldowns.values());
  const oldest = Math.min(...timestamps);
  const newest = Math.max(...timestamps);
  
  return {
    total: cooldowns.size,
    oldest,
    newest,
  };
}

// ============================================================================
// Cooldown-Key Generatoren (Standardisierung)
// ============================================================================

/**
 * Erzeugt einen User-Cooldown-Key
 * 
 * @param userId - Telegram User ID
 * @param action - Aktion (z.B. "scam", "ban", "warn")
 * @returns Cooldown-Key
 */
export function userCooldownKey(userId: number, action: string): CooldownKey {
  return `user:${userId}:${action}`;
}

/**
 * Erzeugt einen Group-Cooldown-Key
 * 
 * @param chatId - Telegram Chat ID
 * @param action - Aktion (z.B. "welcome", "scan", "cleanup")
 * @returns Cooldown-Key
 */
export function groupCooldownKey(chatId: string, action: string): CooldownKey {
  return `group:${chatId}:${action}`;
}

/**
 * Erzeugt einen User-Group-Cooldown-Key (für gruppenspezifische User-Aktionen)
 * 
 * @param userId - Telegram User ID
 * @param chatId - Telegram Chat ID
 * @param action - Aktion (z.B. "scam", "ban", "restrict")
 * @returns Cooldown-Key
 */
export function userGroupCooldownKey(
  userId: number,
  chatId: string,
  action: string
): CooldownKey {
  return `usergroup:${userId}:${chatId}:${action}`;
}
