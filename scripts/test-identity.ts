/**
 * test-identity.ts — Tests für die Impersonations-Erkennung
 *
 * Aufruf:  npx ts-node scripts/test-identity.ts
 *
 * Prüft die neue Logik gegen echte Fälle aus der Produktionsdatenbank
 * (Namen, die die ALTE Logik fälschlich als Fälschung markiert hätte) sowie
 * gegen konstruierte Angriffe.
 */

import {
  normalizeIdentityName,
  hasInvisibleChars,
  hasMixedScript,
  analyzeIdentity,
  decideImpersonation,
} from '../src/identity';

const PROTECTED = ['Marco McLac2000', 'McLac2000', 'Geldhelden', 'Geldhelden Team', 'Geldhelden Support'];
const THRESHOLD = 80;
const REAL_MARCO = 382863507;
const PROTECTED_USERS = [REAL_MARCO];

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      erwartet: ${JSON.stringify(expected)}\n      erhalten: ${JSON.stringify(actual)}`);
  }
}

function verdictFor(
  first: string | null, last: string | null, user: string | null,
  photoMatch = false, userId = 999999
): string {
  const a = analyzeIdentity(first, last, user, PROTECTED, THRESHOLD);
  return decideImpersonation(a, photoMatch, userId, PROTECTED_USERS).action;
}

console.log('\n=== 1. Normalisierung ===');
check('Homoglyph kyrillisch a', normalizeIdentityName('Mаrco'), normalizeIdentityName('Marco'));
check('Homoglyph kyrillisch e in Geldhelden', normalizeIdentityName('Gеldhelden'), normalizeIdentityName('Geldhelden'));
check('Zero-Width wird entfernt', normalizeIdentityName('Mar​co'), normalizeIdentityName('Marco'));
check('Soft-Hyphen wird entfernt', normalizeIdentityName('Mar­co'), normalizeIdentityName('Marco'));
check('Mehrfach-Leerzeichen', normalizeIdentityName('Marco   McLac2000'), normalizeIdentityName('Marco McLac2000'));

console.log('\n=== 2. Täuschungsmerkmale ===');
check('unsichtbares Zeichen erkannt', hasInvisibleChars('Mar​co'), true);
check('normaler Name ohne unsichtbare Zeichen', hasInvisibleChars('Marco'), false);
check('Emoji-ZWJ ist KEIN Täuschungsmerkmal', hasInvisibleChars('Gudrun 🧑‍🦰'), false);
check('Emoji-Familie ist KEIN Täuschungsmerkmal', hasInvisibleChars('Jasmin 👩‍👧‍👦'), false);
check('Schriftmix erkannt', hasMixedScript('Mаrco'), true);
check('reines Latein kein Schriftmix', hasMixedScript('Marco'), false);
check('Umlaute sind kein Schriftmix', hasMixedScript('Jürgen Müller'), false);

console.log('\n=== 2b. Echte Mitglieder mit kyrillischen Namen: kein Alarm ===');
// Aus der Produktionsdatenbank — 63 solcher Mitglieder lösten in der ersten
// Fassung einen Fehlalarm aus.
for (const [first, last] of [
  ['Александр Фишер', 'Alexander Fischer'], ['Дмитро', 'Berger'], ['Iurii', 'Зарков'],
  ['Raghu', 'Беков'], ['jack', 'Козлов'], ['Naстя', null], ['Каte', null],
] as [string, string | null][]) {
  check(`kein Alarm: ${first} ${last || ''}`, verdictFor(first, last, null), 'none');
}

console.log('\n=== 3. Echte Mitglieder dürfen NICHT gesperrt werden ===');
// Diese Namen stammen aus der Produktionsdatenbank und wurden von der ALTEN
// Logik zu 95 % als Fälschung eingestuft.
for (const [first, last, user] of [
  ['A', null, null], ['E', null, null], ['M', null, null], ['MA', null, null],
  ['AM', null, 'drschoenholz'], ['S', null, 'susasusa11'], ['L', null, 'l_h_01'],
  ['Z', null, null], ['R', null, null], ['m', null, null], ['D', null, 'AutismusCoaching'],
  ['N', null, 'Nils_Phangan'], ['Marc', null, null],
] as [string, string | null, string | null][]) {
  check(`kein Ban: "${first}" @${user || '-'}`, verdictFor(first, last, user), 'none');
}

console.log('\n=== 4. Echte Mitglieder namens Marco: Alarm erlaubt, Ban NICHT ===');
for (const [first, user] of [['Marco', 'die_Urkraft'], ['Marco', 'steinjaeger'], ['marco', null], ['Marco', 'powermarco1000']] as [string, string | null][]) {
  const v = verdictFor(first, null, user);
  check(`kein Ban für echten Marco (@${user || '-'})`, v === 'ban', false);
}

console.log('\n=== 5. Marco selbst wird nie angefasst ===');
check('echter Account, Foto passt', verdictFor('Marco', 'McLac2000', 'McLac2000', true, REAL_MARCO), 'none');
check('echter Account ohne Foto', verdictFor('Marco', 'McLac2000', 'McLac2000', false, REAL_MARCO), 'none');

console.log('\n=== 6. Angriffe werden erkannt ===');
check('geklautes Profilfoto -> Ban', verdictFor('Lisa', null, 'lisa_k92', true), 'ban');
check('geklautes Foto trotz harmlosem Namen -> Ban', verdictFor('Klaus Meier', null, null, true), 'ban');
check('kyrillisches Marco McLac2000 -> Ban', verdictFor('Mаrco', 'McLac2000', null), 'ban');
check('Geldhelden mit kyrillischem e -> Ban', verdictFor('Gеldhelden Support', null, null), 'ban');
check('unsichtbares Zeichen im Namen -> Ban', verdictFor('Marco​ McLac2000', null, null), 'ban');
check('exakter Name ohne Trick -> nur Alarm', verdictFor('Marco McLac2000', null, null), 'alarm');
check('Username-Kopie -> mindestens Alarm', verdictFor('Support', null, 'McLac2OOO') !== 'none', true);
check('Geldhelden Support Kopie -> Alarm', verdictFor('Geldhelden Support', null, null), 'alarm');
check('Teilstring Geldhelden -> Alarm', verdictFor('Geldhelden Gewinnspiel', null, null), 'alarm');

console.log('\n=== 6c. KEIN Ban bei harmlosen Sonderzeichen (Review-Befunde) ===');
// Diese Fälle hätten in der ersten Fassung zu einer Sperre geführt:
// Emoji mit Hautfarben-Modifier zerbrach die Emoji-Erkennung, und ein
// kyrillischer Vorname galt als Täuschungsmerkmal — obwohl "Geldhelden"
// im Namen ganz normal lateinisch geschrieben war.
check('Hautfarben-Emoji: kein Ban', verdictFor('Anna | Geldhelden Community 🙋🏼‍♀️', null, null), 'alarm');
check('Hautfarben-Emoji 2: kein Ban', verdictFor('Geldhelden Support 👨🏼‍💼', null, null), 'alarm');
check('kyrillischer Vorname + Marke: kein Ban', verdictFor('Олена Geldhelden Team', null, null), 'alarm');
check('kyrillischer Name + Marke 2: kein Ban', verdictFor('Дмитро Berger | Geldhelden', null, null), 'alarm');
check('Tippfehler löst keinen Ban aus', verdictFor('Geldheldn', null, null) !== 'ban', true);
check('Botschafter mit Marke im Namen: kein Ban', verdictFor('Sergej Geldhelden', null, null), 'alarm');

console.log('\n=== 6b. Echte Fälscher aus der Produktionsdatenbank ===');
// Diese Accounts stecken bereits in baseline_members. Alle imitieren Marcos
// Username mit O/0/o- bzw. z/2-Vertauschungen.
for (const [first, last, user] of [
  ['Marco', 'LA', 'McLac20OO'],
  ['Marco', 'Support', 'McLac2ooo'],
  ['Marco', 'LA', 'McLacz000'],
  ['Marco', 'LA', 'Mc_Lac2000'],
  ['Marco LA', null, 'McLac2O0O'],
  ['Marco', 'LA', 'McLac200000'],
  ['GELDHELDEN', null, 'Geldheldenkrypto'],
  ['Geldhelden Shield', null, 'KlausAssenmacher1974'],
] as [string, string | null, string][]) {
  check(`erkannt: "${first}" @${user}`, verdictFor(first, last, user) !== 'none', true);
}

console.log('\n=== 7. Unbeteiligte Namen bleiben unberührt ===');
for (const [first, last] of [
  ['Sabine', 'Weber'], ['Thomas', null], ['Klaus', 'Schmidt'], ['Lisa', null],
  ['Jürgen', 'Müller'], ['Andreas', 'Hoffmann'], ['Geld', null], ['Held', null],
] as [string, string | null][]) {
  check(`unberührt: ${first} ${last || ''}`, verdictFor(first, last, null), 'none');
// --- Emoji-Sequenzen mit Hautton (gefunden in der Messung am 05.09.2026) ---
// Zwei echte Mitglieder seit Januar trugen "🧘🏼‍♀️" bzw. "🧑🏼‍🌾" im Namen.
// Ohne die Hautton-Modifikatoren in der Verbinderklasse brach die Sequenz nach
// dem ersten Emoji ab, der ZWJ dahinter blieb stehen und galt als
// Verschleierung.
console.log('\n=== Emoji-Sequenzen mit Hautton ===');
check('Yoga-Emoji mit Hautton und ZWJ ist unauffaellig',
  hasInvisibleChars('Jasmin Schwarberg \u{1F525}\u{1F32A}\uFE0F\u{1F9D8}\u{1F3FC}\u200D\u2640\uFE0F'), false);
check('Bauern-Emoji mit Hautton und ZWJ ist unauffaellig',
  hasInvisibleChars('Gudrun \u{1F9D1}\u{1F3FC}\u200D\u{1F33E}'), false);
check('Familien-Emoji (mehrfach ZWJ) ist unauffaellig',
  hasInvisibleChars('\u{1F468}\u200D\u{1F469}\u200D\u{1F466} Familie'), false);
check('ZWJ OHNE Emoji davor bleibt auffaellig',
  hasInvisibleChars('\u200DDon Pedro'), true);
check('Zero-Width mitten im Wort bleibt auffaellig',
  hasInvisibleChars('Geld\u200Bhelden'), true);

}

console.log(`\n${'='.repeat(50)}`);
console.log(`Bestanden: ${passed}   Fehlgeschlagen: ${failed}`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
