#!/usr/bin/env python3
"""
miss-drei.py — Die drei Gruppen einzeln nachmessen, nachdem Marco gehandelt hat.

Drei Zustaende, und nur der dritte reicht:
  1 Mitglied ohne Adminrechte
  2 Administrator OHNE Recht "Nutzer sperren"   <- sieht von aussen aus wie in Ordnung
  3 Administrator MIT Sperrrecht                <- handlungsfaehig

Zeigt zusaetzlich die tatsaechliche Mitgliederzahl laut Telegram — die erfassten
Zahlen in unserer Datenbank sind nur ein Ausschnitt dessen, was der Bot in der
Zeit gesehen hat, in der er drin war.

WICHTIG zur Lesart von "chat not found": Das heisst NICHT zwingend, dass die
Kennung veraltet ist. Telegram antwortet so auch dann, wenn der Bot schlicht
kein Mitglied der Gruppe ist. Erst wenn er wieder drin ist und die Kennung
weiterhin nicht geht, ist sie wirklich tot.

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

KANDIDATEN = [
    ("München (bisherige Kennung)", "-1002599391472"),
    ("Bali ALT (Legacy-Kennung)", "-5485552465"),
    ("Bali NEU (verwaltet)", "-1003919092272"),
    ("Gemeinschaft Fettschrift (1218)", "-1003871780718"),
    ("Gemeinschaft verwaltet (1589)", "-1002854099024"),
    ("Neue Freie Welt ALT (534)", "-1003201041806"),
    ("Neue Freie Welt verwaltet (33)", "-1003824357481"),
    ("Freiheit durch Wissen", "-2071848781746"),
]

con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)

print("=" * 108)
print("EINZELMESSUNG — gemessen am %s" % time.strftime("%Y-%m-%d %H:%M:%S"))
print("=" * 108)
print("%-34s %-15s %-11s %-9s %-9s %-9s %s" % (
    "Gruppe", "DB-Status", "Bot-Status", "Admin?", "sperren?", "Mitglied", "Anmerkung"))
print("-" * 108)

for name, cid in KANDIDATEN:
    zeile = con.execute(
        "SELECT status, COALESCE(ungeklaert,0) FROM groups WHERE chat_id = ?", (cid,)
    ).fetchone()
    db_status = ("%s%s" % (zeile[0], "/ungekl" if zeile[1] else "")) if zeile else "nicht in DB"

    mit = ruf("getChatMember", chat_id=cid, user_id=BOT_ID)
    time.sleep(0.4)
    if not mit.get("ok"):
        beschreibung = mit.get("description") or "?"
        print("%-34s %-15s %-11s %-9s %-9s %-9s %s" % (
            name[:34], db_status, "—", "—", "—", "—", beschreibung[:30]))
        continue

    m = mit["result"]
    st = m.get("status")
    ist_admin = st == "administrator"
    darf_sperren = bool(m.get("can_restrict_members")) if ist_admin else False

    anzahl = ruf("getChatMemberCount", chat_id=cid)
    time.sleep(0.4)
    zahl = anzahl.get("result") if anzahl.get("ok") else "?"

    fehlend = []
    if ist_admin:
        for recht, bez in (("can_restrict_members", "sperren"),
                           ("can_delete_messages", "löschen"),
                           ("can_invite_users", "einladen")):
            if not m.get(recht):
                fehlend.append(bez)
    anmerkung = "alles vorhanden" if ist_admin and not fehlend else (
        "fehlt: " + ", ".join(fehlend) if fehlend else "kein Administrator")

    print("%-34s %-15s %-11s %-9s %-9s %-9s %s" % (
        name[:34], db_status, st, "ja" if ist_admin else "NEIN",
        "JA" if darf_sperren else "NEIN", zahl, anmerkung))

con.close()
print("")
print("LESEHILFE")
print("  sperren=NEIN bei Admin=ja -> handlungsunfähig. Von außen sieht das aus")
print("     wie 'alles in Ordnung', der Bot kann aber niemanden entfernen.")
print("  Mitglied = tatsächliche Zahl laut Telegram, nicht unsere erfasste.")
