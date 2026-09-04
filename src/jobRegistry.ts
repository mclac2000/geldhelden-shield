/**
 * jobRegistry.ts — Nachweis, dass die erwarteten Hintergrundjobs wirklich laufen
 *
 * HINTERGRUND
 * Bis 09/2026 standen der Wochenbericht-Cron und der monatliche Baseline-Scan
 * hinter `await bot.launch()`. Dieser Aufruf löst im Long-Polling nicht auf —
 * beide Jobs wurden acht Monate lang **nie registriert**, ohne dass es auffiel.
 * Das System sah aus, als liefe es.
 *
 * Der statische Test (scripts/test-startup-order.ts) fängt genau diese Ursache.
 * Dieses Modul fängt die Wirkung, unabhängig von der Ursache: Es vergleicht die
 * tatsächlich registrierten Jobs mit einer Soll-Liste und meldet Fehlendes
 * lautstark — im Log und im Admin-Chat.
 *
 * Verwendung: statt `cron.schedule(...)` einfach `registerCron(name, ...)`.
 */

import cron from 'node-cron';

export interface RegisteredJob {
  name: string;
  expression: string;
  registeredAt: number;
}

const registered = new Map<string, RegisteredJob>();

/**
 * Diese Jobs MÜSSEN nach einem vollständigen Start registriert sein.
 * Wer hier einen Job einträgt, bekommt eine Meldung, sobald er fehlt.
 */
export const ERWARTETE_JOBS: Record<string, string> = {
  'wartung': 'Risk-Decay und Auto-Unrestrict (stündlich)',
  'cluster-erkennung': 'Cluster-Scan (alle 10 Minuten)',
  'geloeschte-konten': 'Bereinigung gelöschter Konten (täglich 03:00)',
  'eigene-links': 'Freigabeliste eigener Gruppen-Links (täglich 03:30)',
  'wochenbericht': 'Wochenbericht an den Admin-Chat (sonntags 20:00)',
  'baseline-scan': 'Mitglieder-Baseline auffrischen (monatlich am 1.)',
};

/**
 * Registriert einen Cron-Job und merkt sich, dass es geschehen ist.
 * Signatur bewusst wie cron.schedule, nur mit einem Namen davor.
 */
export function registerCron(
  name: string,
  expression: string,
  handler: () => void | Promise<void>,
  options?: any
): void {
  if (registered.has(name)) {
    console.warn(`[JOBS] Job "${name}" wird ein zweites Mal registriert — vermutlich ein Versehen.`);
  }
  cron.schedule(expression, handler, options);
  registered.set(name, { name, expression, registeredAt: Date.now() });
  console.log(`[JOBS] registriert: ${name} (${expression})`);
}

/** Merkt einen Job vor, der außerhalb dieses Moduls per cron.schedule läuft */
export function markJobRegistered(name: string, expression: string): void {
  registered.set(name, { name, expression, registeredAt: Date.now() });
}

export function getRegisteredJobs(): RegisteredJob[] {
  return Array.from(registered.values());
}

export interface JobPruefung {
  ok: boolean;
  fehlend: string[];
  vorhanden: string[];
}

export function pruefeJobs(): JobPruefung {
  const fehlend = Object.keys(ERWARTETE_JOBS).filter(n => !registered.has(n));
  return {
    ok: fehlend.length === 0,
    fehlend,
    vorhanden: Array.from(registered.keys()),
  };
}

/**
 * Prüft die Job-Liste und meldet Fehlendes.
 *
 * Wird verzögert nach dem Start aufgerufen — der Timer läuft auch dann, wenn
 * bot.launch() nicht auflöst. Genau deshalb greift diese Prüfung auch in dem
 * Fall, der sie nötig gemacht hat.
 */
export async function pruefeUndMelde(telegram: any, adminLogChat: string): Promise<JobPruefung> {
  const p = pruefeJobs();

  if (p.ok) {
    console.log(`[JOBS] ✅ Alle ${p.vorhanden.length} erwarteten Hintergrundjobs sind registriert.`);
    return p;
  }

  const liste = p.fehlend.map(n => `• ${n} — ${ERWARTETE_JOBS[n]}`).join('\n');
  console.error('[JOBS] ❌ FEHLENDE HINTERGRUNDJOBS:\n' + liste);
  console.error('[JOBS] Häufigste Ursache: der Registrierungscode steht hinter bot.launch().');

  try {
    await telegram.sendMessage(
      adminLogChat,
      `⚠️ <b>Hintergrundjobs fehlen</b>\n\n` +
        `Beim Start wurden ${p.fehlend.length} von ${Object.keys(ERWARTETE_JOBS).length} ` +
        `erwarteten Jobs NICHT registriert:\n\n` +
        liste.replace(/</g, '&lt;') +
        `\n\nDiese Aufgaben laufen nicht. Häufigste Ursache: der Code steht hinter ` +
        `<code>bot.launch()</code> und wird deshalb nie erreicht.`,
      { parse_mode: 'HTML' }
    );
  } catch (e: any) {
    console.error('[JOBS] Meldung konnte nicht gesendet werden:', e.message);
  }

  return p;
}
