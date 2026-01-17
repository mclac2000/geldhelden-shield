import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
  };
  edited_message?: {
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
  };
  channel_post?: {
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
  };
  edited_channel_post?: {
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
  };
  my_chat_member?: {
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
  };
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

async function getTelegramIds(): Promise<void> {
  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    console.error('❌ FEHLER: BOT_TOKEN ist nicht in der .env Datei gesetzt!');
    console.error('');
    console.error('Bitte erstelle eine .env Datei im Projektroot mit:');
    console.error('BOT_TOKEN=dein_token_hier');
    process.exit(1);
  }

  console.log('🔍 Rufe Telegram API auf...');
  console.log('');

  try {
    const apiUrl = `https://api.telegram.org/bot${botToken}/getUpdates?limit=100&offset=-100`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Telegram API Fehler:');
      console.error(`Status: ${response.status} ${response.statusText}`);
      console.error(`Antwort: ${errorText}`);
      process.exit(1);
    }

    const data: TelegramGetUpdatesResponse = await response.json();

    if (!data.ok) {
      console.error('❌ Telegram API hat einen Fehler zurückgegeben:');
      console.error(data);
      process.exit(1);
    }

    const updates = data.result || [];

    if (updates.length === 0) {
      console.log('⚠️  KEINE UPDATES GEFUNDEN!');
      console.log('');
      console.log('Das kann folgende Gründe haben:');
      console.log('  1. Der Bot wurde noch nie verwendet');
      console.log('  2. Alle Updates wurden bereits verarbeitet');
      console.log('  3. Der Bot-Token ist ungültig');
      console.log('');
      console.log('💡 TIP: Sende dem Bot eine private Nachricht oder füge ihn zu einer Gruppe hinzu,');
      console.log('   dann führe dieses Script erneut aus.');
      process.exit(0);
    }

    // Sammle alle Chat-IDs und User-IDs
    const chatIds = new Set<number>();
    const userIds = new Set<number>();
    const chatInfo: Map<number, { type: string; title?: string; username?: string }> = new Map();

    for (const update of updates) {
      // Chat-IDs aus verschiedenen Update-Typen extrahieren
      if (update.message?.chat) {
        chatIds.add(update.message.chat.id);
        chatInfo.set(update.message.chat.id, {
          type: update.message.chat.type,
          title: update.message.chat.title,
          username: update.message.chat.username,
        });
      }

      if (update.edited_message?.chat) {
        chatIds.add(update.edited_message.chat.id);
        chatInfo.set(update.edited_message.chat.id, {
          type: update.edited_message.chat.type,
          title: update.edited_message.chat.title,
          username: update.edited_message.chat.username,
        });
      }

      if (update.channel_post?.chat) {
        chatIds.add(update.channel_post.chat.id);
        chatInfo.set(update.channel_post.chat.id, {
          type: update.channel_post.chat.type,
          title: update.channel_post.chat.title,
          username: update.channel_post.chat.username,
        });
      }

      if (update.edited_channel_post?.chat) {
        chatIds.add(update.edited_channel_post.chat.id);
        chatInfo.set(update.edited_channel_post.chat.id, {
          type: update.edited_channel_post.chat.type,
          title: update.edited_channel_post.chat.title,
          username: update.edited_channel_post.chat.username,
        });
      }

      if (update.my_chat_member?.chat) {
        chatIds.add(update.my_chat_member.chat.id);
        chatInfo.set(update.my_chat_member.chat.id, {
          type: update.my_chat_member.chat.type,
          title: update.my_chat_member.chat.title,
          username: update.my_chat_member.chat.username,
        });
      }

      // User-IDs extrahieren (nur echte User, keine Bots)
      if (update.message?.from && !update.message.from.is_bot) {
        userIds.add(update.message.from.id);
      }

      if (update.edited_message?.from && !update.edited_message.from.is_bot) {
        userIds.add(update.edited_message.from.id);
      }

      if (update.my_chat_member?.from && !update.my_chat_member.from.is_bot) {
        userIds.add(update.my_chat_member.from.id);
      }
    }

    // Sortiere IDs
    const sortedChatIds = Array.from(chatIds).sort((a, b) => a - b);
    const sortedUserIds = Array.from(userIds).sort((a, b) => a - b);

    // Filtere Chat-IDs nach Typ für bessere Übersicht
    const groupChatIds: number[] = [];
    const channelChatIds: number[] = [];
    const privateChatIds: number[] = [];

    for (const chatId of sortedChatIds) {
      const info = chatInfo.get(chatId);
      if (info) {
        if (info.type === 'group' || info.type === 'supergroup') {
          groupChatIds.push(chatId);
        } else if (info.type === 'channel') {
          channelChatIds.push(chatId);
        } else if (info.type === 'private') {
          privateChatIds.push(chatId);
        }
      }
    }

    // Ausgabe
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 GEFUNDENE CHAT-IDs:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    if (groupChatIds.length > 0) {
      console.log('📱 GRUPPEN (Groups/Supergroups):');
      for (const chatId of groupChatIds) {
        const info = chatInfo.get(chatId);
        const displayName = info?.title || info?.username || 'Unbekannt';
        console.log(`   ${chatId} - ${displayName} (${info?.type})`);
      }
      console.log('');
    }

    if (channelChatIds.length > 0) {
      console.log('📺 KANÄLE (Channels):');
      for (const chatId of channelChatIds) {
        const info = chatInfo.get(chatId);
        const displayName = info?.title || info?.username || 'Unbekannt';
        console.log(`   ${chatId} - ${displayName} (${info?.type})`);
      }
      console.log('');
    }

    if (privateChatIds.length > 0) {
      console.log('💬 PRIVATE CHATS:');
      for (const chatId of privateChatIds) {
        const info = chatInfo.get(chatId);
        const displayName = info?.username || 'Unbekannt';
        console.log(`   ${chatId} - @${displayName} (${info?.type})`);
      }
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('👤 GEFUNDENE USER-IDs:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    if (sortedUserIds.length > 0) {
      for (const userId of sortedUserIds) {
        console.log(`   ${userId}`);
      }
      console.log('');
    } else {
      console.log('   (Keine User-IDs gefunden)');
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 FERTIGE KONFIGURATION FÜR .env:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // ADMIN_IDS: Alle gefundenen User-IDs (komma-separiert, ohne Leerzeichen)
    if (sortedUserIds.length > 0) {
      const adminIdsStr = sortedUserIds.join(',');
      console.log(`ADMIN_IDS=${adminIdsStr}`);
    } else {
      console.log('ADMIN_IDS=');
      console.log('');
      console.log('⚠️  Keine User-IDs gefunden. Bitte sende dem Bot eine private Nachricht');
      console.log('   oder führe eine Aktion in einer Gruppe aus, dann führe dieses Script');
      console.log('   erneut aus.');
    }
    console.log('');

    // ADMIN_LOG_CHAT: Erste gefundene Gruppe/Kanal (oder leer)
    if (groupChatIds.length > 0) {
      console.log(`ADMIN_LOG_CHAT=${groupChatIds[0]}`);
    } else if (channelChatIds.length > 0) {
      console.log(`ADMIN_LOG_CHAT=${channelChatIds[0]}`);
    } else {
      console.log('ADMIN_LOG_CHAT=');
      console.log('');
      console.log('⚠️  Keine Gruppe oder Kanal gefunden. Füge den Bot zu einer Gruppe hinzu,');
      console.log('   wo die Logs gesendet werden sollen, dann führe dieses Script erneut aus.');
    }
    console.log('');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ ERFOLGREICH ABGESCHLOSSEN!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    console.log('💡 NÄCHSTE SCHRITTE:');
    console.log('   1. Kopiere die ADMIN_IDS und ADMIN_LOG_CHAT Werte oben');
    console.log('   2. Füge sie in deine .env Datei ein');
    console.log('   3. Starte den Bot mit: npm run dev');
    console.log('');

  } catch (error: any) {
    console.error('❌ Unerwarteter Fehler:');
    console.error(error.message);
    if (error.stack) {
      console.error('');
      console.error('Stack Trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Script ausführen
getTelegramIds().catch((error) => {
  console.error('❌ Fataler Fehler:', error);
  process.exit(1);
});