/**
 * copyTradingRisk.ts — Der Copy-Trading-Scam
 *
 * DAS MUSTER, nicht der Wortlaut:
 * Ein Konto stellt Gewinn-Screenshots einer Kryptobörse in die Gruppe —
 * dreistellige Prozentgewinne, hoher Hebel, eine Trefferquote, die es nicht
 * gibt — und schreibt darunter in zwei Zeilen Englisch, wem es das zu danken
 * hat: einer @-Kennung, einem Kanal, einem „Mentor". Im Bild steckt ein
 * QR-Code und ein Werbecode der Börse. Wer die Kennung anschreibt, zahlt ein.
 *
 * Am 27.09.2026 ist genau das in „Staatenlos / Geldhelden MeetUp Koh Phangan"
 * durchgekommen. Der alte Erkenner (src/scam.ts) kam auf 0 von 70 Punkten:
 * kein einziges seiner Muster kennt Copy-Trading. Das ist die Lücke, die
 * diese Datei schließt.
 *
 * WARUM KEINE LISTE VON BÖRSENNAMEN:
 * Eine Liste („BingX, Bybit, MEXC, …") ist an dem Tag falsch, an dem sie
 * geschrieben wird — dieselbe Lehre wie die 17 gmx-Endungen im Newsletter.
 * Was eine Börse verrät, ist nicht ihr Name, sondern ihre SYNTAX: das
 * Handelspaar (BTCUSDT), das Wort Perp, die Positionszeile aus Long/Short,
 * Hebel, Einstiegskurs und PnL. Die überlebt jede Umbenennung. Und sie hat
 * den zweiten Vorteil, der eine Namensliste erledigt: „Hat jemand Erfahrung
 * mit BingX?" ist eine echte Mitgliederfrage und darf nicht greifen.
 *
 * WARUM DIE UNGLAUBWÜRDIGKEIT DAS SIGNAL IST, NICHT DAS THEMA:
 * In diesen Gruppen reden echte Menschen täglich über Trading. Wer „+12 %"
 * oder „Hebel 3x" schreibt, berichtet; wer „+348,86 %" und „98 % win rate"
 * schreibt, wirbt. Deshalb zählt eine Gewinnangabe erst ab 100 % und eine
 * Trefferquote erst ab 80 %. Unter diesen Grenzen ist das Thema Trading
 * schlicht ein Thema.
 *
 * Keine Seiteneffekte, keine Datenbank, keine Importe — prüfbar mit
 * scripts/test-copy-trading.ts und, am Ausgelieferten,
 * src/pruefungen/abnahmeCopyTrading.ts.
 */

// ============================================================================
// Gruppe A — unglaubwürdige Gewinnangabe
// ============================================================================
// Das Lockmittel. Nicht „Gewinn", sondern eine Größenordnung, die es im
// echten Handel nicht gibt. Die Grenzen (100 % Gewinn, 80 % Trefferquote)
// sind der ganze Fehlalarmschutz dieser Gruppe.

const GEWINN = [
  // „+348,86 %" / „+648.26%" — Pluszeichen und dreistellig. Das eindeutigste
  // Einzelsignal des ganzen Musters.
  {
    re: /[+＋]\s*\d{3,}(?:[.,]\d+)?\s*%/u,
    punkte: 35, name: 'plusprozent_dreistellig',
  },
  // „profit 250%" / „ROI: 1200 %" / „Rendite 300%" — Ertragswort und eine
  // Zahl ab 100. Zwei Leserichtungen, weil beide vorkommen.
  {
    re: /\b(?:profit|pnl|roi|gain|returns?|rendite|gewinn|ertrag|zuwachs)\b[^\n]{0,25}[+＋]?\s*(?:[1-9]\d{2,}|100)(?:[.,]\d+)?\s*(?:%|prozent)/iu,
    punkte: 30, name: 'ertragswort_mit_grossprozent',
  },
  {
    re: /[+＋]?\s*(?:[1-9]\d{2,}|100)(?:[.,]\d+)?\s*(?:%|prozent)[^\n]{0,25}\b(?:profit|pnl|roi|gain|returns?|rendite|gewinn|ertrag|plus)\b/iu,
    punkte: 30, name: 'grossprozent_mit_ertragswort',
  },
  // Trefferquote ab 80 %. Eine Quote, die es nicht gibt — und der Satz, mit
  // dem dieser Scam immer arbeitet.
  {
    re: /\b(?:8\d|9\d|100)(?:[.,]\d+)?\s*%\s*(?:\w+\s+){0,2}(?:win[\s-]?rate|winrate|accuracy|success(?:\s+rate)?|trefferquote|erfolgsquote|genauigkeit)/iu,
    punkte: 35, name: 'trefferquote_unglaubwuerdig',
  },
  {
    re: /\b(?:win[\s-]?rate|winrate|accuracy|trefferquote|erfolgsquote)\b[^\n]{0,15}(?:8\d|9\d|100)(?:[.,]\d+)?\s*%/iu,
    punkte: 35, name: 'trefferquote_unglaubwuerdig',
  },
  // „10x your money" / „verdopple dein Geld"
  {
    re: /\b\d{1,3}\s*x\s*(?:your\s+)?(?:money|investment|capital|profit|kapital|geld|einsatz)\b/iu,
    punkte: 25, name: 'vervielfachung_versprochen',
  },
  {
    re: /\b(?:verdoppel|verdreifach|verzehnfach)\w*\s+(?:dein|ihr|euer)\w*\s+(?:geld|kapital|einsatz)/iu,
    punkte: 25, name: 'vervielfachung_versprochen',
  },
];

// ============================================================================
// Gruppe B — Hebelangabe
// ============================================================================
// Ein Hebel allein ist kein Betrug, sondern ein Produkt. Er zählt hier, weil
// er die Screenshot-Sprache mitbringt — und ein hoher Hebel zusätzlich, weil
// „50x" in einem Erfolgsbericht rechnerisch nichts anderes heißt als Glück.
// Eine nackte Zahl mit x („2x täglich") greift bewusst NICHT.

const HEBEL = [
  // „Leverage: 33x" / „Hebel von 50x" / „cross 20x" / „isolated 10x"
  {
    re: /\b(?:leverage|hebel|cross|isolated|margin)\b\s*(?:von\s+|of\s+|:\s*)?\s*(\d{1,3})\s*[xX]\b/iu,
    punkte: 25, name: 'hebelangabe',
  },
  // „33x leverage" / „50x Hebel"
  {
    re: /\b(\d{1,3})\s*[xX]\s*(?:leverage|hebel|long|short)\b/iu,
    punkte: 25, name: 'hebelangabe',
  },
  // Die Tabellensyntax der Börsen-Screenshots: „| 33x |" oder „| Long | 50x |"
  {
    re: /[|·•]\s*(\d{1,3})\s*[xX]\s*[|·•]/u,
    punkte: 25, name: 'hebelangabe_screenshotzeile',
  },
];

/** Höchster Hebel im Text, oder null. Ab 20x kommt ein Zuschlag dazu. */
function hoechsterHebel(text: string): number | null {
  let max: number | null = null;
  const muster = [
    /\b(?:leverage|hebel|cross|isolated|margin)\b\s*(?:von\s+|of\s+|:\s*)?\s*(\d{1,3})\s*[xX]\b/giu,
    /\b(\d{1,3})\s*[xX]\s*(?:leverage|hebel|long|short)\b/giu,
    /[|·•]\s*(\d{1,3})\s*[xX]\s*[|·•]/gu,
  ];
  for (const re of muster) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && (max === null || n > max)) max = n;
    }
  }
  return max;
}

// ============================================================================
// Gruppe C — Copy-Trading-Vokabular
// ============================================================================
// Das Angebot selbst: jemand anderes handelt, du machst nach. Das ist das
// Leitsignal dieses Musters — ohne es ist ein Gewinn-Screenshot nur eine
// Angeberei, mit ihm wird er ein Verkaufsgespräch.

const VOKABULAR = [
  // „copying his trades" / „copy my trades" / „copy trading" / „copytrade"
  {
    re: /\bcopy(?:ing)?[\s-]*(?:my|his|her|our|their|the|these|those)?\s*(?:trades?|signals?|positions?|orders?)\b/iu,
    punkte: 35, name: 'trades_kopieren',
  },
  {
    re: /\bcopy[\s-]?trad(?:e|es|er|ing)\b/iu,
    punkte: 35, name: 'trades_kopieren',
  },
  // Deutsch, in beiden Wortstellungen: „Trades kopieren", „ich kopiere die
  // Trades von …"
  {
    re: /\btrades?\s+(?:von\s+\S+\s+)?kopier\w*/iu,
    punkte: 35, name: 'trades_kopieren',
  },
  {
    re: /\bkopier\w*\s+(?:ich\s+|seit\s+\S+\s+\S+\s+)?(?:die|seine|ihre|dessen)?\s*trades?\b/iu,
    punkte: 35, name: 'trades_kopieren',
  },
  // Signale als Ware: „free signals", „daily trading signals", „VIP signals",
  // „join my signal channel". „Signal" allein greift nicht — in diesen
  // Gruppen ist „ein gutes Signal" eine normale Formulierung.
  {
    re: /\b(?:free|daily|vip|premium|paid|accurate|trading|crypto|forex)\s+signals?\b/iu,
    punkte: 25, name: 'signale_als_ware',
  },
  {
    re: /\bsignals?\b[^\n]{0,20}\b(?:group|channel|gruppe|kanal|join|abonnier|subscribe|kostenlos|free)\b/iu,
    punkte: 25, name: 'signale_als_ware',
  },
  // Das Vokabular der Quote — auch ohne Zahl ein Werbewort.
  {
    re: /\b(?:win[\s-]?rate|winrate|trefferquote|erfolgsquote)\b/iu,
    punkte: 20, name: 'quotenvokabular',
  },
  // Die Empfehlungsformel: „I only listen to X", „thanks to Mr. X",
  // „all credit to @X". Kurz, englisch, und in echten Gesprächen selten.
  {
    re: /\b(?:i\s+)?only\s+(?:listen\s+to|follow|trust)\b/iu,
    punkte: 25, name: 'empfehlungsformel',
  },
  {
    re: /\b(?:thanks?|credit|shoutout)\s+(?:goes\s+)?to\s+(?:mr\.?|mrs\.?|ms\.?|@|expert|trader|coach)/iu,
    punkte: 20, name: 'empfehlungsformel',
  },
  {
    re: /\bich\s+h[öo]re\s+nur\s+auf\b/iu,
    punkte: 25, name: 'empfehlungsformel',
  },
  // Der Mentor, der Guru, der Experte — in Verbindung mit Geld oder Kennung.
  {
    re: /\b(?:mentor|trading\s+(?:coach|master|guru|expert|pro)|account\s+manager|kontomanager)\b/iu,
    punkte: 20, name: 'mentorfigur',
  },
  // „profit with me", „earn with me", „verdiene mit mir"
  {
    re: /\b(?:profit|earn|trade|verdien\w*|handel\w*)\s+(?:with|mit)\s+(?:me|mir|us|uns)\b/iu,
    punkte: 25, name: 'mitmachangebot',
  },
];

// ============================================================================
// Gruppe D — Werbe- und Einladungscode
// ============================================================================
// Das Geldmotiv. Der Werber verdient an der Anmeldung, nicht am Handel.
// Ein Code ist außerdem das eine Element, das kein echtes Mitglied versehentlich
// schreibt.

const CODE = [
  {
    re: /\b(?:referral|referal|invit(?:e|ation)|promo|bonus|discount|affiliate|partner|empfehlungs?|einladungs?|werbe)[\s_-]*(?:code|kennung|nummer|link)\b/iu,
    punkte: 30, name: 'werbecode_genannt',
  },
  // Der Code selbst: Werbecode-Wort, dann ein Block aus Großbuchstaben und
  // Ziffern. „Referral Code LHVUGTBO".
  {
    re: /\b(?:referral|referal|invit(?:e|ation)|promo|bonus|affiliate|empfehlungs?|einladungs?|werbe)[\s_-]*(?:code|kennung|nummer)\b\s*[:=]?\s*([A-Z0-9]{5,14})\b/u,
    punkte: 15, name: 'werbecode_mit_wert',
  },
  // Die Börsen-Kennnummer, mit der Werber sich zuordnen: „UID: 12345678"
  {
    re: /\b(?:uid|user\s*id|my\s+id|meine\s+id)\b\s*[:=]?\s*\d{5,}/iu,
    punkte: 15, name: 'kennnummer_geteilt',
  },
  // „sign up with my link", „register under me"
  {
    re: /\b(?:sign\s*up|register|anmelden|registrier\w*)\b[^\n]{0,25}\b(?:my\s+link|my\s+code|under\s+me|über\s+mein|mit\s+meinem)\b/iu,
    punkte: 25, name: 'anmeldung_ueber_mich',
  },
];

// ============================================================================
// Gruppe E — Abwanderung aus der Gruppe
// ============================================================================
// Ohne diesen Schritt funktioniert der Betrug nicht: In der Gruppe würde
// jemand widersprechen. Eine nackte @-Kennung wiegt bewusst wenig — in einer
// Gruppe erwähnen sich Menschen gegenseitig.

const ABWANDERUNG = [
  {
    re: /\b(?:contact|kontakt(?:iere|ieren)?|write|schreib\w*|message|reach\s+out|dm|pm|ping)\b[^.\n]{0,30}@[A-Za-z][A-Za-z0-9_]{4,}/iu,
    punkte: 30, name: 'kontakt_zu_kennung',
  },
  {
    re: /(?:t\.me|telegram\.me)\/(?:\+|joinchat\/|[A-Za-z][A-Za-z0-9_]{4,})/iu,
    punkte: 30, name: 'telegram_link',
  },
  {
    re: /\b(?:dm|pm)\s+(?:me|mich|uns)\b|\bwrite\s+me\s+(?:privately|in\s+private|direct)|\bschreib\s+mir\s+privat/iu,
    punkte: 25, name: 'privatchat_aufforderung',
  },
  // Die nackte Kennung. Wenig Punkte, trägt nur im Verbund.
  {
    re: /(?:^|[\s(])@[A-Za-z][A-Za-z0-9_]{4,}\b/u,
    punkte: 15, name: 'fremde_kennung_genannt',
  },
];

// ============================================================================
// Gruppe F — Börsen- und Ordersyntax (stützend, NIE tragend)
// ============================================================================
// Hier steht absichtlich kein einziger Börsenname. Was einen
// Börsen-Screenshot ausmacht, ist seine Syntax, und die überlebt jede
// Umbenennung.

const BOERSENSYNTAX = [
  // Handelspaar: BTCUSDT, ATOMUSDT, ETHUSDC, SOL/USDT
  {
    re: /\b[A-Z]{2,10}\s*[\/-]?\s*(?:USDT|USDC|BUSD|USD|FDUSD)\b/u,
    punkte: 10, name: 'handelspaar',
  },
  {
    re: /\bperp(?:etual)?s?\b/iu,
    punkte: 10, name: 'perpetual',
  },
  // Die Positionszeile: Long/Short zusammen mit einem Ordersbegriff.
  {
    re: /\b(?:long|short)\b[^\n]{0,40}\b(?:closed|position\s+active|entry\s+price|entry|pnl|roi|take\s+profit|stop\s+loss|unrealized)\b/iu,
    punkte: 10, name: 'positionszeile',
  },
  {
    re: /\b(?:entry\s+price|einstiegskurs|unrealized\s+pnl|realized\s+pnl)\b/iu,
    punkte: 10, name: 'orderfelder',
  },
];

// ============================================================================
// Warnkontext — wer vor dem Scam warnt, zitiert ihn
// ============================================================================
// Der häufigste Fehlalarm dieser Regel, und er ist beim ersten Testlauf am
// 27.09.2026 auch sofort eingetreten: Ein Mitglied schreibt „Achtung, oben
// war Spam mit 98 % win rate und Copy Trading" — und trägt damit dieselben
// Wörter wie der Betrüger. Eine Regel, die genau die Leute abstraft, die die
// Gruppe schützen, erzieht zum Wegsehen.
//
// Der Dämpfer greift NICHT, wenn gleichzeitig ein Werbecode oder eine
// Aufforderung zum Privatchat im Text steht. Sonst wäre „Achtung" das Wort,
// mit dem sich jeder Scam impfen könnte.

const WARNKONTEXT = [
  /\b(?:achtung|vorsicht|warnung|aufgepasst|passt?\s+auf|finger\s+weg)\b/iu,
  /\b(?:betrug|betr[üu]ger|scam(?:mer)?|f[äa]lschung|fake|abzocke|masche|unseri[öo]s)\b/iu,
  /\b(?:beware|careful|warning|don'?t\s+fall|do\s+not\s+fall|never\s+(?:send|pay|trust))\b/iu,
  /\b(?:nie|niemals|nicht)\s+(?:drauf\s+)?(?:eingehen|antworten|anschreiben|einzahlen|glauben)\b/iu,
  /\b(?:gemeldet|melde\s+ich|bitte\s+l[öo]schen|報告)\b/iu,
];

const IMPFSCHUTZ_SIGNALE = new Set([
  'werbecode_genannt', 'werbecode_mit_wert', 'kennnummer_geteilt', 'anmeldung_ueber_mich',
  'kontakt_zu_kennung', 'telegram_link', 'privatchat_aufforderung',
]);

// ============================================================================
// Absender — wer schreibt, zählt mit
// ============================================================================
// Ein Konto, das heute beigetreten ist und noch nie etwas beigetragen hat,
// ist etwas anderes als ein Mitglied seit zwei Jahren. Diese Gewichtung ist
// nicht Feinschliff, sondern der Grund, warum echte Mitglieder über Trading
// reden dürfen: Sie zieht dieselbe Nachricht bei einem bekannten Gesicht
// unter jede Schwelle.

export interface Absender {
  /** Gezählte Nachrichten dieses Kontos in DIESER Gruppe, oder null wenn unbekannt. */
  nachrichtenInGruppe: number | null;
  /** Geschätztes Kontoalter in Tagen, oder null wenn nicht schätzbar. */
  kontoAlterTage: number | null;
}

export const ABSENDER_UNBEKANNT: Absender = { nachrichtenInGruppe: null, kontoAlterTage: null };

/** Ab so vielen Nachrichten in der Gruppe gilt jemand als eingesessen. */
export const EINGESESSEN_AB_NACHRICHTEN = 20;

// ============================================================================
// Bewertung
// ============================================================================

export type Gruppenname = 'gewinn' | 'hebel' | 'vokabular' | 'code' | 'abwanderung' | 'boerse';

/** A–E tragen. F (Börsensyntax) stützt und trägt nie — eine Kurstabelle ist kein Betrug. */
const TRAGENDE_GRUPPEN: Gruppenname[] = ['gewinn', 'hebel', 'vokabular', 'code', 'abwanderung'];

export interface CopyTradingBefund {
  punkte: number;
  belege: string[];
  signale: string[];
  /** Wie viele der tragenden Gruppen A–E ausgelöst haben. */
  tragendeGruppen: number;
  getroffeneGruppen: Gruppenname[];
  /**
   * Das Leitsignal: eine unglaubwürdige Gewinnangabe (A) oder das
   * Copy-Trading-Angebot selbst (C). Ohne eines von beiden wird nie gesperrt
   * und nie gelöscht — sonst trifft die Regel jeden, der über Hebel,
   * Kurspaare oder Kennungen schreibt, und das ist die halbe Gruppe.
   */
  leitsignal: boolean;
  hebel: number | null;
  /** true, wenn der Absender als eingesessenes Mitglied erkannt wurde. */
  eingesessen: boolean;
  /** true, wenn der Text vor dem Scam warnt statt ihn zu betreiben. */
  warnkontext: boolean;
}

function ausschnitt(text: string, treffer: string): string {
  const i = text.toLowerCase().indexOf(treffer.toLowerCase());
  if (i < 0) return treffer;
  const von = Math.max(0, i - 15);
  const bis = Math.min(text.length, i + treffer.length + 15);
  return (von > 0 ? '…' : '') + text.substring(von, bis).replace(/\s+/g, ' ') + (bis < text.length ? '…' : '');
}

export interface Umstaende {
  /** true, wenn der Text als Bildunterschrift kam (nicht als Textnachricht). */
  alsBildunterschrift?: boolean;
  absender?: Absender;
}

export function bewerteCopyTrading(text: string, umstaende: Umstaende = {}): CopyTradingBefund {
  const t = text || '';
  const belege: string[] = [];
  const signale: string[] = [];
  let punkte = 0;
  const getroffen = new Set<Gruppenname>();

  const gruppen: Array<[Gruppenname, Array<{ re: RegExp; punkte: number; name: string }>]> = [
    ['gewinn', GEWINN],
    ['hebel', HEBEL],
    ['vokabular', VOKABULAR],
    ['code', CODE],
    ['abwanderung', ABWANDERUNG],
    ['boerse', BOERSENSYNTAX],
  ];

  // Ein Signalname zählt nur einmal, auch wenn mehrere Schreibweisen dafür
  // hinterlegt sind. Sonst gibt eine Formulierung, für die es zwei Muster
  // gibt, doppelt Punkte — und die Schwelle wird zufällig.
  const gezaehlt = new Set<string>();

  for (const [gruppe, muster] of gruppen) {
    for (const m of muster) {
      const tr = t.match(m.re);
      if (!tr) continue;
      getroffen.add(gruppe);
      if (gezaehlt.has(m.name)) continue;
      gezaehlt.add(m.name);
      punkte += m.punkte;
      signale.push(m.name);
      belege.push(`${gruppe}/${m.name}: "${ausschnitt(t, tr[0])}"`);
    }
  }

  // Hoher Hebel: ab 20x ist ein Erfolgsbericht rechnerisch eine Wette.
  const hebel = hoechsterHebel(t);
  if (hebel !== null && hebel >= 20) {
    punkte += 10;
    signale.push('hebel_hoch');
    belege.push(`hebel/hebel_hoch: "${hebel}x"`);
  }

  // Bild plus kurzer Werbetext. Genau die Form, in der dieser Scam auftritt:
  // Der Beweis steckt im Bild, der Verkauf in zwei Zeilen darunter. Zählt nur
  // als Stütze und nur, wenn inhaltlich schon etwas getroffen hat.
  if (umstaende.alsBildunterschrift && t.trim().length > 0 && t.trim().length <= 220 && getroffen.size > 0) {
    punkte += 10;
    signale.push('bild_mit_kurztext');
    belege.push(`boerse/bild_mit_kurztext: "Bildunterschrift, ${t.trim().length} Zeichen"`);
    getroffen.add('boerse');
  }

  // Warnkontext — vor dem Dämpfer prüfen, ob sich hier jemand impfen will.
  const wirbt = [...gezaehlt].some(s => IMPFSCHUTZ_SIGNALE.has(s));
  const warnkontext = !wirbt && getroffen.size > 0 && WARNKONTEXT.some(re => re.test(t));
  if (warnkontext) {
    punkte -= 50;
    signale.push('warnkontext');
    const tr = WARNKONTEXT.map(re => t.match(re)).find(Boolean);
    belege.push(`warnung/warnkontext: "${tr ? ausschnitt(t, tr[0]) : ''}" — spricht ÜBER den Scam`);
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
    if (!eingesessen && a.kontoAlterTage !== null && a.kontoAlterTage <= 60) {
      punkte += 15;
      signale.push('junges_konto');
      belege.push(`absender/junges_konto: "Konto etwa ${a.kontoAlterTage} Tage alt"`);
    }
  }

  const leitsignal = getroffen.has('gewinn') || gezaehlt.has('trades_kopieren') ||
                     gezaehlt.has('signale_als_ware') || gezaehlt.has('mitmachangebot');

  const getroffeneGruppen = [...getroffen];
  return {
    punkte: Math.max(0, punkte),
    belege, signale,
    tragendeGruppen: TRAGENDE_GRUPPEN.filter(g => getroffen.has(g)).length,
    getroffeneGruppen,
    leitsignal,
    hebel,
    eingesessen,
    warnkontext,
  };
}

// ============================================================================
// Entscheidung
// ============================================================================

/**
 * Drei Stufen statt zwei, und der Unterschied ist Absicht:
 *
 *  sperren  — löschen und in allen Gruppen sperren
 *  loeschen — löschen und dem Menschen vorlegen, nichts gesperrt
 *  melden   — NUR vorlegen, nichts gelöscht, niemand gesperrt
 *
 * Die Stufe „melden" gibt es, weil eine gelöschte Nachricht eines echten
 * Mitglieds teurer ist als ein durchgerutschter Spam: Sie ist weg, das
 * Mitglied merkt es, und niemand erfährt warum. Wo die Lage nicht eindeutig
 * ist, wird deshalb nichts angefasst, sondern gefragt.
 */
export type CopyTradingMassnahme = 'keine' | 'melden' | 'loeschen' | 'sperren';

export interface CopyTradingUrteil {
  massnahme: CopyTradingMassnahme;
  grund: string;
  belege: string[];
  punkte: number;
}

export const SCHWELLE_SPERRE = 90;
export const SCHWELLE_LOESCHEN = 60;
export const SCHWELLE_MELDEN = 40;

/**
 * Für eine SPERRE müssen fünf Bedingungen zusammenkommen:
 *
 *  1. genug Punkte (90),
 *  2. mindestens drei der fünf tragenden Gruppen,
 *  3. das Leitsignal — unglaubwürdiger Gewinn oder Copy-Trading-Angebot,
 *  4. ein Geldmotiv oder ein Weg nach draußen (Werbecode oder Abwanderung),
 *  5. der Absender ist KEIN eingesessenes Mitglied.
 *
 * Bedingung 4 ist die, die einen Angeber von einem Werber trennt. Wer einen
 * Gewinn-Screenshot ohne Code und ohne Kennung postet, prahlt — das ist
 * kein Sperrgrund, höchstens ein Grund hinzusehen.
 *
 * Bedingung 5 ist die, die Marco am meisten wert ist: Ein Mitglied seit zwei
 * Jahren wird von dieser Regel nie gesperrt, egal was es schreibt. Im
 * Zweifel entscheidet ein Mensch.
 */
export function entscheideCopyTrading(b: CopyTradingBefund): CopyTradingUrteil {
  const basis = { belege: b.belege, punkte: b.punkte };
  const geldmotiv = b.getroffeneGruppen.includes('code') || b.getroffeneGruppen.includes('abwanderung');

  // Wer vor dem Scam warnt, wird nie gesperrt und nie gelöscht.
  if (b.warnkontext) {
    return { ...basis, massnahme: 'keine', grund: '' };
  }

  if (b.punkte >= SCHWELLE_SPERRE && b.tragendeGruppen >= 3 && b.leitsignal && geldmotiv && !b.eingesessen) {
    return {
      ...basis,
      massnahme: 'sperren',
      grund: `Copy-Trading-Betrug (${b.punkte} Punkte, ${b.tragendeGruppen} von 5 tragenden Merkmalen)`,
    };
  }

  if (b.punkte >= SCHWELLE_LOESCHEN && b.tragendeGruppen >= 2 && b.leitsignal) {
    return {
      ...basis,
      massnahme: 'loeschen',
      grund: b.eingesessen
        ? `Copy-Trading-Werbung von einem eingesessenen Mitglied (${b.punkte} Punkte) — entfernt, nicht gesperrt`
        : `Verdacht auf Copy-Trading-Werbung (${b.punkte} Punkte, ${b.tragendeGruppen} Merkmale)`,
    };
  }

  if (b.punkte >= SCHWELLE_MELDEN && b.tragendeGruppen >= 2) {
    return {
      ...basis,
      massnahme: 'melden',
      grund: b.leitsignal
        ? `Copy-Trading-Verdacht unterhalb der Löschschwelle (${b.punkte} Punkte)`
        : `Trading-Werbesprache ohne erkennbares Copy-Angebot (${b.punkte} Punkte) — kein Löschgrund`,
    };
  }

  return { ...basis, massnahme: 'keine', grund: '' };
}
