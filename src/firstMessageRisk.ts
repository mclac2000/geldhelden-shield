/**
 * firstMessageRisk.ts — Bewertung der ersten Nachrichten eines Kontos
 *
 * Was ein Konto in seinen ersten Stunden schreibt, ist das aussagekräftigste
 * Signal, das es gibt. Ein Werber hat genau einen Zweck und kommt schnell zur
 * Sache; ein echtes Mitglied stellt sich vor oder antwortet auf etwas.
 *
 * WARUM PUNKTE UND KEINE EINZELREGEL
 * Jedes Signal hier ist für sich harmlos. Ein Botschafter schreibt auch mal
 * einen englischen Satz, benutzt Emojis, oder erwähnt Stripe. Erst die
 * Häufung ergibt ein Bild. Deshalb: keine Einzelregel darf allein sperren.
 *
 * Diese Datei ist bewusst frei von Seiteneffekten — kein Telegram, keine
 * Datenbank. Alles hier ist mit scripts/test-first-message.ts prüfbar.
 */

import { hasInvisibleChars, hasMixedScript } from './identity';

// ============================================================================
// Verfremdete Anzeigenamen
// ============================================================================
// ACHTUNG: Hier NICHT normalizeIdentityName gegen normalizePlainName
// vergleichen, wie es die Identitätsprüfung tut. Deren Abbildung bildet unter
// anderem `l` auf `i` ab (weil l/I/1 verwechselbar sind). Das ist dort richtig,
// weil beide Seiten gleich normalisiert werden und der Vergleich symmetrisch
// ist. Hier vergleicht ein Name mit sich selbst — und dann schlägt JEDER Name
// mit einem „l" an: „Klein" → „kiein", „Schulz" → „schuiz", „Müller" →
// „müiier". Das ist beim Bau aufgefallen und hätte reihenweise echte
// Mitglieder getroffen.

/** Deutsche Umlaute und ß — völlig unauffällig */
const DEUTSCHE_SONDERZEICHEN = /[äöüÄÖÜß]/;

/** Großbuchstaben mit Diakritika, ohne die deutschen Umlaute */
const GROSS_DIAKRITISCH = /[ÀÁÂÃÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕØÙÚÛÝÞ]/g;

/**
 * Erkennt bewusst verfremdete Anzeigenamen.
 *
 * Bewusst eng gehalten. Ein Name wie „Jürgen Müller-Lüdenscheidt" oder
 * „José García" darf nicht anschlagen; „LÓUÎ SÜNG" und „ZÔHÑG MÎNYÅÑ" sollen.
 * Der Unterschied ist die Häufung von Diakritika in GROSSbuchstaben, die im
 * Deutschen nicht vorkommen.
 */
export function istVerfremdeterName(
  name: string
): { verfremdet: boolean; grund: string; punkte: number } {
  const nichts = { verfremdet: false, grund: '', punkte: 0 };
  if (!name) return nichts;

  if (hasInvisibleChars(name)) {
    return { verfremdet: true, grund: 'unsichtbare Steuerzeichen im Namen', punkte: 20 };
  }

  // Verschiedene großgeschriebene Sonderbuchstaben, deutsche Umlaute
  // ausgenommen. „LÓUÎ", „ZÔHÑG", „YÛSÎ" — im Bestand von 7.196 Konten hat
  // genau EINES außerhalb der bekannten Betrüger diesen Grund ausgelöst.
  const treffer = name.match(GROSS_DIAKRITISCH) || [];
  const verschiedene = new Set(treffer).size;
  if (verschiedene >= 2) {
    return {
      verfremdet: true,
      punkte: 20,
      grund: `${verschiedene} verschiedene verfremdete Großbuchstaben (${[...new Set(treffer)].join(', ')})`,
    };
  }

  // Gemischte Schriftsysteme sind hier BEWUSST nur ein schwaches Signal.
  //
  // Die Messung am Bestand ergab 41 Konten mit lateinisch-kyrillisch
  // gemischten Namen — „Hùng Иванов", „Juan Волков", „Kishan Смирнов".
  // Viele davon sehen nach Bot-Farm aus, beweisen lässt sich das aber nicht,
  // und ein Mitglied mit gemischtsprachigem Namen ist völlig normal. Bei 20
  // Punkten wäre das ein Viertel des Weges zur Sperre für etwas, das nichts
  // über die Absicht aussagt. Deshalb 8.
  if (hasMixedScript(name)) {
    return { verfremdet: true, grund: 'gemischte Schriftsysteme im Namen', punkte: 8 };
  }

  return nichts;
}

// Wird unten nur noch für die Doku gebraucht, damit klar bleibt, dass die
// deutschen Sonderzeichen bewusst ausgenommen sind.
void DEUTSCHE_SONDERZEICHEN;

// ============================================================================
// Signalgruppe 1: Verkaufsangebot für Zahlungskonten und Dokumente
// ============================================================================
// Das ist der Kern dieses Betrugsmusters: Handel mit gemuleten oder gekauften
// Zahlungsdienstleister-Konten. Wer das anbietet, hat keinen zweiten Grund,
// diese Wortkombination zu benutzen.

/** Zahlungsdienstleister, deren Konten gehandelt werden */
const ZAHLUNGSDIENSTE = /\b(stripe|square|paypal|payoneer|wise|revolut|skrill|neteller|cashapp|venmo|zelle|mercury)\b/i;

/** „verifiziert", „fresh", „aged" — die Verkaufssprache für gemulete Konten */
const KONTO_VERKAUF = [
  { re: /\b(verified|verifizierte?s?)\s+(accounts?|konten?|gateways?)/i, punkte: 30, name: 'verkauf_verifizierte_konten' },
  { re: /\b(accounts?|konten?)\s+(for\s+sale|zu\s+verkaufen|available|verfügbar)/i, punkte: 30, name: 'konten_zu_verkaufen' },
  { re: /\b(fresh|aged|clean|premium)\s+(accounts?|docs?|documents?|dokumente?)/i, punkte: 30, name: 'fresh_aged_docs' },
  { re: /\b(payment|zahlungs)[\s-]*gateways?\b/i, punkte: 20, name: 'payment_gateway' },
  { re: /\bkyc\b[\s\-|]*(verified|passed|bypass|ready|expert)/i, punkte: 30, name: 'kyc_verkauf' },
  { re: /\b(valid|fresh|real)\s+(documents?|docs?|ids?|passports?)/i, punkte: 30, name: 'dokumentenhandel' },
  { re: /\b(virtual\s+bank|virtuelle?s?\s+bank)/i, punkte: 20, name: 'virtual_banking' },
  { re: /\b(unlimited|unbegrenzte?)\s+(payments?|zahlungen|transactions?)/i, punkte: 20, name: 'unlimited_payments' },
];

// ============================================================================
// Signalgruppe 2: Werbe- und Anwerbesprache
// ============================================================================

const WERBESPRACHE = [
  { re: /\bhey\s+(everyone|all|guys|there)\b/i, punkte: 10, name: 'massenanrede' },
  { re: /\b(dm|pm)\s+(me|mich)\b/i, punkte: 15, name: 'dm_aufforderung' },
  { re: /\b(contact|kontakt(?:iere)?)\s+(me|mich|us|uns)\b/i, punkte: 10, name: 'kontakt_aufforderung' },
  { re: /\b(your\s+business\s+deserves|take\s+your\s+business)/i, punkte: 15, name: 'werbefloskel' },
  { re: /\b(next\s+level|game\s*changer|100%\s*(safe|secure|legit))/i, punkte: 10, name: 'werbefloskel' },
  { re: /\b(stop\s+losing|don'?t\s+miss|limited\s+(time|offer))/i, punkte: 10, name: 'dringlichkeit' },
  { re: /\b(order\s+now|jetzt\s+bestellen|available\s+here|hier\s+erhältlich)/i, punkte: 15, name: 'kaufaufforderung' },
];

// ============================================================================
// Signalgruppe 3: Form der Nachricht
// ============================================================================

/**
 * Zählt Emojis. Eine Emoji-Wall ist typisch für Werbeanzeigen und selten in
 * normaler Unterhaltung — dort stehen ein bis drei, nicht fünfzehn.
 */
export function zaehleEmojis(text: string): number {
  const treffer = text.match(/\p{Extended_Pictographic}/gu);
  return treffer ? treffer.length : 0;
}

/**
 * Anteil lateinischer Buchstaben, die zu einem englischen Wortschatz gehören.
 * Grobe, absichtlich einfache Heuristik: Wir wollen nur wissen, ob ein Text
 * überwiegend englisch ist — nicht welche Sprache es sonst ist.
 */
const DEUTSCHE_MARKER = /\b(der|die|das|und|ist|nicht|ein|eine|mit|für|von|auf|ich|du|wir|ihr|sie|hat|haben|sein|werden|kann|auch|noch|schon|aber|oder|wenn|weil|dass|wie|was|wer|hier|dort|mehr|sehr|gut|danke|bitte|hallo|guten|liebe|gruß|grüße)\b/gi;
const ENGLISCHE_MARKER = /\b(the|and|is|are|you|your|our|we|for|with|this|that|have|has|will|can|now|get|make|business|payment|account|service|available|here|all|from|to|of|it|be|do|more|best|new)\b/gi;

export interface SprachBefund {
  deutsch: number;
  englisch: number;
  /** true, wenn deutlich mehr englische als deutsche Marker vorkommen */
  ueberwiegendEnglisch: boolean;
}

export function pruefeSprache(text: string): SprachBefund {
  const deutsch = (text.match(DEUTSCHE_MARKER) || []).length;
  const englisch = (text.match(ENGLISCHE_MARKER) || []).length;
  // Mindestens 4 englische Marker UND mindestens dreimal so viele wie deutsche.
  // Ein einzelner englischer Satz ("nice, thanks!") reicht damit nie.
  const ueberwiegendEnglisch = englisch >= 4 && englisch >= deutsch * 3;
  return { deutsch, englisch, ueberwiegendEnglisch };
}

// ============================================================================
// Bewertung
// ============================================================================

export interface ErstnachrichtEingabe {
  text: string;
  /** Anzeigename (Vor- + Nachname), für die Homoglyphen-Prüfung */
  anzeigename: string;
  /** Minuten zwischen Beitritt und dieser Nachricht; null = unbekannt */
  minutenSeitBeitritt: number | null;
  /** Die wievielte Nachricht dieses Kontos ist das (1 = die erste) */
  nachrichtNr: number;
}

export interface ErstnachrichtBefund {
  punkte: number;
  /** Lesbare Belege, jeweils mit dem gefundenen Textausschnitt */
  belege: string[];
  /** Namen der ausgelösten Signale, für Auswertung */
  signale: string[];
  /** Wie viele VERSCHIEDENE Signalgruppen ausgelöst haben (1-4) */
  gruppen: number;
  /**
   * Nur die INHALTLICHEN Gruppen: verkauf, werbung, form.
   *
   * „konto" (verfremdeter Name, Zeitpunkt) zählt hier bewusst NICHT mit. Diese
   * Signale sagen nichts über den Inhalt der Nachricht aus — ein neues Konto
   * mit ungewöhnlichem Namen ist kein Betrüger. Sie dürfen eine Sperre
   * verstärken, aber nie die zweite tragende Säule sein.
   */
  inhaltlicheGruppen: number;
}

/** Kürzt einen Fund für die Protokollierung, ohne ihn zu verfälschen */
function ausschnitt(text: string, treffer: string): string {
  const i = text.toLowerCase().indexOf(treffer.toLowerCase());
  if (i < 0) return treffer;
  const von = Math.max(0, i - 20);
  const bis = Math.min(text.length, i + treffer.length + 20);
  return (von > 0 ? '…' : '') + text.substring(von, bis).replace(/\s+/g, ' ') + (bis < text.length ? '…' : '');
}

export function bewerteErstnachricht(e: ErstnachrichtEingabe): ErstnachrichtBefund {
  const text = e.text || '';
  const belege: string[] = [];
  const signale: string[] = [];
  let punkte = 0;
  const gruppenGetroffen = new Set<string>();

  // --- Gruppe A: Verkauf von Zahlungskonten und Dokumenten ------------------
  for (const m of KONTO_VERKAUF) {
    const t = text.match(m.re);
    if (t) {
      punkte += m.punkte;
      signale.push(m.name);
      belege.push(`Verkaufsangebot (${m.name}): "${ausschnitt(text, t[0])}"`);
      gruppenGetroffen.add('verkauf');
    }
  }

  // Ein genannter Zahlungsdienst allein sagt nichts ("ich zahle mit PayPal").
  // Zusammen mit Verkaufssprache ist er der Beleg, WAS verkauft wird.
  const dienst = text.match(ZAHLUNGSDIENSTE);
  if (dienst && gruppenGetroffen.has('verkauf')) {
    punkte += 20;
    signale.push('zahlungsdienst_genannt');
    belege.push(`Zahlungsdienst im Verkaufskontext: "${dienst[0]}"`);
  }

  // --- Gruppe B: Werbesprache ----------------------------------------------
  for (const m of WERBESPRACHE) {
    const t = text.match(m.re);
    if (t) {
      punkte += m.punkte;
      signale.push(m.name);
      belege.push(`Werbesprache (${m.name}): "${ausschnitt(text, t[0])}"`);
      gruppenGetroffen.add('werbung');
    }
  }

  // --- Gruppe C: Form ------------------------------------------------------
  const emojis = zaehleEmojis(text);
  if (emojis >= 8) {
    punkte += 15;
    signale.push('emoji_wall');
    belege.push(`Emoji-Wall: ${emojis} Emojis in einer Nachricht`);
    gruppenGetroffen.add('form');
  } else if (emojis >= 5) {
    punkte += 8;
    signale.push('viele_emojis');
    belege.push(`Auffällig viele Emojis: ${emojis}`);
    gruppenGetroffen.add('form');
  }

  const sprache = pruefeSprache(text);
  if (sprache.ueberwiegendEnglisch) {
    punkte += 10;
    signale.push('englisch_in_deutscher_gruppe');
    belege.push(`Überwiegend englischer Text (${sprache.englisch} engl. / ${sprache.deutsch} dt. Marker)`);
    gruppenGetroffen.add('form');
  }

  // --- Gruppe D: Konto und Zeitpunkt ---------------------------------------
  const namensBefund = istVerfremdeterName(e.anzeigename);
  if (namensBefund.verfremdet) {
    punkte += namensBefund.punkte;
    signale.push('verfremdeter_name');
    belege.push(`Verfremdeter Anzeigename "${e.anzeigename}": ${namensBefund.grund} (${namensBefund.punkte} Punkte)`);
    gruppenGetroffen.add('konto');
  }

  // Erste Nachricht kurz nach Beitritt. Für sich genommen völlig normal —
  // viele stellen sich sofort vor. Deshalb nur ein kleiner Beitrag.
  if (e.nachrichtNr <= 3 && e.minutenSeitBeitritt !== null) {
    if (e.minutenSeitBeitritt <= 60) {
      punkte += 10;
      signale.push('sofort_nach_beitritt');
      belege.push(`Nachricht ${e.nachrichtNr} bereits ${Math.round(e.minutenSeitBeitritt)} Min. nach Beitritt`);
      gruppenGetroffen.add('konto');
    } else if (e.minutenSeitBeitritt <= 24 * 60) {
      punkte += 5;
      signale.push('am_ersten_tag');
      gruppenGetroffen.add('konto');
    }
  }

  const inhaltlich = ['verkauf', 'werbung', 'form'].filter(g => gruppenGetroffen.has(g)).length;
  return { punkte, belege, signale, gruppen: gruppenGetroffen.size, inhaltlicheGruppen: inhaltlich };
}

// ============================================================================
// Entscheidung
// ============================================================================

export type ErstnachrichtMassnahme = 'keine' | 'alarm' | 'sperren';

export interface ErstnachrichtUrteil {
  massnahme: ErstnachrichtMassnahme;
  grund: string;
  belege: string[];
  punkte: number;
}

/** Ab hier wird gesperrt */
export const SCHWELLE_SPERRE = 70;
/** Ab hier wird gemeldet */
export const SCHWELLE_ALARM = 40;
/** So viele verschiedene Signalgruppen müssen für eine Sperre zusammenkommen */
export const MIN_GRUPPEN_FUER_SPERRE = 2;

export function entscheideErstnachricht(b: ErstnachrichtBefund): ErstnachrichtUrteil {
  const basis = { belege: b.belege, punkte: b.punkte };

  // Die Punktzahl allein genügt NICHT.
  //
  // Ein Text, der nur in einer einzigen inhaltlichen Gruppe auffällt, kann ein
  // Missverständnis sein — der Finanz-Botschafter, der einen Beitrag über
  // Zahlungsdienstleister schreibt, sammelt mühelos 180 Punkte, alle aus der
  // Verkaufsgruppe. Genau dieser Fall stand im Test und hätte ihn gesperrt.
  // Deshalb: mindestens zwei INHALTLICH verschiedene Gruppen. Ein verfremdeter
  // Name oder ein früher Zeitpunkt allein reicht als zweite Säule nicht.
  if (b.punkte >= SCHWELLE_SPERRE && b.inhaltlicheGruppen >= MIN_GRUPPEN_FUER_SPERRE) {
    return {
      ...basis,
      massnahme: 'sperren',
      grund: `Werbung/Betrugsangebot in der Erstnachricht (${b.punkte} Punkte aus ${b.inhaltlicheGruppen} unabhängigen inhaltlichen Signalgruppen)`,
    };
  }

  if (b.punkte >= SCHWELLE_ALARM) {
    return {
      ...basis,
      massnahme: 'alarm',
      grund: b.inhaltlicheGruppen < MIN_GRUPPEN_FUER_SPERRE
        ? `Auffällige Erstnachricht (${b.punkte} Punkte, aber nur ${b.inhaltlicheGruppen} inhaltliche Signalgruppe — zu wenig für eine Sperre)`
        : `Auffällige Erstnachricht (${b.punkte} Punkte)`,
    };
  }

  return { ...basis, massnahme: 'keine', grund: '' };
}
