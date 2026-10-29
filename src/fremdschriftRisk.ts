/**
 * fremdschriftRisk.ts — Werbe-Spam in fremder Schrift erkennen
 *
 * Anlass (12.10.2026): „今日由码徕收洣   @Dl88o" — sieben chinesische
 * Zeichen ohne Sinn und eine fremde @-Kennung. Typischer chinesischer
 * Glücksspiel-/Geld-Spam. Keiner der vorhandenen Erkenner kennt ihn, weil
 * alle auf deutsche oder englische Wörter schauen.
 *
 * WAS HIER ZÄHLT, IST DIE SCHRIFT, NICHT DIE SPRACHE.
 * Alle bewachten Gruppen sind deutschsprachig, auch die im Ausland. Eine
 * Nachricht, die ÜBERWIEGEND aus chinesischen, japanischen, koreanischen,
 * kyrillischen oder arabischen Buchstaben besteht, ist dort ein Fremdkörper.
 * Allein reicht das aber nicht für eine Sperre: In Tiflis, Bangkok oder
 * Budweis schreibt auch mal ein echtes Mitglied etwas auf Russisch. Gesperrt
 * wird erst, wenn eine WERBEFORM dazukommt — Weiterleitung nach draußen
 * (@-Kennung, t.me-Link, Telefonnummer) oder typisches Werbevokabular.
 *
 * WAS NICHT ZÄHLT:
 *  - Emojis, Zahlen, Satzzeichen, Links und @-Kennungen haben keine Schrift
 *    und gehen nicht in den Anteil ein.
 *  - Ein kurzes fremdes Wort in deutschem Text („谢谢", „Спасибо") bleibt
 *    unter der Mindestmenge und unter dem Anteil.
 *  - Thai, Georgisch, Griechisch, Hebräisch usw. sind NICHT Ziel dieser Regel.
 *    Sie können in den Auslandsgruppen echt vorkommen (Adressen, Ortsnamen).
 *
 * VERSCHLEIERUNG (Homoglyphen, unsichtbare Zeichen, Zierschrift) ist ein
 * eigenes Merkmal, auch wenn der Text sonst lateinisch aussieht: „Vеrdiеnе"
 * mit kyrillischem е ist kein Tippfehler, sondern Filterumgehung. Ein Wort,
 * das GANZ kyrillisch ist, ist dagegen einfach Russisch — gezählt werden nur
 * Wörter, die lateinische und kyrillische/griechische Buchstaben MISCHEN.
 *
 * Reiner Erkenner — keine Datenbank, kein Telegram. Durchsetzung steht in
 * fremdschriftGuard.ts.
 */

import { Absender, EINGESESSEN_AB_NACHRICHTEN } from './copyTradingRisk';

export type FremdschriftMassnahme = 'keine' | 'melden' | 'loeschen' | 'sperren';
export type Schrift = 'cjk' | 'kyrillisch' | 'arabisch';

export interface FremdschriftBefund {
  /** Buchstabenzählung nach Schrift (ohne Links, Kennungen, Emojis, Ziffern) */
  zaehlung: { latein: number; cjk: number; kyrillisch: number; arabisch: number; sonstige: number };
  /** Gewichteter Anteil der Zielschriften an allen Buchstaben, 0..1 */
  anteilFremd: number;
  /** Stärkste Zielschrift, oder null */
  schrift: Schrift | null;
  /** Überwiegend Zielschrift UND genug davon */
  ueberwiegend: boolean;
  /** Verschleierung (Homoglyphen, unsichtbare Zeichen, Zierschrift) */
  verschleiert: boolean;
  /** Werbeform: Weiterleitung nach draußen */
  kennungen: string[];
  links: number;
  telefon: boolean;
  /** Werbevokabular in der Zielschrift */
  werbewoerter: string[];
  eingesessen: boolean;
  /** Warnung eines Mitglieds, das den Spam zitiert */
  warnkontext: boolean;
  punkte: number;
  signale: string[];
  belege: string[];
}

export interface FremdschriftUrteil {
  massnahme: FremdschriftMassnahme;
  grund: string;
  belege: string[];
}

// ---------------------------------------------------------------------------
// Schwellen — an einer Stelle, damit sie nachgemessen werden können
// ---------------------------------------------------------------------------

/** Ein CJK-Zeichen trägt etwa so viel wie ein kurzes Wort. */
const CJK_GEWICHT = 2;
/** Ab diesem gewichteten Anteil gilt eine Nachricht als „überwiegend fremd". */
export const ANTEIL_UEBERWIEGEND = 0.6;
/** Mindestmenge, damit „你好" oder „Да!" nie allein etwas auslöst. */
const MIN_CJK = 4;
const MIN_KYR_ARAB = 12;
/** Neu ist, wer in dieser Gruppe höchstens so viele Nachrichten hat. */
const NEU_BIS_NACHRICHTEN = 3;

// ---------------------------------------------------------------------------
// Zeichenklassen
// ---------------------------------------------------------------------------

const RE_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const RE_KYR = /\p{Script=Cyrillic}/u;
const RE_ARAB = /\p{Script=Arabic}/u;
const RE_LAT = /\p{Script=Latin}/u;
const RE_GRIECH = /\p{Script=Greek}/u;

/** Unsichtbare Zeichen. ZWJ (U+200D) zählt nur außerhalb von Emoji-Sequenzen. */
const UNSICHTBAR_KLASSE = '[\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\uFEFF]';
const EMOJI_SEQUENZ =
  /\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}︀-️‍⃣♀♂]*\p{Extended_Pictographic})*[\u{1F3FB}-\u{1F3FF}︀-️⃣♀♂]*/gu;

/** Zierschrift: mathematische Alphanumerik (𝐄𝐚𝐫𝐧) und Vollbreite (Ｅａｒｎ). */
const ZIERSCHRIFT = /[\u{1D400}-\u{1D7FF}Ａ-Ｚａ-ｚ]/gu;

const RE_LINK = /(?:\bhttps?:\/\/|\bwww\.)\S+|\b(?:t\.me|telegram\.(?:me|dog)|wa\.me|bit\.ly|tinyurl\.com)\/\S*/gi;
const RE_KENNUNG = /(?<![\w.@])@[A-Za-z][A-Za-z0-9_]{3,31}\b/g;
const RE_EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const RE_TELEFON = /(?:\+|\b00)\d[\d\s\-()]{7,}\d|\b\d{10,}\b/;

// ---------------------------------------------------------------------------
// Werbevokabular — bewusst als Stämme, nicht als Sätze
// ---------------------------------------------------------------------------

const WERBUNG_CJK = [
  '收u', '出u', '代收', '代付', '跑分', '码商', '担保', '博彩', '菠菜', '娱乐', '彩票',
  '赌', '棋牌', '百家乐', '充值', '提现', '返水', '返利', '首充', '日赚', '日结',
  '兼职', '招聘', '招商', '代理', '私聊', '私信', '联系', '客服', '飞机', '电报',
  '微信', '承兑', '换汇', '精聊', '引流', '推广', '广告', '接单', '收款', '洗',
  '秒到', '高额', '保底', '月入', '躺赚', '包赔', '入金', '出金', '盘口', '下注',
  '稳赚', '投资', '赚', '项目', '群发', '群演', '进群',
  // 29.10.2026: „天赐代发 … Telegram 社群推广引流 … TG代发广告" — Werbung für Spam-Versand
  '代发', '发广告', '社群', '拉人', '刷粉', '买粉', '拉群', '频道', '机器人', '曝光',
];

const WERBUNG_KYR = [
  'заработ', 'доход', 'прибыл', 'подработ', 'ваканс', 'удаленн', 'удалённ',
    // NICHT „пиши/пишите": so schreibt auch ein Mitglied in Tiflis „schreibt mir".
  'казино', 'ставк', 'бонус', 'крипт', 'инвест', 'в лс', 'в личк',
  'личку', 'телеграм', 'ватсап', 'ссылк', 'переход', 'подпис', 'бесплатн',
  'выигр', 'депозит', 'знакомств', 'интим', 'трейд', 'сигнал', 'в день', 'в неделю',
];

const WERBUNG_ARAB = [
  'ربح', 'أرباح', 'ارباح', 'استثمار', 'تداول', 'تواصل', 'واتساب', 'واتس', 'تليجرام',
  'تلغرام', 'كازينو', 'دخل', 'مجان', 'فوركس', 'عملات', 'بيتكوين', 'اشترك',
  'رابط', 'قناة', 'راسل', 'مراهنات', 'توصيات',
];

/** Latein-Kürzel, die in fremdsprachigem Spam für Kontaktwege stehen */
const KONTAKT_LATEIN = /\b(?:vx|wx|wechat|whatsapp|telegram|tg|usdt|qq|line\s?id)\b/i;

/** Warnwörter eines Mitglieds, das den Spam zitiert */
const WARNWORT = /(?:achtung|vorsicht|warnung|\bspam\b|\bscam\b|betrug|betrüger|\bfake\b)/i;

// ---------------------------------------------------------------------------

export interface BewertungsOptionen {
  absender?: Absender;
  /** Links aus Telegram-Entities (z.B. versteckte text_link) */
  entityLinks?: number;
  /** Erwähnungen aus Telegram-Entities (text_mention ohne @ im Text) */
  entityKennungen?: string[];
}

export function bewerteFremdschrift(rohtext: string, opt: BewertungsOptionen = {}): FremdschriftBefund {
  const signale: string[] = [];
  const belege: string[] = [];
  const text = rohtext || '';

  // --- Verschleierung zuerst, am ROHEN Text (NFKC würde sie wegputzen) ----
  const ohneEmoji = text.replace(EMOJI_SEQUENZ, ' ');
  const zier = (ohneEmoji.match(ZIERSCHRIFT) || []).length;
  const unsichtbarInWort = (ohneEmoji.match(new RegExp(`\\p{L}${UNSICHTBAR_KLASSE}+\\p{L}`, 'gu')) || []).length;

  const norm = ohneEmoji.normalize('NFKC').replace(new RegExp(UNSICHTBAR_KLASSE, 'g'), '');

  // Kennungen, Links, Mails, Telefonnummern einsammeln und dann entfernen
  const kennungen = new Set<string>();
  const ohneLinks = norm.replace(RE_LINK, ' ');
  for (const k of ohneLinks.replace(RE_EMAIL, ' ').match(RE_KENNUNG) || []) kennungen.add(k.toLowerCase());
  for (const k of opt.entityKennungen || []) kennungen.add(k.toLowerCase());
  const links = (norm.match(RE_LINK) || []).length + (opt.entityLinks || 0);
  const telefon = RE_TELEFON.test(ohneLinks);

  const rest = ohneLinks.replace(RE_EMAIL, ' ').replace(RE_KENNUNG, ' ');

  // Wörter mit gemischter Schrift: Latein + Kyrillisch/Griechisch im SELBEN Wort
  let mischWoerter = 0;
  const mischBeispiele: string[] = [];
  for (const w of rest.match(/\p{L}+/gu) || []) {
    if (w.length < 3) continue;
    if (RE_LAT.test(w) && (RE_KYR.test(w) || RE_GRIECH.test(w))) {
      mischWoerter++;
      if (mischBeispiele.length < 3) mischBeispiele.push(w);
    }
  }

  // --- Buchstaben nach Schrift zählen ------------------------------------
  const z = { latein: 0, cjk: 0, kyrillisch: 0, arabisch: 0, sonstige: 0 };
  for (const ch of rest) {
    if (!/\p{L}/u.test(ch)) continue;
    if (RE_CJK.test(ch)) z.cjk++;
    else if (RE_KYR.test(ch)) z.kyrillisch++;
    else if (RE_ARAB.test(ch)) z.arabisch++;
    else if (RE_LAT.test(ch)) z.latein++;
    else z.sonstige++;
  }
  const fremdGewicht = z.cjk * CJK_GEWICHT + z.kyrillisch + z.arabisch;
  const gesamtGewicht = fremdGewicht + z.latein + z.sonstige;
  const anteilFremd = gesamtGewicht > 0 ? fremdGewicht / gesamtGewicht : 0;

  const kandidaten: Array<[Schrift, number]> = [
    ['cjk', z.cjk * CJK_GEWICHT], ['kyrillisch', z.kyrillisch], ['arabisch', z.arabisch],
  ];
  kandidaten.sort((a, b) => b[1] - a[1]);
  const schrift: Schrift | null = kandidaten[0][1] > 0 ? kandidaten[0][0] : null;

  const genug = z.cjk >= MIN_CJK || z.kyrillisch >= MIN_KYR_ARAB || z.arabisch >= MIN_KYR_ARAB;
  const ueberwiegend = genug && anteilFremd >= ANTEIL_UEBERWIEGEND;

  if (ueberwiegend) {
    signale.push(`fremdschrift_${schrift}`);
    belege.push(`Überwiegend ${schriftName(schrift)}: ${Math.round(anteilFremd * 100)} % der Buchstaben ` +
                `(CJK ${z.cjk}, kyrillisch ${z.kyrillisch}, arabisch ${z.arabisch}, lateinisch ${z.latein})`);
  }

  // --- Verschleierung ----------------------------------------------------
  const verschleiert = mischWoerter >= 2 || unsichtbarInWort >= 2 || zier >= 5;
  if (mischWoerter >= 2) { signale.push('homoglyphen'); belege.push(`${mischWoerter} Wörter mit gemischter Schrift (${mischBeispiele.join(', ')})`); }
  if (unsichtbarInWort >= 2) { signale.push('unsichtbare_zeichen'); belege.push(`${unsichtbarInWort} unsichtbare Zeichen mitten in Wörtern`); }
  if (zier >= 5) { signale.push('zierschrift'); belege.push(`${zier} Zeichen in Zier-/Vollbreitenschrift`); }

  // --- Werbeform ---------------------------------------------------------
  if (kennungen.size) { signale.push('kennung'); belege.push(`Fremde Kennung: ${[...kennungen].slice(0, 3).join(', ')}`); }
  if (links) { signale.push('link'); belege.push(`${links} Link(s) nach draußen`); }
  if (telefon) { signale.push('telefon'); belege.push('Telefonnummer'); }

  const klein = rest.toLowerCase();
  const werbewoerter: string[] = [];
  const liste = schrift === 'cjk' ? WERBUNG_CJK : schrift === 'kyrillisch' ? WERBUNG_KYR : schrift === 'arabisch' ? WERBUNG_ARAB : [];
  if (ueberwiegend) {
    for (const w of liste) if (klein.includes(w)) werbewoerter.push(w);
    const kontakt = klein.match(KONTAKT_LATEIN);
    if (kontakt) werbewoerter.push(kontakt[0]);
  }
  if (werbewoerter.length) { signale.push('werbewort'); belege.push(`Werbevokabular: ${werbewoerter.slice(0, 5).join(', ')}`); }

  // --- Absender und Warnkontext -----------------------------------------
  const eingesessen = (opt.absender?.nachrichtenInGruppe ?? 0) >= EINGESESSEN_AB_NACHRICHTEN;
  if (eingesessen) signale.push('eingesessen');

  // Wer warnt, schreibt dazu deutsch — der deutsche Teil drückt den Anteil
  // ohnehin. Bleibt die Nachricht trotzdem überwiegend fremd, hilft das
  // Warnwort nicht: Sonst wäre „Achtung" die Impfung für jeden Spammer.
  const warnkontext = WARNWORT.test(rest) && z.latein >= 30;
  if (warnkontext) signale.push('warnkontext');

  const weiterleitung = kennungen.size > 0 || links > 0 || telefon;
  let punkte = 0;
  if (ueberwiegend) punkte += 50;
  if (verschleiert) punkte += 40;
  if (weiterleitung) punkte += 30;
  if (werbewoerter.length) punkte += 20;

  return {
    zaehlung: z, anteilFremd, schrift, ueberwiegend, verschleiert,
    kennungen: [...kennungen], links, telefon, werbewoerter,
    eingesessen, warnkontext, punkte, signale, belege,
  };
}

export interface NamensBefund {
  spam: boolean;
  belege: string[];
}

/**
 * Anzeigename (oder Kanalname) als Spam-Werbung erkennen.
 *
 * 29.10.2026: Absender „天赐代发👉@xxin7👈Direct🔺ad…" — der Name IST die Anzeige.
 * Zählt nur, wenn der Name CJK-Zeichen (mind. 2) UND eine Weiterleitung nach draußen
 * enthält (@-Kennung, Link, Telefonnummer) oder CJK-Werbevokabular. Ein chinesischer
 * Name allein (真实成员) oder ein Name mit @ ohne CJK trifft nie.
 */
export function bewerteAnzeigename(name: string): NamensBefund {
  const roh = (name || '').normalize('NFKC').replace(new RegExp(UNSICHTBAR_KLASSE, 'g'), '');
  const belege: string[] = [];
  const cjk = (roh.match(new RegExp(RE_CJK.source, 'gu')) || []).length;
  if (cjk < 2) return { spam: false, belege };
  const ohneLinks = roh.replace(RE_LINK, ' ');
  const kennungen = ohneLinks.replace(RE_EMAIL, ' ').match(RE_KENNUNG) || [];
  const links = (roh.match(RE_LINK) || []).length;
  const wort = WERBUNG_CJK.filter(w => roh.toLowerCase().includes(w));
  if (kennungen.length) belege.push(`Name enthält Kennung: ${kennungen.slice(0, 2).join(', ')}`);
  if (links) belege.push('Name enthält Link');
  if (wort.length) belege.push(`Name enthält Werbevokabular: ${wort.slice(0, 4).join(', ')}`);
  return { spam: belege.length > 0, belege: belege.length ? [`Anzeigename „${roh.slice(0, 60)}"`, ...belege] : belege };
}

export interface BotKetteBefund {
  treffer: boolean;
  bots: string[];
}

/**
 * Kette von Bot-Erwähnungen ohne Text: „@Dhm_d161b2acbot  @Dhm_210e889cbot  @Dhm_83c549debot".
 * 29.10.2026: Solche Nachrichten lösen bei fremden Bots Antworten aus (Gast-Modus), die Werbe-Spam samt
 * URL-Tasten in die Gruppe setzen. Diese Bot-Antworten bekommt der Shield nie zugestellt (Bots sehen keine Bot-Nachrichten),
 * sichtbar ist nur die auslösende Nachricht. Treffer: mindestens 2 verschiedene @…bot-Kennungen und sonst höchstens
 * 12 Zeichen Text.
 */
export function bewerteBotKette(rohtext: string): BotKetteBefund {
  const text = (rohtext || '').normalize('NFKC');
  const bots = [...new Set((text.match(/(?<![\w.])@[A-Za-z][A-Za-z0-9_]{2,}bot\b/gi) || []).map(b => b.toLowerCase()))];
  if (bots.length < 2) return { treffer: false, bots };
  const rest = text.replace(/@[A-Za-z0-9_]+/g, ' ').replace(EMOJI_SEQUENZ, ' ').replace(/[^\p{L}\p{N}]+/gu, '');
  return { treffer: rest.length <= 12, bots };
}

export function schriftName(s: Schrift | null): string {
  return s === 'cjk' ? 'chinesisch/japanisch/koreanisch' : s === 'kyrillisch' ? 'kyrillisch' : s === 'arabisch' ? 'arabisch' : '—';
}

/**
 * Die Entscheidung. Absichtlich als Tabelle lesbar:
 *
 *   eingesessen (≥ 20 Nachrichten)               → höchstens melden
 *   überwiegend CJK + Werbeform                  → sperren
 *   überwiegend kyr./arab. + Link/Tel./Werbewort → sperren
 *   überwiegend kyr./arab. + nur @-Kennung       → löschen (in Tiflis/Bangkok
 *                                                  schreibt auch ein Mitglied
 *                                                  „frag @ivan" auf Russisch)
 *   verschleiert + Werbeform (ohne Warnkontext)  → sperren
 *   überwiegend fremd, keine Werbeform, NEU      → löschen
 *   sonst überwiegend fremd oder verschleiert    → melden
 */
export function entscheideFremdschrift(b: FremdschriftBefund, absender?: Absender): FremdschriftUrteil {
  const belege = b.belege;
  if (!b.ueberwiegend && !b.verschleiert) return { massnahme: 'keine', grund: '', belege };

  const kennung = b.kennungen.length > 0;
  const starkeWerbeform = b.links > 0 || b.telefon || b.werbewoerter.length > 0;
  const werbeform = kennung || starkeWerbeform;

  if (b.eingesessen) {
    return { massnahme: 'melden', grund: 'Eingesessenes Mitglied — wird von dieser Regel nie angefasst', belege };
  }

  if (b.ueberwiegend) {
    const name = schriftName(b.schrift);
    if (b.schrift === 'cjk' && werbeform) {
      return { massnahme: 'sperren', grund: `Werbe-Spam in fremder Schrift (${name}) mit Weiterleitung`, belege };
    }
    if (b.schrift !== 'cjk' && starkeWerbeform) {
      return { massnahme: 'sperren', grund: `Werbe-Spam in fremder Schrift (${name})`, belege };
    }
    if (kennung) {
      return { massnahme: 'loeschen', grund: `Überwiegend ${name} mit @-Kennung`, belege };
    }
  }

  if (b.warnkontext) {
    return { massnahme: 'melden', grund: 'Warnkontext: Mitglied zitiert vermutlich Spam', belege };
  }

  if (b.verschleiert && werbeform) {
    return { massnahme: 'sperren', grund: 'Verschleierter Text (Homoglyphen/unsichtbare Zeichen/Zierschrift) mit Weiterleitung', belege };
  }

  const n = absender?.nachrichtenInGruppe;
  const neu = n !== null && n !== undefined && n <= NEU_BIS_NACHRICHTEN;
  if (b.ueberwiegend && neu) {
    return { massnahme: 'loeschen', grund: `Überwiegend ${schriftName(b.schrift)} von neuem Konto`, belege };
  }

  return {
    massnahme: 'melden',
    grund: b.ueberwiegend ? 'Überwiegend fremde Schrift, keine Werbeform' : 'Verschleierter Text ohne Weiterleitung',
    belege,
  };
}
