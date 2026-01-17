/**
 * Log Health Service – Telegram Sender
 *
 * Sendet Health-Reports an Telegram.
 * Fail-safe, separater Bot-Token.
 */

import * as https from 'https';
import { config } from './config';

/**
 * Ergebnis eines Telegram-Sendevorgangs
 */
export interface SendResult {
  success: boolean;
  messageId: number | null;
  error: string | null;
}

/**
 * Telegram Bot API URL
 */
function getApiUrl(method: string): string {
  return `https://api.telegram.org/bot${config.monitorBotToken}/${method}`;
}

/**
 * Führt einen HTTP POST Request aus
 */
function post(url: string, data: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);

    const urlObj = new URL(url);
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Sendet eine Nachricht an den konfigurierten Admin-Chat
 *
 * @param text - Nachrichtentext (Markdown)
 * @returns SendResult
 */
export async function sendMessage(text: string): Promise<SendResult> {
  console.log(`[TELEGRAM] Sende Report an Chat ${config.adminLogChat}...`);

  try {
    const response = await post(getApiUrl('sendMessage'), {
      chat_id: config.adminLogChat,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    if (response.ok === true) {
      const messageId = response.result?.message_id ?? null;
      console.log(`[TELEGRAM] Report gesendet (message_id: ${messageId})`);
      return {
        success: true,
        messageId,
        error: null,
      };
    }

    const errorDesc = response.description || 'Unknown error';
    console.error(`[TELEGRAM][ERROR] API Fehler: ${errorDesc}`);
    return {
      success: false,
      messageId: null,
      error: errorDesc,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[TELEGRAM][ERROR] ${errorMessage}`);
    return {
      success: false,
      messageId: null,
      error: errorMessage,
    };
  }
}

/**
 * Sendet einen langen Text in mehreren Nachrichten (falls > 4096 Zeichen)
 *
 * @param text - Vollständiger Text
 * @returns Array von SendResults
 */
export async function sendLongMessage(text: string): Promise<SendResult[]> {
  const MAX_LENGTH = 4000; // Etwas Buffer unter Telegram-Limit
  const results: SendResult[] = [];

  if (text.length <= MAX_LENGTH) {
    const result = await sendMessage(text);
    return [result];
  }

  // Teile an sinnvollen Stellen (Zeilenumbrüche)
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > MAX_LENGTH) {
      // Sende aktuellen Chunk
      const result = await sendMessage(currentChunk);
      results.push(result);

      // Warte kurz um Rate-Limits zu vermeiden
      await new Promise((resolve) => setTimeout(resolve, 500));

      currentChunk = line;
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    }
  }

  // Letzten Chunk senden
  if (currentChunk.trim().length > 0) {
    const result = await sendMessage(currentChunk);
    results.push(result);
  }

  return results;
}

/**
 * Prüft ob der Bot-Token gültig ist
 *
 * @returns true wenn gültig, false sonst
 */
export async function validateBotToken(): Promise<boolean> {
  try {
    const response = await post(getApiUrl('getMe'), {});
    if (response.ok === true) {
      const botName = response.result?.username || 'Unknown';
      console.log(`[TELEGRAM] Bot validiert: @${botName}`);
      return true;
    }
    console.error('[TELEGRAM][ERROR] Bot-Token ungültig');
    return false;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[TELEGRAM][ERROR] Token-Validierung fehlgeschlagen: ${errorMessage}`);
    return false;
  }
}
