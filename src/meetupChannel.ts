/**
 * Online-Meetup: Ankündigung im großen GeldHelden-Kanal
 *
 * Ergänzt die bestehenden Ankündigungen in den Meetup-Gruppen (meetup.ts),
 * ohne an diesen etwas zu ändern. Im Kanal gibt es pro Termin zwei Wellen,
 * jeweils zur selben Zeit wie in den Gruppen:
 *   - 'vortag': 24 h vorher (wie die 24h-Ankündigung der Gruppen)
 *   - 'tag':     1 h vorher (wie die 1h-Erinnerung der Gruppen)
 * Jede Welle besteht aus einem Beitrag und direkt darunter einer Umfrage.
 *
 * Doppelversand: Jeder Teil (Beitrag/Umfrage) wird VOR dem Senden in
 * meetup_channel_posts beansprucht (UNIQUE event_date+kind+part). Erst wenn
 * der Versand scheitert, wird der Anspruch wieder freigegeben.
 *
 * Text ohne parse_mode: keine Markdown-/HTML-Sonderzeichen, die escaped
 * werden müssten; Umlaute gehen unverändert als UTF-8 raus.
 *
 * Maßgeblich ist die deutsche Zeit (Europe/Berlin).
 */

import { Telegraf } from 'telegraf';
import { getDatabase } from './db';

export type ChannelWave = 'vortag' | 'tag';

const TZ = 'Europe/Berlin';
const DEFAULT_CHANNEL_ID = '-1001848781746'; // @geldhelden „Geldhelden – Freiheit durch Wissen“
const DEFAULT_LINK = 'https://www.airmeet.com/e/8ca48df0-fd79-11f0-ace7-c7ef52349391';
const DEFAULT_PATTERN = '2,4 FRI 19:00';

export function isChannelAnnouncementEnabled(): boolean {
  return (process.env.MEETUP_CHANNEL_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function channelId(): string {
  return (process.env.MEETUP_CHANNEL_ID || DEFAULT_CHANNEL_ID).trim();
}

export function initMeetupChannelTable(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS meetup_channel_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      part TEXT NOT NULL,
      message_id INTEGER,
      claimed_at INTEGER NOT NULL,
      sent_at INTEGER,
      UNIQUE(chat_id, event_date, kind, part)
    )
  `);
}

// ─── Zeit ─────────────────────────────────────────────────

function partsInTz(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  return {
    year: +p.year, month: +p.month - 1, day: +p.day,
    hour: (+p.hour) % 24, minute: +p.minute,
  };
}

function dateInTz(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const naive = Date.UTC(y, m, d, hh, mm, 0);
  const p = partsInTz(new Date(naive), tz);
  const asUtc = Date.UTC(p.year, p.month, p.day, p.hour, p.minute, 0);
  return new Date(naive - (asUtc - naive));
}

const WEEKDAYS: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/** Nächster Termin (in der Zukunft) nach Pattern „2,4 FRI 19:00“, deutsche Zeit */
export function nextChannelMeetupDate(pattern: string = DEFAULT_PATTERN, now: Date = new Date()): Date | null {
  const [weeksStr, wd, time] = pattern.trim().split(/\s+/);
  const dow = WEEKDAYS[(wd || '').toUpperCase()];
  const [hh, mm] = (time || '').split(':').map(n => parseInt(n, 10));
  if (dow === undefined || isNaN(hh) || isNaN(mm)) return null;
  const weeks = weeksStr.split(',').map(n => parseInt(n, 10));
  const nowTz = partsInTz(now, TZ);
  const found: Date[] = [];
  for (let off = 0; off <= 2; off++) {
    const y = nowTz.year + Math.floor((nowTz.month + off) / 12);
    const m = (nowTz.month + off) % 12;
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let count = 0;
    for (let d = 1; d <= days; d++) {
      if (new Date(Date.UTC(y, m, d)).getUTCDay() !== dow) continue;
      count++;
      if (weeks.includes(count)) {
        const dt = dateInTz(y, m, d, hh, mm, TZ);
        if (dt > now) found.push(dt);
      }
    }
  }
  found.sort((a, b) => a.getTime() - b.getTime());
  return found[0] || null;
}

function eventKey(date: Date): string {
  const p = partsInTz(date, TZ);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month + 1)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)} ${TZ}`;
}

// ─── Link/Pattern aus der bestehenden Meetup-Konfiguration ───────────

function meetupSource(): { link: string; pattern: string } {
  const env = (process.env.MEETUP_CHANNEL_LINK || '').trim();
  try {
    const row = getDatabase().prepare(`
      SELECT remo_link, schedule_pattern FROM meetup_events
      WHERE is_active = 1 AND timezone = ?
      ORDER BY CASE WHEN location = 'Berlin' THEN 0 ELSE 1 END, id
      LIMIT 1
    `).get(TZ) as { remo_link: string; schedule_pattern: string } | undefined;
    if (row) return { link: env || row.remo_link, pattern: row.schedule_pattern || DEFAULT_PATTERN };
  } catch { /* Tabelle fehlt → Standardwerte */ }
  return { link: env || DEFAULT_LINK, pattern: DEFAULT_PATTERN };
}

// ─── Texte ────────────────────────────────────────────────

export function buildChannelText(wave: ChannelWave, eventDate: Date, link: string): string {
  const weekday = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long' }).format(eventDate);
  const datum = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(eventDate);
  const uhrzeit = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(eventDate);
  const heute = wave === 'tag';
  const ABEND = heute ? 'HEUTE ABEND' : 'MORGEN ABEND';
  const Abend = heute ? 'Heute Abend' : 'Morgen Abend';
  const Tag = heute ? 'Heute' : 'Morgen';

  return [
    `🔥 ${ABEND}, ${uhrzeit} Uhr: Das große GeldHelden Online-Meetup!`,
    '',
    `Stell dir vor: Hunderte Menschen, die genau wie du keine Lust mehr haben, sich von Staat, Banken und Inflation die Freiheit nehmen zu lassen. Alle in einem Raum. ${Abend}. Und du bist dabei. 🌍`,
    '',
    'Egal ob Deutschland, Österreich, Schweiz, Paraguay oder Bali, jeden 2. und 4. Freitag im Monat kommen alle GeldHelden zusammen.',
    '',
    'Was dich erwartet:',
    '🤝 Echte Kontakte zu Gleichgesinnten statt Smalltalk',
    '💬 Erfahrungen aus erster Hand: Auswandern, Zweitpass, Konten, Krypto, Vermögensschutz',
    '💡 Ideen und Tipps, die du in keinem Video findest',
    '⚡ Die Energie einer Community, die nicht jammert, sondern handelt',
    '',
    'Kein Vortrag, kein Verkauf, sondern Austausch auf Augenhöhe. Mach\'s dir gemütlich, schnapp dir ein Getränk und komm rein.',
    '',
    `👉 Hier geht's rein (Link gilt dauerhaft, gleich speichern!): ${link}`,
    '',
    `⏰ ${Tag}, ${weekday}, ${datum}, um ${uhrzeit} Uhr`,
    '',
    'Wer ist dabei? Stimm unten ab! 👇',
  ].join('\n');
}

export function buildChannelPoll(wave: ChannelWave, eventDate: Date): { question: string; options: string[] } {
  const uhrzeit = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(eventDate);
  const heute = wave === 'tag';
  return {
    question: `Bist du ${heute ? 'heute' : 'morgen'} Abend um ${uhrzeit} Uhr beim Online-Meetup dabei?`,
    options: [
      '🙋 Klar, ich bin dabei!',
      '⏰ Ich versuch\'s, komme evtl. später',
      `👀 ${heute ? 'Heute' : 'Morgen'} nicht, aber beim nächsten Mal`,
      '🆕 Ich war noch nie dabei – wie läuft das ab?',
    ],
  };
}

// ─── Versand mit Anspruch ─────────────────────────────────

function claim(chatId: string, key: string, wave: ChannelWave, part: string): boolean {
  const r = getDatabase().prepare(`
    INSERT OR IGNORE INTO meetup_channel_posts (chat_id, event_date, kind, part, claimed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, key, wave, part, Date.now());
  return r.changes === 1;
}

function confirm(chatId: string, key: string, wave: ChannelWave, part: string, messageId: number): void {
  getDatabase().prepare(`
    UPDATE meetup_channel_posts SET message_id = ?, sent_at = ?
    WHERE chat_id = ? AND event_date = ? AND kind = ? AND part = ?
  `).run(messageId, Date.now(), chatId, key, wave, part);
}

function release(chatId: string, key: string, wave: ChannelWave, part: string): void {
  getDatabase().prepare(`
    DELETE FROM meetup_channel_posts
    WHERE chat_id = ? AND event_date = ? AND kind = ? AND part = ? AND message_id IS NULL
  `).run(chatId, key, wave, part);
}

export interface ChannelSendResult {
  event: string;
  wave: ChannelWave;
  textMessageId?: number;
  pollMessageId?: number;
  pollAnonymous?: boolean;
  skipped?: string[];
  errors?: string[];
}

export async function sendChannelAnnouncement(bot: Telegraf, wave: ChannelWave, eventDate?: Date): Promise<ChannelSendResult> {
  initMeetupChannelTable();
  const chatId = channelId();
  const src = meetupSource();
  const date = eventDate || nextChannelMeetupDate(src.pattern);
  if (!date) throw new Error('Kein nächster Meetup-Termin ermittelbar');
  const key = eventKey(date);
  const res: ChannelSendResult = { event: key, wave, skipped: [], errors: [] };

  // 1) Beitrag
  if (!claim(chatId, key, wave, 'text')) {
    res.skipped!.push('text');
  } else {
    try {
      const msg = await bot.telegram.sendMessage(chatId, buildChannelText(wave, date, src.link), {
        link_preview_options: { is_disabled: false },
      } as any);
      confirm(chatId, key, wave, 'text', msg.message_id);
      res.textMessageId = msg.message_id;
      console.log(`[MEETUP-KANAL] ${wave}-Beitrag gesendet: ${chatId} #${msg.message_id} (${key})`);
    } catch (e: any) {
      release(chatId, key, wave, 'text');
      res.errors!.push(`text: ${e?.message || e}`);
      console.error(`[MEETUP-KANAL] Beitrag fehlgeschlagen (${key}):`, e?.message || e);
      return res; // ohne Beitrag keine Umfrage
    }
  }

  // 2) Umfrage direkt darunter
  if (!claim(chatId, key, wave, 'poll')) {
    res.skipped!.push('poll');
  } else {
    const { question, options } = buildChannelPoll(wave, date);
    try {
      let msg: any;
      try {
        msg = await bot.telegram.sendPoll(chatId, question, options, { is_anonymous: false, allows_multiple_answers: false } as any);
        res.pollAnonymous = false;
      } catch (e: any) {
        // Telegram erlaubt in Kanälen keine öffentlichen (nicht-anonymen) Umfragen
        if (/non-anonymous|anonymous/i.test(String(e?.message || ''))) {
          console.warn('[MEETUP-KANAL] Öffentliche Umfrage im Kanal abgelehnt, sende anonym:', e?.message);
          msg = await bot.telegram.sendPoll(chatId, question, options, { is_anonymous: true, allows_multiple_answers: false } as any);
          res.pollAnonymous = true;
        } else {
          throw e;
        }
      }
      confirm(chatId, key, wave, 'poll', msg.message_id);
      res.pollMessageId = msg.message_id;
      console.log(`[MEETUP-KANAL] ${wave}-Umfrage gesendet: ${chatId} #${msg.message_id} (${key})`);
    } catch (e: any) {
      release(chatId, key, wave, 'poll');
      res.errors!.push(`poll: ${e?.message || e}`);
      console.error(`[MEETUP-KANAL] Umfrage fehlgeschlagen (${key}):`, e?.message || e);
    }
  }
  return res;
}

/**
 * Vom Gruppen-Scheduler (alle 30 Min) aufgerufen. Gleiche Fenster wie die
 * Gruppen: 23,5–24,5 h vorher → 'vortag', 0,5–1,5 h vorher → 'tag'.
 * Fehler hier dürfen den Gruppenablauf nie stören.
 */
export async function checkChannelAnnouncement(bot: Telegraf, now: Date = new Date()): Promise<void> {
  if (!isChannelAnnouncementEnabled()) return;
  try {
    initMeetupChannelTable();
    const date = nextChannelMeetupDate(meetupSource().pattern, now);
    if (!date) return;
    const h = (date.getTime() - now.getTime()) / 3_600_000;
    let wave: ChannelWave | null = null;
    if (h >= 23.5 && h <= 24.5) wave = 'vortag';
    else if (h >= 0.5 && h <= 1.5) wave = 'tag';
    if (!wave) return;
    const r = await sendChannelAnnouncement(bot, wave, date);
    if (r.skipped?.length) console.log(`[MEETUP-KANAL] ${wave} ${r.event}: bereits gesendet – ${r.skipped.join(', ')}`);
  } catch (e: any) {
    console.error('[MEETUP-KANAL] Prüfung fehlgeschlagen:', e?.message || e);
  }
}
