/**
 * Log Health Service – Error Aggregator
 *
 * Gruppiert und dedupliziert Fehler für den Report.
 * Anonymisiert sensible Daten.
 */

import { ClassifiedLogEntry, ErrorBucket, LogMetrics, Severity } from './types';

/**
 * Maximale Samples pro Bucket
 */
const MAX_SAMPLES = 3;

/**
 * Anonymisiert User-IDs und Chat-IDs in einer Nachricht
 * user=1234567 → user=XXX
 * chat=-1001234567 → chat=XXX
 */
function anonymize(message: string): string {
  return message
    .replace(/user=\d+/g, 'user=XXX')
    .replace(/chat=-?\d+/g, 'chat=XXX')
    .replace(/User \d+/g, 'User XXX')
    .replace(/Chat -?\d+/g, 'Chat XXX');
}

/**
 * Erstellt einen Pattern-Key für Gruppierung
 * Entfernt variable Teile wie IDs, Timestamps
 */
function createPatternKey(entry: ClassifiedLogEntry): string {
  let pattern = entry.message;

  // Anonymisiere
  pattern = anonymize(pattern);

  // Entferne Timestamps am Anfang
  pattern = pattern.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, '');

  // Entferne numerische IDs
  pattern = pattern.replace(/\d{5,}/g, 'N');

  // Normalisiere Whitespace
  pattern = pattern.replace(/\s+/g, ' ').trim();

  return pattern;
}

/**
 * Aggregiert klassifizierte Log-Einträge nach Severity
 *
 * @param entries - Klassifizierte Log-Einträge
 * @param severity - Zu aggregierende Severity
 * @returns Array von Error-Buckets
 */
export function aggregateBySeverity(
  entries: ClassifiedLogEntry[],
  severity: Severity
): ErrorBucket[] {
  const filtered = entries.filter((e) => e.severity === severity);
  const buckets = new Map<string, ErrorBucket>();

  for (const entry of filtered) {
    const key = createPatternKey(entry);

    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      if (entry.timestamp > existing.lastSeen) {
        existing.lastSeen = entry.timestamp;
      }
      if (entry.timestamp < existing.firstSeen) {
        existing.firstSeen = entry.timestamp;
      }
      if (existing.samples.length < MAX_SAMPLES) {
        existing.samples.push(entry.message);
      }
    } else {
      buckets.set(key, {
        pattern: key,
        severity,
        category: entry.category,
        count: 1,
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
        samples: [entry.message],
      });
    }
  }

  // Sortiere nach Count (absteigend)
  return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
}

/**
 * Extrahiert Metriken aus den klassifizierten Logs
 *
 * @param entries - Klassifizierte Log-Einträge
 * @returns LogMetrics Objekt
 */
export function extractMetrics(entries: ClassifiedLogEntry[]): LogMetrics {
  let joinsProcessed = 0;
  let bansExecuted = 0;
  let restrictsExecuted = 0;
  let welcomesSent = 0;
  let welcomesSkipped = 0;
  let dbOperations = 0;
  let startupEvents = 0;

  for (const entry of entries) {
    const msg = entry.message;

    // Joins
    if (entry.category === 'join') {
      joinsProcessed++;
    }

    // Bans & Restricts
    if (msg.includes('action=ban')) {
      bansExecuted++;
    }
    if (msg.includes('action=restrict')) {
      restrictsExecuted++;
    }

    // Welcome
    if (entry.prefix === '[WELCOME][SENT]' || msg.includes('Begrüßung gesendet')) {
      welcomesSent++;
    }
    if (entry.prefix === '[WELCOME][SKIP]') {
      welcomesSkipped++;
    }

    // DB
    if (entry.category === 'db') {
      dbOperations++;
    }

    // Startup
    if (entry.category === 'startup') {
      startupEvents++;
    }
  }

  return {
    totalLines: entries.length,
    joinsProcessed,
    bansExecuted,
    restrictsExecuted,
    welcomesSent,
    welcomesSkipped,
    dbOperations,
    startupEvents,
  };
}

/**
 * Prüft ob ein Restart stattgefunden hat
 *
 * @param entries - Klassifizierte Log-Einträge
 * @returns Anzahl der Restarts
 */
export function countRestarts(entries: ClassifiedLogEntry[]): number {
  return entries.filter(
    (e) => e.message.includes('GELDHELDEN SHIELD – Bot gestartet') ||
           e.message.includes('[STARTUP] Startup-Checks erfolgreich')
  ).length;
}

/**
 * Findet die häufigsten Fehler-Muster
 *
 * @param entries - Klassifizierte Log-Einträge
 * @param limit - Maximale Anzahl zurückzugebender Patterns
 * @returns Die häufigsten Error-Buckets
 */
export function getTopErrors(entries: ClassifiedLogEntry[], limit: number = 10): ErrorBucket[] {
  const errors = aggregateBySeverity(entries, 'error');
  const fatals = aggregateBySeverity(entries, 'fatal');

  // Kombiniere und sortiere
  const combined = [...fatals, ...errors];
  combined.sort((a, b) => b.count - a.count);

  return combined.slice(0, limit);
}

/**
 * Findet die häufigsten Warnungen
 *
 * @param entries - Klassifizierte Log-Einträge
 * @param limit - Maximale Anzahl zurückzugebender Patterns
 * @returns Die häufigsten Warning-Buckets
 */
export function getTopWarnings(entries: ClassifiedLogEntry[], limit: number = 10): ErrorBucket[] {
  const warnings = aggregateBySeverity(entries, 'warn');
  return warnings.slice(0, limit);
}
