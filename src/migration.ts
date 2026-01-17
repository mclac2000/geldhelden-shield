/**
 * Migration: Profiliert alle bekannten Gruppen beim Start
 */

import { getAllGroups, getDatabase } from './db';
import { updateGroupProfileFromTitle } from './groupIntelligence';
import { startAdminSyncScheduler } from './adminSync';
import { Telegraf } from 'telegraf';

/**
 * Prüft ob eine Spalte in einer Tabelle existiert
 */
function columnExists(table: string, column: string): boolean {
  try {
    const db = getDatabase();
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === column);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[MIGRATION] Fehler beim Prüfen der Spalte ${table}.${column}:`, errorMessage);
    return false;
  }
}

/**
 * Defensive Migration: Stellt sicher, dass username-Spalte in users existiert
 */
export function ensureUsernameColumn(): void {
  try {
    const db = getDatabase();
    
    // Prüfe ob Spalte bereits existiert
    if (columnExists('users', 'username')) {
      return; // Spalte existiert bereits, nichts zu tun
    }
    
    // Spalte existiert nicht → füge sie hinzu
    db.exec('ALTER TABLE users ADD COLUMN username TEXT;');
    console.log('[MIGRATION] Spalte users.username hinzugefügt');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Idempotent: Wenn Spalte bereits existiert (duplicate column name), ist das OK
    if (errorMessage.includes('duplicate column name') || errorMessage.includes('already exists')) {
      // Spalte existiert bereits (Race Condition) - OK
      return;
    }
    // Andere Fehler loggen, aber nicht abbrechen
    console.warn('[MIGRATION] Fehler beim Hinzufügen der username-Spalte:', errorMessage);
  }
}

/**
 * Profiliert alle bekannten Gruppen
 */
export function profileAllGroups(): void {
  const allGroups = getAllGroups();
  console.log(`[MIGRATION] Profiliere ${allGroups.length} bekannte Gruppen...`);
  
  let profiled = 0;
  for (const group of allGroups) {
    try {
      updateGroupProfileFromTitle(String(group.chatId), group.title);
      profiled++;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[MIGRATION] Fehler beim Profilieren von ${group.chatId}:`, errorMessage);
    }
  }
  
  console.log(`[MIGRATION] ${profiled} Gruppen profiliert`);
}

/**
 * Führt Migration beim Start durch
 */
export function runStartupMigration(bot: Telegraf): void {
  console.log('[MIGRATION] Starte Startup-Migration...');
  
  // 1. Stelle sicher, dass username-Spalte existiert
  ensureUsernameColumn();
  
  // 2. Profiliere alle Gruppen
  profileAllGroups();
  
  // 3. Starte Admin-Sync (wird intern auch sofort ausgeführt)
  startAdminSyncScheduler(bot);
  
  console.log('[MIGRATION] Startup-Migration abgeschlossen');
}
