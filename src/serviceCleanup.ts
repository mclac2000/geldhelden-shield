/**
 * Service Message Cleanup
 * 
 * Löscht automatisch Service-Messages (join/leave/title changes/pins)
 */

import { Context } from 'telegraf';
import { getGroupConfig } from './db';
import { featureEnabled } from './groupConfig';
import { deleteMessage } from './telegram';

/**
 * Cleanup für Service-Messages
 */
export async function cleanupServiceMessages(ctx: Context): Promise<void> {
  const message = ctx.message;
  if (!message) {
    return;
  }
  
  const chatId = message.chat.id.toString();
  
  // Feature Flag Check
  if (!featureEnabled(chatId, 'cleanup')) {
    return;
  }
  
  const groupConfig = getGroupConfig(chatId);
  if (!groupConfig || !groupConfig.enable_service_cleanup) {
    return;
  }
  
  // Prüfe Service-Message Typen
  let shouldDelete = false;
  let serviceType = '';
  
  // New Chat Members
  if ('new_chat_members' in message && message.new_chat_members) {
    shouldDelete = true;
    serviceType = 'join';
  }
  
  // Left Chat Member
  if ('left_chat_member' in message && message.left_chat_member) {
    shouldDelete = true;
    serviceType = 'leave';
  }
  
  // Chat Title Changed
  if ('new_chat_title' in message) {
    shouldDelete = true;
    serviceType = 'title_change';
  }
  
  // Pinned Message
  if ('pinned_message' in message && message.pinned_message) {
    shouldDelete = true;
    serviceType = 'pin';
  }
  
  if (!shouldDelete) {
    return;
  }
  
  // Lösche Service-Message
  try {
    await deleteMessage(chatId, message.message_id);
    console.log(`[CLEANUP] service_message deleted type=${serviceType} chat=${chatId}`);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Ignoriere "message to delete not found" Fehler
    if (!errorMessage.includes('not found') && !errorMessage.includes('message to delete not found')) {
      console.warn(`[CLEANUP] Fehler beim Löschen: chat=${chatId} type=${serviceType}`, errorMessage);
    }
  }
}
