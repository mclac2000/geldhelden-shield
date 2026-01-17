/**
 * Scam Moderation Pipeline
 * 
 * Führt Scam-Erkennung durch und führt konfigurierte Aktionen aus.
 */

import { Context } from 'telegraf';
import { evaluateScam, createScamContext, ScamResult, scoreScam, extractUrls, normalizeText } from './scam';
import { getGroupConfig, logScamEvent, getGroupSettings, isTeamMember, ScamActionType } from './db';
import { featureEnabled } from './groupConfig';
import { deleteMessage, restrictUser, banUser, sendToAdminLogChat } from './telegram';
import { isGroupManagedLive } from './telegram';
import { escalateRiskLevel } from './riskLevel';
import { config } from './config';
import { addToBlacklist } from './db';
import { isCooldownActive, touchCooldown, userGroupCooldownKey } from './rateLimit';

const DEFAULT_WARN_TEXT = '⚠️ Scam-/Werbe-Inhalt erkannt. Bitte keine Links/PM-Angebote posten.';

// Action Dedup: Verhindert mehrfache Actions für dieselbe Message
const processedMessages = new Set<string>(); // Format: "chatId:messageId"
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 Minuten

function getMessageKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function isMessageProcessed(chatId: string, messageId: number): boolean {
  return processedMessages.has(getMessageKey(chatId, messageId));
}

function markMessageProcessed(chatId: string, messageId: number): void {
  const key = getMessageKey(chatId, messageId);
  processedMessages.add(key);
  // Cleanup nach TTL
  setTimeout(() => {
    processedMessages.delete(key);
  }, DEDUP_TTL_MS);
}

/**
 * Führt Scam-Moderation für eine Nachricht durch (neue Severity-basierte Version)
 */
export async function moderateScamMessage(ctx: Context): Promise<boolean> {
  try {
    // Unterstütze sowohl message als auch edited_message
    const message = ctx.message || ('edited_message' in ctx.update ? ctx.update.edited_message : null);
    if (!message) {
      return false;
    }
    
    // Nur Text-Nachrichten prüfen
    if (!('text' in message) && !('caption' in message)) {
      return false;
    }
    
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return false; // Nur in Gruppen
    }
    
    const chatId = chat.id.toString();
    const messageId = message.message_id;
    
    // Dedup: Prüfe ob Message bereits verarbeitet wurde
    if (isMessageProcessed(chatId, messageId)) {
      return false; // Bereits verarbeitet
    }
    
    // Prüfe globale Scam-Detection Flag
    if (!config.enableScamDetection) {
      return false;
    }
    
    // Prüfe ob Gruppe managed ist
    const isManaged = await isGroupManagedLive(chatId, ctx);
    if (!isManaged) {
      return false;
    }
    
    // Prüfe Group Settings (scam_enabled)
    const groupSettings = getGroupSettings(chatId);
    if (!groupSettings.scam_enabled) {
      return false;
    }
    
    // Hole User-Info
    const from = 'from' in message ? message.from : null;
    if (!from || from.is_bot) {
      return false; // Bots ignorieren
    }
    
    const userId = from.id;
    
    // Team-Member Check (hart, vor allem anderen)
    if (isTeamMember(userId)) {
      return false; // Team-Mitglieder niemals moderieren
    }
    
    // Extrahiere Text
    const text = ('text' in message ? message.text : message.caption) || '';
    if (!text || text.trim().length === 0) {
      return false;
    }
    
    // Extrahiere URLs
    const entities = 'entities' in message ? message.entities : ('caption_entities' in message ? message.caption_entities : undefined);
    const urls = extractUrls(text, entities);
    
    // Meta-Informationen
    const isForwarded = 'forward_from' in message || 'forward_from_chat' in message;
    const hasEntities = !!entities && entities.length > 0;
    
    // Score Scam (neue Funktion)
    const scamScore = scoreScam(text, urls, { isForwarded, hasEntities });
    
    // Wenn keine Reasons, keine Aktion
    if (scamScore.reasons.length === 0) {
      return false;
    }
    
    // Prüfe Cooldown für Scam-Aktion (10 Minuten pro User pro Gruppe)
    const scamCooldownKey = userGroupCooldownKey(userId, chatId, 'scam');
    if (isCooldownActive(scamCooldownKey, 10 * 60 * 1000)) {
      console.log(`[GUARD] Cooldown active – scam skipped: user=${userId} chat=${chatId}`);
      return false; // Cooldown aktiv
    }
    
    // Markiere als verarbeitet (auch bei LOW, um Doppel-Verarbeitung zu vermeiden)
    markMessageProcessed(chatId, messageId);
    
    // Severity-basierte Reaktion
    let actionTaken = false;
    
    if (scamScore.severity === 'LOW') {
      // LOW: Optional nur loggen ODER delete wenn URL nicht whitelisted
      if (urls.length > 0) {
        // Prüfe ob URL whitelisted
        let hasUnapprovedUrl = false;
        for (const url of urls) {
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
              // Ignoriere
            }
          }
          if (!isWhitelisted) {
            hasUnapprovedUrl = true;
            break;
          }
        }
        
        if (hasUnapprovedUrl) {
          // Delete wenn unapproved URL
          try {
            await deleteMessage(chatId, messageId);
            actionTaken = true;
            console.log(`[SCAM][LOW] deleted chat=${chatId} user=${userId} score=${scamScore.score} reasons=[${scamScore.reasons.join(',')}]`);
          } catch (error: any) {
            // Ignoriere "not found" Fehler
          }
        }
      }
      // Sonst nur loggen (optional)
    } else if (scamScore.severity === 'MEDIUM') {
      // MEDIUM: Delete + Log
      try {
        await deleteMessage(chatId, messageId);
        touchCooldown(scamCooldownKey); // Cooldown setzen
        actionTaken = true;
        
        // Log in Shield-Logs Gruppe
        const groupTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Unbekannt';
        const userName = from.username ? `@${from.username}` : from.first_name || `User ${userId}`;
        const logMessage = 
          `🚨 <b>Scam erkannt</b>\n\n` +
          `📋 Gruppe: ${groupTitle} (<code>${chatId}</code>)\n` +
          `👤 User: ${userName} (<code>${userId}</code>)\n` +
          `⚠️ Severity: <b>MEDIUM</b> (Score: ${scamScore.score})\n` +
          `📝 Gründe: ${scamScore.reasons.join(', ')}\n` +
          `💬 Nachricht: <code>${text.substring(0, 100).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;
        
        await sendToAdminLogChat(logMessage, ctx, true);
        console.log(`[SCAM][MED] deleted chat=${chatId} user=${userId} score=${scamScore.score} reasons=[${scamScore.reasons.join(',')}]`);
      } catch (error: any) {
        // Ignoriere "not found" Fehler
      }
    } else if (scamScore.severity === 'HIGH') {
      // HIGH: Delete + Ban/Restrict + Global Blacklist
      try {
        await deleteMessage(chatId, messageId);
        touchCooldown(scamCooldownKey); // Cooldown setzen
        actionTaken = true;
        
        // Ban oder Restrict abhängig von ACTION_MODE
        let banRestrictSuccess = false;
        let banRestrictError: string | null = null;
        
        if (config.actionMode === 'ban') {
          const banResult = await banUser(chatId, userId, `Scam erkannt (Score: ${scamScore.score}, Severity: HIGH)`);
          banRestrictSuccess = banResult.success;
          banRestrictError = banResult.error || null;
          
          // Global Blacklist hinzufügen
          if (banResult.success) {
            addToBlacklist(userId, ctx.from?.id || 0, `Scam erkannt (Score: ${scamScore.score})`);
          }
        } else {
          const restrictResult = await restrictUser(chatId, userId, `Scam erkannt (Score: ${scamScore.score}, Severity: HIGH)`, 24 * 60); // 24h
          banRestrictSuccess = restrictResult.success;
          banRestrictError = restrictResult.error || null;
        }
        
        // Log in Shield-Logs Gruppe
        const groupTitle = ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Unbekannt';
        const userName = from.username ? `@${from.username}` : from.first_name || `User ${userId}`;
        const actionVerb = config.actionMode === 'ban' ? 'banned' : 'restricted';
        let logMessage = 
          `🚨 <b>Scam erkannt</b>\n\n` +
          `📋 Gruppe: ${groupTitle} (<code>${chatId}</code>)\n` +
          `👤 User: ${userName} (<code>${userId}</code>)\n` +
          `🔴 Severity: <b>HIGH</b> (Score: ${scamScore.score})\n` +
          `📝 Gründe: ${scamScore.reasons.join(', ')}\n` +
          `🎯 Aktion: deleted + ${actionVerb} ${banRestrictSuccess ? '✅' : '❌'}\n` +
          `💬 Nachricht: <code>${text.substring(0, 100).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;
        
        if (banRestrictError) {
          logMessage += `\n⚠️ Fehler: ${banRestrictError}`;
        }
        
        await sendToAdminLogChat(logMessage, ctx, true);
        console.log(`[SCAM][HIGH] deleted+${actionVerb} chat=${chatId} user=${userId} score=${scamScore.score} reasons=[${scamScore.reasons.join(',')}]`);
        
        // Eskaliere Risk-Level
        escalateRiskLevel(userId, `Scam erkannt (Score: ${scamScore.score}, Severity: HIGH)`);
      } catch (error: any) {
        // Ignoriere "not found" Fehler
        console.error(`[SCAM] Fehler bei HIGH-Severity-Aktion:`, error.message);
      }
    }
    
    // Logge Event in DB (wenn Aktion ausgeführt wurde)
    if (actionTaken) {
      // Defensive: Bestimme Aktion mit Fallback (Union-Typ: 'restrict' | 'ban' | 'delete' | 'warn' | 'kick')
      const action: ScamActionType = scamScore.severity === 'HIGH' 
        ? (config.actionMode === 'ban' ? 'ban' : 'restrict') 
        : 'delete';
      
      // Action ist immer gültig (kein "NONE" mehr möglich)
      logScamEvent(chatId, userId, messageId, scamScore.score, action, scamScore.reasons);
      
      // Scam-Events werden nicht über das ShieldEvent-System geloggt,
      // da 'SCAM' kein gültiger ShieldEventType ist ('JOIN' | 'LEAVE' | 'MESSAGE').
      // Scam-Events werden direkt über logScamEvent() und sendToAdminLogChat() geloggt.
    }
    
    return actionTaken;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[SCAM] Fehler bei Scam-Moderation:`, errorMessage);
    return false;
  }
}
