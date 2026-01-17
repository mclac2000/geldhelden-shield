/**
 * Log Health Service – Main Entry Point
 *
 * Eigenständiger Monitoring-Service für Geldhelden Shield.
 * Läuft als separater Container, nur Read-Zugriff auf Logs.
 */

import * as cron from 'node-cron';
import { config } from './config';
import { collectLogs, checkDockerAvailable, checkContainerRunning } from './collector';
import { classifyLogs } from './classifier';
import { createHealthSummary } from './reporter';
import { generateReport, generateShortStatus } from './reporter';
import { sendLongMessage, validateBotToken } from './telegram';

/**
 * Führt einen vollständigen Health-Check-Zyklus durch
 */
async function runHealthCheck(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🩺 Shield Monitor – Health Check gestartet');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📅 Zeitpunkt: ${new Date().toISOString()}`);
  console.log('');

  // 1. Docker-Verfügbarkeit prüfen
  const dockerAvailable = await checkDockerAvailable();
  if (!dockerAvailable) {
    console.error('[MONITOR][ERROR] Docker nicht verfügbar – Abbruch');
    await sendLongMessage('🔴 **Shield Monitor Error**\n\nDocker nicht verfügbar. Health-Check abgebrochen.');
    return;
  }

  // 2. Container-Status prüfen
  const containerRunning = await checkContainerRunning();
  if (!containerRunning) {
    console.error(`[MONITOR][ERROR] Container ${config.containerName} läuft nicht`);
    await sendLongMessage(`🔴 **Shield Monitor Alert**\n\nContainer \`${config.containerName}\` läuft nicht!`);
    return;
  }

  // 3. Logs sammeln
  const collectorResult = await collectLogs();
  if (!collectorResult.success) {
    console.error(`[MONITOR][ERROR] Log-Sammlung fehlgeschlagen: ${collectorResult.error}`);
    await sendLongMessage(`🔴 **Shield Monitor Error**\n\nLog-Sammlung fehlgeschlagen:\n\`${collectorResult.error}\``);
    return;
  }

  if (collectorResult.lines.length === 0) {
    console.warn('[MONITOR][WARN] Keine Logs gefunden');
    await sendLongMessage('🟡 **Shield Monitor Warning**\n\nKeine Logs im konfigurierten Zeitfenster gefunden.');
    return;
  }

  // 4. Logs klassifizieren
  const classified = classifyLogs(collectorResult.lines);

  // 5. Health-Summary erstellen
  const summary = createHealthSummary(classified);

  // 6. Report generieren
  const report = generateReport(summary);
  const shortStatus = generateShortStatus(summary);

  console.log('');
  console.log('[MONITOR] Report erstellt:');
  console.log(shortStatus);
  console.log('');

  // 7. Report senden
  const sendResults = await sendLongMessage(report);
  const allSuccess = sendResults.every((r) => r.success);

  if (allSuccess) {
    console.log('[MONITOR] ✓ Health-Check abgeschlossen und Report gesendet');
  } else {
    console.error('[MONITOR][ERROR] Report konnte nicht vollständig gesendet werden');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

/**
 * Startup-Validierung
 */
async function validateStartup(): Promise<boolean> {
  console.log('[MONITOR] Validiere Konfiguration...');

  // Bot-Token validieren
  const tokenValid = await validateBotToken();
  if (!tokenValid) {
    console.error('[MONITOR][FATAL] Bot-Token ungültig – Abbruch');
    return false;
  }

  // Docker prüfen
  const dockerAvailable = await checkDockerAvailable();
  if (!dockerAvailable) {
    console.error('[MONITOR][FATAL] Docker nicht verfügbar – Abbruch');
    return false;
  }

  console.log('[MONITOR] ✓ Validierung erfolgreich');
  return true;
}

/**
 * Main Entry Point
 */
async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🩺 SHIELD MONITOR – Service gestartet');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📅 Startzeit: ${new Date().toISOString()}`);
  console.log('');

  // Prüfe ob --once Flag gesetzt (einmaliger Report)
  const runOnce = process.argv.includes('--once');

  // Startup-Validierung
  const valid = await validateStartup();
  if (!valid) {
    process.exit(1);
  }

  if (runOnce) {
    // Einmaliger Report (für manuelles Testen)
    console.log('[MONITOR] Modus: Einmaliger Report (--once)');
    await runHealthCheck();
    console.log('[MONITOR] Fertig – beende Prozess');
    process.exit(0);
  }

  // Scheduler-Modus
  console.log(`[MONITOR] Modus: Scheduler (${config.reportSchedule})`);
  console.log('[MONITOR] Warte auf nächsten geplanten Report...');
  console.log('');

  // Initialer Report beim Start (optional)
  const runInitial = process.argv.includes('--initial');
  if (runInitial) {
    console.log('[MONITOR] Führe initialen Report aus (--initial)...');
    await runHealthCheck();
  }

  // Cron-Job einrichten
  cron.schedule(config.reportSchedule, async () => {
    try {
      await runHealthCheck();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[MONITOR][ERROR] Health-Check fehlgeschlagen: ${errorMessage}`);
    }
  });

  // Graceful Shutdown
  process.once('SIGINT', () => {
    console.log('\n[MONITOR] SIGINT empfangen – beende...');
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    console.log('\n[MONITOR] SIGTERM empfangen – beende...');
    process.exit(0);
  });
}

// Start
main().catch((err) => {
  console.error('[MONITOR][FATAL] Unerwarteter Fehler:', err);
  process.exit(1);
});
