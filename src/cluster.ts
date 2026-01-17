import {
  getUserIdsWithJoinsInWindow,
  getManagedGroupsForUser,
  setUserObserved,
  isUserObserved,
  saveCluster,
  isBlacklisted,
} from './db';
import { isAdmin } from './admin';
import { banUserGlobally } from './telegram';

/**
 * L1: User in ≥3 managed Gruppen innerhalb 24h → setUserObserved()
 */
async function detectL1Clusters(): Promise<number> {
  const userIds = getUserIdsWithJoinsInWindow(24); // 24 Stunden
  let detected = 0;

  for (const userId of userIds) {
    // Admin-User ausschließen
    if (isAdmin(userId)) {
      continue;
    }

    // Prüfe ob User bereits beobachtet wird
    if (isUserObserved(userId)) {
      continue;
    }

    // Hole managed Gruppen für User
    const groups = getManagedGroupsForUser(userId, 24);

    // L1: ≥3 managed Gruppen innerhalb 24h
    if (groups.length >= 3) {
      setUserObserved(userId, true);
      console.log(`[Cluster][L1] User ${userId} auffällig`);
      detected++;
    }
  }

  return detected;
}

/**
 * L2: ≥2 User teilen ≥3 identische managed Gruppen innerhalb 48h → Cluster erzeugen, alle User beobachten
 */
async function detectL2Clusters(): Promise<number> {
  const userIds = getUserIdsWithJoinsInWindow(48); // 48 Stunden
  const userGroupsMap = new Map<number, Set<string>>();

  // Erstelle Map: user_id → Set von managed Gruppen-IDs
  for (const userId of userIds) {
    // Admin-User ausschließen
    if (isAdmin(userId)) {
      continue;
    }

    const groups = getManagedGroupsForUser(userId, 48);
    if (groups.length >= 3) {
      userGroupsMap.set(userId, new Set(groups));
    }
  }

  // Finde User-Paare, die ≥3 identische Gruppen teilen
  const detectedClusters: Array<{ users: number[]; groups: string[] }> = [];
  const processedPairs = new Set<string>();

  const userIdsArray = Array.from(userGroupsMap.keys());
  for (let i = 0; i < userIdsArray.length; i++) {
    for (let j = i + 1; j < userIdsArray.length; j++) {
      const user1 = userIdsArray[i];
      const user2 = userIdsArray[j];
      const pairKey = `${Math.min(user1, user2)}-${Math.max(user1, user2)}`;

      if (processedPairs.has(pairKey)) {
        continue;
      }

      const groups1 = userGroupsMap.get(user1)!;
      const groups2 = userGroupsMap.get(user2)!;

      // Finde gemeinsame Gruppen
      const commonGroups = Array.from(groups1).filter(g => groups2.has(g));

      // L2: ≥2 User teilen ≥3 identische managed Gruppen
      if (commonGroups.length >= 3) {
        detectedClusters.push({
          users: [user1, user2],
          groups: commonGroups,
        });
        processedPairs.add(pairKey);

        // Alle User im Cluster beobachten
        setUserObserved(user1, true);
        setUserObserved(user2, true);
      }
    }
  }

  // Speichere Cluster
  for (const cluster of detectedClusters) {
    saveCluster(2, cluster.users, cluster.groups, false);
    console.log(`[Cluster][L2] Netzwerk erkannt: ${cluster.users.length} User / ${cluster.groups.length} Gruppen`);
  }

  return detectedClusters.length;
}

/**
 * L3: ≥3 User teilen ≥4 identische managed Gruppen ODER ein User im Cluster ist bereits geblacklisted
 * → GLOBAL BAN aller Cluster-User → Cluster speichern
 */
async function detectL3Clusters(): Promise<number> {
  const userIds = getUserIdsWithJoinsInWindow(48); // 48 Stunden
  const userGroupsMap = new Map<number, Set<string>>();

  // Erstelle Map: user_id → Set von managed Gruppen-IDs
  for (const userId of userIds) {
    // Admin-User ausschließen
    if (isAdmin(userId)) {
      continue;
    }

    const groups = getManagedGroupsForUser(userId, 48);
    if (groups.length >= 3) {
      userGroupsMap.set(userId, new Set(groups));
    }
  }

  // Finde Gruppen, die von ≥3 Usern geteilt werden
  const groupUsersMap = new Map<string, Set<number>>();
  for (const [userId, groups] of userGroupsMap.entries()) {
    for (const groupId of groups) {
      if (!groupUsersMap.has(groupId)) {
        groupUsersMap.set(groupId, new Set());
      }
      groupUsersMap.get(groupId)!.add(userId);
    }
  }

  // Finde Gruppen, die von ≥3 Usern geteilt werden
  const sharedGroups = Array.from(groupUsersMap.entries())
    .filter(([_, users]) => users.size >= 3)
    .map(([groupId, users]) => ({ groupId, users: Array.from(users) }));

  // Finde Cluster: ≥3 User teilen ≥4 identische Gruppen
  const detectedClusters: Array<{ users: number[]; groups: string[]; hasBlacklisted: boolean }> = [];

  // Erstelle alle möglichen 3er-Kombinationen von Usern
  const allUsers = Array.from(userGroupsMap.keys());
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      for (let k = j + 1; k < allUsers.length; k++) {
        const user1 = allUsers[i];
        const user2 = allUsers[j];
        const user3 = allUsers[k];

        const groups1 = userGroupsMap.get(user1)!;
        const groups2 = userGroupsMap.get(user2)!;
        const groups3 = userGroupsMap.get(user3)!;

        // Finde gemeinsame Gruppen aller 3 User
        const commonGroups = Array.from(groups1).filter(g => groups2.has(g) && groups3.has(g));

        // L3: ≥3 User teilen ≥4 identische managed Gruppen
        if (commonGroups.length >= 4) {
          const hasBlacklisted = isBlacklisted(user1) || isBlacklisted(user2) || isBlacklisted(user3);
          detectedClusters.push({
            users: [user1, user2, user3],
            groups: commonGroups,
            hasBlacklisted,
          });
        }
      }
    }
  }

  // Prüfe auch: Wenn ein User in einem bereits erkannten L2-Cluster ist UND geblacklisted ist
  // Dann alle User im Cluster bannen
  for (const [userId, groups] of userGroupsMap.entries()) {
    if (isBlacklisted(userId)) {
      // Finde alle anderen User, die mit diesem User ≥3 gemeinsame Gruppen haben
      const clusterUsers = [userId];
      for (const [otherUserId, otherGroups] of userGroupsMap.entries()) {
        if (otherUserId === userId) continue;
        if (isAdmin(otherUserId)) continue;

        const commonGroups = Array.from(groups).filter(g => otherGroups.has(g));
        if (commonGroups.length >= 3) {
          clusterUsers.push(otherUserId);
        }
      }

      if (clusterUsers.length >= 2) {
        detectedClusters.push({
          users: clusterUsers,
          groups: Array.from(groups),
          hasBlacklisted: true,
        });
      }
    }
  }

  // Entferne Duplikate
  const uniqueClusters = new Map<string, { users: number[]; groups: string[]; hasBlacklisted: boolean }>();
  for (const cluster of detectedClusters) {
    const key = cluster.users.sort((a, b) => a - b).join('-');
    if (!uniqueClusters.has(key)) {
      uniqueClusters.set(key, cluster);
    }
  }

  // Banne alle User in L3-Clustern
  let banned = 0;
  for (const cluster of uniqueClusters.values()) {
    for (const userId of cluster.users) {
      try {
        const banResult = await banUserGlobally(userId, 'L3 cluster detection');
        if (banResult.success && !banResult.skipped) {
          banned++;
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Cluster][L3] Fehler beim Bannen von ${userId}:`, errorMessage);
      }
    }

    // Speichere Cluster
    saveCluster(3, cluster.users, cluster.groups, true);
    console.log(`[Cluster][L3] Global-Ban ausgeführt: ${cluster.users.length} User / ${cluster.groups.length} Gruppen`);
  }

  return uniqueClusters.size;
}

/**
 * Batch-Analyse für Cluster-Erkennung
 */
export async function runClusterDetection(): Promise<{ l1: number; l2: number; l3: number }> {
  try {
    const l1 = await detectL1Clusters();
    const l2 = await detectL2Clusters();
    const l3 = await detectL3Clusters();

    return { l1, l2, l3 };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Cluster] Fehler bei Cluster-Erkennung:', errorMessage);
    return { l1: 0, l2: 0, l3: 0 };
  }
}
