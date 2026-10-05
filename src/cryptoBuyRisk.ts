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

// Geteilt mit der Copy-Trading-Erkennung: dieselbe Frage („wer schreibt?"),
// dieselbe Schwelle. Importiert statt kopiert, damit nicht zwei Zahlen
// auseinanderlaufen, die dasselbe bedeuten sollen. copyTradingRisk.ts ist ein
// reines Modul ohne Seiteneffekte — der Import zieht nichts nach sich.
import { Absender, ABSENDER_UNBEKANNT, EINGESESSEN_AB_NACHRICHTEN } from './copyTradingRisk';
export type { Absender };

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

  // ---- Nachtrag 05.10.2026, Auftrag #275: die OTC-Spielart ----------------
  // Der gemeldete Fall sagt nicht „wir kaufen USDT", sondern erzählt, dass er
  // es NICHT über die üblichen Wege kann und es deshalb teurer „erwerben"
  // muss. Das Angebot steht da, nur in der Verneinung. Die alte Wir-Form-Regel
  // hat deshalb nicht gegriffen: zwischen „acquire" und dem Coinnamen steht
  // „it", und „unable to buy" liest sich wie ein Dementi.

  // „we have to acquire it at prices …" / „our trading house must source …"
  // Das Subjekt ist bewusst weiter als nur „we/wir": Diese Posts schreiben
  // genauso oft „our company", „unsere Handelsgesellschaft", „our trading
  // house". Bei Variante 3 der Prüfung hat genau daran die Erkennung
  // gescheitert — das Angebot stand da, nur ohne das Wort „we".
  {
    re: /\b(?:we|wir|our|unser\w*|my\s+(?:company|firm|business)|meine?\s+(?:firma|gesellschaft))\b[^.!?\n]{0,40}\b(?:have\s+to|has\s+to|need\s+to|needs\s+to|must|muessen|müssen|muss)\b[^.!?\n]{0,30}\b(?:acquire|acquiring|purchase|source|sourcing|buy|obtain|erwerben|beschaffen|ankaufen|zukaufen|kaufen)\b/i,
    punkte: 30, name: 'ankauf_umschrieben',
  },
  // „unable to buy USDT in bulk through standard channels" — die Begründung,
  // warum es ausgerechnet über eine Privatperson laufen soll.
  {
    re: new RegExp(String.raw`\b(?:unable|cannot|can'?t|not\s+able|nicht\s+(?:in\s+der\s+lage|moeglich|möglich))\b[^.!?\n]{0,40}\b(?:buy|purchase|kaufen|erwerben)\b[^.!?\n]{0,40}(?:${COINS}|in\s+bulk|bulk|grosse|große)`, 'i'),
    punkte: 30, name: 'ankauf_ueber_umweg',
  },
  // „buy/purchase USDT in bulk" / „large-scale purchases" / „Ankauf von USDT
  // in großen Mengen" — die Mengenangabe steht vor ODER hinter dem Coin.
  {
    re: new RegExp(String.raw`\b(?:buy|buying|purchase|purchasing|kauf\w*|ankauf\w*)\b[^.!?\n]{0,30}(?:${COINS})[^.!?\n]{0,25}\b(?:in\s+bulk|bulk|wholesale|gro(?:ss|ß)mengen|gro(?:ss|ß)e[nr]?\s+mengen|large\s+(?:quantit\w+|volumes?|amounts?))\b|\b(?:large[- ]scale|bulk|gro(?:ss|ß)volumige?r?)\s+(?:purchase|buying|ankauf|einkauf)`, 'i'),
    punkte: 30, name: 'mengenankauf',
  },
  // VERKÄUFERANSPRACHE — und zwar in der Angebotsrichtung, nicht als Wunsch.
  // „If you are a seller looking to sell USDT, contact me" ist ein Angebot;
  // „Ich will meine USDT verkaufen, wo am besten?" ist eine Mitgliederfrage.
  // Der Unterschied steckt in der Anrede: DU verkaufst, ICH kaufe.
  {
    re: new RegExp(String.raw`\b(?:if\s+you\s+(?:are|have|want|wish|hold|’re|'re)|wenn\s+(?:du|sie|ihr)\b|wer\b)[^.!?\n]{0,50}\b(?:sell|selling|seller|verkauf\w*|abgeben|loswerden)\b`, 'i'),
    punkte: 25, name: 'verkaeuferansprache',
  },
  // Die Frageform: „Are you a seller?" / „Bist du Verkäufer?" — steht für sich,
  // ohne dass danach noch ein Verkaufswort folgen muss.
  {
    re: /\b(?:are\s+you\s+(?:a\s+|an\s+)?(?:seller|holder|usdt\s+holder)|bist\s+(?:du|sie)\s+verk[aä]ufer|hast\s+du\s+usdt)\b/i,
    punkte: 25, name: 'verkaeuferansprache',
  },
  {
    re: new RegExp(String.raw`\b(?:sellers?|verkaeufer|verkäufer)\b[^.!?\n]{0,40}\b(?:welcome|wanted|gesucht|willkommen|melde|contact|schreib)\b|\b(?:we\s+buy|wir\s+kaufen)\b[^.!?\n]{0,30}\b(?:your|deine|ihre|eure)\b[^.!?\n]{0,20}(?:${COINS})`, 'i'),
    punkte: 30, name: 'verkaeufer_gesucht',
  },
];

// ============================================================================
// Gruppe A2 — Aufschlag über dem Marktpreis
// ============================================================================
// Das Herzstück der OTC-Spielart und der Satz, an dem sie unmöglich wird:
// Niemand zahlt freiwillig 5–20 % über Markt, wenn er die Ware am Markt
// bekommen kann. Der Aufschlag ist der Köder und gleichzeitig der Beweis.
//
// Abgrenzung zu „Provision" (Gruppe B): Eine Provision ist eine Vergütung,
// ein Aufschlag ist ein PREIS. Das sind zwei verschiedene Versprechen, und
// sie treten auch getrennt auf — deshalb eine eigene Gruppe statt einer
// Erweiterung. Vorher wurde „5%–20% above the market rate" als
// „provisionsspanne" gezählt: richtige Punktzahl, falsche Begründung, und in
// einer Meldung an Marco hätte das Wort Provision gestanden, wo Aufschlag
// gemeint war.

const AUFSCHLAG = [
  // „5%–20% above the market rate" / „10 % über dem Marktpreis"
  {
    re: /\d{1,3}\s*%(?:\s*(?:[-–—]|to|bis)\s*\d{1,3}\s*%)?\s*(?:\w+\s+){0,3}(?:above|over|higher\s+than|ueber|über|mehr\s+als)\s+(?:the\s+|dem\s+|den\s+)?(?:market|spot|marktpreis|markt|kurs|börsenkurs|boersenkurs)/i,
    punkte: 35, name: 'aufschlag_ueber_markt',
  },
  // „above the market rate" ohne Zahl / „über dem Marktpreis"
  {
    re: /\b(?:above|over|higher\s+than)\s+(?:the\s+)?market\s+(?:rate|price|value)|ueber\s+dem\s+markt(?:preis|wert)|über\s+dem\s+markt(?:preis|wert)/i,
    punkte: 30, name: 'aufschlag_ueber_markt',
  },
  // „we pay a premium" / „Premium von 8 %" / „Aufschlag von 10 %"
  {
    re: /\b(?:premium|aufschlag|zuschlag|bonus)\s*(?:of|von|in\s+h[oö]he\s+von|:)?\s*\d{1,3}\s*%|\b(?:pay|zahlen)\s+(?:a\s+|einen\s+)?(?:premium|aufschlag)\b/i,
    punkte: 30, name: 'aufschlag_genannt',
  },
  // „best rates available" / „highly favorable rates" / „beste Kurse"
  {
    re: /\b(?:best|better|highly\s+favorable|favourable|top|attraktive?|beste[nr]?|bessere[nr]?)\s+(?:rates?|prices?|kurse?|preise?|konditionen)\b/i,
    punkte: 20, name: 'bestpreis_behauptet',
  },
];

// ============================================================================
// Gruppe C2 — Zölle, Steuern, Behörden umgehen
// ============================================================================
// Die Begründungsgeschichte. Sie erklärt dem Opfer, warum ein Millionenhandel
// ausgerechnet über seinen privaten Wallet laufen soll — und ist gleichzeitig
// die Einladung, sich selbst strafbar zu machen. Ein seriöses Handelshaus
// schreibt nicht in eine offene Gruppe, dass es Zölle vermeiden will.

const UMGEHUNG = [
  {
    re: /\b(?:to\s+)?(?:avoid|evade|bypass|circumvent|umgehen|vermeiden|sparen)\b[^.!?\n]{0,40}\b(?:tariffs?|customs?|duties|taxes|taxation|z[oö]lle?|zollgeb[uü]hren|steuern|abgaben|einfuhr\w*)\b/i,
    punkte: 35, name: 'zoll_steuer_umgehung',
  },
  {
    re: /\b(?:tariffs?|customs?|duties|taxes|z[oö]lle?|steuern)\b[^.!?\n]{0,30}\b(?:avoid|evade|bypass|umgehen|vermeiden|sparen|umzugehen|zu\s+vermeiden)\b/i,
    punkte: 35, name: 'zoll_steuer_umgehung',
  },
  // „due to policy restrictions" / „wegen behördlicher Auflagen"
  {
    re: /\b(?:policy|government|regulatory|legal|capital\s+control|beh[oö]rdlich\w*|staatlich\w*|gesetzlich\w*)\s*(?:restrictions?|controls?|limits?|einschr[aä]nkungen|auflagen|beschr[aä]nkungen|kontrollen)/i,
    punkte: 30, name: 'behoerdliche_beschraenkung',
  },
  // „through standard channels" / „außerhalb der üblichen Wege"
  {
    re: /\b(?:standard|official|normal|regular|conventional|[uü]blich\w*|offiziell\w*|regul[aä]r\w*)\s+(?:channels?|exchanges?|routes?|wege?n?|kan[aä]le?n?|b[oö]rsen)\b/i,
    punkte: 20, name: 'abseits_der_kanaele',
  },
  // „no KYC" / „ohne Nachweis" im Handelszusammenhang
  {
    re: /\b(?:no|without|ohne)\s+(?:kyc|verification|verifizierung|nachweis|ausweis|identit[aä]tspr[uü]fung|fragen)\b/i,
    punkte: 20, name: 'ohne_nachweis',
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

  // ---- Nachtrag 05.10.2026, Auftrag #275 ---------------------------------
  // „we will make the payment first" sagt dasselbe wie „we pay first" und ist
  // an der alten Regel vorbeigelaufen, weil zwischen „we" und „pay" vier
  // Wörter stehen. Deshalb jetzt über die Satzstellung statt über die
  // Wortfolge: irgendeine Zahlungshandlung von UNS, und irgendwo im Satz das
  // Wort „zuerst".
  {
    re: /\b(?:we|wir)\b[^.!?\n]{0,40}\b(?:pay|payment|paid|transfer|send\s+(?:the\s+)?(?:money|funds)|zahl\w*|bezahl\w*|[uü]berweis\w*|senden\s+(?:das\s+)?geld)\b[^.!?\n]{0,30}\b(?:first|upfront|in\s+advance|beforehand|zuerst|vorab|zuvor|im\s+voraus|als\s+erste[rs]?)\b/i,
    punkte: 35, name: 'wir_zahlen_zuerst',
  },
  // Die umgekehrte Reihenfolge im Klartext: „payment first, then you transfer"
  {
    re: /\b(?:payment|zahlung|geld)\b[^.!?\n]{0,20}\b(?:first|zuerst|vorab)\b[^.!?\n]{0,40}\b(?:then|danach|dann|anschlie(?:ss|ß)end)\b[^.!?\n]{0,30}\b(?:you|du|sie|ihr)\b/i,
    punkte: 35, name: 'wir_zahlen_zuerst',
  },
  // „Once we confirm you hold the USDT" — die Bestandsprüfung vor der Zahlung.
  // Harmlos klingende Zeile, in der die Prüfung des Opfervermögens steckt.
  {
    re: new RegExp(String.raw`\b(?:once|after|as\s+soon\s+as|sobald|wenn)\b[^.!?\n]{0,20}\b(?:we|wir)\b[^.!?\n]{0,20}\b(?:confirm|verify|check|best[aä]tig\w*|pr[uü]f\w*)\b[^.!?\n]{0,30}(?:${COINS}|\bhold|\bbesitz|\bhab)`, 'i'),
    punkte: 25, name: 'bestandspruefung_vor_zahlung',
  },
];

// ============================================================================
// Gruppe F — Geld-Emoji-Ketten (stützend, NIE tragend)
// ============================================================================
// Drei oder mehr Geld-, Herz- oder Reichtums-Emojis hintereinander. Für sich
// kein Betrug — ein Mitglied darf sich freuen —, aber in dieser Gattung so
// verlässlich dabei, dass es als Stütze zählt. Gemessen wird die KETTE, nicht
// die Gesamtzahl: Ein Text mit zehn verstreuten Emojis ist Begeisterung, drei
// direkt hintereinander sind ein Werbebanner.

const GELD_EMOJI = /[\u{1F4B5}-\u{1F4B8}\u{1F4B0}\u{1F911}\u{2764}\u{1F48E}\u{1F680}\u{1F525}\u{2705}\u{1F449}]\u{FE0F}?/u;

function emojiKette(text: string): number {
  const re = new RegExp(`(?:${GELD_EMOJI.source})`, 'gu');
  let laengste = 0, lauf = 0, letztesEnde = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // „hintereinander" heißt: direkt anschließend oder nur durch Leerzeichen
    // getrennt. Ein Emoji mitten im Satz bricht die Kette.
    if (m.index === letztesEnde || (letztesEnde >= 0 && /^\s+$/.test(text.substring(letztesEnde, m.index)))) {
      lauf++;
    } else {
      lauf = 1;
    }
    letztesEnde = m.index + m[0].length;
    if (lauf > laengste) laengste = lauf;
  }
  return laengste;
}

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
  /**
   * Wie viele der TRAGENDEN Gruppen ausgelöst haben: Ankauf, Aufschlag,
   * Ertrag, Vorkasse, Umgehung, Abwanderung. Firmenfassade und Emoji-Kette
   * zählen bewusst NICHT mit — eine Firma, die sich vorstellt, ist kein
   * Betrüger, und Emojis sind kein Tatbestand.
   */
  tragendeGruppen: number;
  /** Namen aller ausgelösten Gruppen, inklusive der stützenden. */
  getroffeneGruppen: string[];
  /** true, wenn Gruppe A (Ankauf oder Verkäuferansprache) ausgelöst hat */
  ankaufErkannt: boolean;
  /** true, wenn der Text vor dieser Masche warnt statt sie zu betreiben. */
  warnkontext: boolean;
  /** true, wenn der Absender als eingesessenes Mitglied erkannt wurde. */
  eingesessen: boolean;
  /** Längste Kette aus Geld-Emojis. */
  emojiKette: number;
}

// ---------------------------------------------------------------------------
// Warnkontext und Absendergewichtung
// ---------------------------------------------------------------------------
// Beides eingeführt am 05.10.2026 mit Auftrag #275, und beides aus demselben
// Grund: Die Regel ist an diesem Tag deutlich breiter geworden (Aufschlag,
// Umgehung, Verkäuferansprache, Emoji-Ketten). Breiter heißt mehr Treffer,
// und mehr Treffer heißt auch mehr Fehlalarm — es sei denn, es kommt etwas
// dazu, das in die andere Richtung zieht.
//
// Die Bauteile sind dieselben wie in copyTradingRisk.ts, und sie werden von
// dort importiert statt kopiert: Zwei Schwellen für „eingesessen", die
// auseinanderlaufen, wären ein Fehler, den niemand bemerkt.

const WARNKONTEXT = [
  /\b(?:achtung|vorsicht|warnung|aufgepasst|passt?\s+auf|finger\s+weg)\b/iu,
  /\b(?:betrug|betr[üu]ger|scam(?:mer)?|f[äa]lschung|fake|abzocke|masche|unseri[öo]s)\b/iu,
  /\b(?:beware|careful|warning|don'?t\s+fall|do\s+not\s+fall|never\s+(?:send|pay|trust))\b/iu,
  /\b(?:nie|niemals|nicht)\s+(?:drauf\s+)?(?:eingehen|antworten|anschreiben|einzahlen|glauben)\b/iu,
];

/** Signale, bei denen der Warnkontext-Dämpfer NICHT greift. */
const IMPFSCHUTZ = new Set([
  'kontakt_zu_kennung', 'sofortkontakt', 'ausdruecklich_privat',
  'verkaeufer_gesucht', 'aufschlag_ueber_markt', 'aufschlag_genannt',
]);

function ausschnitt(text: string, treffer: string): string {
  const i = text.toLowerCase().indexOf(treffer.toLowerCase());
  if (i < 0) return treffer;
  const von = Math.max(0, i - 15);
  const bis = Math.min(text.length, i + treffer.length + 15);
  return (von > 0 ? '…' : '') + text.substring(von, bis).replace(/\s+/g, ' ') + (bis < text.length ? '…' : '');
}

/** Wer schreibt, zählt mit — siehe copyTradingRisk.ts für die Begründung. */
export interface KryptoUmstaende {
  absender?: Absender;
}

export function bewerteKryptoAnkauf(text: string, umstaende: KryptoUmstaende = {}): KryptoBefund {
  const t = text || '';
  const belege: string[] = [];
  const signale: string[] = [];
  let punkte = 0;
  const getroffen = new Set<string>();

  const gruppen: Array<[string, typeof ANKAUF]> = [
    ['ankauf', ANKAUF], ['aufschlag', AUFSCHLAG], ['ertrag', ERTRAG],
    ['vorkasse', VORKASSE], ['umgehung', UMGEHUNG],
    ['abwanderung', ABWANDERUNG], ['fassade', FASSADE],
  ];

  // Ein Signalname zählt nur einmal, auch wenn mehrere Schreibweisen dafür
  // hinterlegt sind — sonst gibt eine Formulierung, für die es zwei Muster
  // gibt, doppelt Punkte, und die Schwelle wird zufällig.
  const gezaehlt = new Set<string>();

  for (const [name, muster] of gruppen) {
    for (const m of muster) {
      const tr = t.match(m.re);
      if (!tr) continue;
      getroffen.add(name);
      if (gezaehlt.has(m.name)) continue;
      gezaehlt.add(m.name);
      punkte += m.punkte;
      signale.push(m.name);
      belege.push(`${name}/${m.name}: "${ausschnitt(t, tr[0])}"`);
    }
  }

  // Geld-Emoji-Kette: stützt, trägt nie, und nur wenn inhaltlich schon etwas
  // getroffen hat. Eine Emoji-Kette allein ist Begeisterung.
  const kette = emojiKette(t);
  if (kette >= 3 && getroffen.size > 0) {
    punkte += 10;
    signale.push('geld_emoji_kette');
    belege.push(`emoji/geld_emoji_kette: "${kette} Geld-Emojis hintereinander"`);
  }

  // Warnkontext: Wer vor der Masche warnt, zitiert sie.
  const wirbt = [...gezaehlt].some(s => IMPFSCHUTZ.has(s));
  const warnkontext = !wirbt && getroffen.size > 0 && WARNKONTEXT.some(re => re.test(t));
  if (warnkontext) {
    punkte -= 50;
    signale.push('warnkontext');
    const tr = WARNKONTEXT.map(re => t.match(re)).find(Boolean);
    belege.push(`warnung/warnkontext: "${tr ? ausschnitt(t, tr[0]) : ''}" — spricht ÜBER die Masche`);
  }

  // Absendergewichtung
  const a = umstaende.absender ?? ABSENDER_UNBEKANNT;
  const eingesessen = (a.nachrichtenInGruppe ?? 0) >= EINGESESSEN_AB_NACHRICHTEN;
  if (getroffen.size > 0) {
    if (eingesessen) {
      punkte -= 40;
      signale.push('eingesessenes_mitglied');
      belege.push(`absender/eingesessenes_mitglied: "${a.nachrichtenInGruppe} Nachrichten in dieser Gruppe"`);
    } else if (a.nachrichtenInGruppe !== null && a.nachrichtenInGruppe <= 2) {
      punkte += 20;
      signale.push('kaum_beigetragen');
      belege.push(`absender/kaum_beigetragen: "${a.nachrichtenInGruppe}. Nachricht in dieser Gruppe"`);
    }
  }

  const tragend = ['ankauf', 'aufschlag', 'ertrag', 'vorkasse', 'umgehung', 'abwanderung']
    .filter(g => getroffen.has(g)).length;

  return {
    punkte: Math.max(0, punkte), belege, signale,
    tragendeGruppen: tragend,
    getroffeneGruppen: [...getroffen],
    ankaufErkannt: getroffen.has('ankauf'),
    warnkontext, eingesessen,
    emojiKette: kette,
  };
}

/**
 * Drei Stufen statt zwei, seit Auftrag #275 (05.10.2026).
 *
 *   sperren  — löschen und in allen Gruppen sperren
 *   loeschen — löschen und dem Menschen vorlegen, niemand gesperrt
 *   alarm    — NUR vorlegen, nichts gelöscht, niemand gesperrt
 *
 * Bis dahin gab es nur „alarm" und „sperren", und „sperren" war über den
 * Schalter CRYPTO_BUY_AUTO_BAN abgeschaltet — die Nachricht blieb also in
 * jedem Fall stehen. Marco hat am 05.10.2026 ausdrücklich das Gegenteil
 * verlangt: löschen und sperren, so wie bei den Copy-Trading-Fällen.
 */
export type KryptoMassnahme = 'keine' | 'alarm' | 'loeschen' | 'sperren';

export interface KryptoUrteil {
  massnahme: KryptoMassnahme;
  grund: string;
  belege: string[];
  punkte: number;
}

export const SCHWELLE_SPERRE = 90;
export const SCHWELLE_LOESCHEN = 60;
export const SCHWELLE_ALARM = 55;

/**
 * Was aus einem Handelsgespräch diese Masche macht: die Stellen, an denen das
 * Angebot wirtschaftlich unmöglich wird. Mindestens eine davon muss dabei
 * sein, bevor gelöscht oder gesperrt wird — sonst trifft die Regel jeden, der
 * über Ankauf, Kurse und Kennungen schreibt, und das ist in diesen Gruppen die
 * halbe Belegschaft.
 */
const UNMOEGLICHKEIT = ['aufschlag', 'vorkasse', 'ertrag', 'umgehung'];

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
  const unmoeglich = UNMOEGLICHKEIT.some(g => b.getroffeneGruppen.includes(g));

  // Wer vor der Masche warnt, wird nie gesperrt und nie gelöscht.
  if (b.warnkontext) {
    return { ...basis, massnahme: 'keine', grund: '' };
  }

  if (b.punkte >= SCHWELLE_SPERRE && b.tragendeGruppen >= 3 && b.ankaufErkannt
      && unmoeglich && !b.eingesessen) {
    return {
      ...basis,
      massnahme: 'sperren',
      grund: `Krypto-Ankauf-Betrug (${b.punkte} Punkte, ${b.tragendeGruppen} von 6 tragenden Merkmalen)`,
    };
  }

  // Löschen, aber nicht sperren: Das Angebot ist erkennbar, für eine Sperre
  // fehlt etwas — zu wenige Merkmale, oder der Absender ist ein eingesessenes
  // Mitglied. Dann entscheidet ein Mensch über das Konto, nicht die Regel.
  if (b.punkte >= SCHWELLE_LOESCHEN && b.tragendeGruppen >= 2 && b.ankaufErkannt && unmoeglich) {
    return {
      ...basis,
      massnahme: 'loeschen',
      grund: b.eingesessen
        ? `Krypto-Ankaufangebot von einem eingesessenen Mitglied (${b.punkte} Punkte) — entfernt, nicht gesperrt`
        : `Krypto-Ankaufangebot (${b.punkte} Punkte, ${b.tragendeGruppen} Merkmale) — entfernt, Konto vorgelegt`,
    };
  }

  if (b.punkte >= SCHWELLE_ALARM && b.tragendeGruppen >= 2) {
    return {
      ...basis,
      massnahme: 'alarm',
      grund: b.ankaufErkannt
        ? `Verdacht auf Krypto-Ankauf-Betrug (${b.punkte} Punkte, ${b.tragendeGruppen} Merkmale)`
        : `Ertrags-/Vorkasseversprechen ohne erkennbaren Ankauf (${b.punkte} Punkte) — kein Löschgrund`,
    };
  }

  return { ...basis, massnahme: 'keine', grund: '' };
}
