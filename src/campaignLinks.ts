/**
 * campaignLinks.ts — Erkennung von Werbe-Wellen über den gemeinsamen Ziel-Link
 *
 * Hintergrund: Beim beobachteten Angriff schreiben mehrere Strohmänner
 * ("Lisa", "Klaus") Mitglieder an und leiten sie in EINE Fake-Gruppe. Die
 * Strohmänner sind austauschbar und beim Beitritt nicht von echten Mitgliedern
 * zu unterscheiden — der Ziel-Link ist es aber. Er ist der gemeinsame Nenner
 * der gesamten Kampagne.
 *
 * Kriterium für eine Welle, bewusst konservativ:
 *   ein fremder Telegram-Link, gepostet von MEHREREN verschiedenen Konten
 *   in MEHREREN verschiedenen verwalteten Gruppen, mit einer Mindestzahl an
 *   Nachrichten, innerhalb eines kurzen Zeitfensters.
 *
 * Das unterscheidet eine Kampagne von:
 *   - einem einzelnen Mitglied, das einen Link teilt          (1 Konto)
 *   - einem beliebten Partner-Link, der über Monate wächst    (Zeitfenster)
 *   - unseren eigenen Gruppen, auch den privaten              (Freigabeliste)
 *
 * Wer eine Nachricht WEITERLEITET, wird nie automatisch gesperrt — das ist
 * typischerweise ein Mitglied, das vor dem Betrug warnt.
 */

import { Context } from 'telegraf';
import { config } from './config';

// ---------------------------------------------------------------------------
// Extraktion und Normalisierung
// ---------------------------------------------------------------------------

/** Telegram-Domains, die auf einen Chat zeigen können */
const TG_HOSTS = new Set([
  't.me', 'www.t.me',
  'telegram.me', 'www.telegram.me',
  'telegram.dog', 'www.telegram.dog',
]);

/**
 * Pfade, die KEIN Gruppenziel sind, sondern Telegram-Funktionen.
 * Diese dürfen nie als Kampagnen-Link gewertet werden.
 */
const SERVICE_PATHS = new Set([
  'share', 'addstickers', 'addemoji', 'addtheme', 'setlanguage',
  'proxy', 'socks', 'iv', 'bg', 'confirmphone', 'login', 'auth',
  'giftcode', 'invoice', 'contact', 'premium', 'boost', 'c', 'm',
]);

/**
 * Normalisiert einen Telegram-Link auf einen Vergleichsschlüssel.
 * Alle Formen, die auf dasselbe Ziel zeigen, ergeben denselben Schlüssel.
 *
 *   t.me/gruppe        t.me/gruppe/123     t.me/s/gruppe   → public:gruppe
 *   t.me/+AbCdEfGh     t.me/joinchat/AbCdEfGh              → invite:AbCdEfGh
 *
 * @returns null, wenn es kein Telegram-Chat-Link ist
 */
export function normalizeTelegramLink(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();

  // Protokoll ergänzen, damit URL() greift — aber nur, wenn der String
  // tatsächlich MIT einem Telegram-Host beginnt. Ohne diese Verankerung
  // würde "payt.me/gruppe" oder "example.com/pfad/t.me/x" fälschlich passen.
  if (!/^https?:\/\//i.test(s)) {
    if (!/^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\//i.test(s)) return null;
    s = 'https://' + s;
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }

  // Kein Benutzer-/Passwortanteil (t.me@evil.com) und kein abweichender Port
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443' && url.port !== '80') return null;
  if (!TG_HOSTS.has(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  // Einladungslink: t.me/+HASH oder t.me/joinchat/HASH
  // WICHTIG: Der Hash ist base64url und GROSS-/KLEINSCHREIBUNG-EMPFINDLICH —
  // "+AbCdEf" und "+abcdef" sind verschiedene Gruppen. Nicht kleinschreiben.
  let hash: string | null = null;
  if (parts[0].startsWith('+')) hash = parts[0].substring(1);
  else if (parts[0].toLowerCase() === 'joinchat' && parts[1]) hash = parts[1];

  if (hash !== null) {
    // Längenbegrenzung, damit der Schlüssel in Telegrams 64-Byte-Grenze für
    // callback_data passt und nicht mit einem Mega-Hash die Meldung sprengt.
    if (!/^[A-Za-z0-9_-]{8,48}$/.test(hash)) return null;
    return `invite:${hash}`;
  }

  // Vorschau-Form t.me/s/gruppe zeigt auf dieselbe Gruppe
  let nameIdx = 0;
  if (parts[0].toLowerCase() === 's' && parts[1]) nameIdx = 1;

  const name = (parts[nameIdx] || '').toLowerCase();
  if (!name) return null;
  if (SERVICE_PATHS.has(name)) return null;
  // Telegram-Benutzernamen: Buchstaben/Ziffern/Unterstrich
  if (!/^[a-z0-9_]{4,32}$/.test(name)) return null;

  return `public:${name}`;
}

/** Alle Telegram-Chat-Links aus einer Nachricht, entdoppelt */
export function extractTelegramLinks(
  text: string | undefined,
  entities: any[] | undefined
): Array<{ key: string; raw: string }> {
  const found = new Map<string, string>();
  const consider = (candidate: string) => {
    const key = normalizeTelegramLink(candidate);
    if (key && !found.has(key)) found.set(key, candidate);
  };

  if (text) {
    // (?<![\w.\-@/]) verhindert Treffer mitten in einer fremden Domain oder
    // einem fremden Pfad — "payt.me/x" und "example.com/t.me/x" fallen raus.
    const re = /(?<![\w.\-@/])(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/[^\s<>"')\]]+/gi;
    let m;
    while ((m = re.exec(text)) !== null) consider(m[0]);
  }

  if (entities && text) {
    for (const e of entities) {
      if (e.type === 'text_link' && e.url) consider(e.url);
      else if (e.type === 'url') consider(text.substring(e.offset, e.offset + e.length));
    }
  }

  return Array.from(found, ([key, raw]) => ({ key, raw }));
}

/** Maskiert HTML-Sonderzeichen für Telegram-Meldungen mit parse_mode HTML */
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Verarbeitung
// ---------------------------------------------------------------------------

/** Kurzzeit-Cache für die Gruppen-Admin-Prüfung (spart Telegram-Aufrufe) */
const adminCache = new Map<string, { isAdmin: boolean; at: number }>();
const ADMIN_CACHE_TTL = 10 * 60 * 1000;

async function isGroupAdminCached(telegram: any, chatId: string, userId: number): Promise<boolean> {
  const k = `${chatId}:${userId}`;
  const c = adminCache.get(k);
  if (c && Date.now() - c.at < ADMIN_CACHE_TTL) return c.isAdmin;
  try {
    const { isUserAdminOrCreatorInGroup } = await import('./telegram');
    const r = await isUserAdminOrCreatorInGroup(chatId, userId, telegram);
    adminCache.set(k, { isAdmin: r.isAdmin, at: Date.now() });
    if (adminCache.size > 5000) adminCache.clear();
    return r.isAdmin;
  } catch {
    return false; // Prüfung fehlgeschlagen — es wird ohnehin nur gezählt
  }
}

export interface CampaignResult {
  /** Nachricht wurde gelöscht */
  deleted: boolean;
  /** Eine Welle wurde in dieser Verarbeitung neu behandelt */
  campaignDetected: boolean;
}

/**
 * Verarbeitet die Telegram-Links einer Nachricht.
 *
 * Reihenfolge bewusst so:
 *   1. Links extrahieren, freigegebene aussortieren
 *   2. Gesperrter Link? → sofort löschen (ohne Telegram-Rechteabfrage)
 *   3. Absender ausgenommen? → nicht zählen
 *   4. Sichtung erfassen und Wellenkriterium prüfen
 */
export async function processCampaignLinks(ctx: Context): Promise<CampaignResult> {
  const none: CampaignResult = { deleted: false, campaignDetected: false };

  try {
    if (!config.campaignLinksEnabled) return none;

    const msg: any = (ctx as any).message || (ctx as any).editedMessage || (ctx as any).update?.edited_message;
    if (!msg || !ctx.from || ctx.from.is_bot) return none;
    if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return none;

    const text: string | undefined = msg.text || msg.caption;
    const entities: any[] | undefined = msg.entities || msg.caption_entities;
    if (!text) return none;

    const links = extractTelegramLinks(text, entities);
    if (links.length === 0) return none;

    const chatId = String(ctx.chat.id);
    const userId = ctx.from.id;

    const {
      isLinkAllowlisted, isLinkBlocked, recordLinkSighting, getGroup,
      getLinkCampaignStats, getLinkVerdict, upsertLinkVerdict, getLinkSightings,
      isTeamMember, isIdentityExempt,
    } = await import('./db');
    const { isAdmin } = await import('./admin');

    // Nur verwaltete Gruppen zählen. Sonst könnte jemand den Bot in zwei eigene
    // Gruppen holen und dort mit Zweitkonten ein Urteil über einen beliebigen
    // legitimen Link erzwingen, das dann in UNSEREN Gruppen wirkt.
    const group = getGroup(chatId);
    const istVerwaltet = group?.status === 1;

    // Freigegebene Links (eigene Gruppen, Partner) gar nicht erst betrachten
    const relevant = links.filter(l => !isLinkAllowlisted(l.key));
    if (relevant.length === 0) return none;

    // --- Gesperrte Links: löschen, unabhängig von allem anderen ---
    let deleted = false;
    for (const { key } of relevant) {
      if (!isLinkBlocked(key)) continue;
      if (isAdmin(userId) || isTeamMember(userId)) break; // Admins nie löschen
      const { deleteMessage } = await import('./telegram');
      const ok = await deleteMessage(chatId, msg.message_id);
      deleted = ok;
      console.log(`[CampaignLink][BLOCKED] ${key} von user=${userId} in ${chatId} — ${ok ? 'gelöscht' : 'nicht löschbar'}`);
      break;
    }
    if (deleted) return { deleted: true, campaignDetected: false };

    if (!istVerwaltet) return none;

    // --- Ausnahmen: Absender, dessen Links nie gezählt werden ---
    if (isAdmin(userId) || isTeamMember(userId) || isIdentityExempt(userId)) return none;
    if (config.protectedUserIds.includes(userId)) return none;
    if (await isGroupAdminCached(ctx.telegram, chatId, userId)) return none;

    let campaignDetected = false;
    const isForward = !!(msg.forward_origin || msg.forward_from || msg.forward_from_chat || msg.forward_date);

    for (const { key, raw } of relevant) {
      recordLinkSighting(key, raw, chatId, userId, msg.message_id, isForward);

      const stats = getLinkCampaignStats(key, config.campaignWindowHours);
      const schwelleErreicht =
        stats.distinctUsers >= config.campaignMinUsers &&
        stats.distinctChats >= config.campaignMinChats &&
        stats.sightings >= config.campaignMinSightings;

      if (!schwelleErreicht) continue;

      const prior = getLinkVerdict(key);
      const istNeu = !prior;
      // Eine im Beobachtungsmodus erkannte Welle muss beim Scharfschalten
      // nachgeholt werden — sonst bliebe sie für immer unbehandelt.
      const nurBeobachtet = !!prior && prior.blocked === 0 && prior.reverted === 0;
      const behandeln = istNeu || (nurBeobachtet && config.campaignAutoBlock);

      // Urteil IMMER schreiben, inklusive blocked-Zustand (sonst Endlosschleife)
      upsertLinkVerdict(key, stats, config.campaignAutoBlock);

      if (behandeln) {
        campaignDetected = true;
        const sightings = getLinkSightings(key, config.campaignWindowHours);
        await handleCampaign(ctx, key, raw, stats, sightings);
      }
    }

    return { deleted: false, campaignDetected };
  } catch (error: unknown) {
    console.error('[CampaignLink] Fehler:', error instanceof Error ? error.message : String(error));
    return none;
  }
}

/**
 * Reaktion auf eine erkannte Welle.
 *
 * Bei campaignAutoBlock=false wird ausschließlich gemeldet — kein Löschen,
 * keine Sperre. Das ist der Beobachtungsmodus, in dem die Trefferquote an
 * echten Daten gemessen wird, bevor irgendetwas automatisch passiert.
 */
async function handleCampaign(
  ctx: Context,
  key: string,
  raw: string,
  stats: { distinctUsers: number; distinctChats: number; sightings: number; firstSeen: number },
  sightings: Array<{ chat_id: string; user_id: number; message_id: number; forwarded: number }>
): Promise<void> {
  const { Markup } = await import('telegraf');
  const { deleteMessage, banUserGlobally } = await import('./telegram');
  const { getGroupTitle, markLinkCampaignActioned, getLinkVerdictId } = await import('./db');

  const senders = Array.from(new Set(sightings.map(s => s.user_id)));

  // Verteiler = wer den Link SELBST (nicht weitergeleitet) in mindestens zwei
  // Gruppen gepostet hat. Wer weiterleitet, warnt in aller Regel vor dem Betrug
  // und darf dafür niemals gesperrt werden.
  const eigenePosts = new Map<number, Set<string>>();
  for (const s of sightings) {
    if (s.forwarded) continue;
    if (!eigenePosts.has(s.user_id)) eigenePosts.set(s.user_id, new Set());
    eigenePosts.get(s.user_id)!.add(s.chat_id);
  }
  const spreaders = senders.filter(u => (eigenePosts.get(u)?.size ?? 0) >= 2);
  const warner = senders.filter(u => !eigenePosts.has(u));

  const gruppen = Array.from(new Set(sightings.map(s => s.chat_id)))
    .map(id => getGroupTitle(id) || id)
    .slice(0, 8);

  let msg = config.campaignAutoBlock
    ? '🚫 <b>WERBE-WELLE GESPERRT</b>\n\n'
    : '🔎 <b>WERBE-WELLE ERKANNT</b> (Beobachtungsmodus)\n\n';
  msg += `🔗 Ziel: <code>${esc(raw.substring(0, 80))}</code>\n`;
  msg += `🔑 Schlüssel: <code>${esc(key)}</code>\n`;
  msg += `👥 Konten: <b>${stats.distinctUsers}</b>\n`;
  msg += `📍 Gruppen: <b>${stats.distinctChats}</b> — ${esc(gruppen.join(', '))}\n`;
  msg += `📨 Nachrichten: <b>${stats.sightings}</b>\n`;
  msg += `⏱ seit ${new Date(stats.firstSeen).toISOString().replace('T', ' ').substring(0, 16)}\n\n`;
  msg += `<b>Absender:</b> ${senders.slice(0, 15).map(u => `<code>${u}</code>`).join(', ')}\n`;
  if (spreaders.length > 0) {
    msg += `<b>Verteiler (selbst gepostet, ≥2 Gruppen):</b> ${spreaders.map(u => `<code>${u}</code>`).join(', ')}\n`;
  }
  if (warner.length > 0) {
    msg += `<b>nur weitergeleitet (vermutlich Warnung, nie gesperrt):</b> ${warner.map(u => `<code>${u}</code>`).join(', ')}\n`;
  }

  if (!config.campaignAutoBlock) {
    msg += `\n<i>Es wurde nichts gelöscht und niemand gesperrt. ` +
      `Zum Scharfschalten: CAMPAIGN_LINKS_AUTO_BLOCK=true</i>`;
  }

  // callback_data ist auf 64 Byte begrenzt — deshalb die Zeilen-ID statt des
  // Schlüssels, der beliebig lang sein kann.
  const vid = getLinkVerdictId(key);
  const buttons = config.campaignAutoBlock
    ? [[Markup.button.callback('↩️ LINK WIEDER FREIGEBEN', `link_allow:${vid}`)]]
    : [[
        Markup.button.callback('🚫 JETZT SPERREN', `link_block:${vid}`),
        Markup.button.callback('✅ HARMLOS', `link_allow:${vid}`),
      ]];

  try {
    await ctx.telegram.sendMessage(config.adminLogChat, msg, {
      parse_mode: 'HTML',
      reply_markup: vid ? Markup.inlineKeyboard(buttons).reply_markup : undefined,
      // Keine Vorschau — die Meldung soll den Fake-Link nicht auch noch bewerben
      link_preview_options: { is_disabled: true },
    });
  } catch (e: any) {
    console.error('[CampaignLink] Meldung fehlgeschlagen:', e.message);
    // Notfall ohne Formatierung, damit die Warnung nicht ganz verloren geht
    try {
      await ctx.telegram.sendMessage(
        config.adminLogChat,
        `Werbe-Welle erkannt: ${key} — ${stats.distinctUsers} Konten, ${stats.distinctChats} Gruppen, ${stats.sightings} Nachrichten`
      );
    } catch { /* aufgeben */ }
  }

  console.log(
    `[CampaignLink][${config.campaignAutoBlock ? 'BLOCK' : 'OBSERVE'}] ${key} ` +
    `users=${stats.distinctUsers} chats=${stats.distinctChats} sightings=${stats.sightings} spreaders=${spreaders.length}`
  );

  if (!config.campaignAutoBlock) return;

  // --- Durchsetzung ---
  let removed = 0;
  for (const s of sightings) {
    if (await deleteMessage(s.chat_id, s.message_id)) removed++;
  }

  let banned = 0;
  if (config.campaignAutoBanSpreaders) {
    for (const uid of spreaders) {
      const r = await banUserGlobally(uid, `Werbe-Welle: verteilte ${key} selbst in ≥2 Gruppen`);
      if (r.success) banned++;
    }
  }

  markLinkCampaignActioned(key, removed, banned);

  try {
    await ctx.telegram.sendMessage(
      config.adminLogChat,
      `✅ Welle <code>${esc(key)}</code>: ${removed} Nachrichten gelöscht, ${banned} Verteiler gesperrt.`,
      { parse_mode: 'HTML' }
    );
  } catch { /* nicht kritisch */ }
}
