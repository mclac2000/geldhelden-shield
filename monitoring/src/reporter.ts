/**
 * Log Health Service – Health Report Generator
 *
 * Erstellt einen Markdown-formatierten Health-Report.
 * Optimiert für LLM-Konsum (Log-Health-GPT, Repair-GPT).
 */

import { HealthSummary, HealthStatus, ErrorBucket, LogMetrics, ClassifiedLogEntry } from './types';
import { extractMetrics, aggregateBySeverity, countRestarts } from './aggregator';
import { config } from './config';

/**
 * Bestimmt den Gesamt-Health-Status
 */
function determineStatus(
  fatalCount: number,
  errorCount: number,
  warnCount: number
): HealthStatus {
  if (fatalCount > 0) {
    return 'critical';
  }
  if (errorCount > 5) {
    return 'critical';
  }
  if (errorCount > 0 || warnCount > 10) {
    return 'warnings';
  }
  return 'healthy';
}

/**
 * Formatiert ein Datum für den Report
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Formatiert eine Zeitspanne
 */
function formatTime(date: Date): string {
  return date.toISOString().split('T')[1].split('.')[0];
}

/**
 * Status-Emoji basierend auf Health-Status
 */
function statusEmoji(status: HealthStatus): string {
  switch (status) {
    case 'healthy':
      return '🟢';
    case 'warnings':
      return '🟡';
    case 'critical':
      return '🔴';
  }
}

/**
 * Erstellt eine Health-Summary aus klassifizierten Logs
 *
 * @param entries - Klassifizierte Log-Einträge
 * @returns HealthSummary Objekt
 */
export function createHealthSummary(entries: ClassifiedLogEntry[]): HealthSummary {
  const metrics = extractMetrics(entries);
  const fatalErrors = aggregateBySeverity(entries, 'fatal');
  const errors = aggregateBySeverity(entries, 'error');
  const warnings = aggregateBySeverity(entries, 'warn');

  const fatalCount = fatalErrors.reduce((sum, b) => sum + b.count, 0);
  const errorCount = errors.reduce((sum, b) => sum + b.count, 0);
  const warnCount = warnings.reduce((sum, b) => sum + b.count, 0);

  const status = determineStatus(fatalCount, errorCount, warnCount);

  // Zeitraum aus Entries
  const timestamps = entries.map((e) => e.timestamp.getTime());
  const periodStart = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date();
  const periodEnd = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();

  return {
    status,
    periodStart,
    periodEnd,
    metrics,
    fatalErrors,
    errors,
    warnings,
  };
}

/**
 * Formatiert einen Error-Bucket für den Report
 */
function formatBucket(bucket: ErrorBucket): string {
  const countStr = bucket.count > 1 ? ` (${bucket.count}×)` : '';
  // Kürze das Pattern auf max 80 Zeichen
  const pattern = bucket.pattern.length > 80
    ? bucket.pattern.substring(0, 77) + '...'
    : bucket.pattern;
  return `• ${pattern}${countStr}`;
}

/**
 * Generiert den Markdown Health-Report
 *
 * @param summary - Health-Summary
 * @returns Markdown-formatierter Report-String
 */
export function generateReport(summary: HealthSummary): string {
  const lines: string[] = [];

  // Header
  lines.push(`🩺 **Shield Health Report** – ${formatDate(summary.periodEnd)}`);
  lines.push('');

  // Status
  const statusText = summary.status.toUpperCase();
  lines.push(`## Status: ${statusEmoji(summary.status)} ${statusText}`);
  lines.push('');

  // Zeitraum
  lines.push(`📅 Zeitraum: ${formatTime(summary.periodStart)} – ${formatTime(summary.periodEnd)} (${config.logWindowHours}h)`);
  lines.push('');

  // Zusammenfassung
  lines.push('### 📊 Zusammenfassung');
  lines.push(`• Joins verarbeitet: ${summary.metrics.joinsProcessed}`);
  lines.push(`• Bans ausgeführt: ${summary.metrics.bansExecuted}`);
  lines.push(`• Restricts: ${summary.metrics.restrictsExecuted}`);
  lines.push(`• Welcome gesendet: ${summary.metrics.welcomesSent}`);
  lines.push(`• Welcome übersprungen: ${summary.metrics.welcomesSkipped}`);
  lines.push(`• DB-Operationen: ${summary.metrics.dbOperations}`);
  lines.push(`• Log-Zeilen gesamt: ${summary.metrics.totalLines}`);
  lines.push('');

  // Restarts
  const restarts = summary.metrics.startupEvents;
  if (restarts > 1) {
    lines.push(`⚠️ **Restarts erkannt:** ${restarts}`);
    lines.push('');
  }

  // Fatal Errors
  if (summary.fatalErrors.length > 0) {
    const totalFatal = summary.fatalErrors.reduce((sum, b) => sum + b.count, 0);
    lines.push(`### 💀 FATAL (${totalFatal})`);
    for (const bucket of summary.fatalErrors.slice(0, 5)) {
      lines.push(formatBucket(bucket));
    }
    lines.push('');
  }

  // Errors
  if (summary.errors.length > 0) {
    const totalErrors = summary.errors.reduce((sum, b) => sum + b.count, 0);
    lines.push(`### ❌ Fehler (${totalErrors})`);
    for (const bucket of summary.errors.slice(0, 10)) {
      lines.push(formatBucket(bucket));
    }
    lines.push('');
  } else {
    lines.push('### ❌ Fehler (0)');
    lines.push('_Keine Fehler in den letzten 24h._');
    lines.push('');
  }

  // Warnings
  if (summary.warnings.length > 0) {
    const totalWarnings = summary.warnings.reduce((sum, b) => sum + b.count, 0);
    lines.push(`### ⚠️ Warnungen (${totalWarnings})`);
    for (const bucket of summary.warnings.slice(0, 10)) {
      lines.push(formatBucket(bucket));
    }
    lines.push('');
  }

  // Footer für GPT-Agenten
  lines.push('---');
  lines.push('_Report generiert von Shield Monitor v1.0_');
  lines.push('_Optimiert für Log-Health-GPT & Repair-GPT_');

  return lines.join('\n');
}

/**
 * Generiert einen kurzen Status-Report (für schnelle Checks)
 *
 * @param summary - Health-Summary
 * @returns Kurzer Status-String
 */
export function generateShortStatus(summary: HealthSummary): string {
  const fatalCount = summary.fatalErrors.reduce((sum, b) => sum + b.count, 0);
  const errorCount = summary.errors.reduce((sum, b) => sum + b.count, 0);
  const warnCount = summary.warnings.reduce((sum, b) => sum + b.count, 0);

  return `${statusEmoji(summary.status)} Shield Status: ${summary.metrics.joinsProcessed} joins, ${fatalCount} fatal, ${errorCount} errors, ${warnCount} warnings`;
}
