/**
 * identity.ts — Erkennung von Identitäts-Täuschung (Impersonation)
 *
 * Hintergrund: Angreifer kopieren Marcos Account (Name + Profilfoto), legen einen
 * fast identischen Benutzernamen an und lassen Strohmänner Mitglieder in eine
 * Fake-Gruppe einladen.
 *
 * Zwei Erkennungswege, bewusst unterschiedlich stark gewichtet:
 *
 *  1. PROFILFOTO-FINGERABDRUCK (beweiskräftig)
 *     Telegram liefert in getChat() das Feld photo.big_file_unique_id. Laut API-Doku
 *     ist dieser Wert "supposed to be the same over time and for different bots".
 *     Zwei Accounts mit demselben Wert tragen dasselbe Bild. Das ist praktisch
 *     fälschungssicher und rechtfertigt einen automatischen Ban.
 *
 *  2. NAMENSÄHNLICHKEIT (nur Verdacht)
 *     "Marco" ist ein häufiger Vorname. Eine Messung gegen die Produktionsdatenbank
 *     (7.174 Mitglieder, 04.09.2026) hat gezeigt: die alte Logik hätte 161 Mitglieder
 *     als Fälschung markiert — darunter Marco selbst und 23 echte Mitglieder namens
 *     Marco. Namensähnlichkeit allein löst deshalb NIEMALS einen Ban aus, sondern
 *     nur einen Alarm.
 *
 *     Ein Ban erfolgt nur, wenn zur Namensähnlichkeit ein Täuschungsmerkmal kommt,
 *     das kein echtes Mitglied hat: unsichtbare Steuerzeichen im Namen oder
 *     gemischte Schriftsysteme (kyrillisches "а" in einem lateinischen Namen).
 */

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

/** Unsichtbare Zeichen: Zero-Width, Bidi-Steuerzeichen, Word-Joiner, BOM, Soft-Hyphen */
const INVISIBLE_CHARS = /[­​-‏‪-‮⁠-⁤﻿]/g;

/**
 * Homoglyphen: optisch identische Zeichen aus anderen Schriftsystemen.
 * Kyrillisch und Griechisch sind die praktisch relevanten Fälle.
 */
const HOMOGLYPHS: Record<string, string> = {
  // Kyrillisch → Latein
  'а': 'a', 'б': 'b', 'в': 'b', 'е': 'e', 'ё': 'e', 'з': '3', 'и': 'u',
  'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't',
  'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ԁ': 'd',
  'ѵ': 'v', 'қ': 'k', 'ғ': 'f', 'ң': 'h', 'ѡ': 'w', 'ъ': 'b', 'ь': 'b',
  // Griechisch → Latein
  'α': 'a', 'β': 'b', 'ε': 'e', 'ζ': 'z', 'η': 'n', 'ι': 'i', 'κ': 'k',
  'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'y', 'χ': 'x', 'γ': 'y',
  'μ': 'm', 'π': 'n', 'σ': 'o', 'ω': 'w',
};

const CYRILLIC_OR_GREEK = /[Ͱ-ϿЀ-ӿԀ-ԯ]/;
const LATIN_LETTER = /[a-zA-Z]/;

/**
 * Vereinheitlicht optisch verwechselbare ASCII-Zeichen.
 * Bewusst identisch zur bisherigen Logik, damit bestehende Schwellenwerte gültig bleiben.
 */
function foldAsciiLookalikes(str: string): string {
  return str
    .replace(/[il1|!]/g, 'i')
    .replace(/[o0]/g, 'o')
    .replace(/[a@]/g, 'a')
    .replace(/[e3]/g, 'e')
    .replace(/[s5$]/g, 's')
    .replace(/[z2]/g, 'z');
}

/**
 * Vollständige Normalisierung eines Namens für den Vergleich.
 * Reihenfolge ist wichtig: erst unsichtbare Zeichen entfernen, dann Unicode
 * vereinheitlichen, dann kleinschreiben, dann Homoglyphen, dann ASCII-Faltung.
 */
export function normalizeIdentityName(input: string): string {
  if (!input) return '';
  let s = input.replace(INVISIBLE_CHARS, '');
  try {
    s = s.normalize('NFKC');
  } catch {
    /* NFKC nicht verfügbar — unkritisch */
  }
  s = s.toLowerCase();
  s = s.replace(/[Ͱ-ϿЀ-ӿԀ-ԯ]/g, ch => HOMOGLYPHS[ch] ?? ch);
  s = foldAsciiLookalikes(s);
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Harmlose Normalisierung: NUR Kleinschreibung, Unicode-Vereinheitlichung und
 * Leerzeichen. KEINE Homoglyphen, KEINE unsichtbaren Zeichen, KEINE ASCII-Faltung.
 *
 * Das ist der Gegenpol zu normalizeIdentityName(). Der Vergleich beider Ergebnisse
 * beantwortet die entscheidende Frage: Kommt der Namenstreffer nur dadurch
 * zustande, dass wir eine Verschleierung rückgängig gemacht haben?
 *
 * Beispiel:
 *   "Олена Geldhelden Team"  → enthält "geldhelden" AUCH ohne Entschleierung
 *                              → normaler Namenstreffer, kein Täuschungsbeweis
 *   "Gеldhelden Support"     → enthält "geldhelden" NUR nach Homoglyph-Ersetzung
 *     (kyrillisches е)          → Verschleierung bewiesen
 */
export function normalizePlainName(input: string): string {
  if (!input) return '';
  let s = input;
  try {
    s = s.normalize('NFKC');
  } catch {
    /* unkritisch */
  }
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Emoji, Variantenselektoren und Symbole — werden vor der Prüfung auf unsichtbare
 * Zeichen entfernt.
 *
 * Grund: U+200D (Zero-Width-Joiner) wird in zusammengesetzten Emoji völlig
 * legitim verwendet (z.B. 🧑‍♀️). Eine Messung gegen die Produktionsdatenbank ergab,
 * dass fast alle Treffer auf "unsichtbare Zeichen" von Emoji in Anzeigenamen kamen —
 * also von harmlosen Mitgliedern.
 */
const EMOJI_SEQUENCE =
  /\p{Extended_Pictographic}(?:[︀-️‍⃣]*\p{Extended_Pictographic})*[︀-️⃣]*/gu;

/**
 * Enthält der Text unsichtbare Steuerzeichen an einer Stelle, wo sie nichts zu
 * suchen haben? Vollständige Emoji-Sequenzen werden vorher entfernt — samt der
 * ZWJ, die sie verbinden.
 */
export function hasInvisibleChars(input: string): boolean {
  if (!input) return false;
  const withoutEmoji = input.replace(EMOJI_SEQUENCE, '');
  INVISIBLE_CHARS.lastIndex = 0;
  return INVISIBLE_CHARS.test(withoutEmoji);
}

/**
 * Mischt der Text lateinische mit kyrillischen/griechischen Buchstaben?
 * Ein echter deutschsprachiger Name tut das nicht.
 */
export function hasMixedScript(input: string): boolean {
  if (!input) return false;
  return LATIN_LETTER.test(input) && CYRILLIC_OR_GREEK.test(input);
}

// ---------------------------------------------------------------------------
// Ähnlichkeit
// ---------------------------------------------------------------------------

/** Levenshtein-Ähnlichkeit in Prozent (0-100), speicherschonend über zwei Zeilen */
export function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  const maxLen = Math.max(a.length, b.length);
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let cur = new Array(a.length + 1).fill(0);
  for (let j = 1; j <= b.length; j++) {
    cur[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  const distance = prev[a.length];
  return Math.max(0, Math.min(100, ((maxLen - distance) / maxLen) * 100));
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

/**
 * Mindestlänge, ab der ein geschützter Name als "kennzeichnend" gilt und in einer
 * Teilstring-Prüfung verwendet werden darf. Kurze Namen wie "Marco" (5 Zeichen nach
 * Normalisierung) sind zu häufig — sie erzeugten in der Messung 64 Fehlalarme.
 */
const DISTINCTIVE_MIN_LENGTH = 8;

/** Mindestlänge des Nutzernamens für einen Levenshtein-Vergleich */
const LEVENSHTEIN_MIN_LENGTH = 4;

export type IdentityMatchType = 'none' | 'exact' | 'substring' | 'levenshtein';

export interface IdentityAnalysis {
  /** Namensähnlichkeit liegt über der Schwelle */
  nameMatch: boolean;
  matchedName: string | null;
  similarity: number;
  matchType: IdentityMatchType;
  /**
   * NACHGEWIESENE Verschleierung: Der Name trifft einen geschützten Namen
   * buchstabengenau (exakt oder als Teilstring) — aber NUR, nachdem Homoglyphen,
   * unsichtbare Zeichen oder ASCII-Verwechslungen (O/0, l/1) rückgängig gemacht
   * wurden. Ohne diese Entschleierung gäbe es keinen Treffer.
   *
   * Das ist der einzige namensbasierte Grund, der eine automatische Sperre trägt.
   * Ein Levenshtein-Treffer zählt bewusst NICHT — Tippfehler wie "Geldheldn"
   * wären sonst ein Sperrgrund.
   */
  deception: boolean;
  /** Unsichtbare Steuerzeichen im Namen — nur informativ, kein Sperrgrund */
  invisibleChars: boolean;
  /** Lateinisch + kyrillisch/griechisch gemischt — nur informativ, kein Sperrgrund */
  mixedScript: boolean;
}

/**
 * Analysiert Anzeigename und Benutzername gegen die Liste geschützter Namen.
 *
 * Unterschied zur alten Implementierung:
 *  - Teilstring-Prüfung nur noch in EINER Richtung (geschützter Name kommt im
 *    Nutzernamen vor), und nur für kennzeichnende Namen ab 8 Zeichen.
 *    Die alte Gegenrichtung ließ einbuchstabige Namen wie "A" zu 95 % auf "Marco"
 *    passen — das war die Ursache für 142 der 161 Fehlalarme.
 *  - Vergleich läuft auf normalisierten Zeichenketten, damit kyrillische
 *    Homoglyphen die Prüfung nicht mehr umgehen.
 *  - Täuschungsmerkmale werden getrennt zurückgegeben, statt in einen Score zu fließen.
 */
export function analyzeIdentity(
  firstName: string | undefined | null,
  lastName: string | undefined | null,
  username: string | undefined | null,
  protectedNames: string[],
  similarityThreshold: number
): IdentityAnalysis {
  const rawDisplay = `${firstName || ''} ${lastName || ''}`.trim();
  const rawFull = rawDisplay || username || '';

  const result: IdentityAnalysis = {
    nameMatch: false,
    matchedName: null,
    similarity: 0,
    matchType: 'none',
    deception: false,
    invisibleChars: hasInvisibleChars(rawFull) || hasInvisibleChars(username || ''),
    mixedScript: hasMixedScript(rawFull) || hasMixedScript(username || ''),
  };

  if (!rawFull) return result;

  // Entschleierte Fassung (Homoglyphen, unsichtbare Zeichen, ASCII-Verwechslungen)
  const nFull = normalizeIdentityName(rawFull);
  const nUser = username ? normalizeIdentityName(username) : '';
  // Unveränderte Fassung — nur kleingeschrieben
  const pFull = normalizePlainName(rawFull);
  const pUser = username ? normalizePlainName(username) : '';

  /** Buchstabengenauer Treffer (exakt oder Teilstring) für ein Wertepaar */
  const literalMatch = (full: string, user: string, prot: string): IdentityMatchType => {
    if (!prot) return 'none';
    if (full === prot || (user && user === prot)) return 'exact';
    if (prot.length >= DISTINCTIVE_MIN_LENGTH && (full.includes(prot) || (user && user.includes(prot)))) {
      return 'substring';
    }
    return 'none';
  };

  let best = 0;
  let bestName: string | null = null;

  for (const protectedName of protectedNames) {
    const nProt = normalizeIdentityName(protectedName);
    if (nProt.length < 3) continue;

    const hit = literalMatch(nFull, nUser, nProt);
    if (hit !== 'none') {
      // Träfe derselbe Name auch OHNE Entschleierung? Wenn nein, ist die
      // Verschleierung bewiesen und ursächlich für den Treffer.
      const plainHit = literalMatch(pFull, pUser, normalizePlainName(protectedName));
      return {
        ...result,
        nameMatch: true,
        matchedName: protectedName,
        similarity: hit === 'exact' ? 100 : 95,
        matchType: hit,
        deception: plainHit === 'none',
      };
    }

    // Levenshtein auf entschleierten Namen — erzeugt NIE einen Täuschungsbeweis,
    // weil auch harmlose Tippfehler hohe Werte liefern ("Geldheldn" = 90 %).
    if (nFull.length >= LEVENSHTEIN_MIN_LENGTH || nUser.length >= LEVENSHTEIN_MIN_LENGTH) {
      const simFull = nFull.length >= LEVENSHTEIN_MIN_LENGTH ? levenshteinSimilarity(nFull, nProt) : 0;
      const simUser = nUser.length >= LEVENSHTEIN_MIN_LENGTH ? levenshteinSimilarity(nUser, nProt) : 0;
      const sim = Math.max(simFull, simUser);
      if (sim > best) {
        best = sim;
        bestName = protectedName;
      }
    }
  }

  if (best >= similarityThreshold) {
    result.nameMatch = true;
    result.matchedName = bestName;
    result.similarity = best;
    result.matchType = 'levenshtein';
  } else {
    result.similarity = best;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Entscheidung
// ---------------------------------------------------------------------------

export type ImpersonationAction = 'none' | 'alarm' | 'ban';

export interface ImpersonationVerdict {
  action: ImpersonationAction;
  /** Kurze, für den Admin-Log verwendbare Begründung */
  reason: string;
  /** Beweiskraft: 'proof' rechtfertigt einen Ban, 'suspicion' nur einen Alarm */
  confidence: 'proof' | 'suspicion' | 'none';
}

/**
 * Leitet aus Analyse + Fotoabgleich die Maßnahme ab.
 *
 * Ban nur bei Beweis:
 *   - identisches Profilfoto wie ein geschützter Account (fremde User-ID), ODER
 *   - Namensähnlichkeit UND ein Täuschungsmerkmal, das kein echtes Mitglied hat
 *     (unsichtbare Zeichen oder gemischte Schriftsysteme)
 *
 * Alles andere ist Verdacht und führt nur zum Alarm.
 */
export function decideImpersonation(
  analysis: IdentityAnalysis,
  photoMatch: boolean,
  userId: number,
  protectedUserIds: number[]
): ImpersonationVerdict {
  // Der echte Account darf sein eigenes Foto und seinen eigenen Namen tragen
  if (protectedUserIds.includes(userId)) {
    return { action: 'none', reason: 'geschützter Account', confidence: 'none' };
  }

  if (photoMatch) {
    return {
      action: 'ban',
      reason: 'identisches Profilfoto wie geschützter Account',
      confidence: 'proof',
    };
  }

  // Nachgewiesene Verschleierung: Der Name trifft den geschützten Namen
  // buchstabengenau, aber erst nachdem Homoglyphen / unsichtbare Zeichen /
  // ASCII-Verwechslungen entfernt wurden. Ein echtes Mitglied schreibt seinen
  // Namen nicht mit kyrillischem "е" oder einem O statt einer Null.
  if (analysis.deception) {
    return {
      action: 'ban',
      reason: `Name "${analysis.matchedName}" nachgebaut mit verschleierten Zeichen (${analysis.matchType})`,
      confidence: 'proof',
    };
  }

  if (analysis.nameMatch) {
    return {
      action: 'alarm',
      reason: `Name ähnlich zu "${analysis.matchedName}" (${analysis.similarity.toFixed(0)} %, ${analysis.matchType})`,
      confidence: 'suspicion',
    };
  }

  // Bewusst KEIN Alarm für Täuschungsmerkmale ohne Namenstreffer.
  // Messung gegen die Produktionsdatenbank: von 71 Alarmen kamen 63 von echten
  // Mitgliedern mit kyrillischem Vor- und lateinischem Nachnamen
  // (z.B. "Дмитро Berger") oder von Emoji im Anzeigenamen. Ein Alarm, der zu
  // 89 % danebenliegt, wird ignoriert und ist damit schlimmer als keiner.
  // Die Merkmale werden weiterhin erfasst und verschärfen einen Namenstreffer
  // zum Ban — nur allein lösen sie nichts aus.
  return { action: 'none', reason: '', confidence: 'none' };
}
