/**
 * Risk Level System
 * 
 * Berechnet und verwaltet Risk-Level für adaptive Welcome-Messages
 */

import { getUser, getOrCreateUser, getDatabase } from './db';
import { getJoinCount24h, getDistinctChatsInWindow } from './db';
import { RiskLevel } from './db';

export interface RiskAssessment {
  level: RiskLevel;
  reasons: string[];
}

/**
 * Berechnet Risk-Level für einen User
 * Nur Eskalation, nie sofortige Deeskalation
 */
export function calculateRiskLevel(userId: number): RiskAssessment {
  const user = getUser(userId);
  if (!user) {
    return { level: "CLEAN", reasons: [] };
  }
  
  const reasons: string[] = [];
  let riskScore = 0;
  
  // 1. Account-Alter
  const accountAge = Date.now() - user.first_seen;
  const accountAgeDays = accountAge / (1000 * 60 * 60 * 24);
  
  if (accountAgeDays < 1) {
    riskScore += 2;
    reasons.push('Account < 1 Tag alt');
  } else if (accountAgeDays < 7) {
    riskScore += 1;
    reasons.push('Account < 7 Tage alt');
  }
  
  // 2. Anzahl Gruppenbeitritte (24h)
  try {
    const joins24h = getJoinCount24h(userId);
    if (joins24h >= 7) {
      riskScore += 3;
      reasons.push(`${joins24h} Joins in 24h`);
    } else if (joins24h >= 5) {
      riskScore += 2;
      reasons.push(`${joins24h} Joins in 24h`);
    } else if (joins24h >= 3) {
      riskScore += 1;
      reasons.push(`${joins24h} Joins in 24h`);
    }
  } catch (error) {
    // Ignoriere Fehler
  }
  
  // 3. Anzahl verschiedene Gruppen (7 Tage)
  try {
    const distinctGroups7d = getDistinctChatsInWindow(userId, 7 * 24);
    if (distinctGroups7d.length >= 10) {
      riskScore += 2;
      reasons.push(`${distinctGroups7d.length} verschiedene Gruppen in 7 Tagen`);
    } else if (distinctGroups7d.length >= 5) {
      riskScore += 1;
      reasons.push(`${distinctGroups7d.length} verschiedene Gruppen in 7 Tagen`);
    }
  } catch (error) {
    // Ignoriere Fehler
  }
  
  // 4. Username-Muster (einfache Heuristik)
  // Username wird nicht direkt in User gespeichert, sondern über has_username Flag
  // Für jetzt: überspringen wir Username-Heuristik, da username nicht direkt verfügbar
  /*
  const username = user.username || '';
  if (username.length > 0) {
    // Sehr kurze Usernames
    if (username.length <= 3) {
      riskScore += 1;
      reasons.push('Sehr kurzer Username');
    }
    
    // Viele Zahlen im Username
    const numberCount = (username.match(/\d/g) || []).length;
    if (numberCount >= 5) {
      riskScore += 1;
      reasons.push('Viele Zahlen im Username');
    }
  }
  */
  
  // 5. Bestehender Risk-Score (aus risk.ts)
  if (user.risk_score >= 80) {
    riskScore += 3;
    reasons.push('Hoher Risk-Score');
  } else if (user.risk_score >= 60) {
    riskScore += 2;
    reasons.push('Mittlerer Risk-Score');
  } else if (user.risk_score >= 40) {
    riskScore += 1;
    reasons.push('Leicht erhöhter Risk-Score');
  }
  
  // 6. Observed Status
  if (user.is_observed) {
    riskScore += 1;
    reasons.push('User wird beobachtet');
  }
  
  // Bestimme Risk-Level (nur Eskalation, nie Deeskalation)
  const currentLevel = user.risk_level || "CLEAN";
  let newLevel: RiskLevel;
  
  if (riskScore >= 6) {
    newLevel = "HIGH";
  } else if (riskScore >= 3) {
    newLevel = "MEDIUM";
  } else if (riskScore >= 1) {
    newLevel = "LOW";
  } else {
    newLevel = "CLEAN";
  }
  
  // Nur eskalieren, nie deeskalieren
  // Hilfsfunktion für Risk-Level-Vergleich
  const riskLevelOrder: Record<RiskLevel, number> = { "CLEAN": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3 };
  if (riskLevelOrder[newLevel] > riskLevelOrder[currentLevel as RiskLevel]) {
    return { level: newLevel, reasons };
  } else {
    return { level: currentLevel, reasons: user.risk_reasons ? JSON.parse(user.risk_reasons) : [] };
  }
}

/**
 * Aktualisiert Risk-Level für einen User
 */
export function updateUserRiskLevel(userId: number, assessment: RiskAssessment): void {
  const db = getDatabase();
  
  try {
    const stmt = db.prepare(`
      UPDATE users 
      SET risk_level = ?, risk_reasons = ?, last_risk_update = ?
      WHERE user_id = ?
    `);
    stmt.run(
      assessment.level,
      JSON.stringify(assessment.reasons),
      Date.now(),
      userId
    );
    
    console.log(`[RISK] user=${userId} level=${assessment.level} reasons=[${assessment.reasons.join(', ')}]`);
  } catch (error: any) {
    console.error(`[RISK] Fehler beim Update Risk-Level: user=${userId}`, error.message);
  }
}

/**
 * Eskaliert Risk-Level (z.B. bei Link-Post oder DM-Trigger)
 */
export function escalateRiskLevel(userId: number, reason: string): void {
  const user = getUser(userId);
  if (!user) {
    return;
  }
  
  const currentLevel = user.risk_level || "CLEAN";
  let newLevel: RiskLevel;
  
  if (currentLevel === "MEDIUM") {
    newLevel = "HIGH";
  } else if (currentLevel === "LOW") {
    newLevel = "MEDIUM";
  } else if (currentLevel === "CLEAN") {
    newLevel = "LOW";
  } else {
    // Bereits HIGH, keine weitere Eskalation
    return;
  }
  
  const reasons = user.risk_reasons ? JSON.parse(user.risk_reasons) : [];
  reasons.push(reason);
  
  updateUserRiskLevel(userId, { level: newLevel, reasons });
  console.log(`[RISK] escalated user=${userId} from=${currentLevel} to=${newLevel} reason=${reason}`);
}
