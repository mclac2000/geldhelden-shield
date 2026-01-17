import {
  getOrCreateUser,
  recordJoin,
  getJoinsInLastHour,
  getJoinsInWindow,
  getDistinctChatsInWindow,
  updateUserRiskScore,
  updateUserStatus,
  updateUserAccountMetadata,
  updateUserLastDecay,
  getUser,
  getAllUsersWithRiskScore,
  getGroup,
} from './db';
import { config } from './config';
import { Context } from 'telegraf';
import { restrictUser, banUser, logAdmin, isUserAdminOrCreatorInGroup } from './telegram';
import { isAdmin } from './admin';

export type RiskAssessment = Record<string, any>;

export interface AccountMetadata {
  accountCreatedAt: number | null;
  hasUsername: boolean;
  hasProfilePhoto: boolean;
}

/**
 * Approximiert Account-Erstellungsdatum basierend auf Telegram User-ID
 * Telegram User-IDs sind sequenziell und beginnen ca. 2009
 */
function approximateAccountCreatedAt(userId: number): number | null {
  // Sehr grobe Approximation: IDs unter 10000000 sind alte Accounts (vor 2010)
  // IDs zwischen 10000000-50000000 ca. 2010-2015
  // IDs über 50000000 ca. 2015+
  // IDs über 200000000 ca. 2018+
  // IDs über 1000000000 ca. 2020+
  
  if (userId < 10000000) {
    // Sehr alte Accounts (vor 2010)
    return new Date('2009-01-01').getTime();
  } else if (userId < 50000000) {
    // Alte Accounts (2010-2015)
    return new Date('2012-01-01').getTime();
  } else if (userId < 200000000) {
    // Mittlere Accounts (2015-2018)
    return new Date('2016-01-01').getTime();
  } else if (userId < 1000000000) {
    // Neuere Accounts (2018-2020)
    return new Date('2019-01-01').getTime();
  } else {
    // Neue Accounts (2020+)
    // Berechne basierend auf ID: ~100000 IDs pro Tag seit 2020
    const daysSince2020 = Math.floor((userId - 1000000000) / 100000);
    const accountDate = new Date('2020-01-01');
    accountDate.setDate(accountDate.getDate() + daysSince2020);
    // Clamp auf heutiges Datum
    const now = Date.now();
    return Math.min(accountDate.getTime(), now);
  }
}

/**
 * Ermittelt Account-Metadaten für einen User
 */
async function fetchAccountMetadata(ctx: Context, userId: number, userInfo?: { username?: string }): Promise<AccountMetadata> {
  let hasUsername = false;
  let hasProfilePhoto = false;

  // Versuche Username aus userInfo zu extrahieren (falls vorhanden)
  if (userInfo?.username) {
    hasUsername = true;
  }

  try {
    const telegram = ctx.telegram || (ctx as any).bot?.telegram;
    if (!telegram) {
      throw new Error('Telegram instance not available');
    }

    // Versuche User-Info abzurufen (kann bei privaten Usern fehlschlagen)
    try {
      const chatInfo = await telegram.getChat(userId.toString());
      if ((chatInfo as any).username) {
        hasUsername = true;
      }
    } catch (error) {
      // Ignorieren falls nicht verfügbar (privater User)
    }

    // Prüfe ob Profilbild existiert (via getUserProfilePhotos)
    try {
      const photos = await telegram.getUserProfilePhotos(userId, { limit: 1 });
      hasProfilePhoto = photos.total_count > 0;
    } catch (error) {
      // Ignorieren falls nicht verfügbar (privat oder kein Foto)
      hasProfilePhoto = false;
    }
  } catch (error: any) {
    // Falls API-Call fehlschlägt, verwende Fallback
    console.log(`[Risk] Fehler beim Abrufen von Metadaten für User ${userId}:`, error.message);
  }

  // Versuche account_created_at zu ermitteln (nicht direkt verfügbar)
  // Verwende Approximation basierend auf User-ID
  const accountCreatedAt = approximateAccountCreatedAt(userId);

  return {
    accountCreatedAt,
    hasUsername,
    hasProfilePhoto,
  };
}

/**
 * Berechnet Risk-Score-Faktoren für einen User
 * Gibt einmalige Faktoren zurück (Account-Alter, Username, Profilbild) und dynamische Faktoren (Multi-Join)
 */
function calculateRiskScoreFactors(user: any, joinsInLastHour: number, includeOneTimeFactors: boolean): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // MULTI_JOIN_BONUS: +20 Punkte, wenn >1 Join innerhalb 1 Stunde (dynamisch, bei jedem Join prüfen)
  if (joinsInLastHour > 1) {
    score += config.riskMultiJoinBonus;
    reasons.push(`Multi-Join (${joinsInLastHour} in 1h): +${config.riskMultiJoinBonus}`);
  }

  // Einmalige Faktoren (nur beim ersten Join)
  if (includeOneTimeFactors) {
    // ACCOUNT_AGE < 7 Tage: +30 Punkte
    if (user.account_created_at) {
      const accountAgeDays = (Date.now() - user.account_created_at) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < config.riskAccountAgeThreshold) {
        score += config.riskAccountAgeBonus;
        reasons.push(`Account-Alter (${accountAgeDays.toFixed(1)}d < ${config.riskAccountAgeThreshold}d): +${config.riskAccountAgeBonus}`);
      }
    } else if (user.first_seen) {
      // Fallback: Verwende first_seen wenn account_created_at nicht verfügbar
      const accountAgeDays = (Date.now() - user.first_seen) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < config.riskAccountAgeThreshold) {
        score += config.riskAccountAgeBonus;
        reasons.push(`Account-Alter (${accountAgeDays.toFixed(1)}d < ${config.riskAccountAgeThreshold}d, geschätzt): +${config.riskAccountAgeBonus}`);
      }
    }

    // NO_USERNAME: +15 Punkte
    if (!user.has_username) {
      score += config.riskNoUsername;
      reasons.push(`Kein Username: +${config.riskNoUsername}`);
    }

    // NO_PROFILE_PHOTO: +10 Punkte
    if (!user.has_profile_photo) {
      score += config.riskNoProfilePhoto;
      reasons.push(`Kein Profilbild: +${config.riskNoProfilePhoto}`);
    }
  }

  return { score, reasons };
}

/**
 * Bewertet Join-Risiko für einen User
 */
export async function assessJoinRisk(
  ctx: Context,
  userId: number,
  chatId: string,
  userInfo?: { username?: string; firstName?: string; lastName?: string }
): Promise<RiskAssessment> {
  // Admin-Protection: Bot-Admins niemals bewerten
  if (isAdmin(userId)) {
    return {
      userId,
      riskScore: 0,
      shouldRestrict: false,
      shouldBan: false,
      currentStatus: 'ok',
      reasons: ['Admin-User (geschützt)'],
      isSuspicious: false,
      joinCount: 0,
      distinctChats: 0,
    } as RiskAssessment;
  }

  // TEAM-MITGLIED-Protection: Gruppen-Admins/Creators niemals bewerten
  try {
    const adminCheck = await isUserAdminOrCreatorInGroup(chatId, userId, ctx.telegram);
    if (adminCheck.isAdmin) {
      console.log(`[Risk] User ${userId} ist Admin/Creator in Gruppe ${chatId} - überspringe Bewertung`);
      return {
        userId,
        riskScore: 0,
        shouldRestrict: false,
        shouldBan: false,
        currentStatus: 'ok',
        reasons: ['Team-Mitglied (Gruppen-Admin/Creator)'],
        isSuspicious: false,
        joinCount: 0,
        distinctChats: 0,
      } as RiskAssessment;
    }
  } catch (error: any) {
    // Bei Fehler bei Admin-Prüfung trotzdem fortfahren (nicht blockieren)
    console.log(`[Risk] Fehler bei Admin-Prüfung für User ${userId} in ${chatId}:`, error.message);
  }

  // Stelle sicher, dass User existiert
  let user = getOrCreateUser(userId);

  // Hole Account-Metadaten beim ersten Join (wenn noch nicht vorhanden)
  if (user.account_created_at === null || user.has_username === undefined || user.has_profile_photo === undefined) {
    const metadata = await fetchAccountMetadata(ctx, userId, userInfo);
    updateUserAccountMetadata(userId, metadata.accountCreatedAt, metadata.hasUsername, metadata.hasProfilePhoto);
    
    // User neu laden
    user = getUser(userId)!;
    user.has_username = metadata.hasUsername;
    user.has_profile_photo = metadata.hasProfilePhoto;
    if (metadata.accountCreatedAt) {
      user.account_created_at = metadata.accountCreatedAt;
    }
  }

  // Recorde den Join
  recordJoin(userId, chatId);

  // Berechne Risk-Score
  const joinsInLastHour = getJoinsInLastHour(userId);
  const joinsInWindow = getJoinsInWindow(userId, config.joinWindowHours);
  const distinctChats = getDistinctChatsInWindow(userId, config.joinWindowHours);
  
  // JOIN_EVENT: +10 Punkte pro Join in letzter Stunde
  const joinScore = joinsInLastHour.length * config.riskJoinEvent;
  
  // Berechne zusätzliche Faktoren
  const wasMetadataJustSet = user.account_created_at === null || user.has_username === undefined || user.has_profile_photo === undefined;
  const { score: additionalScore, reasons: additionalReasons } = calculateRiskScoreFactors(user, joinsInLastHour.length, wasMetadataJustSet);
  
  // Neuer Risk-Score = aktueller Score + Join-Score + zusätzliche Faktoren
  // Join-Score wird immer addiert (+10 pro Join)
  // Multi-Join-Bonus wird dynamisch berechnet (wenn >1 Join in 1h)
  // Einmalige Faktoren (Account-Alter, Username, Profilbild) nur beim ersten Join
  const scoreToAdd = joinScore + additionalScore;
  
  const newRiskScore = Math.max(0, user.risk_score + scoreToAdd);
  
  const allReasons = [
    `Joins (${joinsInLastHour.length} in 1h): +${joinScore}`,
    ...additionalReasons,
  ];

  // Update Risk-Score in DB
  updateUserRiskScore(userId, newRiskScore);

  // Lade aktuellen Status
  const currentUser = getUser(userId)!;

  // Status wird nur aus DB gelesen
  const group = getGroup(chatId);
  const isManagedGroup = group?.status === 1; // 1 = managed
  
  // Wenn Gruppe nicht managed ist, nur loggen, keine Aktionen
  if (!isManagedGroup) {
    const { statusCodeToString } = await import('./domain/groupProjection');
    const statusStr = group ? statusCodeToString(group.status) : 'unknown';
    console.log(`[Risk] Gruppe ${chatId} ist nicht managed (DB Status: ${statusStr}). Keine Maßnahmen.`);
    
    // Logge trotzdem Join-Event, aber ohne Aktion (nur wenn verdächtig)
    if (newRiskScore >= config.riskRestrictThreshold) {
      await logAdmin(
        {
          action: 'WARNING',
          userId,
          chatId,
          reason: `User gejoint in nicht-managed Gruppe (DB Status: ${group ? (await import('./domain/groupProjection')).statusCodeToString(group.status) : 'unknown'}). Risk Score: ${newRiskScore}`,
          userInfo,
        },
        ctx
      );
    }
    
    return {
      userId,
      riskScore: newRiskScore,
      shouldRestrict: false,
      shouldBan: false,
      currentStatus: currentUser.status as 'ok' | 'restricted' | 'banned',
      reasons: [...allReasons, `Gruppe nicht managed (${group ? (await import('./domain/groupProjection')).statusCodeToString(group.status) : 'unknown'})`],
      isSuspicious: newRiskScore >= config.riskRestrictThreshold,
      joinCount: joinsInWindow.length,
      distinctChats: distinctChats.length,
    } as RiskAssessment;
  }

  // Prüfe Schwellenwerte
  const shouldRestrict = newRiskScore >= config.riskRestrictThreshold;
  const shouldBan = newRiskScore >= config.riskBanThreshold;

  // Wenn User bereits banned ist, nichts tun
  const userStatus = String(currentUser.status || '');
  if (userStatus === 'banned') {
    return {
      userId,
      riskScore: newRiskScore,
      shouldRestrict: false,
      shouldBan: false,
      currentStatus: 'banned',
      reasons: ['Status: bereits banned', ...allReasons],
      isSuspicious: true,
      joinCount: joinsInWindow.length,
      distinctChats: distinctChats.length,
    } as RiskAssessment;
  }

  // Idempotenz-Check: Prüfe ob Action bereits durchgeführt wurde
  const alreadyRestricted = userStatus === 'restricted' && shouldRestrict;
  const alreadyBanned = userStatus === 'banned' && shouldBan;

  // Wenn bereits restricted und sollte wieder restricted werden, nur loggen
  if (alreadyRestricted && !shouldBan) {
    await logAdmin(
      {
        action: 'WARNING',
        userId,
        chatId,
        reason: `Risk Score erneut erhöht: ${newRiskScore} (Threshold: ${config.riskRestrictThreshold}). Status: bereits restricted.`,
        userInfo,
      },
      ctx
    );

    return {
      userId,
      riskScore: newRiskScore,
      shouldRestrict: false, // Bereits restricted
      shouldBan: false,
      currentStatus: 'restricted',
      reasons: allReasons,
      isSuspicious: true,
      joinCount: joinsInWindow.length,
      distinctChats: distinctChats.length,
    } as RiskAssessment;
  }

  // Führe Aktion aus basierend auf Score
  if (shouldBan && !alreadyBanned) {
    // Panic-Mode Check (Prompt 6): Stoppt Auto-Bans
    if (config.panicMode) {
      console.log(`[RISK][PANIC] Auto-Ban gestoppt für User ${userId} (Panic-Mode aktiv)`);
      await logAdmin(
        {
          action: 'WARNING',
          userId,
          chatId,
          reason: `Risk Score: ${newRiskScore} (≥ ${config.riskBanThreshold}) - AUTO-BAN GESTOPPT (Panic-Mode aktiv)\n${allReasons.join('\n')}`,
          userInfo,
        },
        ctx
      );
      return {
        userId,
        riskScore: newRiskScore,
        shouldRestrict: false,
        shouldBan: false, // Panic-Mode: kein Ban
        currentStatus: currentUser.status as 'ok' | 'restricted' | 'banned',
        reasons: [...allReasons, 'Panic-Mode: Auto-Ban gestoppt'],
        isSuspicious: true,
        joinCount: joinsInWindow.length,
        distinctChats: distinctChats.length,
      } as RiskAssessment;
    }
    
    // BAN
    updateUserStatus(userId, 'banned');
    const result = await banUser(chatId, userId, `Risk Score: ${newRiskScore} (≥ ${config.riskBanThreshold})`);

    if (result.success) {
      await logAdmin(
        {
          action: 'BANNED',
          userId,
          chatId,
          reason: `Risk Score: ${newRiskScore} (Threshold: ${config.riskBanThreshold})\n${allReasons.join('\n')}`,
          userInfo,
        },
        ctx
      );
    }

    return {
      userId,
      riskScore: newRiskScore,
      shouldRestrict: false,
      shouldBan: true,
      currentStatus: 'banned',
      reasons: allReasons,
      isSuspicious: true,
      joinCount: joinsInWindow.length,
      distinctChats: distinctChats.length,
    } as RiskAssessment;
  } else if (shouldRestrict && !alreadyRestricted) {
    // RESTRICT
    updateUserStatus(userId, 'restricted');
    const result = await restrictUser(chatId, userId, `Risk Score: ${newRiskScore} (≥ ${config.riskRestrictThreshold})`);

    if (result.success) {
      await logAdmin(
        {
          action: 'RESTRICTED',
          userId,
          chatId,
          reason: `Risk Score: ${newRiskScore} (Threshold: ${config.riskRestrictThreshold})\n${allReasons.join('\n')}`,
          userInfo,
        },
        ctx
      );
    } else if (result.skipped) {
      await logAdmin(
        {
          action: 'WARNING',
          userId,
          chatId,
          reason: `Restrict übersprungen: ${result.error}. Risk Score: ${newRiskScore}`,
          userInfo,
        },
        ctx
      );
    }

    return {
      userId,
      riskScore: newRiskScore,
      shouldRestrict: true,
      shouldBan: false,
      currentStatus: 'restricted',
      reasons: allReasons,
      isSuspicious: true,
      joinCount: joinsInWindow.length,
      distinctChats: distinctChats.length,
    } as RiskAssessment;
  }

  // Keine Aktion nötig
  return {
    userId,
    riskScore: newRiskScore,
    shouldRestrict: false,
    shouldBan: false,
    currentStatus: currentUser.status as any,
    reasons: allReasons,
    isSuspicious: newRiskScore >= config.riskRestrictThreshold,
    joinCount: joinsInWindow.length,
    distinctChats: distinctChats.length,
  } as RiskAssessment;
}

/**
 * Wendet Risk-Decay auf einen User an
 * Alle 24h → -20 Risk Points
 */
export function applyRiskDecay(userId: number): { newScore: number; decayed: boolean } {
  const user = getUser(userId);
  if (!user || user.risk_score <= 0) {
    return { newScore: user?.risk_score || 0, decayed: false };
  }

  const now = Date.now();
  const lastDecay = user.last_decay_at || user.first_seen;
  const hoursSinceDecay = (now - lastDecay) / (1000 * 60 * 60);

  // Prüfe ob Decay fällig ist (alle X Stunden)
  if (hoursSinceDecay >= config.riskDecayHours) {
    const newScore = Math.max(0, user.risk_score - config.riskDecayAmount);
    updateUserRiskScore(userId, newScore);
    updateUserLastDecay(userId, now);

    return { newScore, decayed: true };
  }

  return { newScore: user.risk_score, decayed: false };
}

/**
 * Prüft ob User automatisch unrestricted werden sollte
 * Wenn Score < (RESTRICT_THRESHOLD - BUFFER): auto-unrestrict
 * Führt tatsächlich unrestrict in allen Gruppen aus
 */
export async function checkAutoUnrestrict(
  ctx: Context,
  userId: number,
  performUnrestrict: boolean = true
): Promise<{ unrestricted: boolean; newStatus: 'ok' | 'restricted' | 'banned' }> {
  const user = getUser(userId);
  const userStatus = String(user?.status || '');
  if (!user || userStatus !== 'restricted') {
    const fallbackStatus = (user?.status as 'ok' | 'restricted' | 'banned') || 'ok';
    return { unrestricted: false, newStatus: fallbackStatus as 'ok' | 'restricted' | 'banned' };
  }

  const thresholdForUnrestrict = config.riskRestrictThreshold - config.riskAutoUnrestrictBuffer;

  if (user.risk_score < thresholdForUnrestrict) {
    // Auto-unrestrict
    updateUserStatus(userId, 'ok');
    
    // Unrestrict in allen Gruppen
    if (performUnrestrict && ctx) {
      const { unrestrictUserInAllGroups } = await import('./telegram');
      await unrestrictUserInAllGroups(
        userId,
        `Auto-unrestricted (Risk Decay): Score ${user.risk_score} < ${thresholdForUnrestrict}`
      );
    }

    await logAdmin(
      {
        action: 'UNRESTRICTED',
        userId,
        reason: `Auto-unrestricted (Risk Decay): Score ${user.risk_score} < ${thresholdForUnrestrict} (Threshold - Buffer)`,
      },
      ctx
    );

    return { unrestricted: true, newStatus: 'ok' };
  }

  return { unrestricted: false, newStatus: (user.status as any) as 'ok' | 'restricted' | 'banned' };
}

/**
 * Wartungsjob: Wendet Decay auf alle User mit Risk-Score > 0 an
 */
export async function runDecayMaintenance(ctx: Context | null): Promise<{ processed: number; decayed: number; unrestricted: number }> {
  const users = getAllUsersWithRiskScore();
  let processed = 0;
  let decayed = 0;
  let unrestricted = 0;

  for (const user of users) {
    // Skip Admins und banned User
    const userStatus = String(user.status || '');
    if (isAdmin(user.user_id) || userStatus === 'banned') {
      continue;
    }

    processed++;

    // Wende Decay an
    const { decayed: wasDecayed } = applyRiskDecay(user.user_id);

    if (wasDecayed) {
      decayed++;

      // Prüfe ob Auto-Unrestrict nötig ist
      const userAfterDecay = getUser(user.user_id);
      const decayedStatus = String(userAfterDecay?.status || '');
      if (userAfterDecay && decayedStatus === 'restricted' && ctx) {
        const { unrestricted: wasUnrestricted } = await checkAutoUnrestrict(ctx, user.user_id, true);
        
        if (wasUnrestricted) {
          unrestricted++;
        }
      }
    }
  }

  if (decayed > 0 || unrestricted > 0) {
    console.log(`[Decay] Verarbeitet: ${processed}, Decay: ${decayed}, Auto-Unrestrict: ${unrestricted}`);
  }

  return { processed, decayed, unrestricted };
}

export function getJoinStats(userId: number): {
  totalJoins: number;
  joinsInLastHour: number;
  riskScore: number;
  reasons: string[];
} {
  const user = getUser(userId);
  if (!user) {
    return { totalJoins: 0, joinsInLastHour: 0, riskScore: 0, reasons: [] };
  }

  const joinsInLastHour = getJoinsInLastHour(userId);
  const joinScore = joinsInLastHour.length * config.riskJoinEvent;
  
  // Zeige alle Faktoren (einschließlich einmaliger Faktoren für Anzeige)
  const { reasons } = calculateRiskScoreFactors(user, joinsInLastHour.length, true);
  const totalScore = user.risk_score;

  return {
    totalJoins: joinsInLastHour.length,
    joinsInLastHour: joinsInLastHour.length,
    riskScore: totalScore,
    reasons: [
      `Joins (${joinsInLastHour.length} in 1h): +${joinScore}`,
      ...reasons,
    ],
  };
}
