import Database from 'better-sqlite3';
import { join } from 'path';
import { GroupContext, projectGroupRow, GroupRow } from './domain/groupProjection';

const DB_PATH = process.env.DB_PATH || '/app/data/shield.db';

export type UserStatus = 'ok' | 'restricted' | 'banned';
export type ActionType = 'restrict' | 'ban' | 'unrestrict' | 'allow';
export type GroupBrand = 'geldhelden' | 'staatenlos' | 'mixed';
export type GroupStatus = 'known' | 'managed' | 'disabled';

/**
 * Validiert, ob ein String ein gültiger GroupBrand ist
 */
function isValidGroupBrand(value: string | null | undefined): value is GroupBrand {
  return value === 'geldhelden' || value === 'staatenlos' || value === 'mixed';
}

/**
 * Konvertiert einen String zu einem GroupBrand oder gibt null zurück
 * @deprecated Verwende normalizeBrand() für Business-Logik
 */
function parseGroupBrand(value: string | null | undefined): GroupBrand | null {
  if (!value) {
    return null;
  }
  return isValidGroupBrand(value) ? value : null;
}

/**
 * Normalisiert einen Brand-String aus der DB zu einem Brand-Typ für Business-Logik
 * Regeln:
 * - "geldhelden" → "geldhelden"
 * - "staatenlos" → "staatenlos"
 * - alles andere (inkl. null) → "mixed"
 */
export function normalizeBrand(value: string | null | undefined): GroupBrand {
  if (value === 'geldhelden') {
    return 'geldhelden';
  }
  if (value === 'staatenlos') {
    return 'staatenlos';
  }
  // Default: mixed (auch für null, undefined, oder ungültige Werte)
  return 'mixed';
}

/**
 * Validiert, ob ein String ein gültiger GroupStatus ist
 */
function isValidGroupStatus(value: string | null | undefined): value is GroupStatus {
  return value === 'known' || value === 'managed' || value === 'disabled';
}

/**
 * Konvertiert einen String zu einem GroupStatus oder gibt 'known' als Default zurück
 */
function parseGroupStatus(value: string | null | undefined): GroupStatus {
  if (!value) {
    return 'known';
  }
  return isValidGroupStatus(value) ? value : 'known';
}

// Risk Levels - String Literals statt Enums
export type RiskLevel = "CLEAN" | "LOW" | "MEDIUM" | "HIGH";

export type GroupRiskLevel = "STABLE" | "ATTENTION" | "WARNING" | "CRITICAL";

// Group Stats
export interface GroupStats {
  group_id: string;
  group_name: string;
  risk_score: number;
  joins_24h: number;
  high_risk_users_24h: number;
  bans_24h: number;
  last_updated: number;
  last_notification_sent?: number;
  last_risk_level?: GroupRiskLevel;
}

/**
 * @deprecated Verwende GroupContext aus './domain/groupProjection' statt dieses Interface
 * Dieses Interface wird nur noch für interne DB-Zugriffe verwendet
 */
export interface Group {
  chat_id: string;
  title: string | null;
  base_brand: string | null; // DB-Typ: string | null (kann später neue Werte bekommen)
  location: string | null;
  allowed_domains: string | null; // JSON array or CSV
  silent_mode: boolean;
  added_at: number;
  updated_at: number | null;
  status: GroupStatus;
}

export interface User {
  user_id: number;
  first_seen: number;
  risk_score: number;
  status: UserStatus;
  account_created_at: number | null;
  has_username: boolean;
  has_profile_photo: boolean;
  last_decay_at: number | null;
  is_observed: boolean;
  risk_level: RiskLevel;
  risk_reasons: string | null;
  last_risk_update: number | null;
  username: string | null;
}

export interface Join {
  id: number;
  user_id: number;
  chat_id: string;
  joined_at: number;
}

export interface Action {
  id: number;
  user_id: number;
  chat_id: string;
  action: ActionType;
  reason: string | null;
  created_at: number;
}

export interface Cluster {
  id: number;
  level: 1 | 2 | 3;
  created_at: number;
  user_ids: number[];
  group_ids: string[];
  banned: boolean;
}

let db: any = null;

// Schema-Versionierung
const CURRENT_SCHEMA_VERSION = 2;

/**
 * Liest die aktuelle Schema-Version aus der meta-Tabelle
 */
function getSchemaVersion(db: any): number {
  try {
    const result = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
    if (result) {
      return parseInt(result.value, 10);
    }
  } catch (error: any) {
    // meta-Tabelle existiert noch nicht -> Version 1 (alte DB)
    if (error.message.includes('no such table')) {
      return 1;
    }
  }
  return 1; // Default: Version 1
}

/**
 * Setzt die Schema-Version in der meta-Tabelle (idempotent, verursacht keinen Crash)
 */
function setSchemaVersion(db: any, version: number): void {
  // Kein try/catch - Fehler müssen nach oben propagieren
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  stmt.run('schema_version', version.toString());
  console.log(`[DB] Schema-Version gesetzt: ${version}`);
}

/**
 * Prüft ob eine Spalte in einer Tabelle existiert
 * Nutzt: PRAGMA table_info(table)
 * Wirft Fehler bei DB-Problemen (kein try/catch - Fehler müssen nach oben propagieren)
 */
function columnExists(db: any, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some(col => col.name === column);
}

/**
 * Prüft ob eine Spalte in einer Tabelle existiert (defensive Version)
 * Nutzt: PRAGMA table_info(tableName)
 * @param db - Datenbank-Instanz
 * @param tableName - Name der Tabelle
 * @param columnName - Name der Spalte
 * @returns true wenn Spalte existiert, false sonst
 */
function hasColumn(db: any, tableName: string, columnName: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
  } catch (error: unknown) {
    // Defensive: Bei Fehler annehmen, dass Spalte nicht existiert
    return false;
  }
}

/**
 * Erstellt alle Tabellen (ohne Indexe)
 */
function ensureTables(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      chat_id TEXT PRIMARY KEY,
      title TEXT,
      added_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'known' CHECK(status IN ('known', 'managed', 'disabled'))
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      first_seen INTEGER NOT NULL,
      risk_score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok', 'restricted', 'banned')),
      account_created_at INTEGER,
      has_username INTEGER NOT NULL DEFAULT 0,
      has_profile_photo INTEGER NOT NULL DEFAULT 0,
      last_decay_at INTEGER,
      is_observed INTEGER NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL DEFAULT 'CLEAN' CHECK(risk_level IN ('CLEAN', 'LOW', 'MEDIUM', 'HIGH')),
      risk_reasons TEXT,
      last_risk_update INTEGER
    );

    CREATE TABLE IF NOT EXISTS joins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('restrict', 'ban', 'unrestrict', 'allow')),
      reason TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS blacklist (
      user_id INTEGER PRIMARY KEY,
      banned_by INTEGER NOT NULL,
      banned_at INTEGER NOT NULL,
      reason TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS escalations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      escalated_at INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      chat_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS baseline_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      scan_type TEXT NOT NULL CHECK(scan_type IN ('manual', 'auto')),
      scanned_at INTEGER NOT NULL,
      members_count INTEGER NOT NULL,
      members_scanned INTEGER NOT NULL,
      scan_limited INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS baseline_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      baseline_scan INTEGER NOT NULL DEFAULT 1,
      scan_source TEXT NOT NULL CHECK(scan_source IN ('manual', 'auto')),
      source TEXT NOT NULL DEFAULT 'join' CHECK(source IN ('join', 'message', 'admin', 'scan')),
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      UNIQUE(chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_scan_status (
      chat_id TEXT PRIMARY KEY,
      last_scan_at INTEGER,
      scan_state TEXT NOT NULL DEFAULT 'idle' CHECK(scan_state IN ('idle', 'running', 'rate_limited')),
      known_member_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS username_blacklist (
      username TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL,
      added_by INTEGER NOT NULL,
      FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS team_members (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      added_by INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      note TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pending_team_usernames (
      username TEXT PRIMARY KEY,
      added_by INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      note TEXT,
      FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pending_username_blacklist (
      username TEXT PRIMARY KEY,
      reason TEXT,
      created_by INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS group_profiles (
      chat_id TEXT PRIMARY KEY,
      title TEXT,
      welcome_enabled INTEGER NOT NULL DEFAULT 1,
      welcome_template TEXT,
      affiliate_ref TEXT,
      partner_tag TEXT,
      updated_by INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS welcome_sent (
      chat_id TEXT,
      user_id INTEGER,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS welcome_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL CHECK(brand IN ('geldhelden', 'staatenlos', 'mixed')),
      template_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS affiliate_refs (
      chat_id TEXT,
      user_id INTEGER,
      ref_code TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('group', 'admin', 'fallback')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, user_id, priority)
    );

    CREATE TABLE IF NOT EXISTS content_blocklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('DELETE', 'KICK', 'BAN', 'RESTRICT')),
      delete_message INTEGER NOT NULL DEFAULT 1,
      added_at INTEGER NOT NULL,
      added_by INTEGER NOT NULL,
      FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS group_moderation_settings (
      chat_id TEXT PRIMARY KEY,
      links_locked INTEGER NOT NULL DEFAULT 1,
      forward_locked INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_config (
      chat_id TEXT PRIMARY KEY,
      managed INTEGER NOT NULL DEFAULT 1,
      enable_welcome INTEGER NOT NULL DEFAULT 1,
      enable_service_cleanup INTEGER NOT NULL DEFAULT 1,
      enable_link_policy INTEGER NOT NULL DEFAULT 1,
      enable_scam_detection INTEGER NOT NULL DEFAULT 1,
      enable_warns INTEGER NOT NULL DEFAULT 1,
      welcome_template TEXT,
      welcome_ref_code TEXT,
      welcome_partner TEXT,
      scam_action TEXT NOT NULL DEFAULT 'delete' CHECK(scam_action IN ('delete', 'warn', 'restrict', 'kick', 'ban')),
      scam_threshold INTEGER NOT NULL DEFAULT 70,
      scam_warn_text TEXT,
      url_policy_mode TEXT NOT NULL DEFAULT 'allowlist' CHECK(url_policy_mode IN ('allow', 'allowlist', 'block_all')),
      url_allowlist TEXT,
      link_policy_enabled INTEGER NOT NULL DEFAULT 1,
      link_policy_new_user_window_minutes INTEGER NOT NULL DEFAULT 30,
      link_policy_whitelist_domains TEXT,
      antiflood_enabled INTEGER NOT NULL DEFAULT 1,
      antiflood_max_messages INTEGER NOT NULL DEFAULT 5,
      antiflood_window_seconds INTEGER NOT NULL DEFAULT 10,
      antiflood_restrict_minutes INTEGER NOT NULL DEFAULT 10,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS welcome_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      sent_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scam_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      message_id INTEGER,
      score INTEGER NOT NULL,
      action TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_stats (
      group_id TEXT PRIMARY KEY,
      group_name TEXT NOT NULL,
      risk_score INTEGER NOT NULL DEFAULT 0,
      joins_24h INTEGER NOT NULL DEFAULT 0,
      high_risk_users_24h INTEGER NOT NULL DEFAULT 0,
      bans_24h INTEGER NOT NULL DEFAULT 0,
      last_updated INTEGER NOT NULL,
      last_notification_sent INTEGER,
      last_risk_level TEXT,
      FOREIGN KEY (group_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_settings (
      chat_id TEXT PRIMARY KEY,
      welcome_enabled INTEGER NOT NULL DEFAULT 1,
      ref_code TEXT,
      brand_mode TEXT NOT NULL DEFAULT 'GELDHELDEN' CHECK(brand_mode IN ('GELDHELDEN', 'STAATENLOS_COOP')),
      custom_intro TEXT,
      scam_enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
    );

    -- Meta-Tabelle für Schema-Versionierung
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

/**
 * Führt alle Schema-Migrationen durch (ALTER TABLE, etc.)
 * Diese Funktion ist idempotent und kann mehrfach ausgeführt werden.
 */
function runMigrations(db: any): void {
  // Prüfe, ob username Spalte in users existiert
  const usersColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  const usersHasUsername = usersColumns.some(col => col.name === 'username');
  
  if (!usersHasUsername) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT;');
    console.log('[DB MIGRATION] users.username added');
  }
  
  // Prüfe, ob groups Spalten existieren
  const groupsColumns = db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>;
  const groupsHasBaseBrand = groupsColumns.some(col => col.name === 'base_brand');
  const groupsHasLocation = groupsColumns.some(col => col.name === 'location');
  const groupsHasAllowedDomains = groupsColumns.some(col => col.name === 'allowed_domains');
  const groupsHasUpdatedAt = groupsColumns.some(col => col.name === 'updated_at');
  const groupsHasSilentMode = groupsColumns.some(col => col.name === 'silent_mode');
  
  if (!groupsHasBaseBrand) {
    db.exec('ALTER TABLE groups ADD COLUMN base_brand TEXT CHECK(base_brand IN (\'geldhelden\', \'staatenlos\', \'mixed\'));');
    console.log('[DB MIGRATION] groups.base_brand added');
  }
  
  if (!groupsHasLocation) {
    db.exec('ALTER TABLE groups ADD COLUMN location TEXT;');
    console.log('[DB MIGRATION] groups.location added');
  }
  
  if (!groupsHasAllowedDomains) {
    db.exec('ALTER TABLE groups ADD COLUMN allowed_domains TEXT;');
    console.log('[DB MIGRATION] groups.allowed_domains added');
  }
  
  if (!groupsHasUpdatedAt) {
    db.exec('ALTER TABLE groups ADD COLUMN updated_at INTEGER;');
    console.log('[DB MIGRATION] groups.updated_at added');
  }
  
  if (!groupsHasSilentMode) {
    db.exec('ALTER TABLE groups ADD COLUMN silent_mode INTEGER NOT NULL DEFAULT 0;');
    console.log('[DB MIGRATION] groups.silent_mode added');
  }
  
  // Prüfe, ob group_profiles Spalten existieren
  const groupProfilesColumns = db.prepare('PRAGMA table_info(group_profiles)').all() as Array<{ name: string }>;
  const groupProfilesHasBaseBrand = groupProfilesColumns.some(col => col.name === 'base_brand');
  const groupProfilesHasLocation = groupProfilesColumns.some(col => col.name === 'location');
  const groupProfilesHasAllowedDomains = groupProfilesColumns.some(col => col.name === 'allowed_domains');
  const groupProfilesHasSilentMode = groupProfilesColumns.some(col => col.name === 'silent_mode');
  
  if (!groupProfilesHasBaseBrand) {
    db.exec('ALTER TABLE group_profiles ADD COLUMN base_brand TEXT CHECK(base_brand IN (\'geldhelden\', \'staatenlos\', \'mixed\'));');
    console.log('[DB MIGRATION] group_profiles.base_brand added');
  }
  
  if (!groupProfilesHasLocation) {
    db.exec('ALTER TABLE group_profiles ADD COLUMN location TEXT;');
    console.log('[DB MIGRATION] group_profiles.location added');
  }
  
  if (!groupProfilesHasAllowedDomains) {
    db.exec('ALTER TABLE group_profiles ADD COLUMN allowed_domains TEXT;');
    console.log('[DB MIGRATION] group_profiles.allowed_domains added');
  }
  
  if (!groupProfilesHasSilentMode) {
    db.exec('ALTER TABLE group_profiles ADD COLUMN silent_mode INTEGER NOT NULL DEFAULT 0;');
    console.log('[DB MIGRATION] group_profiles.silent_mode added');
  }
}

/**
 * Erstellt alle Indexe (NACH Migrationen)
 * WICHTIG: Nur Indexe auf Spalten, die nach Migrationen existieren!
 */
function ensureIndexes(db: any): void {
  // Prüfe, ob users.username existiert, bevor wir Indexe darauf erstellen
  const usersColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  const usersHasUsername = usersColumns.some(col => col.name === 'username');
  
  // Prüfe, ob team_members.username existiert
  const teamMembersColumns = db.prepare('PRAGMA table_info(team_members)').all() as Array<{ name: string }>;
  const teamMembersHasUsername = teamMembersColumns.some(col => col.name === 'username');
  
  // Prüfe, ob baseline_members.username existiert
  const baselineMembersColumns = db.prepare('PRAGMA table_info(baseline_members)').all() as Array<{ name: string }>;
  const baselineMembersHasUsername = baselineMembersColumns.some(col => col.name === 'username');
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_joins_user_id ON joins(user_id);
    CREATE INDEX IF NOT EXISTS idx_joins_joined_at ON joins(joined_at);
    CREATE INDEX IF NOT EXISTS idx_joins_user_chat ON joins(user_id, chat_id);
    
    CREATE INDEX IF NOT EXISTS idx_actions_user_id ON actions(user_id);
    CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at);
    CREATE INDEX IF NOT EXISTS idx_blacklist_banned_at ON blacklist(banned_at);
    CREATE INDEX IF NOT EXISTS idx_escalations_user_id ON escalations(user_id);
    CREATE INDEX IF NOT EXISTS idx_escalations_escalated_at ON escalations(escalated_at);
    
    CREATE INDEX IF NOT EXISTS idx_baseline_scans_chat_id ON baseline_scans(chat_id);
    CREATE INDEX IF NOT EXISTS idx_baseline_scans_scanned_at ON baseline_scans(scanned_at);
    CREATE INDEX IF NOT EXISTS idx_baseline_members_chat_id ON baseline_members(chat_id);
    CREATE INDEX IF NOT EXISTS idx_baseline_members_user_id ON baseline_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_baseline_members_baseline_scan ON baseline_members(baseline_scan);
    
    CREATE INDEX IF NOT EXISTS idx_username_blacklist_added_at ON username_blacklist(added_at);
    
    CREATE INDEX IF NOT EXISTS idx_team_members_added_at ON team_members(added_at);
    
    CREATE INDEX IF NOT EXISTS idx_pending_team_usernames_added_at ON pending_team_usernames(added_at);
    
    CREATE INDEX IF NOT EXISTS idx_pending_username_blacklist_created_at ON pending_username_blacklist(created_at);
    
    CREATE INDEX IF NOT EXISTS idx_group_profiles_welcome_enabled ON group_profiles(welcome_enabled);
    
    CREATE INDEX IF NOT EXISTS idx_welcome_sent_joined_at ON welcome_sent(joined_at);
    
    CREATE INDEX IF NOT EXISTS idx_content_blocklist_name ON content_blocklist(name);
    CREATE INDEX IF NOT EXISTS idx_content_blocklist_added_at ON content_blocklist(added_at);
    
    CREATE INDEX IF NOT EXISTS idx_group_config_managed ON group_config(managed);
    
    CREATE INDEX IF NOT EXISTS idx_welcome_log_chat_id ON welcome_log(chat_id);
    CREATE INDEX IF NOT EXISTS idx_welcome_log_sent_at ON welcome_log(sent_at);
    
    CREATE INDEX IF NOT EXISTS idx_scam_events_chat_id ON scam_events(chat_id);
    CREATE INDEX IF NOT EXISTS idx_scam_events_user_id ON scam_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_scam_events_created_at ON scam_events(created_at);
    
    CREATE INDEX IF NOT EXISTS idx_group_stats_risk_score ON group_stats(risk_score);
    CREATE INDEX IF NOT EXISTS idx_group_stats_last_updated ON group_stats(last_updated);
    
    CREATE INDEX IF NOT EXISTS idx_group_settings_welcome_enabled ON group_settings(welcome_enabled);
  `);
  
  // Indexe auf username-Spalten nur erstellen, wenn die Spalten existieren
  if (teamMembersHasUsername) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_username ON team_members(username);`);
  }
  
  // Optional: Index auf users.username, falls benötigt (aktuell nicht verwendet)
  // if (usersHasUsername) {
  //   db.exec(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);
  // }
  
  // Optional: Index auf baseline_members.username, falls benötigt (aktuell nicht verwendet)
  // if (baselineMembersHasUsername) {
  //   db.exec(`CREATE INDEX IF NOT EXISTS idx_baseline_members_username ON baseline_members(username);`);
  // }
}

export function initDatabase(): any {
  if (db) {
    return db;
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ========================================================================
  // Schritt 0: Defensive Migration - Stelle sicher, dass users.username existiert
  // ========================================================================
  // Diese Migration läuft VOR allen anderen DB-Zugriffen
  if (!hasColumn(db, 'users', 'username')) {
    try {
      db.exec('ALTER TABLE users ADD COLUMN username TEXT;');
      console.log('[MIGRATION] added users.username');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Idempotent: Wenn Spalte bereits existiert (duplicate column name), ist das OK
      if (!errorMessage.includes('duplicate column name') && !errorMessage.includes('already exists')) {
        // Andere Fehler loggen, aber nicht abbrechen (defensive)
        console.warn('[MIGRATION] Fehler beim Hinzufügen der username-Spalte:', errorMessage);
      }
    }
  }

  // ========================================================================
  // Schritt 0b: Defensive Migration - Stelle sicher, dass users.first_name existiert
  // ========================================================================
  if (!hasColumn(db, 'users', 'first_name')) {
    try {
      db.exec('ALTER TABLE users ADD COLUMN first_name TEXT;');
      console.log('[MIGRATION] added users.first_name');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Idempotent: Wenn Spalte bereits existiert (duplicate column name), ist das OK
      if (!errorMessage.includes('duplicate column name') && !errorMessage.includes('already exists')) {
        // Andere Fehler loggen, aber nicht abbrechen (defensive)
        console.warn('[MIGRATION] Fehler beim Hinzufügen der first_name-Spalte:', errorMessage);
      }
    }
  }

  // ========================================================================
  // Schritt 0b2: Defensive Migration - Stelle sicher, dass users.last_name existiert
  // ========================================================================
  if (!hasColumn(db, 'users', 'last_name')) {
    try {
      db.exec('ALTER TABLE users ADD COLUMN last_name TEXT;');
      console.log('[MIGRATION] added users.last_name');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Idempotent: Wenn Spalte bereits existiert (duplicate column name), ist das OK
      if (!errorMessage.includes('duplicate column name') && !errorMessage.includes('already exists')) {
        // Andere Fehler loggen, aber nicht abbrechen (defensive)
        console.warn('[MIGRATION] Fehler beim Hinzufügen der last_name-Spalte:', errorMessage);
      }
    }
  }

  // ========================================================================
  // Schritt 0c: Defensive Migration - Stelle sicher, dass team_members.username existiert
  // ========================================================================
  if (!hasColumn(db, 'team_members', 'username')) {
    try {
      db.exec('ALTER TABLE team_members ADD COLUMN username TEXT;');
      console.log('[MIGRATION] added team_members.username');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Idempotent: Wenn Spalte bereits existiert (duplicate column name), ist das OK
      if (!errorMessage.includes('duplicate column name') && !errorMessage.includes('already exists')) {
        // Andere Fehler loggen, aber nicht abbrechen (defensive)
        console.warn('[MIGRATION] Fehler beim Hinzufügen der team_members.username-Spalte:', errorMessage);
      }
    }
  }

  // ========================================================================
  // Schritt 0d: Defensive Migration - Stelle sicher, dass team_members.first_name existiert
  // ========================================================================
  if (!hasColumn(db, 'team_members', 'first_name')) {
    try {
      db.exec('ALTER TABLE team_members ADD COLUMN first_name TEXT;');
      console.log('[MIGRATION] added team_members.first_name');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Idempotent: Wenn Spalte bereits existiert (duplicate column name), ist das OK
      if (!errorMessage.includes('duplicate column name') && !errorMessage.includes('already exists')) {
        // Andere Fehler loggen, aber nicht abbrechen (defensive)
        console.warn('[MIGRATION] Fehler beim Hinzufügen der team_members.first_name-Spalte:', errorMessage);
      }
    }
  }

  // ========================================================================
  // Schritt 0e: Defensive Migration - Stelle sicher, dass team_members.last_name existiert
  // ========================================================================
  if (!hasColumn(db, 'team_members', 'last_name')) {
    try {
      db.exec('ALTER TABLE team_members ADD COLUMN last_name TEXT;');
      console.log('[MIGRATION] added team_members.last_name');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Idempotent: Wenn Spalte bereits existiert (duplicate column name), ist das OK
      if (!errorMessage.includes('duplicate column name') && !errorMessage.includes('already exists')) {
        // Andere Fehler loggen, aber nicht abbrechen (defensive)
        console.warn('[MIGRATION] Fehler beim Hinzufügen der team_members.last_name-Spalte:', errorMessage);
      }
    }
  }

  // ========================================================================
  // Schritt 1: Erstelle alle Tabellen (ohne Indexe)
  // ========================================================================
  ensureTables(db);

  // ========================================================================
  // Schritt 2: Stelle sicher, dass meta-Tabelle existiert
  // ========================================================================
  // (wurde bereits in Schritt 1 erstellt, aber zur Sicherheit prüfen wir)
  
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  } catch (error: any) {
    // Tabelle existiert bereits - OK
    if (!error.message.includes('already exists')) {
      console.error('[DB] Fehler beim Erstellen der meta-Tabelle:', error.message);
    }
  }

  // ========================================================================
  // Schritt 3: Schema-Migrationen (idempotent, prüfen Spalten-Existenz)
  // ========================================================================
  
  const currentVersion = getSchemaVersion(db);
  console.log(`[DB] Schema-Version: ${currentVersion}`);

  // Migration zu Version 2: Füge username Spalte zu users hinzu
  if (currentVersion < 2) {
    console.log(`[DB] Running migration v${currentVersion} → v2`);
    try {
      if (!columnExists(db, 'users', 'username')) {
        console.log('[DB] Migration v1→v2: Füge username Spalte zu users hinzu...');
        db.exec('ALTER TABLE users ADD COLUMN username TEXT;');
        console.log('[DB] Migration v1→v2: username Spalte erfolgreich hinzugefügt');
      } else {
        console.log('[DB] Migration v1→v2: username Spalte existiert bereits, überspringe ALTER TABLE');
      }
      setSchemaVersion(db, 2);
      console.log('[DB] Migration v2 completed');
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Nur erwartete Fehler abfangen (duplicate column = bereits vorhanden, OK)
      if (errorMessage.includes('duplicate column name') || errorMessage.includes('already exists')) {
        // Spalte existiert bereits (Race Condition) - OK, setze Version trotzdem
        console.log('[DB] Migration v1→v2: username Spalte existiert bereits (Race Condition), setze Version auf v2');
        try {
          setSchemaVersion(db, 2);
          console.log('[DB] Migration v2 completed');
        } catch (setVersionError: any) {
          console.error('[DB][FATAL] Migration failed – manual intervention required');
          console.error('[DB][FATAL] Fehler beim Setzen der Schema-Version nach erwartetem duplicate column Fehler:', setVersionError.message);
          console.error('[DB][FATAL] Ursprünglicher Fehler:', errorMessage);
          process.exit(1);
        }
      } else {
        // Unerwarteter Fehler → FATAL
        console.error('[DB][FATAL] Migration failed – manual intervention required');
        console.error('[DB][FATAL] Migration v1→v2 fehlgeschlagen:', errorMessage);
        if (error instanceof Error && error.stack) {
          console.error('[DB][FATAL] Stack trace:', error.stack);
        }
        process.exit(1);
      }
    }
  } else {
    console.log(`[DB] Schema-Version bereits aktuell (v${currentVersion}), keine Migration nötig`);
  }

  // ========================================================================
  // Schritt 3b: Sicherheits-Migration für users.username (unabhängig von Schema-Version)
  // ========================================================================
  runMigrations(db);

  // ========================================================================
  // Schritt 4: Erstelle alle Indexe (NACH Migrationen)
  // ========================================================================
  ensureIndexes(db);

  // ========================================================================
  // Schritt 5: Normale Runtime-Initialisierung (UPDATE, INSERT, etc.)
  // ========================================================================

  // Migration: Füge status Spalte hinzu falls nicht vorhanden (für bestehende DBs)
  try {
    db.exec(`
      ALTER TABLE groups ADD COLUMN status TEXT NOT NULL DEFAULT 'known' CHECK(status IN ('known', 'managed', 'disabled'));
    `);
  } catch (error: any) {
    // Spalte existiert bereits oder andere Fehler - ignorieren
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung:', error.message);
    }
  }

  // Migration: Füge external Spalte zu users hinzu (für Username-Bans ohne bekannten User)
  try {
    db.exec(`
      ALTER TABLE users ADD COLUMN external INTEGER NOT NULL DEFAULT 0;
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung (users.external):', error.message);
    }
  }

  // Stelle sicher, dass alle bestehenden Gruppen gültigen Status haben (kein Reset auf 'known')
  db.exec(`UPDATE groups SET status = 'known' WHERE status IS NULL OR status NOT IN ('known', 'managed', 'disabled')`);

  // Migration: Füge is_observed Spalte hinzu falls nicht vorhanden
  try {
    db.exec(`
      ALTER TABLE users ADD COLUMN is_observed INTEGER NOT NULL DEFAULT 0;
    `);
  } catch (error: any) {
    // Spalte existiert bereits oder andere Fehler - ignorieren
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung (is_observed):', error.message);
    }
  }

  // Migration: Füge Welcome-Felder zu group_config hinzu
  try {
    db.exec(`
      ALTER TABLE group_config ADD COLUMN welcome_template TEXT;
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung (welcome_template):', error.message);
    }
  }

  try {
    db.exec(`
      ALTER TABLE group_config ADD COLUMN welcome_ref_code TEXT;
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung (welcome_ref_code):', error.message);
    }
  }

  try {
    db.exec(`
      ALTER TABLE group_config ADD COLUMN welcome_partner TEXT;
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung (welcome_partner):', error.message);
    }
  }

  // Migration: Erstelle escalations Tabelle falls nicht vorhanden
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS escalations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        escalated_at INTEGER NOT NULL,
        trigger_type TEXT NOT NULL,
        chat_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_escalations_user_id ON escalations(user_id);
      CREATE INDEX IF NOT EXISTS idx_escalations_escalated_at ON escalations(escalated_at);
    `);
  } catch (error: any) {
    // Tabelle existiert bereits oder andere Fehler - ignorieren
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (escalations):', error.message);
    }
  }

  // Migration: Erstelle clusters Tabelle falls nicht vorhanden
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level INTEGER NOT NULL CHECK(level IN (1, 2, 3)),
        created_at INTEGER NOT NULL,
        user_ids TEXT NOT NULL,
        group_ids TEXT NOT NULL,
        banned INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_clusters_level ON clusters(level);
      CREATE INDEX IF NOT EXISTS idx_clusters_created_at ON clusters(created_at);
      CREATE INDEX IF NOT EXISTS idx_clusters_banned ON clusters(banned);
    `);
  } catch (error: any) {
    // Tabelle existiert bereits oder andere Fehler - ignorieren
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (clusters):', error.message);
    }
  }

  // Migration: Erstelle user_group_activity Tabelle (für Prompt 5)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_group_activity (
        user_id INTEGER NOT NULL,
        group_id TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, group_id),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES groups(chat_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_group_activity_user_id ON user_group_activity(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_group_activity_group_id ON user_group_activity(group_id);
      CREATE INDEX IF NOT EXISTS idx_user_group_activity_last_seen_at ON user_group_activity(last_seen_at);
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (user_group_activity):', error.message);
    }
  }

  // Migration: Erstelle cluster_members Tabelle (für Prompt 5)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cluster_members (
        cluster_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (cluster_id, user_id),
        FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster_id ON cluster_members(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_user_id ON cluster_members(user_id);
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (cluster_members):', error.message);
    }
  }

  // Migration: Füge reason Spalte zu clusters hinzu (für Prompt 5)
  try {
    db.exec(`
      ALTER TABLE clusters ADD COLUMN reason TEXT;
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung (clusters.reason):', error.message);
    }
  }

  // Migration: Füge source Spalte zu baseline_members hinzu falls nicht vorhanden
  try {
    db.exec(`
      ALTER TABLE baseline_members ADD COLUMN source TEXT NOT NULL DEFAULT 'join' CHECK(source IN ('join', 'message', 'admin', 'scan'));
    `);
  } catch (error: any) {
    // Spalte existiert bereits oder andere Fehler - ignorieren
    if (!error.message.includes('duplicate column name') && !error.message.includes('no such column')) {
      console.warn('[DB] Migration Warnung (baseline_members.source):', error.message);
    }
  }

  // Migration: Bereinige Duplikate und erstelle UNIQUE Index für joins (Idempotenz)
  // ========================================================================
  
  // Prüfe, ob Index bereits existiert
  const indexList = db.prepare("PRAGMA index_list('joins')").all() as Array<{ name: string }>;
  const indexExists = indexList.some(idx => idx.name === 'idx_joins_unique_user_chat_minute');
  
  if (!indexExists) {
    // Index existiert nicht → bereinige Duplikate VOR Index-Erstellung
    // Berechne minute = CAST(joined_at / 60000 AS INTEGER)
    const deleteDuplicates = db.prepare(`
      DELETE FROM joins
      WHERE rowid NOT IN (
        SELECT MIN(rowid)
        FROM joins
        GROUP BY user_id, chat_id, CAST(joined_at / 60000 AS INTEGER)
      )
    `);
    const result = deleteDuplicates.run();
    if (result.changes > 0) {
      console.log(`[DB MIGRATION] Cleaned ${result.changes} duplicate joins`);
    }
    
    // Erstelle UNIQUE Index nach Bereinigung
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_joins_unique_user_chat_minute 
      ON joins(user_id, chat_id, CAST(joined_at / 60000 AS INTEGER))
    `);
    console.log('[DB MIGRATION] Unique index ensured');
  }

  // Migration: Erstelle group_scan_status Tabelle falls nicht vorhanden
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_scan_status (
        chat_id TEXT PRIMARY KEY,
        last_scan_at INTEGER,
        scan_state TEXT NOT NULL DEFAULT 'idle' CHECK(scan_state IN ('idle', 'running', 'rate_limited')),
        known_member_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_group_scan_status_scan_state ON group_scan_status(scan_state);
    `);
  } catch (error: any) {
    // Tabelle existiert bereits oder andere Fehler - ignorieren
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (group_scan_status):', error.message);
    }
  }

  // Migration: Erstelle team_members Tabelle falls nicht vorhanden
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS team_members (
        user_id INTEGER PRIMARY KEY,
        added_by INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_team_members_added_at ON team_members(added_at);
    `);
  } catch (error: any) {
    // Tabelle existiert bereits oder andere Fehler - ignorieren
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (team_members):', error.message);
    }
  }

  // Migration: Erstelle content_blocklist Tabelle falls nicht vorhanden
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_blocklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        reason TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('DELETE', 'KICK', 'BAN', 'RESTRICT')),
        delete_message INTEGER NOT NULL DEFAULT 1,
        added_at INTEGER NOT NULL,
        added_by INTEGER NOT NULL,
        FOREIGN KEY (added_by) REFERENCES users(user_id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_content_blocklist_name ON content_blocklist(name);
      CREATE INDEX IF NOT EXISTS idx_content_blocklist_added_at ON content_blocklist(added_at);
    `);
    
    // Initialisiere Standard-Spam-Filter (Prompt 6)
    const defaultSpamRules = [
      { name: 'official support', reason: 'Scam-Phrase: official support', action: 'KICK', deleteMessage: true },
      { name: 'contact admin', reason: 'Scam-Phrase: contact admin', action: 'KICK', deleteMessage: true },
      { name: 'airdrop', reason: 'Scam-Phrase: airdrop', action: 'KICK', deleteMessage: true },
      { name: 'giveaway', reason: 'Scam-Phrase: giveaway', action: 'KICK', deleteMessage: true },
      { name: 'cloud mining', reason: 'Scam-Phrase: cloud mining', action: 'KICK', deleteMessage: true },
      { name: 'invest now', reason: 'Scam-Phrase: invest now', action: 'KICK', deleteMessage: true },
    ];
    
    for (const rule of defaultSpamRules) {
      try {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO content_blocklist (name, reason, action, delete_message, added_at, added_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(rule.name.toLowerCase(), rule.reason, rule.action, 1, Date.now(), 0); // added_by = 0 für System
      } catch (error: any) {
        // Ignoriere Duplikate
      }
    }
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (content_blocklist):', error.message);
    }
  }

  // Migration: Erstelle group_moderation_settings Tabelle falls nicht vorhanden
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_moderation_settings (
        chat_id TEXT PRIMARY KEY,
        links_locked INTEGER NOT NULL DEFAULT 1,
        forward_locked INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (chat_id) REFERENCES groups(chat_id) ON DELETE CASCADE
      );
    `);
  } catch (error: any) {
    if (!error.message.includes('duplicate column name') && !error.message.includes('already exists')) {
      console.warn('[DB] Migration Warnung (group_moderation_settings):', error.message);
    }
  }

  // Stelle sicher, dass alle bestehenden Gruppen gültigen Status haben (kein Reset auf 'known')
  try {
    db.exec(`UPDATE groups SET status = 'known' WHERE status IS NULL OR status NOT IN ('known', 'managed', 'disabled')`);
  } catch (error: any) {
    console.warn('[DB] Warnung beim Update von groups.status:', error.message);
  }

  return db;
}

export function getDatabase(): any {
  if (!db) {
    return initDatabase();
  }
  return db;
}

// Groups
export function registerGroup(chatId: string, title: string | null = null, status: GroupStatus = 'managed'): { wasNew: boolean; statusChanged: boolean; oldStatus: GroupStatus | null } {
  const db = getDatabase();
  
  // Prüfe ob Gruppe bereits existiert
  const existing = db.prepare('SELECT status FROM groups WHERE chat_id = ?').get(chatId) as { status: GroupStatus } | undefined;
  const oldStatus = existing?.status || null;
  const wasNew = !existing;
  
  if (wasNew) {
    // Neue Gruppe - Status setzen
    const stmt = db.prepare(`
      INSERT INTO groups (chat_id, title, added_at, status)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(chatId, title, Date.now(), status);
    
    // Stelle sicher, dass group_config existiert (automatisch beim ersten Sehen)
    ensureGroupConfig(chatId, undefined);
    
    return { wasNew: true, statusChanged: true, oldStatus: null };
  } else {
    // Bestehende Gruppe - nur Title aktualisieren, Status bleibt unverändert
    const stmt = db.prepare(`
      UPDATE groups SET title = ? WHERE chat_id = ?
    `);
    stmt.run(title, chatId);
    
    // Stelle sicher, dass group_config existiert (falls noch nicht vorhanden)
    ensureGroupConfig(chatId, undefined);
    
    return { wasNew: false, statusChanged: false, oldStatus };
  }
}

/**
 * Holt eine Gruppe als Domain-Objekt (GroupContext)
 * Alle Normalisierung erfolgt vor dem Return
 */
export function getGroup(chatId: string): GroupContext | null {
  const db = getDatabase();
  // Verwende dynamisches SELECT, um nur existierende Spalten zu verwenden
  // Prüfe zuerst, welche Spalten existieren
  const groupsColumns = db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>;
  const hasBaseBrand = groupsColumns.some(col => col.name === 'base_brand');
  const hasLocation = groupsColumns.some(col => col.name === 'location');
  const hasAllowedDomains = groupsColumns.some(col => col.name === 'allowed_domains');
  const hasSilentMode = groupsColumns.some(col => col.name === 'silent_mode');
  
  // Baue SELECT dynamisch auf, um nur existierende Spalten zu verwenden
  const selectFields = [
    'chat_id',
    'title',
    'status',
    hasSilentMode ? 'silent_mode' : '0 as silent_mode',
    hasBaseBrand ? 'base_brand' : 'NULL as base_brand',
    hasLocation ? 'location' : 'NULL as location',
    hasAllowedDomains ? 'allowed_domains' : 'NULL as allowed_domains',
  ].join(', ');
  
  const stmt = db.prepare(`
    SELECT ${selectFields}
    FROM groups 
    WHERE chat_id = ?
  `);
  const row = stmt.get(chatId) as GroupRow | undefined;
  
  if (!row) {
    return null;
  }
  
  // Projiziere DB-Row zu Domain-Objekt (alle Normalisierung erfolgt hier)
  return projectGroupRow(row);
}

/**
 * Holt den Titel einer Gruppe (für Kompatibilität mit Code, der title benötigt)
 */
export function getGroupTitle(chatId: string): string | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT title FROM groups WHERE chat_id = ?');
  const result = stmt.get(chatId) as { title: string | null } | undefined;
  return result?.title ?? null;
}

export function setGroupStatus(chatId: string, status: GroupStatus): boolean {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE groups SET status = ? WHERE chat_id = ?');
  const result = stmt.run(status, chatId);
  return result.changes > 0;
}

/**
 * Holt alle Gruppen als Domain-Objekte (GroupContext[])
 * Alle Normalisierung erfolgt vor dem Return
 */
export function getAllGroups(): GroupContext[] {
  const db = getDatabase();
  
  // Prüfe, welche Spalten existieren
  const groupsColumns = db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>;
  const hasBaseBrand = groupsColumns.some(col => col.name === 'base_brand');
  const hasLocation = groupsColumns.some(col => col.name === 'location');
  const hasAllowedDomains = groupsColumns.some(col => col.name === 'allowed_domains');
  const hasSilentMode = groupsColumns.some(col => col.name === 'silent_mode');
  
  const selectFields = [
    'chat_id',
    'title',
    'status',
    hasSilentMode ? 'silent_mode' : '0 as silent_mode',
    hasBaseBrand ? 'base_brand' : 'NULL as base_brand',
    hasLocation ? 'location' : 'NULL as location',
    hasAllowedDomains ? 'allowed_domains' : 'NULL as allowed_domains',
  ].join(', ');
  
  const stmt = db.prepare(`SELECT ${selectFields} FROM groups ORDER BY added_at DESC`);
  const rows = stmt.all() as GroupRow[];
  
  // Projiziere alle DB-Rows zu Domain-Objekten (alle Normalisierung erfolgt hier)
  return rows.map(row => projectGroupRow(row));
}

/**
 * Holt alle managed Gruppen als Domain-Objekte (GroupContext[])
 * Alle Normalisierung erfolgt vor dem Return
 */
export function getManagedGroups(): GroupContext[] {
  const db = getDatabase();
  
  // Prüfe, welche Spalten existieren
  const groupsColumns = db.prepare('PRAGMA table_info(groups)').all() as Array<{ name: string }>;
  const hasBaseBrand = groupsColumns.some(col => col.name === 'base_brand');
  const hasLocation = groupsColumns.some(col => col.name === 'location');
  const hasAllowedDomains = groupsColumns.some(col => col.name === 'allowed_domains');
  const hasSilentMode = groupsColumns.some(col => col.name === 'silent_mode');
  
  const selectFields = [
    'chat_id',
    'title',
    'status',
    hasSilentMode ? 'silent_mode' : '0 as silent_mode',
    hasBaseBrand ? 'base_brand' : 'NULL as base_brand',
    hasLocation ? 'location' : 'NULL as location',
    hasAllowedDomains ? 'allowed_domains' : 'NULL as allowed_domains',
  ].join(', ');
  
  const stmt = db.prepare(`
    SELECT ${selectFields}
    FROM groups 
    WHERE status = 'managed' 
    ORDER BY added_at DESC
  `);
  const rows = stmt.all() as GroupRow[];
  
  // Projiziere alle DB-Rows zu Domain-Objekten (alle Normalisierung erfolgt hier)
  return rows.map(row => projectGroupRow(row));
}

export function getGroupCount(): number {
  const db = getDatabase();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM groups');
  const result = stmt.get() as { count: number };
  return result.count;
}

// Users
export function getOrCreateUser(userId: number): User {
  const db = getDatabase();
  
  // Prüfe ob User existiert
  let user: any;
  try {
    let stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
    user = stmt.get(userId) as User | undefined;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Wenn first_name Spalte fehlt, führe Query ohne first_name aus
    if (errorMessage.includes('no such column: first_name')) {
      const stmt = db.prepare(`
        SELECT user_id, first_seen, risk_score, status, account_created_at, 
               has_username, has_profile_photo, last_decay_at, is_observed, 
               risk_level, risk_reasons, last_risk_update, username
        FROM users 
        WHERE user_id = ?
      `);
      user = stmt.get(userId) as User | undefined;
    } else {
      throw error;
    }
  }
  
  if (!user) {
    // Erstelle neuen User
    const insertStmt = db.prepare(`
      INSERT INTO users (user_id, first_seen, risk_score, status, has_username, has_profile_photo, is_observed, risk_level, risk_reasons, last_risk_update)
      VALUES (?, ?, 0, 'ok', 0, 0, 0, 0, NULL, NULL)
    `);
    insertStmt.run(userId, Date.now());
    
    // Versuche erneut zu lesen
    try {
      let stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
      user = stmt.get(userId) as User;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('no such column: first_name')) {
        const stmt = db.prepare(`
          SELECT user_id, first_seen, risk_score, status, account_created_at, 
                 has_username, has_profile_photo, last_decay_at, is_observed, 
                 risk_level, risk_reasons, last_risk_update, username
          FROM users 
          WHERE user_id = ?
        `);
        user = stmt.get(userId) as User;
      } else {
        throw error;
      }
    }
  }
  
  if (!user) {
    throw new Error('User could not be created or retrieved');
  }
  
  // Konvertiere INTEGER zu boolean und füge Risk-Level-Felder hinzu
  return {
    user_id: user.user_id,
    first_seen: user.first_seen,
    risk_score: user.risk_score,
    status: user.status as UserStatus,
    account_created_at: (user as any).account_created_at || null,
    has_username: (user as any).has_username === 1,
    has_profile_photo: (user as any).has_profile_photo === 1,
    last_decay_at: (user as any).last_decay_at || null,
    is_observed: (user as any).is_observed === 1,
    risk_level: ((user as any).risk_level ?? 'CLEAN') as RiskLevel,
    risk_reasons: (user as any).risk_reasons || null,
    last_risk_update: (user as any).last_risk_update || null,
    username: (user as any).username || null,
  };
}

export function getUser(userId: number): User | null {
  const db = getDatabase();
  let user: any;
  
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE user_id = ?');
    user = stmt.get(userId) as {
      user_id: number;
      first_seen: number;
      risk_score: number;
      status: string;
      account_created_at: number | null;
      has_username: number;
      has_profile_photo: number;
      last_decay_at: number | null;
      is_observed: number;
      risk_level: number | null;
      risk_reasons: string | null;
      last_risk_update: number | null;
    } | undefined;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Wenn first_name Spalte fehlt, führe Query ohne first_name aus
    if (errorMessage.includes('no such column: first_name')) {
      const stmt = db.prepare(`
        SELECT user_id, first_seen, risk_score, status, account_created_at, 
               has_username, has_profile_photo, last_decay_at, is_observed, 
               risk_level, risk_reasons, last_risk_update, username
        FROM users 
        WHERE user_id = ?
      `);
      user = stmt.get(userId) as {
        user_id: number;
        first_seen: number;
        risk_score: number;
        status: string;
        account_created_at: number | null;
        has_username: number;
        has_profile_photo: number;
        last_decay_at: number | null;
        is_observed: number;
        risk_level: number | null;
        risk_reasons: string | null;
        last_risk_update: number | null;
      } | undefined;
    } else {
      throw error;
    }
  }
  
  if (!user) {
    return null;
  }
  
  // Konvertiere INTEGER zu boolean
  return {
    user_id: user.user_id,
    first_seen: user.first_seen,
    risk_score: user.risk_score,
    status: user.status as UserStatus,
    account_created_at: user.account_created_at,
    has_username: user.has_username === 1,
    has_profile_photo: user.has_profile_photo === 1,
    last_decay_at: user.last_decay_at,
    is_observed: user.is_observed === 1,
    risk_level: (user.risk_level ?? 'CLEAN') as RiskLevel,
    risk_reasons: user.risk_reasons,
    last_risk_update: user.last_risk_update,
    username: (user as any).username || null,
  };
}

export function updateUserStatus(userId: number, status: UserStatus): void {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE users SET status = ? WHERE user_id = ?');
  stmt.run(status, userId);
}

export function updateUserRiskScore(userId: number, riskScore: number): void {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE users SET risk_score = ? WHERE user_id = ?');
  stmt.run(Math.max(0, riskScore), userId); // Score darf nicht < 0
}

export function updateUserAccountMetadata(
  userId: number,
  accountCreatedAt: number | null,
  hasUsername: boolean,
  hasProfilePhoto: boolean
): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE users 
    SET account_created_at = ?, has_username = ?, has_profile_photo = ?
    WHERE user_id = ?
  `);
  stmt.run(accountCreatedAt, hasUsername ? 1 : 0, hasProfilePhoto ? 1 : 0, userId);
}

export function updateUserLastDecay(userId: number, timestamp: number): void {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE users SET last_decay_at = ? WHERE user_id = ?');
  stmt.run(timestamp, userId);
}

export function getAllUsersWithRiskScore(): User[] {
  const db = getDatabase();
  let users: any[];
  
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE risk_score > 0 ORDER BY risk_score DESC');
    users = stmt.all() as User[];
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Wenn first_name Spalte fehlt, führe Query ohne first_name aus
    if (errorMessage.includes('no such column: first_name')) {
      const stmt = db.prepare(`
        SELECT user_id, first_seen, risk_score, status, account_created_at, 
               has_username, has_profile_photo, last_decay_at, is_observed, 
               risk_level, risk_reasons, last_risk_update, username
        FROM users 
        WHERE risk_score > 0 
        ORDER BY risk_score DESC
      `);
      users = stmt.all() as User[];
    } else {
      throw error;
    }
  }
  
  // Konvertiere INTEGER zu boolean
  users.forEach(user => {
    user.has_username = (user.has_username as any) === 1;
    user.has_profile_photo = (user.has_profile_photo as any) === 1;
    user.is_observed = ((user as any).is_observed || 0) === 1;
  });
  
  return users;
}

/**
 * Setzt observed Status für einen User
 */
export function setUserObserved(userId: number, observed: boolean): boolean {
  const db = getDatabase();
  try {
    const stmt = db.prepare('UPDATE users SET is_observed = ? WHERE user_id = ?');
    stmt.run(observed ? 1 : 0, userId);
    return true;
  } catch (error: any) {
    console.error('[DB] Fehler beim Setzen von is_observed:', error.message);
    return false;
  }
}

/**
 * Prüft ob ein User observed ist
 */
export function isUserObserved(userId: number): boolean {
  const user = getUser(userId);
  return user?.is_observed || false;
}

/**
 * Prüft ob ein User kürzlich eskaliert wurde (Anti-Spam)
 * Returns: true wenn innerhalb des Zeitfensters (24h), false sonst
 */
export function hasRecentEscalation(userId: number, windowHours: number = 24): boolean {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM escalations
    WHERE user_id = ? AND escalated_at >= ?
  `);
  const result = stmt.get(userId, cutoffTime) as { count: number } | undefined;
  return (result?.count || 0) > 0;
}

/**
 * Speichert eine Eskalation für einen User (Anti-Spam)
 */
export function recordEscalation(
  userId: number,
  triggerType: 'join' | 'activity' | 'multi_join',
  chatId?: string
): void {
  const db = getDatabase();
  try {
    const stmt = db.prepare(`
      INSERT INTO escalations (user_id, escalated_at, trigger_type, chat_id)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(userId, Date.now(), triggerType, chatId || null);
  } catch (error: any) {
    console.error('[DB] Fehler beim Speichern von Eskalation:', error.message);
  }
}

/**
 * Holt die Anzahl der Joins eines Users in den letzten 24 Stunden
 */
export function getJoinCount24h(userId: number): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM joins
    WHERE user_id = ? AND joined_at >= ?
  `);
  const result = stmt.get(userId, cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Prüft ob ein User kürzlich eine Impersonation-Warnung erhalten hat (Anti-Spam)
 * Returns: true wenn innerhalb des Zeitfensters (24h), false sonst
 */
export function hasRecentImpersonationWarning(userId: number, windowHours: number = 24): boolean {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  // Nutze escalations Tabelle mit trigger_type 'impersonation' für Impersonation-Warnungen
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM escalations
    WHERE user_id = ? AND escalated_at >= ? AND trigger_type = 'impersonation'
  `);
  const result = stmt.get(userId, cutoffTime) as { count: number } | undefined;
  return (result?.count || 0) > 0;
}

/**
 * Speichert eine Impersonation-Warnung für einen User (Anti-Spam)
 */
export function recordImpersonationWarning(
  userId: number,
  chatId?: string
): void {
  const db = getDatabase();
  try {
    const stmt = db.prepare(`
      INSERT INTO escalations (user_id, escalated_at, trigger_type, chat_id)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(userId, Date.now(), 'impersonation', chatId || null);
  } catch (error: any) {
    console.error('[DB] Fehler beim Speichern von Impersonation-Warnung:', error.message);
  }
}

// ============================================================================
// Statistiken
// ============================================================================

export interface ShieldStatistics {
  managedGroups: number;
  globalBans: number;
  observedUsers: number;
  impersonationWarnings: number;
  lastEventTime: number | null;
  topGroups: Array<{ chatId: string; title: string; eventCount: number }>;
}

/**
 * Aggregiert Shield-Statistiken für einen Zeitraum
 * windowHours: 24 für heute, 168 für letzte 7 Tage
 */
export function getShieldStatistics(windowHours: number = 24): ShieldStatistics {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  
  // Anzahl MANAGED-Gruppen
  const managedGroupsStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM groups
    WHERE status = 'managed'
  `);
  const managedGroupsResult = managedGroupsStmt.get() as { count: number } | undefined;
  const managedGroups = managedGroupsResult?.count || 0;
  
  // Anzahl globaler Bans (aus Blacklist)
  const globalBansStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM blacklist
    WHERE banned_at >= ?
  `);
  const globalBansResult = globalBansStmt.get(cutoffTime) as { count: number } | undefined;
  const globalBans = globalBansResult?.count || 0;
  
  // Anzahl beobachteter User
  const observedUsersStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM users
    WHERE is_observed = 1
  `);
  const observedUsersResult = observedUsersStmt.get() as { count: number } | undefined;
  const observedUsers = observedUsersResult?.count || 0;
  
  // DeletedAccount-AutoRemove wurde entfernt - keine Statistik mehr nötig
  
  // Anzahl Impersonation-Warnungen
  const impersonationWarningsStmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM escalations
    WHERE trigger_type = 'impersonation'
      AND escalated_at >= ?
  `);
  const impersonationWarningsResult = impersonationWarningsStmt.get(cutoffTime) as { count: number } | undefined;
  const impersonationWarnings = impersonationWarningsResult?.count || 0;
  
  // Zeitpunkt des letzten Events (aus actions oder escalations) - innerhalb des Zeitfensters
  let lastEventTime: number | null = null;
  
  // Prüfe actions
  const lastActionStmt = db.prepare(`
    SELECT MAX(created_at) as max_time
    FROM actions
    WHERE created_at >= ?
  `);
  const lastActionResult = lastActionStmt.get(cutoffTime) as { max_time: number | null } | undefined;
  const lastActionTime = lastActionResult?.max_time || null;
  
  // Prüfe escalations
  const lastEscalationStmt = db.prepare(`
    SELECT MAX(escalated_at) as max_time
    FROM escalations
    WHERE escalated_at >= ?
  `);
  const lastEscalationResult = lastEscalationStmt.get(cutoffTime) as { max_time: number | null } | undefined;
  const lastEscalationTime = lastEscalationResult?.max_time || null;
  
  // Nimm das neueste Event
  if (lastActionTime && lastEscalationTime) {
    lastEventTime = Math.max(lastActionTime, lastEscalationTime);
  } else if (lastActionTime) {
    lastEventTime = lastActionTime;
  } else if (lastEscalationTime) {
    lastEventTime = lastEscalationTime;
  }
  
  // Top 3 auffälligste Gruppen (nach Event-Anzahl)
  const topGroupsStmt = db.prepare(`
    SELECT 
      a.chat_id,
      COUNT(*) as event_count
    FROM actions a
    WHERE a.created_at >= ?
    GROUP BY a.chat_id
    ORDER BY event_count DESC
    LIMIT 3
  `);
  const topGroupsResults = topGroupsStmt.all(cutoffTime) as Array<{ chat_id: string; event_count: number }>;
  
  // Hole Gruppentitel für Top-Gruppen
  const topGroups: Array<{ chatId: string; title: string; eventCount: number }> = [];
  for (const groupData of topGroupsResults) {
    const group = getGroup(groupData.chat_id);
    topGroups.push({
      chatId: groupData.chat_id,
      title: group?.title || 'Unbekannt',
      eventCount: groupData.event_count
    });
  }
  
  return {
    managedGroups,
    globalBans,
    observedUsers,
    impersonationWarnings,
    lastEventTime,
    topGroups,
  };
}

// Joins
/**
 * Stellt sicher, dass eine Gruppe in der Datenbank existiert (idempotent)
 */
export function ensureGroupExists(chatId: string, title: string | null = null): void {
  const db = getDatabase();
  
  // Prüfe ob Gruppe bereits existiert
  const existing = db.prepare('SELECT chat_id FROM groups WHERE chat_id = ?').get(chatId);
  
  if (!existing) {
    // Neue Gruppe erstellen (idempotent durch INSERT OR IGNORE)
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO groups (chat_id, title, added_at, status)
        VALUES (?, ?, ?, 'known')
      `);
      stmt.run(chatId, title, Date.now());
      console.log(`[DB] ensure group OK: ${chatId}`);
    } catch (error: any) {
      // Falls INSERT OR IGNORE nicht funktioniert, verwende normale INSERT mit try-catch
      if (error.message.includes('UNIQUE constraint') || error.message.includes('PRIMARY KEY')) {
        // Gruppe existiert bereits (Race Condition) - OK
        console.log(`[DB] ensure group OK (race condition): ${chatId}`);
      } else {
        console.error(`[DB][ERROR] ensure group failed: ${chatId}`, error.message);
        throw error;
      }
    }
  }
  
  // Stelle sicher, dass group_config existiert (automatisch beim ersten Sehen)
  ensureGroupConfig(chatId);
}

/**
 * Stellt sicher, dass ein User in der Datenbank existiert (idempotent)
 */
export function ensureUserExists(userId: number): void {
  const db = getDatabase();
  
  // Prüfe ob User bereits existiert
  const existing = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userId);
  
  if (!existing) {
    // Neuen User erstellen (idempotent durch INSERT OR IGNORE)
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO users (user_id, first_seen, risk_score, status, has_username, has_profile_photo, is_observed)
        VALUES (?, ?, 0, 'ok', 0, 0, 0)
      `);
      stmt.run(userId, Date.now());
      console.log(`[DB] ensure user OK: ${userId}`);
    } catch (error: any) {
      // Falls INSERT OR IGNORE nicht funktioniert, verwende normale INSERT mit try-catch
      if (error.message.includes('UNIQUE constraint') || error.message.includes('PRIMARY KEY')) {
        // User existiert bereits (Race Condition) - OK
        console.log(`[DB] operation=ensureUser keys=user_id:${userId} constraint=UNIQUE (already exists)`);
      } else {
        console.error(`[DB] operation=ensureUser keys=user_id:${userId} error=${error.message}`);
        throw error;
      }
    }
  }
}

/**
 * Prüft ob ein Join für user_id + chat_id in den letzten 60 Sekunden bereits existiert
 * (Deduplizierung für chat_member + new_chat_members Events)
 */
export function hasRecentJoin(userId: number, chatId: string, windowSeconds: number = 60): boolean {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowSeconds * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM joins
    WHERE user_id = ? AND chat_id = ? AND joined_at >= ?
  `);
  const result = stmt.get(userId, chatId, cutoffTime) as { count: number } | undefined;
  return (result?.count || 0) > 0;
}

/**
 * Erfasst einen Join-Event in der DB (mit Transaktion)
 * 
 * WICHTIG: Diese Funktion führt ensureUserExists(), ensureGroupExists() und insertJoin()
 * in einer Transaktion aus, um FOREIGN KEY Fehler zu vermeiden.
 * 
 * Reihenfolge in Transaktion:
 * 1. ensureUserExists(userId)
 * 2. ensureGroupExists(chatId)
 * 3. insertJoin(userId, chatId)
 */
export function recordJoin(userId: number, chatId: string, title: string | null = null): void {
  const db = getDatabase();
  
  try {
    // Transaktion: ensureUser → ensureGroup → insertJoin
    const transaction = db.transaction(() => {
      // 1. Stelle sicher, dass User existiert
      ensureUserExists(userId);
      
      // 2. Stelle sicher, dass Group existiert
      ensureGroupExists(chatId, title);
      
      // 3. INSERT Join (User und Group existieren jetzt garantiert)
      // Idempotent: INSERT OR IGNORE verhindert Duplikate (UNIQUE constraint)
      const joinedAt = Date.now();
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO joins (user_id, chat_id, joined_at)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(userId, chatId, joinedAt);
      
      if (result.changes === 0) {
        // Duplikat erkannt (UNIQUE constraint) - OK, aber loggen
        console.log(`[DB] operation=join keys=user_id:${userId},chat_id:${chatId} constraint=UNIQUE (duplicate ignored)`);
      } else {
        console.log(`[DB] join recorded: user=${userId} chat=${chatId} joined_at=${joinedAt}`);
      }
    });
    
    transaction();
  } catch (error: any) {
    // Fail-safe: Logge Fehler, aber lasse Bot nicht abbrechen
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any).code;
    
    // Constraint-Fehler spezifisch loggen
    if (errorMessage.includes('UNIQUE constraint') || errorMessage.includes('UNIQUE') || errorCode === 'SQLITE_CONSTRAINT_UNIQUE') {
      console.log(`[DB] operation=join keys=user_id:${userId},chat_id:${chatId} constraint=UNIQUE (duplicate ignored)`);
      return; // Duplikat - OK, kein Retry nötig
    }
    
    // FOREIGN KEY constraint failed
    if (errorMessage.includes('FOREIGN KEY') || errorMessage.includes('constraint failed') || errorCode === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      console.error(`[DB] operation=join keys=user_id:${userId},chat_id:${chatId} constraint=FOREIGN_KEY error=${errorMessage}`);
      // Retry mit expliziter ensureUser/ensureGroup
      try {
        const retryTransaction = db.transaction(() => {
          ensureUserExists(userId);
          ensureGroupExists(chatId, title);
          const joinedAt = Date.now();
          const stmt = db.prepare(`
            INSERT OR IGNORE INTO joins (user_id, chat_id, joined_at)
            VALUES (?, ?, ?)
          `);
          const result = stmt.run(userId, chatId, joinedAt);
          if (result.changes === 0) {
            console.log(`[DB] operation=join keys=user_id:${userId},chat_id:${chatId} constraint=UNIQUE (retry duplicate ignored)`);
          } else {
            console.log(`[DB] join retry successful: user=${userId} chat=${chatId}`);
          }
        });
        
        retryTransaction();
      } catch (retryError: any) {
        const retryErrorMessage = retryError instanceof Error ? retryError.message : String(retryError);
        console.error(`[DB] operation=join keys=user_id:${userId},chat_id:${chatId} constraint=RETRY_FAILED error=${retryErrorMessage}`);
        // Bot darf nicht abbrechen - Event wird verworfen, aber Bot läuft weiter
      }
      return;
    }
    
    // Andere Fehler
    console.error(`[DB] operation=join keys=user_id:${userId},chat_id:${chatId} error=${errorMessage}`);
    // Bot darf nicht abbrechen - Event wird verworfen, aber Bot läuft weiter
  }
}

export function getJoinsInWindow(userId: number, windowHours: number): Join[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT * FROM joins
    WHERE user_id = ? AND joined_at >= ?
    ORDER BY joined_at DESC
  `);
  return stmt.all(userId, cutoffTime) as Join[];
}

export function getJoinsInLastHour(userId: number): Join[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (60 * 60 * 1000); // 1 Stunde
  const stmt = db.prepare(`
    SELECT * FROM joins
    WHERE user_id = ? AND joined_at >= ?
    ORDER BY joined_at DESC
  `);
  return stmt.all(userId, cutoffTime) as Join[];
}

export function getDistinctChatsInWindow(userId: number, windowHours: number): string[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT DISTINCT chat_id FROM joins
    WHERE user_id = ? AND joined_at >= ?
  `);
  const results = stmt.all(userId, cutoffTime) as { chat_id: string }[];
  return results.map(r => r.chat_id);
}

/**
 * Gibt Anzahl Joins in einer Gruppe in den letzten 24h zurück
 */
export function getJoinCount24hForGroup(chatId: string): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM joins
    WHERE chat_id = ? AND joined_at >= ?
  `);
  const result = stmt.get(chatId, cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Gibt User mit bestimmten Risk-Level in einer Gruppe zurück (innerhalb eines Zeitfensters)
 */
export function getUsersWithRiskLevel(chatId: string, riskLevel: RiskLevel, windowHours: number): number[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT DISTINCT j.user_id
    FROM joins j
    INNER JOIN users u ON j.user_id = u.user_id
    WHERE j.chat_id = ? AND j.joined_at >= ? AND u.risk_level = ?
  `);
  const results = stmt.all(chatId, cutoffTime, riskLevel) as { user_id: number }[];
  return results.map(r => r.user_id);
}

/**
 * Gibt Anzahl Bans in einer Gruppe innerhalb eines Zeitfensters zurück
 */
export function getBansInWindow(chatId: string, windowHours: number): number[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT DISTINCT user_id FROM actions
    WHERE chat_id = ? AND action = 'ban' AND created_at >= ?
  `);
  const results = stmt.all(chatId, cutoffTime) as { user_id: number }[];
  return results.map(r => r.user_id);
}

/**
 * Holt alle User-IDs, die in managed groups sind
 * (basierend auf joins in den letzten 90 Tagen, um API-Calls zu reduzieren)
 */
export function getUserIdsInManagedGroups(daysWindow: number = 90): Array<{ user_id: number; chat_id: string }> {
  const db = getDatabase();
  const cutoffTime = Date.now() - (daysWindow * 24 * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT DISTINCT j.user_id, j.chat_id
    FROM joins j
    INNER JOIN groups g ON j.chat_id = g.chat_id
    WHERE g.status = 'managed'
      AND j.joined_at >= ?
  `);
  return stmt.all(cutoffTime) as Array<{ user_id: number; chat_id: string }>;
}

// Actions
export function logAction(
  userId: number,
  chatId: string,
  action: ActionType,
  reason: string | null = null
): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO actions (user_id, chat_id, action, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(userId, chatId, action, reason, Date.now());
}

export function getRecentActions(userId: number, limit: number = 10): Action[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM actions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(userId, limit) as Action[];
}

// Blacklist
export interface BlacklistEntry {
  user_id: number;
  banned_by: number;
  banned_at: number;
  reason: string | null;
}

/**
 * Fügt einen User zur Blacklist hinzu
 */
export function addToBlacklist(userId: number, bannedBy: number, reason: string | null = null): boolean {
  const db = getDatabase();
  try {
    // Prüfe ob bereits vorhanden
    const existing = db.prepare('SELECT user_id FROM blacklist WHERE user_id = ?').get(userId);
    if (existing) {
      // Update nur reason wenn nicht leer
      if (reason) {
        const stmt = db.prepare('UPDATE blacklist SET reason = ? WHERE user_id = ?');
        stmt.run(reason, userId);
      }
      return true;
    }
    
    // Neue Eintrag
    const stmt = db.prepare(`
      INSERT INTO blacklist (user_id, banned_by, banned_at, reason)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(userId, bannedBy, Date.now(), reason);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Hinzufügen zur Blacklist:', errorMessage);
    return false;
  }
}

/**
 * Prüft ob ein User in der Blacklist ist
 */
export function isBlacklisted(userId: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('SELECT user_id FROM blacklist WHERE user_id = ?');
  const result = stmt.get(userId) as { user_id: number } | undefined;
  return !!result;
}

/**
 * Holt einen Blacklist-Eintrag
 */
export function getBlacklistEntry(userId: number): BlacklistEntry | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM blacklist WHERE user_id = ?');
  return (stmt.get(userId) as BlacklistEntry | undefined) || null;
}

/**
 * Entfernt einen User aus der Blacklist
 */
export function removeFromBlacklist(userId: number): boolean {
  const db = getDatabase();
  try {
    const stmt = db.prepare('DELETE FROM blacklist WHERE user_id = ?');
    const result = stmt.run(userId);
    return result.changes > 0;
  } catch (error: any) {
    console.error('[DB] Fehler beim Entfernen aus Blacklist:', error.message);
    return false;
  }
}

// Team Members
export interface TeamMember {
  user_id: number;
  added_by: number;
  added_at: number;
}

/**
 * Fügt einen User zum Team hinzu
 */
export interface TeamMember {
  user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  added_by: number;
  added_at: number;
  note: string | null;
}

export function addTeamMember(
  userId: number,
  addedBy: number,
  userInfo?: { username?: string; firstName?: string; lastName?: string },
  note?: string
): boolean {
  const db = getDatabase();
  try {
    // Prüfe ob bereits im Team
    const existing = db.prepare('SELECT user_id FROM team_members WHERE user_id = ?').get(userId);
    if (existing) {
      // Update userInfo falls vorhanden - nur Felder verwenden, die existieren
      if (userInfo || note) {
        // Prüfe welche Spalten existieren
        const teamMembersColumns = db.prepare('PRAGMA table_info(team_members)').all() as Array<{ name: string }>;
        const hasUsername = teamMembersColumns.some(col => col.name === 'username');
        const hasFirstName = teamMembersColumns.some(col => col.name === 'first_name');
        const hasLastName = teamMembersColumns.some(col => col.name === 'last_name');
        
        const setParts: string[] = [];
        const values: any[] = [];
        
        if (hasUsername && userInfo?.username !== undefined) {
          setParts.push('username = COALESCE(?, username)');
          values.push(userInfo.username || '');
        }
        if (hasFirstName && userInfo?.firstName !== undefined) {
          setParts.push('first_name = COALESCE(?, first_name)');
          values.push(userInfo.firstName || '');
        }
        if (hasLastName && userInfo?.lastName !== undefined) {
          setParts.push('last_name = COALESCE(?, last_name)');
          values.push(userInfo.lastName || '');
        }
        if (note !== undefined) {
          setParts.push('note = COALESCE(?, note)');
          values.push(note || null);
        }
        
        if (setParts.length > 0) {
          values.push(userId);
          const updateStmt = db.prepare(`
            UPDATE team_members 
            SET ${setParts.join(', ')}
            WHERE user_id = ?
          `);
          updateStmt.run(...values);
        }
      }
      return true; // Bereits im Team
    }
    
    // Stelle sicher, dass User in users-Tabelle existiert
    getOrCreateUser(userId);
    
    // Prüfe welche Spalten existieren, bevor wir INSERT ausführen
    const teamMembersColumns = db.prepare('PRAGMA table_info(team_members)').all() as Array<{ name: string }>;
    const hasUsername = teamMembersColumns.some(col => col.name === 'username');
    const hasFirstName = teamMembersColumns.some(col => col.name === 'first_name');
    const hasLastName = teamMembersColumns.some(col => col.name === 'last_name');
    
    // Baue INSERT dynamisch auf, nur mit existierenden Spalten
    const insertFields = ['user_id', 'added_by', 'added_at'];
    const insertValues: any[] = [userId, addedBy, Date.now()];
    
    if (hasUsername) {
      insertFields.push('username');
      insertValues.push(userInfo?.username ?? '');
    }
    if (hasFirstName) {
      insertFields.push('first_name');
      insertValues.push(userInfo?.firstName ?? '');
    }
    if (hasLastName) {
      insertFields.push('last_name');
      insertValues.push(userInfo?.lastName ?? '');
    }
    if (note !== undefined) {
      insertFields.push('note');
      insertValues.push(note || null);
    }
    
    // Füge zum Team hinzu
    const stmt = db.prepare(`
      INSERT INTO team_members (${insertFields.join(', ')})
      VALUES (${insertFields.map(() => '?').join(', ')})
    `);
    stmt.run(...insertValues);
    
    // Entferne User automatisch aus Blacklist und Observed-Status
    removeFromBlacklist(userId);
    setUserObserved(userId, false);
    
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Hinzufügen zum Team:', errorMessage);
    return false;
  }
}

/**
 * Entfernt einen User aus dem Team
 */
export function removeTeamMember(userId: number): boolean {
  const db = getDatabase();
  try {
    const stmt = db.prepare('DELETE FROM team_members WHERE user_id = ?');
    const result = stmt.run(userId);
    return result.changes > 0;
  } catch (error: any) {
    console.error('[DB] Fehler beim Entfernen aus Team:', error.message);
    return false;
  }
}

/**
 * Prüft ob ein User im Team ist
 */
export function isTeamMember(userId: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('SELECT user_id FROM team_members WHERE user_id = ?');
  const result = stmt.get(userId) as { user_id: number } | undefined;
  return !!result;
}

/**
 * Prüft ob ein Username im Team ist (auch pending)
 */
export function isTeamMemberByUsername(username: string): boolean {
  const db = getDatabase();
  const normalizedUsername = username.replace('@', '').toLowerCase();
  
  // Prüfe team_members
  const stmt = db.prepare('SELECT user_id FROM team_members WHERE LOWER(username) = ?');
  const result = stmt.get(normalizedUsername) as { user_id: number } | undefined;
  if (result) {
    return true;
  }
  
  // Prüfe pending_team_usernames
  const pendingStmt = db.prepare('SELECT username FROM pending_team_usernames WHERE LOWER(username) = ?');
  const pendingResult = pendingStmt.get(normalizedUsername) as { username: string } | undefined;
  return !!pendingResult;
}

/**
 * Holt alle Team-Mitglieder
 */
export function getTeamMembers(): TeamMember[] {
  const db = getDatabase();
  
  // Versuche Query mit username
  try {
    const stmt = db.prepare(`
      SELECT user_id, username, first_name, last_name, added_by, added_at, note
      FROM team_members
      ORDER BY added_at ASC
    `);
    const results = stmt.all() as Array<{
      user_id: number;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      added_by: number;
      added_at: number;
      note: string | null;
    }>;
    
    return results.map(r => ({
      user_id: r.user_id,
      username: r.username,
      first_name: r.first_name,
      last_name: r.last_name,
      added_by: r.added_by,
      added_at: r.added_at,
      note: r.note,
    }));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Wenn username-Spalte fehlt, führe Query ohne username aus
    if (errorMessage.includes('no such column: username')) {
      const stmt = db.prepare(`
        SELECT user_id, first_name, last_name, added_by, added_at, note
        FROM team_members
        ORDER BY added_at ASC
      `);
      const results = stmt.all() as Array<{
        user_id: number;
        first_name: string | null;
        last_name: string | null;
        added_by: number;
        added_at: number;
        note: string | null;
      }>;
      
      return results.map(r => ({
        user_id: r.user_id,
        username: null,
        first_name: r.first_name,
        last_name: r.last_name,
        added_by: r.added_by,
        added_at: r.added_at,
        note: r.note,
      }));
    }
    
    // Andere Fehler weiterwerfen
    throw error;
  }
}

/**
 * Fügt einen Username zur pending_team_usernames hinzu
 */
export function addPendingTeamUsername(
  username: string,
  addedBy: number,
  note?: string
): boolean {
  const db = getDatabase();
  try {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO pending_team_usernames (username, added_by, added_at, note)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(normalizedUsername, addedBy, Date.now(), note || null);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Hinzufügen von pending team username:', errorMessage);
    return false;
  }
}

/**
 * Entfernt einen Username aus pending_team_usernames
 */
export function removePendingTeamUsername(username: string): boolean {
  const db = getDatabase();
  try {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    const stmt = db.prepare('DELETE FROM pending_team_usernames WHERE LOWER(username) = ?');
    const result = stmt.run(normalizedUsername);
    return result.changes > 0;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Entfernen von pending team username:', errorMessage);
    return false;
  }
}

/**
 * Konvertiert pending team username zu team_member (wenn User sichtbar wird)
 */
export function convertPendingTeamUsernameToMember(
  userId: number,
  username: string,
  userInfo?: { firstName?: string; lastName?: string }
): boolean {
  const db = getDatabase();
  try {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    
    // Hole pending entry
    const pendingStmt = db.prepare('SELECT * FROM pending_team_usernames WHERE LOWER(username) = ?');
    const pending = pendingStmt.get(normalizedUsername) as {
      username: string;
      added_by: number;
      added_at: number;
      note: string | null;
    } | undefined;
    
    if (!pending) {
      return false; // Nicht in pending
    }
    
    // Füge zu team_members hinzu
    const addResult = addTeamMember(
      userId,
      pending.added_by,
      { username, firstName: userInfo?.firstName, lastName: userInfo?.lastName },
      pending.note || undefined
    );
    
    if (addResult) {
      // Entferne aus pending
      removePendingTeamUsername(username);
      return true;
    }
    
    return false;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Konvertieren von pending team username:', errorMessage);
    return false;
  }
}

/**
 * Holt alle pending team usernames
 */
export function getPendingTeamUsernames(): Array<{ username: string; added_by: number; added_at: number; note: string | null }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT username, added_by, added_at, note
    FROM pending_team_usernames
    ORDER BY added_at ASC
  `);
  return stmt.all() as Array<{ username: string; added_by: number; added_at: number; note: string | null }>;
}

// ============================================================================
// Content Moderation (Blocklist)
// ============================================================================

export type BlocklistAction = 'DELETE' | 'KICK' | 'BAN' | 'RESTRICT';

export interface BlocklistRule {
  id: number;
  name: string;
  reason: string;
  action: BlocklistAction;
  delete_message: boolean;
  added_at: number;
  added_by: number;
}

export function getAllBlocklistRules(): BlocklistRule[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM content_blocklist ORDER BY name ASC');
  return stmt.all() as BlocklistRule[];
}

export function addBlocklistRule(
  name: string,
  reason: string,
  action: BlocklistAction,
  deleteMessage: boolean,
  addedBy: number
): boolean {
  const db = getDatabase();
  try {
    const stmt = db.prepare(`
      INSERT INTO content_blocklist (name, reason, action, delete_message, added_at, added_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(name.toLowerCase(), reason, action, deleteMessage ? 1 : 0, Date.now(), addedBy);
    return true;
  } catch (error: any) {
    console.error('[DB] Fehler beim Hinzufügen zur Blocklist:', error.message);
    return false;
  }
}

export function removeBlocklistRule(name: string): boolean {
  const db = getDatabase();
  try {
    const stmt = db.prepare('DELETE FROM content_blocklist WHERE name = ?');
    const result = stmt.run(name.toLowerCase());
    return result.changes > 0;
  } catch (error: any) {
    console.error('[DB] Fehler beim Entfernen aus Blocklist:', error.message);
    return false;
  }
}

export function checkBlocklist(text: string): BlocklistRule | null {
  if (!text) return null;
  
  const db = getDatabase();
  const rules = getAllBlocklistRules();
  const lowerText = text.toLowerCase();
  
  for (const rule of rules) {
    if (lowerText.includes(rule.name.toLowerCase())) {
      return rule;
    }
  }
  
  return null;
}

// ============================================================================
// Group Moderation Settings
// ============================================================================

export interface GroupModerationSettings {
  chat_id: string;
  links_locked: boolean;
  forward_locked: boolean;
}

export function getGroupModerationSettings(chatId: string): GroupModerationSettings | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM group_moderation_settings WHERE chat_id = ?');
  const result = stmt.get(chatId) as GroupModerationSettings | undefined;
  
  if (!result) {
    // Default-Werte zurückgeben
    return {
      chat_id: chatId,
      links_locked: true, // Default: links locked
      forward_locked: true, // Default: forward locked
    };
  }
  
  // Konvertiere INTEGER zu boolean
  return {
    ...result,
    links_locked: (result.links_locked as any) === 1,
    forward_locked: (result.forward_locked as any) === 1,
  };
}

export function setGroupModerationSettings(
  chatId: string,
  linksLocked: boolean | null,
  forwardLocked: boolean | null
): void {
  const db = getDatabase();
  
  // Prüfe ob Eintrag existiert
  const existing = db.prepare('SELECT chat_id FROM group_moderation_settings WHERE chat_id = ?').get(chatId);
  
  if (!existing) {
    // Neuer Eintrag
    const stmt = db.prepare(`
      INSERT INTO group_moderation_settings (chat_id, links_locked, forward_locked)
      VALUES (?, ?, ?)
    `);
    stmt.run(
      chatId,
      linksLocked !== null ? (linksLocked ? 1 : 0) : 1, // Default: true
      forwardLocked !== null ? (forwardLocked ? 1 : 0) : 1 // Default: true
    );
  } else {
    // Update bestehender Eintrag
    if (linksLocked !== null || forwardLocked !== null) {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (linksLocked !== null) {
        updates.push('links_locked = ?');
        values.push(linksLocked ? 1 : 0);
      }
      
      if (forwardLocked !== null) {
        updates.push('forward_locked = ?');
        values.push(forwardLocked ? 1 : 0);
      }
      
      values.push(chatId);
      const stmt = db.prepare(`
        UPDATE group_moderation_settings
        SET ${updates.join(', ')}
        WHERE chat_id = ?
      `);
      stmt.run(...values);
    }
  }
}

/**
 * Normalisiert einen Username (lowercase, ohne @)
 */
function normalizeUsername(username: string): string {
  return username.replace(/^@/, '').toLowerCase().trim();
}

/**
 * Fügt einen Username zur Username-Blacklist hinzu
 */
export function addUsernameToBlacklist(username: string, addedBy: number): boolean {
  const db = getDatabase();
  try {
    const normalized = normalizeUsername(username);
    if (!normalized) {
      return false;
    }
    
    // Prüfe ob bereits vorhanden
    const existing = db.prepare('SELECT username FROM username_blacklist WHERE username = ?').get(normalized);
    if (existing) {
      // Update added_by und added_at
      const stmt = db.prepare('UPDATE username_blacklist SET added_by = ?, added_at = ? WHERE username = ?');
      stmt.run(addedBy, Date.now(), normalized);
      return true;
    }
    
    // Neuer Eintrag
    const stmt = db.prepare(`
      INSERT INTO username_blacklist (username, added_at, added_by)
      VALUES (?, ?, ?)
    `);
    stmt.run(normalized, Date.now(), addedBy);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Hinzufügen zur Username-Blacklist:', errorMessage);
    return false;
  }
}

/**
 * Prüft ob ein Username in der Username-Blacklist ist
 */
export function isUsernameBlacklisted(username: string | null | undefined): boolean {
  if (!username) {
    return false;
  }
  
  const db = getDatabase();
  const normalized = normalizeUsername(username);
  const stmt = db.prepare('SELECT username FROM username_blacklist WHERE username = ?');
  const result = stmt.get(normalized) as { username: string } | undefined;
  return !!result;
}

/**
 * Fügt einen Username zur pending_username_blacklist hinzu
 */
export function addPendingUsernameBlacklist(
  username: string,
  createdBy: number,
  reason?: string
): boolean {
  const db = getDatabase();
  try {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO pending_username_blacklist (username, reason, created_by, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(normalizedUsername, reason || null, createdBy, Date.now());
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Hinzufügen von pending username blacklist:', errorMessage);
    return false;
  }
}

/**
 * Entfernt einen Username aus pending_username_blacklist
 */
export function removePendingUsernameBlacklist(username: string): boolean {
  const db = getDatabase();
  try {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    const stmt = db.prepare('DELETE FROM pending_username_blacklist WHERE LOWER(username) = ?');
    const result = stmt.run(normalizedUsername);
    return result.changes > 0;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Entfernen von pending username blacklist:', errorMessage);
    return false;
  }
}

/**
 * Prüft ob ein Username in pending_username_blacklist ist
 */
export function isPendingUsernameBlacklisted(username: string): boolean {
  const db = getDatabase();
  const normalizedUsername = username.replace('@', '').toLowerCase();
  const stmt = db.prepare('SELECT username FROM pending_username_blacklist WHERE LOWER(username) = ?');
  const result = stmt.get(normalizedUsername) as { username: string } | undefined;
  return !!result;
}

/**
 * Holt pending username blacklist entry
 */
export function getPendingUsernameBlacklistEntry(username: string): { username: string; reason: string | null; created_by: number; created_at: number } | null {
  const db = getDatabase();
  const normalizedUsername = username.replace('@', '').toLowerCase();
  const stmt = db.prepare('SELECT * FROM pending_username_blacklist WHERE LOWER(username) = ?');
  const result = stmt.get(normalizedUsername) as {
    username: string;
    reason: string | null;
    created_by: number;
    created_at: number;
  } | undefined;
  return result || null;
}

/**
 * Holt alle pending username blacklist entries
 */
export function getPendingUsernameBlacklist(): Array<{ username: string; reason: string | null; created_by: number; created_at: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT username, reason, created_by, created_at
    FROM pending_username_blacklist
    ORDER BY created_at ASC
  `);
  return stmt.all() as Array<{ username: string; reason: string | null; created_by: number; created_at: number }>;
}

/**
 * Konvertiert pending username blacklist zu user_id ban (wenn User sichtbar wird)
 */
export function convertPendingUsernameBlacklistToBan(
  userId: number,
  username: string
): { success: boolean; reason: string | null } {
  const db = getDatabase();
  try {
    const normalizedUsername = username.replace('@', '').toLowerCase();
    
    // Hole pending entry
    const pending = getPendingUsernameBlacklistEntry(username);
    if (!pending) {
      return { success: false, reason: null };
    }
    
    // Füge zu blacklist hinzu
    const banResult = addToBlacklist(userId, pending.created_by, pending.reason);
    
    if (banResult) {
      // Entferne aus pending
      removePendingUsernameBlacklist(username);
      return { success: true, reason: pending.reason };
    }
    
    return { success: false, reason: null };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Konvertieren von pending username blacklist:', errorMessage);
    return { success: false, reason: null };
  }
}

/**
 * Holt alle User-IDs mit einem bestimmten Username aus der Datenbank
 * Sucht in baseline_members, joins und anderen relevanten Tabellen
 */
export function getUsersByUsername(username: string): number[] {
  const db = getDatabase();
  const normalized = normalizeUsername(username);
  if (!normalized) {
    return [];
  }
  
  const userIds = new Set<number>();
  
  // Aus baseline_members
  const baselineStmt = db.prepare(`
    SELECT DISTINCT user_id FROM baseline_members WHERE LOWER(username) = ?
  `);
  const baseline = baselineStmt.all(normalized) as Array<{ user_id: number }>;
  baseline.forEach(row => userIds.add(row.user_id));
  
  // Aus joins (über users Tabelle - aber users hat keinen username direkt)
  // Wir müssen über andere Wege suchen - z.B. über getChatMember bei bekannten Gruppen
  // Da wir keine Mitgliederlisten-APIs nutzen können, beschränken wir uns auf baseline_members
  
  return Array.from(userIds);
}

/**
 * Holt Username-Blacklist-Eintrag
 */
export interface UsernameBlacklistEntry {
  username: string;
  added_at: number;
  added_by: number;
}

export function getUsernameBlacklistEntry(username: string): UsernameBlacklistEntry | null {
  const db = getDatabase();
  const normalized = normalizeUsername(username);
  const stmt = db.prepare('SELECT * FROM username_blacklist WHERE username = ?');
  return (stmt.get(normalized) as UsernameBlacklistEntry | undefined) || null;
}

/**
 * Entfernt einen Username aus der Username-Blacklist
 */
export function removeUsernameFromBlacklist(username: string): boolean {
  const db = getDatabase();
  try {
    const normalized = normalizeUsername(username);
    const stmt = db.prepare('DELETE FROM username_blacklist WHERE username = ?');
    stmt.run(normalized);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Entfernen aus der Username-Blacklist:', errorMessage);
    return false;
  }
}

// ============================================================================
// Cluster-Erkennung
// ============================================================================

/**
 * Speichert einen Cluster
 */
export function saveCluster(level: 1 | 2 | 3, userIds: number[], groupIds: string[], banned: boolean = false, reason?: string): number {
  const db = getDatabase();
  try {
    const stmt = db.prepare(`
      INSERT INTO clusters (level, created_at, user_ids, group_ids, banned, reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(level, Date.now(), JSON.stringify(userIds), JSON.stringify(groupIds), banned ? 1 : 0, reason || null);
    const clusterId = result.lastInsertRowid as number;
    
    // Speichere Cluster-Mitglieder (für Prompt 5)
    if (clusterId > 0) {
      const memberStmt = db.prepare(`
        INSERT OR IGNORE INTO cluster_members (cluster_id, user_id)
        VALUES (?, ?)
      `);
      for (const userId of userIds) {
        memberStmt.run(clusterId, userId);
      }
    }
    
    return clusterId;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Speichern von Cluster:', errorMessage);
    return 0;
  }
}

/**
 * Holt alle User-IDs, die in den letzten X Stunden in managed Gruppen gejoint sind
 */
export function getUserIdsWithJoinsInWindow(windowHours: number): number[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT DISTINCT j.user_id
    FROM joins j
    INNER JOIN groups g ON j.chat_id = g.chat_id
    WHERE g.status = 'managed'
      AND j.joined_at >= ?
  `);
  const results = stmt.all(cutoffTime) as { user_id: number }[];
  return results.map(r => r.user_id);
}

/**
 * Holt alle managed Gruppen-IDs, die ein User in einem Zeitfenster gejoint hat
 */
export function getManagedGroupsForUser(userId: number, windowHours: number): string[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT DISTINCT j.chat_id
    FROM joins j
    INNER JOIN groups g ON j.chat_id = g.chat_id
    WHERE j.user_id = ?
      AND g.status = 'managed'
      AND j.joined_at >= ?
  `);
  const results = stmt.all(userId, cutoffTime) as { chat_id: string }[];
  return results.map(r => r.chat_id);
}

/**
 * Erfasst User-Gruppen-Aktivität (für Prompt 5 Cluster-Erkennung)
 */
export function recordUserGroupActivity(userId: number, groupId: string): void {
  const db = getDatabase();
  const now = Date.now();
  
  try {
    ensureUserExists(userId);
    ensureGroupExists(groupId);
    
    const existing = db.prepare(`
      SELECT first_seen_at FROM user_group_activity
      WHERE user_id = ? AND group_id = ?
    `).get(userId, groupId) as { first_seen_at: number } | undefined;
    
    if (existing) {
      // Update last_seen_at
      const stmt = db.prepare(`
        UPDATE user_group_activity
        SET last_seen_at = ?
        WHERE user_id = ? AND group_id = ?
      `);
      stmt.run(now, userId, groupId);
    } else {
      // Insert
      const stmt = db.prepare(`
        INSERT INTO user_group_activity (user_id, group_id, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(userId, groupId, now, now);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[DB][ERROR] recordUserGroupActivity failed: user=${userId} group=${groupId}`, errorMessage);
  }
}

/**
 * Holt die Anzahl der distinct managed Gruppen für einen User in den letzten 24 Stunden
 */
export function getDistinctManagedGroupsIn24h(userId: number): string[] {
  const db = getDatabase();
  const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
  
  const stmt = db.prepare(`
    SELECT DISTINCT uga.group_id
    FROM user_group_activity uga
    INNER JOIN groups g ON uga.group_id = g.chat_id
    WHERE uga.user_id = ?
      AND g.status = 'managed'
      AND uga.last_seen_at >= ?
  `);
  
  const results = stmt.all(userId, cutoffTime) as Array<{ group_id: string }>;
  return results.map(r => r.group_id);
}

/**
 * Holt Cluster-Statistiken (Prompt 5: aktualisiert)
 */
export function getClusterStats(): { l1: number; l2: number; l3: number; total: number } {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT level, COUNT(*) as count
    FROM clusters
    GROUP BY level
  `);
  const results = stmt.all() as Array<{ level: number; count: number }>;
  
  let l1 = 0;
  let l2 = 0;
  let l3 = 0;
  
  for (const row of results) {
    if (row.level === 1) l1 = row.count;
    else if (row.level === 2) l2 = row.count;
    else if (row.level === 3) l3 = row.count;
  }
  
  return { l1, l2, l3, total: l1 + l2 + l3 };
}

/**
 * Holt Anzahl aktiver User (User mit Joins in den letzten 24h)
 */
export function getActiveUsersCount(windowHours: number = 24): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count
    FROM joins
    WHERE joined_at >= ?
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Holt Anzahl neuer Joins in einem Zeitfenster
 */
export function getJoinsCount(windowHours: number = 24): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM joins
    WHERE joined_at >= ?
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Holt Anzahl Auto-Banns (Actions mit reason 'auto-rejoin block' oder 'auto-ban on join')
 */
export function getAutoBansCount(windowHours: number = 24): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM actions
    WHERE action = 'ban'
      AND created_at >= ?
      AND (reason LIKE '%auto-rejoin block%' OR reason LIKE '%auto-ban on join%' OR reason LIKE '%AUTO-REJOIN%')
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Holt Anzahl Cluster-Banns (Actions mit reason 'L3 cluster detection')
 */
export function getClusterBansCount(windowHours: number = 24): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM actions
    WHERE action = 'ban'
      AND created_at >= ?
      AND reason LIKE '%L3 cluster detection%'
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Holt Top-Gruppen nach Join-Anzahl
 */
export function getTopGroupsByJoins(limit: number = 5, windowHours: number = 24): Array<{ chatId: string; title: string; joinCount: number }> {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT j.chat_id, COUNT(*) as join_count
    FROM joins j
    WHERE j.joined_at >= ?
    GROUP BY j.chat_id
    ORDER BY join_count DESC
    LIMIT ?
  `);
  const results = stmt.all(cutoffTime, limit) as Array<{ chat_id: string; join_count: number }>;
  
  const topGroups: Array<{ chatId: string; title: string; joinCount: number }> = [];
  for (const row of results) {
    const group = getGroup(row.chat_id);
    topGroups.push({
      chatId: row.chat_id,
      title: group?.title || 'Unbekannt',
      joinCount: row.join_count,
    });
  }
  
  return topGroups;
}

/**
 * Holt Top-Gruppen nach Ban-Anzahl
 */
export function getTopGroupsByBans(limit: number = 5, windowHours: number = 24): Array<{ chatId: string; title: string; banCount: number }> {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT a.chat_id, COUNT(*) as ban_count
    FROM actions a
    WHERE a.action = 'ban'
      AND a.created_at >= ?
    GROUP BY a.chat_id
    ORDER BY ban_count DESC
    LIMIT ?
  `);
  const results = stmt.all(cutoffTime, limit) as Array<{ chat_id: string; ban_count: number }>;
  
  const topGroups: Array<{ chatId: string; title: string; banCount: number }> = [];
  for (const row of results) {
    const group = getGroup(row.chat_id);
    topGroups.push({
      chatId: row.chat_id,
      title: group?.title || 'Unbekannt',
      banCount: row.ban_count,
    });
  }
  
  return topGroups;
}

/**
 * Holt Anzahl neuer User in einem Zeitfenster (basierend auf first_seen)
 */
export function getNewUsersCount(windowHours: number = 168): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM users
    WHERE first_seen >= ?
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Holt Anzahl neu beobachteter User in einem Zeitfenster
 */
export function getNewObservedUsersCount(windowHours: number = 168): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  // Prüfe ob User in diesem Zeitfenster is_observed = 1 gesetzt wurde
  // Da wir kein "observed_at" Feld haben, nutzen wir einen Workaround:
  // User die is_observed = 1 haben UND in diesem Zeitfenster gejoint sind
  const stmt = db.prepare(`
    SELECT COUNT(DISTINCT u.user_id) as count
    FROM users u
    INNER JOIN joins j ON u.user_id = j.user_id
    WHERE u.is_observed = 1
      AND j.joined_at >= ?
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Holt Top-Gruppen nach Cluster-Beteiligung
 */
export function getTopGroupsByClusterParticipation(limit: number = 3): Array<{ chatId: string; title: string; clusterCount: number }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT 
      json_each.value as chat_id,
      COUNT(*) as cluster_count
    FROM clusters,
    json_each(clusters.group_ids)
    GROUP BY chat_id
    ORDER BY cluster_count DESC
    LIMIT ?
  `);
  const results = stmt.all(limit) as Array<{ chat_id: string; cluster_count: number }>;
  
  const topGroups: Array<{ chatId: string; title: string; clusterCount: number }> = [];
  for (const row of results) {
    const group = getGroup(row.chat_id);
    topGroups.push({
      chatId: row.chat_id,
      title: group?.title || 'Unbekannt',
      clusterCount: row.cluster_count,
    });
  }
  
  return topGroups;
}

/**
 * Holt alle bekannten User-IDs für eine Gruppe (aus joins, actions, baseline_members)
 */
export function getKnownUserIdsForGroup(chatId: string): number[] {
  const db = getDatabase();
  const userIds = new Set<number>();
  
  // Aus joins
  const joinsStmt = db.prepare(`
    SELECT DISTINCT user_id FROM joins WHERE chat_id = ?
  `);
  const joins = joinsStmt.all(chatId) as Array<{ user_id: number }>;
  joins.forEach(row => userIds.add(row.user_id));
  
  // Aus actions
  const actionsStmt = db.prepare(`
    SELECT DISTINCT user_id FROM actions WHERE chat_id = ?
  `);
  const actions = actionsStmt.all(chatId) as Array<{ user_id: number }>;
  actions.forEach(row => userIds.add(row.user_id));
  
  // Aus baseline_members
  const baselineStmt = db.prepare(`
    SELECT DISTINCT user_id FROM baseline_members WHERE chat_id = ?
  `);
  const baseline = baselineStmt.all(chatId) as Array<{ user_id: number }>;
  baseline.forEach(row => userIds.add(row.user_id));
  
  return Array.from(userIds);
}

/**
 * Speichert einen Baseline-Scan-Eintrag
 */
export function saveBaselineScan(
  chatId: string,
  scanType: 'manual' | 'auto',
  membersCount: number,
  membersScanned: number,
  scanLimited: boolean
): number {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO baseline_scans (chat_id, scan_type, scanned_at, members_count, members_scanned, scan_limited)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(chatId, scanType, Date.now(), membersCount, membersScanned, scanLimited ? 1 : 0);
  return result.lastInsertRowid as number;
}

/**
 * Speichert oder aktualisiert einen Baseline-Member
 */
export function saveBaselineMember(
  chatId: string,
  userId: number,
  username: string | null,
  firstName: string | null,
  lastName: string | null,
  isBot: boolean,
  scanSource: 'manual' | 'auto',
  source: 'join' | 'message' | 'admin' | 'scan' = 'join'
): void {
  const db = getDatabase();
  const now = Date.now();
  
  try {
    // CRITICAL: Stelle sicher, dass Group und User existieren VOR dem INSERT/UPDATE
    ensureGroupExists(chatId);
    ensureUserExists(userId);
    
    // Prüfe ob Member bereits existiert
    const existing = db.prepare(`
      SELECT id, first_seen_at FROM baseline_members
      WHERE chat_id = ? AND user_id = ?
    `).get(chatId, userId) as { id: number; first_seen_at: number } | undefined;
    
    if (existing) {
      // Update: last_seen_at und User-Info aktualisieren, source nur wenn besser (scan > admin > message > join)
      const sourcePriority: Record<string, number> = { 'join': 1, 'message': 2, 'admin': 3, 'scan': 4 };
      const currentSource = db.prepare(`
        SELECT source FROM baseline_members WHERE chat_id = ? AND user_id = ?
      `).get(chatId, userId) as { source: string } | undefined;
      
      const shouldUpdateSource = currentSource && 
        (sourcePriority[source] || 0) > (sourcePriority[currentSource.source] || 0);
      
      if (shouldUpdateSource) {
        const stmt = db.prepare(`
          UPDATE baseline_members
          SET last_seen_at = ?, username = ?, first_name = ?, last_name = ?, source = ?
          WHERE chat_id = ? AND user_id = ?
        `);
        stmt.run(now, username, firstName, lastName, source, chatId, userId);
      } else {
        const stmt = db.prepare(`
          UPDATE baseline_members
          SET last_seen_at = ?, username = ?, first_name = ?, last_name = ?
          WHERE chat_id = ? AND user_id = ?
        `);
        stmt.run(now, username, firstName, lastName, chatId, userId);
      }
    } else {
      // Insert: neuer Member
      const stmt = db.prepare(`
        INSERT INTO baseline_members (chat_id, user_id, username, first_name, last_name, is_bot, first_seen_at, last_seen_at, baseline_scan, scan_source, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);
      stmt.run(chatId, userId, username, firstName, lastName, isBot ? 1 : 0, now, now, scanSource, source);
      
      // Aktualisiere known_member_count für diese Gruppe
      updateGroupScanMemberCount(chatId);
      
      // Baseline-Log
      console.log(`[BASELINE] user registered user=${userId} chat=${chatId} source=${source}`);
    }
  } catch (error: any) {
    // Fail-safe: Logge Fehler, aber lasse Bot nicht abbrechen
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('FOREIGN KEY constraint failed')) {
      console.error(`[DB][ERROR] saveBaselineMember failed – FK constraint: user=${userId} chat=${chatId}`, errorMessage);
      // Versuche es nochmal mit ensure-Funktionen (Race Condition möglicherweise)
      try {
        ensureGroupExists(chatId);
        ensureUserExists(userId);
        // Retry INSERT/UPDATE
        const existing = db.prepare(`
          SELECT id FROM baseline_members WHERE chat_id = ? AND user_id = ?
        `).get(chatId, userId);
        if (!existing) {
          const stmt = db.prepare(`
            INSERT INTO baseline_members (chat_id, user_id, username, first_name, last_name, is_bot, first_seen_at, last_seen_at, baseline_scan, scan_source, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          `);
          stmt.run(chatId, userId, username, firstName, lastName, isBot ? 1 : 0, now, now, scanSource, source);
          updateGroupScanMemberCount(chatId);
        }
        console.log(`[DB] saveBaselineMember retry successful: user=${userId} chat=${chatId}`);
      } catch (retryError: any) {
        console.error(`[DB][ERROR] saveBaselineMember retry failed: user=${userId} chat=${chatId}`, retryError.message);
        // Bot darf nicht abbrechen - Event wird verworfen, aber Bot läuft weiter
      }
    } else {
      console.error(`[DB][ERROR] saveBaselineMember failed: user=${userId} chat=${chatId}`, errorMessage);
      // Andere Fehler weiterwerfen (können wichtige Probleme sein)
      throw error;
    }
  }
}

/**
 * Aktualisiert die bekannte Mitgliederanzahl für eine Gruppe
 */
export function updateGroupScanMemberCount(chatId: string): void {
  const db = getDatabase();
  const countStmt = db.prepare(`
    SELECT COUNT(*) as count FROM baseline_members WHERE chat_id = ?
  `);
  const count = countStmt.get(chatId) as { count: number } | undefined;
  
  const updateStmt = db.prepare(`
    INSERT INTO group_scan_status (chat_id, known_member_count)
    VALUES (?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET known_member_count = ?
  `);
  updateStmt.run(chatId, count?.count || 0, count?.count || 0);
}

/**
 * Setzt Scan-Status für eine Gruppe
 */
export function setGroupScanStatus(
  chatId: string,
  scanState: 'idle' | 'running' | 'rate_limited',
  lastScanAt?: number
): void {
  const db = getDatabase();
  const now = lastScanAt || Date.now();
  
  const stmt = db.prepare(`
    INSERT INTO group_scan_status (chat_id, scan_state, last_scan_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET scan_state = ?, last_scan_at = ?
  `);
  stmt.run(chatId, scanState, now, scanState, now);
}

/**
 * Holt Scan-Status für eine Gruppe
 */
export interface GroupScanStatus {
  chat_id: string;
  last_scan_at: number | null;
  scan_state: 'idle' | 'running' | 'rate_limited';
  known_member_count: number;
}

export function getGroupScanStatus(chatId: string): GroupScanStatus | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM group_scan_status WHERE chat_id = ?
  `);
  return (stmt.get(chatId) as GroupScanStatus | undefined) || null;
}

/**
 * Holt alle Gruppen mit aktivem Scan (running oder rate_limited)
 */
export function getGroupsWithActiveScan(): Array<{ chat_id: string; scan_state: string }> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT chat_id, scan_state FROM group_scan_status
    WHERE scan_state IN ('running', 'rate_limited')
  `);
  return stmt.all() as Array<{ chat_id: string; scan_state: string }>;
}

/**
 * Holt alle bekannten User-IDs für eine Gruppe (aus baseline_members)
 */
export function getBaselineMembersForGroup(chatId: string): Array<{
  user_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  source: string;
}> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT user_id, username, first_name, last_name, source
    FROM baseline_members
    WHERE chat_id = ?
  `);
  return stmt.all(chatId) as Array<{
    user_id: number;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    source: string;
  }>;
}

/**
 * Holt Scan-Statistiken für alle Gruppen
 */
export function getScanStatistics(): {
  totalGroups: number;
  scannedGroups: number;
  activeScans: number;
  totalKnownMembers: number;
  lastScanAt: number | null;
} {
  const db = getDatabase();
  
  const totalStmt = db.prepare(`
    SELECT COUNT(*) as count FROM groups WHERE status = 'managed'
  `);
  const total = totalStmt.get() as { count: number } | undefined;
  
  const scannedStmt = db.prepare(`
    SELECT COUNT(DISTINCT chat_id) as count FROM group_scan_status WHERE last_scan_at IS NOT NULL
  `);
  const scanned = scannedStmt.get() as { count: number } | undefined;
  
  const activeStmt = db.prepare(`
    SELECT COUNT(*) as count FROM group_scan_status WHERE scan_state IN ('running', 'rate_limited')
  `);
  const active = activeStmt.get() as { count: number } | undefined;
  
  // Baseline Users (seen): Alle User die jemals sichtbar waren
  const baselineUsersStmt = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM baseline_members
  `);
  const baselineUsers = baselineUsersStmt.get() as { count: number } | undefined;
  
  // Alternative: Zähle alle User die jemals gejoint, geschrieben oder gebannt wurden
  const allSeenUsersStmt = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM (
      SELECT user_id FROM joins
      UNION
      SELECT user_id FROM baseline_members
      UNION
      SELECT user_id FROM actions
    )
  `);
  const allSeenUsers = allSeenUsersStmt.get() as { count: number } | undefined;
  
  const membersStmt = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM baseline_members
  `);
  const members = membersStmt.get() as { count: number } | undefined;
  
  const lastScanStmt = db.prepare(`
    SELECT MAX(last_scan_at) as last_scan FROM group_scan_status
  `);
  const lastScan = lastScanStmt.get() as { last_scan: number | null } | undefined;
  
  return {
    totalGroups: total?.count || 0,
    scannedGroups: scanned?.count || 0,
    activeScans: active?.count || 0,
    totalKnownMembers: members?.count || 0,
    lastScanAt: lastScan?.last_scan || null,
  };
}

/**
 * Markiert eine Gruppe als scan_limited
 */
export function markGroupAsScanLimited(chatId: string): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    UPDATE baseline_scans
    SET scan_limited = 1
    WHERE chat_id = ? AND id = (SELECT MAX(id) FROM baseline_scans WHERE chat_id = ?)
  `);
  stmt.run(chatId, chatId);
}

/**
 * Holt letzte Scan-Statistiken
 */
export function getLastScanStats(): {
  lastScanAt: number | null;
  totalBaselineMembers: number;
  scanLimitedGroups: number;
  coveragePercentage: number;
} {
  const db = getDatabase();
  
  // Letzter Scan
  const lastScanStmt = db.prepare(`
    SELECT MAX(scanned_at) as last_scan FROM baseline_scans
  `);
  const lastScan = lastScanStmt.get() as { last_scan: number | null } | undefined;
  
  // Anzahl Baseline-Members
  const totalMembersStmt = db.prepare(`
    SELECT COUNT(DISTINCT user_id) as count FROM baseline_members WHERE baseline_scan = 1
  `);
  const totalMembers = totalMembersStmt.get() as { count: number } | undefined;
  
  // Scan-limited Gruppen
  const limitedStmt = db.prepare(`
    SELECT COUNT(DISTINCT chat_id) as count FROM baseline_scans WHERE scan_limited = 1
  `);
  const limited = limitedStmt.get() as { count: number } | undefined;
  
  // Coverage: Vergleich managed Gruppen vs. gescannte Gruppen
  const managedGroupsStmt = db.prepare(`
    SELECT COUNT(*) as count FROM groups WHERE status = 'managed'
  `);
  const managedGroups = managedGroupsStmt.get() as { count: number } | undefined;
  
  const scannedGroupsStmt = db.prepare(`
    SELECT COUNT(DISTINCT chat_id) as count FROM baseline_scans
  `);
  const scannedGroups = scannedGroupsStmt.get() as { count: number } | undefined;
  
  const managedCount = managedGroups?.count || 0;
  const scannedCount = scannedGroups?.count || 0;
  const coverage = managedCount > 0 ? Math.round((scannedCount / managedCount) * 100) : 0;
  
  return {
    lastScanAt: lastScan?.last_scan || null,
    totalBaselineMembers: totalMembers?.count || 0,
    scanLimitedGroups: limited?.count || 0,
    coveragePercentage: coverage,
  };
}

/**
 * Holt die Anzahl der Baseline-User (alle User die jemals sichtbar waren)
 */
export function getBaselineUserCount() {
  return { total: 0 };
}

/**
 * Holt Statistiken über neue User
 */
export function getNewUserStats() {
  return {
    totalJoins: 0,
    joinsInLastHour: 0,
    riskScore: 0,
    reasons: []
  };
}

// ============================================================================
// Group Config (Feature Flags)
// ============================================================================

export interface GroupConfig {
  chat_id: string;
  managed: boolean;
  enable_welcome: boolean;
  enable_service_cleanup: boolean;
  enable_link_policy: boolean;
  enable_scam_detection: boolean;
  enable_warns: boolean;
  welcome_template: string | null;
  welcome_ref_code: string | null;
  welcome_partner: string | null;
  scam_action: 'delete' | 'warn' | 'restrict' | 'kick' | 'ban';
  scam_threshold: number;
  scam_warn_text: string | null;
  url_policy_mode: 'allow' | 'allowlist' | 'block_all';
  url_allowlist: string | null;
  // Link Policy (Prompt F)
  link_policy_enabled: boolean;
  link_policy_new_user_window_minutes: number;
  link_policy_whitelist_domains: string | null;
  // Anti-Flood (Prompt F)
  antiflood_enabled: boolean;
  antiflood_max_messages: number;
  antiflood_window_seconds: number;
  antiflood_restrict_minutes: number;
  updated_at: number;
}

export type FeatureName = 'welcome' | 'cleanup' | 'links' | 'scam' | 'warns';

/**
 * Stellt sicher, dass eine group_config existiert (idempotent)
 * Wird automatisch aufgerufen, sobald Shield eine Gruppe sieht
 */
/**
 * K12: Stellt sicher, dass eine group_config existiert (idempotent)
 * Automatische Initialisierung beim ersten Event einer Gruppe:
 * - Partner automatisch erkennen (aus Gruppennamen)
 * - Location aus Gruppennamen extrahieren
 * - Ref-Code leer lassen
 */
export function ensureGroupConfig(chatId: string, groupTitle?: string | null): void {
  const db = getDatabase();
  
  // Prüfe ob Config bereits existiert
  const existing = db.prepare('SELECT chat_id FROM group_config WHERE chat_id = ?').get(chatId);
  
  if (!existing) {
    // K12: Automatische Partner-Erkennung aus Gruppennamen
    let partner: string | null = null;
    if (groupTitle) {
      const titleLower = groupTitle.toLowerCase();
      if (titleLower.includes('staatenlos') && titleLower.includes('geldhelden')) {
        partner = 'coop';
      } else if (titleLower.includes('staatenlos')) {
        partner = 'staatenlos';
      } else {
        partner = 'geldhelden'; // Default
      }
    } else {
      partner = 'geldhelden'; // Default
    }
    
    // Neue Config mit Defaults erstellen
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO group_config (
          chat_id, managed, enable_welcome, enable_service_cleanup,
          enable_link_policy, enable_scam_detection, enable_warns,
          welcome_template, welcome_ref_code, welcome_partner,
          scam_action, scam_threshold, scam_warn_text,
          url_policy_mode, url_allowlist,
          link_policy_enabled, link_policy_new_user_window_minutes, link_policy_whitelist_domains,
          antiflood_enabled, antiflood_max_messages, antiflood_window_seconds, antiflood_restrict_minutes,
          updated_at
        )
        VALUES (?, 1, 1, 1, 1, 1, 1, NULL, NULL, ?, 'delete', 70, NULL, 'allowlist', 'geldhelden.org,t.me,telegram.me', 1, 30, 'geldhelden.org,staatenlos.ch', 1, 5, 10, 10, ?)
      `);
      stmt.run(chatId, partner, Date.now());
      console.log(`[DB][K12] ensureGroupConfig OK: ${chatId} partner=${partner}`);
    } catch (error: any) {
      if (error.message.includes('UNIQUE constraint') || error.message.includes('PRIMARY KEY')) {
        // Config existiert bereits (Race Condition) - OK
        console.log(`[DB] ensureGroupConfig OK (race condition): ${chatId}`);
      } else {
        console.error(`[DB][ERROR] ensureGroupConfig failed: ${chatId}`, error.message);
        throw error;
      }
    }
  }
}

/**
 * Holt die group_config für eine Gruppe
 */
export function getGroupConfig(chatId: string): GroupConfig | null {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      chat_id,
      managed,
      enable_welcome,
      enable_service_cleanup,
      enable_link_policy,
      enable_scam_detection,
      enable_warns,
      welcome_template,
      welcome_ref_code,
      welcome_partner,
      scam_action,
      scam_threshold,
      scam_warn_text,
      url_policy_mode,
      url_allowlist,
      link_policy_enabled,
      link_policy_new_user_window_minutes,
      link_policy_whitelist_domains,
      antiflood_enabled,
      antiflood_max_messages,
      antiflood_window_seconds,
      antiflood_restrict_minutes,
      updated_at
    FROM group_config
    WHERE chat_id = ?
  `);
  
  const result = stmt.get(chatId) as {
    chat_id: string;
    managed: number;
    enable_welcome: number;
    enable_service_cleanup: number;
    enable_link_policy: number;
    enable_scam_detection: number;
    enable_warns: number;
    welcome_template: string | null;
    welcome_ref_code: string | null;
    welcome_partner: string | null;
    scam_action: string;
    scam_threshold: number;
    scam_warn_text: string | null;
    url_policy_mode: string;
    url_allowlist: string | null;
    link_policy_enabled: number;
    link_policy_new_user_window_minutes: number;
    link_policy_whitelist_domains: string | null;
    antiflood_enabled: number;
    antiflood_max_messages: number;
    antiflood_window_seconds: number;
    antiflood_restrict_minutes: number;
    updated_at: number;
  } | undefined;
  
  if (!result) {
    return null;
  }
  
  // Konvertiere INTEGER (0/1) zu boolean
  return {
    chat_id: result.chat_id,
    managed: result.managed === 1,
    enable_welcome: result.enable_welcome === 1,
    enable_service_cleanup: result.enable_service_cleanup === 1,
    enable_link_policy: result.enable_link_policy === 1,
    enable_scam_detection: result.enable_scam_detection === 1,
    enable_warns: result.enable_warns === 1,
    welcome_template: result.welcome_template,
    welcome_ref_code: result.welcome_ref_code,
    welcome_partner: result.welcome_partner,
    scam_action: (result.scam_action || 'delete') as 'delete' | 'warn' | 'restrict' | 'kick' | 'ban',
    scam_threshold: result.scam_threshold || 70,
    scam_warn_text: result.scam_warn_text,
    url_policy_mode: (result.url_policy_mode || 'allowlist') as 'allow' | 'allowlist' | 'block_all',
    url_allowlist: result.url_allowlist || 'geldhelden.org,t.me,telegram.me',
    link_policy_enabled: ((result as any).link_policy_enabled ?? 1) === 1,
    link_policy_new_user_window_minutes: (result as any).link_policy_new_user_window_minutes ?? 30,
    link_policy_whitelist_domains: (result as any).link_policy_whitelist_domains ?? 'geldhelden.org,staatenlos.ch',
    antiflood_enabled: ((result as any).antiflood_enabled ?? 1) === 1,
    antiflood_max_messages: (result as any).antiflood_max_messages ?? 5,
    antiflood_window_seconds: (result as any).antiflood_window_seconds ?? 10,
    antiflood_restrict_minutes: (result as any).antiflood_restrict_minutes ?? 10,
    updated_at: result.updated_at,
  };
}

/**
 * Aktualisiert die group_config (partial update)
 */
export function updateGroupConfig(
  chatId: string,
  partialConfig: Partial<Omit<GroupConfig, 'chat_id' | 'updated_at'>>
): boolean {
  const db = getDatabase();
  
  // Stelle sicher, dass Config existiert
  ensureGroupConfig(chatId);
  
  // Baue UPDATE-Statement dynamisch
  const updates: string[] = [];
  const values: any[] = [];
  
  if (partialConfig.managed !== undefined) {
    updates.push('managed = ?');
    values.push(partialConfig.managed ? 1 : 0);
  }
  if (partialConfig.enable_welcome !== undefined) {
    updates.push('enable_welcome = ?');
    values.push(partialConfig.enable_welcome ? 1 : 0);
  }
  if (partialConfig.enable_service_cleanup !== undefined) {
    updates.push('enable_service_cleanup = ?');
    values.push(partialConfig.enable_service_cleanup ? 1 : 0);
  }
  if (partialConfig.enable_link_policy !== undefined) {
    updates.push('enable_link_policy = ?');
    values.push(partialConfig.enable_link_policy ? 1 : 0);
  }
  if (partialConfig.enable_scam_detection !== undefined) {
    updates.push('enable_scam_detection = ?');
    values.push(partialConfig.enable_scam_detection ? 1 : 0);
  }
  if (partialConfig.enable_warns !== undefined) {
    updates.push('enable_warns = ?');
    values.push(partialConfig.enable_warns ? 1 : 0);
  }
  if (partialConfig.welcome_template !== undefined) {
    updates.push('welcome_template = ?');
    values.push(partialConfig.welcome_template);
  }
  if (partialConfig.welcome_ref_code !== undefined) {
    updates.push('welcome_ref_code = ?');
    values.push(partialConfig.welcome_ref_code);
  }
  if (partialConfig.welcome_partner !== undefined) {
    updates.push('welcome_partner = ?');
    values.push(partialConfig.welcome_partner);
  }
  
  if (updates.length === 0) {
    return false; // Keine Änderungen
  }
  
  // Füge updated_at hinzu
  updates.push('updated_at = ?');
  values.push(Date.now());
  
  // Füge chat_id für WHERE hinzu
  values.push(chatId);
  
  const sql = `UPDATE group_config SET ${updates.join(', ')} WHERE chat_id = ?`;
  
  try {
    const stmt = db.prepare(sql);
    const result = stmt.run(...values);
    return result.changes > 0;
  } catch (error: any) {
    console.error(`[DB][ERROR] updateGroupConfig failed: ${chatId}`, error.message);
    throw error;
  }
}

/**
 * Prüft ob ein Feature für eine Gruppe aktiviert ist
 */
export function isFeatureEnabled(chatId: string, featureName: FeatureName): boolean {
  const config = getGroupConfig(chatId);
  
  if (!config) {
    // Keine Config = Defaults (alle Features aktiv)
    return true;
  }
  
  // Prüfe ob Gruppe managed ist
  if (!config.managed) {
    return false;
  }
  
  // Prüfe Feature-Flag
  switch (featureName) {
    case 'welcome':
      return config.enable_welcome;
    case 'cleanup':
      return config.enable_service_cleanup;
    case 'links':
      return config.enable_link_policy;
    case 'scam':
      return config.enable_scam_detection;
    case 'warns':
      return config.enable_warns;
    default:
      return false;
  }
}

/**
 * Loggt einen Welcome-Versand (für Statistiken)
 */
export function logWelcomeSent(chatId: string, userId: number): void {
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO welcome_log (chat_id, user_id, sent_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(chatId, userId, Date.now());
  } catch (error: any) {
    // Ignoriere Fehler beim Logging (nicht kritisch)
    console.warn(`[DB] Fehler beim Loggen von Welcome: chat=${chatId} user=${userId}`, error.message);
  }
}

/**
 * Holt die Anzahl der gesendeten Welcomes in einem Zeitfenster
 */
export function getWelcomeCount(windowHours: number = 24): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM welcome_log
    WHERE sent_at >= ?
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

/**
 * Loggt ein Scam-Event (für Statistiken)
 */
// Scam Action Type (Union-Typ für erlaubte Werte)
export type ScamActionType = 'restrict' | 'ban' | 'delete' | 'warn' | 'kick';

export function logScamEvent(
  chatId: string,
  userId: number,
  messageId: number | null,
  score: number,
  action: ScamActionType,
  reasons: string[]
): void {
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      INSERT INTO scam_events (chat_id, user_id, message_id, score, action, reasons_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(chatId, userId, messageId, score, action, JSON.stringify(reasons), Date.now());
  } catch (error: any) {
    // Ignoriere Fehler beim Logging (nicht kritisch)
    console.warn(`[DB] Fehler beim Loggen von Scam-Event: chat=${chatId} user=${userId}`, error.message);
  }
}

/**
 * Holt die Anzahl der Scam-Events in einem Zeitfenster
 */
export function getScamEventCount(windowHours: number = 24): number {
  const db = getDatabase();
  const cutoffTime = Date.now() - (windowHours * 60 * 60 * 1000);
  
  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM scam_events
    WHERE created_at >= ?
  `);
  const result = stmt.get(cutoffTime) as { count: number } | undefined;
  return result?.count || 0;
}

// ============================================================================
// Group Profiles (Welcome System)
// ============================================================================

export interface GroupSettings {
  chat_id: string;
  welcome_enabled: boolean;
  ref_code: string | null;
  brand_mode: 'GELDHELDEN' | 'STAATENLOS_COOP';
  custom_intro: string | null;
  scam_enabled: boolean;
}

export interface GroupProfile {
  chat_id: string;
  title: string | null;
  baseBrand: string | null; // DB-Typ: string | null (kann später neue Werte bekommen)
  location: string | null;
  allowedDomains: string | null; // JSON array or CSV
  silentMode: boolean;
  welcome_enabled: boolean;
  welcome_template: string | null;
  affiliate_ref: string | null;
  partner_tag: string | null;
  updated_by: number | null;
  updated_at: number | null;
}

/**
 * Holt oder erstellt ein Group Profile
 */
export function getOrCreateGroupProfile(chatId: string, title?: string): GroupProfile {
  const db = getDatabase();
  
  // Prüfe, welche Spalten in group_profiles existieren
  const profileColumns = db.prepare('PRAGMA table_info(group_profiles)').all() as Array<{ name: string }>;
  const hasBaseBrand = profileColumns.some(col => col.name === 'base_brand');
  const hasLocation = profileColumns.some(col => col.name === 'location');
  const hasAllowedDomains = profileColumns.some(col => col.name === 'allowed_domains');
  const hasSilentMode = profileColumns.some(col => col.name === 'silent_mode');
  
  // Baue SELECT dynamisch auf
  const selectFields = [
    'chat_id',
    'title',
    hasBaseBrand ? 'base_brand' : 'NULL as base_brand',
    hasLocation ? 'location' : 'NULL as location',
    hasAllowedDomains ? 'allowed_domains' : 'NULL as allowed_domains',
    hasSilentMode ? 'silent_mode' : '0 as silent_mode',
    'welcome_enabled',
    'welcome_template',
    'affiliate_ref',
    'partner_tag',
    'updated_by',
    'updated_at'
  ].join(', ');
  
  let profile = db.prepare(`SELECT ${selectFields} FROM group_profiles WHERE chat_id = ?`).get(chatId) as {
    chat_id: string;
    title: string | null;
    base_brand: string | null;
    location: string | null;
    allowed_domains: string | null;
    silent_mode: number;
    welcome_enabled: number;
    welcome_template: string | null;
    affiliate_ref: string | null;
    partner_tag: string | null;
    updated_by: number | null;
    updated_at: number | null;
  } | undefined;
  
  if (!profile) {
    // Erstelle neues Profile - nur mit existierenden Spalten
    const insertFields = ['chat_id', 'title', 'welcome_enabled', 'updated_at'];
    const insertValues = [chatId, title || null, 1, Date.now()];
    const placeholders = insertFields.map(() => '?').join(', ');
    
    if (hasBaseBrand) {
      insertFields.push('base_brand');
      insertValues.push(null);
    }
    if (hasLocation) {
      insertFields.push('location');
      insertValues.push(null);
    }
    if (hasAllowedDomains) {
      insertFields.push('allowed_domains');
      insertValues.push(null);
    }
    if (hasSilentMode) {
      insertFields.push('silent_mode');
      insertValues.push(0);
    }
    insertFields.push('welcome_template', 'affiliate_ref', 'partner_tag');
    insertValues.push(null, null, null);
    
    const stmt = db.prepare(`
      INSERT INTO group_profiles (${insertFields.join(', ')})
      VALUES (${insertFields.map(() => '?').join(', ')})
    `);
    stmt.run(...insertValues);
    profile = db.prepare(`SELECT ${selectFields} FROM group_profiles WHERE chat_id = ?`).get(chatId) as typeof profile;
  } else if (title && profile.title !== title) {
    // Update title falls geändert
    const stmt = db.prepare('UPDATE group_profiles SET title = ?, updated_at = ? WHERE chat_id = ?');
    stmt.run(title, Date.now(), chatId);
    profile.title = title;
  }
  
  // Konvertiere INTEGER zu boolean
  return {
    chat_id: profile.chat_id,
    title: profile.title,
    baseBrand: profile.base_brand, // DB-Typ: string | null (keine Konvertierung)
    location: profile.location,
    allowedDomains: profile.allowed_domains,
    silentMode: profile.silent_mode === 1,
    welcome_enabled: profile.welcome_enabled === 1,
    welcome_template: profile.welcome_template,
    affiliate_ref: profile.affiliate_ref,
    partner_tag: profile.partner_tag,
    updated_by: profile.updated_by,
    updated_at: profile.updated_at,
  };
}

/**
 * Holt Group Profile
 */
export function getGroupProfile(chatId: string): GroupProfile | null {
  const db = getDatabase();
  
  // Prüfe, welche Spalten in group_profiles existieren
  const profileColumns = db.prepare('PRAGMA table_info(group_profiles)').all() as Array<{ name: string }>;
  const hasBaseBrand = profileColumns.some(col => col.name === 'base_brand');
  const hasLocation = profileColumns.some(col => col.name === 'location');
  const hasAllowedDomains = profileColumns.some(col => col.name === 'allowed_domains');
  const hasSilentMode = profileColumns.some(col => col.name === 'silent_mode');
  
  // Baue SELECT dynamisch auf
  const selectFields = [
    'chat_id',
    'title',
    hasBaseBrand ? 'base_brand' : 'NULL as base_brand',
    hasLocation ? 'location' : 'NULL as location',
    hasAllowedDomains ? 'allowed_domains' : 'NULL as allowed_domains',
    hasSilentMode ? 'silent_mode' : '0 as silent_mode',
    'welcome_enabled',
    'welcome_template',
    'affiliate_ref',
    'partner_tag',
    'updated_by',
    'updated_at'
  ].join(', ');
  
  const profile = db.prepare(`SELECT ${selectFields} FROM group_profiles WHERE chat_id = ?`).get(chatId) as {
    chat_id: string;
    title: string | null;
    base_brand: string | null;
    location: string | null;
    allowed_domains: string | null;
    silent_mode: number;
    welcome_enabled: number;
    welcome_template: string | null;
    affiliate_ref: string | null;
    partner_tag: string | null;
    updated_by: number | null;
    updated_at: number | null;
  } | undefined;
  
  if (!profile) {
    return null;
  }
  
  return {
    chat_id: profile.chat_id,
    title: profile.title,
    baseBrand: profile.base_brand, // DB-Typ: string | null
    location: profile.location,
    allowedDomains: profile.allowed_domains,
    silentMode: profile.silent_mode === 1,
    welcome_enabled: profile.welcome_enabled === 1,
    welcome_template: profile.welcome_template,
    affiliate_ref: profile.affiliate_ref,
    partner_tag: profile.partner_tag,
    updated_by: profile.updated_by,
    updated_at: profile.updated_at,
  };
}

/**
 * Aktualisiert Group Profile
 */
export function updateGroupProfile(
  chatId: string,
  updates: Partial<Pick<GroupProfile, 'welcome_enabled' | 'welcome_template' | 'affiliate_ref' | 'partner_tag' | 'title' | 'baseBrand' | 'location' | 'allowedDomains' | 'silentMode'>>,
  updatedBy?: number
): boolean {
  const db = getDatabase();
  
  // Prüfe, welche Spalten in group_profiles existieren
  const profileColumns = db.prepare('PRAGMA table_info(group_profiles)').all() as Array<{ name: string }>;
  const hasBaseBrand = profileColumns.some(col => col.name === 'base_brand');
  const hasLocation = profileColumns.some(col => col.name === 'location');
  const hasAllowedDomains = profileColumns.some(col => col.name === 'allowed_domains');
  const hasSilentMode = profileColumns.some(col => col.name === 'silent_mode');
  
  try {
    const setParts: string[] = [];
    const values: any[] = [];
    
    if (updates.welcome_enabled !== undefined) {
      setParts.push('welcome_enabled = ?');
      values.push(updates.welcome_enabled ? 1 : 0);
    }
    if (updates.welcome_template !== undefined) {
      setParts.push('welcome_template = ?');
      values.push(updates.welcome_template);
    }
    if (updates.affiliate_ref !== undefined) {
      setParts.push('affiliate_ref = ?');
      values.push(updates.affiliate_ref);
    }
    if (updates.partner_tag !== undefined) {
      setParts.push('partner_tag = ?');
      values.push(updates.partner_tag);
    }
    if (updates.title !== undefined) {
      setParts.push('title = ?');
      values.push(updates.title);
    }
    if (updates.baseBrand !== undefined && hasBaseBrand) {
      setParts.push('base_brand = ?');
      values.push(updates.baseBrand);
    }
    if (updates.location !== undefined && hasLocation) {
      setParts.push('location = ?');
      values.push(updates.location);
    }
    if (updates.allowedDomains !== undefined && hasAllowedDomains) {
      setParts.push('allowed_domains = ?');
      values.push(updates.allowedDomains);
    }
    if (updates.silentMode !== undefined && hasSilentMode) {
      setParts.push('silent_mode = ?');
      values.push(updates.silentMode ? 1 : 0);
    }
    
    if (setParts.length === 0) {
      return false;
    }
    
    setParts.push('updated_at = ?');
    values.push(Date.now());
    
    if (updatedBy !== undefined) {
      setParts.push('updated_by = ?');
      values.push(updatedBy);
    }
    
    values.push(chatId);
    
    const stmt = db.prepare(`UPDATE group_profiles SET ${setParts.join(', ')} WHERE chat_id = ?`);
    stmt.run(...values);
    
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DB] Fehler beim Aktualisieren von Group Profile:', errorMessage);
    return false;
  }
}

/**
 * Prüft ob Welcome bereits gesendet wurde
 */
export function hasWelcomeBeenSent(chatId: string, userId: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('SELECT user_id FROM welcome_sent WHERE chat_id = ? AND user_id = ?');
  const result = stmt.get(chatId, userId) as { user_id: number } | undefined;
  return !!result;
}

/**
 * Markiert Welcome als gesendet
 */
export function markWelcomeSent(chatId: string, userId: number): void {
  const db = getDatabase();
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO welcome_sent (chat_id, user_id, joined_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(chatId, userId, Date.now());
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[DB] Fehler beim Markieren von Welcome als gesendet: chat=${chatId} user=${userId}`, errorMessage);
  }
}

// Group Stats Functions
export function getOrCreateGroupStats(groupId: string, groupName: string): GroupStats {
  const db = getDatabase();
  let stats = db.prepare('SELECT * FROM group_stats WHERE group_id = ?').get(groupId) as GroupStats | undefined;
  
  if (!stats) {
    const stmt = db.prepare(`
      INSERT INTO group_stats (group_id, group_name, risk_score, joins_24h, high_risk_users_24h, bans_24h, last_updated)
      VALUES (?, ?, 0, 0, 0, 0, ?)
    `);
    stmt.run(groupId, groupName, Date.now());
    stats = db.prepare('SELECT * FROM group_stats WHERE group_id = ?').get(groupId) as GroupStats;
  }
  
  if (!stats) {
    throw new Error('GroupStats could not be created or retrieved');
  }
  
  return {
    group_id: stats.group_id,
    group_name: stats.group_name,
    risk_score: stats.risk_score,
    joins_24h: stats.joins_24h,
    high_risk_users_24h: stats.high_risk_users_24h,
    bans_24h: stats.bans_24h,
    last_updated: stats.last_updated,
    last_notification_sent: stats.last_notification_sent || undefined,
    last_risk_level: stats.last_risk_level !== undefined ? stats.last_risk_level as GroupRiskLevel : undefined,
  };
}

export function getGroupStats(groupId: string): GroupStats | null {
  const db = getDatabase();
  const stats = db.prepare('SELECT * FROM group_stats WHERE group_id = ?').get(groupId) as GroupStats | undefined;
  
  if (!stats) {
    return null;
  }
  
  return {
    group_id: stats.group_id,
    group_name: stats.group_name,
    risk_score: stats.risk_score,
    joins_24h: stats.joins_24h,
    high_risk_users_24h: stats.high_risk_users_24h,
    bans_24h: stats.bans_24h,
    last_updated: stats.last_updated,
    last_notification_sent: stats.last_notification_sent || undefined,
    last_risk_level: stats.last_risk_level !== undefined ? stats.last_risk_level as GroupRiskLevel : undefined,
  };
}

export function updateGroupStats(
  groupId: string,
  updates: Partial<Pick<GroupStats, 'risk_score' | 'joins_24h' | 'high_risk_users_24h' | 'bans_24h' | 'last_updated' | 'last_notification_sent' | 'last_risk_level'>>
): void {
  const db = getDatabase();
  const setParts: string[] = [];
  const values: any[] = [];
  
  if (updates.risk_score !== undefined) {
    setParts.push('risk_score = ?');
    values.push(updates.risk_score);
  }
  if (updates.joins_24h !== undefined) {
    setParts.push('joins_24h = ?');
    values.push(updates.joins_24h);
  }
  if (updates.high_risk_users_24h !== undefined) {
    setParts.push('high_risk_users_24h = ?');
    values.push(updates.high_risk_users_24h);
  }
  if (updates.bans_24h !== undefined) {
    setParts.push('bans_24h = ?');
    values.push(updates.bans_24h);
  }
  if (updates.last_updated !== undefined) {
    setParts.push('last_updated = ?');
    values.push(updates.last_updated);
  }
  if (updates.last_notification_sent !== undefined) {
    setParts.push('last_notification_sent = ?');
    values.push(updates.last_notification_sent);
  }
  if (updates.last_risk_level !== undefined) {
    setParts.push('last_risk_level = ?');
    values.push(updates.last_risk_level);
  }
  
  if (setParts.length > 0) {
    values.push(groupId);
    const stmt = db.prepare(`UPDATE group_stats SET ${setParts.join(', ')} WHERE group_id = ?`);
    stmt.run(...values);
  }
}

export function getAllGroupStats(): GroupStats[] {
  const db = getDatabase();
  const stats = db.prepare('SELECT * FROM group_stats').all() as GroupStats[];
  
  return stats.map(s => ({
    group_id: s.group_id,
    group_name: s.group_name,
    risk_score: s.risk_score,
    joins_24h: s.joins_24h,
    high_risk_users_24h: s.high_risk_users_24h,
    bans_24h: s.bans_24h,
    last_updated: s.last_updated,
    last_notification_sent: s.last_notification_sent || undefined,
    last_risk_level: s.last_risk_level !== undefined ? s.last_risk_level as GroupRiskLevel : undefined,
  }));
}

// ============================================================================
// Group Settings (Welcome System)
// ============================================================================

/**
 * Holt oder erstellt Group Settings (auto-create mit defaults)
 */
export function getGroupSettings(chatId: string, groupTitle?: string): GroupSettings {
  const db = getDatabase();
  
  let settings = db.prepare('SELECT * FROM group_settings WHERE chat_id = ?').get(chatId) as {
    chat_id: string;
    welcome_enabled: number;
    ref_code: string | null;
    brand_mode: string;
    custom_intro: string | null;
    scam_enabled: number;
  } | undefined;
  
  if (!settings) {
    // Auto-create mit Brand-Erkennung
    const brandMode = (groupTitle && groupTitle.toLowerCase().includes('staatenlos')) 
      ? 'STAATENLOS_COOP' 
      : 'GELDHELDEN';
    
    const stmt = db.prepare(`
      INSERT INTO group_settings (chat_id, welcome_enabled, ref_code, brand_mode, custom_intro, scam_enabled)
      VALUES (?, 1, NULL, ?, NULL, 1)
    `);
    stmt.run(chatId, brandMode);
    
    settings = db.prepare('SELECT * FROM group_settings WHERE chat_id = ?').get(chatId) as typeof settings;
  }
  
  return {
    chat_id: settings.chat_id,
    welcome_enabled: settings.welcome_enabled === 1,
    ref_code: settings.ref_code,
    brand_mode: settings.brand_mode as 'GELDHELDEN' | 'STAATENLOS_COOP',
    custom_intro: settings.custom_intro,
    scam_enabled: settings.scam_enabled === 1,
  };
}

/**
 * Aktualisiert Group Settings
 */
export function upsertGroupSettings(
  chatId: string,
  updates: Partial<Pick<GroupSettings, 'welcome_enabled' | 'ref_code' | 'brand_mode' | 'custom_intro' | 'scam_enabled'>>
): void {
  const db = getDatabase();
  
  const setParts: string[] = [];
  const values: any[] = [];
  
  if (updates.welcome_enabled !== undefined) {
    setParts.push('welcome_enabled = ?');
    values.push(updates.welcome_enabled ? 1 : 0);
  }
  if (updates.ref_code !== undefined) {
    setParts.push('ref_code = ?');
    values.push(updates.ref_code || null);
  }
  if (updates.brand_mode !== undefined) {
    setParts.push('brand_mode = ?');
    values.push(updates.brand_mode);
  }
  if (updates.custom_intro !== undefined) {
    setParts.push('custom_intro = ?');
    values.push(updates.custom_intro || null);
  }
  if (updates.scam_enabled !== undefined) {
    setParts.push('scam_enabled = ?');
    values.push(updates.scam_enabled ? 1 : 0);
  }
  
  if (setParts.length > 0) {
    // Prüfe ob Eintrag existiert
    const exists = db.prepare('SELECT 1 FROM group_settings WHERE chat_id = ?').get(chatId);
    
    if (exists) {
      values.push(chatId);
      const stmt = db.prepare(`UPDATE group_settings SET ${setParts.join(', ')} WHERE chat_id = ?`);
      stmt.run(...values);
    } else {
      // Erstelle neuen Eintrag mit defaults
      const defaults = {
        welcome_enabled: updates.welcome_enabled !== undefined ? (updates.welcome_enabled ? 1 : 0) : 1,
        ref_code: updates.ref_code || null,
        brand_mode: updates.brand_mode || 'GELDHELDEN',
        custom_intro: updates.custom_intro || null,
        scam_enabled: updates.scam_enabled !== undefined ? (updates.scam_enabled ? 1 : 0) : 1,
      };
      
      const allParts = ['welcome_enabled', 'ref_code', 'brand_mode', 'custom_intro', 'scam_enabled'];
      const allValues = [defaults.welcome_enabled, defaults.ref_code, defaults.brand_mode, defaults.custom_intro, defaults.scam_enabled, chatId];
      
      const stmt = db.prepare(`
        INSERT INTO group_settings (${allParts.join(', ')}, chat_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(...allValues);
    }
  }
}

// DUPLIKATE ENTFERNT - Diese Funktionen sind bereits oben definiert (Zeilen 1315, 1330, 1346)

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
