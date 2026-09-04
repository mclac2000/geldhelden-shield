/**
 * capture-identity-reference.ts — Referenzdaten für den Impersonations-Schutz erfassen
 *
 * Liest über die Telegram-API den aktuellen Profilfoto-Fingerabdruck und die Namen
 * der zu schützenden Accounts und gibt die fertigen .env-Zeilen aus.
 *
 * Aufruf:
 *   npx ts-node scripts/capture-identity-reference.ts                 # Standard: 382863507 (@McLac2000)
 *   npx ts-node scripts/capture-identity-reference.ts 382863507 12345 # eigene IDs
 *
 * WICHTIG: Wenn Marco sein Profilbild wechselt, ändert sich der Fingerabdruck.
 * Dann muss dieses Skript erneut laufen und PROTECTED_PHOTO_IDS aktualisiert werden.
 * Solange der alte Wert drinsteht, schützt er weiterhin gegen Kopien des alten Bildes —
 * es schadet also nicht, alte Werte stehen zu lassen.
 */

import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_IDS = [382863507]; // Marco, @McLac2000

async function main(): Promise<void> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.error('❌ BOT_TOKEN fehlt (in .env).');
    process.exit(1);
  }

  const args = process.argv.slice(2).map(a => parseInt(a, 10)).filter(n => !isNaN(n));
  const ids = args.length > 0 ? args : DEFAULT_IDS;

  const photoIds: string[] = [];
  const names: string[] = [];

  for (const id of ids) {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${id}`);
    const data: any = await res.json();

    if (!data.ok) {
      console.error(`❌ ${id}: ${data.description}`);
      console.error('   Der Bot muss den Account kennen (gemeinsame Gruppe oder Chat).');
      continue;
    }

    const r = data.result;
    const display = `${r.first_name || ''} ${r.last_name || ''}`.trim();
    const fp = r.photo?.big_file_unique_id;

    console.log(`\n=== ${id} ===`);
    console.log(`  Anzeigename:      ${display || '(keiner)'}`);
    console.log(`  Benutzername:     @${r.username || '(keiner)'}`);
    console.log(`  Profilfoto-ID:    ${fp || '(kein Foto)'}`);
    console.log(`  Bio:              ${r.bio || '(keine)'}`);
    console.log(`  Weiterleitungen verborgen: ${r.has_private_forwards ? 'ja' : 'nein'}`);

    if (fp) photoIds.push(fp);
    if (display) names.push(display);
    if (r.username) names.push(r.username);

    await new Promise(r2 => setTimeout(r2, 300)); // schonend gegen Rate-Limits
  }

  if (photoIds.length === 0) {
    console.error('\n❌ Kein Profilfoto erfasst — PROTECTED_PHOTO_IDS kann nicht gesetzt werden.');
    process.exit(1);
  }

  // "Geldhelden" bleibt als Markenname immer geschützt.
  // Bewusst NICHT enthalten: der bloße Vorname "Marco". Eine Messung gegen die
  // Produktionsdatenbank ergab 23 echte Mitglieder mit diesem Namen und 64
  // Fehlalarme — der Vorname allein ist als Schutzname unbrauchbar.
  const uniqueNames = Array.from(new Set([...names, 'Geldhelden', 'Geldhelden Team', 'Geldhelden Support']));

  console.log(`\n${'='.repeat(64)}`);
  console.log('Diese Zeilen in die .env auf dem Server eintragen:');
  console.log('='.repeat(64));
  console.log(`PROTECTED_USER_IDS=${ids.join(',')}`);
  console.log(`PROTECTED_PHOTO_IDS=${Array.from(new Set(photoIds)).join(',')}`);
  console.log(`PROTECTED_NAMES=${uniqueNames.join(',')}`);
  console.log(`IMPERSONATION_AUTO_BAN=false`);
  console.log('='.repeat(64));
  console.log('\nHinweis: IMPERSONATION_AUTO_BAN steht bewusst auf false.');
  console.log('Erst ein paar Tage die Meldungen im Admin-Chat beobachten (/identity alarms),');
  console.log('dann auf true stellen. Not-Aus jederzeit mit /panic on.');
}

main().catch(err => {
  console.error('Fehler:', err);
  process.exit(1);
});
