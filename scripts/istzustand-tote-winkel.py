#!/usr/bin/env python3
"""
istzustand-tote-winkel.py — Was genau fehlt je nicht verwalteter Gruppe?

Trennt sauber in:
  A) kann der Server selbst beheben (Bot ist drin und Administrator,
     nur der Status in der Datenbank steht falsch)
  B) braucht einen menschlichen Klick (Bot ist raus oder kein Administrator)

Liest nur. Aendert nichts.
"""
import json
import re
import sqlite3
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
        with urllib.request.urlopen(url, timeout=25) as a:
            return json.loads(a.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "description": "HTTP %s" % e.code}
    except Exception as e:
        return {"ok": False, "description": str(e)[:80]}


bot_id = ruf("getMe")["result"]["id"]
con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row

zeilen = con.execute("""
    SELECT g.chat_id, g.title, g.status,
           (SELECT COUNT(*) FROM joins j WHERE j.chat_id = g.chat_id) AS joins,
           (SELECT COUNT(*) FROM user_group_activity a WHERE a.group_id = g.chat_id) AS erfasst,
           (SELECT datetime(MAX(j.joined_at)/1000,'unixepoch') FROM joins j
             WHERE j.chat_id = g.chat_id) AS letzter_beitritt
    FROM groups g WHERE g.status <> 'managed' ORDER BY erfasst DESC
""").fetchall()

selbst, klick, egal = [], [], []

for z in zeilen:
    mit = ruf("getChatMember", chat_id=z["chat_id"], user_id=bot_id)
    anzahl = ruf("getChatMemberCount", chat_id=z["chat_id"])
    lebend = anzahl.get("result") if anzahl.get("ok") else None

    if not mit.get("ok"):
        grund = mit.get("description") or "?"
        eintrag = (z, "Bot nicht erreichbar: %s" % grund, lebend)
        (klick if z["erfasst"] > 5 else egal).append(eintrag)
        continue

    status = mit["result"].get("status")
    if status == "administrator":
        selbst.append((z, "Bot ist Administrator — nur der Datenbankstatus steht falsch", lebend))
    elif status == "member":
        klick.append((z, "Bot ist Mitglied, aber KEIN Administrator", lebend))
    else:
        eintrag = (z, "Bot ist draussen (%s)" % status, lebend)
        (klick if z["erfasst"] > 5 else egal).append(eintrag)


def block(titel, eintraege):
    print("")
    print("=" * 96)
    print(titel)
    print("=" * 96)
    if not eintraege:
        print("  (keine)")
        return
    for z, grund, lebend in eintraege:
        print("  %-38s  erfasst=%-5d lebend=%-6s letzter Beitritt: %s"
              % ((z["title"] or "")[:38], z["erfasst"],
                 lebend if lebend is not None else "?", z["letzter_beitritt"] or "nie"))
        print("      Kennung %s" % z["chat_id"])
        print("      %s" % grund)


block("A) KANN DER SERVER SELBST BEHEBEN — nur Status auf 'managed' setzen", selbst)
block("B) BRAUCHT EINEN MENSCHLICHEN KLICK", klick)
block("C) UNERHEBLICH (kaum erfasste Mitglieder, keine laufende Luecke)", egal)

print("")
print("=" * 96)
print("ZEILE FUER MARCO — das ist genau das, was ein Mensch tun muss:")
print("=" * 96)
if not klick:
    print("  nichts")
for z, grund, lebend in klick:
    if "kein Administrator" in grund.lower() or "KEIN Administrator" in grund:
        was = "Bot zum Administrator machen (Recht: Nutzer sperren + Nutzer einladen)"
    else:
        was = "Bot wieder in die Gruppe einladen und zum Administrator machen"
    print("  %-40s -> %s" % ((z["title"] or "")[:40], was))

con.close()
