/**
 * Aktualisiert Telegram-Gruppen-Beschreibungen:
 * Ersetzt alte standortspezifische Airmeet-Links durch den einheitlichen Link.
 *
 * Ausführen: ts-node scripts/update-group-descriptions.ts
 */

import { Telegraf } from 'telegraf';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

dotenv.config();

const UNIFIED_LINK = 'https://www.airmeet.com/e/8ca48df0-fd79-11f0-ace7-c7ef52349391';
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DB_PATH = process.env.DB_PATH || './data/shield.db';

const bot = new Telegraf(BOT_TOKEN);
const db = new Database(DB_PATH);

interface GroupMapping {
  chat_id: string;
  location: string;
}

async function updateGroupDescriptions() {
  const groups = db.prepare(`
    SELECT chat_id, location FROM meetup_group_mapping ORDER BY location
  `).all() as GroupMapping[];

  console.log(`Aktualisiere ${groups.length} Gruppen-Beschreibungen...\n`);

  let success = 0;
  let unchanged = 0;
  let failed = 0;

  for (const group of groups) {
    try {
      // Aktuelle Beschreibung holen
      const chat = await bot.telegram.getChat(group.chat_id);
      const currentDescription = ('description' in chat ? chat.description : '') || '';

      // Alten airmeet-Link ersetzen (alle Varianten)
      const airmeetPattern = /https?:\/\/www\.airmeet\.com\/e\/[a-z0-9\-]+/gi;
      let newDescription: string;

      if (airmeetPattern.test(currentDescription)) {
        // Ersetze alten Link durch neuen einheitlichen Link
        newDescription = currentDescription.replace(airmeetPattern, UNIFIED_LINK);
      } else if (currentDescription.length === 0) {
        // Keine Beschreibung vorhanden — setze neue
        newDescription = `🤝 Geldhelden ${group.location} — Community für finanzielle Freiheit\n\n🎙️ Online-Meetup jeden 2. und 4. Freitag um 19:00 Uhr:\n${UNIFIED_LINK}`;
      } else if (!currentDescription.includes('airmeet.com')) {
        // Beschreibung ohne Link — hänge Link an
        newDescription = `${currentDescription}\n\n🎙️ Online-Meetup (jeden 2. und 4. Fr., 19:00):\n${UNIFIED_LINK}`;
      } else {
        newDescription = currentDescription;
      }

      if (newDescription === currentDescription) {
        console.log(`↔️  ${group.location} (${group.chat_id}): Keine Änderung nötig`);
        unchanged++;
        continue;
      }

      await bot.telegram.setChatDescription(group.chat_id, newDescription);
      console.log(`✅ ${group.location} (${group.chat_id}): Beschreibung aktualisiert`);
      success++;

      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${group.location} (${group.chat_id}): ${msg}`);
      failed++;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n✅ Fertig!`);
  console.log(`   Aktualisiert: ${success}`);
  console.log(`   Unverändert:  ${unchanged}`);
  console.log(`   Fehler:       ${failed}`);

  process.exit(0);
}

updateGroupDescriptions();
