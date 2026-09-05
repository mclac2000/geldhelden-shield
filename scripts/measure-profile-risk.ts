/**
 * measure-profile-risk.ts — Wie viele BESTEHENDE Mitglieder träfe die Regel?
 *
 * Läuft VOR dem Scharfschalten. Holt für jedes bekannte Konto Bio und
 * Profilbild über getChat, wendet die Profilprüfung an und zählt die Treffer —
 * mit COUNT(DISTINCT user_id), nicht mit Zeilen.
 *
 * Ändert nichts: sperrt niemanden, meldet nichts in den Admin-Chat. Die
 * abgerufenen Profile werden in user_profiles gespeichert, weil sie ohnehin
 * gebraucht werden (Bild-Dubletten).
 *
 * Aufruf im Container:
 *   docker exec -w /app geldhelden-shield-bot node /app/dist/../measure.js
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { Telegraf } from 'telegraf';
import {
  getDatabase, saveUserProfile, isLinkAllowlisted, getUsersWithSamePhoto,
  isTeamMember,
} from '../src/db';
import { analysiereProfil, entscheideProfil } from '../src/profileRisk';
import { config } from '../src/config';

interface Treffer {
  userId: number;
  username: string | null;
  name: string;
  bio: string;
  grund: string;
  belege: string[];
  gruppen: number;
  ersterKontakt: string;
}

async function main(): Promise<void> {
  const bot = new Telegraf(config.botToken);
  const db = getDatabase();

  const mitglieder = db.prepare(`
    SELECT user_id,
           MAX(username)   AS username,
           MAX(first_name) AS first_name,
           MAX(last_name)  AS last_name,
           COUNT(DISTINCT chat_id) AS gruppen,
           MIN(first_seen_at) AS erster
    FROM baseline_members
    WHERE is_bot = 0
    GROUP BY user_id
  `).all() as any[];

  console.log(`Zu prüfende Konten: ${mitglieder.length}`);
  console.log(`Freigegebene Links (eigene Gruppen): ${(db.prepare('SELECT COUNT(*) c FROM link_allowlist').get() as any).c}`);
  console.log('');

  let abgefragt = 0, ohneAntwort = 0, mitBio = 0;
  const trefferMild: Treffer[] = [];
  const trefferStreng: Treffer[] = [];
  const alarme: Treffer[] = [];

  for (let i = 0; i < mitglieder.length; i++) {
    const m = mitglieder[i];
    if (i > 0 && i % 500 === 0) {
      console.log(`  … ${i}/${mitglieder.length} geprüft, ${mitBio} mit Bio, ` +
        `${trefferMild.length} Treffer (mild) / ${trefferStreng.length} (streng)`);
    }

    let bio: string | null = null;
    let foto: string | null = null;
    try {
      const chat: any = await bot.telegram.getChat(m.user_id);
      bio = chat?.bio ?? null;
      foto = chat?.photo?.big_file_unique_id ?? null;
      abgefragt++;
    } catch {
      ohneAntwort++;
      await pause(120);
      continue;
    }

    saveUserProfile(m.user_id, bio, foto, null);
    if (bio) mitBio++;

    // Team und Admins wären im Betrieb ausgenommen — hier ebenso, sonst
    // verzerrt es die Zahl.
    if (isTeamMember(m.user_id) || config.adminIds.includes(m.user_id)) {
      await pause(120);
      continue;
    }

    const dubletten = foto ? getUsersWithSamePhoto(foto, m.user_id) : [];
    const befund = analysiereProfil({
      bio, username: m.username, istLinkFreigegeben: isLinkAllowlisted, fotoDublettenIds: dubletten,
    });

    const mild = entscheideProfil(befund, false);
    const streng = entscheideProfil(befund, true);

    const t: Treffer = {
      userId: m.user_id,
      username: m.username,
      name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
      bio: (bio || '').substring(0, 160),
      grund: mild.massnahme !== 'keine' ? mild.grund : streng.grund,
      belege: (mild.massnahme !== 'keine' ? mild : streng).belege,
      gruppen: m.gruppen,
      ersterKontakt: m.erster ? new Date(m.erster).toISOString().substring(0, 10) : '?',
    };

    if (mild.massnahme === 'sperren') trefferMild.push(t);
    if (streng.massnahme === 'sperren') trefferStreng.push(t);
    if (mild.massnahme === 'alarm') alarme.push(t);

    await pause(120);
  }

  console.log('\n' + '='.repeat(70));
  console.log('ERGEBNIS DER MESSUNG AM BESTAND');
  console.log('='.repeat(70));
  console.log(`Konten insgesamt:            ${mitglieder.length}`);
  console.log(`davon über getChat erreicht: ${abgefragt}`);
  console.log(`ohne Antwort (Privatsphäre): ${ohneAntwort}`);
  console.log(`davon mit ausgefüllter Bio:  ${mitBio}`);
  console.log('');
  console.log(`GESPERRT WÜRDEN (Standard: Link + zweites Merkmal): ${trefferMild.length}`);
  console.log(`GESPERRT WÜRDEN (streng: Link genügt):              ${trefferStreng.length}`);
  console.log(`Nur gemeldet (Alarm):                               ${alarme.length}`);
  console.log('');

  const zeig = (titel: string, liste: Treffer[], max = 40) => {
    console.log(`--- ${titel} (${liste.length}) ---`);
    for (const t of liste.slice(0, max)) {
      console.log(`  ${t.userId} @${t.username || '-'} "${t.name}" | ${t.gruppen} Gruppen | seit ${t.ersterKontakt}`);
      console.log(`     Bio: ${JSON.stringify(t.bio)}`);
      console.log(`     -> ${t.grund}`);
    }
    if (liste.length > max) console.log(`  … und ${liste.length - max} weitere`);
    console.log('');
  };

  zeig('WÜRDEN GESPERRT (Standard)', trefferMild);
  zeig('ZUSÄTZLICH gesperrt im strengen Modus', trefferStreng.filter(s => !trefferMild.some(m => m.userId === s.userId)));
  zeig('NUR ALARM', alarme, 25);

  process.exit(0);
}

function pause(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => { console.error('FEHLER:', e.message, e.stack); process.exit(1); });
