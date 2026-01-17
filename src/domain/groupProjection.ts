/**
 * Domain Projection: Group (DB) → GroupContext (Domain)
 * 
 * Trennt sauber DB-Typen von Domain-Typen.
 * Keine Type Assertions, defensive Defaults.
 */

import { normalizeBrand } from '../db';

/**
 * Domain-Typ für Group-Kontext in Business-Logik
 * Alle Felder sind normalisiert und typ-sicher
 * Domain-Style-Namenskonventionen (camelCase statt snake_case)
 */
export interface GroupContext {
  chatId: number; // chat_id aus DB (als String gespeichert, wird zu number konvertiert)
  title: string; // title aus DB (defaults zu '' wenn null)
  status: number; // status aus DB als numerischer Code (0=known, 1=managed, 2=disabled, defaults zu 0 wenn null)
  silentMode: number; // silent_mode aus DB (0 oder 1, defaults zu 0 wenn null)
  baseBrand: 'geldhelden' | 'staatenlos' | 'mixed';
  location: string | null;
  allowedDomains: string[];
}

/**
 * DB-Gruppen-Zeile (Input für Projection)
 * Exportiert für Verwendung in db.ts
 */
export interface GroupRow {
  chat_id: string;
  title: string | null;
  status: string | null; // TEXT in DB: 'known', 'managed', 'disabled'
  silent_mode: number | null; // INTEGER in DB: 0 oder 1
  base_brand: string | null;
  location: string | null;
  allowed_domains: string | null;
}

/**
 * Parst allowed_domains aus JSON oder CSV in string[]
 * Defensive: Gibt leeres Array zurück bei Fehlern
 */
function parseAllowedDomains(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  // Versuche JSON zu parsen (z.B. ["geldhelden.org", "staatenlos.ch"])
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        // Filtere nur Strings und entferne leere Einträge
        return parsed
          .filter((item): item is string => typeof item === 'string' && item.length > 0)
          .map(item => item.trim())
          .filter(item => item.length > 0);
      }
    } catch (error) {
      // JSON-Parsing fehlgeschlagen, versuche CSV
    }
  }

  // CSV-Parsing (z.B. "geldhelden.org,staatenlos.ch" oder "geldhelden.org; staatenlos.ch")
  const csvDelimiters = [',', ';', '|'];
  for (const delimiter of csvDelimiters) {
    if (trimmed.includes(delimiter)) {
      return trimmed
        .split(delimiter)
        .map(item => item.trim())
        .filter(item => item.length > 0);
    }
  }

  // Einzelner Wert (kein Delimiter)
  return [trimmed];
}

/**
 * Konvertiert chat_id (String) zu number
 * Defensive: Gibt 0 zurück bei ungültigen Werten
 */
function parseChatId(chatId: string): number {
  const parsed = Number.parseInt(chatId, 10);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return 0; // Defensive Default
  }
  return parsed;
}

/**
 * Konvertiert status (String) zu numerischem Code
 * Defensive: Gibt 0 zurück bei ungültigen Werten
 * 0 = 'known', 1 = 'managed', 2 = 'disabled'
 */
function parseStatus(status: string | null | undefined): number {
  if (!status) {
    return 0; // Default: known
  }
  const normalized = status.toLowerCase().trim();
  if (normalized === 'managed') {
    return 1;
  }
  if (normalized === 'disabled') {
    return 2;
  }
  // Default: known (auch für 'known' oder ungültige Werte)
  return 0;
}

/**
 * Konvertiert Status-Code (number) zurück zu String
 * Helper-Funktion für Kompatibilität mit Code, der String-Status erwartet
 * 0 = 'known', 1 = 'managed', 2 = 'disabled'
 */
export function statusCodeToString(status: number): 'known' | 'managed' | 'disabled' {
  if (status === 1) {
    return 'managed';
  }
  if (status === 2) {
    return 'disabled';
  }
  // Default: known (auch für 0 oder ungültige Werte)
  return 'known';
}

/**
 * Prüft ob Status-Code "managed" ist
 * Helper-Funktion für Code, der prüft ob Gruppe managed ist
 */
export function isManagedStatus(status: number): boolean {
  return status === 1;
}

/**
 * Konvertiert silent_mode (number | null) zu number
 * Defensive: Gibt 0 zurück bei null oder ungültigen Werten
 */
function parseSilentMode(silentMode: number | null | undefined): number {
  if (silentMode === null || silentMode === undefined) {
    return 0; // Default: nicht silent
  }
  // Validiere: nur 0 oder 1 sind gültig
  if (silentMode === 0 || silentMode === 1) {
    return silentMode;
  }
  return 0; // Defensive Default bei ungültigen Werten
}

/**
 * Projiziert eine DB-Gruppen-Zeile zu einem Domain GroupContext
 * 
 * @param row - DB-Gruppen-Zeile mit allen benötigten Feldern
 * @returns GroupContext mit normalisierten Domain-Typen
 */
export function projectGroupRow(row: GroupRow): GroupContext {
  return {
    chatId: parseChatId(row.chat_id),
    title: row.title ?? '', // Default: leere Zeichenkette wenn null
    status: parseStatus(row.status), // Konvertiert zu numerischem Code (defaults zu 0)
    silentMode: parseSilentMode(row.silent_mode), // Defaults zu 0 wenn null
    baseBrand: normalizeBrand(row.base_brand), // Normalisiert via normalizeBrand
    location: row.location ?? null,
    allowedDomains: parseAllowedDomains(row.allowed_domains), // Parsed aus JSON oder CSV
  };
}
