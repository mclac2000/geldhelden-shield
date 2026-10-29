/**
 * test-fremdschrift.ts — Werbe-Spam in fremder Schrift
 *
 * Anlass 12.10.2026: „今日由码徕收洣   @Dl88o".
 * Aufruf:  npx ts-node scripts/test-fremdschrift.ts
 */

import { bewerteFremdschrift, bewerteAnzeigename, entscheideFremdschrift, FremdschriftMassnahme } from '../src/fremdschriftRisk';
import type { Absender } from '../src/copyTradingRisk';

const FREMD: Absender = { nachrichtenInGruppe: 1, kontoAlterTage: null };
const UNBEKANNT: Absender = { nachrichtenInGruppe: null, kontoAlterTage: null };
const MITGLIED: Absender = { nachrichtenInGruppe: 280, kontoAlterTage: null };

interface Fall { was: string; text: string; absender: Absender; erwartet: FremdschriftMassnahme | FremdschriftMassnahme[]; }

const ZW = '​';

export const MUSS_GREIFEN: Fall[] = [
  { was: 'DAS GEMELDETE ORIGINAL (12.10.2026)', text: '今日由码徕收洣   @Dl88o', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V1 — Glücksspiel, t.me-Link', text: '🎰 博彩娱乐城 首充返利50% 日结 稳定出款 👉 t.me/bc88vip', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V2 — USDT-Ankauf/Geldwäsche chinesisch', text: '高价收U 代收代付 跑分项目 日赚3000+ 私聊 @usdt_888pay', absender: FREMD, erwartet: 'sperren' },
  { was: 'V3 — Kauderwelsch + Kennung, ohne Werbewort', text: '夜啊码徕在顺 皇冠   @Kk7731q', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V4 — Japanisch, Nebenjob-Spam', text: '副業で月収100万円！簡単なスマホ作業だけ✨ 詳しくはLINE ID: fx2288 まで', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V5 — Koreanisch, Casino', text: '카지노 첫충 보너스 30% 안전한 토토사이트 텔레그램 @toto_kr77', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V6 — Kyrillisch, Verdienst + Link', text: 'Удалённая работа! Заработок от 5000 руб в день, пиши в лс или переходи https://t.me/rabota_online', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V7 — Arabisch, Forex + WhatsApp-Nummer', text: 'استثمار مضمون في الفوركس أرباح يومية تواصل معنا واتساب +971501234567', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V8 — Homoglyphen (kyrill. е/о/а in deutschem Text) + Kennung', text: 'Vеrdiеnе jеtzt 500€ pro Tаg mit Krypto, schrеib mir: @Profit_Coach_DE', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V9 — Unsichtbare Zeichen in Wörtern + t.me', text: `Gra${ZW}tis Kry${ZW}pto Sig${ZW}nale ab heute: t.me/+AbCdEf123`, absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V10 — Zierschrift + Kennung', text: '𝐄𝐚𝐫𝐧 𝟓𝟎𝟎$ 𝐝𝐚𝐢𝐥𝐲 𝐰𝐢𝐭𝐡 𝐦𝐞 👉 @CryptoQueenX', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V11 — Mischung CJK + Kyrillisch + Emojis + Kennung', text: '💰💰 今日爆单 заработок 菠菜 💰 @mix_bet99', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V12 — Kyrillisch nur mit Kennung (Tiflis-Fall: löschen, nicht sperren)', text: 'Привет всем, кто ищет квартиру в Тбилиси, пишите @ivan_tbs', absender: FREMD, erwartet: 'loeschen' },
  { was: 'V14 — 29.10.2026 Versand-Werbung (DAS ORIGINAL)', text: '天赐代发团队 🩵\n🚀 Telegram 社群推广引流 🚀\n👑天赐团队 Telegram 社群24小时自动推广引流服务…\n💎TG代发广告…\n⚠️极速代发…\n速度联系 @xxin7', absender: UNBEKANNT, erwartet: 'sperren' },
  { was: 'V15 — Versand-Werbung ohne Kennung, mit Werbewort', text: '专业TG代发广告 群发推广 社群引流 24小时在线 欢迎咨询', absender: FREMD, erwartet: 'sperren' },
  { was: 'V16 — Versand-Werbung von Kanal/Scheinabsender (Mitgliederzahl 0)', text: '天赐代发团队 Telegram 社群推广引流 速度联系 @xxin7', absender: { nachrichtenInGruppe: 0, kontoAlterTage: null }, erwartet: 'sperren' },
  { was: 'V13 — reines Chinesisch ohne Werbeform, neues Konto', text: '大家好今天天气很好我们一起去吃饭吧', absender: FREMD, erwartet: 'loeschen' },
];

export const DARF_NICHT_GREIFEN: Fall[] = [
  { was: 'Deutsch mit einzelnen Emojis', text: 'Super Abend gestern beim Meetup in München 🎉🍻 Danke an alle, nächstes Mal wieder!', absender: UNBEKANNT, erwartet: 'keine' },
  { was: 'Deutsch mit kurzem chinesischen Wort', text: 'War letzte Woche in Shanghai, die Leute sagen ständig 谢谢 – total freundlich dort. Bargeld braucht man kaum noch.', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit kurzem russischen Wort', text: 'Hier in Tiflis spricht fast jeder Russisch. Ein "Спасибо" hilft beim Einkaufen enorm, Georgisch ist schwerer.', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit Kennung und Link (kein Fremdschrift)', text: 'Die Anmeldung zum Meetup läuft über @GeldheldenBot, Infos auch auf https://geldhelden.org/meetups', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit Umlauten und ß', text: 'Größere Beträge würde ich nicht über Nacht auf der Börse lassen. Grüße aus Düsseldorf!', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit japanischem Restaurantnamen', text: 'Treffpunkt ist das Sushi-Restaurant 寿司 am Hauptbahnhof, Tisch ist auf Marco reserviert. Wer kommt mit?', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit Thai-Adresse (Bangkok)', text: 'Wir treffen uns morgen 19 Uhr hier: ถนนสุขุมวิท ซอย 11 – Rooftop-Bar, einfach nach Geldhelden fragen.', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit Georgisch (Tiflis)', text: 'Das Café heißt კაფე ლიტერა und liegt direkt an der Altstadt. Kaffee ist super, WLAN auch.', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch: Warnung zitiert den Spam', text: 'Achtung, hier kam gerade Spam rein: "今日由码徕收洣 @Dl88o" – bitte nicht anschreiben, das ist Betrug!', absender: FREMD, erwartet: ['keine', 'melden'] },
  { was: 'Deutsch mit Telefonnummer', text: 'Wer Hilfe beim Umzug nach Portugal braucht, mein Anwalt dort ist gut erreichbar unter +351 912 345 678.', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit Emojis, Link und Kennung', text: '🚀 Neues Video ist online 👉 https://geldhelden.org/video – Fragen gern an @GeldheldenTeam 🙌💙', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch über Werbung und Reichweite', text: 'Wir überlegen, wie man mit Telegram-Gruppen mehr Reichweite bekommt – Werbung, Kontakt und Anzeigen sind aber nicht erlaubt, oder?', absender: FREMD, erwartet: 'keine' },
  { was: 'Deutsch mit Hinweis auf chinesische Werbung', text: 'Hab gerade 天赐 in einer anderen Gruppe gesehen, nervt total, kontaktiert den Admin bitte.', absender: FREMD, erwartet: ['keine', 'melden'] },
  { was: 'Kurz: nur Emojis', text: '👍👍🔥', absender: UNBEKANNT, erwartet: 'keine' },
  { was: 'Eingesessenes Mitglied schreibt Russisch mit Kennung', text: 'Ребята, кто в Тбилиси, пишите @andrej_gh — встречаемся в субботу в кафе, бесплатно', absender: MITGLIED, erwartet: ['keine', 'melden'] },
];

function pruefe(faelle: Fall[], titel: string): string[] {
  console.log(`\n${'='.repeat(78)}\n${titel}\n${'='.repeat(78)}`);
  const fehler: string[] = [];
  for (const f of faelle) {
    const b = bewerteFremdschrift(f.text, { absender: f.absender });
    const u = entscheideFremdschrift(b, f.absender);
    const erlaubt = Array.isArray(f.erwartet) ? f.erwartet : [f.erwartet];
    const ok = erlaubt.includes(u.massnahme);
    if (!ok) fehler.push(`${f.was}: erwartet ${erlaubt.join('|')}, war ${u.massnahme}`);
    console.log(`${ok ? '✅' : '❌'} ${u.massnahme.toUpperCase().padEnd(8)} ${f.was}`);
    console.log(`     anteil=${Math.round(b.anteilFremd * 100)}% schrift=${b.schrift ?? '-'} signale=${b.signale.join(',') || '-'}`);
  }
  return fehler;
}

export const NAMEN_SPAM: Array<[string, string]> = [
  ['Originalname 29.10.', '天赐代发👉@xxin7👈Direct🔺ad'],
  ['Name mit Kennung', '推广引流 @tg_ad_88'],
  ['Kanalname mit Link', '天赐团队 t.me/xxin7'],
  ['Name nur Werbewort', '专业代发广告'],
];
export const NAMEN_OK: Array<[string, string]> = [
  ['Deutscher Name', 'Marco Müller'],
  ['Name mit Emoji', 'Anna 🌴 Bangkok'],
  ['Name mit Kennung ohne CJK', 'Peter | @peter_gh'],
  ['Chinesischer echter Name', '李小明'],
  ['Chinesischer Name mit Latein', '王芳 Fang Wang'],
  ['Japanischer Name', '田中 太郎'],
  ['Russischer Name', 'Иван Петров'],
];

function pruefeNamen(): string[] {
  console.log(`\n${'='.repeat(78)}\n3. ANZEIGENAMEN\n${'='.repeat(78)}`);
  const fehler: string[] = [];
  for (const [was, n] of NAMEN_SPAM) { const r = bewerteAnzeigename(n); console.log(`${r.spam ? '✅' : '❌'} SPAM  ${was}`); if (!r.spam) fehler.push(`Name ${was}: nicht erkannt`); }
  for (const [was, n] of NAMEN_OK) { const r = bewerteAnzeigename(n); console.log(`${!r.spam ? '✅' : '❌'} OK    ${was}`); if (r.spam) fehler.push(`Name ${was}: Fehlalarm`); }
  return fehler;
}

if (require.main === module) {
  const f1 = pruefe(MUSS_GREIFEN, '1. MUSS GREIFEN — Original + Varianten');
  const f2 = pruefe(DARF_NICHT_GREIFEN, '2. DARF NICHT GREIFEN — echte deutsche Nachrichten');
  const f3 = pruefeNamen();
  const fehler = [...f1, ...f2, ...f3];
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
}
