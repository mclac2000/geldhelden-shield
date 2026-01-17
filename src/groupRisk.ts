/**
 * Group Risk Intelligence System
 * 
 * Berechnet und verwaltet Group Risk Scores für proaktive Admin-Empfehlungen
 */

import { getOrCreateGroupStats, updateGroupStats, getGroupStats, getAllGroupStats, GroupStats } from './db';
import { GroupRiskLevel, RiskLevel } from './db';
import { getJoinCount24hForGroup, getUsersWithRiskLevel, getBansInWindow } from './db';
import { getGroup } from './db';

export interface GroupRiskAssessment {
  level: GroupRiskLevel;
  score: number;
  recommendations: string[];
}

/**
 * Berechnet Group Risk Score für eine Gruppe
 * 
 * +1 pro Join
 * +3 pro MEDIUM-Risk-User
 * +7 pro HIGH-Risk-User
 * +10 pro Cluster-Ban
 * natürlicher Decay: −20 % / 24h
 */
export function calculateGroupRiskScore(chatId: string): number {
  const stats = getOrCreateGroupStats(chatId, getGroup(chatId)?.title || 'Unbekannt');
  const now = Date.now();
  const hoursSinceUpdate = (now - stats.last_updated) / (1000 * 60 * 60);
  
  // Decay: −20 % / 24h
  let currentScore = stats.risk_score;
  if (hoursSinceUpdate >= 24) {
    const decayFactor = Math.pow(0.8, hoursSinceUpdate / 24);
    currentScore = Math.floor(currentScore * decayFactor);
  }
  
  // Neue Events (24h)
  const joins24h = getJoinCount24hForGroup(chatId);
  const mediumRiskUsers = getUsersWithRiskLevel(chatId, "MEDIUM" as RiskLevel, 24);
  const highRiskUsers = getUsersWithRiskLevel(chatId, "HIGH" as RiskLevel, 24);
  const clusterBans = getBansInWindow(chatId, 24); // Vereinfacht: alle Bans als Cluster-Bans
  
  // Debug-Log
  console.log(`[GROUP-RISK] chat=${chatId} score=${currentScore} joins24h=${joins24h} medium=${mediumRiskUsers.length} high=${highRiskUsers.length} bans=${clusterBans.length}`);
  
  // Berechne neuen Score
  let newScore = currentScore;
  newScore += joins24h * 1; // +1 pro Join
  newScore += mediumRiskUsers.length * 3; // +3 pro MEDIUM-Risk-User
  newScore += highRiskUsers.length * 7; // +7 pro HIGH-Risk-User
  newScore += clusterBans.length * 10; // +10 pro Cluster-Ban
  
  // Aktualisiere Stats
  const finalScore = Math.max(0, Math.min(100, newScore)); // Clamp auf 0-100
  const level = getGroupRiskLevel(finalScore);
  
  updateGroupStats(chatId, {
    risk_score: finalScore,
    joins_24h: joins24h,
    high_risk_users_24h: highRiskUsers.length,
    bans_24h: clusterBans.length,
  });
  
  console.log(`[GROUP-RISK] chat=${chatId} score=${finalScore} level=${level}`);
  
  return finalScore;
}

/**
 * Bestimmt Group Risk Level basierend auf Score
 */
export function getGroupRiskLevel(score: number): GroupRiskLevel {
  if (score <= 20) {
    return 'STABLE';
  } else if (score <= 40) {
    return 'ATTENTION';
  } else if (score <= 70) {
    return 'WARNING';
  } else {
    return 'CRITICAL';
  }
}

/**
 * Evaluates Group Risk und gibt Empfehlungen
 */
export function evaluateGroupRisk(chatId: string): GroupRiskAssessment {
  const score = calculateGroupRiskScore(chatId);
  const level = getGroupRiskLevel(score);
  const stats = getGroupStats(chatId);
  
  const recommendations: string[] = [];
  
  switch (level) {
    case "STABLE":
      recommendations.push('Gruppe ist stabil. Normale Überwachung ausreichend.');
      break;
      
    case "ATTENTION":
      recommendations.push('In den letzten 24h erhöhte Aktivität.');
      recommendations.push('Empfehlung: Gruppe beobachten.');
      break;
      
    case "WARNING":
      recommendations.push('Mehrere auffällige User beigetreten.');
      recommendations.push('Empfehlungen:');
      recommendations.push('• Begrüßung aktiv lassen');
      recommendations.push('• Keine externen Links erlauben');
      recommendations.push('• Neue User beobachten');
      break;
      
    case "CRITICAL":
      recommendations.push('Mehrere Scam-Indikatoren erkannt.');
      recommendations.push('Empfehlungen:');
      recommendations.push('• Temporär Links sperren');
      recommendations.push('• Neue User restricten');
      recommendations.push('• Admins aufmerksam halten');
      break;
  }
  
  return {
    level,
    score,
    recommendations,
  };
}

/**
 * Gibt alle Gruppen mit Risk-Level zurück
 */
export function getAllGroupsWithRiskLevel(): Array<{ stats: GroupStats; level: GroupRiskLevel }> {
  const allStats = getAllGroupStats();
  return allStats.map(stats => ({
    stats,
    level: getGroupRiskLevel(stats.risk_score),
  }));
}

/**
 * Gibt Gruppen-Risiko-Statistiken zurück
 */
export function getGroupRiskStatistics(): {
  stable: number;
  attention: number;
  warning: number;
  critical: number;
} {
  const groupsWithRisk = getAllGroupsWithRiskLevel();
  
  return {
    stable: groupsWithRisk.filter(g => g.level === "STABLE").length,
    attention: groupsWithRisk.filter(g => g.level === "ATTENTION").length,
    warning: groupsWithRisk.filter(g => g.level === "WARNING").length,
    critical: groupsWithRisk.filter(g => g.level === "CRITICAL").length,
  };
}
