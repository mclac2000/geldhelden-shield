/**
 * Group Config Service Layer
 * 
 * Zentrale Service-Schicht für Gruppen-Konfiguration und Feature Flags.
 * Diese Funktionen sollen überall im Code verwendet werden (statt harter if-Checks).
 */

import {
  ensureGroupConfig,
  getGroupConfig,
  isFeatureEnabled as dbIsFeatureEnabled,
  FeatureName,
} from './db';

/**
 * Prüft ob eine Gruppe managed ist
 * 
 * @param chatId - Telegram Chat ID
 * @returns true wenn Gruppe managed ist, false sonst
 */
export function isGroupManaged(chatId: string): boolean {
  const config = getGroupConfig(chatId);
  
  // Wenn keine Config existiert, erstelle sie mit Defaults
  if (!config) {
    ensureGroupConfig(chatId, undefined);
    // Default: managed = true
    return true;
  }
  
  return config.managed;
}

/**
 * Prüft ob ein Feature für eine Gruppe aktiviert ist
 * 
 * @param chatId - Telegram Chat ID
 * @param featureName - Name des Features ('welcome' | 'cleanup' | 'links' | 'scam' | 'warns')
 * @returns true wenn Feature aktiviert ist, false sonst
 */
export function featureEnabled(chatId: string, featureName: FeatureName): boolean {
  // Stelle sicher, dass Config existiert
  ensureGroupConfig(chatId);
  
  // Verwende DB-Funktion
  return dbIsFeatureEnabled(chatId, featureName);
}

/**
 * Holt die vollständige Group Config
 * 
 * @param chatId - Telegram Chat ID
 * @returns GroupConfig oder null wenn nicht gefunden
 */
export function getConfig(chatId: string) {
  ensureGroupConfig(chatId);
  return getGroupConfig(chatId);
}
