/**
 * Log Health Service – Docker Log Collector
 *
 * Sammelt Logs aus dem Docker Container.
 * Read-Only, Fail-Safe.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from './config';

const execAsync = promisify(exec);

/**
 * Ergebnis der Log-Sammlung
 */
export interface CollectorResult {
  success: boolean;
  lines: string[];
  error: string | null;
  collectedAt: Date;
}

/**
 * Sammelt Docker Logs für das konfigurierte Zeitfenster
 *
 * @returns CollectorResult mit den gesammelten Log-Zeilen
 */
export async function collectLogs(): Promise<CollectorResult> {
  const sinceArg = `${config.logWindowHours}h`;
  const command = `docker logs --since ${sinceArg} ${config.containerName} 2>&1`;

  console.log(`[COLLECTOR] Sammle Logs: docker logs --since ${sinceArg} ${config.containerName}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 50 * 1024 * 1024, // 50MB Buffer für große Log-Dateien
    });

    // Docker gibt stderr manchmal für normale Logs aus
    const combinedOutput = stdout + (stderr || '');
    const lines = combinedOutput
      .split('\n')
      .filter((line) => line.trim().length > 0);

    console.log(`[COLLECTOR] ${lines.length} Log-Zeilen gesammelt`);

    return {
      success: true,
      lines,
      error: null,
      collectedAt: new Date(),
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Spezifische Fehlerbehandlung
    if (errorMessage.includes('No such container')) {
      console.error(`[COLLECTOR][ERROR] Container nicht gefunden: ${config.containerName}`);
      return {
        success: false,
        lines: [],
        error: `Container nicht gefunden: ${config.containerName}`,
        collectedAt: new Date(),
      };
    }

    if (errorMessage.includes('permission denied')) {
      console.error('[COLLECTOR][ERROR] Keine Berechtigung für Docker Socket');
      return {
        success: false,
        lines: [],
        error: 'Keine Berechtigung für Docker Socket (mount /var/run/docker.sock?)',
        collectedAt: new Date(),
      };
    }

    console.error(`[COLLECTOR][ERROR] Unbekannter Fehler: ${errorMessage}`);
    return {
      success: false,
      lines: [],
      error: errorMessage,
      collectedAt: new Date(),
    };
  }
}

/**
 * Prüft ob Docker verfügbar ist
 *
 * @returns true wenn Docker erreichbar, false sonst
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return true;
  } catch {
    console.error('[COLLECTOR][ERROR] Docker nicht verfügbar');
    return false;
  }
}

/**
 * Prüft ob der Ziel-Container läuft
 *
 * @returns true wenn Container läuft, false sonst
 */
export async function checkContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `docker inspect -f '{{.State.Running}}' ${config.containerName}`,
      { timeout: 5000 }
    );
    return stdout.trim() === 'true';
  } catch {
    console.error(`[COLLECTOR][ERROR] Container ${config.containerName} nicht gefunden oder nicht inspizierbar`);
    return false;
  }
}
