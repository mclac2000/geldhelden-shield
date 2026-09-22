/**
 * dunkelziffer-krypto.ts — Wie viele solche Posts stehen unbeanstandet im Bestand?
 *
 * Marcos Frage: „Wenn dieser eine aufgefallen ist, weil Marco ihn zufällig
 * gesehen hat, ist die Dunkelziffer die eigentliche Nachricht."
 *
 * Die ehrliche Antwort vorweg, damit sie nicht untergeht: **Die Dunkelziffer
 * lässt sich nicht beziffern.** Nicht weil die Suche zu aufwendig wäre,
 * sondern weil es nichts zu durchsuchen gibt — Shield speichert
 * Gruppennachrichten erst seit dem 11.09.2026, und auch dann nur die ersten
 * fünf je Konto und Gruppe. Ein Bestandskonto, das im Mai einen solchen Post
 * abgesetzt hat, hinterlässt in dieser Datenbank keine Spur.
 *
 * Telegram hilft dabei nicht: Ein Bot kann keine Nachrichtenhistorie einer
 * Gruppe abrufen. Es gibt keine API dafür, und das ist Absicht.
 *
 * Was dieses Skript stattdessen tut: Es beziffert, WIE GROSS der blinde
 * Fleck ist — wie viel Text überhaupt existiert, über welchen Zeitraum, und
 * wie viel davon fehlt. Eine Dunkelziffer, deren Größe man kennt, ist besser
 * als eine, die man für null hält.
 */

process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { getDatabase } from '../src/db';

function main(): void {
  const db = getDatabase();
  const eins = (sql: string, ...p: any[]): any => { try { return db.prepare(sql).get(...p); } catch { return null; } };

  console.log('='.repeat(70));
  console.log('DUNKELZIFFER: was durchsuchbar ist und was nicht');
  console.log('='.repeat(70) + '\n');

  const proben = eins(`SELECT COUNT(*) AS zeilen, COUNT(DISTINCT user_id) AS konten,
    datetime(MIN(created_at)/1000,'unixepoch') AS von,
    datetime(MAX(created_at)/1000,'unixepoch') AS bis FROM first_message_samples`);
  const bios = eins(`SELECT COUNT(*) AS n FROM user_profiles WHERE bio IS NOT NULL AND bio != ''`);
  const scam = eins(`SELECT COUNT(*) AS zeilen, COUNT(DISTINCT user_id) AS konten,
    datetime(MIN(created_at)/1000,'unixepoch') AS von FROM scam_events`);
  const mitglieder = eins(`SELECT COUNT(DISTINCT user_id) AS n FROM baseline_members WHERE is_bot = 0`);
  const gruppen = eins(`SELECT COUNT(*) AS n FROM groups WHERE status = 'managed'`);
  const aelteste = eins(`SELECT datetime(MIN(first_seen_at)/1000,'unixepoch') AS t FROM baseline_members`);

  console.log('DURCHSUCHBAR (Volltext vorhanden):');
  console.log(`  Gruppennachrichten:       ${proben?.zeilen ?? 0} von ${proben?.konten ?? 0} Konten`);
  console.log(`  Zeitraum:                 ${proben?.von ?? '—'} bis ${proben?.bis ?? '—'}`);
  console.log(`  Profil-Bios:              ${bios?.n ?? 0}`);

  console.log('\nNICHT DURCHSUCHBAR (kein Text gespeichert):');
  console.log(`  Scam-Ereignisse:          ${scam?.zeilen ?? 0} Zeilen von ${scam?.konten ?? 0} Konten`);
  console.log(`                            seit ${scam?.von ?? '—'} — nur Punktzahl und Gründe, kein Wortlaut`);
  console.log(`  Alle übrigen Nachrichten: nirgends gespeichert`);

  console.log('\nGRÖSSE DES BLINDEN FLECKS:');
  console.log(`  Verwaltete Gruppen:       ${gruppen?.n ?? 0}`);
  console.log(`  Bekannte Mitglieder:      ${mitglieder?.n ?? 0}`);
  console.log(`  Älteste Spur im Bestand:  ${aelteste?.t ?? '—'}`);

  if (proben?.von && aelteste?.t) {
    const tageText = Math.max(0, Math.round((Date.now() - new Date(proben.von + 'Z').getTime()) / 86400000));
    const tageGesamt = Math.max(1, Math.round((Date.now() - new Date(aelteste.t + 'Z').getTime()) / 86400000));
    console.log(`\n  Tage mit gespeichertem Text:   ${tageText}`);
    console.log(`  Tage seit Bestehen:            ${tageGesamt}`);
    console.log(`  → durchsuchbar sind rund ${Math.round(tageText / tageGesamt * 100)} % der Zeit,`);
    console.log(`    und auch dort nur die ersten fünf Nachrichten je Konto und Gruppe.`);
  }

  console.log('\n' + '-'.repeat(70));
  console.log('ANTWORT AUF DIE FRAGE NACH DER DUNKELZIFFER:');
  console.log('Sie ist nicht bezifferbar, und zwar aus einem Grund, der sich');
  console.log('nicht durch mehr Rechenzeit beheben lässt: Der Text existiert');
  console.log('nicht mehr. Ein Bot kann bei Telegram keine Nachrichtenhistorie');
  console.log('nachladen.');
  console.log('');
  console.log('Ab heute ändert sich das für die Zukunft: Die Krypto-Erkennung');
  console.log('schreibt jeden Treffer mit Wortlaut in crypto_events. In vier');
  console.log('Wochen ist diese Frage beantwortbar — rückwirkend nie.');
  console.log('-'.repeat(70));

  process.exit(0);
}

main();
