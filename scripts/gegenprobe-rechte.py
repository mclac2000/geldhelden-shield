#!/usr/bin/env python3
"""
gegenprobe-rechte.py — Sagt meine Rechteprüfung dort ja, wo der Bot nachweislich
arbeitet?

Wird immer dann gebraucht, wenn die Prüfung "nein" sagt, obwohl ein Mensch
gerade etwas geklickt hat. Ein "nein" ist dann zuerst ein Verdacht gegen die
Prüfung, nicht gegen den Menschen.

Nimmt die Gruppen mit den meisten belegten Sperr- und Einschränkungsaktionen —
dort MUSS die Antwort ja lauten. Tut sie es nicht, ist die Prüfung kaputt und
jedes andere Ergebnis wertlos.

Liest nur.
"""
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


def darf_sperren(cid):
    m = ruf("getChatMember", chat_id=cid, user_id=BOT_ID)
    if not m.get("ok"):
        return False, m.get("description") or "?"
    r = m["result"]
    if r.get("status") != "administrator":
        return False, "Status '%s'" % r.get("status")
    if not r.get("can_restrict_members"):
        return False, "Administrator ohne Sperrrecht"
    return True, "Administrator mit Sperrrecht"


con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
belegt = con.execute("""
    SELECT a.chat_id, g.title, COUNT(*) AS n
    FROM actions a JOIN groups g ON g.chat_id = a.chat_id
    WHERE a.action IN ('ban','restrict') AND g.status = 'managed'
    GROUP BY a.chat_id ORDER BY n DESC LIMIT 3
""").fetchall()
con.close()

print("GEGENPROBE — Gruppen mit nachweislich ausgeführten Sperren")
print("-" * 84)
alle_ja = True
for zeile in belegt:
    cid, titel, n = zeile
    ok, text = darf_sperren(cid)
    time.sleep(0.4)
    if not ok:
        alle_ja = False
    print("  %-42s %-6s %s   (%d belegte Aktionen)"
          % ((titel or "")[:42], "JA" if ok else "NEIN", text, n))

print("")
if alle_ja:
    print("BESTANDEN: Die Prüfung erkennt einen handlungsfähigen Bot.")
    print("Ein 'nein' an anderer Stelle ist damit ein echtes 'nein'.")
    sys.exit(0)
print("FEHLGESCHLAGEN: Die Prüfung sagt selbst dort nein, wo der Bot nachweislich")
print("gesperrt hat. Dann misst sie das Falsche — kein anderes Ergebnis ist gültig.")
sys.exit(1)
