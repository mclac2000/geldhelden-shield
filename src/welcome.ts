/**
 * Welcome System
 * 
 * Zentrale Begrüßungslogik mit Templates, Placeholders und Partner-Support.
 */

import { Context } from 'telegraf';
import { getGroupConfig, GroupConfig, logWelcomeSent } from './db';
import { featureEnabled } from './groupConfig';

// Rate Limit: max 1 Welcome pro Gruppe pro Sekunde, global max 20/min
const WELCOME_RATE_LIMIT_PER_GROUP_MS = 1000; // 1 Sekunde
const WELCOME_RATE_LIMIT_GLOBAL_PER_MIN = 20;
const WELCOME_RATE_LIMIT_GLOBAL_WINDOW_MS = 60 * 1000; // 1 Minute

// Rate Limit Tracking
const groupWelcomeTimestamps = new Map<string, number[]>(); // chatId -> timestamps[]
const globalWelcomeTimestamps: number[] = [];

/**
 * Prüft ob Welcome gesendet werden darf (Rate Limit)
 */
function canSendWelcome(chatId: string): boolean {
  const now = Date.now();
  
  // Prüfe Group-Level Rate Limit (max 1/Sekunde)
  const groupTimestamps = groupWelcomeTimestamps.get(chatId) || [];
  const recentGroupWelcomes = groupTimestamps.filter(ts => now - ts < WELCOME_RATE_LIMIT_PER_GROUP_MS);
  
  if (recentGroupWelcomes.length > 0) {
    console.log(`[WELCOME] Rate Limit (Group): chat=${chatId} - zu schnell, skip`);
    return false;
  }
  
  // Prüfe Global-Level Rate Limit (max 20/Minute)
  const recentGlobalWelcomes = globalWelcomeTimestamps.filter(ts => now - ts < WELCOME_RATE_LIMIT_GLOBAL_WINDOW_MS);
  
  if (recentGlobalWelcomes.length >= WELCOME_RATE_LIMIT_GLOBAL_PER_MIN) {
    console.log(`[WELCOME] Rate Limit (Global): zu viele Welcomes in letzter Minute, skip`);
    return false;
  }
  
  return true;
}

/**
 * Registriert einen Welcome-Versand (für Rate Limit Tracking)
 */
function recordWelcomeSent(chatId: string): void {
  const now = Date.now();
  
  // Group-Level Tracking
  const groupTimestamps = groupWelcomeTimestamps.get(chatId) || [];
  groupTimestamps.push(now);
  
  // Behalte nur Timestamps der letzten Minute
  const filteredGroup = groupTimestamps.filter(ts => now - ts < WELCOME_RATE_LIMIT_GLOBAL_WINDOW_MS);
  groupWelcomeTimestamps.set(chatId, filteredGroup);
  
  // Global-Level Tracking
  globalWelcomeTimestamps.push(now);
  
  // Behalte nur Timestamps der letzten Minute
  const filteredGlobal = globalWelcomeTimestamps.filter(ts => now - ts < WELCOME_RATE_LIMIT_GLOBAL_WINDOW_MS);
  globalWelcomeTimestamps.length = 0;
  globalWelcomeTimestamps.push(...filteredGlobal);
}

// Standard Welcome Template (Geldhelden)
const STANDARD_WELCOME_TEMPLATE = `Hey {first} 👋

Schön, dass du da bist.
👉 Stell dich kurz vor: Wer bist du und was führt dich hierher?

⚠️ Wichtig: Admins schreiben dich niemals privat an. Wenn dir jemand „Support" anbietet → bitte melden.

Mehr Infos: {bio_link}`;

// Partner Welcome Template (Geldhelden + Staatenlos)
const PARTNER_WELCOME_TEMPLATE = `Hey {first} 👋

Willkommen! Diese Gruppe ist ein Meetup von Geldhelden + Staatenlos.
👉 Stell dich kurz vor: Wer bist du und was suchst du gerade?

⚠️ Wichtig: Admins schreiben dich niemals privat an. Fake-Support bitte melden.

Mehr Infos: {bio_link}`;

interface WelcomeContext {
  firstName: string;
  username?: string;
  bioLink: string;
}

/**
 * Erzeugt den Bio-Link mit optionalem Ref-Code
 */
function buildBioLink(refCode: string | null): string {
  const baseUrl = 'https://geldhelden.org/bio';
  if (refCode && refCode.trim().length > 0) {
    return `${baseUrl}?ref=${encodeURIComponent(refCode.trim())}`;
  }
  return baseUrl;
}

/**
 * Rendert Welcome-Text mit Platzhaltern
 * 
 * @param template - Template-String mit Platzhaltern
 * @param ctxData - Kontext-Daten für Platzhalter
 * @returns Gerenderter Text
 */
export function renderWelcomeText(template: string, ctxData: WelcomeContext): string {
  let text = template;
  
  // {first} = first_name oder fallback "Freund"
  text = text.replace(/{first}/g, ctxData.firstName || 'Freund');
  
  // {username} = @name oder leer
  if (ctxData.username) {
    text = text.replace(/{username}/g, `@${ctxData.username}`);
  } else {
    text = text.replace(/{username}/g, '');
  }
  
  // {bio_link} = erzeugter Link inkl. ref
  text = text.replace(/{bio_link}/g, ctxData.bioLink);
  
  return text;
}

/**
 * Holt das passende Welcome-Template für eine Gruppe
 */
function getWelcomeTemplate(config: GroupConfig): string {
  // Wenn custom template gesetzt, nutze das
  if (config.welcome_template && config.welcome_template.trim().length > 0) {
    return config.welcome_template;
  }
  
  // Wenn Partner-Modus aktiv, nutze Partner-Template
  if (config.welcome_partner && config.welcome_partner.trim().length > 0) {
    return PARTNER_WELCOME_TEMPLATE;
  }
  
  // Standard-Template
  return STANDARD_WELCOME_TEMPLATE;
}

/**
 * Sendet Welcome-Nachricht, wenn aktiviert
 * 
 * @param chatId - Telegram Chat ID
 * @param userId - Telegram User ID
 * @param userInfo - User-Informationen
 * @param ctx - Telegram Context (optional, für sendMessage)
 * @returns true wenn Welcome gesendet wurde, false sonst
 */
export async function sendWelcomeIfEnabled(
  chatId: string,
  userId: number,
  userInfo: { firstName?: string; lastName?: string; username?: string },
  ctx?: Context
): Promise<boolean> {
  try {
    // Prüfe ob Welcome aktiviert ist
    if (!featureEnabled(chatId, 'welcome')) {
      return false;
    }
    
    // Lade Group Config
    const config = getGroupConfig(chatId);
    if (!config || !config.managed) {
      return false;
    }
    
    // Prüfe Rate Limit
    if (!canSendWelcome(chatId)) {
      return false; // Rate Limit erreicht, skip
    }
    
    // Prüfe ob User gebannt/gesperrt ist (wird später in Join-Handler geprüft)
    // Hier nur Config-Check
    
    // Hole Template
    const template = getWelcomeTemplate(config);
    
    // Erstelle Bio-Link
    const bioLink = buildBioLink(config.welcome_ref_code);
    
    // Erstelle Context-Daten
    const firstName = userInfo.firstName || 'Freund';
    const ctxData: WelcomeContext = {
      firstName,
      username: userInfo.username,
      bioLink,
    };
    
    // Rendere Text
    const welcomeText = renderWelcomeText(template, ctxData);
    
    // Sende Nachricht
    if (ctx && ctx.telegram) {
      await ctx.telegram.sendMessage(chatId, welcomeText, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      
      // Registriere für Rate Limit Tracking
      recordWelcomeSent(chatId);
      
      // Logge für Statistiken
      logWelcomeSent(chatId, userId);
      
      console.log(`[WELCOME] Welcome gesendet: chat=${chatId} user=${userId}`);
      return true;
    }
    
    // Fallback: Wenn kein ctx, versuche bot.telegram zu nutzen
    // (wird in index.ts gehandhabt)
    return false;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WELCOME] Fehler beim Senden: chat=${chatId} user=${userId}`, errorMessage);
    return false;
  }
}

/**
 * Erzeugt eine Vorschau des Welcome-Textes
 */
export function previewWelcomeText(chatId: string, userInfo?: { firstName?: string; username?: string }): string | null {
  try {
    const config = getGroupConfig(chatId);
    if (!config) {
      return null;
    }
    
    const template = getWelcomeTemplate(config);
    const bioLink = buildBioLink(config.welcome_ref_code);
    
    const ctxData: WelcomeContext = {
      firstName: userInfo?.firstName || 'Max',
      username: userInfo?.username,
      bioLink,
    };
    
    return renderWelcomeText(template, ctxData);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WELCOME] Fehler bei Vorschau: chat=${chatId}`, errorMessage);
    return null;
  }
}
