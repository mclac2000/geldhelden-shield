/**
 * Log Health Service – Log Classifier
 *
 * Klassifiziert Log-Zeilen nach Severity und Kategorie.
 * Pattern-basiert, erweiterbar.
 */

import { ClassifiedLogEntry, Severity, LogCategory } from './types';

/**
 * Pattern-Definition für Log-Klassifizierung
 */
interface ClassificationPattern {
  pattern: RegExp;
  severity: Severity;
  category: LogCategory;
  prefix: string;
}

/**
 * Klassifizierungs-Patterns nach Priorität (erste Übereinstimmung gewinnt)
 */
const PATTERNS: ClassificationPattern[] = [
  // FATAL – höchste Priorität
  { pattern: /\[FATAL\]/, severity: 'fatal', category: 'general', prefix: '[FATAL]' },
  { pattern: /\[DB\]\[FATAL\]/, severity: 'fatal', category: 'db', prefix: '[DB][FATAL]' },
  { pattern: /\[CONFIG\]\[FATAL\]/, severity: 'fatal', category: 'startup', prefix: '[CONFIG][FATAL]' },

  // ERROR
  { pattern: /\[ERROR\]/, severity: 'error', category: 'general', prefix: '[ERROR]' },
  { pattern: /\[Shield\]\[ERROR\]/, severity: 'error', category: 'general', prefix: '[Shield][ERROR]' },
  { pattern: /\[DB\]\[ERROR\]/, severity: 'error', category: 'db', prefix: '[DB][ERROR]' },
  { pattern: /console\.error/, severity: 'error', category: 'general', prefix: 'console.error' },

  // WARN
  { pattern: /\[WARN\]/, severity: 'warn', category: 'general', prefix: '[WARN]' },
  { pattern: /\[DB\] Warnung/, severity: 'warn', category: 'db', prefix: '[DB] Warnung' },
  { pattern: /\[DB\] Migration Warnung/, severity: 'warn', category: 'db', prefix: '[DB] Migration Warnung' },

  // INFO – Kategorien
  { pattern: /\[STARTUP\]/, severity: 'info', category: 'startup', prefix: '[STARTUP]' },
  { pattern: /\[JOIN\]/, severity: 'info', category: 'join', prefix: '[JOIN]' },
  { pattern: /\[JOIN\]\[IGNORED\]/, severity: 'info', category: 'join', prefix: '[JOIN][IGNORED]' },
  { pattern: /\[JOIN\]\[LOGGED\]/, severity: 'info', category: 'join', prefix: '[JOIN][LOGGED]' },
  { pattern: /\[JOIN\]\[ACTION\]/, severity: 'info', category: 'join', prefix: '[JOIN][ACTION]' },
  { pattern: /\[RISK\]/, severity: 'info', category: 'risk', prefix: '[RISK]' },
  { pattern: /\[WELCOME\]/, severity: 'info', category: 'welcome', prefix: '[WELCOME]' },
  { pattern: /\[SCAM\]/, severity: 'info', category: 'scam', prefix: '[SCAM]' },
  { pattern: /\[MODERATION\]/, severity: 'info', category: 'moderation', prefix: '[MODERATION]' },
  { pattern: /\[ADMIN_SYNC\]/, severity: 'info', category: 'adminSync', prefix: '[ADMIN_SYNC]' },
  { pattern: /\[RATELIMIT\]/, severity: 'info', category: 'rateLimit', prefix: '[RATELIMIT]' },
  { pattern: /\[GROUP_PROFILE\]/, severity: 'info', category: 'general', prefix: '[GROUP_PROFILE]' },
  { pattern: /\[GROUP_INTELLIGENCE\]/, severity: 'info', category: 'general', prefix: '[GROUP_INTELLIGENCE]' },
  { pattern: /\[CONFIG\]/, severity: 'info', category: 'startup', prefix: '[CONFIG]' },

  // DEBUG – DB-Operationen
  { pattern: /\[DB\] operation=/, severity: 'debug', category: 'db', prefix: '[DB] operation=' },
  { pattern: /\[DB\] ensure/, severity: 'debug', category: 'db', prefix: '[DB] ensure' },
  { pattern: /\[DB\] join recorded/, severity: 'debug', category: 'db', prefix: '[DB] join recorded' },
  { pattern: /\[DB\] Schema-Version/, severity: 'debug', category: 'db', prefix: '[DB] Schema-Version' },
];

/**
 * Extrahiert Timestamp aus Docker Log-Zeile
 * Format: 2026-01-17T08:30:15.123456789Z
 */
function extractTimestamp(line: string): Date | null {
  // Docker JSON-Log Format: beginnt oft mit ISO-Timestamp
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/);
  if (isoMatch) {
    const parsed = new Date(isoMatch[1]);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // Fallback: Aktueller Zeitstempel
  return null;
}

/**
 * Klassifiziert eine einzelne Log-Zeile
 *
 * @param line - Rohe Log-Zeile
 * @returns ClassifiedLogEntry oder null wenn nicht klassifizierbar
 */
export function classifyLine(line: string): ClassifiedLogEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Timestamp extrahieren
  const timestamp = extractTimestamp(trimmed) || new Date();

  // Pattern-Matching
  for (const { pattern, severity, category, prefix } of PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        timestamp,
        severity,
        category,
        prefix,
        message: trimmed,
        raw: line,
      };
    }
  }

  // Fallback: Unklassifiziert als INFO/general
  return {
    timestamp,
    severity: 'info',
    category: 'general',
    prefix: '',
    message: trimmed,
    raw: line,
  };
}

/**
 * Klassifiziert alle Log-Zeilen
 *
 * @param lines - Array von rohen Log-Zeilen
 * @returns Array von klassifizierten Einträgen
 */
export function classifyLogs(lines: string[]): ClassifiedLogEntry[] {
  const classified: ClassifiedLogEntry[] = [];

  for (const line of lines) {
    const entry = classifyLine(line);
    if (entry !== null) {
      classified.push(entry);
    }
  }

  console.log(`[CLASSIFIER] ${classified.length} Zeilen klassifiziert`);
  console.log(`[CLASSIFIER] Severity-Verteilung: fatal=${classified.filter(e => e.severity === 'fatal').length}, error=${classified.filter(e => e.severity === 'error').length}, warn=${classified.filter(e => e.severity === 'warn').length}, info=${classified.filter(e => e.severity === 'info').length}, debug=${classified.filter(e => e.severity === 'debug').length}`);

  return classified;
}

/**
 * Filtert Logs nach Severity
 *
 * @param entries - Klassifizierte Einträge
 * @param minSeverity - Minimale Severity (inclusive)
 * @returns Gefilterte Einträge
 */
export function filterBySeverity(
  entries: ClassifiedLogEntry[],
  minSeverity: Severity
): ClassifiedLogEntry[] {
  const severityOrder: Record<Severity, number> = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  };

  const minLevel = severityOrder[minSeverity];
  return entries.filter((entry) => severityOrder[entry.severity] <= minLevel);
}
