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
 *
 * Nachtruhe (seit 09.10.2026, Anweisung Marco): Zwischen 22:00 und 07:00
 * deutscher Zeit geht NIE ein Kanal-Post raus – weder per Scheduler noch per
 * CLI. Fällt ein regulärer Lauf in dieses Fenster, wird er in
 * meetup_channel_deferred auf 08:00 verschoben (nur solange das Meetup dann
 * noch bevorsteht). „Heute/Morgen“ im Text richtet sich nach dem
 * tatsächlichen Sendetag.
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
    CREATE TABLE IF NOT EXISTS meetup_channel_deferred (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      deferred_to INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(chat_id, event_date, kind)
    )
  `);
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

const QUIET_FROM = 22; // ab 22:00
const QUIET_TO = 7;    // bis 07:00
const DEFER_HOUR = 8;  // verschoben auf 08:00

/** true zwischen 22:00 und 07:00 deutscher Zeit */
export function isQuietHours(date: Date): boolean {
  const h = partsInTz(date, TZ).hour;
  return h >= QUIET_FROM || h < QUIET_TO;
}

/** Nächstes 08:00 deutscher Zeit nach einem Zeitpunkt in der Nachtruhe */
export function nextDeferTime(date: Date): Date {
  const p = partsInTz(date, TZ);
  const base = dateInTz(p.year, p.month, p.day, DEFER_HOUR, 0, TZ);
  if (p.hour >= QUIET_FROM) {
    const next = new Date(base.getTime() + 36 * 3_600_000); // sicher im Folgetag
    const q = partsInTz(next, TZ);
    return dateInTz(q.year, q.month, q.day, DEFER_HOUR, 0, TZ);
  }
  return base;
}

function berlinDayIndex(date: Date): number {
  const p = partsInTz(date, TZ);
  return Math.round(Date.UTC(p.year, p.month, p.day) / 86_400_000);
}

/** 'heute' | 'morgen' | 'am Freitag' – bezogen auf den tatsächlichen Sendezeitpunkt */
function dayRelation(sendAt: Date, eventDate: Date): { rel: 'heute' | 'morgen' | 'andere'; weekday: string } {
  const weekday = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long' }).format(eventDate);
  const diff = berlinDayIndex(eventDate) - berlinDayIndex(sendAt);
  return { rel: diff === 0 ? 'heute' : diff === 1 ? 'morgen' : 'andere', weekday };
}

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
  const envPattern = (process.env.MEETUP_CHANNEL_PATTERN || '').trim();
  if (envPattern) return { link: env || DEFAULT_LINK, pattern: envPattern };
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

export function buildChannelText(wave: ChannelWave, eventDate: Date, link: string, sendAt: Date = new Date()): string {
  const { rel, weekday } = dayRelation(sendAt, eventDate);
  const datum = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(eventDate);
  const uhrzeit = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(eventDate);
  const ABEND = rel === 'heute' ? 'HEUTE ABEND' : rel === 'morgen' ? 'MORGEN ABEND' : `AM ${weekday.toUpperCase()}`;
  const Abend = rel === 'heute' ? 'Heute Abend' : rel === 'morgen' ? 'Morgen Abend' : `Am ${weekday}abend`;
  const zeitZeile = rel === 'andere' ? `${weekday}` : `${rel === 'heute' ? 'Heute' : 'Morgen'}, ${weekday}`;

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
    `⏰ ${zeitZeile}, ${datum}, um ${uhrzeit} Uhr`,
    '',
    'Wer ist dabei? Stimm unten ab! 👇',
  ].join('\n');
}

export function buildChannelPoll(wave: ChannelWave, eventDate: Date, sendAt: Date = new Date()): { question: string; options: string[] } {
  const uhrzeit = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(eventDate);
  const { rel, weekday } = dayRelation(sendAt, eventDate);
  const wann = rel === 'heute' ? 'heute Abend' : rel === 'morgen' ? 'morgen Abend' : `am ${weekday}abend`;
  const nicht = rel === 'heute' ? 'Heute nicht' : rel === 'morgen' ? 'Morgen nicht' : 'Diesmal nicht';
  return {
    question: `Bist du ${wann} um ${uhrzeit} Uhr beim Online-Meetup dabei?`,
    options: [
      '🙋 Klar, ich bin dabei!',
      '⏰ Ich versuch\'s, komme evtl. später',
      `👀 ${nicht}, aber beim nächsten Mal`,
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

export async function sendChannelAnnouncement(bot: Telegraf, wave: ChannelWave, eventDate?: Date, now: Date = new Date()): Promise<ChannelSendResult> {
  initMeetupChannelTable();
  if (isQuietHours(now)) {
    // harte Sperre, gilt auch für den manuellen Aufruf
    throw new Error('Nachtruhe 22:00–07:00 (deutsche Zeit): kein Kanal-Post');
  }
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
      const msg = await bot.telegram.sendMessage(chatId, buildChannelText(wave, date, src.link, now), {
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
    const { question, options } = buildChannelPoll(wave, date, now);
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

function alreadySent(chatId: string, key: string, wave: ChannelWave): boolean {
  return !!getDatabase().prepare(`
    SELECT 1 FROM meetup_channel_posts WHERE chat_id = ? AND event_date = ? AND kind = ? AND part = 'text' AND message_id IS NOT NULL
  `).get(chatId, key, wave);
}

function getDeferred(chatId: string, key: string, wave: ChannelWave): number | null {
  const r = getDatabase().prepare(`
    SELECT deferred_to FROM meetup_channel_deferred WHERE chat_id = ? AND event_date = ? AND kind = ?
  `).get(chatId, key, wave) as { deferred_to: number } | undefined;
  return r ? r.deferred_to : null;
}

function setDeferred(chatId: string, key: string, wave: ChannelWave, due: Date, to: Date): void {
  getDatabase().prepare(`
    INSERT OR IGNORE INTO meetup_channel_deferred (chat_id, event_date, kind, due_at, deferred_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(chatId, key, wave, due.getTime(), to.getTime(), Date.now());
}

const WAVE_OFFSET_H: Record<ChannelWave, number> = { vortag: 24, tag: 1 };

export interface PlannedAction { wave: ChannelWave; action: 'send' | 'defer' | 'drop'; at: Date; event: string; until?: Date; }

/**
 * Entscheidet für einen Zeitpunkt, was zu tun ist (ohne zu senden).
 * Reguläre Fenster wie bei den Gruppen: Fälligkeit ±30 Min
 * (24 h bzw. 1 h vor dem Meetup). In der Nachtruhe → auf 08:00 verschieben.
 */
export function planChannelActions(now: Date, onlyDeferred = false): PlannedAction[] {
  initMeetupChannelTable();
  const chatId = channelId();
  const date = nextChannelMeetupDate(meetupSource().pattern, now);
  if (!date) return [];
  const key = eventKey(date);
  const out: PlannedAction[] = [];
  for (const wave of ['vortag', 'tag'] as ChannelWave[]) {
    if (alreadySent(chatId, key, wave)) continue;
    const deferredTo = getDeferred(chatId, key, wave);
    if (deferredTo !== null) {
      if (deferredTo >= date.getTime()) continue; // Verschiebung läge nach dem Meetup → entfällt
      if (now.getTime() >= deferredTo && !isQuietHours(now)) out.push({ wave, action: 'send', at: now, event: key });
      continue;
    }
    if (onlyDeferred) continue;
    const due = new Date(date.getTime() - WAVE_OFFSET_H[wave] * 3_600_000);
    if (Math.abs(now.getTime() - due.getTime()) > 30 * 60_000) continue;
    if (isQuietHours(now)) {
      const to = nextDeferTime(now);
      out.push({ wave, action: to.getTime() < date.getTime() ? 'defer' : 'drop', at: now, event: key, until: to });
    } else {
      out.push({ wave, action: 'send', at: now, event: key });
    }
  }
  return out;
}

let deferredTimer: NodeJS.Timeout | null = null;

async function runChannelCheck(bot: Telegraf, now: Date, onlyDeferred: boolean): Promise<void> {
  if (!isChannelAnnouncementEnabled()) return;
  try {
    const chatId = channelId();
    for (const a of planChannelActions(now, onlyDeferred)) {
      if (a.action === 'send') {
        const date = nextChannelMeetupDate(meetupSource().pattern, now)!;
        const r = await sendChannelAnnouncement(bot, a.wave, date, now);
        if (r.skipped?.length) console.log(`[MEETUP-KANAL] ${a.wave} ${r.event}: bereits gesendet – ${r.skipped.join(', ')}`);
      } else {
        const date = nextChannelMeetupDate(meetupSource().pattern, now)!;
        const due = new Date(date.getTime() - WAVE_OFFSET_H[a.wave] * 3_600_000);
        setDeferred(chatId, a.event, a.wave, due, a.until!);
        console.log(`[MEETUP-KANAL] ${a.wave} ${a.event}: Nachtruhe – ${a.action === 'defer' ? 'verschoben auf ' + a.until!.toISOString() : 'entfällt (08:00 wäre nach dem Meetup)'}`);
      }
    }
  } catch (e: any) {
    console.error('[MEETUP-KANAL] Prüfung fehlgeschlagen:', e?.message || e);
  }
}

/**
 * Vom Gruppen-Scheduler (alle 30 Min) aufgerufen – gleiche Zeitpunkte wie die
 * Gruppen. Zusätzlich prüft ein 1-Minuten-Takt nur verschobene Posts, damit
 * sie pünktlich um 08:00 rausgehen. Fehler hier stören den Gruppenablauf nie.
 */
export async function checkChannelAnnouncement(bot: Telegraf, now: Date = new Date()): Promise<void> {
  if (!deferredTimer) {
    deferredTimer = setInterval(() => { runChannelCheck(bot, new Date(), true); }, 60_000);
  }
  await runChannelCheck(bot, now, false);
}

/** Für Tests/Trockenlauf: ein Lauf ohne Timer */
export async function runChannelCheckOnce(bot: Telegraf, now: Date, onlyDeferred = false): Promise<void> {
  await runChannelCheck(bot, now, onlyDeferred);
}
