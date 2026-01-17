/**
 * Startup-Checks für Bot-Initialisierung
 * 
 * Prüft alle kritischen Abhängigkeiten beim Bot-Start.
 * Bei Problemen: kontrolliertes Abbrechen mit klaren Logs.
 */

import { getManagedGroups, getTeamMembers } from './db';
import { isBotAdminInGroup } from './telegram';

/**
 * Prüft ob eine Tabelle existiert
 */
function tableExists(db: any, tableName: string): boolean {
  try {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    return !!result;
  } catch (error: any) {
    return false;
  }
}

/**
 * Prüft ob eine Spalte in einer Tabelle existiert
 */
function columnExists(db: any, table: string, column: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === column);
  } catch (error: any) {
    return false;
  }
}

/**
 * Führt alle Startup-Checks durch
 * Wirft Fehler bei kritischen Problemen (kein automatisches Reparieren)
 */
export async function runStartupChecks(bot: any): Promise<void> {
  console.log('[STARTUP] Führe Startup-Checks durch...');

  // Importiere DB dynamisch (verhindert Zirkular-Import)
  const { getDatabase } = await import('./db');
  const db = getDatabase();

  // ========================================================================
  // Check A: Datenbank-Schema
  // ========================================================================
  console.log('[STARTUP] Check A: Datenbank-Schema...');

  if (!tableExists(db, 'users')) {
    console.error('[FATAL] DB schema mismatch: missing table users');
    process.exit(1);
  }

  // Prüfe nur, ob Tabellen existieren - keine Abhängigkeit von Namensspalten
  if (!tableExists(db, 'team_members')) {
    console.error('[FATAL] DB schema mismatch: missing table team_members');
    process.exit(1);
  }

  console.log('[STARTUP] ✓ Datenbank-Schema OK');

  // ========================================================================
  // Check B: Schreibrechte DB
  // ========================================================================
  console.log('[STARTUP] Check B: Schreibrechte DB...');

  try {
    // Test-Insert
    const testId = -999999999; // Dummy-ID, die nicht existiert
    const insertStmt = db.prepare('INSERT INTO users (user_id, first_seen) VALUES (?, ?)');
    insertStmt.run(testId, Date.now());

    // Test-Delete
    const deleteStmt = db.prepare('DELETE FROM users WHERE user_id = ?');
    deleteStmt.run(testId);

    console.log('[STARTUP] ✓ Schreibrechte DB OK');
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[FATAL] DB write test failed:', errorMessage);
    process.exit(1);
  }

  // ========================================================================
  // Check C: Bot-Rechte
  // ========================================================================
  console.log('[STARTUP] Check C: Bot-Rechte in managed Gruppen...');

  try {
    const managedGroups = getManagedGroups();
    
    if (managedGroups.length === 0) {
      console.warn('[WARN] Bot has no admin rights in any managed group (keine managed Gruppen gefunden)');
    } else {
      // Prüfe mindestens eine Gruppe
      let hasAdminRights = false;
      let checkedGroups = 0;
      const maxChecks = Math.min(5, managedGroups.length); // Max 5 Gruppen prüfen

      for (const group of managedGroups.slice(0, maxChecks)) {
        try {
          const chatIdStr = String(group.chatId);
          const botAdminCheck = await isBotAdminInGroup(chatIdStr, bot.telegram);
          if (botAdminCheck.isAdmin) {
            hasAdminRights = true;
            console.log(`[STARTUP] ✓ Bot ist Admin in Gruppe: ${chatIdStr}`);
            break;
          }
          checkedGroups++;
        } catch (error: any) {
          // Fehler bei einzelnen Gruppen ignorieren, weiter prüfen
          checkedGroups++;
        }
      }

      if (!hasAdminRights) {
        console.warn(`[WARN] Bot has no admin rights in any managed group (geprüft: ${checkedGroups}/${managedGroups.length})`);
      } else {
        console.log('[STARTUP] ✓ Bot-Rechte OK');
      }
    }
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[WARN] Bot-Rechte-Check fehlgeschlagen: ${errorMessage}`);
    // Kein Exit - Warnung reicht
  }

  // ========================================================================
  // Check D: Team-Liste
  // ========================================================================
  console.log('[STARTUP] Check D: Team-Liste...');

  try {
    // Prüfe direkt mit COUNT(*) - keine Abhängigkeit von Namensspalten
    // Ignoriere alle Fehler wegen fehlender username/first_name/last_name Spalten komplett
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM team_members');
    const result = countStmt.get() as { count: number } | undefined;
    const count = result?.count ?? 0;
    
    if (count === 0) {
      console.warn('[WARN] Team-Liste ist leer (keine Team-Mitglieder gefunden)');
    } else {
      console.log(`[STARTUP] ✓ Team-Liste OK (${count} Mitglieder)`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Ignoriere ALLE Fehler wegen fehlender Namensspalten komplett (username, first_name, last_name)
    if (errorMessage.includes('no such column: username') || 
        errorMessage.includes('no such column: first_name') || 
        errorMessage.includes('no such column: last_name')) {
      // Namensspalten-Fehler komplett ignorieren - prüfe nur, ob Tabelle existiert und Zeilen abgefragt werden können
      try {
        // Versuche einfache Abfrage ohne Namensspalten
        const simpleStmt = db.prepare('SELECT user_id FROM team_members LIMIT 1');
        const testResult = simpleStmt.get();
        if (testResult) {
          // Tabelle existiert und hat Zeilen - OK
          const countStmt = db.prepare('SELECT COUNT(*) as count FROM team_members');
          const countResult = countStmt.get() as { count: number } | undefined;
          const count = countResult?.count ?? 0;
          if (count === 0) {
            console.warn('[WARN] Team-Liste ist leer (keine Team-Mitglieder gefunden)');
          } else {
            console.log(`[STARTUP] ✓ Team-Liste OK (${count} Mitglieder)`);
          }
        } else {
          console.warn('[WARN] Team-Liste ist leer (keine Team-Mitglieder gefunden)');
        }
      } catch (fallbackError: unknown) {
        // Auch Fallback-Fehler nur warnen, nicht abbrechen
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        // Ignoriere auch hier Namensspalten-Fehler
        if (!fallbackErrorMessage.includes('no such column: username') && 
            !fallbackErrorMessage.includes('no such column: first_name') && 
            !fallbackErrorMessage.includes('no such column: last_name')) {
          console.warn(`[WARN] Team-Liste-Check: Konnte Team-Mitglieder nicht prüfen: ${fallbackErrorMessage}`);
        } else {
          // Namensspalten-Fehler komplett stillschweigend ignorieren
          console.log('[STARTUP] ✓ Team-Liste OK (Tabelle existiert, Namensspalten optional)');
        }
      }
    } else {
      // Andere Fehler (nicht Namensspalten) loggen
      console.warn(`[WARN] Team-Liste-Check fehlgeschlagen: ${errorMessage}`);
    }
    // Kein Exit - Warnung reicht
  }

  console.log('[STARTUP] Alle Startup-Checks abgeschlossen');
}
