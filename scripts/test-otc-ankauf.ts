/**
 * test-otc-ankauf.ts — die OTC-Spielart des Krypto-Ankauf-Betrugs
 *
 * Gemeldet am 05.10.2026 (Auftrag #275). Der alte Erkenner kam auf 60 Punkte
 * und damit nur auf „alarm": gemeldet, nichts gelöscht, niemand gesperrt.
 * Drei Gründe, alle gemessen und nicht vermutet:
 *
 *   1. Der ANKAUF stand in der Verneinung („unable to buy … through standard
 *      channels", „we have to acquire it") — die Wir-Form-Regel verlangte den
 *      Coinnamen dicht hinter dem Kaufwort, dort stand „it".
 *   2. „we will make the payment first" ist dasselbe wie „we pay first", aber
 *      vier Wörter weiter — die Vorkasse-Regel griff nicht.
 *   3. Der AUFSCHLAG über dem Marktpreis war gar kein eigenes Merkmal. Er
 *      wurde als „Provision" gezählt: richtige Punktzahl, falsche Begründung.
 *
 * Aufruf:  npx ts-node scripts/test-otc-ankauf.ts
 */

import {
  bewerteKryptoAnkauf, entscheideKryptoAnkauf,
  KryptoMassnahme, Absender,
} from '../src/cryptoBuyRisk';

const FREMD: Absender = { nachrichtenInGruppe: 1, kontoAlterTage: 5 };
const MITGLIED: Absender = { nachrichtenInGruppe: 280, kontoAlterTage: 1500 };

interface Fall { was: string; text: string; absender: Absender; erwartet: KryptoMassnahme | KryptoMassnahme[]; }

// ---------------------------------------------------------------------------
// 1. Der gemeldete Originaltext
// ---------------------------------------------------------------------------

const ORIGINAL = `I am from China. 💵💵💵❤️❤️❤️💵💵
My company is engaged in international trade. Many of our overseas partners need to use USDT for payments to avoid tariffs. However, due to Chinese policy restrictions on large-scale purchases, we are unable to buy USDT in bulk through standard channels; consequently, we have to acquire it at prices 5%–20% above the market rate.
(We offer the best rates and the most secure transaction methods available.)
Once we confirm you hold the USDT, we will make the payment first, and then you transfer the USDT to us.
If you are a seller looking to sell USDT,
please contact me 👉 Telegram: @YLPAY618`;

// ---------------------------------------------------------------------------
// 2. Varianten — andere Herkunft, andere Zahlen, andere Sprache
// ---------------------------------------------------------------------------

const MUSS_GREIFEN: Fall[] = [
  { was: 'DER GEMELDETE ORIGINALTEXT (05.10.2026)', text: ORIGINAL, absender: FREMD, erwartet: ['sperren', 'loeschen'] },

  {
    was: 'Variante 1 — DEUTSCH, andere Zahlen, keine Emojis',
    text: 'Guten Tag. Unsere Handelsgesellschaft benötigt laufend USDT für Zahlungen an Lieferanten in Asien, um Zölle zu vermeiden. ' +
          'Wegen behördlicher Beschränkungen können wir nicht über die üblichen Börsen kaufen und zahlen deshalb 8 % über dem Marktpreis. ' +
          'Wir überweisen zuerst, Sie senden die Coins danach. Wer USDT verkaufen möchte, schreibt mir bitte direkt: @otc_ankauf_eu',
    absender: FREMD, erwartet: ['sperren', 'loeschen'],
  },
  {
    was: 'Variante 2 — knapp, nur Aufschlag + Vorkasse + Kennung',
    text: 'Buying USDT in bulk. We pay 12% above market rate. Payment first, then you transfer. Sellers welcome, DM @usdt_desk_asia 💵💵💵💵',
    absender: FREMD, erwartet: ['sperren', 'loeschen'],
  },
  {
    was: 'Variante 3 — Steuern statt Zölle, USDC statt USDT',
    text: 'Our trading house must source USDC outside the official channels because of capital control limits. ' +
          'We offer the best rates available, a premium of 15%, and we pay you first — you transfer the coins afterwards. ' +
          'Are you a seller? Contact me on Telegram: @usdc_bulk_office',
    absender: FREMD, erwartet: ['sperren', 'loeschen'],
  },
  {
    was: 'Variante 4 — ohne Prozentzahl, dafür „über dem Marktpreis" im Klartext',
    text: 'Wir kaufen große Mengen Kryptowährungen an, über dem Marktpreis, weil wir die Einfuhrabgaben umgehen müssen. ' +
          'Die Zahlung erfolgt zuerst, danach überweisen Sie uns die Coins. Verkäufer gesucht — jetzt melden bei @ankauf_otc_24',
    absender: FREMD, erwartet: ['sperren', 'loeschen'],
  },
  {
    was: 'Impfversuch: Warnwörter als Tarnung, aber Kennung und Aufschlag dabei',
    text: 'Vorsicht vor unseriösen Anbietern! Wir sind die echten: Ankauf von USDT in großen Mengen, 10 % über dem Marktpreis, ' +
          'wir zahlen zuerst. Zoll sparen. Verkäufer bitte melden: @der_echte_ankauf',
    absender: FREMD, erwartet: ['sperren', 'loeschen'],
  },
  {
    was: 'Dasselbe Angebot von einem eingesessenen Mitglied — löschen, nie sperren',
    text: ORIGINAL, absender: MITGLIED, erwartet: ['loeschen', 'alarm', 'keine'],
  },
];

// ---------------------------------------------------------------------------
// 3. Fünf normale Club-Nachrichten zu Krypto — dürfen NICHT greifen
// ---------------------------------------------------------------------------

const DARF_NICHT_GREIFEN: Fall[] = [
  {
    was: 'Mitglied will selbst USDT verkaufen und fragt nach dem besten Weg',
    text: 'Ich möchte einen Teil meiner USDT verkaufen. Wo bekommt man aktuell den besten Kurs, ohne viel Gebühren zu zahlen?',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: 'Steuerfrage zu Zoll und Krypto — enthält beide Reizwörter',
    text: 'Weiß jemand, wie das steuerlich läuft, wenn eine Firma in Asien in USDT bezahlt? Fallen da Zölle oder Einfuhrabgaben an?',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: 'Kursgespräch mit Prozentangabe',
    text: 'Der USDT-Kurs lag heute kurz 2 % über dem Marktpreis auf der kleinen Börse. Arbitrage lohnt sich bei den Gebühren aber nicht.',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: 'Mitglied plant einen größeren Kauf',
    text: 'Wir überlegen, als Familie eine größere Menge Bitcoin zu kaufen. Lieber in Tranchen oder auf einmal? 💵',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: 'Erklärung von OTC-Handel — der Fachbegriff selbst ist harmlos',
    text: 'OTC heißt einfach, dass man außerhalb der Börse direkt mit einer Gegenpartei handelt. Bei großen Summen ist das üblich und völlig legal.',
    absender: MITGLIED, erwartet: 'keine',
  },
  {
    was: 'Neues Mitglied stellt eine Stablecoin-Frage (kein Mitgliedsrabatt)',
    text: 'Hallo, bin neu hier. Ist USDT eigentlich sicherer als USDC? Ich würde einen Teil meiner Rücklagen in Stablecoins halten.',
    absender: FREMD, erwartet: 'keine',
  },
  {
    was: 'Warnung vor genau dieser Masche',
    text: 'Achtung Leute: Gerade schrieb mich jemand an, er kaufe USDT 20 % über dem Marktpreis und zahle zuerst. Das ist Betrug, bitte nicht drauf eingehen!',
    absender: MITGLIED, erwartet: 'keine',
  },
];

// ---------------------------------------------------------------------------

function pruefe(faelle: Fall[], titel: string): string[] {
  console.log(`\n${'='.repeat(78)}\n${titel}\n${'='.repeat(78)}`);
  const fehler: string[] = [];
  for (const f of faelle) {
    const b = bewerteKryptoAnkauf(f.text, { absender: f.absender });
    const u = entscheideKryptoAnkauf(b);
    const erlaubt = Array.isArray(f.erwartet) ? f.erwartet : [f.erwartet];
    const ok = erlaubt.includes(u.massnahme);
    if (!ok) fehler.push(`${f.was}: erwartet ${erlaubt.join('|')}, war ${u.massnahme}`);
    console.log(`\n${ok ? '✅' : '❌'} ${f.was}`);
    console.log(`   ${u.massnahme.toUpperCase()} — ${b.punkte} Punkte, ${b.tragendeGruppen}/6 tragende Merkmale ` +
                `(erwartet: ${erlaubt.join(' oder ')})`);
    console.log(`   Gruppen: ${b.getroffeneGruppen.join(', ') || '(keine)'}`);
    if (b.signale.length) console.log(`   Signale: ${b.signale.join(', ')}`);
  }
  return fehler;
}

const f1 = pruefe(MUSS_GREIFEN, '1. MUSS GREIFEN — die Gattung OTC-/USDT-Ankauf über Marktpreis');
const f2 = pruefe(DARF_NICHT_GREIFEN, '2. DARF NICHT GREIFEN — normale Club-Nachrichten zu Krypto');

const fehler = [...f1, ...f2];
console.log(`\n${'='.repeat(78)}`);
console.log(`Erkannt:       ${MUSS_GREIFEN.length - f1.length}/${MUSS_GREIFEN.length}`);
console.log(`Durchgelassen: ${DARF_NICHT_GREIFEN.length - f2.length}/${DARF_NICHT_GREIFEN.length}`);
if (fehler.length) {
  console.log(`\n❌ ${fehler.length} Abweichungen:`);
  for (const f of fehler) console.log(`   • ${f}`);
  process.exit(1);
}
console.log('\n✅ Alle Fälle wie erwartet.');
process.exit(0);
