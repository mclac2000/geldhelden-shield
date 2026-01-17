/**
 * Welcome Profile System
 * 
 * Zentrale Begrüßung mit pro-Gruppe Anpassungen
 */

import { Context, Telegraf } from 'telegraf';
import { config } from './config';
import {
  getOrCreateGroupProfile,
  getGroupProfile,
  updateGroupProfile,
  hasWelcomeBeenSent,
  markWelcomeSent,
  getGroup,
  normalizeBrand,
} from './db';
import { sendToAdminLogChat } from './telegram';
import { getAllowedDomains } from './groupIntelligence';
import { getTemplateForBrandAndRisk, renderWelcomeText, formatLocation, initDefaultTemplates } from './welcomeTemplates';
import { resolveAffiliateRef, buildAffiliateLink } from './affiliateEngine';
import { calculateRiskLevel, updateUserRiskLevel, escalateRiskLevel } from './riskLevel';
// RiskLevelEnum entfernt - verwende String-Literals

// Partner-Line Templates
const PARTNER_LINES: Record<string, string> = {
  staatenlos: 'In Kooperation mit Staatenlos – gemeinsam für mehr Freiheit und finanzielle Unabhängigkeit.',
  mixed: 'Diese Gruppe ist ein Meetup von Geldhelden + Partnern.',
  geldhelden: '', // Keine Partner-Zeile für reine Geldhelden-Gruppen
};

/**
 * Baut den Bio-Link mit optionalem Ref-Code
 */
function buildBioLink(affiliateRef: string | null): string {
  const baseUrl = 'https://geldhelden.org/bio';
  if (affiliateRef && affiliateRef.trim().length > 0) {
    return `${baseUrl}?ref=${encodeURIComponent(affiliateRef.trim())}`;
  }
  return baseUrl;
}

/**
 * Rendert Welcome-Text mit Platzhaltern
 */
export function renderWelcomeTemplate(
  template: string,
  context: {
    firstName: string;
    username?: string;
    groupTitle: string;
    bioLink: string;
    partnerLine: string;
  }
): string {
  let text = template;
  
  // Ersetze Platzhalter
  text = text.replace(/{first}/g, context.firstName);
  text = text.replace(/{first_name}/g, context.firstName);
  text = text.replace(/{username}/g, context.username ? `@${context.username}` : '');
  text = text.replace(/{group}/g, context.groupTitle);
  text = text.replace(/{bio_link}/g, context.bioLink);
  text = text.replace(/{partner_line}/g, context.partnerLine);
  
  return text;
}

/**
 * Sendet Welcome-Nachricht wenn alle Bedingungen erfüllt sind
 * Neue Version mit Risk-Level-basierter Template-Auswahl
 */
export async function sendWelcomeIfEnabled(
  chatId: string,
  userId: number,
  userInfo: { username?: string; firstName?: string; lastName?: string; isBot?: boolean },
  ctx: Context,
  bot: Telegraf
): Promise<{ sent: boolean; reason?: string }> {
  try {
    // 1. Prüfe ob Welcome bereits gesendet wurde (Dedup)
    if (hasWelcomeBeenSent(chatId, userId)) {
      console.log(`[WELCOME][SKIP] reason=dedup user=${userId} chat=${chatId}`);
      return { sent: false, reason: 'dedup' };
    }
    
    // 2. Skip Bots
    if (userInfo.isBot) {
      console.log(`[WELCOME][SKIP] reason=bot user=${userId} chat=${chatId}`);
      return { sent: false, reason: 'bot' };
    }
    
    // 3. Hole Group Profile und Group
    const profile = getGroupProfile(chatId);
    const group = getGroup(chatId);
    
    if (!profile || !group) {
      console.log(`[WELCOME][SKIP] reason=no_group_profile_or_group chat=${chatId}`);
      return { sent: false, reason: 'no_profile' };
    }
    
    // 4. Prüfe ob Welcome aktiviert ist
    if (!profile.welcome_enabled) {
      console.log(`[WELCOME][SKIP] reason=disabled chat=${chatId}`);
      return { sent: false, reason: 'disabled' };
    }
    
    // 5. Prüfe Silent-Mode
    if (group.silentMode) {
      console.log(`[WELCOME][SKIP] reason=silent_mode chat=${chatId}`);
      return { sent: false, reason: 'silent_mode' };
    }
    
    // 6. Prüfe ob User flagged ist
    const { isBlacklisted } = await import('./db');
    if (isBlacklisted(userId)) {
      console.log(`[WELCOME][SKIP] reason=flagged_user user=${userId} chat=${chatId}`);
      return { sent: false, reason: 'flagged_user' };
    }
    
    // 7. Berechne Risk-Level
    const riskAssessment = calculateRiskLevel(userId);
    updateUserRiskLevel(userId, riskAssessment);
    const riskLevel = riskAssessment.level;
    
    // 8. Hole Brand (aus Group-Profile oder Group)
    const brand = normalizeBrand(profile.baseBrand) || (group?.baseBrand) || 'geldhelden';
    
    // 9. Hole Template für Brand und Risk-Level
    const template = getTemplateForBrandAndRisk(brand as 'geldhelden' | 'staatenlos' | 'mixed', riskLevel);
    
    // 10. Resolve Affiliate-Ref (nur bei CLEAN & LOW)
    let refCode: string | null = null;
    let source: 'group' | 'admin' | 'fallback' = 'fallback';
    let affiliateLink = 'https://geldhelden.org/bio';
    
    // Hilfsfunktion für Risk-Level-Vergleich
    const riskLevelOrder: Record<string, number> = { "CLEAN": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3 };
    if (riskLevelOrder[riskLevel] <= riskLevelOrder["LOW"]) {
      const affiliateResult = await resolveAffiliateRef(chatId, bot);
      refCode = affiliateResult.refCode;
      source = affiliateResult.source;
      affiliateLink = buildAffiliateLink(refCode);
    } else {
      console.log(`[AFFILIATE] skipped due to risk user=${userId} level=${riskLevel}`);
    }
    
    // 11. Formatiere Location
    const location = formatLocation(profile.location || group.location);
    
    // 12. Rendere Welcome-Text (neue Template-Engine)
    const welcomeText = renderWelcomeText(template, {
      first: userInfo.firstName || 'Freund',
      location: location,
      brand: brand === 'mixed' ? 'Geldhelden × Staatenlos' : brand === 'staatenlos' ? 'Staatenlos' : 'Geldhelden',
      link: affiliateLink,
      admins: 'Admins schreiben dich niemals privat an',
    });
    
    // 13. Sende Nachricht
    await ctx.telegram.sendMessage(chatId, welcomeText, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      disable_notification: true, // Optional: keine Benachrichtigung
    });
    
    // 14. Markiere als gesendet
    markWelcomeSent(chatId, userId);
    
    // 15. Admin-Warnung bei MEDIUM+ Risk
    if (riskLevelOrder[riskLevel] >= riskLevelOrder["MEDIUM"]) {
      const username = userInfo.username ? `@${userInfo.username}` : `ID: ${userId}`;
      const riskLevelName = riskLevel === "HIGH" ? 'HIGH' : 'MEDIUM';
      const reasonsText = riskAssessment.reasons.join(', ');
      
      await sendToAdminLogChat(
        `⚠️ <b>Hinweis</b>\n\n` +
        `User ${username} beigetreten\n` +
        `Risk-Level: <b>${riskLevelName}</b>\n` +
        `Gründe: ${reasonsText}\n` +
        `Gruppe: ${group.title || chatId}`,
        ctx,
        true
      );
    }
    
    console.log(`[WELCOME] adaptive sent level=${riskLevel} user=${userId} chat=${chatId} template=${brand} ref=${refCode || 'null'} source=${source}`);
    
    return { sent: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WELCOME] Fehler beim Senden der Begrüßung für User ${userId} in ${chatId}:`, errorMessage);
    return { sent: false, reason: 'error' };
  }
}

/**
 * Testet Welcome-Template (sendet als DM an Admin)
 */
export async function testWelcomeTemplate(
  ctx: Context,
  chatId: string,
  testUserInfo?: {
    username?: string;
    firstName?: string;
  }
): Promise<void> {
  if (!ctx.from) {
    await ctx.reply('❌ Keine User-Informationen gefunden.');
    return;
  }
  
  const profile = getOrCreateGroupProfile(chatId);
  const template = profile.welcome_template || config.defaultWelcomeTemplate;
  const bioLink = buildBioLink(profile.affiliate_ref);
  const partnerTag = profile.partner_tag || 'geldhelden';
  const partnerLine = PARTNER_LINES[partnerTag] || '';
  
  const groupTitle = profile.title || (ctx.chat && 'title' in ctx.chat ? ctx.chat.title : 'Test-Gruppe');
  
  const welcomeText = renderWelcomeTemplate(template, {
    firstName: testUserInfo?.firstName || ctx.from.first_name || 'Test-User',
    username: testUserInfo?.username || ctx.from.username,
    groupTitle,
    bioLink,
    partnerLine,
  });
  
  // Sende als DM an Admin
  try {
    await ctx.telegram.sendMessage(ctx.from.id, `🧪 <b>Welcome-Template Test</b>\n\n${welcomeText}`, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    await ctx.reply('✅ Test-Nachricht wurde als DM gesendet.');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[WELCOME] Fehler beim Senden der Test-Nachricht:', errorMessage);
    await ctx.reply('❌ Fehler beim Senden der Test-Nachricht. Stelle sicher, dass du dem Bot eine DM geschickt hast.');
  }
}
