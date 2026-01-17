/**
 * Log Health Service – Configuration
 *
 * Lädt Konfiguration aus Environment-Variablen.
 * Fail-safe: Defaults wo möglich.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { MonitorConfig } from './types';

// Lade .env aus monitoring/ Verzeichnis
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Validiert und lädt die Konfiguration
 * Wirft Fehler bei fehlenden kritischen Werten
 */
function loadConfig(): MonitorConfig {
  const monitorBotToken = process.env.MONITOR_BOT_TOKEN;
  const adminLogChat = process.env.ADMIN_LOG_CHAT;
  const containerName = process.env.CONTAINER_NAME || 'geldhelden-shield-bot';
  const logWindowHours = parseInt(process.env.LOG_WINDOW_HOURS || '24', 10);
  const reportSchedule = process.env.REPORT_SCHEDULE || '0 8 * * *';

  // Kritische Validierung
  if (!monitorBotToken) {
    console.error('[CONFIG][FATAL] MONITOR_BOT_TOKEN nicht gesetzt');
    process.exit(1);
  }

  if (!adminLogChat) {
    console.error('[CONFIG][FATAL] ADMIN_LOG_CHAT nicht gesetzt');
    process.exit(1);
  }

  // Validiere logWindowHours
  const validLogWindowHours = Number.isNaN(logWindowHours) || logWindowHours < 1
    ? 24
    : logWindowHours;

  return {
    monitorBotToken,
    adminLogChat,
    containerName,
    logWindowHours: validLogWindowHours,
    reportSchedule,
  };
}

export const config = loadConfig();

// Startup-Logging
console.log('[CONFIG] Monitor-Konfiguration geladen:');
console.log(`  Container: ${config.containerName}`);
console.log(`  Log-Fenster: ${config.logWindowHours}h`);
console.log(`  Schedule: ${config.reportSchedule}`);
console.log(`  Target Chat: ${config.adminLogChat}`);
