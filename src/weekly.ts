import { Context } from 'telegraf';
import {
  getAllGroups,
  getActiveUsersCount,
  getNewUsersCount,
  getShieldStatistics,
  getClusterStats,
  getTopGroupsByJoins,
  getTopGroupsByBans,
  getTopGroupsByClusterParticipation,
  getNewObservedUsersCount,
} from './db';
import { sendToAdminLogChat } from './telegram';

/**
 * Formatiert Datum zu lesbarem Format
 */
function formatDateRange(startTime: number, endTime: number): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  
  const formatDate = (date: Date): string => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  };
  
  return `${formatDate(start)} - ${formatDate(end)}`;
}

/**
 * Generiert einen Wochenreport
 */
export async function generateWeeklyReport(ctx?: Context): Promise<string> {
  const windowHours = 168; // 7 Tage
  const endTime = Date.now();
  const startTime = endTime - (windowHours * 60 * 60 * 1000);
  
  // Hole alle Daten
  const allGroups = getAllGroups();
  const managedGroups = allGroups.filter(g => g.status === 1); // 1 = managed
  const activeUsers = getActiveUsersCount(windowHours);
  const newUsers = getNewUsersCount(windowHours);
  const shieldStats = getShieldStatistics(windowHours);
  const globalBans = shieldStats.globalBans;
  const newObservedUsers = getNewObservedUsersCount(windowHours);
  // Zeitfenster übergeben — ohne das war hier der Gesamtbestand seit
  // Systemstart gemeldet, im Wochenbericht also eine Zahl, die wie eine
  // Wochenzahl aussah und jede Woche wuchs.
  const clusterStats = getClusterStats(windowHours);
  const clusterGesamt = getClusterStats();
  const topGroupsByJoins = getTopGroupsByJoins(3, windowHours);
  const topGroupsByBans = getTopGroupsByBans(3, windowHours);
  const topGroupsByCluster = getTopGroupsByClusterParticipation(3);
  
  // Baue Report
  let report = `Wochenreport Geldhelden Shield\n`;
  report += `Zeitraum: ${formatDateRange(startTime, endTime)}\n\n`;
  
  // 1. Netzwerkstatus
  report += `Netzwerkstatus\n`;
  report += `Managed Gruppen: ${managedGroups.length}\n`;
  report += `Aktive User gesamt: ${activeUsers}\n`;
  report += `Neue User (Woche): ${newUsers}\n\n`;
  
  // 2. Sicherheit
  report += `Sicherheit\n`;
  report += `Global gebannte User: ${globalBans}\n`;
  report += `Neu beobachtete User: ${newObservedUsers}\n\n`;
  
  // 3. Cluster-Status
  report += `Cluster-Status (diese Woche)\n`;
  report += `L1 (auffällig): ${clusterStats.l1}\n`;
  report += `L2 (Netzwerk): ${clusterStats.l2}\n`;
  report += `L3 (Global-Ban): ${clusterStats.l3}\n`;
  report += `Gesamtbestand seit Systemstart: ${clusterGesamt.total}\n`;
  
  // Cluster-Statusbewertung
  let clusterAssessment = '';
  if (clusterStats.total === 0) {
    clusterAssessment = 'Keine Cluster erkannt.';
  } else if (clusterStats.l3 > 0) {
    clusterAssessment = 'Kritische Cluster-Netzwerke wurden identifiziert und gebannt.';
  } else if (clusterStats.l2 > 0) {
    clusterAssessment = 'Verdächtige Netzwerke werden beobachtet.';
  } else {
    clusterAssessment = 'Einzelne auffällige User werden überwacht.';
  }
  report += `Status: ${clusterAssessment}\n\n`;
  
  // 4. Auffällige Gruppen
  report += `Auffällige Gruppen\n\n`;
  
  // Top 3 nach Joins
  if (topGroupsByJoins.length > 0) {
    report += `Top 3 Gruppen (Joins):\n`;
    for (let i = 0; i < topGroupsByJoins.length; i++) {
      const group = topGroupsByJoins[i];
      report += `${i + 1}. ${group.title}: ${group.joinCount} Joins\n`;
    }
    report += '\n';
  }
  
  // Top 3 nach Banns
  if (topGroupsByBans.length > 0) {
    report += `Top 3 Gruppen (Banns):\n`;
    for (let i = 0; i < topGroupsByBans.length; i++) {
      const group = topGroupsByBans[i];
      report += `${i + 1}. ${group.title}: ${group.banCount} Banns\n`;
    }
    report += '\n';
  }
  
  // Top 3 nach Cluster-Beteiligung
  if (topGroupsByCluster.length > 0) {
    report += `Top 3 Gruppen (Cluster-Beteiligung):\n`;
    for (let i = 0; i < topGroupsByCluster.length; i++) {
      const group = topGroupsByCluster[i];
      report += `${i + 1}. ${group.title}: ${group.clusterCount} Cluster\n`;
    }
    report += '\n';
  }
  
  // 5. Systemzustand — der eigentliche Zweck eines Wochenberichts.
  //
  // Bis 09/2026 endete der Bericht mit dem festen Satz "Das System arbeitet
  // stabil und überwacht das Netzwerk kontinuierlich." — unabhängig davon, ob
  // das stimmte. Er hätte auch dann dort gestanden, als der Bot mit 401 in
  // einer Neustartschleife lag. Ein Bericht, der nur bestätigt, ist schlimmer
  // als keiner: er erzeugt Vertrauen, wo keines hingehört.
  const befunde: string[] = [];
  report += `Systemzustand\n`;

  try {
    const { pruefeJobs, ERWARTETE_JOBS } = await import('./jobRegistry');
    const jobs = pruefeJobs();
    if (jobs.ok) {
      report += `Hintergrundjobs: alle ${Object.keys(ERWARTETE_JOBS).length} registriert\n`;
    } else {
      report += `Hintergrundjobs: ${jobs.fehlend.length} FEHLEN — ${jobs.fehlend.join(', ')}\n`;
      befunde.push(`${jobs.fehlend.length} Hintergrundjobs laufen nicht`);
    }
  } catch {
    report += `Hintergrundjobs: nicht prüfbar\n`;
  }

  try {
    const { getLastScanRun } = await import('./db');
    const lauf = getLastScanRun();
    if (!lauf) {
      report += `Baseline-Scan: noch kein Lauf protokolliert\n`;
      befunde.push('kein Baseline-Scan protokolliert');
    } else {
      const tage = Math.floor((Date.now() - lauf.started_at) / 86400000);
      report += `Baseline-Scan: vor ${tage} Tagen (${lauf.scanned_groups}/${lauf.total_groups} Gruppen, ` +
        `${lauf.skipped_no_admin} übersprungen, ${lauf.errors} Fehler)\n`;
      if (tage > 40) befunde.push(`letzter Baseline-Scan vor ${tage} Tagen`);
    }
  } catch {
    report += `Baseline-Scan: nicht prüfbar\n`;
  }

  // Verwaltete Gruppen ohne Adminrechte — die gefährlichste Kategorie:
  // Sie zählen überall als geschützt, obwohl dort weder gesperrt noch gelöscht
  // werden kann.
  try {
    const { getGroupsWithoutAdminRights } = await import('./db');
    const ohneRechte = getGroupsWithoutAdminRights();
    if (ohneRechte.length === 0) {
      report += `Adminrechte: in allen ${managedGroups.length} verwalteten Gruppen vorhanden\n`;
    } else {
      report += `Adminrechte FEHLEN in ${ohneRechte.length} verwalteten Gruppen — dort greift der Schutz nicht:\n`;
      for (const g of ohneRechte.slice(0, 8)) {
        report += `  - ${g.title || g.chat_id} (${g.mitglieder} Mitglieder)\n`;
      }
      befunde.push(`${ohneRechte.length} Gruppe(n) ohne Adminrechte`);
    }
  } catch {
    report += `Adminrechte: nicht prüfbar\n`;
  }

  // Gruppen, in denen der Bot laut Datenbank sein sollte, aber deaktiviert ist
  const deaktiviert = allGroups.filter(g => g.status === 2).length; // 2 = disabled
  if (deaktiviert > 0) {
    report += `Deaktivierte Gruppen: ${deaktiviert} (Bot dort ohne Zugriff)\n`;
  }

  report += `\n`;

  // 6. Zusammenfassung
  report += `Zusammenfassung\n`;
  report += `Das Netzwerk umfasst ${managedGroups.length} verwaltete Gruppen mit ${activeUsers} aktiven Usern in der Berichtswoche. `;
  report += `${newUsers} User wurden neu erfasst. `;

  if (globalBans > 0) {
    report += `Sicherheitsmaßnahmen: ${globalBans} global gesperrte Personen. `;
  }

  if (clusterStats.total > 0) {
    report += `Cluster-Erkennung diese Woche: ${clusterStats.total} (${clusterStats.l1} L1, ${clusterStats.l2} L2, ${clusterStats.l3} L3). `;
  }

  // Abschluss: sagt aus, was tatsächlich gemessen wurde — nicht mehr.
  if (befunde.length > 0) {
    report += `\n\nACHTUNG: ${befunde.join('; ')}. Bitte nachsehen.`;
  } else {
    report += `\n\nKeine Auffälligkeiten am System selbst: alle Hintergrundjobs laufen, ` +
      `der Baseline-Scan ist aktuell.`;
  }

  return report;
}

/**
 * Sendet den Wochenreport an ADMIN_LOG_CHAT
 */
export async function sendWeeklyReport(ctx: Context): Promise<void> {
  try {
    const report = await generateWeeklyReport(ctx);
    await sendToAdminLogChat(`[Wochenreport]\n\n${report}`, ctx, false);
    console.log('[Weekly] Wochenreport erfolgreich gesendet');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Weekly] Fehler beim Senden des Wochenreports:', errorMessage);
    throw error;
  }
}
