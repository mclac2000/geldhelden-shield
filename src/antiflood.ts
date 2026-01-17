/**
 * Anti-Flood Moderation
 * 
 * Leichte Anti-Flood-Erkennung (nur Restrict, kein Kick/Ban)
 */

import { Context } from 'telegraf';
import { getGroupConfig, isTeamMember } from './db';
import { featureEnabled } from './groupConfig';
import { restrictUser } from './telegram';
import { config } from './config';

// Flood Tracking (in-memory)
interface FloodEntry {
  timestamps: number[];
  restricted: boolean;
}

const floodTracking = new Map<string, FloodEntry>(); // Key: `${chatId}:${userId}`

// Cleanup alte Einträge (alle 5 Minuten)
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 Stunde
  
  for (const [key, entry] of floodTracking.entries()) {
    // Entferne alte Timestamps
    entry.timestamps = entry.timestamps.filter(ts => now - ts < maxAge);
    
    // Entferne Eintrag wenn leer
    if (entry.timestamps.length === 0 && !entry.restricted) {
      floodTracking.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Prüft und moderiert Flood-Verhalten
 */
export async function moderateAntiFlood(ctx: Context): Promise<boolean> {
  const message = ctx.message || ctx.editedMessage;
  if (!message) {
    return false;
  }
  
  const chatId = message.chat.id.toString();
  const userId = message.from?.id;
  
  if (!userId) {
    return false;
  }
  
  // Team/Admin Safety
  if (isTeamMember(userId) || config.adminIds.includes(userId)) {
    return false; // Skip
  }
  
  const groupConfig = getGroupConfig(chatId);
  if (!groupConfig || !groupConfig.antiflood_enabled) {
    return false;
  }
  
  const key = `${chatId}:${userId}`;
  const now = Date.now();
  
  // Hole oder erstelle Flood-Entry
  let entry = floodTracking.get(key);
  if (!entry) {
    entry = { timestamps: [], restricted: false };
    floodTracking.set(key, entry);
  }
  
  // Wenn bereits restricted, skip
  if (entry.restricted) {
    return false;
  }
  
  // Füge aktuellen Timestamp hinzu
  entry.timestamps.push(now);
  
  // Prüfe Flood-Threshold
  const windowMs = groupConfig.antiflood_window_seconds * 1000;
  const maxMessages = groupConfig.antiflood_max_messages;
  
  // Filtere Timestamps innerhalb des Fensters
  const recentTimestamps = entry.timestamps.filter(ts => now - ts < windowMs);
  entry.timestamps = recentTimestamps; // Update für nächste Prüfung
  
  if (recentTimestamps.length >= maxMessages) {
    // Flood erkannt - Restrict User
    try {
      const restrictMinutes = groupConfig.antiflood_restrict_minutes;
      const result = await restrictUser(chatId, userId, `Anti-Flood: ${recentTimestamps.length} Nachrichten in ${groupConfig.antiflood_window_seconds}s`);
      
      if (result.success) {
        entry.restricted = true;
        console.log(`[ANTIFLOOD] User restricted: user=${userId} chat=${chatId} messages=${recentTimestamps.length} window=${groupConfig.antiflood_window_seconds}s`);
        
        // Entferne Restriction-Flag nach restrict_minutes
        setTimeout(() => {
          const currentEntry = floodTracking.get(key);
          if (currentEntry) {
            currentEntry.restricted = false;
          }
        }, restrictMinutes * 60 * 1000);
        
        return true;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[ANTIFLOOD] Fehler beim Restrict: chat=${chatId} user=${userId}`, errorMessage);
    }
  }
  
  return false;
}
