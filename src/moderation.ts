/**
 * Moderation-Funktionen für Content-Moderation, Link-Policy, Forward-Policy, Anti-Flood
 */

import { Context } from 'telegraf';
import { config } from './config';
import {
  checkBlocklist,
  BlocklistRule,
  getGroupModerationSettings,
  isTeamMember,
} from './db';
import { isAdmin } from './admin';
import {
  deleteMessage,
  restrictUser,
  banUser,
  kickUser,
  sendToAdminLogChat,
  isUserAdminOrCreatorInGroup,
  isGroupManaged,
} from './telegram';

// ============================================================================
// Anti-Flood (In-Memory)
// ============================================================================

interface FloodEntry {
  messages: number[];
  lastAction: number;
}

const floodMap = new Map<string, FloodEntry>(); // Key: `${userId}:${chatId}`

function getFloodKey(userId: number, chatId: string): string {
  return `${userId}:${chatId}`;
}

function checkAntiFlood(userId: number, chatId: string): { isFlood: boolean; messageCount: number } {
  const key = getFloodKey(userId, chatId);
  const now = Date.now();
  const windowMs = config.antiFloodWindowSeconds * 1000;
  const cutoff = now - windowMs;

  let entry = floodMap.get(key);
  if (!entry) {
    entry = { messages: [], lastAction: 0 };
    floodMap.set(key, entry);
  }

  // Entferne alte Nachrichten außerhalb des Zeitfensters
  entry.messages = entry.messages.filter(timestamp => timestamp > cutoff);

  // Füge aktuelle Nachricht hinzu
  entry.messages.push(now);

  // Prüfe Limit
  const isFlood = entry.messages.length > config.antiFloodMessageLimit;

  // Cleanup: Entferne Einträge die älter als 1 Stunde sind
  if (now - entry.lastAction > 3600000) {
    floodMap.delete(key);
  }

  return { isFlood, messageCount: entry.messages.length };
}

function recordFloodAction(userId: number, chatId: string): void {
  const key = getFloodKey(userId, chatId);
  const entry = floodMap.get(key);
  if (entry) {
    entry.lastAction = Date.now();
    entry.messages = []; // Reset nach Aktion
  }
}

// ============================================================================
// URL-Erkennung
// ============================================================================

function containsUrl(message: any): boolean {
  const urlWhitelist = config.urlWhitelist || [];
  
  // Prüfe Entities (Telegram API)
  if (message.entities) {
    for (const entity of message.entities) {
      if (entity.type === 'url' || entity.type === 'text_link') {
        const url = entity.type === 'url' 
          ? message.text?.substring(entity.offset, entity.offset + entity.length)
          : entity.url;
        
        if (url) {
          // Prüfe Whitelist
          const urlLower = url.toLowerCase();
          const isWhitelisted = urlWhitelist.some(domain => urlLower.includes(domain));
          if (isWhitelisted) {
            continue; // Erlaubte URL
          }
        }
        
        return true; // Blockierte URL
      }
    }
  }

  if (message.caption_entities) {
    for (const entity of message.caption_entities) {
      if (entity.type === 'url' || entity.type === 'text_link') {
        const url = entity.type === 'url'
          ? message.caption?.substring(entity.offset, entity.offset + entity.length)
          : entity.url;
        
        if (url) {
          // Prüfe Whitelist
          const urlLower = url.toLowerCase();
          const isWhitelisted = urlWhitelist.some(domain => urlLower.includes(domain));
          if (isWhitelisted) {
            continue; // Erlaubte URL
          }
        }
        
        return true; // Blockierte URL
      }
    }
  }

  // Fallback: Regex im Text
  const text = message.text || message.caption || '';
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = text.match(urlRegex);
  
  if (matches) {
    // Prüfe jeden gefundenen URL gegen Whitelist
    for (const url of matches) {
      const urlLower = url.toLowerCase();
      const isWhitelisted = urlWhitelist.some(domain => urlLower.includes(domain));
      if (!isWhitelisted) {
        return true; // Blockierte URL gefunden
      }
    }
  }
  
  return false; // Alle URLs sind whitelisted oder keine URLs gefunden
}

// ============================================================================
// Forward-Erkennung
// ============================================================================

function isForwardedMessage(message: any): boolean {
  // Neue API: forward_origin
  if (message.forward_origin) {
    return true;
  }

  // Klassische Forward-Felder
  if (
    message.forward_from_chat ||
    message.forward_sender_name ||
    message.forward_from ||
    message.forward_date
  ) {
    return true;
  }

  return false;
}

// ============================================================================
// Content-Moderation
// ============================================================================

async function handleContentModeration(
  ctx: Context,
  userId: number,
  chatId: string,
  messageText: string,
  messageId: number
): Promise<{ actionTaken: boolean; rule: BlocklistRule | null }> {
  // Prüfe Blocklist
  const rule = checkBlocklist(messageText);
  if (!rule) {
    return { actionTaken: false, rule: null };
  }

  // Admin/Team-Ausnahme
  if (isAdmin(userId) || isTeamMember(userId)) {
    return { actionTaken: false, rule: null };
  }

  // Gruppen-Admin-Ausnahme
  const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
  if (adminCheck.isAdmin) {
    return { actionTaken: false, rule: null };
  }

  // Lösche Nachricht falls konfiguriert
  if (rule.delete_message) {
    try {
      await deleteMessage(chatId, messageId);
    } catch (error: any) {
      console.error(`[Moderation] Fehler beim Löschen der Nachricht:`, error.message);
    }
  }

  // Führe Aktion aus
  let actionResult = { success: false, skipped: false };
  
  try {
    switch (rule.action) {
      case 'KICK':
        actionResult = await kickUser(chatId, userId, `Content-Moderation: ${rule.reason}`);
        break;
      case 'BAN':
        actionResult = await banUser(chatId, userId, `Content-Moderation: ${rule.reason}`);
        break;
      case 'RESTRICT':
        actionResult = await restrictUser(chatId, userId, `Content-Moderation: ${rule.reason}`, config.antiFloodRestrictMinutes);
        break;
      case 'DELETE':
        // Nur Nachricht löschen, keine User-Sanktion
        break;
    }
  } catch (error: any) {
    console.error(`[Moderation] Fehler bei User-Aktion:`, error.message);
  }

  // Log
  const chatTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Unbekannt';
  await sendToAdminLogChat(
    `🚫 <b>Content-Moderation</b>\n\n` +
    `👤 User: <code>${userId}</code>\n` +
    `📍 Gruppe: <b>${chatTitle}</b>\n` +
    `📝 Regel: <b>${rule.name}</b>\n` +
    `⚠️ Grund: ${rule.reason}\n` +
    `🔧 Aktion: ${rule.action}\n` +
    `✅ Nachricht gelöscht: ${rule.delete_message ? 'Ja' : 'Nein'}\n` +
    `📊 User-Aktion: ${actionResult.success ? 'Erfolg' : actionResult.skipped ? 'Übersprungen' : 'Fehler'}`,
    ctx,
    true
  );

  console.log(`[Moderation] Content-Blocklist: User ${userId} in ${chatId}, Regel: ${rule.name}, Aktion: ${rule.action}`);

  return { actionTaken: true, rule };
}

// ============================================================================
// Link-Policy
// ============================================================================

async function handleLinkPolicy(
  ctx: Context,
  userId: number,
  chatId: string,
  message: any,
  messageId: number
): Promise<boolean> {
  // Prüfe ob Links erlaubt sind
  const settings = getGroupModerationSettings(chatId);
  const linksLocked = settings?.links_locked ?? config.linksLockedDefault;
  if (!linksLocked) {
    return false; // Links erlaubt
  }

  // Prüfe ob URL vorhanden
  if (!containsUrl(message)) {
    return false; // Keine URL
  }

  // Admin/Team-Ausnahme
  if (isAdmin(userId) || isTeamMember(userId)) {
    return false;
  }

  // Gruppen-Admin-Ausnahme
  const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
  if (adminCheck.isAdmin) {
    return false;
  }

  // Lösche Nachricht
  try {
    await deleteMessage(chatId, messageId);
  } catch (error: any) {
    console.error(`[Moderation] Fehler beim Löschen der Link-Nachricht:`, error.message);
  }

  // Log
  const chatTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Unbekannt';
  await sendToAdminLogChat(
    `🔗 <b>Link-Policy</b>\n\n` +
    `👤 User: <code>${userId}</code>\n` +
    `📍 Gruppe: <b>${chatTitle}</b>\n` +
    `⚠️ Nachricht mit Link wurde gelöscht`,
    ctx,
    true
  );

  console.log(`[Moderation] Link-Policy: User ${userId} in ${chatId}, Link-Nachricht gelöscht`);

  return true;
}

// ============================================================================
// Forward-Policy
// ============================================================================

async function handleForwardPolicy(
  ctx: Context,
  userId: number,
  chatId: string,
  message: any,
  messageId: number
): Promise<boolean> {
  // Prüfe ob Forwards erlaubt sind
  const settings = getGroupModerationSettings(chatId);
  const forwardsLocked = settings?.forward_locked ?? config.forwardLockedDefault;
  if (!forwardsLocked) {
    return false; // Forwards erlaubt
  }

  // Prüfe ob Forward vorhanden
  if (!isForwardedMessage(message)) {
    return false; // Kein Forward
  }

  // Admin/Team-Ausnahme
  if (isAdmin(userId) || isTeamMember(userId)) {
    return false;
  }

  // Gruppen-Admin-Ausnahme
  const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
  if (adminCheck.isAdmin) {
    return false;
  }

  // Lösche Nachricht
  try {
    await deleteMessage(chatId, messageId);
  } catch (error: any) {
    console.error(`[Moderation] Fehler beim Löschen der Forward-Nachricht:`, error.message);
  }

  // Log
  const chatTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Unbekannt';
  await sendToAdminLogChat(
    `↩️ <b>Forward-Policy</b>\n\n` +
    `👤 User: <code>${userId}</code>\n` +
    `📍 Gruppe: <b>${chatTitle}</b>\n` +
    `⚠️ Forward-Nachricht wurde gelöscht`,
    ctx,
    true
  );

  console.log(`[Moderation] Forward-Policy: User ${userId} in ${chatId}, Forward-Nachricht gelöscht`);

  return true;
}

// ============================================================================
// Anti-Flood
// ============================================================================

async function handleAntiFlood(
  ctx: Context,
  userId: number,
  chatId: string
): Promise<boolean> {
  // Admin/Team-Ausnahme
  if (isAdmin(userId) || isTeamMember(userId)) {
    return false;
  }

  // Gruppen-Admin-Ausnahme
  const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
  if (adminCheck.isAdmin) {
    return false;
  }

  // Prüfe Flood
  const floodCheck = checkAntiFlood(userId, chatId);
  if (!floodCheck.isFlood) {
    return false; // Kein Flood
  }

  // Führe Aktion aus
  let actionResult = { success: false, skipped: false };
  const chatTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Unbekannt';

  try {
    if (config.antiFloodAction === 'RESTRICT') {
      actionResult = await restrictUser(
        chatId,
        userId,
        `Anti-Flood: ${floodCheck.messageCount} Nachrichten in ${config.antiFloodWindowSeconds}s`,
        config.antiFloodRestrictMinutes
      );
    } else if (config.antiFloodAction === 'KICK') {
      actionResult = await kickUser(
        chatId,
        userId,
        `Anti-Flood: ${floodCheck.messageCount} Nachrichten in ${config.antiFloodWindowSeconds}s`
      );
    }
  } catch (error: any) {
    console.error(`[Moderation] Fehler bei Anti-Flood-Aktion:`, error.message);
  }

  // Record action
  recordFloodAction(userId, chatId);

  // Log
  await sendToAdminLogChat(
    `🌊 <b>Anti-Flood</b>\n\n` +
    `👤 User: <code>${userId}</code>\n` +
    `📍 Gruppe: <b>${chatTitle}</b>\n` +
    `📊 Nachrichten: ${floodCheck.messageCount} in ${config.antiFloodWindowSeconds}s\n` +
    `🔧 Aktion: ${config.antiFloodAction}\n` +
    `📊 Ergebnis: ${actionResult.success ? 'Erfolg' : actionResult.skipped ? 'Übersprungen' : 'Fehler'}`,
    ctx,
    true
  );

  console.log(`[Moderation] Anti-Flood: User ${userId} in ${chatId}, ${floodCheck.messageCount} Nachrichten, Aktion: ${config.antiFloodAction}`);

  return true;
}

// ============================================================================
// Hauptfunktion: Message-Moderation
// ============================================================================

export async function moderateMessage(ctx: Context): Promise<void> {
  try {
    // Nur normale Nachrichten (keine Service-Messages)
    if (!ctx.message || !('text' in ctx.message || 'caption' in ctx.message)) {
      return;
    }

    // Nur Gruppen/Supergroups
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return;
    }

    const chatId = chat.id.toString();
    const message = ctx.message;
    const userId = message.from?.id;
    const messageId = message.message_id;

    if (!userId || !messageId) {
      return;
    }

    // Prüfe ob Gruppe managed ist (live)
    const managedCheck = await isGroupManaged(chatId, ctx.telegram);
    if (!managedCheck.isManaged) {
      return; // Nur in managed Gruppen moderieren
    }

    // Ignoriere Bots
    if (message.from?.is_bot) {
      return;
    }

    // Hole Text (text + caption)
    const messageText = ('text' in message ? message.text : '') || ('caption' in message ? message.caption : '') || '';

    // 1. Content-Moderation (Blocklist)
    const contentResult = await handleContentModeration(ctx, userId, chatId, messageText, messageId);
    if (contentResult.actionTaken) {
      return; // Nachricht bereits gelöscht/gehandhabt
    }

    // 2. Link-Policy
    const linkResult = await handleLinkPolicy(ctx, userId, chatId, message, messageId);
    if (linkResult) {
      return; // Nachricht bereits gelöscht
    }

    // 3. Forward-Policy
    const forwardResult = await handleForwardPolicy(ctx, userId, chatId, message, messageId);
    if (forwardResult) {
      return; // Nachricht bereits gelöscht
    }

    // 4. Anti-Flood (nur wenn Nachricht nicht gelöscht wurde)
    await handleAntiFlood(ctx, userId, chatId);
  } catch (error: any) {
    console.error('[Moderation] Fehler bei Message-Moderation:', error.message);
    // Nicht weiterwerfen - Moderation soll Bot nicht stoppen
  }
}
