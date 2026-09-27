/**
 * test-copy-trading.ts — Prüfung des Copy-Trading-Erkenners
 *
 * Zwei Hälften, und die zweite ist die wichtigere:
 *
 *  1. Die echte Nachricht vom 27.09.2026 und drei Abwandlungen davon müssen
 *     greifen — auch wenn Börse, Zahlen und Kennung anders heißen.
 *  2. Echte Beiträge echter Mitglieder über Trading dürfen NICHT greifen.
 *     Ein Filter, der nie durchlässt, ist kein Filter.
 *
 * Aufruf:  npx ts-node scripts/test-copy-trading.ts
 */

import {
  bewerteCopyTrading, entscheideCopyTrading,
  CopyTradingMassnahme, Absender,
} from '../src/copyTradingRisk';

// Der Absender des Scams: heute beigetreten, erste Nachricht, junges Konto.
const FREMDES_KONTO: Absender = { nachrichtenInGruppe: 1, kontoAlterTage: 4 };
// Ein eingesessenes Mitglied.
const MITGLIED: Absender = { nachrichtenInGruppe: 340, kontoAlterTage: 1900 };
// Jemand, den wir nicht einordnen können — weder neu noch eingesessen.
const UNKLAR: Absender = { nachrichtenInGruppe: 7, kontoAlterTage: 400 };

interface Fall {
  was: string;
  text: string;
  bild?: boolean;
  absender: Absender;
  erwartet: CopyTradingMassnahme | CopyTradingMassnahme[];
}

// ---------------------------------------------------------------------------
// 1. Muss greifen
// ---------------------------------------------------------------------------

const MUSS_GREIFEN: Fall[] = [
  {
    was: 'DIE ECHTE NACHRICHT (Koh Phangan, 27.09.2026)',
    text: 'Best regards……I only listen to Suitable Win Trade 98% win rate in one month of copying his trades\n@SuitableWinTrade',
    bild: true,
    absender: FREMDES_KONTO,
    erwartet: 'sperren',
  },
  {
    was: 'Dieselbe Masche, andere Börse und andere Zahlen (morgen)',
    text: 'Huge thanks to Mr. Alvarez! +512.4% profit this week, 95% win rate. Copy his trades here 👉 @AlvarezFXPro',
    bild: true,
    absender: FREMDES_KONTO,
    erwartet: 'sperren',
  },
  {
    was: 'Ohne Bild, mit Werbecode und Hebel',
    text: 'BTCUSDT Perp | Long | 50x | Closed | +348,86 %\nJoin my VIP signals group, referral code LHVUGTBO for the bonus. t.me/+kjhAS8d2',
    absender: FREMDES_KONTO,
    erwartet: 'sperren',
  },
  {
    was: 'Deutsch formuliert, gleiche Struktur',
    text: 'Seit ich die Trades von meinem Mentor kopiere: +420 % Rendite, Trefferquote 97 %. Einladungscode QWERTZ88, schreib mir privat.',
    absender: FREMDES_KONTO,
    erwartet: 'sperren',
  },
  {
    was: 'Impfversuch: Scam tarnt sich mit Warnwörtern, trägt aber einen Werbecode',
    text: 'Beware of fake signal sellers! I only trust Suitable Win Trade — 96% win rate, +380% profit. ' +
          'Real one: copy his trades, referral code LHVUGTBO, write me privately.',
    bild: true,
    absender: FREMDES_KONTO,
    erwartet: 'sperren',
  },
  {
    was: 'Prahlerei ohne Code und ohne Kennung — soll NICHT gesperrt, aber angefasst werden',
    text: 'ATOMUSDT Long 50x closed +648,26 % profit today. My win rate this month is 91%.',
    bild: true,
    absender: FREMDES_KONTO,
    erwartet: ['loeschen', 'melden'],
  },
  {
    was: 'Dieselbe Scam-Nachricht, aber von einem eingesessenen Mitglied — löschen, nie sperren',
    text: 'Best regards……I only listen to Suitable Win Trade 98% win rate in one month of copying his trades\n@SuitableWinTrade',
    bild: true,
    absender: MITGLIED,
    erwartet: ['loeschen', 'melden', 'keine'],
  },
];

// ---------------------------------------------------------------------------
// 2. Darf NICHT greifen — echte Mitglieder, die über Trading reden
// ---------------------------------------------------------------------------

const DARF_NICHT_GREIFEN: Fall[] = [
  {
    was: 'Mitglied berichtet von einem Verlust mit kleinem Hebel',
    text: 'Ich habe gestern zum ersten Mal mit Hebel 3x gehandelt und prompt Verlust gemacht. Mache ich nicht nochmal.',
    absender: MITGLIED,
    erwartet: 'keine',
  },
  {
    was: 'Steuerfrage mit realistischer Kursentwicklung',
    text: 'Wie versteuert man eigentlich Gewinne aus Krypto, wenn man in Thailand lebt? Mein BTC steht 40 % im Plus.',
    absender: MITGLIED,
    erwartet: 'keine',
  },
  {
    was: 'Frage nach einer Börse — genau der Satz, den eine Namensliste fälschlich fangen würde',
    text: 'Hat jemand Erfahrung mit BingX? Ich suche eine Börse, die auch ohne KYC funktioniert.',
    absender: MITGLIED,
    erwartet: 'keine',
  },
  {
    was: 'Mitglied kopiert tatsächlich Trades — mit glaubwürdiger Zahl',
    text: 'Ich kopiere seit drei Monaten die Trades von einem Freund, bin bei plus 12 Prozent. Lohnt sich mäßig.',
    absender: MITGLIED,
    erwartet: 'keine',
  },
  {
    was: 'Über Copy-Trading reden, ohne es anzubieten (mit Erwähnung eines Mitglieds)',
    text: 'Beim Meetup am Samstag wollte jemand über Copy-Trading sprechen, kommt der noch? @marcolachmann weißt du was?',
    absender: MITGLIED,
    erwartet: 'keine',
  },
  {
    was: 'Warnung vor genau diesem Scam durch ein Mitglied',
    text: 'Achtung, oben war Spam: jemand wollte mit 98% win rate und Copy Trading werben. Nie drauf eingehen!',
    absender: MITGLIED,
    erwartet: 'keine',
  },
  {
    was: 'Neues, unauffälliges Mitglied stellt eine Trading-Frage',
    text: 'Servus, bin neu hier. Handelt jemand von euch Perpetuals auf BTCUSDT? Würde mich über Erfahrungen freuen.',
    absender: FREMDES_KONTO,
    erwartet: 'keine',
  },
  {
    was: 'Kursbericht ohne Werbung, unklarer Absender',
    text: 'ETH ist heute 6 % im Plus, mein Einstiegskurs war bei 2.100. Mal sehen wie es weitergeht.',
    absender: UNKLAR,
    erwartet: 'keine',
  },
];

// ---------------------------------------------------------------------------

function pruefe(faelle: Fall[], titel: string): { ok: number; fehler: string[] } {
  console.log(`\n${'='.repeat(78)}\n${titel}\n${'='.repeat(78)}`);
  let ok = 0;
  const fehler: string[] = [];

  for (const f of faelle) {
    const befund = bewerteCopyTrading(f.text, {
      alsBildunterschrift: f.bild,
      absender: f.absender,
    });
    const urteil = entscheideCopyTrading(befund);
    const erlaubt = Array.isArray(f.erwartet) ? f.erwartet : [f.erwartet];
    const passt = erlaubt.includes(urteil.massnahme);
    if (passt) ok++; else fehler.push(`${f.was}: erwartet ${erlaubt.join('|')}, war ${urteil.massnahme}`);

    console.log(`\n${passt ? '✅' : '❌'} ${f.was}`);
    console.log(`   Text:      ${f.text.replace(/\n/g, ' ⏎ ').substring(0, 110)}`);
    console.log(`   Absender:  ${f.absender.nachrichtenInGruppe} Nachrichten, Konto ~${f.absender.kontoAlterTage} Tage`);
    console.log(`   Ergebnis:  ${urteil.massnahme.toUpperCase()} — ${befund.punkte} Punkte, ` +
                `${befund.tragendeGruppen}/5 tragende Merkmale, Leitsignal: ${befund.leitsignal ? 'ja' : 'nein'}`);
    console.log(`   erwartet:  ${erlaubt.join(' oder ')}`);
    if (befund.signale.length) console.log(`   Signale:   ${befund.signale.join(', ')}`);
  }
  return { ok, fehler };
}

const a = pruefe(MUSS_GREIFEN, '1. MUSS GREIFEN — der Scam und seine Abwandlungen');
const b = pruefe(DARF_NICHT_GREIFEN, '2. DARF NICHT GREIFEN — echte Mitglieder über Trading');

const fehler = [...a.fehler, ...b.fehler];
console.log(`\n${'='.repeat(78)}`);
console.log(`Treffer:      ${a.ok}/${MUSS_GREIFEN.length}`);
console.log(`Durchgelassen: ${b.ok}/${DARF_NICHT_GREIFEN.length}`);
if (fehler.length) {
  console.log(`\n❌ ${fehler.length} Abweichungen:`);
  for (const f of fehler) console.log(`   • ${f}`);
  process.exit(1);
}
console.log('\n✅ Alle Fälle wie erwartet.');
process.exit(0);
