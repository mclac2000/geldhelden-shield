/**
 * test-first-message.ts — Prüft die Erstnachrichten-Bewertung.
 *
 * Der wichtigste Teil sind NICHT die Treffer, sondern die Gegenbeispiele:
 * Nachrichten echter Mitglieder, die auf keinen Fall anschlagen dürfen.
 */

import {
  bewerteErstnachricht, entscheideErstnachricht, zaehleEmojis, pruefeSprache,
  SCHWELLE_SPERRE, SCHWELLE_ALARM,
} from '../src/firstMessageRisk';

let bestanden = 0, gescheitert = 0;

function pruefe(name: string, bedingung: boolean, zusatz = ''): void {
  if (bedingung) { bestanden++; console.log(`  ✅ ${name}`); }
  else { gescheitert++; console.log(`  ❌ ${name}${zusatz ? ' — ' + zusatz : ''}`); }
}

function urteil(text: string, name = '', minuten: number | null = 5, nr = 1) {
  const b = bewerteErstnachricht({ text, anzeigename: name, minutenSeitBeitritt: minuten, nachrichtNr: nr });
  return { ...entscheideErstnachricht(b), gruppen: b.gruppen, inhalt: b.inhaltlicheGruppen, signale: b.signale };
}

console.log('\n=== Hilfsfunktionen ===');
pruefe('Emojis zählen', zaehleEmojis('👋👋👋👋 HEY 👍👍') === 6, `ist ${zaehleEmojis('👋👋👋👋 HEY 👍👍')}`);
pruefe('Emojis: Text ohne Emojis = 0', zaehleEmojis('Hallo zusammen, wie geht es euch?') === 0);
pruefe('Sprache: deutscher Text nicht als englisch',
  !pruefeSprache('Hallo zusammen, ich freue mich hier zu sein und bin gespannt auf den Austausch').ueberwiegendEnglisch);
pruefe('Sprache: einzelner englischer Satz reicht nicht',
  !pruefeSprache('Danke für die Einladung, sounds great!').ueberwiegendEnglisch);
pruefe('Sprache: englischer Werbetext erkannt',
  pruefeSprache('Your business deserves the best payment gateway available here for all of our clients').ueberwiegendEnglisch);

console.log('\n=== DER ECHTE FALL (Screenshot vom 05.09.2026) ===');
const echterFall = `👋👋👋👋 HEY EVERYONE
👍 Your Business Deserves a Gateway to Unlimited Payments! 👍
Stop losing customers to failed payments — it's time to go global with our fully verified virtual banking & payment solutions! 🌍💳
🚀 Take your business to the next level with gateways that never let you down:
✅ Square Account
✅ Stripe Account`;
const u1 = urteil(echterFall, 'LÓUÎ SÜNG KYC', 12, 1);
console.log(`  Punkte: ${u1.punkte}, inhaltliche Gruppen: ${u1.inhalt}, Maßnahme: ${u1.massnahme}`);
console.log(`  Signale: ${u1.signale.join(', ')}`);
pruefe('Der echte Fall wird gesperrt', u1.massnahme === 'sperren', `ist "${u1.massnahme}" bei ${u1.punkte} Punkten`);
pruefe('Mehrere inhaltliche Signalgruppen', u1.inhalt >= 2, `nur ${u1.inhalt}`);
pruefe('Verfremdeter Name erkannt', u1.signale.includes('verfremdeter_name'));

console.log('\n=== Weitere Betrugsangebote ===');
const b1 = urteil('KYC Verified Accounts available here ✅✅✅ Fresh Documents 🔥 DM me now! Stripe, Wise, Revolut 💳💳', 'ZhìxìnKYC HÜB', 8, 1);
pruefe('Kontenhandel mit Emoji-Wall', b1.massnahme === 'sperren', `${b1.massnahme}, ${b1.punkte} Punkte`);

const b2 = urteil('Payment Gateways | KYC Verified | Valid Documents | Trusted — contact me for premium accounts', 'YÛSÎ-FÊÑG KYÇ', 30, 1);
pruefe('Kontenhandel ohne Emojis', b2.massnahme === 'sperren', `${b2.massnahme}, ${b2.punkte} Punkte`);

console.log('\n=== GEGENBEISPIELE: echte Mitglieder dürfen NICHT anschlagen ===');
const harmlos: Array<[string, string, string]> = [
  ['Vorstellung deutsch', 'Hallo zusammen! Ich bin neu hier und freue mich auf den Austausch. Liebe Grüße aus München', 'Anna Meier'],
  ['Kurzer englischer Satz', 'Thanks for the invite, happy to be here!', 'Thomas Berger'],
  ['Emojis ohne Werbung', 'Guten Morgen ihr Lieben ☀️😊🙏 Ich wünsche euch einen wundervollen Tag 🌸✨💚🦋', 'Sabine K.'],
  ['Fachgespräch über Zahlungsdienste', 'Ich nutze für meine Kunden PayPal und Stripe, aber die Gebühren sind happig. Hat jemand Erfahrung mit Wise?', 'Michael Braun'],
  ['Botschafter wirbt für eigenes Angebot', 'Ich biete Gitarrenunterricht an, meldet euch gerne bei mir wenn ihr Interesse habt', 'Peter Wolf'],
  ['Englischer Beitrag eines Mitglieds', 'I have been following this community for a while and I think the discussion about financial freedom is really valuable for all of us here', 'Sarah Klein'],
  ['Umlaute im Namen (kein Homoglyph)', 'Servus miteinander, schön hier zu sein!', 'Jürgen Müller-Lüdenscheidt'],
  ['Geschäftliche Vorstellung', 'Hallo! Ich berate kleine Unternehmen bei der Digitalisierung. Kontaktiert mich gerne bei Fragen.', 'Claudia Fischer'],
];
for (const [name, text, anzeige] of harmlos) {
  const u = urteil(text, anzeige, 20, 1);
  pruefe(name, u.massnahme === 'keine', `→ ${u.massnahme} mit ${u.punkte} Punkten (${u.signale.join(', ')})`);
}

console.log('\n=== Namensprüfung einzeln ===');
import { istVerfremdeterName } from '../src/firstMessageRisk';
const namenOk = ['Sarah Klein','Anna Meier','Jürgen Müller-Lüdenscheidt','Martin Schulz','José García','Peter Wolf','Zoë Schmidt','Malou','François Dupont','Sören Öllers'];
for (const n of namenOk) pruefe(`Name unauffällig: ${n}`, !istVerfremdeterName(n).verfremdet, istVerfremdeterName(n).grund);
const namenVerfremdet = ['LÓUÎ SÜNG KYC','ZÔHÑG MÎNYÅÑ','YÛSÎ-FÊÑG','CHÜ XÛÅÑJÎ'];
for (const n of namenVerfremdet) pruefe(`Name verfremdet: ${n}`, istVerfremdeterName(n).verfremdet);

console.log('\n=== Grenzfälle: nur eine Signalgruppe darf nie sperren ===');
// Ein Finanz-Botschafter, der ausführlich über Zahlungsdienstleister schreibt
const grenz = urteil(
  'Wichtiger Hinweis zu Payment Gateways: verified accounts sind bei vielen Anbietern Pflicht. ' +
  'Fresh documents braucht ihr für die KYC verified Prüfung. Das gilt für Stripe genauso.',
  'Martin Schulz', 60 * 24 * 30, 47
);
console.log(`  Punkte: ${grenz.punkte}, inhaltliche Gruppen: ${grenz.inhalt}, Maßnahme: ${grenz.massnahme}`);
pruefe('Hohe Punkte aus EINER inhaltlichen Gruppe sperren nicht',
  grenz.massnahme !== 'sperren',
  `${grenz.massnahme} bei ${grenz.inhalt} inhaltlicher Gruppe, ${grenz.punkte} Punkten`);

// Altes Konto, gleiche Nachricht wie der echte Fall — Zeitbonus entfällt
const alt = urteil(echterFall, 'LÓUÎ SÜNG KYC', 60 * 24 * 200, 300);
pruefe('Auch ohne Zeitbonus wird der echte Fall gesperrt', alt.massnahme === 'sperren',
  `${alt.massnahme}, ${alt.punkte} Punkte`);

console.log('\n=== Robustheit ===');
pruefe('Leerer Text', urteil('', 'Max Mustermann').massnahme === 'keine');
pruefe('Nur Emojis', urteil('😊', 'Max Mustermann').massnahme === 'keine');
pruefe('Sehr langer Text ohne Signale',
  urteil('Das ist ein sehr langer Beitrag über das Wetter. '.repeat(40), 'Max Mustermann').massnahme === 'keine');
pruefe('Schwellen plausibel', SCHWELLE_SPERRE > SCHWELLE_ALARM && SCHWELLE_ALARM > 0);

console.log(`\n${'='.repeat(60)}`);
console.log(`Ergebnis: ${bestanden} bestanden, ${gescheitert} gescheitert`);
console.log('='.repeat(60));
process.exit(gescheitert > 0 ? 1 : 0);
