/**
 * usernameGate.ts — Zutrittsregel „ohne Benutzernamen kein Zutritt"
 *
 * ==========================================================================
 * DIESE REGEL IST ABSICHTLICH ABGESCHALTET. BITTE VOR DEM EINSCHALTEN LESEN.
 * ==========================================================================
 *
 * Sie wurde am 10.09.2026 gebaut, nachdem gemessen wurde, ob sie etwas bringt.
 * Sie bringt nichts. Die Messung an 4.110 Beitritten mit mindestens 30 Tagen
 * Nachlaufzeit:
 *
 *   Beitretende OHNE Benutzernamen -> 24,41 % wurden spaeter auffaellig
 *   Beitretende MIT  Benutzernamen -> 23,88 % wurden spaeter auffaellig
 *
 * Das ist kein Unterschied. Bei den Konten, die ein Mensch von Hand gebannt hat,
 * zeigt das Merkmal sogar in die GEGENRICHTUNG:
 *
 *   ohne Benutzernamen -> 6,05 % gebannt
 *   mit  Benutzernamen -> 9,22 % gebannt
 *
 * Gleichzeitig haben 55,1 % aller Beitritte der letzten 14 Tage (184 von 334)
 * keinen Benutzernamen. Die Regel wuerde also mehr als jeden zweiten Neuzugang
 * abweisen und dabei die Betrugsquote nicht senken.
 *
 * Wer sie trotzdem einschalten will, sollte einen Grund haben, der nicht in
 * diesen Zahlen steht — etwa eine neue Angriffswelle mit anderem Muster. Dann
 * bitte VORHER neu messen (scripts/measure-account-age.ts zeigt, wie).
 *
 * WAS SIE NICHT PRUEFT: die Telefonnummer. Die Telegram-Bot-Schnittstelle gibt
 * einem Bot die Telefonnummer eines Nutzers nicht — weder im User-Objekt noch in
 * der Beitrittsanfrage. Sie ist nur erhaeltlich, wenn der Nutzer sie aktiv ueber
 * einen Kontakt-Knopf im Privatchat sendet. Der urspruengliche Wunsch
 * („Benutzername ODER Telefonnummer") ist technisch nicht umsetzbar.
 *
 * WO SIE UEBERHAUPT WIRKEN KANN: nur in Gruppen mit Genehmigungspflicht
 * (join_by_request). Nur dort erfaehrt der Bot von einem Beitritt, BEVOR der
 * Mensch drin ist. Stand 10.09.2026 sind das 3 von 54 Gruppen, und in diesen
 * drei gab es in 14 Tagen keinen einzigen Beitritt. In allen anderen Gruppen
 * bliebe nur nachtraegliches Entfernen — das macht diese Datei bewusst NICHT.
 */
import { Context } from 'telegraf';
import { config } from './config';
import { getDatabase } from './db';

export type GateEntscheidung = 'zugelassen' | 'abgelehnt' | 'beobachtet' | 'uebersprungen';

let tabelleBereit = false;

/** Legt das Protokoll an. Ohne Protokoll darf die Regel nicht laufen. */
function stelleTabelleSicher(): void {
  if (tabelleBereit) return;
  try {
    getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS username_gate_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        gruppentitel TEXT,
        hat_username INTEGER NOT NULL,
        entscheidung TEXT NOT NULL,
        grund TEXT,
        hinweis_zugestellt INTEGER NOT NULL DEFAULT 0,
        hinweis_fehler TEXT,
        regel_aktiv INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_ugl_created ON username_gate_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ugl_user ON username_gate_log(user_id);
    `);
    tabelleBereit = true;
  } catch (error: any) {
    console.error('[Zutrittsregel] Protokolltabelle konnte nicht angelegt werden:', error?.message);
  }
}

function protokolliere(e: {
  userId: number; chatId: string; gruppentitel: string | null; hatUsername: boolean;
  entscheidung: GateEntscheidung; grund: string; hinweisZugestellt: boolean;
  hinweisFehler: string | null; regelAktiv: boolean;
}): void {
  stelleTabelleSicher();
  try {
    getDatabase().prepare(`
      INSERT INTO username_gate_log
        (created_at, user_id, chat_id, gruppentitel, hat_username, entscheidung, grund,
         hinweis_zugestellt, hinweis_fehler, regel_aktiv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(), e.userId, e.chatId, e.gruppentitel, e.hatUsername ? 1 : 0,
      e.entscheidung, e.grund, e.hinweisZugestellt ? 1 : 0, e.hinweisFehler, e.regelAktiv ? 1 : 0
    );
  } catch (error: any) {
    console.error('[Zutrittsregel] Protokolleintrag fehlgeschlagen:', error?.message);
  }
}

const HINWEIS_TEXT =
  'Hallo! Für den Zutritt zu unseren Geldhelden-Gruppen brauchen wir einen ' +
  'öffentlichen Benutzernamen (@name) im Profil. Das hilft uns, Betrüger ' +
  'fernzuhalten, die unsere Mitglieder anschreiben.\n\n' +
  'Du kannst ihn in Telegram unter Einstellungen → Benutzername anlegen und dich ' +
  'danach jederzeit erneut anmelden. Wir freuen uns auf dich!';

/**
 * Behandelt eine Beitrittsanfrage.
 *
 * Ist die Regel abgeschaltet (Normalfall), wird NICHTS entschieden — die Anfrage
 * bleibt für die menschlichen Admins offen, so wie bisher. Protokolliert wird
 * trotzdem, damit man später weiß, was die Regel getan HÄTTE.
 */
export async function behandleBeitrittsanfrage(ctx: Context): Promise<void> {
  try {
    const anfrage: any = (ctx as any).chatJoinRequest;
    if (!anfrage?.from || !anfrage?.chat) return;

    const userId: number = anfrage.from.id;
    const chatId = String(anfrage.chat.id);
    const gruppentitel: string | null = anfrage.chat.title ?? null;
    const hatUsername = Boolean(anfrage.from.username);

    const regelAktiv = config.usernameGateEnabled;
    const gruppeBetroffen =
      config.usernameGateGroups.length > 0 && config.usernameGateGroups.includes(chatId);

    // --- Beobachtungsmodus: nur mitschreiben, nichts entscheiden -----------
    if (!regelAktiv || !gruppeBetroffen) {
      protokolliere({
        userId, chatId, gruppentitel, hatUsername,
        entscheidung: 'beobachtet',
        grund: !regelAktiv
          ? 'Regel abgeschaltet (USERNAME_GATE_ENABLED=false) — Anfrage bleibt für Admins offen'
          : 'Gruppe steht nicht in USERNAME_GATE_GROUPS',
        hinweisZugestellt: false, hinweisFehler: null, regelAktiv,
      });
      console.log(
        `[Zutrittsregel][BEOBACHTET] user=${userId} chat=${chatId} ` +
        `username=${hatUsername ? 'ja' : 'nein'} — keine Entscheidung getroffen`
      );
      return;
    }

    // --- Regel ist aktiv und die Gruppe ist ausgewählt ---------------------
    if (hatUsername) {
      await ctx.telegram.approveChatJoinRequest(anfrage.chat.id, userId);
      protokolliere({
        userId, chatId, gruppentitel, hatUsername: true,
        entscheidung: 'zugelassen', grund: 'Benutzername vorhanden',
        hinweisZugestellt: false, hinweisFehler: null, regelAktiv,
      });
      console.log(`[Zutrittsregel][ZUGELASSEN] user=${userId} chat=${chatId}`);
      return;
    }

    // Kein Benutzername -> ablehnen.
    //
    // REIHENFOLGE IST WICHTIG: Erst den Hinweis schicken, dann ablehnen.
    // declineChatJoinRequest nimmt keine Begründung entgegen, und das Feld
    // user_chat_id einer Beitrittsanfrage erlaubt eine Privatnachricht nur
    // „for 5 minutes ... until the join request is processed". Nach der
    // Ablehnung ist dieses Fenster zu.
    let hinweisZugestellt = false;
    let hinweisFehler: string | null = null;

    if (config.usernameGateNotify) {
      const zielChat = anfrage.user_chat_id ?? userId;
      try {
        await ctx.telegram.sendMessage(zielChat, HINWEIS_TEXT);
        hinweisZugestellt = true;
      } catch (error: any) {
        // Häufigster Fall: der Mensch hat den Bot nie gestartet. Dann ist keine
        // Zustellung möglich — das ist erwartbar und kein Grund abzubrechen.
        hinweisFehler = String(error?.message ?? error).slice(0, 200);
        console.log(`[Zutrittsregel][HINWEIS-FEHLGESCHLAGEN] user=${userId}: ${hinweisFehler}`);
      }
    }

    await ctx.telegram.declineChatJoinRequest(anfrage.chat.id, userId);
    protokolliere({
      userId, chatId, gruppentitel, hatUsername: false,
      entscheidung: 'abgelehnt', grund: 'Kein öffentlicher Benutzername im Profil',
      hinweisZugestellt, hinweisFehler, regelAktiv,
    });
    console.log(
      `[Zutrittsregel][ABGELEHNT] user=${userId} chat=${chatId} ` +
      `hinweis=${hinweisZugestellt ? 'zugestellt' : 'NICHT zugestellt'}`
    );
  } catch (error: any) {
    // Im Zweifel nichts tun: eine offene Anfrage kann ein Mensch nachträglich
    // entscheiden, eine fälschlich abgelehnte nicht.
    console.error('[Zutrittsregel] Fehler:', error?.message ?? error);
  }
}

/** Kurzer Statusbericht für Admin-Ausgaben und den Start. */
export function gateStatus(): string {
  if (!config.usernameGateEnabled) {
    return 'Zutrittsregel Benutzername: AUS (beobachtet nur mit, entscheidet nichts)';
  }
  const n = config.usernameGateGroups.length;
  return `Zutrittsregel Benutzername: AKTIV in ${n} Gruppe(n)` +
    `, Hinweis ${config.usernameGateNotify ? 'an' : 'aus'}`;
}
