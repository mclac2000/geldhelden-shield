/**
 * test-identitaet.ts — Prüft, dass das Mitschreiben von Name und Premium wirkt.
 *
 * Nimmt ein bereits vorhandenes Konto, schreibt dessen Identität mit einem
 * erfundenen Testwert mit, prüft das Ergebnis in der Datenbank und macht die
 * Änderung danach wieder rückgängig.
 *
 * Aufruf: docker exec geldhelden-shield-bot npx tsx scripts/test-identitaet.ts
 */
process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { getDatabase } from '../src/db';
import { merkeIdentitaet, merkeAusFrom } from '../src/identitaet';

let fehler = 0;
function pruefe(ok: boolean, text: string): void {
  if (!ok) fehler++;
  console.log('  ' + (ok ? 'OK  ' : 'FEHLER  ') + text);
}

const db = getDatabase();

// Ein beliebiges vorhandenes Konto als Versuchskaninchen.
const opfer = db.prepare('SELECT user_id FROM users WHERE user_id > 0 ORDER BY user_id LIMIT 1')
  .get() as { user_id: number } | undefined;
if (!opfer) {
  console.log('Keine Konten in der Datenbank — Test nicht möglich.');
  process.exit(1);
}
const uid = opfer.user_id;
const vorher = db.prepare(
  'SELECT username, first_name, last_name FROM users WHERE user_id = ?'
).get(uid) as any;

console.log('=== 1. Spalten werden angelegt ===');
merkeIdentitaet(uid, { username: null, firstName: null, lastName: null, isPremium: null });
const spalten = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>)
  .map((s) => s.name);
pruefe(spalten.includes('is_premium'), 'Spalte users.is_premium vorhanden');
pruefe(spalten.includes('identitaet_gesehen_at'), 'Spalte users.identitaet_gesehen_at vorhanden');

console.log('');
console.log('=== 2. Identität wird geschrieben ===');
const marke = 'pruef_' + Date.now();
merkeIdentitaet(uid, {
  username: marke, firstName: 'Testvorname', lastName: 'Testnachname', isPremium: true,
});
const nachher = db.prepare(
  'SELECT username, first_name, last_name, is_premium, has_username, identitaet_gesehen_at FROM users WHERE user_id = ?'
).get(uid) as any;
pruefe(nachher.username === marke, 'username geschrieben: ' + nachher.username);
pruefe(nachher.first_name === 'Testvorname', 'first_name geschrieben');
pruefe(nachher.last_name === 'Testnachname', 'last_name geschrieben');
pruefe(nachher.is_premium === 1, 'is_premium geschrieben');
pruefe(nachher.has_username === 1, 'has_username automatisch auf 1 gesetzt');
pruefe(!!nachher.identitaet_gesehen_at, 'Zeitstempel gesetzt');

console.log('');
console.log('=== 3. Änderung landet im Namensverlauf ===');
const verlauf = db.prepare(
  'SELECT COUNT(*) AS n FROM user_name_history WHERE user_id = ? AND username = ?'
).get(uid, marke) as any;
pruefe(verlauf.n >= 1, 'Eintrag in user_name_history angelegt');

console.log('');
console.log('=== 4. Premium aus einem Telegram-Objekt ===');
merkeAusFrom({ id: uid, is_bot: false, username: marke, first_name: 'Testvorname', is_premium: false });
const p2 = db.prepare('SELECT is_premium FROM users WHERE user_id = ?').get(uid) as any;
pruefe(p2.is_premium === 0, 'is_premium=false wird als 0 gespeichert (nicht als null)');

console.log('');
console.log('=== 5. Aufräumen ===');
db.prepare('UPDATE users SET username = ?, first_name = ?, last_name = ?, is_premium = NULL WHERE user_id = ?')
  .run(vorher.username, vorher.first_name, vorher.last_name, uid);
db.prepare('DELETE FROM user_name_history WHERE user_id = ? AND username = ?').run(uid, marke);
const zurueck = db.prepare('SELECT username, first_name FROM users WHERE user_id = ?').get(uid) as any;
pruefe(zurueck.username === vorher.username && zurueck.first_name === vorher.first_name,
  'Testkonto wieder im Ursprungszustand');

console.log('');
console.log('='.repeat(60));
console.log(fehler === 0 ? 'TEST BESTANDEN' : 'TEST FEHLGESCHLAGEN: ' + fehler + ' Abweichung(en)');
console.log('='.repeat(60));
process.exit(fehler === 0 ? 0 : 1);
