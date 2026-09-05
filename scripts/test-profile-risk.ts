/**
 * test-profile-risk.ts — Tests für die Profilprüfung beim Beitritt
 *
 * Aufruf:  npm run test:profile
 *
 * Schwerpunkt: der gemeldete Fall, Verschleierungen — und vor allem die
 * Gegenprobe mit Profilen echter Mitglieder einer Selbstständigen-Community.
 */

import {
  entschleiereFuerLinks, analysiereProfil, entscheideProfil, istWegwerfName,
} from '../src/profileRisk';

let ok = 0, fehl = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok++;
  else {
    fehl++;
    console.log(`  ✗ ${name}\n      erwartet: ${JSON.stringify(expected)}\n      erhalten: ${JSON.stringify(actual)}`);
  }
}

/** Freigabeliste wie im Betrieb: unsere eigenen Gruppen */
const EIGENE = new Set(['public:geldhelden', 'public:ghberlin', 'invite:8mSDOD6HNMA2MTk9']);
const frei = (k: string) => EIGENE.has(k);

function urteil(bio: string | null, username: string | null, dubletten: number[] = [], streng = false) {
  return entscheideProfil(
    analysiereProfil({ bio, username, istLinkFreigegeben: frei, fotoDublettenIds: dubletten }),
    streng
  ).massnahme;
}

console.log('\n=== 1. Entschleierung ===');
check('Leerzeichen um Punkte', entschleiereFuerLinks('t . me / +abc'), 't.me/+abc');
check('Punkt als Wort', entschleiereFuerLinks('t dot me/+abc'), 't.me/+abc');
check('Punkt in Klammern', entschleiereFuerLinks('t(dot)me/+abc'), 't.me/+abc');
check('Homoglyph-Punkt U+2024', entschleiereFuerLinks('t․me/+abc'), 't.me/+abc');
check('kyrillisches e', entschleiereFuerLinks('t.mе/+abc'), 't.me/+abc');
check('normaler Text bleibt', entschleiereFuerLinks('Hallo Welt'), 'Hallo Welt');

console.log('\n=== 2. Der gemeldete Fall ===');
const fall = analysiereProfil({
  bio: 'Kopiere es von ihm: https://t.me/+YLLIqnYu11BjMDA1',
  username: 'Glc43amg_e_performance',
  istLinkFreigegeben: frei,
});
check('fremder Link erkannt', fall.fremdeLinks, ['invite:YLLIqnYu11BjMDA1']);
check('Aufforderungssprache erkannt', fall.textSignale.includes('aufforderung_kopieren'), true);
check('wird gesperrt', entscheideProfil(fall).massnahme, 'sperren');

console.log('\n=== 3. Verschleierte Varianten desselben Angriffs ===');
for (const [label, bio] of [
  ['Leerzeichen', 'Schau hier: t . me / +YLLIqnYu11BjMDA1'],
  ['dot als Wort', 'Gruppe: t dot me/+YLLIqnYu11BjMDA1'],
  ['Homoglyph-Punkt', 'Hier: t․me/+YLLIqnYu11BjMDA1'],
] as [string, string][]) {
  check(`gesperrt trotz Verschleierung (${label})`, urteil(bio, 'irgendwer123'), 'sperren');
}

console.log('\n=== 4. KEIN Signal: eigene Gruppen (Botschafter-Schutz) ===');
check('eigene Gruppe verlinkt', urteil('Mehr dazu: https://t.me/geldhelden', 'sabine_weber'), 'keine');
check('eigener Einladungslink', urteil('Komm rein: t.me/+8mSDOD6HNMA2MTk9', 'klaus_m'), 'keine');
check('eigene Gruppe trotz Aufforderung', urteil('Tritt der Gruppe bei: t.me/ghberlin', 'thomas_b'), 'keine');

console.log('\n=== 5. KEIN Signal: normale Profile von Selbstständigen ===');
for (const [label, bio, un] of [
  ['leere Bio', '', 'sabine_weber'],
  ['Berufsbezeichnung', 'Steuerberaterin aus Köln', 'steuer_sabine'],
  ['Webseite', 'Mehr unter geldhelden.org', 'thomas_b'],
  ['Motto', 'Freiheit beginnt im Kopf 🌍', 'juergen1970'],
  ['Standort', 'Auswanderer, lebt auf Bali', 'bali_klaus'],
  ['nur Investment-Wort', 'Interessiere mich für Investments und Krypto', 'andrea_h'],
  ['nur WhatsApp erwähnt', 'Erreichbar auch über WhatsApp', 'peter_s'],
  ['nur Telefonnummer', 'Tel. +49 170 1234567', 'firma_mueller'],
] as [string, string, string][]) {
  check(`unberührt: ${label}`, urteil(bio, un), 'keine');
}

console.log('\n=== 6. Fremder Link ohne weiteres Merkmal: nur Alarm, keine Sperre ===');
check(
  'fremde Gruppe, sonst unauffällig -> Alarm',
  urteil('Meine zweite Gruppe: https://t.me/meinepartnergruppe', 'andrea_hoffmann'),
  'alarm'
);
check(
  'dieselbe Lage im strengen Modus -> Sperre',
  urteil('Meine zweite Gruppe: https://t.me/meinepartnergruppe', 'andrea_hoffmann', [], true),
  'sperren'
);

console.log('\n=== 7. Wegwerf-Benutzernamen ===');
check('ab12345678', istWegwerfName('ab12345678'), true);
check('user98765', istWegwerfName('user98765'), true);
check('sabine_weber', istWegwerfName('sabine_weber'), false);
check('juergen1970', istWegwerfName('juergen1970'), false);
check('steuer_sabine', istWegwerfName('steuer_sabine'), false);
check('leer', istWegwerfName(null), false);

console.log('\n=== 8. Gestohlenes Profilbild ===');
check('Bild-Dublette allein -> Alarm', urteil('Hallo zusammen', 'lisa_k', [111, 222]), 'alarm');
check('Bild-Dublette + Link -> Sperre', urteil('Schau: t.me/+AbCdEfGh12', 'lisa_k', [111]), 'sperren');
check('kein Bild-Duplikat -> nichts', urteil('Hallo zusammen', 'lisa_k', []), 'keine');

console.log('\n=== 9. Belege werden protokolliert ===');
const u = entscheideProfil(analysiereProfil({
  bio: 'Kopiere es von ihm: https://t.me/+YLLIqnYu11BjMDA1',
  username: 'Glc43amg_e_performance',
  istLinkFreigegeben: frei,
}));
check('Beleg enthält den Link', u.belege.some(b => b.includes('YLLIqnYu11BjMDA1')), true);
check('Beleg nennt das Textsignal', u.belege.some(b => b.includes('aufforderung_kopieren')), true);

console.log(`\n${'='.repeat(50)}`);
console.log(`Bestanden: ${ok}   Fehlgeschlagen: ${fehl}`);
console.log('='.repeat(50));
process.exit(fehl > 0 ? 1 : 0);
