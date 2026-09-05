/**
 * profileRisk.ts — Prüfung des Telegram-Profils beim Beitritt
 *
 * BEOBACHTETES MUSTER (Fall vom 04.09.2026)
 *   Anzeigename:  Austin Garcia
 *   Benutzername: @Glc43amg_e_performance
 *   Bio:          "Kopiere es von ihm: https://t.me/+YLLIqnYu11BjMDA1"
 *   Profilbild:   fremdes Familienfoto
 *
 * Wer in seiner Bio auf eine FREMDE Telegram-Gruppe verweist und damit einer
 * unserer Gruppen beitritt, wirbt ab. Das ist beim Beitritt sichtbar — anders
 * als das Verhalten der Strohmänner, das erst später auffällt.
 *
 * ABGRENZUNG, DIE HIER ENTSCHEIDET
 * Geldhelden ist eine Community von Selbstständigen. Dass jemand die eigene
 * Gruppe oder einen Partner in der Bio verlinkt, ist normal. Deshalb gilt:
 *   - Links auf unsere eigenen Gruppen (link_allowlist) sind NIE ein Signal.
 *   - Ein Link allein trägt nur, wenn er von Verschleierung oder von einem
 *     zweiten Merkmal begleitet wird — siehe entscheideProfil().
 * Die tatsächliche Trefferquote wird vor dem Scharfschalten am Bestand
 * gemessen (scripts/measure-profile-risk.ts).
 */

// ---------------------------------------------------------------------------
// Entschleierung
// ---------------------------------------------------------------------------

/** Zeichen, die wie ein Punkt aussehen, aber keiner sind */
const PUNKT_HOMOGLYPHEN = /[․．。｡‧∙·•]/g;
/** Zeichen, die wie ein Schrägstrich aussehen */
const SLASH_HOMOGLYPHEN = /[／∕⁄]/g;
const UNSICHTBAR = /[­​-‏‪-‮⁠-⁤﻿]/g;

/**
 * Macht gängige Verschleierungen rückgängig, damit ein Link auch dann gefunden
 * wird, wenn er als "t . me / + abc" oder "t(dot)me" geschrieben ist.
 *
 * Wird NUR für die Linksuche verwendet, nicht für die Textanzeige.
 */
export function entschleiereFuerLinks(input: string): string {
  if (!input) return '';
  let s = input;

  s = s.replace(UNSICHTBAR, '');
  try { s = s.normalize('NFKC'); } catch { /* unkritisch */ }
  s = s.replace(PUNKT_HOMOGLYPHEN, '.');
  s = s.replace(SLASH_HOMOGLYPHEN, '/');

  // Kyrillische/griechische Buchstaben, die in "t.me" vorkommen können
  s = s.replace(/[еЕ]/g, 'e').replace(/[тТ]/g, 't').replace(/[мМ]/g, 'm')
       .replace(/[оО]/g, 'o').replace(/[аА]/g, 'a').replace(/[сС]/g, 'c')
       .replace(/[рР]/g, 'p').replace(/[іІ]/g, 'i');

  // "dot"/"punkt" als Wort, in Klammern oder mit Leerzeichen
  s = s.replace(/\s*[\(\[\{]?\s*(?:dot|punkt|d0t)\s*[\)\]\}]?\s*/gi, '.');
  s = s.replace(/\s*[\(\[\{]?\s*(?:slash|schrägstrich)\s*[\)\]\}]?\s*/gi, '/');

  // Leerzeichen um Punkte und Schrägstriche entfernen: "t . me / +x" -> "t.me/+x"
  s = s.replace(/\s*\.\s*/g, '.');
  s = s.replace(/\s*\/\s*/g, '/');

  return s;
}

// ---------------------------------------------------------------------------
// Textsignale
// ---------------------------------------------------------------------------

interface Muster { pattern: RegExp; grund: string; }

/** Aufforderungssprache — typisch für Anwerbung */
const AUFFORDERUNG: Muster[] = [
  { pattern: /kopiere?\s+(es|das|ihn|sie)\s+von/i, grund: 'aufforderung_kopieren' },
  { pattern: /copy\s+(it|this|him|her|from)/i, grund: 'aufforderung_kopieren' },
  { pattern: /schreib(e)?\s+mir(\s+privat)?/i, grund: 'aufforderung_pm' },
  { pattern: /(write|text|message)\s+me\s+(privately|directly|now)/i, grund: 'aufforderung_pm' },
  { pattern: /\bdm\s+me\b/i, grund: 'aufforderung_pm' },
  { pattern: /folge\s+mir|follow\s+me\s+(on|to)/i, grund: 'aufforderung_folgen' },
  { pattern: /tritt\s+(der\s+)?gruppe\s+bei|join\s+(my|our|the)\s+(group|channel)/i, grund: 'aufforderung_beitritt' },
  { pattern: /klick(e)?\s+(hier|den\s+link)|click\s+(here|the\s+link)/i, grund: 'aufforderung_klick' },
];

/** Geldversprechen */
const GELDVERSPRECHEN: Muster[] = [
  { pattern: /\b(invest(ment|ieren|iere)?|trading|trader)\b/i, grund: 'investment' },
  { pattern: /\b(krypto|crypto|bitcoin|btc|ethereum|forex|binance)\b/i, grund: 'krypto' },
  { pattern: /\b(profit|gewinn|rendite|earnings?)\b.{0,20}\d/i, grund: 'gewinnversprechen' },
  { pattern: /\d\s*%\s*(pro|per|täglich|daily|monatlich|monthly)/i, grund: 'renditeversprechen' },
  { pattern: /passives?\s+einkommen|passive\s+income/i, grund: 'passives_einkommen' },
  { pattern: /finanziell(e)?\s+freiheit\s+in\s+\d/i, grund: 'gewinnversprechen' },
];

/** Kontaktwege außerhalb von Telegram */
const EXTERNER_KONTAKT: Muster[] = [
  { pattern: /whats\s*app/i, grund: 'whatsapp' },
  { pattern: /chat\.whatsapp\.com/i, grund: 'whatsapp_link' },
  { pattern: /\bwa\.me\b/i, grund: 'whatsapp_link' },
  { pattern: /\+\d{1,3}[\s\-]?\d{3,}[\s\-]?\d{4,}/, grund: 'telefonnummer' },
  { pattern: /\b(signal|viber)\b.{0,15}\+?\d{6,}/i, grund: 'externer_messenger' },
];

/** Sieht der Benutzername nach Wegwerfkonto aus? */
export function istWegwerfName(username: string | null | undefined): boolean {
  if (!username) return false;
  const u = username.toLowerCase();
  // Lange zufällige Buchstaben-Ziffern-Folgen ohne erkennbares Wort
  if (/^[a-z]{1,3}\d{5,}$/.test(u)) return true;              // ab12345678
  if (/^user\d{4,}$/.test(u)) return true;                     // user12345
  if (/\d{6,}/.test(u) && u.replace(/\d/g, '').length <= 3) return true;
  // Sehr hoher Ziffernanteil bei mittlerer Länge
  const ziffern = (u.match(/\d/g) || []).length;
  if (u.length >= 8 && ziffern / u.length > 0.5) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

export interface ProfilBefund {
  /** Fremde Telegram-Gruppen-Links in der Bio (bereits normalisierte Schlüssel) */
  fremdeLinks: string[];
  /** Rohtext der gefundenen Links, für das Protokoll */
  fremdeLinksRoh: string[];
  /** Der Link war verschleiert geschrieben */
  linkVerschleiert: boolean;
  /** Gefundene Textsignale, als Gründe */
  textSignale: string[];
  /** Benutzername sieht nach Wegwerfkonto aus */
  wegwerfName: boolean;
  /** Profilbild bereits unter einem anderen Konto gesehen */
  fotoDublette: boolean;
  /** Andere Konten mit demselben Bild */
  fotoDublettenIds: number[];
}

export interface ProfilAnalyseEingabe {
  bio: string | null | undefined;
  username: string | null | undefined;
  /** Schlüssel, die freigegeben sind (eigene Gruppen, Partner) */
  istLinkFreigegeben: (key: string) => boolean;
  /** Konten mit demselben Profilbild, ohne den geprüften User selbst */
  fotoDublettenIds?: number[];
}

/**
 * Analysiert ein Profil. Rein rechnend, keine Seiteneffekte, keine API-Aufrufe.
 */
export function analysiereProfil(e: ProfilAnalyseEingabe): ProfilBefund {
  const { normalizeTelegramLink } = require('./campaignLinks') as typeof import('./campaignLinks');

  const befund: ProfilBefund = {
    fremdeLinks: [], fremdeLinksRoh: [], linkVerschleiert: false,
    textSignale: [], wegwerfName: istWegwerfName(e.username),
    fotoDublette: (e.fotoDublettenIds?.length ?? 0) > 0,
    fotoDublettenIds: e.fotoDublettenIds ?? [],
  };

  const bio = e.bio || '';
  if (bio) {
    // Linksuche einmal auf dem Rohtext, einmal entschleiert. Weicht das
    // Ergebnis ab, war der Link verschleiert — ein Signal für sich.
    const roh = findeTelegramLinks(bio, normalizeTelegramLink);
    const klar = findeTelegramLinks(entschleiereFuerLinks(bio), normalizeTelegramLink);

    const alle = new Map<string, string>();
    for (const t of [...roh, ...klar]) if (!alle.has(t.key)) alle.set(t.key, t.raw);

    for (const [key, raw] of alle) {
      if (e.istLinkFreigegeben(key)) continue; // eigene Gruppe -> kein Signal
      befund.fremdeLinks.push(key);
      befund.fremdeLinksRoh.push(raw);
    }
    befund.linkVerschleiert =
      befund.fremdeLinks.length > 0 && klar.length > roh.length;

    for (const gruppe of [AUFFORDERUNG, GELDVERSPRECHEN, EXTERNER_KONTAKT]) {
      for (const m of gruppe) {
        if (m.pattern.test(bio) && !befund.textSignale.includes(m.grund)) {
          befund.textSignale.push(m.grund);
        }
      }
    }
  }

  return befund;
}

/** Telegram-Links in einem Freitext finden (ohne Entities, wie bei einer Bio) */
function findeTelegramLinks(
  text: string,
  normalize: (s: string) => string | null
): Array<{ key: string; raw: string }> {
  const treffer: Array<{ key: string; raw: string }> = [];
  const re = /(?<![\w.\-@/])(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[^\s<>"')\],]+/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = normalize(m[0]);
    if (key && !treffer.some(t => t.key === key)) treffer.push({ key, raw: m[0] });
  }
  return treffer;
}

// ---------------------------------------------------------------------------
// Entscheidung
// ---------------------------------------------------------------------------

export type ProfilMassnahme = 'keine' | 'alarm' | 'sperren';

export interface ProfilUrteil {
  massnahme: ProfilMassnahme;
  grund: string;
  /** Für das Protokoll: was genau gefunden wurde */
  belege: string[];
}

/**
 * Leitet die Maßnahme ab.
 *
 * @param streng true = ein fremder Einladungslink in der Bio genügt.
 *   false (Standard) = der Link muss von einem zweiten Merkmal begleitet sein.
 *
 * Der Unterschied ist gemessen: In einer Community von Selbstständigen
 * verlinken Mitglieder durchaus eigene Gruppen. Welche Stufe angemessen ist,
 * entscheidet die Messung am Bestand — nicht das Bauchgefühl.
 */
export function entscheideProfil(b: ProfilBefund, streng = false): ProfilUrteil {
  const belege: string[] = [];
  if (b.fremdeLinks.length > 0) belege.push(`fremder Gruppenlink: ${b.fremdeLinksRoh.join(', ')}`);
  if (b.linkVerschleiert) belege.push('Link verschleiert geschrieben');
  if (b.textSignale.length > 0) belege.push(`Textsignale: ${b.textSignale.join(', ')}`);
  if (b.wegwerfName) belege.push('Benutzername wie ein Wegwerfkonto');
  if (b.fotoDublette) belege.push(`Profilbild bereits bei ${b.fotoDublettenIds.length} anderem Konto gesehen`);

  const hatLink = b.fremdeLinks.length > 0;
  const zusatz =
    (b.linkVerschleiert ? 1 : 0) +
    (b.textSignale.length > 0 ? 1 : 0) +
    (b.wegwerfName ? 1 : 0) +
    (b.fotoDublette ? 1 : 0);

  // Verschleierter Link ist für sich schon ein Beweis: Wer "t․me/+abc" schreibt,
  // will an einer Prüfung vorbei. Dafür gibt es keinen harmlosen Grund.
  if (hatLink && b.linkVerschleiert) {
    return { massnahme: 'sperren', grund: 'Verschleierter Einladungslink im Profil', belege };
  }

  if (hatLink && (streng || zusatz >= 1)) {
    return {
      massnahme: 'sperren',
      grund: streng && zusatz === 0
        ? 'Fremder Telegram-Gruppenlink im Profil'
        : 'Fremder Gruppenlink im Profil zusammen mit weiteren Anwerbe-Merkmalen',
      belege,
    };
  }

  if (hatLink) {
    return { massnahme: 'alarm', grund: 'Fremder Gruppenlink im Profil, sonst unauffällig', belege };
  }

  // Ohne Link: Foto-Dublette plus Textsignal bleibt meldenswert, aber nie Sperre.
  if (b.fotoDublette && b.textSignale.length > 0) {
    return { massnahme: 'alarm', grund: 'Fremdes Profilbild und Anwerbe-Sprache', belege };
  }
  if (b.fotoDublette) {
    return { massnahme: 'alarm', grund: 'Profilbild bereits bei einem anderen Konto gesehen', belege };
  }

  return { massnahme: 'keine', grund: '', belege };
}
