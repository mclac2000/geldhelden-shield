/**
 * test-admin-log-429.ts -- 429 im Admin-Chat wird abgefangen und wiederholt (20.10.2026)
 *
 * Aufruf:  npm run test:adminlog429
 *
 * Vorher: Die AdminLogQueue gab 429 als Ablehnung an den Aufrufer zurück, der
 * chat_member-Handler meldete daraufhin "[Shield][ERROR] chat_member error: 429 ..."
 * erneut an den Admin-Chat -- eine Meldung je Sekunde. Dieser Test baut einen
 * Telegram-Ersatz, der zweimal 429 (retry_after 1) und dann ok liefert, und prüft:
 *   1. sendToAdminLogChat löst auf (keine Ablehnung beim Aufrufer),
 *   2. die Nachricht wird genau einmal zugestellt, nach 3 Versuchen,
 *   3. zwischen den Versuchen wurde mindestens retry_after gewartet.
 * Kein Netz, keine Datenbank.
 */
process.env.BOT_TOKEN = process.env.BOT_TOKEN || '123456:testtoken-nicht-echt';
process.env.ADMIN_LOG_CHAT = process.env.ADMIN_LOG_CHAT || '-100123';
process.env.ADMIN_IDS = process.env.ADMIN_IDS || '1';

import { sendToAdminLogChat } from '../src/telegram';

async function main(): Promise<void> {
  const zeiten: number[] = [];
  let zugestellt = 0;
  const telegram = {
    sendMessage: async () => {
      zeiten.push(Date.now());
      if (zeiten.length <= 2) {
        const e: any = new Error('429: Too Many Requests: retry after 1');
        e.response = { error_code: 429, parameters: { retry_after: 1 } };
        throw e;
      }
      zugestellt++;
    },
  };
  let abgelehnt = false;
  await sendToAdminLogChat('Probe', { telegram } as any).catch(() => { abgelehnt = true; });
  const fehler: string[] = [];
  if (abgelehnt) fehler.push('Aufrufer bekam eine Ablehnung (429 nicht abgefangen)');
  if (zugestellt !== 1) fehler.push(`zugestellt=${zugestellt}, erwartet 1`);
  if (zeiten.length !== 3) fehler.push(`Versuche=${zeiten.length}, erwartet 3`);
  if (zeiten.length >= 2 && zeiten[1] - zeiten[0] < 1000) fehler.push(`retry_after nicht eingehalten (${zeiten[1] - zeiten[0]} ms)`);
  if (fehler.length) {
    console.log('ROT: ' + fehler.join('; '));
    process.exit(1);
  }
  console.log(`GRÜN: 2x 429 abgefangen, nach ${zeiten[2] - zeiten[0]} ms einmal zugestellt, Aufrufer ohne Fehler`);
  process.exit(0);
}

main();
