/**
 * test-titel-normalisierung.ts
 *
 * Prüft die Reparatur vom 11.09.2026 an dem Titel, der den Fehler ausgelöst hat.
 * Der ALTE Weg (title.toLowerCase().includes(...)) muss durchfallen, der neue
 * bestehen — sonst hätte man nichts repariert, sondern nur umgeschrieben.
 */
import { normalizeGroupTitle } from '../src/identity';
import { detectGroupBrand } from '../src/groupIntelligence';

let fehler = 0;
function pruefe(ok: boolean, text: string): void {
  if (!ok) fehler++;
  console.log('  ' + (ok ? 'OK  ' : 'FEHLER  ') + text);
}

// Der echte Titel aus unserer Datenbank.
const ECHT = '𝐆𝐞𝐥𝐝𝐡𝐞𝐥𝐝𝐞𝐧 𝐆𝐞𝐦𝐞𝐢𝐧𝐬𝐜𝐡𝐚𝐟𝐭𝐟ü𝐫 𝐅𝐫𝐞𝐢𝐡𝐞𝐢𝐭 𝐋ö𝐬𝐮𝐧𝐠𝐞𝐧 & 𝐒𝐞𝐥𝐛𝐬𝐭𝐛𝐞𝐬𝐭𝐢𝐦𝐦𝐮𝐧𝐠';

console.log('=== 1. Der alte Weg muss durchfallen (sonst gäbe es nichts zu reparieren) ===');
const altWeg = ECHT.toLowerCase().includes('geldhelden');
pruefe(altWeg === false,
  'title.toLowerCase().includes("geldhelden") findet NICHTS — genau der Fehler');

console.log('');
console.log('=== 2. Der neue Weg findet es ===');
const neu = normalizeGroupTitle(ECHT);
console.log('  normalisiert: "' + neu + '"');
pruefe(neu.includes('geldhelden'), 'normalizeGroupTitle findet "geldhelden"');
pruefe(neu.includes('gemeinschaft'), 'auch der Rest ist lesbar');

console.log('');
console.log('=== 3. Weitere Schreibweisen, die vorkommen ===');
const faelle: Array<[string, string, boolean]> = [
  ['mathematisch fett', '𝐆𝐞𝐥𝐝𝐡𝐞𝐥𝐝𝐞𝐧 Chat', true],
  ['mathematisch kursiv', '𝑮𝒆𝒍𝒅𝒉𝒆𝒍𝒅𝒆𝒏 Wien', true],
  ['Schreibschrift', '𝒢𝑒𝓁𝒹𝒽𝑒𝓁𝒹𝑒𝓃 Bremen', true],
  ['doppelt gestrichen', '𝔾𝕖𝕝𝕕𝕙𝕖𝕝𝕕𝕖𝕟 Köln', true],
  ['Fraktur', '𝔊𝔢𝔩𝔡𝔥𝔢𝔩𝔡𝔢𝔫 Dresden', true],
  ['serifenlos fett', '𝗚𝗲𝗹𝗱𝗵𝗲𝗹𝗱𝗲𝗻 Hamburg', true],
  ['Breitschrift', 'Ｇｅｌｄｈｅｌｄｅｎ Bali', true],
  ['kyrillisches е', 'Gеldhelden Support', true],
  ['unsichtbares Zeichen', 'Geld​helden Leipzig', true],
  ['normal', 'Geldhelden Meetup Kassel', true],
  ['fremde Gruppe', 'Brückentage Butzbach', false],
  ['fremde Gruppe 2', 'TRADING 212 PLATFORM LLC.', false],
];
for (const [name, titel, erwartet] of faelle) {
  const gefunden = normalizeGroupTitle(titel).includes('geldhelden');
  pruefe(gefunden === erwartet,
    `${name.padEnd(22)} -> ${gefunden ? 'erkannt' : 'nicht erkannt'} (erwartet: ${erwartet ? 'erkannt' : 'nicht erkannt'})`);
}

console.log('');
console.log('=== 4. Die Marke wird jetzt richtig bestimmt ===');
pruefe(detectGroupBrand(ECHT) === 'geldhelden',
  'detectGroupBrand(Fettschrift) = ' + detectGroupBrand(ECHT));
pruefe(detectGroupBrand('𝐒𝐭𝐚𝐚𝐭𝐞𝐧𝐥𝐨𝐬 / 𝐆𝐞𝐥𝐝𝐡𝐞𝐥𝐝𝐞𝐧 Bangkok') === 'mixed',
  'Fettschrift mit beiden Marken = mixed');
pruefe(detectGroupBrand('Staatenlos Koh Phangan') === 'staatenlos',
  'normale Schreibweise unverändert = staatenlos');

console.log('');
console.log('=== 5. Keine Übertreibung: Ortsnamen bleiben unterscheidbar ===');
// Die aggressive ASCII-Faltung aus normalizeIdentityName (o->0, i->l) ist hier
// bewusst NICHT drin. Sonst würden Ortsnamen zusammenfallen.
pruefe(normalizeGroupTitle('Geldhelden Bonn') !== normalizeGroupTitle('Geldhelden B0nn')
  || 'Geldhelden Bonn'.toLowerCase() === 'geldhelden b0nn',
  'Bonn und B0nn fallen nicht zusammen');
pruefe(normalizeGroupTitle('Geldhelden Wien') !== normalizeGroupTitle('Geldhelden Wlen'),
  'Wien und Wlen fallen nicht zusammen');

console.log('');
console.log('='.repeat(64));
console.log(fehler === 0 ? 'TITEL-NORMALISIERUNG BESTANDEN'
  : 'FEHLGESCHLAGEN: ' + fehler + ' Abweichung(en)');
console.log('='.repeat(64));
process.exit(fehler === 0 ? 0 : 1);
