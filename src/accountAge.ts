/**
 * Schaetzung des Telegram-Kontoalters aus der Nutzerkennung (User-ID).
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * Die fruehere Schaetzung in risk.ts rechnete "~100.000 IDs pro Tag seit 2020".
 * Bei heutigen Kennungen (~9 Mrd.) ergab das ein Datum Jahrhunderte in der Zukunft,
 * das auf "heute" gekappt wurde. Folge: JEDES moderne Konto galt als 0 Tage alt.
 * Das Merkmal war damit blind. Gemessen am 10.09.2026.
 *
 * WIE ES JETZT FUNKTIONIERT
 * -------------------------
 * Stuetzstellen (ID -> Datum) aus zwei unabhaengigen Quellen, dazwischen linear
 * interpoliert:
 *
 *  1. Oeffentliche Datensaetze echter Anmelde-Ereignisse (MessageActionContactSignUp),
 *     v.a. Jobians/telegram-id-age und wjclub/telegram-bot-getids. Fuer 2022-2025
 *     Quartalsmediane statt Einzelpunkte, weil Einzelpunkte den vollen Streuungs-
 *     Jitter tragen.
 *  2. Fuer 2026 gibt es keinen oeffentlichen Datensatz. Die Stuetzstellen ab
 *     2026-01 stammen aus unseren EIGENEN Daten: die hoechste Kennung, die der Bot
 *     in einem Monat gesehen hat, beweist, dass der Zaehler zu diesem Zeitpunkt
 *     mindestens dort stand. Das sind obere Schranken fuer das Anmeldedatum.
 *
 * WAS DIESE FUNKTION NICHT KANN — BITTE LESEN
 * -------------------------------------------
 * Telegram vergibt Kennungen NICHT streng der Reihe nach. Die Server reservieren
 * Bloecke; zwei Konten, die am selben Tag angelegt werden, koennen Millionen
 * auseinanderliegen. Gemessen an oeffentlichen Anmeldedaten sind rund 5,7 % aller
 * Paare invertiert: das spaeter angemeldete Konto hat die kleinere Kennung.
 * Groesste beobachtete Ruecklaeufigkeit: ~582 Mio. Kennungen.
 *
 * Realistische Genauigkeit:
 *   - 2022 bis heute      : ca. +/- 2-3 Monate (1 Sigma)
 *   - 2017 bis 2021       : ca. +/- 9-12 Monate (duenne Datenlage)
 *   - 2026 (Extrapolation): ca. +/- 6 Monate
 *
 * => TAGESGENAUE ODER WOCHENGENAUE AUSSAGEN SIND NICHT MOEGLICH.
 *    Eine Regel wie "Konto juenger als 7 Tage" ist aus der Kennung grundsaetzlich
 *    nicht entscheidbar. Sinnvolle Schwellen liegen bei Monaten bis Jahren.
 *    Wer eine Schwelle setzt, sollte estimateAccountAgeDays() zusammen mit
 *    getConfidenceDays() lesen und im Zweifel zugunsten des Nutzers entscheiden.
 */

/** Eine Stuetzstelle: Kennung -> Anmeldedatum. */
interface Anchor {
  id: number;
  date: string;
  /** 'gemessen' = echtes Anmelde-Ereignis, 'median' = Quartalsmedian, 'schranke' = eigene Beobachtung (obere Schranke) */
  art: 'gemessen' | 'median' | 'schranke';
}

/**
 * Ende 2021 hat Telegram den Kennungsraum auf 64 Bit erweitert und dabei den
 * Bereich zwischen ~2,15 Mrd. und ~5,0 Mrd. KOMPLETT UEBERSPRUNGEN.
 * (Bot API 5.5, 07.12.2021 - "user identifiers can now have up to 52 significant bits")
 * Ueber diese Luecke darf niemals interpoliert werden.
 */
const LUECKE_VON = 2_145_338_053;
const LUECKE_BIS = 5_000_000_000;

/**
 * Reservierte Telegram-Sonderkennungen. Das sind keine echten Nutzer und duerfen
 * nicht datiert werden. Quelle: core.telegram.org/api/peers
 */
const SONDER_IDS = new Set<number>([
  777000,      // Service Notifications (Login-Codes)
  42777,       // Telegram Support
  136817688,   // Channel_Bot (Beitraege im Kanalnamen)
  1087968824,  // GroupAnonymousBot (anonyme Admins)
  1271266957,  // Replies Bot
  5434988373,  // Anti-Spam Bot
]);

/**
 * Stuetzstellen, aufsteigend nach Kennung UND Datum.
 * Beide Reihen muessen monoton sein, sonst ist die Interpolation unsinnig.
 * validateAnchors() prueft das beim Laden.
 */
const ANCHORS: Anchor[] = [
  // --- 32-Bit-Aera -------------------------------------------------------
  { id: 2_768_409, date: '2013-11-01', art: 'gemessen' },
  { id: 44_634_663, date: '2014-05-06', art: 'gemessen' },
  { id: 63_263_518, date: '2014-10-27', art: 'gemessen' },
  { id: 101_260_938, date: '2015-03-06', art: 'gemessen' },
  { id: 130_029_930, date: '2015-09-03', art: 'gemessen' },
  { id: 148_670_295, date: '2016-01-08', art: 'gemessen' },
  { id: 222_021_233, date: '2016-06-08', art: 'gemessen' },
  { id: 297_621_225, date: '2016-12-16', art: 'gemessen' },
  { id: 369_669_043, date: '2017-03-31', art: 'gemessen' },
  { id: 400_169_472, date: '2017-07-31', art: 'gemessen' },
  // Ab hier duenne Datenlage bis 2021 - Unsicherheit ca. +/- 9-12 Monate.
  { id: 616_816_630, date: '2018-06-22', art: 'gemessen' },
  { id: 796_147_074, date: '2018-11-04', art: 'gemessen' },
  { id: 925_078_064, date: '2019-07-16', art: 'gemessen' },
  { id: 1_057_704_545, date: '2020-01-30', art: 'gemessen' },
  { id: 1_227_964_864, date: '2020-07-30', art: 'gemessen' },
  { id: 1_382_531_194, date: '2020-09-15', art: 'gemessen' },
  { id: 1_658_586_909, date: '2021-02-12', art: 'gemessen' },
  { id: 1_807_942_741, date: '2021-07-05', art: 'gemessen' },
  { id: 1_974_255_900, date: '2021-10-12', art: 'gemessen' },
  { id: 2_138_472_342, date: '2021-11-22', art: 'gemessen' }, // letzte Kennung vor dem Sprung

  // --- 64-Bit-Aera (nach dem Sprung) -------------------------------------
  { id: 5_031_711_230, date: '2021-12-06', art: 'gemessen' }, // erste Kennung nach dem Sprung
  { id: 5_170_390_109, date: '2022-02-15', art: 'median' },
  { id: 5_468_950_164, date: '2022-08-15', art: 'median' },
  { id: 5_869_978_651, date: '2023-02-15', art: 'median' },
  { id: 6_523_424_924, date: '2023-08-15', art: 'median' },
  { id: 6_718_059_849, date: '2024-02-15', art: 'median' },
  { id: 7_357_703_634, date: '2024-08-15', art: 'median' },
  { id: 7_964_511_972, date: '2025-02-15', art: 'median' },
  { id: 8_189_642_292, date: '2025-08-15', art: 'median' },
  { id: 8_354_987_771, date: '2025-11-15', art: 'median' },

  // --- 2026: eigene Beobachtungen ----------------------------------------
  // Hoechste Kennung, die der Shield-Bot im jeweiligen Monat gesehen hat.
  // Beweist: der Zaehler stand spaetestens dann dort. Obere Schranken.
  { id: 8_598_220_666, date: '2026-01-31', art: 'schranke' },
  { id: 8_786_937_871, date: '2026-02-28', art: 'schranke' },
  { id: 8_998_028_726, date: '2026-05-31', art: 'schranke' },
];

/** Prueft beim Laden, dass die Tabelle in beiden Reihen monoton ist. */
function validateAnchors(): void {
  for (let i = 1; i < ANCHORS.length; i++) {
    const prev = ANCHORS[i - 1];
    const cur = ANCHORS[i];
    if (cur.id <= prev.id) {
      throw new Error(`[accountAge] Stuetzstellen nicht aufsteigend nach ID: ${prev.id} -> ${cur.id}`);
    }
    if (Date.parse(cur.date) <= Date.parse(prev.date)) {
      throw new Error(`[accountAge] Stuetzstellen nicht aufsteigend nach Datum: ${prev.date} -> ${cur.date}`);
    }
  }
}
validateAnchors();

const ANCHOR_TS: number[] = ANCHORS.map((a) => Date.parse(a.date));

/**
 * Schaetzt den Anmeldezeitpunkt eines Kontos aus seiner Kennung.
 * @returns Zeitstempel in Millisekunden, oder null wenn nicht schaetzbar.
 */
export function estimateAccountCreatedAt(userId: number): number | null {
  if (!Number.isFinite(userId)) return null;

  // Negative oder Null: Gruppe, Kanal oder anonymer Beitrag - kein Nutzerkonto.
  if (userId <= 0) return null;

  // Reservierte Telegram-Dienstkonten.
  if (SONDER_IDS.has(userId)) return null;

  // Der uebersprungene Bereich - solche Kennungen kann es nicht geben.
  if (userId > LUECKE_VON && userId < LUECKE_BIS) return null;

  const first = ANCHORS[0];
  const last = ANCHORS[ANCHORS.length - 1];

  // Aelter als die aelteste Stuetzstelle: sehr altes Konto.
  if (userId <= first.id) return ANCHOR_TS[0];

  // Neuer als die neueste Stuetzstelle: mit der Steigung des letzten
  // Abschnitts weiterrechnen, aber nie in die Zukunft.
  if (userId >= last.id) {
    const a = ANCHORS[ANCHORS.length - 2];
    const b = last;
    const idsProMs = (b.id - a.id) / (ANCHOR_TS[ANCHORS.length - 1] - ANCHOR_TS[ANCHORS.length - 2]);
    if (idsProMs <= 0) return Math.min(ANCHOR_TS[ANCHORS.length - 1], Date.now());
    const geschaetzt = ANCHOR_TS[ANCHORS.length - 1] + (userId - b.id) / idsProMs;
    return Math.min(geschaetzt, Date.now());
  }

  // Dazwischen: passenden Abschnitt suchen und linear interpolieren.
  for (let i = 1; i < ANCHORS.length; i++) {
    const a = ANCHORS[i - 1];
    const b = ANCHORS[i];
    if (userId >= a.id && userId <= b.id) {
      // Der Abschnitt, der die 2021er-Luecke ueberspannt, wird nicht
      // interpoliert - dort liegt kein realer Kennungsraum.
      if (a.id <= LUECKE_VON && b.id >= LUECKE_BIS) {
        return userId <= LUECKE_VON ? ANCHOR_TS[i - 1] : ANCHOR_TS[i];
      }
      const anteil = (userId - a.id) / (b.id - a.id);
      return ANCHOR_TS[i - 1] + anteil * (ANCHOR_TS[i] - ANCHOR_TS[i - 1]);
    }
  }
  return null;
}

/** Geschaetztes Kontoalter in Tagen, oder null wenn nicht schaetzbar. */
export function estimateAccountAgeDays(userId: number, jetzt: number = Date.now()): number | null {
  const erstellt = estimateAccountCreatedAt(userId);
  if (erstellt === null) return null;
  return (jetzt - erstellt) / (1000 * 60 * 60 * 24);
}

/**
 * Wie unsicher ist die Schaetzung fuer diese Kennung (in Tagen, 1 Sigma)?
 * Wer eine Schwelle setzt, sollte diesen Wert kennen.
 */
export function getConfidenceDays(userId: number): number | null {
  if (estimateAccountCreatedAt(userId) === null) return null;
  if (userId < 400_169_472) return 100;      // 32-Bit-Aera, brauchbare Datenlage
  if (userId < 5_031_711_230) return 330;    // Datenluecke 2017-2021
  if (userId < 8_354_987_771) return 80;     // dichte Datenlage 2022-2025
  return 180;                                 // 2026: Extrapolation
}

/**
 * Grobe, ehrliche Einordnung fuer Protokolle und Admin-Ausgaben.
 * Bewusst nur Halbjahres-Granularitaet - feiner gibt die Datenlage nichts her.
 */
export function describeAccountAge(userId: number): string {
  const tage = estimateAccountAgeDays(userId);
  if (tage === null) return 'nicht schaetzbar';
  const unsicherheit = getConfidenceDays(userId) ?? 180;
  const jahre = tage / 365;
  const spanne = `+/- ${Math.round(unsicherheit / 30)} Monate`;
  if (jahre < 0.5) return `unter einem halben Jahr (${spanne})`;
  if (jahre < 1) return `etwa ein halbes bis ein Jahr (${spanne})`;
  return `etwa ${jahre.toFixed(1)} Jahre (${spanne})`;
}

/** Nur fuer Messskripte und Tests. */
export const _intern = { ANCHORS, LUECKE_VON, LUECKE_BIS, SONDER_IDS };
