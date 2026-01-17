/**
 * Log Health Service – Type Definitions
 *
 * Strikte Typisierung, keine `as any` oder Type-Casts.
 * Domain-Style: camelCase
 */

/**
 * Severity Level für Log-Einträge
 */
export type Severity = 'fatal' | 'error' | 'warn' | 'info' | 'debug';

/**
 * Bekannte Log-Kategorien basierend auf Prefixes
 */
export type LogCategory =
  | 'startup'
  | 'db'
  | 'join'
  | 'risk'
  | 'welcome'
  | 'scam'
  | 'moderation'
  | 'admin'
  | 'adminSync'
  | 'rateLimit'
  | 'general';

/**
 * Ein einzelner klassifizierter Log-Eintrag
 */
export interface ClassifiedLogEntry {
  timestamp: Date;
  severity: Severity;
  category: LogCategory;
  prefix: string;
  message: string;
  raw: string;
}

/**
 * Aggregierter Fehler-Bucket
 */
export interface ErrorBucket {
  pattern: string;
  severity: Severity;
  category: LogCategory;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  samples: string[];
}

/**
 * Health-Status des Systems
 */
export type HealthStatus = 'healthy' | 'warnings' | 'critical';

/**
 * Metriken aus den Logs
 */
export interface LogMetrics {
  totalLines: number;
  joinsProcessed: number;
  bansExecuted: number;
  restrictsExecuted: number;
  welcomesSent: number;
  welcomesSkipped: number;
  dbOperations: number;
  startupEvents: number;
}

/**
 * Zusammenfassung für den Health-Report
 */
export interface HealthSummary {
  status: HealthStatus;
  periodStart: Date;
  periodEnd: Date;
  metrics: LogMetrics;
  fatalErrors: ErrorBucket[];
  errors: ErrorBucket[];
  warnings: ErrorBucket[];
}

/**
 * Konfiguration für den Monitor
 */
export interface MonitorConfig {
  monitorBotToken: string;
  adminLogChat: string;
  containerName: string;
  logWindowHours: number;
  reportSchedule: string;
}
