/**
 * Affiliate Engine
 * 
 * Verwaltet Affiliate-Refs mit Priorität: Gruppe > Admin > Fallback
 */

import { getDatabase } from './db';
import { Telegraf } from 'telegraf';

export type AffiliatePriority = 'group' | 'admin' | 'fallback';

export interface AffiliateRef {
  chat_id: string;
  user_id: number;
  ref_code: string;
  priority: AffiliatePriority;
  created_at: number;
}

/**
 * Setzt Gruppen-Ref-Code
 */
export function setGroupRef(chatId: string, refCode: string, setBy: number): boolean {
  const db = getDatabase();
  
  try {
    // Entferne alte Gruppen-Refs für diese Gruppe
    db.prepare('DELETE FROM affiliate_refs WHERE chat_id = ? AND priority = ?').run(chatId, 'group');
    
    // Füge neue Gruppen-Ref hinzu
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO affiliate_refs (chat_id, user_id, ref_code, priority, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(chatId, setBy, refCode.trim(), 'group', Date.now());
    
    console.log(`[AFFILIATE] Group ref gesetzt: chat=${chatId} ref=${refCode} by=${setBy}`);
    return true;
  } catch (error: any) {
    console.error(`[AFFILIATE] Fehler beim Setzen von Group-Ref: chat=${chatId}`, error.message);
    return false;
  }
}

/**
 * Entfernt Gruppen-Ref-Code
 */
export function clearGroupRef(chatId: string): boolean {
  const db = getDatabase();
  
  try {
    const stmt = db.prepare('DELETE FROM affiliate_refs WHERE chat_id = ? AND priority = ?');
    const result = stmt.run(chatId, 'group');
    
    if (result.changes > 0) {
      console.log(`[AFFILIATE] Group ref entfernt: chat=${chatId}`);
      return true;
    }
    return false;
  } catch (error: any) {
    console.error(`[AFFILIATE] Fehler beim Entfernen von Group-Ref: chat=${chatId}`, error.message);
    return false;
  }
}

/**
 * Setzt Admin-Ref-Code
 */
export function setAdminRef(userId: number, refCode: string): boolean {
  const db = getDatabase();
  
  try {
    // Entferne alte Admin-Refs für diesen User
    db.prepare('DELETE FROM affiliate_refs WHERE user_id = ? AND priority = ?').run(userId, 'admin');
    
    // Füge neue Admin-Ref hinzu (chat_id = NULL für globale Admin-Refs)
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO affiliate_refs (chat_id, user_id, ref_code, priority, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(null, userId, refCode.trim(), 'admin', Date.now());
    
    console.log(`[AFFILIATE] Admin ref gesetzt: user=${userId} ref=${refCode}`);
    return true;
  } catch (error: any) {
    console.error(`[AFFILIATE] Fehler beim Setzen von Admin-Ref: user=${userId}`, error.message);
    return false;
  }
}

/**
 * Resolved Affiliate-Ref für eine Gruppe
 * Priorität: Gruppe > Admin > Fallback
 */
export async function resolveAffiliateRef(
  chatId: string,
  bot: Telegraf
): Promise<{ refCode: string | null; source: AffiliatePriority }> {
  const db = getDatabase();
  
  // 1. Prüfe Gruppen-Ref
  const groupRef = db.prepare(`
    SELECT ref_code FROM affiliate_refs 
    WHERE chat_id = ? AND priority = ?
    LIMIT 1
  `).get(chatId, 'group') as { ref_code: string } | undefined;
  
  if (groupRef) {
    console.log(`[AFFILIATE] resolved chat=${chatId} source=group ref=${groupRef.ref_code}`);
    return { refCode: groupRef.ref_code, source: 'group' };
  }
  
  // 2. Prüfe Admin-Refs (hole erste Admin mit Ref)
  try {
    const administrators = await bot.telegram.getChatAdministrators(chatId);
    
    for (const admin of administrators) {
      if ('user' in admin) {
        const userId = admin.user.id;
        const adminRef = db.prepare(`
          SELECT ref_code FROM affiliate_refs 
          WHERE user_id = ? AND priority = ?
          LIMIT 1
        `).get(userId, 'admin') as { ref_code: string } | undefined;
        
        if (adminRef) {
          console.log(`[AFFILIATE] resolved chat=${chatId} source=admin user=${userId} ref=${adminRef.ref_code}`);
          return { refCode: adminRef.ref_code, source: 'admin' };
        }
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[AFFILIATE] Fehler beim Abrufen von Admins: chat=${chatId}`, errorMessage);
  }
  
  // 3. Fallback: Kein Ref
  console.log(`[AFFILIATE] resolved chat=${chatId} source=fallback ref=null`);
  return { refCode: null, source: 'fallback' };
}

/**
 * Baut Affiliate-Link
 */
export function buildAffiliateLink(refCode: string | null): string {
  const baseUrl = 'https://geldhelden.org/bio';
  
  if (refCode && refCode.trim().length > 0) {
    return `${baseUrl}?ref=${encodeURIComponent(refCode.trim())}`;
  }
  
  return baseUrl;
}

/**
 * Holt Gruppen-Ref-Code (falls vorhanden)
 */
export function getGroupRef(chatId: string): string | null {
  const db = getDatabase();
  
  const result = db.prepare(`
    SELECT ref_code FROM affiliate_refs 
    WHERE chat_id = ? AND priority = ?
    LIMIT 1
  `).get(chatId, 'group') as { ref_code: string } | undefined;
  
  return result?.ref_code || null;
}

/**
 * Holt Admin-Ref-Code (falls vorhanden)
 */
export function getAdminRef(userId: number): string | null {
  const db = getDatabase();
  
  const result = db.prepare(`
    SELECT ref_code FROM affiliate_refs 
    WHERE user_id = ? AND priority = ?
    LIMIT 1
  `).get(userId, 'admin') as { ref_code: string } | undefined;
  
  return result?.ref_code || null;
}
