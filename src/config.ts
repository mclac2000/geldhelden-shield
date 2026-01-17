import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  botToken: string;
  adminLogChat: string;
  adminIds: number[];
  joinWindowHours: number;
  joinThreshold: number;
  actionMode: 'restrict' | 'ban';
  timezone: string;
  // Risk Scoring
  riskJoinEvent: number;
  riskMultiJoinBonus: number;
  riskAccountAgeThreshold: number;
  riskAccountAgeBonus: number;
  riskNoUsername: number;
  riskNoProfilePhoto: number;
  riskRestrictThreshold: number;
  riskBanThreshold: number;
  riskDecayAmount: number;
  riskDecayHours: number;
  riskAutoUnrestrictBuffer: number;
  // Anti-Impersonation
  protectedNames: string[];
  impersonationSimilarityThreshold: number; // Levenshtein-Ähnlichkeit (0-100)
  // Debug
  debugJoins: boolean;
  // Moderation Defaults
  linksLockedDefault: boolean;
  forwardLockedDefault: boolean;
  antiFloodWindowSeconds: number;
  antiFloodMessageLimit: number;
  antiFloodAction: 'RESTRICT' | 'KICK';
  antiFloodRestrictMinutes: number;
  // Self-Healing & Safety
  panicMode: boolean; // Stoppt Auto-Bans, nur Logs + Beobachtung
  urlWhitelist: string[]; // Erlaubte URLs (z.B. geldhelden.org)
  enableWelcome: boolean; // Begrüßung aktivieren
  enableServiceMessageCleanup: boolean; // Service-Messages löschen
  enableScamDetection: boolean; // Scam-Erkennung aktivieren
  dryRunMode: boolean; // Dry-Run Mode (keine echten Aktionen)
  // Welcome Default Template
  defaultWelcomeTemplate: string;
}

/**
 * Maskiert einen Bot-Token für sicheres Logging (zeigt nur ersten und letzten Teil)
 */
function maskToken(token: string): string {
  if (!token || token.length < 10) {
    return '***INVALID***';
  }
  if (token.length <= 12) {
    return `${token.substring(0, 4)}...`;
  }
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
}

/**
 * Parst einen boolean-Wert aus ENV (akzeptiert: 'true', 'false', '1', '0', 'yes', 'no')
 */
function parseBoolean(envValue: string | undefined, defaultValue: boolean): boolean {
  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }
  const lower = envValue.toLowerCase().trim();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

/**
 * Parst eine positive Zahl aus ENV mit Default und Validierung
 */
function parsePositiveInt(envValue: string | undefined, defaultValue: number, name: string): number {
  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(`⚠️  [Config] ${name} ungültig ('${envValue}'), verwende Default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

/**
 * Parst eine Zahl aus ENV mit Min/Max-Validierung
 */
function parseBoundedInt(
  envValue: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  name: string
): number {
  if (envValue === undefined || envValue === '') {
    return defaultValue;
  }
  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    console.warn(`⚠️  [Config] ${name} außerhalb Bereich [${min}-${max}] ('${envValue}'), verwende Default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function parseAdminIds(adminIdsStr: string): number[] {
  return adminIdsStr
    .split(',')
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id) && id > 0);
}

/**
 * Validiert die Config und gibt Feedback zu kritischen und nicht-kritischen Problemen
 */
export function validateConfig(config: Config): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // KRITISCHE Validierungen (stoppen den Bot)
  if (!config.botToken || config.botToken.trim() === '' || config.botToken.length < 10) {
    errors.push('BOT_TOKEN fehlt oder ist ungültig (muss mindestens 10 Zeichen haben)');
  } else if (config.botToken.includes('your_bot_token') || config.botToken.includes('PLACEHOLDER')) {
    errors.push('BOT_TOKEN enthält Platzhalter (muss echter Token sein)');
  }

  if (!config.adminLogChat || config.adminLogChat.trim() === '') {
    errors.push('ADMIN_LOG_CHAT fehlt');
  }

  if (!config.adminIds || config.adminIds.length === 0) {
    errors.push('ADMIN_IDS fehlt oder enthält keine gültigen IDs');
  }

  // NICHT-KRITISCHE Validierungen (Warnungen, aber Bot startet)
  if (config.joinWindowHours < 1 || config.joinWindowHours > 168) {
    warnings.push(`JOIN_WINDOW_HOURS außerhalb empfohlenem Bereich (1-168h), aktuell: ${config.joinWindowHours}h`);
  }

  if (config.joinThreshold < 1 || config.joinThreshold > 100) {
    warnings.push(`JOIN_THRESHOLD außerhalb empfohlenem Bereich (1-100), aktuell: ${config.joinThreshold}`);
  }

  if (config.riskBanThreshold <= config.riskRestrictThreshold) {
    warnings.push(`RISK_BAN_THRESHOLD (${config.riskBanThreshold}) sollte größer als RISK_RESTRICT_THRESHOLD (${config.riskRestrictThreshold}) sein`);
  }

  if (config.antiFloodWindowSeconds < 1 || config.antiFloodWindowSeconds > 3600) {
    warnings.push(`ANTI_FLOOD_WINDOW_SECONDS außerhalb empfohlenem Bereich (1-3600s), aktuell: ${config.antiFloodWindowSeconds}s`);
  }

  if (config.impersonationSimilarityThreshold < 0 || config.impersonationSimilarityThreshold > 100) {
    warnings.push(`IMPERSONATION_SIMILARITY_THRESHOLD außerhalb Bereich (0-100), aktuell: ${config.impersonationSimilarityThreshold}`);
  }

  // Zeige Warnungen (Bot startet trotzdem)
  if (warnings.length > 0) {
    console.warn('⚠️  [Config] Konfigurationswarnungen:');
    warnings.forEach(warning => console.warn(`   - ${warning}`));
  }

  // Zeige kritische Fehler (Bot stoppt)
  if (errors.length > 0) {
    console.error('❌ [Config] KRITISCHE Konfigurationsfehler:');
    errors.forEach(error => console.error(`   - ${error}`));
    console.error('❌ Bot startet nicht – bitte .env Datei korrigieren');
    process.exit(1);
  }
}

export function loadConfig(): Config {
  // KRITISCHE Werte (kein Default möglich)
  const botToken = process.env.BOT_TOKEN?.trim() || '';
  if (!botToken || botToken.includes('your_bot_token') || botToken.includes('PLACEHOLDER') || botToken.length < 10) {
    console.error('❌ FATAL: BOT_TOKEN missing oder ungültig');
    console.error('   BOT_TOKEN muss in .env Datei gesetzt sein (kein Platzhalter, mindestens 10 Zeichen)');
    process.exit(1);
  }

  const adminLogChat = process.env.ADMIN_LOG_CHAT?.trim() || '';
  if (!adminLogChat) {
    console.error('❌ FATAL: ADMIN_LOG_CHAT missing');
    console.error('   ADMIN_LOG_CHAT muss in .env Datei gesetzt sein');
    process.exit(1);
  }

  const adminIdsStr = process.env.ADMIN_IDS?.trim() || '';
  if (!adminIdsStr) {
    console.error('❌ FATAL: ADMIN_IDS missing');
    console.error('   ADMIN_IDS muss in .env Datei gesetzt sein (komma-separierte Liste von User IDs)');
    process.exit(1);
  }

  const adminIds = parseAdminIds(adminIdsStr);
  if (adminIds.length === 0) {
    console.error('❌ FATAL: ADMIN_IDS enthält keine gültigen User IDs');
    console.error(`   Parsed aus: "${adminIdsStr}"`);
    process.exit(1);
  }

  // NICHT-KRITISCHE Werte (mit Defaults)
  const joinWindowHours = parsePositiveInt(process.env.JOIN_WINDOW_HOURS, 24, 'JOIN_WINDOW_HOURS');
  const joinThreshold = parsePositiveInt(process.env.JOIN_THRESHOLD, 5, 'JOIN_THRESHOLD');
  const actionMode = (process.env.ACTION_MODE || 'restrict').toLowerCase().trim() as 'restrict' | 'ban';
  const actionModeValid = actionMode === 'restrict' || actionMode === 'ban';
  const finalActionMode = actionModeValid ? actionMode : 'restrict';
  if (!actionModeValid) {
    console.warn(`⚠️  [Config] ACTION_MODE ungültig ('${process.env.ACTION_MODE}'), verwende Default: 'restrict'`);
  }

  const timezone = process.env.TZ?.trim() || process.env.TIMEZONE?.trim() || 'UTC';

  // Risk Scoring Parameter (alle mit Defaults)
  const riskJoinEvent = parsePositiveInt(process.env.RISK_JOIN_EVENT, 10, 'RISK_JOIN_EVENT');
  const riskMultiJoinBonus = parsePositiveInt(process.env.RISK_MULTI_JOIN_BONUS, 20, 'RISK_MULTI_JOIN_BONUS');
  const riskAccountAgeThreshold = parsePositiveInt(process.env.RISK_ACCOUNT_AGE_THRESHOLD, 7, 'RISK_ACCOUNT_AGE_THRESHOLD');
  const riskAccountAgeBonus = parsePositiveInt(process.env.RISK_ACCOUNT_AGE_BONUS, 30, 'RISK_ACCOUNT_AGE_BONUS');
  const riskNoUsername = parsePositiveInt(process.env.RISK_NO_USERNAME, 15, 'RISK_NO_USERNAME');
  const riskNoProfilePhoto = parsePositiveInt(process.env.RISK_NO_PROFILE_PHOTO, 10, 'RISK_NO_PROFILE_PHOTO');
  const riskRestrictThreshold = parsePositiveInt(process.env.RISK_RESTRICT_THRESHOLD, 60, 'RISK_RESTRICT_THRESHOLD');
  const riskBanThreshold = parsePositiveInt(process.env.RISK_BAN_THRESHOLD, 120, 'RISK_BAN_THRESHOLD');
  const riskDecayAmount = parsePositiveInt(process.env.RISK_DECAY_AMOUNT, 20, 'RISK_DECAY_AMOUNT');
  const riskDecayHours = parsePositiveInt(process.env.RISK_DECAY_HOURS, 24, 'RISK_DECAY_HOURS');
  const riskAutoUnrestrictBuffer = parsePositiveInt(process.env.RISK_AUTO_UNRESTRICT_BUFFER, 20, 'RISK_AUTO_UNRESTRICT_BUFFER');

  // Anti-Impersonation
  const protectedNamesStr = process.env.PROTECTED_NAMES?.trim() || 'Marco,McLac2000,Geldhelden,Geldhelden Team,Geldhelden Support';
  const protectedNames = protectedNamesStr
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);
  
  if (protectedNames.length === 0) {
    console.warn('⚠️  [Config] PROTECTED_NAMES ist leer, verwende Fallback');
    protectedNames.push('Marco', 'McLac2000', 'Geldhelden');
  }

  const impersonationSimilarityThreshold = parseBoundedInt(
    process.env.IMPERSONATION_SIMILARITY_THRESHOLD,
    80,
    0,
    100,
    'IMPERSONATION_SIMILARITY_THRESHOLD'
  );

  // Debug
  const debugJoins = parseBoolean(process.env.DEBUG_JOINS, false);

  // Moderation Defaults
  const linksLockedDefault = parseBoolean(process.env.LINKS_LOCKED_DEFAULT, true);
  const forwardLockedDefault = parseBoolean(process.env.FORWARD_LOCKED_DEFAULT, true);
  const antiFloodWindowSeconds = parsePositiveInt(process.env.ANTI_FLOOD_WINDOW_SECONDS, 30, 'ANTI_FLOOD_WINDOW_SECONDS');
  const antiFloodMessageLimit = parsePositiveInt(process.env.ANTI_FLOOD_MESSAGE_LIMIT, 5, 'ANTI_FLOOD_MESSAGE_LIMIT');
  const antiFloodActionStr = (process.env.ANTI_FLOOD_ACTION || 'RESTRICT').toUpperCase().trim();
  const antiFloodAction = (antiFloodActionStr === 'KICK' ? 'KICK' : 'RESTRICT') as 'RESTRICT' | 'KICK';
  const antiFloodRestrictMinutes = parsePositiveInt(process.env.ANTI_FLOOD_RESTRICT_MINUTES, 10, 'ANTI_FLOOD_RESTRICT_MINUTES');

  // Self-Healing & Safety
  const panicMode = parseBoolean(process.env.PANIC_MODE, false);
  const urlWhitelistStr = process.env.URL_WHITELIST?.trim() || 'geldhelden.org,staatenlos.ch';
  const urlWhitelist = urlWhitelistStr
    .split(',')
    .map(url => url.trim().toLowerCase())
    .filter(url => url.length > 0);
  
  if (urlWhitelist.length === 0) {
    console.warn('⚠️  [Config] URL_WHITELIST ist leer, verwende Fallback');
    urlWhitelist.push('geldhelden.org', 'staatenlos.ch');
  }

  const enableWelcome = parseBoolean(process.env.ENABLE_WELCOME, true);
  const enableServiceMessageCleanup = parseBoolean(process.env.ENABLE_SERVICE_MESSAGE_CLEANUP, true);
  const enableScamDetection = parseBoolean(process.env.ENABLE_SCAM_DETECTION, true);
  const dryRunMode = parseBoolean(process.env.DRY_RUN_MODE, false);

  // Default Welcome Template
  const defaultWelcomeTemplate = process.env.DEFAULT_WELCOME_TEMPLATE?.trim() || `Hey {first} 👋

Schön, dass du da bist.
👉 Stell dich kurz vor: Wer bist du und was führt dich hierher?

⚠️ Wichtig: Admins schreiben dich niemals privat an. Wenn dir jemand „Support" anbietet → bitte melden.

Mehr Infos: {bio_link}`;

  const config: Config = {
    botToken,
    adminLogChat,
    adminIds,
    joinWindowHours,
    joinThreshold,
    actionMode: finalActionMode,
    timezone,
    riskJoinEvent,
    riskMultiJoinBonus,
    riskAccountAgeThreshold,
    riskAccountAgeBonus,
    riskNoUsername,
    riskNoProfilePhoto,
    riskRestrictThreshold,
    riskBanThreshold,
    riskDecayAmount,
    riskDecayHours,
    riskAutoUnrestrictBuffer,
    protectedNames,
    impersonationSimilarityThreshold,
    debugJoins,
    linksLockedDefault,
    forwardLockedDefault,
    antiFloodWindowSeconds,
    antiFloodMessageLimit,
    antiFloodAction,
    antiFloodRestrictMinutes,
    panicMode,
    urlWhitelist,
    enableWelcome,
    enableServiceMessageCleanup,
    enableScamDetection,
    dryRunMode,
    defaultWelcomeTemplate,
  };

  // Validiere finales Config-Objekt
  validateConfig(config);

  return config;
}

export const config = loadConfig();

// Runtime-Toggle für Dry-Run Mode (überschreibt Config)
let runtimeDryRunMode: boolean | null = null;

/**
 * Prüft ob Dry-Run Mode aktiv ist (Runtime-Toggle hat Vorrang vor Config)
 */
export function isDryRunMode(): boolean {
  return runtimeDryRunMode !== null ? runtimeDryRunMode : config.dryRunMode;
}

/**
 * Setzt Dry-Run Mode Runtime-Toggle (null = Config verwenden)
 */
export function setDryRunMode(enabled: boolean | null): void {
  runtimeDryRunMode = enabled;
  console.log(`[DRYRUN] Runtime-Toggle: ${enabled === null ? 'Config-Modus' : enabled ? 'AKTIV' : 'INAKTIV'}`);
}
