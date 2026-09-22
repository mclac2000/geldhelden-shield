/**
 * test-crypto-buy.ts — Krypto-Ankauf-Erkennung
 *
 * Die Gegenbeispiele sind hier wichtiger als anderswo: In Gruppen, die
 * „Geldhelden" und „Bitcoin & alternative Währungen" heißen, reden echte
 * Mitglieder täglich über Coins, Kurse, Provisionen und Kaufabsichten.
 * Jeder dieser Sätze muss durchgehen.
 */

import {
  bewerteKryptoAnkauf, entscheideKryptoAnkauf,
  SCHWELLE_SPERRE, SCHWELLE_ALARM,
} from '../src/cryptoBuyRisk';

let bestanden = 0, gescheitert = 0;
function pruefe(name: string, ok: boolean, zusatz = ''): void {
  if (ok) { bestanden++; console.log(`  ✅ ${name}`); }
  else { gescheitert++; console.log(`  ❌ ${name}${zusatz ? ' — ' + zusatz : ''}`); }
}
function u(text: string) {
  const b = bewerteKryptoAnkauf(text);
  return { ...entscheideKryptoAnkauf(b), gruppen: b.tragendeGruppen, ankauf: b.ankaufErkannt, signale: b.signale };
}

console.log('\n=== DER GEMELDETE FALL (23.09.2026) ===');
const gemeldet = `Hello! We are Royal Dynasty International Co., Ltd., headquartered in Shanghai. We are currently acquiring large quantities of USDT, ETH, BTC, and other cryptocurrencies globally at highly favorable rates. We have an urgent need for large volumes of USDT. If you hold USDT, you can earn a commission by trading with us. We guarantee a commission of 10% to 25% on every transaction. We provide full upfront payment to USDT holders. You simply transfer the USDT to us after receiving the funds. Contact us now: @HUANGCHAOQZKF`;
const g = u(gemeldet);
console.log(`  ${g.punkte} Punkte, ${g.gruppen}/4 tragende Gruppen, Ankauf erkannt: ${g.ankauf}`);
console.log(`  Signale: ${g.signale.join(', ')}`);
pruefe('Der gemeldete Post wird gesperrt', g.massnahme === 'sperren', `${g.massnahme}, ${g.punkte} Punkte`);

console.log('\n=== DERSELBE TYP, ANDERER WORTLAUT ===');
const varianten: Array<[string, string]> = [
  ['Andere Firma, andere Zahlen',
   'Greetings from Golden Phoenix Trading Limited, based in Dubai. We are purchasing bulk amounts of BTC and Tether worldwide. Guaranteed profit of 8% on every trade. We pay you first, you send the coins after receiving the funds. Write to @goldenphoenix_ops'],
  ['Deutsch statt Englisch',
   'Wir kaufen große Mengen Kryptowährungen an, dringend benötigen wir USDT. Garantierte Provision von 12% bei jeder Transaktion. Wir zahlen zuerst, Sie überweisen die Coins nach Eingang des Geldes. Jetzt melden: @krypto_ankauf_de'],
  ['Ohne Firmenfassade',
   'We are acquiring large volumes of USDT globally. If you hold USDT you can earn a guaranteed commission of 15% to 30% on every transaction. Full upfront payment, you transfer after receiving the funds. Contact us now @usdt_bulk_desk'],
];
for (const [name, text] of varianten) {
  const r = u(text);
  pruefe(name, r.massnahme === 'sperren', `${r.massnahme}, ${r.punkte} P., ${r.gruppen}/4`);
}

console.log('\n=== GEGENBEISPIELE: echte Krypto-Gespräche dürfen NICHT anschlagen ===');
const harmlos: Array<[string, string]> = [
  ['Mitglied kauft privat', 'Ich habe letzte Woche wieder Bitcoin nachgekauft, bin jetzt bei knapp 0,4 BTC. Wer kauft noch regelmäßig nach?'],
  ['Kursgespräch', 'USDT ist als Stablecoin natürlich an den Dollar gekoppelt, deshalb schwankt er kaum. BTC und ETH sind da eine ganz andere Geschichte.'],
  ['Frage nach Börse', 'Wo kauft ihr eure Coins? Ich nutze bisher Bitpanda, aber die Gebühren sind happig. Lohnt sich Kraken?'],
  ['Renditegespräch legitim', 'Mein Portfolio hat dieses Jahr etwa 12% gemacht. Das ist ordentlich, aber garantiert ist bei Krypto natürlich gar nichts.'],
  ['Botschafter mit Provision', 'Als Botschafter bekommst du eine Provision von 20% auf jede Vermittlung. Melde dich gerne bei mir für die Details.'],
  ['Warnung vor genau diesem Scam', 'Achtung: In der Gruppe war gerade jemand, der große Mengen USDT ankaufen wollte mit garantierter Provision. Das ist ein bekannter Betrug, bitte nicht darauf eingehen!'],
  ['Seriöser Anbieter stellt sich vor', 'Guten Tag zusammen, wir sind die Musterfirma GmbH mit Hauptsitz in München und beraten international zu Vermögensschutz. Bei Fragen gerne melden.'],
  ['Vorkasse im normalen Handel', 'Ich verkaufe mein altes Notebook. Zahlung per Überweisung im Voraus, danach schicke ich es los. Schreibt mir privat.'],
  ['Tether-Erklärung', 'Tether hält angeblich für jeden USDT einen Dollar als Reserve. Ob das stimmt, ist seit Jahren umstritten.'],
  ['Steuerfrage', 'Wenn du BTC länger als ein Jahr hältst, ist der Gewinn in Deutschland steuerfrei. Bei Staking verlängert sich die Frist.'],
  ['Ankündigung eines Kaufs', 'Ich will demnächst eine größere Menge ETH kaufen. Hat jemand Erfahrung, ob man das besser stückelt?'],
  ['Provision und Transaktion harmlos', 'Die Börse nimmt 0,5% Provision auf jede Transaktion. Das summiert sich, wenn man oft handelt.'],
];
for (const [name, text] of harmlos) {
  const r = u(text);
  pruefe(name, r.massnahme === 'keine', `→ ${r.massnahme}, ${r.punkte} P., ${r.gruppen}/4 (${r.signale.join(', ')})`);
}

console.log('\n=== Die Sperrbedingung im Einzelnen ===');
// Ertrag + Vorkasse + Abwanderung, aber KEIN Ankauf → darf nicht sperren
const ohneAnkauf = u('Guaranteed profit of 20% on every transaction. We provide full upfront payment, you transfer after receiving the funds. Contact us now @something_here');
console.log(`  Ohne Ankauf: ${ohneAnkauf.punkte} P., ${ohneAnkauf.gruppen}/4, Ankauf=${ohneAnkauf.ankauf} → ${ohneAnkauf.massnahme}`);
pruefe('Ohne erkannten Ankauf wird nie gesperrt', ohneAnkauf.massnahme !== 'sperren');

// Nur Ankauf, sonst nichts
const nurAnkauf = u('We are buying USDT at good rates.');
pruefe('Ankauf allein reicht nicht', nurAnkauf.massnahme === 'keine', `${nurAnkauf.massnahme}, ${nurAnkauf.punkte} P.`);

// Firmenfassade zählt nicht als tragende Gruppe
const nurFassade = u('We are Muster International Co., Ltd., headquartered in Berlin, operating globally.');
pruefe('Firmenfassade allein ist harmlos', nurFassade.massnahme === 'keine', `${nurFassade.massnahme}`);

console.log('\n=== Robustheit ===');
pruefe('Leerer Text', u('').massnahme === 'keine');
pruefe('Nur ein Coinname', u('BTC').massnahme === 'keine');
pruefe('Sehr langer harmloser Text', u('Wir sprechen hier über Bitcoin und Ethereum. '.repeat(40)).massnahme === 'keine');
pruefe('Schwellen plausibel', SCHWELLE_SPERRE > SCHWELLE_ALARM && SCHWELLE_ALARM > 0);

console.log(`\n${'='.repeat(60)}`);
console.log(`Ergebnis: ${bestanden} bestanden, ${gescheitert} gescheitert`);
console.log('='.repeat(60));
process.exit(gescheitert > 0 ? 1 : 0);
