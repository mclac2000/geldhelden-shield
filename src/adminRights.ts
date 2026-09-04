/**
 * adminRights.ts — Prüft, ob der Bot in den verwalteten Gruppen Admin ist
 *
 * HINTERGRUND
 * Eine Gruppe mit `status = 'managed'`, in der der Bot **kein Admin** ist, ist
 * gefährlicher als eine, die gar nicht in der Liste steht: Sie erscheint in
 * jeder Übersicht als geschützt, obwohl der Bot dort weder sperren noch
 * Nachrichten löschen kann. Der Schutz ist dort eine Behauptung.
 *
 * Bis 09/2026 fiel so etwas nur beiläufig auf — als eine Zeile im Scan-Log
 * ("Bot ist kein Admin in ..., überspringe"), die niemand las.
 *
 * Diese Prüfung schreibt den Status dauerhaft in die Datenbank, damit er in
 * /groups, /health und im Wochenbericht als eigene Kategorie erscheint.
 */

import { config } from './config';

export interface AdminRechtePruefung {
  geprueft: number;
  admin: number;
  keinAdmin: number;
  fehler: number;
  ohneRechte: Array<{ chatId: string; title: string | null; status: string }>;
}

/**
 * Prüft alle verwalteten Gruppen und speichert den Rechte-Status.
 *
 * @param meldeAnAdmin true = bei fehlenden Rechten eine Meldung in den Admin-Chat
 */
export async function pruefeAdminRechte(
  telegram: any,
  meldeAnAdmin = true
): Promise<AdminRechtePruefung> {
  const { getManagedGroups, setBotAdminStatus, getGroupTitle } = await import('./db');

  const gruppen = getManagedGroups();
  const ergebnis: AdminRechtePruefung = {
    geprueft: 0, admin: 0, keinAdmin: 0, fehler: 0, ohneRechte: [],
  };

  let botId: number;
  try {
    botId = (await telegram.getMe()).id;
  } catch (error: any) {
    console.error('[AdminRechte] Bot-ID nicht ermittelbar:', error.message);
    return ergebnis;
  }

  for (const g of gruppen) {
    const chatId = String((g as any).chat_id ?? (g as any).chatId);
    try {
      const mitglied = await telegram.getChatMember(chatId, botId);
      const status = String(mitglied?.status || '');
      const istAdmin = status === 'administrator' || status === 'creator';

      setBotAdminStatus(chatId, istAdmin);
      ergebnis.geprueft++;

      if (istAdmin) {
        ergebnis.admin++;
      } else {
        ergebnis.keinAdmin++;
        ergebnis.ohneRechte.push({ chatId, title: getGroupTitle(chatId), status });
        console.log(`[AdminRechte] KEIN ADMIN in ${chatId} (${getGroupTitle(chatId) || '?'}) — Status: ${status}`);
      }
    } catch (error: any) {
      // Fehler NICHT als "kein Admin" werten — ein vorübergehender API-Fehler
      // darf keine Gruppe fälschlich als ungeschützt markieren.
      ergebnis.fehler++;
      console.log(`[AdminRechte] Prüfung fehlgeschlagen für ${chatId}: ${error.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(
    `[AdminRechte] Abgeschlossen: ${ergebnis.geprueft} geprüft, ` +
    `${ergebnis.admin} mit Rechten, ${ergebnis.keinAdmin} OHNE Rechte, ${ergebnis.fehler} Fehler`
  );

  if (meldeAnAdmin && ergebnis.keinAdmin > 0) {
    const liste = ergebnis.ohneRechte
      .map(g => `• ${(g.title || g.chatId).replace(/</g, '&lt;')} (<code>${g.chatId}</code>, Status: ${g.status})`)
      .join('\n');
    try {
      await telegram.sendMessage(
        config.adminLogChat,
        `⚠️ <b>Gruppen ohne Adminrechte</b>\n\n` +
          `In ${ergebnis.keinAdmin} von ${ergebnis.geprueft} verwalteten Gruppen ist der Bot kein Admin. ` +
          `Dort kann er <b>weder sperren noch löschen</b> — der Schutz greift faktisch nicht, ` +
          `die Gruppen erscheinen aber überall als geschützt.\n\n${liste}\n\n` +
          `<i>Entweder dem Bot dort Adminrechte geben, oder die Gruppe mit /group disable aus der Liste nehmen.</i>`,
        { parse_mode: 'HTML' }
      );
    } catch (e: any) {
      console.error('[AdminRechte] Meldung fehlgeschlagen:', e.message);
    }
  }

  return ergebnis;
}
