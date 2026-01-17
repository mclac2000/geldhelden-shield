/**
 * Service-Message-Cleanup & Miss-Rose-Funktionen (Prompt 6)
 * 
 * Löscht Service-Messages (join, leave, pinned, title changes)
 * NACHDEM Shield das Event verarbeitet hat
 */

import { Context } from 'telegraf';
import { config } from './config';
import { deleteMessage, isGroupManagedLive } from './telegram';
import { getGroup } from './db';

/**
 * Prüft ob eine Nachricht eine Service-Message ist
 */
function isServiceMessage(message: any): boolean {
  if (!message) return false;
  
  // Join-Messages
  if ('new_chat_members' in message && message.new_chat_members) {
    return true;
  }
  
  // Leave-Messages
  if ('left_chat_member' in message && message.left_chat_member) {
    return true;
  }
  
  // Pinned Messages
  if ('pinned_message' in message && message.pinned_message) {
    return true;
  }
  
  // Title Changes
  if ('new_chat_title' in message && message.new_chat_title) {
    return true;
  }
  
  // Photo Changes
  if ('new_chat_photo' in message && message.new_chat_photo) {
    return true;
  }
  
  // Chat Migrations
  if ('migrate_to_chat_id' in message || 'migrate_from_chat_id' in message) {
    return true;
  }
  
  return false;
}

/**
 * Löscht Service-Messages in managed Gruppen
 */
export async function cleanupServiceMessages(ctx: Context): Promise<void> {
  if (!config.enableServiceMessageCleanup) {
    return; // Service-Message-Cleanup deaktiviert
  }
  
  try {
    const message = ctx.message;
    if (!message) return;
    
    // Prüfe ob Service-Message
    if (!isServiceMessage(message)) {
      return;
    }
    
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return;
    }
    
    const chatId = chat.id.toString();
    
    // Prüfe ob Gruppe managed ist
    const isManaged = await isGroupManagedLive(chatId, ctx);
    if (!isManaged) {
      return; // Nur in managed Gruppen löschen
    }
    
    // Lösche Service-Message
    const messageId = message.message_id;
    await deleteMessage(chatId, messageId);
    
    console.log(`[SERVICE] Service-Message gelöscht: chat=${chatId} message_id=${messageId}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[SERVICE] Fehler beim Löschen von Service-Message:`, errorMessage);
    // Nicht weiterwerfen - Service-Cleanup soll Bot nicht stoppen
  }
}

/**
 * Sendet eine Begrüßungsnachricht (Prompt 6)
 */
export async function sendWelcomeMessage(
  ctx: Context,
  userId: number,
  chatId: string,
  userInfo: { username?: string; firstName?: string; lastName?: string }
): Promise<void> {
  try {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return;
    }
    
    // Prüfe ob Gruppe managed ist
    const isManaged = await isGroupManagedLive(chatId, ctx);
    if (!isManaged) {
      return; // Nur in managed Gruppen
    }
    
    const displayName = userInfo.firstName || userInfo.username || 'Neues Mitglied';
    
    // Minimal, sicher, ohne Links außer Domain
    const welcomeText = 
      `👋 Willkommen ${displayName}!\n\n` +
      `⚠️ <b>Wichtig:</b> Admins schreiben dich nie privat an.\n` +
      `🔗 Offizielle Domain: geldhelden.org\n\n` +
      `Viel Erfolg! 🚀`;
    
    await ctx.telegram.sendMessage(chatId, welcomeText, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    
    console.log(`[WELCOME] Begrüßung gesendet für User ${userId} in ${chatId}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WELCOME] Fehler beim Senden der Begrüßung:`, errorMessage);
    // Nicht weiterwerfen - Begrüßung soll Bot nicht stoppen
  }
}
