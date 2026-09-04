/**
 * test-campaign-links.ts — Tests für die Erkennung von Werbe-Wellen
 *
 * Aufruf:  npm run test:links
 *
 * Schwerpunkt liegt auf den Fehlalarm-Fällen: eigene Links, Telegram-Funktionen,
 * Nachrichtenlinks und alles, was auf dasselbe Ziel zeigt und deshalb denselben
 * Schlüssel ergeben muss.
 */

import { normalizeTelegramLink, extractTelegramLinks } from '../src/campaignLinks';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      erwartet: ${JSON.stringify(expected)}\n      erhalten: ${JSON.stringify(actual)}`);
  }
}

console.log('\n=== 1. Öffentliche Gruppen-Links ===');
check('einfach', normalizeTelegramLink('https://t.me/geldhelden'), 'public:geldhelden');
check('ohne Protokoll', normalizeTelegramLink('t.me/geldhelden'), 'public:geldhelden');
check('mit www', normalizeTelegramLink('https://www.t.me/geldhelden'), 'public:geldhelden');
check('Großschreibung', normalizeTelegramLink('https://T.ME/GeldHelden'), 'public:geldhelden');
check('telegram.me', normalizeTelegramLink('https://telegram.me/geldhelden'), 'public:geldhelden');
check('telegram.dog', normalizeTelegramLink('https://telegram.dog/geldhelden'), 'public:geldhelden');

console.log('\n=== 2. Gleiches Ziel muss gleichen Schlüssel ergeben ===');
const ziel = 'public:fakegruppe';
check('Nachrichtenlink', normalizeTelegramLink('https://t.me/fakegruppe/1234'), ziel);
check('Vorschau-Link /s/', normalizeTelegramLink('https://t.me/s/fakegruppe'), ziel);
check('mit Parametern', normalizeTelegramLink('https://t.me/fakegruppe?start=abc'), ziel);
check('mit Anker', normalizeTelegramLink('https://t.me/fakegruppe#top'), ziel);
check('Schrägstrich am Ende', normalizeTelegramLink('https://t.me/fakegruppe/'), ziel);

console.log('\n=== 3. Einladungslinks ===');
check('Plus-Form', normalizeTelegramLink('https://t.me/+AbCdEfGh'), 'invite:AbCdEfGh');
check('joinchat-Form', normalizeTelegramLink('https://t.me/joinchat/AbCdEfGh'), 'invite:AbCdEfGh');
check('Plus und joinchat gleich', normalizeTelegramLink('t.me/+XyZ12345'), normalizeTelegramLink('t.me/joinchat/XyZ12345'));

console.log('\n=== 4. KEINE Kampagnen-Links (Fehlalarm-Schutz) ===');
for (const [label, url] of [
  ['Weiterleiten-Funktion', 'https://t.me/share/url?url=https://geldhelden.org'],
  ['Sticker', 'https://t.me/addstickers/Katzen'],
  ['Emoji-Paket', 'https://t.me/addemoji/Irgendwas'],
  ['Proxy', 'https://t.me/proxy?server=1.2.3.4'],
  ['Instant View', 'https://t.me/iv?url=x'],
  ['Sprachpaket', 'https://t.me/setlanguage/de'],
  ['private Chat-ID-Form', 'https://t.me/c/1234567890/55'],
  ['fremde Domain', 'https://example.com/geldhelden'],
  ['Webseite', 'https://geldhelden.org/kurs'],
  ['zu kurzer Name', 'https://t.me/ab'],
  ['leer', ''],
] as [string, string][]) {
  check(`kein Ziel: ${label}`, normalizeTelegramLink(url), null);
}

console.log('\n=== 5. Extraktion aus Nachrichten ===');
check(
  'Fließtext',
  extractTelegramLinks('Schau mal hier: t.me/fakegruppe und auch https://t.me/andere', undefined).map(l => l.key).sort(),
  ['public:andere', 'public:fakegruppe']
);
check(
  'Entdopplung gleicher Ziele',
  extractTelegramLinks('t.me/fakegruppe und t.me/fakegruppe/99 und t.me/s/fakegruppe', undefined).length,
  1
);
check(
  'versteckter Link (text_link)',
  extractTelegramLinks('Hier klicken', [{ type: 'text_link', offset: 0, length: 12, url: 'https://t.me/fakegruppe' }]).map(l => l.key),
  ['public:fakegruppe']
);
check('Nachricht ohne Link', extractTelegramLinks('Guten Morgen zusammen!', undefined).length, 0);
check('nur Webseite', extractTelegramLinks('Siehe https://geldhelden.org', undefined).length, 0);
check(
  'Link in Klammern',
  extractTelegramLinks('(siehe t.me/fakegruppe)', undefined).map(l => l.key),
  ['public:fakegruppe']
);

console.log('\n=== 5b. Fremde Domains dürfen NICHT als Telegram-Link gelten (Review-Befunde) ===');
for (const [label, text] of [
  ['Domain endet auf t.me', 'Besuch chat.me/fakegruppe mal'],
  ['payt.me', 'https://payt.me/gruppe123'],
  ['t.me im Pfad', 'https://example.com/assets/t.me/geldhelden'],
  ['Benutzeranteil in der URL', 'https://t.me@evil.com/gruppe'],
  ['Subdomain', 'https://böse.t.me.evil.com/gruppe'],
] as [string, string][]) {
  check(`kein Treffer: ${label}`, extractTelegramLinks(text, undefined).length, 0);
}
check('echter Link nach Satzzeichen', extractTelegramLinks('Siehe: t.me/fakegruppe', undefined).length, 1);
check('echter Link am Zeilenanfang', extractTelegramLinks('t.me/fakegruppe', undefined).length, 1);

console.log('\n=== 5c. Einladungs-Hashes ===');
check(
  'Groß/Klein bleibt erhalten (verschiedene Gruppen!)',
  normalizeTelegramLink('t.me/+AbCdEfGh') === normalizeTelegramLink('t.me/+abcdefgh'),
  false
);
check('zu kurzer Hash wird verworfen', normalizeTelegramLink('t.me/+abc'), null);
check('überlanger Hash wird verworfen', normalizeTelegramLink('t.me/+' + 'A'.repeat(200)), null);
check(
  'Schlüssel bleibt unter der callback_data-Grenze',
  (normalizeTelegramLink('t.me/+' + 'A'.repeat(48)) || '').length <= 60,
  true
);

console.log('\n=== 6. Der Angriff aus der Meldung ===');
check(
  'Einladung in Fake-Gruppe',
  extractTelegramLinks('Hey! In dieser Gruppe kannst du was gewinnen 🎁 https://t.me/GeldHelden_Gewinnspiel2026', undefined).map(l => l.key),
  ['public:geldhelden_gewinnspiel2026']
);
check(
  'privater Einladungslink',
  extractTelegramLinks('Komm rein: t.me/+Qw3rTy9zAbC', undefined).map(l => l.key),
  ['invite:Qw3rTy9zAbC']
);

console.log(`\n${'='.repeat(50)}`);
console.log(`Bestanden: ${passed}   Fehlgeschlagen: ${failed}`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
