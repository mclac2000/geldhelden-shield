/**
 * Link Policy Moderation
 * 
 * Löscht Links von neuen Usern (innerhalb eines Zeitfensters)
 */

import { Context } from 'telegraf';
import { getGroupConfig, getUser, isTeamMember } from './db';
import { featureEnabled } from './groupConfig';
import { deleteMessage } from './telegram';
import { config } from './config';
import { getAllowedDomains, isDomainAllowed } from './groupIntelligence';

/**
 * Extrahiert URLs aus einer Nachricht
 */
function extractUrls(messageText: string, entities: any[] | undefined): string[] {
  const urls: string[] = [];
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  
  // From text
  let match;
  while ((match = urlRegex.exec(messageText)) !== null) {
    urls.push(match[0]);
  }
  
  // From entities
  if (entities) {
    for (const entity of entities) {
      if (entity.type === 'url' || entity.type === 'text_link') {
        const url = entity.url || messageText.substring(entity.offset, entity.offset + entity.length);
        if (url) urls.push(url);
      }
    }
  }
  
  return urls;
}

/**
 * Prüft ob eine URL in der Whitelist ist
 */
function isUrlWhitelisted(url: string, whitelistDomains: string): boolean {
  const domains = whitelistDomains.split(',').map(d => d.trim().toLowerCase());
  const lowerUrl = url.toLowerCase();
  
  return domains.some(domain => lowerUrl.includes(domain));
}

/**
 * Prüft ob User "neu" ist (innerhalb des Zeitfensters)
 */
function isNewUser(userId: number, windowMinutes: number): boolean {
  const user = getUser(userId);
  if (!user) {
    return true; // Unbekannter User = neu
  }
  
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const userAge = now - user.first_seen;
  
  return userAge < windowMs;
}

/**
 * Moderiert Links in einer Nachricht
 */
export async function moderateLinkPolicy(ctx: Context): Promise<boolean> {
  const message = ctx.message || ctx.editedMessage;
  if (!message) {
    return false;
  }
  
  // Type guards für Text/Caption
  const hasText = 'text' in message && message.text;
  const hasCaption = 'caption' in message && message.caption;
  if (!hasText && !hasCaption) {
    return false;
  }
  
  const chatId = message.chat.id.toString();
  const userId = message.from?.id;
  const messageId = message.message_id;
  const messageText = (hasText ? message.text : '') || (hasCaption ? message.caption : '') || '';
  const entities = ('entities' in message ? message.entities : undefined) || ('caption_entities' in message ? message.caption_entities : undefined);
  
  if (!userId) {
    return false;
  }
  
  // Team/Admin Safety
  if (isTeamMember(userId) || config.adminIds.includes(userId)) {
    return false; // Skip
  }
  
  // Feature Flag Check
  if (!featureEnabled(chatId, 'links')) {
    return false;
  }
  
  const groupConfig = getGroupConfig(chatId);
  if (!groupConfig) {
    return false;
  }
  
  // Link Policy Check
  if (!groupConfig.link_policy_enabled) {
    return false;
  }
  
  // Extrahiere URLs
  const urls = extractUrls(messageText, entities);
  if (urls.length === 0) {
    return false; // Keine URLs
  }
  
  // Prüfe ob User "neu" ist
  const isNew = isNewUser(userId, groupConfig.link_policy_new_user_window_minutes);
  if (!isNew) {
    return false; // User ist nicht neu
  }
  
  // Prüfe Whitelist (Group-Intelligence)
  const allowedDomains = getAllowedDomains(chatId);
  const allUrlsWhitelisted = urls.every(url => {
    // Extrahiere Domain aus URL
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      return isDomainAllowed(chatId, domain);
    } catch {
      // Fallback: String-Match
      return allowedDomains.some(allowed => url.toLowerCase().includes(allowed.toLowerCase()));
    }
  });
  
  if (allUrlsWhitelisted) {
    return false; // Alle URLs sind whitelisted
  }
  
  // Lösche Nachricht
  try {
    await deleteMessage(chatId, messageId);
    console.log(`[MODERATION][LINK] Nachricht gelöscht: user=${userId} chat=${chatId} urls=${urls.length}`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[MODERATION][LINK] Fehler beim Löschen: chat=${chatId} user=${userId}`, errorMessage);
    return false;
  }
}
