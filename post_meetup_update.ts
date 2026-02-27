import { Telegraf } from 'telegraf';
import Database from 'better-sqlite3';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const bot = new Telegraf(BOT_TOKEN);
const db = new Database('/root/Geldhelden Shield/data/shield.db');

interface GroupMapping {
  chat_id: string;
  location: string;
  remo_link: string;
}

function getPostText(airmeetLink: string): string {
  return `📢 *Kurzes Update zu unserem ersten Online-Meetup*

Hallo ihr Lieben,

zunächst einmal eine aufrichtige Entschuldigung an alle, die gestern beim ersten Online-Meetup dabei sein wollten und nicht reinkamen. Wir wissen, wie frustrierend das war – und es tut uns wirklich leid! 💙

*Was ist passiert?*
Es gab technische Probleme mit unserer Meetup-Plattform (Airmeet). Die Einstellungen waren versehentlich so konfiguriert, dass nur Admins Zugang hatten. Das hätte natürlich nicht passieren dürfen.

*Die gute Nachricht:*
Wir haben das Problem erkannt und alle Einstellungen in sämtlichen Gruppen korrigiert. Der Zugang funktioniert jetzt! ✅

*Bitte einmal kurz testen:*
Könntet ihr den Zugang einmal testen, damit wir sichergehen können, dass alles reibungsolos läuft? Einfach dem Airmeet-Link folgen und schauen, ob ihr rreinkommt:
👉 ${airmeetLink}

*Noch einfacher als vorher:*
Die Teilnahme ist jetzt ohne E-Mail-Registrierung möglich. Ihr könnt einfach direkt rein – ganz unkompliziert.

*Nächster Termin:*
📅 Das nächste offizielle Online-Meetup findet am *27. Februar 2026 um 19:00 Uhr MEZ* statt.

Aber: Ihr könnt euch jederzeit innerhalb eurer Gruppe im Airmeet-Raum verabreden und treffen – kostenlos und ohne festen Termin. Schreibt einfach hier in die Gruppe, wann ihr da seid!

*Bitte gebt uns Feedback:*
Testet es und schreibt hier als Kommentar, ob es funktioniert und wo noch Fehler sind. Nur so können wir schnell alles fixen. 🙛
---

Aller Anfang ist schwer, aber das Ergebnis ist umso schöner. Vielen Dank für euer Verständnis. Vielen Dank für euer Engagement. Vielen Dank, dass ihr Geldhelden seid.

_Das gesamte Geldhelden Team_ 💛`;
}

async function postToAllGroups() {
  const groups = db.prepare(`
    SELECT m.chat_id, m.location, e.remo_link 
    FROM meetup_group_mapping m 
    JOIN meetup_events e ON m.location = e.location 
    WHERE e.is_active = 1
  `).all() as GroupMapping[];

  console.log(`Poste in ${groups.length} Gruppen...`);
  
  let success = 0;
  let failed = 0;

  for (const group of groups) {
    const text = getPostText(group.remo_link);
    
    try {
      await bot.telegram.sendMessage(group.chat_id, text, { parse_mode: 'Markdown' });
      console.log(`✅ ${group.location} (${group.chat_id})`);
      success++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (error: any) {
      console.error(`❌ ${group.location}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nFertig! Erfolgreich: ${success}, Fehlgeschlagen: ${failed}`);
  process.exit(0);
}

postToAllGroups();