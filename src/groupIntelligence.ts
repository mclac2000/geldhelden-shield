/**
 * Group Intelligence System
 * 
 * Automatische Gruppentyp-Erkennung, Domain-Whitelist, Location-Extraktion
 */

import { getGroup, ensureGroupExists, updateGroupProfile, getOrCreateGroupProfile, GroupBrand, normalizeBrand } from './db';

/**
 * Erkennt Gruppentyp basierend auf Titel
 */
export function detectGroupBrand(title: string | null): GroupBrand {
  if (!title) {
    return 'geldhelden'; // Default
  }
  
  const lowerTitle = title.toLowerCase();
  const hasStaatenlos = lowerTitle.includes('staatenlos');
  const hasGeldhelden = lowerTitle.includes('geldhelden');
  
  if (hasStaatenlos && hasGeldhelden) {
    return 'mixed';
  } else if (hasStaatenlos) {
    return 'staatenlos';
  } else {
    return 'geldhelden';
  }
}

/**
 * Extrahiert Location aus Titel
 */
export function extractLocation(title: string | null): string | null {
  if (!title) {
    return null;
  }
  
  // Suche nach Patterns: "Meetup", "-", "/", "in"
  const patterns = [
    /meetup[:\s]+([^–/\n]+)/i,
    /[–-]\s*([^–/\n]+)/,
    /\/([^/\n]+)/,
    /in\s+([^–/\n]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1]) {
      const location = match[1].trim();
      if (location.length > 0 && location.length < 100) {
        return location;
      }
    }
  }
  
  return null;
}

/**
 * Generiert Domain-Whitelist basierend auf Brand
 */
export function getDefaultDomainsForBrand(brand: GroupBrand): string[] {
  switch (brand) {
    case 'geldhelden':
      return ['geldhelden.org'];
    case 'staatenlos':
      return ['staatenlos.ch'];
    case 'mixed':
      return ['geldhelden.org', 'staatenlos.ch'];
    default:
      return ['geldhelden.org'];
  }
}

/**
 * Aktualisiert Group-Profile basierend auf Titel-Analyse
 */
export function updateGroupProfileFromTitle(chatId: string, title: string | null): void {
  const brand = detectGroupBrand(title);
  const location = extractLocation(title);
  const allowedDomains = getDefaultDomainsForBrand(brand);
  
  // Update groups Tabelle - nur wenn Spalten existieren
  const db = require('./db').getDatabase();
  try {
    // Prüfe, welche Spalten existieren
    const groupsColumns = db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>;
    const hasBaseBrand = groupsColumns.some(col => col.name === 'base_brand');
    const hasLocation = groupsColumns.some(col => col.name === 'location');
    const hasAllowedDomains = groupsColumns.some(col => col.name === 'allowed_domains');
    const hasUpdatedAt = groupsColumns.some(col => col.name === 'updated_at');
    
    if (hasBaseBrand || hasLocation || hasAllowedDomains || hasUpdatedAt) {
      const setParts: string[] = [];
      const values: any[] = [];
      
      if (hasBaseBrand) {
        setParts.push('base_brand = ?');
        values.push(brand);
      }
      if (hasLocation) {
        setParts.push('location = ?');
        values.push(location);
      }
      if (hasAllowedDomains) {
        setParts.push('allowed_domains = ?');
        values.push(JSON.stringify(allowedDomains));
      }
      if (hasUpdatedAt) {
        setParts.push('updated_at = ?');
        values.push(Date.now());
      }
      
      if (setParts.length > 0) {
        values.push(chatId);
        const stmt = db.prepare(`UPDATE groups SET ${setParts.join(', ')} WHERE chat_id = ?`);
        stmt.run(...values);
      }
    }
  } catch (error: any) {
    console.warn(`[GROUP_INTELLIGENCE] Fehler beim Update groups: chat=${chatId}`, error.message);
  }
  
  // Update group_profiles Tabelle
  updateGroupProfile(chatId, {
    baseBrand: brand,
    location: location || undefined,
    allowedDomains: allowedDomains.join(','),
  });
  
  console.log(`[GROUP_PROFILE] updated chat=${chatId} brand=${brand} location=${location || 'null'} allowed_domains=${allowedDomains.join(',')}`);
}

/**
 * Holt erlaubte Domains für eine Gruppe
 */
export function getAllowedDomains(chatId: string): string[] {
  const group = getGroup(chatId);
  if (group?.allowedDomains && group.allowedDomains.length > 0) {
    return group.allowedDomains;
  }
  
  // Fallback: Brand-basierte Defaults
  const profile = getOrCreateGroupProfile(chatId);
  const brand = normalizeBrand(profile.baseBrand) || detectGroupBrand(group?.title || null);
  return getDefaultDomainsForBrand(brand);
}

/**
 * Prüft ob eine Domain für eine Gruppe erlaubt ist
 */
export function isDomainAllowed(chatId: string, domain: string): boolean {
  const allowedDomains = getAllowedDomains(chatId);
  const lowerDomain = domain.toLowerCase();
  
  return allowedDomains.some(allowed => lowerDomain.includes(allowed.toLowerCase()));
}
