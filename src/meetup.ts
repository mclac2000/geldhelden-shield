/**
 * Online Meetup Feature
 *
 * Ermöglicht zentral gesteuerte, wiederkehrende Online-Meetups über Remo.
 *
 * Features:
 * - Pro Standort ein fester Meetup-Link
 * - Automatische Ankündigungen nach Zeitplan
 * - /online_meetup Befehl für User
 * - Admin-Konfiguration
 * - Zeitzonen-Unterstützung pro Gruppe
 */

import { Telegraf, Context } from 'telegraf';
import { getDatabase } from './db';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

export interface MeetupEvent {
  id: number;
  location: string;
  remo_link: string;
  schedule_pattern: string;
  timezone: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface MeetupGroupMapping {
  chat_id: string;
  location: string;
}

// ═══════════════════════════════════════════════════════════
// DATABASE FUNCTIONS
// ═══════════════════════════════════════════════════════════

export function initMeetupTables(): void {
  const db = getDatabase();

  db.exec(`
    CREATE TABLE IF NOT EXISTS meetup_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL UNIQUE,
      remo_link TEXT NOT NULL,
      schedule_pattern TEXT NOT NULL DEFAULT '2,4 FRI 19:00',
      timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meetup_group_mapping (
      chat_id TEXT PRIMARY KEY,
      location TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meetup_announcements_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL,
      event_date TEXT NOT NULL,
      announcement_type TEXT NOT NULL CHECK(announcement_type IN ('24h', '1h')),
      sent_at INTEGER NOT NULL,
      UNIQUE(location, event_date, announcement_type)
    )
  `);

  console.log('[MEETUP] Tabellen initialisiert');
}

export function upsertMeetupEvent(
  location: string,
  remoLink: string,
  schedulePattern: string = '2,4 FRI 19:00',
  timezone: string = 'Europe/Berlin'
): void {
  const db = getDatabase();
  const now = Date.now();

  db.prepare(`
    INSERT INTO meetup_events (location, remo_link, schedule_pattern, timezone, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(location) DO UPDATE SET
      remo_link = excluded.remo_link,
      schedule_pattern = excluded.schedule_pattern,
      timezone = excluded.timezone,
      updated_at = excluded.updated_at
  `).run(location, remoLink, schedulePattern, timezone, now, now);

  console.log(`[MEETUP] Event erstellt/aktualisiert: ${location}`);
}

export function getMeetupEvent(location: string): MeetupEvent | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM meetup_events WHERE location = ? AND is_active = 1
  `).get(location) as MeetupEvent | undefined;
  return row || null;
}

export function getAllMeetupEvents(): MeetupEvent[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM meetup_events WHERE is_active = 1 ORDER BY location
  `).all() as MeetupEvent[];
}

export function deactivateMeetupEvent(location: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE meetup_events SET is_active = 0, updated_at = ? WHERE location = ?
  `).run(Date.now(), location);
}

export function setGroupMeetupLocation(chatId: string, location: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO meetup_group_mapping (chat_id, location)
    VALUES (?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET location = excluded.location
  `).run(chatId, location);

  console.log(`[MEETUP] Gruppe ${chatId} → Standort ${location}`);
}

export function getGroupMeetupLocation(chatId: string): string | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT location FROM meetup_group_mapping WHERE chat_id = ?
  `).get(chatId) as { location: string } | undefined;
  return row?.location || null;
}

export function getGroupsForMeetupLocation(location: string): string[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT chat_id FROM meetup_group_mapping WHERE location = ?
  `).all(location) as { chat_id: string }[];
  return rows.map(r => r.chat_id);
}

export function removeGroupMeetupLocation(chatId: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM meetup_group_mapping WHERE chat_id = ?`).run(chatId);
}

/**
 * Prüft ob eine Ankündigung für dieses Event+Datum+Typ bereits gesendet wurde
 */
function wasAnnouncementAlreadySent(location: string, eventDate: Date, type: '24h' | '1h'): boolean {
  const db = getDatabase();
  const dateKey = eventDate.toISOString().split('T')[0] + 'T' + eventDate.toISOString().split('T')[1].substring(0, 5);
  const row = db.prepare(`
    SELECT id FROM meetup_announcements_sent WHERE location = ? AND event_date = ? AND announcement_type = ?
  `).get(location, dateKey, type);
  return !!row;
}

/**
 * Markiert eine Ankündigung als gesendet
 */
function markAnnouncementSent(location: string, eventDate: Date, type: '24h' | '1h'): void {
  const db = getDatabase();
  const dateKey = eventDate.toISOString().split('T')[0] + 'T' + eventDate.toISOString().split('T')[1].substring(0, 5);
  db.prepare(`
    INSERT OR IGNORE INTO meetup_announcements_sent (location, event_date, announcement_type, sent_at)
    VALUES (?, ?, ?, ?)
  `).run(location, dateKey, type, Date.now());
  console.log(`[MEETUP] Ankündigung als gesendet markiert: ${location} ${dateKey} ${type}`);
}

// ═══════════════════════════════════════════════════════════
// TIMEZONE HELPERS
// ═══════════════════════════════════════════════════════════

function getTimeInTimezone(date: Date, timezone: string): { hours: number; minutes: number; dayOfWeek: number; dayOfMonth: number; month: number; year: number } {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour12: false
  };
  
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);
  
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  const weekdayMap: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  
  return {
    hours: parseInt(getPart('hour'), 10),
    minutes: parseInt(getPart('minute'), 10),
    dayOfWeek: weekdayMap[getPart('weekday')] || 0,
    dayOfMonth: parseInt(getPart('day'), 10),
    month: parseInt(getPart('month'), 10) - 1,
    year: parseInt(getPart('year'), 10)
  };
}

function createDateInTimezone(year: number, month: number, day: number, hours: number, minutes: number, timezone: string): Date {
  // Erstelle ein naives UTC-Datum mit den gewünschten Werten
  const naiveUtc = Date.UTC(year, month, day, hours, minutes, 0);
  
  // Formatiere dieses UTC-Datum in der Zielzeitzone um den Offset zu ermitteln
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric', 
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  
  const parts = formatter.formatToParts(new Date(naiveUtc));
  const getPart = (type: string): number => parseInt(parts.find(p => p.type === type)?.value || '0');
  
  const tzYear = getPart('year');
  const tzMonth = getPart('month') - 1;
  const tzDay = getPart('day');
  let tzHour = getPart('hour');
  if (tzHour === 24) tzHour = 0; // Mitternacht-Korrektur
  const tzMinute = getPart('minute');
  
  // Was das naive UTC in der Zielzeitzone ergibt (als UTC-Timestamp)
  const inTzAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, 0);
  
  // Der Offset ist die Differenz
  const offset = inTzAsUtc - naiveUtc;
  
  // Das gewünschte Datum: naive minus Offset
  return new Date(naiveUtc - offset);
}

// ═══════════════════════════════════════════════════════════
// SCHEDULE PARSING
// ═══════════════════════════════════════════════════════════

const WEEKDAYS: Record<string, number> = {
  'SUN': 0, 'MON': 1, 'TUE': 2, 'WED': 3, 'THU': 4, 'FRI': 5, 'SAT': 6
};

function getNthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, n: number): number | null {
  let count = 0;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    if (date.getDay() === dayOfWeek) {
      count++;
      if (count === n) {
        return day;
      }
    }
  }

  return null;
}

export function parseSchedulePattern(pattern: string, timezone: string = 'Europe/Berlin'): Date[] {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 3) {
    console.warn(`[MEETUP] Ungültiges Pattern: ${pattern}`);
    return [];
  }

  const [weekNumbers, weekday, time] = parts;
  const weeks = weekNumbers.split(',').map(n => parseInt(n, 10));
  const dayOfWeek = WEEKDAYS[weekday.toUpperCase()];
  const [hours, minutes] = time.split(':').map(n => parseInt(n, 10));

  if (dayOfWeek === undefined || isNaN(hours) || isNaN(minutes)) {
    console.warn(`[MEETUP] Ungültiges Pattern: ${pattern}`);
    return [];
  }

  const dates: Date[] = [];
  const now = new Date();
  const nowInTz = getTimeInTimezone(now, timezone);

  for (let monthOffset = 0; monthOffset <= 1; monthOffset++) {
    const targetMonth = (nowInTz.month + monthOffset) % 12;
    const targetYear = nowInTz.year + Math.floor((nowInTz.month + monthOffset) / 12);

    for (const weekNum of weeks) {
      const day = getNthWeekdayOfMonth(targetYear, targetMonth, dayOfWeek, weekNum);

      if (day) {
        const date = createDateInTimezone(targetYear, targetMonth, day, hours, minutes, timezone);
        
        if (date > now) {
          dates.push(date);
        }
      }
    }
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

export function getNextMeetupDate(location: string): Date | null {
  const event = getMeetupEvent(location);
  if (!event) return null;

  const dates = parseSchedulePattern(event.schedule_pattern, event.timezone);
  return dates.length > 0 ? dates[0] : null;
}

export function formatMeetupDate(date: Date, timezone: string = 'Europe/Berlin'): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone
  };

  return date.toLocaleString('de-DE', options);
}

export function formatMeetupTime(date: Date, timezone: string = 'Europe/Berlin'): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone
  };

  return date.toLocaleString('de-DE', options) + ' Uhr';
}

// ═══════════════════════════════════════════════════════════
// ANNOUNCEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════

export function generateAnnouncementText(event: MeetupEvent, nextDate: Date): string {
  const formattedDate = formatMeetupDate(nextDate, event.timezone);
  const formattedTime = formatMeetupTime(nextDate, event.timezone);

  return `📅 **Online-Meetup ${event.location}**

📆 ${formattedDate}

Morgen ist es soweit! Triff andere Geldhelden aus deiner Region beim virtuellen Networking.

👉 **Teilnehmen:**
${event.remo_link}

⏰ Nicht vergessen: Morgen um ${formattedTime}!

💡 Tipp: Der Link ist permanent gültig - speichere ihn für zukünftige Events!

_Automatische Ankündigung vom Geldhelden Shield Bot_`;
}

export function generateReminderText(event: MeetupEvent, nextDate: Date): string {
  const formattedTime = formatMeetupTime(nextDate, event.timezone);

  return `🔔 **Erinnerung: Online-Meetup ${event.location}**

⏰ **In einer Stunde geht's los!** (${formattedTime})

Mach dich bereit für das virtuelle Networking mit anderen Geldhelden!

👉 **Jetzt beitreten:**
${event.remo_link}

Wir freuen uns auf dich! 🎉

_Automatische Erinnerung vom Geldhelden Shield Bot_`;
}

export async function sendMeetupAnnouncement(
  bot: Telegraf,
  location: string,
  isReminder: boolean = false
): Promise<{ sent: number; failed: number }> {
  const event = getMeetupEvent(location);
  if (!event) {
    console.warn(`[MEETUP] Kein Event für Standort: ${location}`);
    return { sent: 0, failed: 0 };
  }

  const nextDate = getNextMeetupDate(location);
  if (!nextDate) {
    console.warn(`[MEETUP] Kein nächster Termin für: ${location}`);
    return { sent: 0, failed: 0 };
  }

  const groups = getGroupsForMeetupLocation(location);
  
  const text = isReminder 
    ? generateReminderText(event, nextDate)
    : generateAnnouncementText(event, nextDate);

  let sent = 0;
  let failed = 0;

  for (const chatId of groups) {
    try {
      await bot.telegram.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: false }
      });
      sent++;
      const msgType = isReminder ? '1h-Erinnerung' : '24h-Ankündigung';
      console.log(`[MEETUP] ${msgType} gesendet: ${location} → ${chatId}`);
    } catch (error: unknown) {
      failed++;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[MEETUP] Fehler bei Ankündigung: ${chatId}`, msg);
    }
  }

  return { sent, failed };
}

// ═══════════════════════════════════════════════════════════
// BOT COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════

export async function handleOnlineMeetupCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) {
    await ctx.reply('❌ Fehler: Chat-ID nicht gefunden');
    return;
  }

  const location = getGroupMeetupLocation(chatId);

  if (!location) {
    await ctx.reply(`ℹ️ Für diese Gruppe ist noch kein Online-Meetup konfiguriert.

Admins können mit \`/meetup_config\` einen Standort zuweisen.`);
    return;
  }

  const event = getMeetupEvent(location);
  if (!event) {
    await ctx.reply(`❌ Fehler: Kein Meetup-Event für Standort "${location}" gefunden.`);
    return;
  }

  const nextDate = getNextMeetupDate(location);
  if (!nextDate) {
    await ctx.reply(`ℹ️ Aktuell ist kein Termin für das Online-Meetup ${location} geplant.`);
    return;
  }

  const formattedDate = formatMeetupDate(nextDate, event.timezone);

  await ctx.reply(`📅 **Online-Meetup ${location}**

📆 Nächster Termin:
${formattedDate}

🌍 Zeitzone: ${event.timezone}

👉 **Teilnahme-Link:**
${event.remo_link}

Wir freuen uns auf dich! 🎉`, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: false }
  });
}

export async function handleMeetupConfigCommand(ctx: Context, isAdmin: boolean): Promise<void> {
  if (!isAdmin) {
    await ctx.reply('❌ Dieser Befehl ist nur für Admins verfügbar.');
    return;
  }

  const chatId = ctx.chat?.id?.toString();
  if (!chatId) {
    await ctx.reply('❌ Fehler: Chat-ID nicht gefunden');
    return;
  }

  const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    const location = getGroupMeetupLocation(chatId);
    const events = getAllMeetupEvents();

    let response = `⚙️ **Meetup-Konfiguration**\n\n`;
    response += `📍 Diese Gruppe: ${location || 'Nicht konfiguriert'}\n\n`;
    response += `📋 **Verfügbare Standorte:**\n`;

    if (events.length === 0) {
      response += `_Keine Standorte konfiguriert_\n`;
    } else {
      for (const event of events) {
        const nextDate = getNextMeetupDate(event.location);
        const dateStr = nextDate ? formatMeetupDate(nextDate, event.timezone) : 'Kein Termin';
        response += `• **${event.location}** (${event.timezone}) - ${dateStr}\n`;
      }
    }

    response += `\n**Befehle:**\n`;
    response += `/meetup_config set <Standort> - Standort zuweisen\n`;
    response += `/meetup_config link <Standort> <URL> - Meetup-Link setzen\n`;
    response += `/meetup_config schedule <Standort> <Pattern> - Zeitplan setzen\n`;
    response += `/meetup_config timezone <Standort> <Timezone> - Zeitzone setzen\n`;

    await ctx.reply(response, { parse_mode: 'Markdown' });
    return;
  }

  const subcommand = args[0].toLowerCase();

  if (subcommand === 'set') {
    const location = args.slice(1).join(' ');
    if (!location) {
      await ctx.reply('❌ Verwendung: /meetup_config set <Standort>');
      return;
    }

    const event = getMeetupEvent(location);
    if (!event) {
      await ctx.reply(`⚠️ Standort "${location}" existiert noch nicht.\n\nErstelle ihn zuerst mit:\n/meetup_config link ${location} <Meetup-URL>`);
      return;
    }

    setGroupMeetupLocation(chatId, location);
    await ctx.reply(`✅ Diese Gruppe ist jetzt dem Standort **${location}** zugewiesen.\n\nMitglieder können /online_meetup nutzen, um den nächsten Termin zu sehen.`, { parse_mode: 'Markdown' });

  } else if (subcommand === 'link') {
    if (args.length < 3) {
      await ctx.reply('❌ Verwendung: /meetup_config link <Standort> <Meetup-URL>');
      return;
    }

    const location = args[1];
    const remoLink = args[2];

    if (!remoLink.startsWith('http')) {
      await ctx.reply('❌ Ungültige URL. Muss mit http:// oder https:// beginnen.');
      return;
    }

    upsertMeetupEvent(location, remoLink);
    await ctx.reply(`✅ Meetup-Event für **${location}** erstellt/aktualisiert.\n\nMeetup-Link: ${remoLink}`, { parse_mode: 'Markdown' });

  } else if (subcommand === 'schedule') {
    if (args.length < 3) {
      await ctx.reply(`❌ Verwendung: /meetup_config schedule <Standort> <Pattern>

**Pattern-Format:** "Wochennummern Wochentag Uhrzeit"

**Beispiele:**
• "2,4 FRI 19:00" = 2. und 4. Freitag, 19:00 Uhr
• "1,3 SAT 10:00" = 1. und 3. Samstag, 10:00 Uhr
• "1 SUN 14:00" = 1. Sonntag, 14:00 Uhr

**Wochentage:** SUN, MON, TUE, WED, THU, FRI, SAT`);
      return;
    }

    const location = args[1];
    const pattern = args.slice(2).join(' ');

    const event = getMeetupEvent(location);
    if (!event) {
      await ctx.reply(`❌ Standort "${location}" existiert nicht. Erstelle ihn zuerst mit /meetup_config link`);
      return;
    }

    const dates = parseSchedulePattern(pattern, event.timezone);
    if (dates.length === 0) {
      await ctx.reply('❌ Ungültiges Schedule-Pattern. Format: "1,3 SAT 10:00"');
      return;
    }

    upsertMeetupEvent(location, event.remo_link, pattern, event.timezone);
    const nextDate = dates[0];
    await ctx.reply(`✅ Zeitplan für **${location}** aktualisiert.\n\nPattern: ${pattern}\nNächster Termin: ${formatMeetupDate(nextDate, event.timezone)}`, { parse_mode: 'Markdown' });

  } else if (subcommand === 'timezone') {
    if (args.length < 3) {
      await ctx.reply(`❌ Verwendung: /meetup_config timezone <Standort> <Timezone>

**Beispiele:**
• Europe/Berlin (Deutschland, Österreich)
• Europe/Zurich (Schweiz)
• Asia/Bangkok (Thailand)
• Asia/Tbilisi (Georgien)
• Europe/Lisbon (Portugal)
• Africa/Johannesburg (Südafrika)`);
      return;
    }

    const location = args[1];
    const timezone = args[2];

    const event = getMeetupEvent(location);
    if (!event) {
      await ctx.reply(`❌ Standort "${location}" existiert nicht.`);
      return;
    }

    try {
      new Intl.DateTimeFormat('de-DE', { timeZone: timezone });
    } catch {
      await ctx.reply(`❌ Ungültige Zeitzone: ${timezone}`);
      return;
    }

    upsertMeetupEvent(location, event.remo_link, event.schedule_pattern, timezone);
    await ctx.reply(`✅ Zeitzone für **${location}** auf **${timezone}** gesetzt.`, { parse_mode: 'Markdown' });

  } else if (subcommand === 'list') {
    const events = getAllMeetupEvents();

    if (events.length === 0) {
      await ctx.reply('ℹ️ Keine Meetup-Events konfiguriert.');
      return;
    }

    let response = '📋 **Alle Meetup-Standorte:**\n\n';

    for (const event of events) {
      const groups = getGroupsForMeetupLocation(event.location);
      const nextDate = getNextMeetupDate(event.location);
      const dateStr = nextDate ? formatMeetupDate(nextDate, event.timezone) : 'Kein Termin';

      response += `**${event.location}**\n`;
      response += `├ Link: ${event.remo_link}\n`;
      response += `├ Schedule: ${event.schedule_pattern}\n`;
      response += `├ Zeitzone: ${event.timezone}\n`;
      response += `├ Nächster Termin: ${dateStr}\n`;
      response += `└ Gruppen: ${groups.length}\n\n`;
    }

    await ctx.reply(response, { parse_mode: 'Markdown' });

  } else if (subcommand === 'remove') {
    removeGroupMeetupLocation(chatId);
    await ctx.reply('✅ Meetup-Zuordnung für diese Gruppe entfernt.');

  } else {
    await ctx.reply('❌ Unbekannter Unterbefehl. Nutze /meetup_config für Hilfe.');
  }
}

// ═══════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════

let announcementInterval: NodeJS.Timeout | null = null;

export function startMeetupScheduler(bot: Telegraf): void {
  initMeetupTables();

  const CHECK_INTERVAL = 30 * 60 * 1000;

  announcementInterval = setInterval(async () => {
    await checkAndSendAnnouncements(bot);
  }, CHECK_INTERVAL);

  console.log('[MEETUP] Scheduler gestartet (prüft alle 30 Minuten)');

  setTimeout(() => checkAndSendAnnouncements(bot), 5000);
}

async function checkAndSendAnnouncements(bot: Telegraf): Promise<void> {
  const events = getAllMeetupEvents();
  const now = new Date();

  console.log(`[MEETUP] Prüfe ${events.length} Events...`);

  for (const event of events) {
    const nextDate = getNextMeetupDate(event.location);
    if (!nextDate) continue;

    const msUntil = nextDate.getTime() - now.getTime();
    const hoursUntil = msUntil / (1000 * 60 * 60);

    const formattedTime = formatMeetupTime(nextDate, event.timezone);
    console.log(`[MEETUP] ${event.location}: Nächstes Event in ${hoursUntil.toFixed(1)}h (${formattedTime} ${event.timezone})`);

    if (hoursUntil >= 23.5 && hoursUntil <= 24.5) {
      if (wasAnnouncementAlreadySent(event.location, nextDate, '24h')) {
        console.log(`[MEETUP] 24h-Ankündigung für ${event.location} bereits gesendet – überspringe`);
      } else {
        console.log(`[MEETUP] 24h-Ankündigung für ${event.location}`);
        await sendMeetupAnnouncement(bot, event.location, false);
        markAnnouncementSent(event.location, nextDate, '24h');
      }
    }

    if (hoursUntil >= 0.5 && hoursUntil <= 1.5) {
      if (wasAnnouncementAlreadySent(event.location, nextDate, '1h')) {
        console.log(`[MEETUP] 1h-Erinnerung für ${event.location} bereits gesendet – überspringe`);
      } else {
        console.log(`[MEETUP] 1h-Erinnerung für ${event.location}`);
        await sendMeetupAnnouncement(bot, event.location, true);
        markAnnouncementSent(event.location, nextDate, '1h');
      }
    }
  }
}

export function stopMeetupScheduler(): void {
  if (announcementInterval) {
    clearInterval(announcementInterval);
    announcementInterval = null;
    console.log('[MEETUP] Scheduler gestoppt');
  }
}
