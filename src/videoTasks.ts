/**
 * Video Task Management System
 *
 * Automatische Weiterleitung von Posts aus dem Hauptkanal
 * in den SM-Arbeitskanal mit Button-basiertem Task-Management.
 */

import { Telegraf, Context } from 'telegraf';
import { getDatabase } from './db';
import { Update, InlineKeyboardMarkup } from 'telegraf/types';

// Kanal-IDs
const SOURCE_CHANNEL_ID = '-1001848781746';  // Geldhelden Hauptkanal
const TARGET_CHANNEL_ID = '-1003843479841';  // SM-Arbeitskanal
const LINKED_CHAT_ID = '-1003662135104';  // Verknuepfte Diskussionsgruppe

// Reminder nach 48 Stunden (in Millisekunden)
const REMINDER_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export interface VideoTask {
  id: number;
  source_message_id: number;
  target_message_id: number;
  info_message_id: number | null;
  status: 'NEW' | 'CLAIMED' | 'DONE' | 'RELEASED';
  claimed_by_id: number | null;
  claimed_by_name: string | null;
  claimed_at: number | null;
  completed_at: number | null;
  reminder_sent: number;
  created_at: number;
}

export function initVideoTaskTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_message_id INTEGER NOT NULL,
      target_message_id INTEGER NOT NULL,
      info_message_id INTEGER,
      status TEXT DEFAULT 'NEW',
      claimed_by_id INTEGER,
      claimed_by_name TEXT,
      claimed_at INTEGER,
      completed_at INTEGER,
      reminder_sent INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_video_tasks_status ON video_tasks(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_video_tasks_target_msg ON video_tasks(target_message_id)`);
  console.log('[VIDEO_TASKS] Tabellen initialisiert');
}

export function createVideoTask(sourceMessageId: number, targetMessageId: number, infoMessageId: number): VideoTask {
  const db = getDatabase();
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO video_tasks (source_message_id, target_message_id, info_message_id, status, created_at)
    VALUES (?, ?, ?, 'NEW', ?)
  `).run(sourceMessageId, targetMessageId, infoMessageId, now);
  console.log(`[VIDEO_TASKS] Task erstellt: source=${sourceMessageId}, target=${targetMessageId}`);
  return {
    id: result.lastInsertRowid as number,
    source_message_id: sourceMessageId,
    target_message_id: targetMessageId,
    info_message_id: infoMessageId,
    status: 'NEW',
    claimed_by_id: null,
    claimed_by_name: null,
    claimed_at: null,
    completed_at: null,
    reminder_sent: 0,
    created_at: now
  };
}

export function getTaskById(taskId: number): VideoTask | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM video_tasks WHERE id = ?`).get(taskId) as VideoTask | undefined;
  return row || null;
}

export function claimTask(taskId: number, userId: number, userName: string): boolean {
  const db = getDatabase();
  const now = Date.now();
  const result = db.prepare(`
    UPDATE video_tasks SET status = 'CLAIMED', claimed_by_id = ?, claimed_by_name = ?, claimed_at = ?
    WHERE id = ? AND status IN ('NEW', 'RELEASED')
  `).run(userId, userName, now, taskId);
  if (result.changes > 0) {
    console.log(`[VIDEO_TASKS] Task claimed: id=${taskId}, user=${userName}`);
    return true;
  }
  return false;
}

export function completeTask(taskId: number, userId: number): boolean {
  const db = getDatabase();
  const now = Date.now();
  const result = db.prepare(`
    UPDATE video_tasks SET status = 'DONE', completed_at = ?
    WHERE id = ? AND claimed_by_id = ? AND status = 'CLAIMED'
  `).run(now, taskId, userId);
  if (result.changes > 0) {
    console.log(`[VIDEO_TASKS] Task completed: id=${taskId}`);
    return true;
  }
  return false;
}

export function releaseTask(taskId: number, userId: number): boolean {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE video_tasks SET status = 'RELEASED', claimed_by_id = NULL, claimed_by_name = NULL, claimed_at = NULL
    WHERE id = ? AND claimed_by_id = ? AND status = 'CLAIMED'
  `).run(taskId, userId);
  if (result.changes > 0) {
    console.log(`[VIDEO_TASKS] Task released: id=${taskId}`);
    return true;
  }
  return false;
}

export function getOpenTasks(): VideoTask[] {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM video_tasks WHERE status IN ('NEW', 'RELEASED') ORDER BY created_at DESC`).all() as VideoTask[];
}

export function getTasksNeedingReminder(): VideoTask[] {
  const db = getDatabase();
  const threshold = Date.now() - REMINDER_THRESHOLD_MS;
  return db.prepare(`SELECT * FROM video_tasks WHERE status = 'CLAIMED' AND claimed_at < ? AND reminder_sent = 0`).all(threshold) as VideoTask[];
}

export function markReminderSent(taskId: number): void {
  const db = getDatabase();
  db.prepare(`UPDATE video_tasks SET reminder_sent = 1 WHERE id = ?`).run(taskId);
}

export function getTaskStats(): { total: number; open: number; claimed: number; done: number } {
  const db = getDatabase();
  const total = (db.prepare(`SELECT COUNT(*) as count FROM video_tasks`).get() as { count: number }).count;
  const open = (db.prepare(`SELECT COUNT(*) as count FROM video_tasks WHERE status IN ('NEW', 'RELEASED')`).get() as { count: number }).count;
  const claimed = (db.prepare(`SELECT COUNT(*) as count FROM video_tasks WHERE status = 'CLAIMED'`).get() as { count: number }).count;
  const done = (db.prepare(`SELECT COUNT(*) as count FROM video_tasks WHERE status = 'DONE'`).get() as { count: number }).count;
  return { total, open, claimed, done };
}

export function getUserStats(userId: number): { claimed: number; completed: number } {
  const db = getDatabase();
  const completed = (db.prepare(`SELECT COUNT(*) as count FROM video_tasks WHERE claimed_by_id = ? AND status = 'DONE'`).get(userId) as { count: number }).count;
  const claimed = (db.prepare(`SELECT COUNT(*) as count FROM video_tasks WHERE claimed_by_id = ? AND status = 'CLAIMED'`).get(userId) as { count: number }).count;
  return { claimed, completed };
}

export function getLeaderboard(): { name: string; count: number }[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT claimed_by_name as name, COUNT(*) as count FROM video_tasks
    WHERE status = 'DONE' AND claimed_by_name IS NOT NULL
    GROUP BY claimed_by_id ORDER BY count DESC LIMIT 10
  `).all() as { name: string; count: number }[];
}

function buildTaskKeyboard(taskId: number, status: string, claimedByName: string | null): InlineKeyboardMarkup {
  if (status === 'DONE') {
    return { inline_keyboard: [[{ text: '✅ Abgeschlossen', callback_data: 'video_noop' }]] };
  }
  if (status === 'CLAIMED') {
    return { inline_keyboard: [[
      { text: `🟡 ${claimedByName}`, callback_data: 'video_noop' },
      { text: '✅ Fertig', callback_data: `video_done_${taskId}` },
      { text: '❌ Freigeben', callback_data: `video_release_${taskId}` }
    ]] };
  }
  return { inline_keyboard: [[{ text: '🟡 Ich übernehme', callback_data: `video_claim_${taskId}` }]] };
}

export async function handleChannelPost(bot: Telegraf, channelPost: any): Promise<void> {
  const chatId = channelPost.chat?.id?.toString();
  if (chatId !== SOURCE_CHANNEL_ID) return;
  console.log(`[VIDEO_TASKS] Neuer Post im Hauptkanal: ${channelPost.message_id}`);
  try {
    const forwarded = await bot.telegram.forwardMessage(TARGET_CHANNEL_ID, SOURCE_CHANNEL_ID, channelPost.message_id);
    const infoMsg = await bot.telegram.sendMessage(TARGET_CHANNEL_ID,
      `📺 Neuer Content - Wer macht das Video?`,
      { reply_parameters: { message_id: forwarded.message_id }, reply_markup: { inline_keyboard: [[{ text: '🟡 Ich übernehme', callback_data: 'video_claim_PLACEHOLDER' }]] } }
    );
    const task = createVideoTask(channelPost.message_id, forwarded.message_id, infoMsg.message_id);
    await bot.telegram.editMessageReplyMarkup(TARGET_CHANNEL_ID, infoMsg.message_id, undefined, buildTaskKeyboard(task.id, 'NEW', null));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[VIDEO_TASKS] Fehler bei Weiterleitung:`, msg);
  }
}

export async function handleVideoCallback(ctx: Context): Promise<void> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !('data' in callbackQuery)) return;
  const data = callbackQuery.data;
  if (!data.startsWith('video_')) return;
  const userId = ctx.from?.id;
  const userName = ctx.from?.first_name || ctx.from?.username || 'Unbekannt';
  if (!userId) { await ctx.answerCbQuery('Fehler: User nicht erkannt'); return; }
  if (data === 'video_noop') { await ctx.answerCbQuery(); return; }
  const parts = data.split('_');
  if (parts.length < 3) { await ctx.answerCbQuery('Ungültige Aktion'); return; }
  const action = parts[1];
  const taskId = parseInt(parts[2], 10);
  if (isNaN(taskId)) { await ctx.answerCbQuery('Ungültige Task-ID'); return; }
  const task = getTaskById(taskId);
  if (!task) { await ctx.answerCbQuery('Task nicht gefunden'); return; }
  try {
    if (action === 'claim') {
      if (task.status === 'NEW' || task.status === 'RELEASED') {
        if (claimTask(taskId, userId, userName)) {
          await ctx.answerCbQuery(`✅ Du übernimmst diesen Task!`);
          await ctx.editMessageText(`📺 Neuer Content - Video wird erstellt von ${userName}`, { reply_markup: buildTaskKeyboard(taskId, 'CLAIMED', userName) });
        } else { await ctx.answerCbQuery('Konnte Task nicht übernehmen'); }
      } else if (task.status === 'CLAIMED') { await ctx.answerCbQuery(`⚠️ Bereits übernommen von ${task.claimed_by_name}`); }
      else { await ctx.answerCbQuery('Task bereits abgeschlossen'); }
    } else if (action === 'done') {
      if (task.claimed_by_id !== userId) { await ctx.answerCbQuery(`⚠️ Nur ${task.claimed_by_name} kann abschliessen`); return; }
      if (completeTask(taskId, userId)) {
        const stats = getUserStats(userId);
        await ctx.answerCbQuery(`🎉 Super! Das war dein ${stats.completed}. Video!`);
        await ctx.editMessageText(`✅ Video fertig von ${userName} (Nr. ${stats.completed})`, { reply_markup: buildTaskKeyboard(taskId, 'DONE', userName) });
      } else { await ctx.answerCbQuery('Fehler beim Abschliessen'); }
    } else if (action === 'release') {
      if (task.claimed_by_id !== userId) { await ctx.answerCbQuery(`⚠️ Nur ${task.claimed_by_name} kann freigeben`); return; }
      if (releaseTask(taskId, userId)) {
        await ctx.answerCbQuery('🔄 Task freigegeben');
        await ctx.editMessageText(`📺 Neuer Content - Wer macht das Video?`, { reply_markup: buildTaskKeyboard(taskId, 'RELEASED', null) });
      } else { await ctx.answerCbQuery('Fehler beim Freigeben'); }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[VIDEO_TASKS] Callback-Fehler:`, msg);
    await ctx.answerCbQuery('Ein Fehler ist aufgetreten');
  }
}

export async function handleVideoStatusCommand(ctx: Context): Promise<void> {
  const stats = getTaskStats();
  await ctx.reply(`📊 Video-Task Status\n\n📺 Gesamt: ${stats.total} Tasks\n🆕 Offen: ${stats.open}\n🟡 In Arbeit: ${stats.claimed}\n✅ Fertig: ${stats.done}\n\nBefehle:\n/video_open - Offene Tasks\n/video_mine - Meine Tasks\n/video_stats - Leaderboard`);
}

export async function handleVideoOpenCommand(ctx: Context): Promise<void> {
  const tasks = getOpenTasks();
  if (tasks.length === 0) { await ctx.reply('✅ Keine offenen Tasks!'); return; }
  let text = `🆕 Offene Tasks (${tasks.length}):\n\n`;
  for (const task of tasks.slice(0, 10)) {
    const date = new Date(task.created_at).toLocaleDateString('de-DE');
    text += `• Post vom ${date} (ID: ${task.source_message_id})\n`;
  }
  if (tasks.length > 10) text += `\n... und ${tasks.length - 10} weitere`;
  await ctx.reply(text);
}

export async function handleVideoMineCommand(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;
  const db = getDatabase();
  const myTasks = db.prepare(`SELECT * FROM video_tasks WHERE claimed_by_id = ? AND status = 'CLAIMED'`).all(userId) as VideoTask[];
  if (myTasks.length === 0) { await ctx.reply('📭 Du hast keine offenen Tasks.'); return; }
  let text = `📋 Deine offenen Tasks (${myTasks.length}):\n\n`;
  for (const task of myTasks) {
    const claimedDate = task.claimed_at ? new Date(task.claimed_at).toLocaleDateString('de-DE') : 'Unbekannt';
    const hoursAgo = task.claimed_at ? Math.floor((Date.now() - task.claimed_at) / (1000 * 60 * 60)) : 0;
    text += `• Übernommen am ${claimedDate} (vor ${hoursAgo}h)\n`;
  }
  await ctx.reply(text);
}

export async function handleVideoStatsCommand(ctx: Context): Promise<void> {
  const leaderboard = getLeaderboard();
  if (leaderboard.length === 0) { await ctx.reply('📊 Noch keine abgeschlossenen Tasks.'); return; }
  let text = `🏆 Video-Leaderboard\n\n`;
  const medals = ['🥇', '🥈', '🥉'];
  leaderboard.forEach((entry, index) => {
    const medal = medals[index] || `${index + 1}.`;
    text += `${medal} ${entry.name}: ${entry.count} Videos\n`;
  });
  await ctx.reply(text);
}

let reminderInterval: NodeJS.Timeout | null = null;

export function startVideoTaskScheduler(bot: Telegraf): void {
  initVideoTaskTables();
  const CHECK_INTERVAL = 60 * 60 * 1000;
  reminderInterval = setInterval(async () => { await sendReminders(bot); }, CHECK_INTERVAL);
  console.log('[VIDEO_TASKS] Reminder-Scheduler gestartet');
  setTimeout(() => sendReminders(bot), 60 * 1000);
}

async function sendReminders(bot: Telegraf): Promise<void> {
  const tasks = getTasksNeedingReminder();
  for (const task of tasks) {
    try {
      const hoursAgo = Math.floor((Date.now() - (task.claimed_at || 0)) / (1000 * 60 * 60));
      await bot.telegram.sendMessage(TARGET_CHANNEL_ID,
        `⏰ Hey ${task.claimed_by_name}, dein Task wartet seit ${hoursAgo} Stunden!\nBitte abschliessen oder freigeben.`,
        { reply_parameters: { message_id: task.target_message_id } }
      );
      markReminderSent(task.id);
      console.log(`[VIDEO_TASKS] Reminder gesendet fuer Task ${task.id}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[VIDEO_TASKS] Fehler bei Reminder:`, msg);
    }
  }
}

export function stopVideoTaskScheduler(): void {
  if (reminderInterval) { clearInterval(reminderInterval); reminderInterval = null; console.log('[VIDEO_TASKS] Scheduler gestoppt'); }
}

export const VIDEO_SOURCE_CHANNEL = SOURCE_CHANNEL_ID;
export const VIDEO_TARGET_CHANNEL = TARGET_CHANNEL_ID;
export const VIDEO_LINKED_CHAT = LINKED_CHAT_ID;

// Handler fuer Nachrichten aus der verknuepften Gruppe
export async function handleLinkedChatMessage(bot: Telegraf, msg: any): Promise<void> {
  const chatId = msg.chat?.id?.toString();
  if (chatId !== LINKED_CHAT_ID) return;
  
  // Pruefe ob es ein Post vom Hauptkanal ist (sender_chat)
  const senderChatId = msg.sender_chat?.id?.toString();
  if (senderChatId !== SOURCE_CHANNEL_ID) return;
  
  console.log(`[VIDEO_TASKS] Post aus Hauptkanal in Diskussionsgruppe erkannt: msg_id=${msg.message_id}`);
  
  // Weiterleiten an Arbeitskanal
  try {
    const forwarded = await bot.telegram.forwardMessage(TARGET_CHANNEL_ID, chatId, msg.message_id);
    const infoMsg = await bot.telegram.sendMessage(TARGET_CHANNEL_ID,
      `Neuer Content - Wer macht das Video?`,
      { reply_parameters: { message_id: forwarded.message_id }, reply_markup: { inline_keyboard: [[{ text: 'Ich uebernehme', callback_data: 'video_claim_PLACEHOLDER' }]] } }
    );
    const task = createVideoTask(msg.message_id, forwarded.message_id, infoMsg.message_id);
    await bot.telegram.editMessageReplyMarkup(TARGET_CHANNEL_ID, infoMsg.message_id, undefined, buildTaskKeyboard(task.id, 'NEW', null));
    console.log(`[VIDEO_TASKS] Post weitergeleitet und Task erstellt: ${task.id}`);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[VIDEO_TASKS] Fehler bei Weiterleitung aus Diskussion:`, msg);
  }
}
