#!/usr/bin/env python3
"""
erkennungsmerkmale.py — Woran erkennt ein Mensch diese Gruppe in Telegram?

ANLASS (11.09.2026): Zwei Eintraege heissen fuer einen Menschen beide
"Geldhelden Gemeinschaft" — einer davon in mathematischer Fettschrift. Ein Titel
taugt damit nicht zur Unterscheidung. Gebraucht wird etwas Anklickbares.

Reihenfolge der Brauchbarkeit: Einladungslink > oeffentlicher Benutzername >
Kennung > Titel.

Rechnet ausserdem die Mitglieder-Ueberschneidung zur grossen Gruppe aus. Ist sie
hoch, ist der kleinere Eintrag ein Altbestand derselben Gruppe — dann muss
niemand in Telegram nachsehen.

Liest nur.
"""
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

BASIS = "/root/Geldhelden Shield"
DB = BASIS + "/data/shield.db"
GROSSE_GEMEINSCHAFT = "-1002854099024"


def token():
    for z in open(BASIS + "/.env", encoding="utf-8"):
        t = re.match(r"^BOT_TOKEN=(.*)$", z.strip())
        if t:
            return t.group(1).strip().strip('"').strip("'")
    raise SystemExit("BOT_TOKEN nicht gefunden")


API = "https://api.telegram.org/bot" + token()


def ruf(methode, **p):
    url = API + "/" + methode
    if p:
        url += "?" + urllib.parse.urlencode(p)
    try:
        with urllib.request.urlopen(url, timeout=15) as a:
            return json.loads(a.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "description": "HTTP %s" % e.code}
    except Exception as e:
        return {"ok": False, "description": str(e)[:70]}


BOT_ID = ruf("getMe")["result"]["id"]
con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row

ZIELE = [
    ("Gemeinschaft GROSS (laeuft)", "-1002854099024"),
    ("Gemeinschaft Fettschrift (offen)", "-1003871780718"),
    ("Neue Freie Welt (verwaltet, offen)", "-1003824357481"),
    ("Freiheit durch Wissen (offen)", "-2071848781746"),
]

print("=" * 100)
print("ERKENNUNGSMERKMALE — gemessen am %s" % time.strftime("%Y-%m-%d %H:%M"))
print("=" * 100)

for name, cid in ZIELE:
    print("")
    print("=" * 100)
    print("%s" % name)
    print("=" * 100)

    db = con.execute("""SELECT title, status, username,
                        COALESCE(ungeklaert,0) ungekl, COALESCE(fremd,0) fremd,
                        COALESCE(aufgeloest,0) aufgel
                        FROM groups WHERE chat_id = ?""", (cid,)).fetchone()

    chat = ruf("getChat", chat_id=cid)
    time.sleep(0.4)
    erreichbar = chat.get("ok")
    c = chat.get("result", {}) if erreichbar else {}

    mit = ruf("getChatMember", chat_id=cid, user_id=BOT_ID) if erreichbar else {"ok": False}
    time.sleep(0.4)
    bot_status = mit.get("result", {}).get("status") if mit.get("ok") else "nicht drin"

    anz = ruf("getChatMemberCount", chat_id=cid) if erreichbar else {"ok": False}
    time.sleep(0.4)

    print("  Kennung          : %s" % cid)
    print("  Titel (unveraendert, wie in Telegram):")
    print("      %s" % (c.get("title") or (db["title"] if db else "?")))

    benutzername = c.get("username") or (db["username"] if db else None)
    if benutzername:
        print("  Oeffentlich      : @%s" % benutzername)
        print("  ZUM ANKLICKEN    : https://t.me/%s" % benutzername)
    else:
        print("  Oeffentlich      : nein, keiner")

    link = c.get("invite_link")
    if link:
        print("  ZUM ANKLICKEN    : %s" % link)
    elif erreichbar and bot_status == "administrator":
        neu = ruf("exportChatInviteLink", chat_id=cid)
        time.sleep(0.4)
        if neu.get("ok"):
            print("  ZUM ANKLICKEN    : %s" % neu["result"])
        else:
            print("  Einladungslink   : nicht abrufbar (%s)" % (neu.get("description") or "?"))
    else:
        print("  Einladungslink   : KEINER — weder Benutzername noch Link vorhanden")

    print("  Bot ist drin     : %s" % bot_status)
    print("  Mitglieder       : %s" % (anz.get("result") if anz.get("ok") else "nicht abrufbar"))
    if db:
        print("  Bei uns gefuehrt : status=%s%s%s%s" % (
            db["status"],
            ", ungeklaert" if db["ungekl"] else "",
            ", fremd" if db["fremd"] else "",
            ", aufgeloest" if db["aufgel"] else ""))

    # --- Was wir selbst ueber die Gruppe wissen -------------------------
    eig = con.execute("""
        SELECT (SELECT COUNT(*) FROM joins j WHERE j.chat_id = ?) AS joins,
               (SELECT datetime(MAX(j.joined_at)/1000,'unixepoch') FROM joins j
                 WHERE j.chat_id = ?) AS letzter_beitritt,
               (SELECT COUNT(*) FROM user_group_activity a WHERE a.group_id = ?) AS erfasst,
               (SELECT datetime(MAX(a.last_seen_at)/1000,'unixepoch')
                 FROM user_group_activity a WHERE a.group_id = ?) AS letzte_aktivitaet
    """, (cid, cid, cid, cid)).fetchone()
    print("  Unsere Daten     : %s erfasste Mitglieder, %s Beitritte"
          % (eig["erfasst"], eig["joins"]))
    print("                     letzter Beitritt %s, letzte Aktivitaet %s"
          % (eig["letzter_beitritt"] or "nie", eig["letzte_aktivitaet"] or "nie"))

    # --- Ueberschneidung mit der grossen Gruppe --------------------------
    if cid != GROSSE_GEMEINSCHAFT:
        u = con.execute("""
            SELECT
              (SELECT COUNT(*) FROM user_group_activity WHERE group_id = ?) AS hier,
              (SELECT COUNT(*) FROM user_group_activity a
                 JOIN user_group_activity b ON a.user_id = b.user_id
                WHERE a.group_id = ? AND b.group_id = ?) AS gemeinsam
        """, (cid, cid, GROSSE_GEMEINSCHAFT)).fetchone()
        if u["hier"]:
            anteil = 100.0 * u["gemeinsam"] / u["hier"]
            print("  Ueberschneidung mit der grossen Gemeinschaft: %d von %d (%.1f %%)"
                  % (u["gemeinsam"], u["hier"], anteil))
            if anteil >= 60:
                print("      => Hohe Ueberschneidung: sehr wahrscheinlich derselbe")
                print("         Personenkreis, also ein Altbestand. Niemand muss nachsehen.")
            elif u["gemeinsam"] == 0:
                print("      => KEINE Ueberschneidung: ein anderer Personenkreis.")
                print("         Das ist eine eigene Gruppe, kein Altbestand.")

con.close()
print("")
