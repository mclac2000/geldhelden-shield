/**
 * cryptoBuyRisk.ts — Der Krypto-Ankauf-Scam
 *
 * DAS MUSTER, nicht der Wortlaut:
 * Ein angebliches Handelshaus „kauft" große Mengen USDT/BTC/ETH, verspricht
 * eine garantierte Provision und Vorkasse — das Opfer soll die Coins erst
 * nach Geldeingang überweisen. Die Zahlung kommt nie an oder wird
 * zurückgebucht, die Coins sind weg. Der Abschluss ist immer derselbe:
 * Wechsel in den Privatchat zu einer @-Kennung, wo niemand mitliest.
 *
 * Morgen heißt die Firma anders und die Prozentzahl auch. Deshalb greift
 * diese Datei auf die STRUKTUR des Angebots: Ankauf + Ertragsversprechen +
 * Vorkasse + Abwanderung. Firmennamen, Städte und Zahlen stehen nirgends
 * in den Mustern.
 *
 * WARUM EIGENES MODUL UND NICHT IN firstMessageRisk:
 * Die Erstnachrichten-Regel prüft nur die ersten fünf Nachrichten eines
 * Kontos. Dieser Scam kommt auch von Konten, die lange still mitgelesen
 * haben. Er muss bei JEDER Nachricht greifen — und genau deshalb ist die
 * Fehlalarmfrage hier schärfer als anderswo: In Gruppen, die „Geldhelden"
 * und „Bitcoin & alternative Währungen" heißen, reden echte Mitglieder
 * täglich über Krypto, Kurse und Kaufabsichten.
 *
 * Keine Seiteneffekte — prüfbar mit scripts/test-crypto-buy.ts.
 */

// ============================================================================
// Gruppe A: Ankauf in Geschäftsmengen
// ============================================================================
// Nicht „ich kaufe Bitcoin" (das tun Mitglieder), sondern „WIR kaufen GROSSE
// MENGEN" — ein Handelsangebot, keine private Absicht.

const COINS = String.raw`(?:usdt|usdc|btc|bitcoin|eth|ethereum|tether|trx|tron|bnb|crypto(?:currenc(?:y|ies))?|krypto(?:w[äa]hrung(?:en)?)?|coins?)`;

const ANKAUF = [
  // „we are buying/acquiring/purchasing … USDT" — mit Wir-Form
  {
    re: new RegExp(String.raw`\b(?:we|wir)\b[^.!?\n]{0,60}\b(?:are\s+)?(?:buying|acquiring|purchasing|sourcing|kaufen|ankaufen|erwerben)\b[^.!?\n]{0,60}${COINS}`, 'i'),
    punkte: 35, name: 'gewerblicher_ankauf',
  },
  // „acquiring large quantities/volumes of …"
  {
    re: new RegExp(String.raw`\b(?:large|huge|bulk|gro(?:ss|ß)e[nr]?)\s+(?:quantit(?:y|ies)|volumes?|amounts?|mengen)\b[^.!?\n]{0,40}${COINS}`, 'i'),
    punkte: 35, name: 'grosse_mengen',
  },
  // „urgent need for large volumes of USDT"
  {
    re: new RegExp(String.raw`\b(?:urgent(?:ly)?|dringend)\b[^.!?\n]{0,40}\b(?:need|require|ben[öo]tigen|brauchen)\b[^.!?\n]{0,40}${COINS}`, 'i'),
    punkte: 30, name: 'dringender_bedarf',
  },
  // „if you hold USDT" / „USDT holders" — die Ansprache der Zielgruppe
  {
    re: new RegExp(String.raw`\b(?:if\s+you\s+hold|holders?\s+of|wenn\s+(?:du|sie|ihr)\b[^.!?\n]{0,20}\bhal(?:ten|tet|tst))\b[^.!?\n]{0,30}${COINS}|${COINS}\s+holders?\b`, 'i'),
    punkte: 25, name: 'ansprache_halter',
  },
];

// ============================================================================
// Gruppe B: garantiertes Ertragsversprechen
// ============================================================================
// Der eigentliche Köder. Eine garantierte Rendite auf eine Transaktion gibt
// es im echten Handel nicht — das ist die Stelle, an der das Angebot
// unmöglich wird, unabhängig von der Höhe.

const ERTRAG = [
  {
    re: /\b(?:guarantee[ds]?|garantiert|guaranteed)\b[^.!?\n]{0,50}\b(?:commission|provision|profit|return|rendite|gewinn|payout)/i,
    punkte: 35, name: 'garantierte_provision',
  },
  {
    re: /\b(?:commission|provision|rendite|profit|return)\b[^.!?\n]{0,40}\d{1,2}\s*%/i,
    punkte: 25, name: 'provisionssatz',
  },
  {
    re: /\d{1,2}\s*%\s*(?:to|bis|-|–|—)\s*\d{1,2}\s*%/i,
    punkte: 25, name: 'provisionsspanne',
  },
  {
    re: /\b(?:on|bei|pro|per|f[üu]r\s+jede[nr]?)\s+(?:every\s+|jede[rn]?\s+)?(?:transaction|trade|deal|transaktion|gesch[äa]ft)/i,
    punkte: 20, name: 'je_transaktion',
  },
];

// ============================================================================
// Gruppe C: Vorkasse und umgekehrte Reihenfolge
// ============================================================================
// „Wir zahlen zuerst, du überweist danach" klingt nach Sicherheit für das
// Opfer und ist der Kern des Betrugs: Die Zahlung ist gefälscht oder wird
// zurückgeholt, die Coins sind unwiderruflich weg.

const VORKASSE = [
  {
    re: /\b(?:full\s+)?(?:upfront|advance|prepay(?:ment)?|vorab|vorkasse|im\s+voraus)\b[^.!?\n]{0,40}\b(?:payment|pay|zahlung|bezahl)/i,
    punkte: 35, name: 'vorkasse_versprechen',
  },
  {
    re: /\b(?:we\s+pay\s+(?:you\s+)?first|wir\s+zahlen\s+zuerst|payment\s+before|zahlung\s+vor(?:her|ab))/i,
    punkte: 35, name: 'wir_zahlen_zuerst',
  },
  // „you simply transfer … AFTER receiving the funds"
  {
    re: /\b(?:you|du|sie)\b[^.!?\n]{0,40}\b(?:transfer|send|[üu]berweis|schick)[^.!?\n]{0,40}\b(?:after|nach(?:dem)?)\b[^.!?\n]{0,40}\b(?:receiv|erhalt|eingang|bekomm)/i,
    punkte: 35, name: 'coins_nach_geldeingang',
  },
  {
    re: /\b(?:no\s+risk|risk[- ]free|ohne\s+risiko|risikolos|100\s*%\s*(?:safe|sicher|secure))/i,
    punkte: 20, name: 'risikofrei_behauptet',
  },
];

// ============================================================================
// Gruppe D: Abwanderung in den Privatchat
// ============================================================================
// Der Abschluss jedes dieser Posts. Ohne diesen Schritt funktioniert der
// Betrug nicht — in der Gruppe würde jemand widersprechen.

const ABWANDERUNG = [
  {
    re: /\b(?:contact|kontakt(?:iere|ieren)?|write|schreib|message|dm|pm)\b[^.\n]{0,30}@[A-Za-z][A-Za-z0-9_]{4,}/i,
    punkte: 30, name: 'kontakt_zu_kennung',
  },
  {
    re: /\b(?:contact\s+us\s+now|jetzt\s+(?:melden|kontaktieren)|reach\s+out\s+(?:to\s+us\s+)?now)/i,
    punkte: 20, name: 'sofortkontakt',
  },
  {
    re: /\b(?:private(?:ly)?|privat|direct\s+message|privatchat)\b[^.!?\n]{0,30}\b(?:contact|write|schreib|message|melde)/i,
    punkte: 20, name: 'ausdruecklich_privat',
  },
];

// ============================================================================
// Gruppe E: Firmenfassade
// ============================================================================
// Schwaches Signal für sich — echte Firmen stellen sich auch vor. Zusammen
// mit dem Rest ist es die typische Seriositätskulisse dieser Posts.

const FASSADE = [
  {
    re: /\b(?:co\.?,?\s*ltd|gmbh|llc|limited|international\s+(?:trading|group|co)|holdings?)\b/i,
    punkte: 10, name: 'firmenbezeichnung',
  },
  {
    re: /\b(?:headquarter(?:ed|s)?|hauptsitz|based\s+in|ans[äa]ssig\s+in)\b/i,
    punkte: 10, name: 'sitzangabe',
  },
  {
    re: /\b(?:globally|weltweit|worldwide|international(?:ly)?)\b/i,
    punkte: 5, name: 'weltweit',
  },
];

// ============================================================================
// Bewertung
// ============================================================================

export interface KryptoBefund {
  punkte: number;
  belege: string[];
  signale: string[];
  /** Wie viele der Gruppen A–D ausgelöst haben. E zählt bewusst NICHT mit. */
  tragendeGruppen: number;
  /** true, wenn Gruppe A (Ankauf) ausgelöst hat */
  ankaufErkannt: boolean;
}

function ausschnitt(text: string, treffer: string): string {
  const i = text.toLowerCase().indexOf(treffer.toLowerCase());
  if (i < 0) return treffer;
  const von = Math.max(0, i - 15);
  const bis = Math.min(text.length, i + treffer.length + 15);
  return (von > 0 ? '…' : '') + text.substring(von, bis).replace(/\s+/g, ' ') + (bis < text.length ? '…' : '');
}

export function bewerteKryptoAnkauf(text: string): KryptoBefund {
  const t = text || '';
  const belege: string[] = [];
  const signale: string[] = [];
  let punkte = 0;
  const getroffen = new Set<string>();

  const gruppen: Array<[string, typeof ANKAUF]> = [
    ['ankauf', ANKAUF], ['ertrag', ERTRAG], ['vorkasse', VORKASSE],
    ['abwanderung', ABWANDERUNG], ['fassade', FASSADE],
  ];

  for (const [name, muster] of gruppen) {
    for (const m of muster) {
      const tr = t.match(m.re);
      if (!tr) continue;
      punkte += m.punkte;
      signale.push(m.name);
      belege.push(`${name}/${m.name}: "${ausschnitt(t, tr[0])}"`);
      getroffen.add(name);
    }
  }

  const tragend = ['ankauf', 'ertrag', 'vorkasse', 'abwanderung'].filter(g => getroffen.has(g)).length;
  return {
    punkte, belege, signale,
    tragendeGruppen: tragend,
    ankaufErkannt: getroffen.has('ankauf'),
  };
}

export type KryptoMassnahme = 'keine' | 'alarm' | 'sperren';

export interface KryptoUrteil {
  massnahme: KryptoMassnahme;
  grund: string;
  belege: string[];
  punkte: number;
}

export const SCHWELLE_SPERRE = 90;
export const SCHWELLE_ALARM = 55;

/**
 * Für eine Sperre müssen DREI Bedingungen zusammenkommen:
 *
 *  1. genug Punkte,
 *  2. mindestens drei der vier tragenden Gruppen,
 *  3. der Ankauf selbst muss erkannt sein.
 *
 * Bedingung 3 ist die wichtigste. Ohne sie träfe die Regel jeden, der über
 * Renditen und Provisionen schreibt — also halbe Gruppen, in denen es genau
 * darum geht. Erst das Angebot, große Mengen Coins anzukaufen, macht aus
 * einem Finanzgespräch dieses Betrugsmuster.
 *
 * Die Firmenfassade (Gruppe E) zählt nie als tragende Gruppe. Eine Firma,
 * die sich vorstellt, ist kein Betrüger.
 */
export function entscheideKryptoAnkauf(b: KryptoBefund): KryptoUrteil {
  const basis = { belege: b.belege, punkte: b.punkte };

  if (b.punkte >= SCHWELLE_SPERRE && b.tragendeGruppen >= 3 && b.ankaufErkannt) {
    return {
      ...basis,
      massnahme: 'sperren',
      grund: `Krypto-Ankauf-Betrug (${b.punkte} Punkte, ${b.tragendeGruppen} von 4 tragenden Merkmalen)`,
    };
  }

  if (b.punkte >= SCHWELLE_ALARM && b.tragendeGruppen >= 2) {
    return {
      ...basis,
      massnahme: 'alarm',
      grund: b.ankaufErkannt
        ? `Verdacht auf Krypto-Ankauf-Betrug (${b.punkte} Punkte, ${b.tragendeGruppen} Merkmale)`
        : `Ertrags-/Vorkasseversprechen ohne erkennbaren Ankauf (${b.punkte} Punkte) — kein Sperrgrund`,
    };
  }

  return { ...basis, massnahme: 'keine', grund: '' };
}
