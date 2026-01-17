/**
 * Zentrale Command-Router
 * 
 * Einheitliche Command-Verarbeitung mit Argument-Safety.
 */

import { Context } from 'telegraf';
import { AdminCommandHandler } from './admin';
import { isAdmin } from './admin';

/**
 * Zentrale Command-Map
 * Alle Commands werden hier registriert.
 */
export const adminCommands: Record<string, AdminCommandHandler> = {
  // Placeholder - wird dynamisch geladen
};

/**
 * Registriert einen Command-Handler
 */
export function registerCommand(name: string, handler: AdminCommandHandler): void {
  adminCommands[name.toLowerCase()] = handler;
}

/**
 * Führt einen Command aus (mit Admin-Check)
 */
export async function executeCommand(
  ctx: Context,
  commandName: string,
  args: string[]
): Promise<void> {
  // Admin-Check
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    const chat = ctx.chat;
    if (chat && (chat.type === 'group' || chat.type === 'supergroup')) {
      await ctx.reply('❌ Du bist kein Administrator.');
    }
    return;
  }

  // Finde Handler
  const handler = adminCommands[commandName.toLowerCase()];
  if (!handler) {
    await ctx.reply(`❌ Unbekannter Command: /${commandName}`);
    return;
  }

  // Führe Handler aus
  try {
    await handler(ctx, args);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Error] Fehler beim ${commandName}-Command:`, errorMessage);
    await ctx.reply(`❌ Fehler beim Ausführen des ${commandName}-Commands.`);
  }
}
