/**
 * Scam Detection & Scoring Engine
 * 
 * Erkennt Scam-/Phishing-/Werbe-Texte zuverlässig (DE+EN, inkl. Varianten)
 * mit konfigurierbaren Aktionen pro Gruppe.
 */

import { Message, MessageEntity } from 'telegraf/types';
import { getGroupConfig } from './db';
import { isAdmin } from './admin';
import { isTeamMember } from './db';
import { featureEnabled } from './groupConfig';

export interface ScamResult {
  score: number; // 0..100
  reasons: string[];
  matchedPatterns: string[];
  hasUrl: boolean;
  suspiciousUrl: boolean;
  shouldAct: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH'; // Neue Severity-Klassifizierung
}

interface ScamContext {
  text: string;
  caption?: string;
  entities?: MessageEntity[];
  userId: number;
  username?: string;
  firstName?: string;
  isPremium?: boolean;
  chatId: string;
  isReply?: boolean;
  replyToUserId?: number;
}

// Scam Patterns mit neuen Gewichtungen (HIGH=10, MED=6, LOW=3)
const HIGH_RISK_PHRASES: Array<{ pattern: RegExp; weight: number; reason: string; jobSpam?: boolean }> = [
  // Account/Verification Scams (HIGH)
  { pattern: /konto\s+(eingeschränkt|gesperrt|blockiert)/i, weight: 10, reason: 'account_restriction_scam' },
  { pattern: /account\s+(restricted|suspended|blocked|locked)/i, weight: 10, reason: 'account_restriction_scam' },
  { pattern: /account\s+restore/i, weight: 10, reason: 'account_restore_scam' },
  { pattern: /account\s+wiederherstellen/i, weight: 10, reason: 'account_restore_scam' },
  { pattern: /verify\s+now/i, weight: 10, reason: 'verify_now_scam' },
  { pattern: /dringend\s+bestätigen/i, weight: 10, reason: 'urgent_verify_scam' },
  { pattern: /security\s+alert/i, weight: 10, reason: 'security_alert_scam' },

  // Support Scams (HIGH)
  { pattern: /support/i, weight: 10, reason: 'support_scam' },
  { pattern: /official\s+support/i, weight: 10, reason: 'official_support_scam' },
  { pattern: /telegram\s+support/i, weight: 10, reason: 'telegram_support_scam' },
  { pattern: /kontakt\s+admin/i, weight: 10, reason: 'contact_admin_scam' },
  { pattern: /admin\s+kontaktieren/i, weight: 10, reason: 'contact_admin_scam' },

  // Private Message Requests (HIGH)
  { pattern: /write\s+me\s+privately/i, weight: 10, reason: 'pm_request' },
  { pattern: /schreib\s+mir\s+privat/i, weight: 10, reason: 'pm_request' },

  // Job Spam: Contact redirect to external Telegram account (HIGH)
  // Erkennt: "Contact 👉 @Anna_Lour", "Kontakt → @user", "write to 👉 @user", etc.
  // Unicode-Varianten: 👉 ➡️ → >> > — alle Pfeile/Emojis die auf @username zeigen
  { pattern: /contact\s*[👉➡️→>]+\s*@\w+/iu, weight: 10, reason: 'job_spam_contact_redirect', jobSpam: true },
  { pattern: /kontakt\s*[👉➡️→>]+\s*@\w+/iu, weight: 10, reason: 'job_spam_contact_redirect', jobSpam: true },
  { pattern: /write\s+(?:to\s+)?[👉➡️→>]+\s*@\w+/iu, weight: 10, reason: 'job_spam_contact_redirect', jobSpam: true },
  { pattern: /schreib\s+(?:an?\s+)?[👉➡️→>]+\s*@\w+/iu, weight: 10, reason: 'job_spam_contact_redirect', jobSpam: true },
  // "Contact @username" ohne Pfeil aber mit "contact" direkt vor @mention
  { pattern: /\bcontact\b[^\n@]{0,20}@\w{4,}/i, weight: 10, reason: 'job_spam_contact_redirect', jobSpam: true },

  // Job Spam: Einkommensversprechen mit Währung + Zeitraum (HIGH)
  // Erkennt: "€1,600 per week", "$2000 per month", "1.600 EUR pro Woche", etc.
  // Varianten: €/$, Komma vs Punkt als Tausender-Trennzeichen, em-dash davor
  { pattern: /[€$£₽]\s*[\d][,.\d]*\s*(?:per|pro)\s*(?:week|woche|month|monat)/iu, weight: 10, reason: 'job_spam_income_claim', jobSpam: true },
  { pattern: /[\d][,.\d]*\s*[€$£₽]\s*(?:per|pro)\s*(?:week|woche|month|monat)/iu, weight: 10, reason: 'job_spam_income_claim', jobSpam: true },
  { pattern: /[\d][,.\d]*\s*(?:eur|usd|dollar|euro)\s*(?:per|pro)\s*(?:week|woche|month|monat)/iu, weight: 10, reason: 'job_spam_income_claim', jobSpam: true },
  // "income — €1,600 per week" (mit em-dash, en-dash oder Strich dazwischen)
  { pattern: /income\s*[—–-]\s*[€$£₽]?\s*[\d]/iu, weight: 10, reason: 'job_spam_income_claim', jobSpam: true },
  { pattern: /einkommen\s*[—–-]\s*[€$£₽]?\s*[\d]/iu, weight: 10, reason: 'job_spam_income_claim', jobSpam: true },
];

const MEDIUM_RISK_PHRASES: Array<{ pattern: RegExp; weight: number; reason: string; jobSpam?: boolean }> = [
  // Reward/Scam Promises (MED)
  { pattern: /bonus\s+code/i, weight: 6, reason: 'bonus_code_scam' },
  { pattern: /airdrop/i, weight: 6, reason: 'airdrop_scam' },
  { pattern: /giveaway/i, weight: 6, reason: 'giveaway_scam' },
  { pattern: /claim/i, weight: 6, reason: 'claim_scam' },
  { pattern: /reward/i, weight: 6, reason: 'reward_scam' },
  { pattern: /belohnung\s+wartet/i, weight: 6, reason: 'reward_scam' },

  // Investment Scams (MED)
  { pattern: /investiere\s+jetzt/i, weight: 6, reason: 'investment_scam' },
  { pattern: /100%\s+profit/i, weight: 6, reason: 'guaranteed_profit_scam' },
  { pattern: /verdiene\s+geld\s+schnell/i, weight: 6, reason: 'quick_money_scam' },
  { pattern: /geschäftsmöglichkeit/i, weight: 6, reason: 'business_opportunity_scam' },

  // Job Spam: Recruiting-Formulierungen (MED)
  // "seeking 1–3 individuals", "looking for 2-5 people", "suche 1 bis 3 Personen"
  // Varianten: em-dash (—), en-dash (–), Bindestrich, Leerzeichen zwischen Zahlen
  { pattern: /seeking\s+\d+\s*[–—\-~to bis]*\s*\d*\s+individuals?/iu, weight: 6, reason: 'job_spam_seeking', jobSpam: true },
  { pattern: /looking\s+for\s+\d+\s*[–—\-~to]*\s*\d*\s+(?:individuals?|persons?|people)/iu, weight: 6, reason: 'job_spam_seeking', jobSpam: true },
  { pattern: /suche\s+\d+\s*(?:bis\s*\d+\s*)?(?:personen?|mitarbeiter|leute)/iu, weight: 6, reason: 'job_spam_seeking', jobSpam: true },
  { pattern: /wir\s+suchen\s+\d+\s*(?:bis\s*\d+\s*)?(?:personen?|mitarbeiter|leute)/iu, weight: 6, reason: 'job_spam_seeking', jobSpam: true },

  // Job Spam: Remote Opportunity (MED)
  { pattern: /remote\s+opportunity/iu, weight: 6, reason: 'job_spam_remote', jobSpam: true },
  { pattern: /remote[\s-]+(?:m[öo]glichkeit|chance|stelle|job|arbeit|t[äa]tigkeit|position)/iu, weight: 6, reason: 'job_spam_remote', jobSpam: true },
  { pattern: /heimarbeit|home[\s-]?office[\s-]?job/iu, weight: 6, reason: 'job_spam_remote', jobSpam: true },

  // Job Spam: Smartphone zugänglich (MED)
  // "Accessible via smartphone", "vom Handy aus", "per Smartphone erreichbar"
  { pattern: /accessible\s+via\s+smartphone/iu, weight: 6, reason: 'job_spam_smartphone', jobSpam: true },
  { pattern: /vom\s+handy\s+aus/iu, weight: 6, reason: 'job_spam_smartphone', jobSpam: true },
  { pattern: /per\s+(?:smartphone|handy|telefon)\s+(?:erreichbar|bedienbar|machbar|möglich)/iu, weight: 6, reason: 'job_spam_smartphone', jobSpam: true },
  { pattern: /nur\s+(?:ein\s+)?smartphone\s+(?:ben[öo]tigt|erforderlich|nötig|reicht)/iu, weight: 6, reason: 'job_spam_smartphone', jobSpam: true },

  // Job Spam: Potential income / Potenzielles Einkommen (MED)
  { pattern: /potential\s+(?:income|earnings?|verdienst)/iu, weight: 6, reason: 'job_spam_income', jobSpam: true },
  { pattern: /potenziell(?:es?|e)?\s+(?:einkommen|verdienst|einnahmen)/iu, weight: 6, reason: 'job_spam_income', jobSpam: true },
  { pattern: /verdienst(?:m[öo]glichkeit)?.*?(?:woche|monat|week|month)/iu, weight: 6, reason: 'job_spam_income', jobSpam: true },
  { pattern: /nebenverdienst|nebeneinkommen/iu, weight: 6, reason: 'job_spam_side_income', jobSpam: true },

  // Job Spam: Work from home (MED)
  { pattern: /work\s+from\s+home/iu, weight: 6, reason: 'job_spam_wfh', jobSpam: true },
  { pattern: /von\s+zu\s+hause\s+(?:aus\s+)?(?:arbeiten|verdienen|geld\s+verdienen)/iu, weight: 6, reason: 'job_spam_wfh', jobSpam: true },

  // Job Spam: Flexible hours (MED, nur in Kombination aussagekräftig)
  { pattern: /flexible\s+(?:hours?|arbeitszeiten|zeiten|schedule)/iu, weight: 6, reason: 'job_spam_flexible', jobSpam: true },
  { pattern: /freie\s+(?:zeiteinteilung|arbeitszeiten)/iu, weight: 6, reason: 'job_spam_flexible', jobSpam: true },

  // Job Spam: Einladung zu DM / Weiterverweis (MED)
  { pattern: /dm\s+(?:me|uns|mich)\s+(?:for|f[üu]r|f[üu]r\s+mehr)/iu, weight: 6, reason: 'job_spam_dm_redirect', jobSpam: true },
  { pattern: /(?:mehr\s+)?infos?\s+per\s+(?:dm|privat|nachricht)/iu, weight: 6, reason: 'job_spam_dm_redirect', jobSpam: true },
];

const LOW_RISK_PHRASES: Array<{ pattern: RegExp; weight: number; reason: string }> = [
  // Signal Groups / VIP (LOW)
  { pattern: /signal\s+group/i, weight: 3, reason: 'signal_group_scam' },
  { pattern: /vip\s+gruppe/i, weight: 3, reason: 'vip_group_scam' },
  { pattern: /cloud\s+mining/i, weight: 3, reason: 'mining_scam' },
  { pattern: /pump\s+and\s+dump/i, weight: 3, reason: 'pump_dump_scam' },
];

// Alle Job-Spam-Reasons für Combo-Detektion
const JOB_SPAM_REASONS = new Set([
  'job_spam_contact_redirect', 'job_spam_income_claim', 'job_spam_seeking',
  'job_spam_remote', 'job_spam_smartphone', 'job_spam_income',
  'job_spam_side_income', 'job_spam_wfh', 'job_spam_flexible', 'job_spam_dm_redirect',
]);

// URL Shorteners
const URL_SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'short.link', 't.co', 'goo.gl', 'ow.ly', 'is.gd'];

// Social Engineering Patterns
const URGENCY_PATTERNS: Array<{ pattern: RegExp; score: number; reason: string }> = [
  { pattern: /(dringend|urgent|sofort|immediately)/i, score: 15, reason: 'urgency_language' },
  { pattern: /(letzte\s+chance|last\s+chance)/i, score: 15, reason: 'urgency_language' },
  { pattern: /(in\s+nur|only)\s+\d+\s+(minuten|minutes)/i, score: 15, reason: 'urgency_language' },
];

// Mentions
const SUSPICIOUS_MENTIONS = ['@admin', '@support', '@telegram', '@telegramadmin'];

/**
 * Normalisiert Text für Scam-Erkennung
 */
export function normalizeText(input: string): string {
  let text = input;
  
  // Lowercasing
  text = text.toLowerCase();
  
  // Trim
  text = text.trim();
  
  // Remove excessive whitespace
  text = text.replace(/\s+/g, ' ');
  
  // Remove zero-width chars
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  
  // Minimal homoglyph replacement (optional, nur kritische Fälle)
  text = text.replace(/[а]/g, 'a'); // Cyrillic 'а' -> Latin 'a'
  text = text.replace(/[е]/g, 'e'); // Cyrillic 'е' -> Latin 'e'
  text = text.replace(/[о]/g, 'o'); // Cyrillic 'о' -> Latin 'o'
  text = text.replace(/[р]/g, 'p'); // Cyrillic 'р' -> Latin 'p'

  // Weitere Homoglyphen für Job-Spam-Umgehungsversuche
  text = text.replace(/[с]/g, 'c'); // Cyrillic 'с' -> Latin 'c'
  text = text.replace(/[і]/g, 'i'); // Cyrillic 'і' -> Latin 'i'
  text = text.replace(/[у]/g, 'y'); // Cyrillic 'у' -> Latin 'y'

  // Unicode-Tricks: em-dash, en-dash → Bindestrich (für Muster wie "1–3 Personen")
  text = text.replace(/[—–]/g, '-');

  // Fancy Unicode-Zahlen → ASCII (fullwidth digits)
  text = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  return text;
}

/**
 * Zählt wie viele einzigartige Job-Spam-Pattern-Reasons gematchten
 */
function countJobSpamHits(reasons: string[]): number {
  return reasons.filter(r => JOB_SPAM_REASONS.has(r)).length;
}

/**
 * Extrahiert URLs aus Text und Entities
 */
export function extractUrls(text: string, entities?: MessageEntity[]): string[] {
  const urls: string[] = [];
  
  // Aus Entities (Telegram API)
  if (entities) {
    for (const entity of entities) {
      if (entity.type === 'url' && 'url' in entity) {
        const url = entity.url;
        urls.push(typeof url === 'string' ? url : String(url || ''));
      } else if (entity.type === 'text_link' && 'url' in entity) {
        const url = entity.url;
        urls.push(typeof url === 'string' ? url : String(url || ''));
      }
    }
  }
  
  // Fallback: Regex aus Text
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = text.match(urlRegex);
  if (matches) {
    urls.push(...matches);
  }
  
  return urls;
}

/**
 * Prüft ob URL in Allowlist ist
 */
function isUrlAllowed(url: string, allowlist: string | null): boolean {
  if (!allowlist) {
    return false;
  }
  
  const domains = allowlist.split(',').map(d => d.trim().toLowerCase());
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Prüfe exakte Domain oder Subdomain
    for (const domain of domains) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }
    
    return false;
  } catch {
    // Ungültige URL
    return false;
  }
}

/**
 * Prüft ob URL ein Shortener ist
 */
function isUrlShortener(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    return URL_SHORTENERS.some(shortener => hostname.includes(shortener));
  } catch {
    return false;
  }
}

/**
 * Prüft ob URL ein t.me Invite-Link ist
 */
function isTelegramInviteLink(url: string): boolean {
  return /t\.me\/\+/.test(url) || /telegram\.me\/\+/.test(url);
}

/**
 * Zählt Emojis in Text
 */
function countEmojis(text: string): number {
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|✅|👉|🔗|💰|🚀/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

/**
 * Prüft ob Text viele UPPERCASE Zeichen hat
 */
function hasExcessiveUppercase(text: string): boolean {
  if (text.length < 10) return false;
  const uppercaseCount = (text.match(/[A-ZÄÖÜ]/g) || []).length;
  return uppercaseCount / text.length > 0.5; // Mehr als 50% uppercase
}

/**
 * Score Scam basierend auf Text, URLs und Meta-Informationen
 * 
 * @param text - Normalisierter Text
 * @param urls - Extrahierte URLs
 * @param meta - Meta-Informationen (isForwarded, hasEntities)
 * @returns Scam-Ergebnis mit Score, Reasons und Severity
 */
export function scoreScam(
  text: string,
  urls: string[],
  meta: { isForwarded: boolean; hasEntities: boolean }
): { score: number; reasons: string[]; severity: 'LOW' | 'MEDIUM' | 'HIGH' } {
  let score = 0;
  const reasons: string[] = [];
  
  // Normalisiere Text
  const normalizedText = normalizeText(text);
  
  // HIGH-Risk Keywords
  for (const phrase of HIGH_RISK_PHRASES) {
    if (phrase.pattern.test(text)) {
      score += phrase.weight;
      reasons.push(phrase.reason);
    }
  }
  
  // MEDIUM-Risk Keywords
  for (const phrase of MEDIUM_RISK_PHRASES) {
    if (phrase.pattern.test(text)) {
      score += phrase.weight;
      reasons.push(phrase.reason);
    }
  }
  
  // LOW-Risk Keywords
  for (const phrase of LOW_RISK_PHRASES) {
    if (phrase.pattern.test(text)) {
      score += phrase.weight;
      reasons.push(phrase.reason);
    }
  }
  
  // URL-Regeln
  if (urls.length > 0) {
    // Importiere config synchron (wird beim ersten Aufruf geladen)
    const configModule = require('./config');
    const config = configModule.config;
    
    for (const url of urls) {
      // Prüfe Whitelist
      let isWhitelisted = false;
      for (const whitelistedDomain of config.urlWhitelist) {
        try {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname.toLowerCase();
          if (hostname === whitelistedDomain || hostname.endsWith('.' + whitelistedDomain)) {
            isWhitelisted = true;
            break;
          }
        } catch {
          // Ungültige URL, ignoriere
        }
      }
      
      if (!isWhitelisted) {
        score += 8; // MED/HIGH wenn nicht whitelisted
        reasons.push('unapproved_url');
      }
      
      // t.me invite links
      if (isTelegramInviteLink(url)) {
        score += 10; // HIGH
        reasons.push('telegram_invite_link');
      }
      
      // URL Shorteners
      if (isUrlShortener(url)) {
        score += 10; // HIGH
        reasons.push('url_shortener');
      }
    }
  }
  
  // Forward-Regeln
  if (meta.isForwarded) {
    // Wenn forwarded + suspicious keywords -> +4
    const hasSuspiciousKeywords = HIGH_RISK_PHRASES.some(p => p.pattern.test(text)) ||
                                  MEDIUM_RISK_PHRASES.some(p => p.pattern.test(text));
    if (hasSuspiciousKeywords) {
      score += 4;
      reasons.push('forwarded_suspicious');
    }
  }

  // Job-Spam Combo-Bonus: Bei ≥2 verschiedenen Job-Spam-Patterns → +25 (Threshold-Überschreitung)
  // Hintergrund: Eine Einzelphrase reicht nicht → aber das Zusammenspiel ist eindeutig Spam
  const jobSpamHits = countJobSpamHits([...new Set(reasons)]);
  if (jobSpamHits >= 2) {
    score += 25;
    reasons.push('job_spam_combo');
  }

  // Severity Mapping
  let severity: 'LOW' | 'MEDIUM' | 'HIGH';
  if (score >= 18) {
    severity = 'HIGH';
  } else if (score >= 10) {
    severity = 'MEDIUM';
  } else if (reasons.length > 0) {
    severity = 'LOW';
  } else {
    severity = 'LOW'; // Fallback
  }
  
  return { score, reasons: [...new Set(reasons)], severity };
}

/**
 * Evaluates Scam Score für eine Nachricht (Legacy-Kompatibilität + neue Severity)
 */
export function evaluateScam(context: ScamContext): ScamResult {
  const { text, caption, entities, userId, chatId } = context;
  const fullText = (text || caption || '').toLowerCase();
  const originalText = text || caption || '';
  
  let score = 0;
  const reasons: string[] = [];
  const matchedPatterns: string[] = [];
  
  // Whitelist: Team-Mitglieder und Admins
  if (isAdmin(userId) || isTeamMember(userId)) {
    return {
      score: 0,
      reasons: ['team_member_or_admin'],
      matchedPatterns: [],
      hasUrl: false,
      suspiciousUrl: false,
      shouldAct: false,
      severity: 'LOW', // Team-Mitglieder/Admins sind immer LOW (keine Aktion)
    };
  }
  
  // False-Positive Schutz: Sehr kurze Nachrichten ohne URL
  const urls = extractUrls(originalText, entities);
  const hasUrl = urls.length > 0;
  
  if (originalText.length < 10 && !hasUrl) {
    score -= 20;
    reasons.push('short_message_protection');
  }
  
  // Reply auf Admin/Mod-Thread (optional, wenn replyToUserId bekannt)
  if (context.isReply && context.replyToUserId) {
    if (isAdmin(context.replyToUserId) || isTeamMember(context.replyToUserId)) {
      score -= 10;
      reasons.push('reply_to_admin');
    }
  }
  
  // A) High-risk Phrasen
  for (const phrase of HIGH_RISK_PHRASES) {
    if (phrase.pattern.test(originalText)) {
      score += phrase.weight;
      reasons.push(phrase.reason);
      matchedPatterns.push(phrase.pattern.source);
    }
  }
  
  // MEDIUM-Risk Phrasen
  for (const phrase of MEDIUM_RISK_PHRASES) {
    if (phrase.pattern.test(originalText)) {
      score += phrase.weight;
      reasons.push(phrase.reason);
      matchedPatterns.push(phrase.pattern.source);
    }
  }
  
  // LOW-Risk Phrasen
  for (const phrase of LOW_RISK_PHRASES) {
    if (phrase.pattern.test(originalText)) {
      score += phrase.weight;
      reasons.push(phrase.reason);
      matchedPatterns.push(phrase.pattern.source);
    }
  }
  
  // B) Link-Analyse
  let suspiciousUrl = false;
  
  if (hasUrl) {
    const config = getGroupConfig(chatId);
    const urlPolicyMode = config?.url_policy_mode || 'allowlist';
    const urlAllowlist = config?.url_allowlist || 'geldhelden.org,t.me,telegram.me';
    
    for (const url of urls) {
      // Telegram Invite-Links
      if (isTelegramInviteLink(url)) {
        score += 30;
        reasons.push('telegram_invite_link');
        suspiciousUrl = true;
        continue;
      }
      
      // URL Shorteners
      if (isUrlShortener(url)) {
        score += 30;
        reasons.push('url_shortener');
        suspiciousUrl = true;
        continue;
      }
      
      // URL Policy Check
      if (urlPolicyMode === 'block_all') {
        score += 50;
        reasons.push('url_blocked_all');
        suspiciousUrl = true;
      } else if (urlPolicyMode === 'allowlist') {
        if (!isUrlAllowed(url, urlAllowlist)) {
          score += 40;
          reasons.push('unapproved_url');
          suspiciousUrl = true;
        }
      }
      // 'allow' mode: keine URL-Punktzahl
    }
  }
  
  // C) Social-engineering Muster
  for (const pattern of URGENCY_PATTERNS) {
    if (pattern.pattern.test(originalText)) {
      score += pattern.score;
      reasons.push(pattern.reason);
    }
  }
  
  // Viele Emojis + Link
  const emojiCount = countEmojis(originalText);
  if (emojiCount >= 3 && hasUrl) {
    score += 10;
    reasons.push('excessive_emojis_with_link');
  }
  
  // UPPERCASE + Link
  if (hasExcessiveUppercase(originalText) && hasUrl) {
    score += 10;
    reasons.push('excessive_uppercase_with_link');
  }
  
  // D) Mentions (verdächtige System-Accounts)
  for (const mention of SUSPICIOUS_MENTIONS) {
    if (fullText.includes(mention.toLowerCase())) {
      score += 15;
      reasons.push('suspicious_mention');
    }
  }

  // E) Mention-Entity-Detektor für Job-Spam:
  // Wenn die Nachricht eine @mention-Entity enthält (d.h. Link zu externem User)
  // UND bereits Job-Spam-Patterns gematcht haben → starker Hinweis auf Kontakt-Redirect
  if (entities) {
    const hasMentionEntity = entities.some(e => e.type === 'mention');
    if (hasMentionEntity) {
      const jobSpamHitsBeforeMention = reasons.filter(r => JOB_SPAM_REASONS.has(r)).length;
      if (jobSpamHitsBeforeMention >= 1) {
        // @mention + Job-Spam-Kontext = sehr starkes Signal
        score += 20;
        reasons.push('job_spam_mention_redirect');
      } else {
        // @mention allein: kleiner Bonus wenn kein offensichtlicher Job-Spam-Kontext
        score += 5;
        reasons.push('external_mention');
      }
    }
  }

  // F) Job-Spam Combo-Bonus: bei ≥2 verschiedenen Job-Spam-Reasons → +25
  const jobSpamHits = countJobSpamHits([...new Set(reasons)]);
  if (jobSpamHits >= 2) {
    score += 25;
    reasons.push('job_spam_combo');
  }

  // Score begrenzen auf 0-100
  score = Math.max(0, Math.min(100, score));
  
  // Prüfe Threshold
  const config = getGroupConfig(chatId);
  const threshold = config?.scam_threshold || 70;
  const shouldAct = score >= threshold;
  
  // Severity Mapping (neu)
  let severity: 'LOW' | 'MEDIUM' | 'HIGH';
  if (score >= 18) {
    severity = 'HIGH';
  } else if (score >= 10) {
    severity = 'MEDIUM';
  } else if (reasons.length > 0) {
    severity = 'LOW';
  } else {
    severity = 'LOW';
  }
  
  return {
    score,
    reasons: [...new Set(reasons)], // Deduplizieren
    matchedPatterns: [...new Set(matchedPatterns)],
    hasUrl,
    suspiciousUrl,
    shouldAct,
    severity, // Neue Severity-Klassifizierung
  };
}

/**
 * Erstellt Scam-Context aus Telegram Message
 */
export function createScamContext(
  message: Message,
  chatId: string,
  userId: number,
  userInfo?: { username?: string; firstName?: string; isPremium?: boolean }
): ScamContext | null {
  const text = 'text' in message ? message.text : undefined;
  const caption = 'caption' in message ? message.caption : undefined;
  const entities = 'entities' in message ? message.entities : ('caption_entities' in message ? message.caption_entities : undefined);
  const replyToMessage = 'reply_to_message' in message ? message.reply_to_message : undefined;
  
  if (!text && !caption) {
    return null; // Kein Text vorhanden
  }
  
  return {
    text: text || '',
    caption,
    entities,
    userId,
    username: userInfo?.username,
    firstName: userInfo?.firstName,
    isPremium: userInfo?.isPremium,
    chatId,
    isReply: !!replyToMessage,
    replyToUserId: replyToMessage && 'from' in replyToMessage ? replyToMessage.from.id : undefined,
  };
}
