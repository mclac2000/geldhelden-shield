#!/usr/bin/env python3
"""
pruefe-erreichbarkeit.py — Sieht der Bot noch in jede Gruppe hinein, die er
bewachen soll?

ANLASS (11.09.2026): "Geldhelden Meetup Muenchen" ist dem Bot im Fruehjahr
abhanden gekommen. Ein halbes Jahr lang hat es niemand bemerkt. Genau dort sass
ein gemeldetes Betrugsprofil.

Dieses Skript ist bewusst NICHT Teil des Bots. Ein Waechter, der im selben
Prozess laeuft wie das Bewachte, faellt mit ihm zusammen aus.

Zwei Betriebsarten:
  --bericht   Vollstaendige Liste aller Gruppen, nur auf die Konsole.
  --waechter  Taeglicher Lauf: meldet NUR, wenn etwas nicht stimmt, und zwar
              nach Telegram. Schweigt, wenn alles in Ordnung ist.

Exit-Code im Waechter-Modus: 0 = alles erreichbar, 1 = mindestens eine Luecke.
"""
import argparse
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASIS = "/root/Geldhelden Shield"
DB = BASIS + "/data/shield.db"


def env(schluessel):
    for zeile in open(BASIS + "/.env", encoding="utf-8"):
        treffer = re.match(r"^%s=(.*)$" % re.escape(schluessel), zeile.strip())
        if treffer:
            return treffer.group(1).strip().strip('"').strip("'")
    return None


TOKEN = env("BOT_TOKEN")
if not TOKEN:
    print("FEHLER: BOT_TOKEN nicht lesbar", file=sys.stderr)
    sys.exit(2)
API = "https://api.telegram.org/bot" + TOKEN
ADMIN_CHAT = env("ADMIN_LOG_CHAT")


# Pause zwischen zwei Aufrufen.
#
# GEMESSEN am 11.09.2026 (scripts/miss-api-tempo.py): Ein einzelner Aufruf
# braucht rund 0,1 Sekunden — auch für einen Chat, den es nicht mehr gibt
# (der antwortet mit HTTP 400, ebenfalls in 0,1 s). Bei schnellen Folgeaufrufen
# drosselt Telegram jedoch, und einzelne Aufrufe liefen in den Zeitablauf.
#
# Ich hatte das zuerst den unerreichbaren Chats zugeschrieben. Das war falsch:
# die sind schnell. Die Bremse ist die Drosselung.
PAUSE = 0.35


def ruf(methode, **p):
    """Liefert immer den Antwortkoerper, auch bei HTTP 400 oder 429."""
    url = API + "/" + methode
    if p:
        url += "?" + urllib.parse.urlencode(p)
    for versuch in (1, 2):
        try:
            with urllib.request.urlopen(url, timeout=15) as a:
                return json.loads(a.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                koerper = json.loads(e.read().decode("utf-8"))
            except Exception:
                return {"ok": False, "description": "HTTP %s" % e.code}
            # 429: Telegram sagt selbst, wie lange es dauert. Einmal warten
            # und noch einmal versuchen — sonst meldet der Waechter eine
            # Luecke, wo nur eine Drosselung war.
            if e.code == 429 and versuch == 1:
                warte = koerper.get("parameters", {}).get("retry_after", 2)
                time.sleep(min(warte, 30) + 0.5)
                continue
            return koerper
        except Exception as e:
            if versuch == 1:
                time.sleep(1.5)
                continue
            return {"ok": False, "description": str(e)[:80]}
    return {"ok": False, "description": "nach zwei Versuchen keine Antwort"}


def melde(text):
    """Schickt eine Meldung in den Admin-Chat. Ohne Chat: auf die Konsole."""
    if not ADMIN_CHAT:
        print("(ADMIN_LOG_CHAT nicht gesetzt — Meldung nur hier)")
        print(text)
        return False
    r = ruf("sendMessage", chat_id=ADMIN_CHAT, text=text,
            disable_web_page_preview="true")
    if not r.get("ok"):
        print("Meldung konnte nicht zugestellt werden: %s" % r.get("description"),
              file=sys.stderr)
        return False
    return True


def pruefe():
    """Liefert (in_ordnung, probleme, verwaltet_gesamt, ungeklaerte)."""
    me = ruf("getMe")
    if not me.get("ok"):
        return False, [("— Bot selbst —", "getMe fehlgeschlagen: %s"
                        % me.get("description"), 0)], 0, []
    bot_id = me["result"]["id"]

    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    # Fremde Gruppen bleiben aussen vor. Eine Liste, die sie mitzaehlt, erzeugt
    # Alarme, die niemand beheben kann — und die deshalb irgendwann alle
    # ignorieren. (Spalte kann fehlen, wenn markiere-fremd.py nie lief.)
    spalten = [r[1] for r in con.execute("PRAGMA table_info(groups)").fetchall()]
    fremd_filter = "AND COALESCE(g.fremd, 0) = 0" if "fremd" in spalten else ""
    hat_ungeklaert = "ungeklaert" in spalten
    ungeklaert_feld = ("COALESCE(g.ungeklaert, 0), COALESCE(g.ungeklaert_grund, '')"
                       if hat_ungeklaert else "0, ''")
    gruppen = con.execute("""
        SELECT g.chat_id, g.title, g.status,
               (SELECT COUNT(*) FROM user_group_activity a WHERE a.group_id = g.chat_id),
               %s
        FROM groups g WHERE 1=1 %s ORDER BY g.title
    """ % (ungeklaert_feld, fremd_filter)).fetchall()
    con.close()

    probleme = []
    ungeklaerte = []
    verwaltet = 0
    # Fortschritt auf stderr: der Lauf dauert Minuten, und ein Skript, das
    # minutenlang schweigt, sieht aus wie ein haengendes Skript.
    gesamt_zu_pruefen = len(gruppen)
    lfd = 0
    for chat_id, titel, status_db, mitglieder, ist_ungeklaert, ungeklaert_grund in gruppen:
        # Ungeklärte Gruppen erscheinen im Bericht, aber NICHT im täglichen
        # Alarm. Ein Wächter, der jeden Morgen dieselben unlösbaren Probleme
        # meldet, wird nach einer Woche nicht mehr gelesen — und dann geht auch
        # die eine echte Meldung unter.
        #
        # Die Abfrage wird für sie ÜBERSPRUNGEN, nicht nur ihr Ergebnis
        # verworfen — acht überflüssige Abfragen sind acht überflüssige
        # Abfragen. (Nicht, weil sie langsam wären: gemessen antwortet ein
        # nicht mehr existierender Chat in 0,1 s mit HTTP 400.)
        if ist_ungeklaert:
            ungeklaerte.append((titel or chat_id, ungeklaert_grund or "ohne Grund", mitglieder))
            continue

        lfd += 1
        print("  ... %d/%d  %s" % (lfd, gesamt_zu_pruefen, (titel or chat_id)[:44]),
              file=sys.stderr, flush=True)
        mit = ruf("getChatMember", chat_id=chat_id, user_id=bot_id)
        time.sleep(PAUSE)
        ist_admin = mit.get("ok") and mit["result"].get("status") == "administrator"

        if status_db == "managed":
            verwaltet += 1
            if not mit.get("ok"):
                probleme.append((titel or chat_id,
                                 "NICHT ERREICHBAR — %s" % (mit.get("description") or "?"),
                                 mitglieder))
                continue
            tg_status = mit["result"].get("status")
            if tg_status in ("left", "kicked"):
                probleme.append((titel or chat_id,
                                 "Bot ist KEIN Mitglied mehr (%s)" % tg_status, mitglieder))
            elif tg_status != "administrator":
                probleme.append((titel or chat_id,
                                 "Bot ist nur '%s', nicht Administrator" % tg_status, mitglieder))
            elif not mit["result"].get("can_restrict_members"):
                probleme.append((titel or chat_id,
                                 "Administrator, aber ohne Recht 'Nutzer sperren'", mitglieder))
        else:
            # Gegenrichtung: Gruppe steht auf 'disabled', der Bot ist aber
            # Administrator. Dann ist sie einsatzbereit und nur vergessen worden.
            # Genau dieser Fall ist im Fruehjahr 2026 uebersehen worden.
            if ist_admin:
                probleme.append((titel or chat_id,
                                 "VERGESSEN: Bot ist Administrator, aber die Gruppe "
                                 "steht auf '%s' — es greift keine Regel" % status_db,
                                 mitglieder))
    return len(probleme) == 0, probleme, verwaltet, ungeklaerte


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--waechter", action="store_true",
                   help="Nur melden, wenn etwas nicht stimmt (fuer den taeglichen Lauf)")
    p.add_argument("--bericht", action="store_true",
                   help="Vollstaendige Ausgabe auf die Konsole")
    p.add_argument("--testmeldung", action="store_true",
                   help="Einmalig eine Meldung schicken, auch wenn alles in Ordnung ist")
    args = p.parse_args()

    in_ordnung, probleme, gesamt, ungeklaerte = pruefe()

    if args.bericht or not args.waechter:
        print("Geprueft: %d verwaltete Gruppen" % gesamt)
        if in_ordnung:
            print("Alle erreichbar, Bot ueberall Administrator mit Sperrrecht.")
        else:
            print("")
            print("%d Gruppe(n) mit Problem:" % len(probleme))
            for titel, grund, mitglieder in probleme:
                print("  %-40s %s  (%d erfasste Mitglieder)"
                      % (titel[:40], grund, mitglieder))
        if ungeklaerte:
            print("")
            print("%d ungeklaerte Gruppe(n) — warten auf eine Entscheidung, "
                  "kein Alarm:" % len(ungeklaerte))
            for titel, grund, mitglieder in ungeklaerte:
                print("  %-40s %s  (%d erfasste Mitglieder)"
                      % (titel[:40], grund, mitglieder))

    if args.waechter or args.testmeldung:
        if probleme:
            zeilen = ["[Shield][WAECHTER] Luecke im Schutz",
                      "",
                      "%d von %d verwalteten Gruppen sind nicht richtig angebunden:"
                      % (len(probleme), gesamt), ""]
            for titel, grund, mitglieder in probleme:
                zeilen.append("• %s" % titel[:60])
                zeilen.append("  %s" % grund)
                zeilen.append("  %d erfasste Mitglieder" % mitglieder)
            zeilen.append("")
            zeilen.append("In diesen Gruppen greift keine Regel. "
                          "Bitte den Bot wieder als Administrator eintragen.")
            melde("\n".join(zeilen))
        elif args.testmeldung:
            melde("[Shield][WAECHTER] Testmeldung: alle %d verwalteten Gruppen "
                  "sind erreichbar, der Bot ist ueberall Administrator mit "
                  "Sperrrecht. Ab jetzt meldet sich der Waechter nur noch, "
                  "wenn etwas fehlt." % gesamt)

    sys.exit(0 if in_ordnung else 1)


if __name__ == "__main__":
    main()
