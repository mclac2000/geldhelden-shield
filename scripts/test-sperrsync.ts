/**
 * test-sperrsync.ts -- gemeinsame Sperrliste GH-Shield -> MeinCEO (14.11.2026)
 *
 * Aufruf:  npm run test:sperrsync
 * Echte (temporaere) SQLite-Datenbank, lokaler HTTP-Server als MeinCEO-Ersatz. Prueft:
 *   1. Blacklist UND users.status='banned' werden gesammelt, Admins/Team nie,
 *   2. gesendet wird mit Bearer-Token und gueltiger Signatur (SHA-256 ueber token.zeit.body),
 *   3. nur Sperrdaten im Body (keine weiteren Felder),
 *   4. zweiter Lauf ohne Aenderung sendet nichts (idempotent),
 *   5. neue Sperre / neuer @Name wird nachgesendet,
 *   6. Fehlerantwort (401) -> Stand bleibt unveraendert, naechster Lauf sendet erneut,
 *   7. ohne URL/Token passiert nichts.
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sperrsync-'));
process.env.DB_PATH = path.join(tmp, 'shield.db');
process.env.BOT_TOKEN = '123456:testtoken-nicht-echt';
process.env.ADMIN_LOG_CHAT = '-100123';
process.env.ADMIN_IDS = '1';
const TOKEN = 'testtoken-nicht-echt';

import { getDatabase, addToBlacklist, addTeamMember } from '../src/db';
import { runSperrSync, unterschrift } from '../src/sperrSync';

const fehler: string[] = [];
const pruefe = (ok: boolean, text: string) => { if (!ok) fehler.push(text); };

async function main(): Promise<void> {
  const db = getDatabase();
  const neuerUser = (id: number, status = 'ok') => db.prepare('INSERT OR IGNORE INTO users (user_id, first_seen, status) VALUES (?, ?, ?)').run(id, Date.now(), status);
  const empfangen: any[] = [];
  let antwortStatus = 200;
  let verarbeitetDelta = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const zeit = Number(req.headers['x-sync-zeit']);
      const gueltig = req.headers.authorization === `Bearer ${TOKEN}` && req.headers['x-sync-signatur'] === unterschrift(TOKEN, zeit, body);
      empfangen.push({ gueltig, body: JSON.parse(body) });
      res.writeHead(antwortStatus, { 'Content-Type': 'application/json' });
      const n = JSON.parse(body).eintraege.length;
      res.end(JSON.stringify({ verarbeitet: n + verarbeitetDelta, neu: n, aktualisiert: 0 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as any).port;

  // Ohne URL/Token: nichts
  delete process.env.MEINCEO_SPERRSYNC_URL; delete process.env.MEINCEO_SPERRSYNC_TOKEN;
  pruefe((await runSperrSync()) === null && empfangen.length === 0, 'ohne Konfiguration wurde gesendet');
  process.env.MEINCEO_SPERRSYNC_URL = `http://127.0.0.1:${port}/api/community/sperrsync`;
  process.env.MEINCEO_SPERRSYNC_TOKEN = TOKEN;

  // Daten: 1000 Blacklist (mit Namen), 1001 nur status=banned, 1 = Admin (nie), 2000 sauber
  neuerUser(1000); db.prepare('UPDATE users SET username = ? WHERE user_id = ?').run('MCLac2o0o', 1000);
  addToBlacklist(1000, 0, 'Fake-Admin');
  neuerUser(1001, 'banned');
  neuerUser(1); addToBlacklist(1, 0, 'darf nie raus');
  neuerUser(2000);
  neuerUser(3000); addTeamMember(3000, 0, { username: 'teamer' }); addToBlacklist(3000, 0, 'Team');
  pruefe(db.prepare('SELECT COUNT(*) c FROM blacklist WHERE user_id = 3000').get().c === 1, 'Testaufbau: Team-Konto steht nicht in der Blacklist');
  pruefe(unterschrift('tok', 1700000000, '{"a":1}') === 'f4a65f6b4fdac18c93084faf1429731663c05c84bb79507290882c238ef8cadd', 'Signaturformel weicht vom festen Testwert ab');

  let r = await runSperrSync();
  pruefe(r?.gesendet === 2, `erster Lauf gesendet=${r?.gesendet}, erwartet 2`);
  pruefe(empfangen.length === 1 && empfangen[0].gueltig, 'Token/Signatur ungueltig');
  const ids = (empfangen[0]?.body.eintraege ?? []).map((e: any) => e.tg_user_id).sort();
  pruefe(JSON.stringify(ids) === '[1000,1001]', `ids=${JSON.stringify(ids)}, Admin/Sauber falsch behandelt`);
  pruefe(JSON.stringify(Object.keys(empfangen[0]?.body ?? {}).sort()) === '["eintraege","quelle"]' && empfangen[0]?.body.quelle === 'gh-shield', 'Body-Felder oder quelle falsch');
  const e1000 = empfangen[0]?.body.eintraege.find((e: any) => e.tg_user_id === 1000);
  pruefe(e1000?.username === 'mclac2o0o', `username=${e1000?.username}`);
  const erlaubt = ['tg_user_id', 'username', 'grund', 'gesperrt_at'];
  pruefe(Object.keys(e1000 ?? {}).every((k) => erlaubt.includes(k)), `unerlaubte Felder: ${Object.keys(e1000 ?? {})}`);

  r = await runSperrSync();
  pruefe(r?.gesendet === 0 && empfangen.length === 1, 'zweiter Lauf sendet erneut (nicht idempotent)');

  // neue Sperre + Name nachgereicht
  neuerUser(1002); addToBlacklist(1002, 0, 'neu');
  db.prepare('UPDATE users SET username = ? WHERE user_id = ?').run('spaeter_name', 1001);
  r = await runSperrSync();
  pruefe(r?.gesendet === 2 && empfangen.length === 2, `Nachsendung gesendet=${r?.gesendet}`);

  // Fehlerfall: 401 -> Stand bleibt, naechster Lauf sendet erneut
  neuerUser(1003); addToBlacklist(1003, 0, 'neu2');
  antwortStatus = 500; // Server liefert trotz Fehlercode eine scheinbar gueltige Bestaetigung
  r = await runSperrSync();
  pruefe(r === null, 'Fehlerantwort wurde nicht als Fehler erkannt');
  pruefe(db.prepare('SELECT COUNT(*) c FROM sperrsync_stand WHERE user_id = 1003').get().c === 0, 'Stand trotz Fehler gespeichert');
  pruefe(db.prepare("SELECT COUNT(*) c FROM sperrsync_log WHERE fehler IS NOT NULL").get().c === 1, 'Fehler nicht protokolliert');
  antwortStatus = 200; verarbeitetDelta = -1; // Bestaetigung nennt zu wenige
  r = await runSperrSync();
  pruefe(r === null && db.prepare('SELECT COUNT(*) c FROM sperrsync_stand WHERE user_id = 1003').get().c === 0, 'falsche Bestaetigungszahl akzeptiert');
  verarbeitetDelta = 0;
  r = await runSperrSync();
  pruefe(r?.gesendet === 1, `Wiederholung gesendet=${r?.gesendet}`);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fehler.length) {
    console.error('SPERRSYNC-TEST ROT:\n - ' + fehler.join('\n - '));
    process.exit(1);
  }
  console.log('SPERRSYNC-TEST OK (7 Pruefungen)');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
