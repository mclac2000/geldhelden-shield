/**
 * ownLinks.ts — Freigabeliste der eigenen Gruppen-Links
 *
 * Damit die Wellen-Erkennung nicht unsere eigenen Gruppen trifft: Mitglieder
 * verlinken Geldhelden-Gruppen völlig legitim untereinander, und zwar genau im
 * Muster, das eine Kampagne kennzeichnet — viele Konten, viele Gruppen.
 *
 * Deshalb wird der öffentliche Benutzername jeder verwalteten Gruppe über
 * getChat ermittelt und dauerhaft freigegeben. Läuft beim Start und danach
 * täglich, damit neue Gruppen automatisch dazukommen.
 */

import { config } from './config';

/**
 * Ermittelt die Benutzernamen aller verwalteten Gruppen und trägt sie in die
 * Freigabeliste ein.
 *
 * @param telegram Telegram-Instanz
 * @param verbose  ausführliche Ausgabe pro Gruppe
 */
export async function syncOwnGroupLinks(
  telegram: any,
  verbose = false
): Promise<{ checked: number; withUsername: number; allowlisted: number; errors: number }> {
  const { getManagedGroups, setGroupUsername, addLinkAllowlist, isLinkAllowlisted } = await import('./db');

  const { normalizeTelegramLink } = await import('./campaignLinks');
  const groups = getManagedGroups();
  let withUsername = 0;
  let withInvite = 0;
  let allowlisted = 0;
  let errors = 0;

  const freigeben = (key: string | null, grund: string) => {
    if (!key) return;
    if (isLinkAllowlisted(key)) return;
    addLinkAllowlist(key, grund);
    allowlisted++;
  };

  for (const g of groups) {
    const chatId = String((g as any).chat_id ?? (g as any).chatId);
    try {
      const chat: any = await telegram.getChat(chatId);
      const titel = chat?.title || chatId;

      // a) Öffentlicher Benutzername → t.me/name
      const username: string | null = chat?.username ? String(chat.username).toLowerCase() : null;
      setGroupUsername(chatId, username);
      if (username) {
        withUsername++;
        freigeben(`public:${username}`, `Eigene Gruppe: ${titel}`);
        if (verbose) console.log(`[OwnLinks] ${chatId} → @${username}`);
      }

      // b) Einladungslink → t.me/+HASH
      // ENTSCHEIDEND für private Gruppen: die haben keinen Benutzernamen und
      // werden ausschließlich über den Einladungslink geteilt. Ohne diesen
      // Eintrag würden Mitglieder, die eine eigene private Geldhelden-Gruppe
      // in anderen Gruppen verlinken, als Werbe-Welle gewertet.
      const invites: string[] = [];
      if (chat?.invite_link) invites.push(chat.invite_link);
      if (!chat?.invite_link && !username) {
        // Kein Link im Chat-Objekt hinterlegt → einen erzeugen lassen.
        // exportChatInviteLink gibt den primären Link zurück bzw. legt ihn an.
        try {
          const link = await telegram.exportChatInviteLink(chatId);
          if (link) invites.push(link);
        } catch {
          // Bot darf keine Einladungslinks verwalten — dann eben nicht
        }
      }
      for (const inv of invites) {
        const key = normalizeTelegramLink(inv);
        if (key) {
          withInvite++;
          freigeben(key, `Eigene Gruppe (Einladungslink): ${titel}`);
          if (verbose) console.log(`[OwnLinks] ${chatId} → ${key}`);
        }
      }

      if (!username && invites.length === 0 && verbose) {
        console.log(`[OwnLinks] ${chatId} → weder Benutzername noch Einladungslink ermittelbar`);
      }
    } catch (error: any) {
      errors++;
      if (verbose) console.log(`[OwnLinks] ${chatId} → Fehler: ${error.message}`);
    }
    // Schonend gegen Rate-Limits
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(
    `[OwnLinks] Abgeschlossen: ${groups.length} Gruppen geprüft, ` +
    `${withUsername} mit Benutzername, ${withInvite} mit Einladungslink, ` +
    `${allowlisted} neu freigegeben, ${errors} Fehler`
  );

  // Ein stiller Fehlschlag wäre gefährlich: ohne Freigabeliste gelten eigene
  // Gruppen als fremde Links. Deshalb den Admin informieren.
  if (errors > 0) {
    try {
      await telegram.sendMessage(
        config.adminLogChat,
        `⚠️ <b>Eigene-Links-Sync unvollständig</b>\n\n` +
          `${errors} von ${groups.length} Gruppen konnten nicht abgefragt werden. ` +
          `Deren Links gelten bis zum nächsten Lauf als fremd.\n` +
          `Erneut versuchen mit <code>/links sync</code>.`,
        { parse_mode: 'HTML' }
      );
    } catch { /* nicht kritisch */ }
  }

  // Der eigene Kanal aus Marcos Profil (personal_chat) und bekannte Partner
  for (const extra of config.ownLinkExtras) {
    const key = `public:${extra.toLowerCase()}`;
    const { isLinkAllowlisted: chk, addLinkAllowlist: add } = await import('./db');
    if (!chk(key)) {
      add(key, 'Aus OWN_LINK_EXTRAS');
      allowlisted++;
    }
  }

  return { checked: groups.length, withUsername, allowlisted, errors };
}
