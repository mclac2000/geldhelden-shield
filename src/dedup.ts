/**
 * Join-Event-Deduplizierung mit Fingerprint-basiertem In-Memory Set
 * 
 * Verhindert doppelte Verarbeitung von Join-Events (chat_member + new_chat_members)
 * Fingerprint: ${userId}:${chatId}:${floor(timestamp/60)}
 * TTL: 2-3 Minuten
 */

interface DedupEntry {
  timestamp: number;
}

class JoinDedupManager {
  private fingerprints: Map<string, DedupEntry> = new Map();
  private readonly ttlMs: number = 180000; // 3 Minuten
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Starte Cleanup-Interval (alle 30 Sekunden)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30000);
  }

  /**
   * Erstellt einen Fingerprint für einen Join-Event
   * Format: ${userId}:${chatId}:${floor(timestamp/60)}
   */
  createFingerprint(userId: number, chatId: string, timestamp: number): string {
    const minuteBucket = Math.floor(timestamp / 60000); // 60 Sekunden = 1 Minute
    return `${userId}:${chatId}:${minuteBucket}`;
  }

  /**
   * Prüft ob ein Join-Event bereits verarbeitet wurde
   * Returns: true wenn bereits verarbeitet (duplicate), false wenn neu
   */
  isDuplicate(userId: number, chatId: string, timestamp: number): boolean {
    const fingerprint = this.createFingerprint(userId, chatId, timestamp);
    const entry = this.fingerprints.get(fingerprint);
    
    if (!entry) {
      // Neuer Fingerprint - registrieren
      this.fingerprints.set(fingerprint, { timestamp });
      return false;
    }

    // Fingerprint existiert bereits
    return true;
  }

  /**
   * Entfernt abgelaufene Fingerprints
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.ttlMs;
    
    let removed = 0;
    for (const [fingerprint, entry] of this.fingerprints.entries()) {
      if (entry.timestamp < cutoff) {
        this.fingerprints.delete(fingerprint);
        removed++;
      }
    }
    
    if (removed > 0) {
      console.log(`[DEDUP] Cleanup: ${removed} abgelaufene Fingerprints entfernt`);
    }
  }

  /**
   * Gibt Statistiken zurück
   */
  getStats(): { activeFingerprints: number } {
    return {
      activeFingerprints: this.fingerprints.size,
    };
  }

  /**
   * Löscht alle Fingerprints (für Tests/Debug)
   */
  clear(): void {
    this.fingerprints.clear();
  }

  /**
   * Cleanup beim Shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.fingerprints.clear();
  }
}

// Singleton-Instanz
export const joinDedupManager = new JoinDedupManager();

/**
 * Prüft ob ein Join-Event ein Duplikat ist
 * Returns: true wenn duplicate, false wenn neu
 */
export function isDuplicateJoin(userId: number, chatId: string, timestamp: number = Date.now()): boolean {
  return joinDedupManager.isDuplicate(userId, chatId, timestamp);
}
