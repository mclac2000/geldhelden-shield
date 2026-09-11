/**
 * pruefe-lernprotokoll.ts — Positivkontrolle für den Schreibweg.
 *
 * Beweist, dass logFirstMessageSample tatsächlich schreibt und
 * markSamplesGesperrt tatsächlich markiert. Räumt hinter sich auf.
 *
 * Hintergrund: Eine leere Tabelle kann „nichts passiert" heißen oder
 * „Schreibweg kaputt". Ohne diese Kontrolle ist die Null nicht deutbar.
 */
process.env.DB_PATH = process.env.DB_PATH || '/data/shield.db';

import { getDatabase, logFirstMessageSample, markSamplesGesperrt, getVerpassteFaelle } from '../src/db';

const TEST_ID = -999999;
const db = getDatabase();
let fehler = 0;
const pruefe = (n: string, ok: boolean) => { if (!ok) fehler++; console.log(`${ok ? '✅' : '❌'} ${n}`); };

db.prepare('DELETE FROM first_message_samples WHERE user_id = ?').run(TEST_ID);

logFirstMessageSample({
  userId: TEST_ID, chatId: '-100TEST', username: 'kontrolle',
  anzeigename: 'Positivkontrolle', nachrichtNr: 1, punkte: 15,
  inhaltlicheGruppen: 1, signale: ['test_signal'], text: 'Kontrolltext, wird gleich geloescht.',
});

const nachher = db.prepare('SELECT * FROM first_message_samples WHERE user_id = ?').get(TEST_ID) as any;
pruefe('Probe wurde geschrieben', !!nachher);
pruefe('Text kam vollstaendig an', nachher?.text === 'Kontrolltext, wird gleich geloescht.');
pruefe('Punkte kamen an', nachher?.punkte === 15);
pruefe('Noch nicht als gesperrt markiert', nachher?.gesperrt === 0);

markSamplesGesperrt(TEST_ID);
const markiert = db.prepare('SELECT gesperrt FROM first_message_samples WHERE user_id = ?').get(TEST_ID) as any;
pruefe('Sperr-Markierung greift', markiert?.gesperrt === 1);

const faelle = getVerpassteFaelle(50);
pruefe('Taucht in der Auswertung auf', faelle.some((f: any) => f.user_id === TEST_ID));

db.prepare('DELETE FROM first_message_samples WHERE user_id = ?').run(TEST_ID);
const weg = db.prepare('SELECT COUNT(*) c FROM first_message_samples WHERE user_id = ?').get(TEST_ID) as any;
pruefe('Kontrolldatensatz wieder entfernt', weg?.c === 0);

console.log(`\n${fehler === 0 ? 'Schreibweg nachgewiesen.' : 'SCHREIBWEG DEFEKT.'}`);
process.exit(fehler > 0 ? 1 : 0);
