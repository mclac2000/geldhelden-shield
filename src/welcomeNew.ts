/**
 * K12 – Welcome Engine 2.0 (Miss-Rose-Replacement, zentral & intelligent)
 * 
 * MISS ROSE ENDGÜLTIG ERSETZT:
 * - Nur Geldhelden Shield begrüßt (Single Source of Truth)
 * - Zentrale Welcome-Logik mit automatischer Partner-Erkennung
 * - Pro Gruppe anpassbar (Ort, Partner, Affiliate)
 * - Sicher gegen Scammer (Welcome erst nach Scam-Check)
 * - Automatisch für neue Gruppen (zero maintenance)
 * 
 * MISS ROSE BEGRÜSSUNG MUSS ÜBERALL AUS SEIN!
 */

import { Context } from 'telegraf';
import { getGroupSettings, isTeamMember, getGroup, getGroupTitle, getGroupConfig, GroupConfig, hasWelcomeBeenSent, markWelcomeSent, ensureUserExists, getUser } from './db';
import { isGroupManaged } from './groupConfig';
import { GroupContext } from './domain/groupProjection';
import { getBotTelegram } from './telegram';
import { extractLocation } from './groupIntelligence';

// K12: Ein einziges, zentrales Welcome-Template (fixe Reihenfolge)
const CENTRAL_WELCOME_TEMPLATE = `Hey {firstName} 👋
Willkommen bei {groupName}.

{locationLine}

⚠️ Wichtiger Hinweis:
Admins schreiben dich **niemals privat** an.
Melde verdächtige Nachrichten bitte dem Team.

🔎 Mehr Infos:
{url}`;

// K12: Partner-Typen (zentral definiert, keine Magic Strings)
export type PartnerType = 'geldhelden' | 'staatenlos' | 'coop';

interface WelcomeRenderParams {
  firstName: string;
  groupName: string;
  location: string | null;
  partner: PartnerType;
  refCode: string | null;
}

/**
 * Extrahiert Ort aus Gruppennamen (Fallback-Logik)
 */
function extractLocationFromTitle(title: string | null): string | null {
  if (!title) return null;
  
  // Nutze bestehende Logik aus groupIntelligence
  return extractLocation(title);
}

/**
 * Bestimmt Partner-Typ aus GroupContext
 * Verwendet bereits normalisierte Domain-Typen
 */
function determinePartnerType(
  group: GroupContext | null,
  config: GroupConfig | null,
  groupTitle?: string | null
): PartnerType {
  // 1. Prüfe explizite Konfiguration
  if (config?.welcome_partner) {
    const partner = config.welcome_partner.toLowerCase();
    if (partner === 'staatenlos') return 'staatenlos';
    if (partner === 'coop' || partner === 'mixed') return 'coop';
    return 'geldhelden';
  }
  
  // 2. Prüfe baseBrand aus GroupContext (bereits normalisiert)
  if (group?.baseBrand) {
    const brand = group.baseBrand;
    if (brand === 'staatenlos') return 'staatenlos';
    if (brand === 'mixed') return 'coop';
    if (brand === 'geldhelden') return 'geldhelden';
  }
  
  // 3. Fallback: Aus Gruppennamen ableiten
  const title = groupTitle?.toLowerCase() || '';
  if (title.includes('staatenlos') && title.includes('geldhelden')) return 'coop';
  if (title.includes('staatenlos')) return 'staatenlos';
  
  // 4. Default: Geldhelden
  return 'geldhelden';
}

/**
 * K12: Erzeugt Info-URL je nach Partner-Typ (kritische Regeln!)
 * 
 * URL-Regeln:
 * - geldhelden: https://geldhelden.org/bio (+ ?ref=REF nur wenn vorhanden)
 * - coop: https://geldhelden.org/bio (KEIN Affiliate)
 * - staatenlos: https://staatenlos.ch (KEIN Affiliate)
 * 
 * ➡️ Affiliate nur bei geldhelden
 * ➡️ Nie Affiliate bei coop oder staatenlos
 */
function buildInfoUrl(partner: PartnerType, refCode: string | null): string {
  switch (partner) {
    case 'geldhelden':
      // Geldhelden: Mit Ref-Code wenn vorhanden
      const baseUrl = 'https://geldhelden.org/bio';
      if (refCode && refCode.trim().length > 0) {
        return `${baseUrl}?ref=${encodeURIComponent(refCode.trim())}`;
      }
      return baseUrl;
    
    case 'staatenlos':
      // Staatenlos: Eigene URL (ohne Ref - kein Affiliate)
      return 'https://staatenlos.ch';
    
    case 'coop':
      // Coop: Geldhelden-URL ohne Ref (kein Affiliate in Partnergruppen)
      return 'https://geldhelden.org/bio';
    
    default:
      return 'https://geldhelden.org/bio';
  }
}

/**
 * Erzeugt Location-Zeile für Template
 */
function buildLocationLine(location: string | null): string {
  if (!location || location.trim().length === 0) {
    return '';
  }
  return `📍 Ort: ${location}`;
}

/**
 * K12: Rendert Welcome-Text mit Platzhaltern (ein einziges, zentrales Template)
 */
export function renderWelcome(params: WelcomeRenderParams): string {
  const { firstName, groupName, location, partner, refCode } = params;
  
  // Info-URL je nach Partner
  const url = buildInfoUrl(partner, refCode);
  
  // Location-Zeile
  const locationLine = buildLocationLine(location);
  
  // Platzhalter ersetzen (fixe Reihenfolge)
  let text = CENTRAL_WELCOME_TEMPLATE;
  text = text.replace(/{firstName}/g, firstName);
  text = text.replace(/{groupName}/g, groupName);
  text = text.replace(/{locationLine}/g, locationLine);
  text = text.replace(/{url}/g, url);
  
  return text;
}

/**
 * K12: Sendet Welcome-Nachricht, wenn aktiviert
 * 
 * WICHTIG: Welcome wird NUR gesendet wenn:
 * - User nicht Team-Mitglied
 * - Gruppe managed
 * - Welcome aktiviert
 * - Keine Deduplication (welcome_sent)
 * - Scam-Check bereits durchgeführt (wird vom Caller sichergestellt)
 * 
 * @param chatId - Telegram Chat ID
 * @param userId - Telegram User ID
 * @param userInfo - User-Informationen
 * @param ctx - Telegram Context (optional)
 * @returns true wenn Welcome gesendet wurde, false sonst
 */
export async function sendWelcomeIfEnabled(
  chatId: string,
  userId: number,
  userInfo: { firstName?: string; lastName?: string; username?: string },
  ctx?: Context
): Promise<{ sent: boolean; reason?: string }> {
  try {
    // K12: Prüfe ob User Team-Mitglied ist (niemals Welcome an Team)
    if (isTeamMember(userId)) {
      return { sent: false, reason: 'team_member' };
    }
    
    // K12: Scam-Sicherheit - Prüfe ob User gebannt/restricted ist
    // Stelle sicher, dass User in DB existiert (konsistent mit Join-Handler)
    ensureUserExists(userId);
    const user = getUser(userId);
    if (user && (user.status === 'banned' || user.status === 'restricted')) {
      console.log(`[WELCOME][SKIP] User gebannt/restricted: chat=${chatId} user=${userId} status=${user.status}`);
      return { sent: false, reason: 'user_banned_or_restricted' };
    }
    
    // K12: Prüfe ob Gruppe managed ist
    if (!isGroupManaged(chatId)) {
      return { sent: false, reason: 'not_managed' };
    }
    
    // K12: Hole GroupContext (Domain-Objekt, bereits normalisiert)
    const group = getGroup(chatId);
    if (!group) {
      return { sent: false, reason: 'group_not_found' };
    }
    
    // K12: Deduplication via welcome_sent (Pro User maximal 1 Begrüßung pro Gruppe)
    if (hasWelcomeBeenSent(chatId, userId)) {
      console.log(`[WELCOME][SKIP] Deduplication: chat=${chatId} user=${userId}`);
      return { sent: false, reason: 'already_sent' };
    }
    
    // Hole Gruppentitel (wird für Settings und Anzeige benötigt)
    const groupTitle = getGroupTitle(chatId);
    
    // Lade Group Settings (auto-create mit defaults)
    const settings = getGroupSettings(chatId, groupTitle || undefined);
    
    // K12: Prüfe ob Welcome aktiviert ist
    if (!settings.welcome_enabled) {
      return { sent: false, reason: 'disabled' };
    }
    
    // Lade Group Config (für Partner, Ref-Code, etc.)
    const config = getGroupConfig(chatId);
    
    // Partner-Typ bestimmen (verwendet GroupContext mit normalisiertem baseBrand)
    const partner = determinePartnerType(group, config, groupTitle);
    
    // Ort extrahieren (Priorität: GroupContext.location → Fallback aus Titel)
    let location: string | null = group.location || null;
    if (!location && groupTitle) {
      location = extractLocationFromTitle(groupTitle);
    }
    
    // Ref-Code (aus config oder settings)
    const refCode = config?.welcome_ref_code || settings.ref_code || null;
    
    // K12: Rendere Welcome-Text (ein zentrales Template)
    const welcomeText = renderWelcome({
      firstName: userInfo.firstName || 'Freund',
      groupName: groupTitle || 'Geldhelden',
      location,
      partner,
      refCode,
    });
    
    // Sende Nachricht (niemals editieren, nur senden)
    let telegram = ctx?.telegram;
    if (!telegram) {
      // Fallback: Nutze getBotTelegram
      telegram = getBotTelegram();
    }
    await telegram.sendMessage(chatId, welcomeText, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    
    // K12: Markiere Welcome als gesendet (Deduplication)
    markWelcomeSent(chatId, userId);
    
    // Logge (K12: mit Partner und Ort)
    const refStatus = refCode ? 'on' : 'off';
    console.log(`[WELCOME] sent chat=${chatId} user=${userId} partner=${partner} location=${location || 'none'} ref=${refStatus}`);
    
    return { sent: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WELCOME] Fehler beim Senden: chat=${chatId} user=${userId}`, errorMessage);
    return { sent: false, reason: 'error' };
  }
}

/**
 * K12: Erzeugt eine Vorschau des Welcome-Textes
 */
export function previewWelcomeText(chatId: string, userInfo?: { firstName?: string; username?: string }): string | null {
  try {
    const group = getGroup(chatId);
    if (!group) {
      return null;
    }
    
    const config = getGroupConfig(chatId);
    // Hole Gruppentitel
    const groupTitle = getGroupTitle(chatId);
    
    // Partner-Typ bestimmen (verwendet GroupContext mit normalisiertem baseBrand)
    const partner = determinePartnerType(group, config, groupTitle);
    
    // Ort extrahieren (aus GroupContext.location → Fallback aus Titel)
    let location: string | null = group.location || null;
    if (!location && groupTitle) {
      location = extractLocationFromTitle(groupTitle);
    }
    
    // Ref-Code
    const refCode = config?.welcome_ref_code || null;
    
    return renderWelcome({
      firstName: userInfo?.firstName || 'Max',
      groupName: groupTitle || 'Geldhelden',
      location,
      partner,
      refCode,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WELCOME] Fehler bei Vorschau: chat=${chatId}`, errorMessage);
    return null;
  }
}
