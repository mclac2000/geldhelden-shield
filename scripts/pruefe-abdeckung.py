#!/usr/bin/env python3
"""
pruefe-abdeckung.py — Welche Gruppen sieht der Bot wirklich?

Anlass (11.09.2026): Ein gemeldetes Betrugsprofil sass in "Geldhelden Meetup
Muenchen" — einer Gruppe, die in der Datenbank auf 'disabled' steht. Die Frage
ist, ob dort noch Menschen sitzen und ob der Bot ueberhaupt noch hineinsieht.

Liest nur. Aendert nichts.
"""
import datetime
import json
import re
import sqlite3
import urllib.error
import urllib.request

BASIS = "/root/Geldhelden Shield"
DB = BASIS + "/data/shield.db"


def token():
    for zeile in open(BASIS + "/.env", encoding="utf-8"):
        treffer = re.match(r"^BOT_TOKEN=(.*)$", zeile.strip())
        if treffer:
            return treffer.group(1).strip().strip('"').strip("'")
    raise SystemExit("BOT_TOKEN nicht gefunden")


API = "https://api.telegram.org/bot" + token()


def ruf(methode, **p):
    """Ruft die API und liefert IMMER den Antwortkoerper — auch bei HTTP 400."""
    url = API + "/" + methode
    if p:
        url += "?" + "&".join("%s=%s" % (k, v) for k, v in p.items())
    try:
        with urllib.request.urlopen(url, timeout=25) as a:
            return json.loads(a.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "description": "HTTP %s" % e.code}
    except Exception as e:
        return {"ok": False, "description": str(e)[:70]}


me = ruf("getMe")["result"]["id"]
con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row

print("=" * 100)
print("NICHT VERWALTETE GRUPPEN — sitzen dort noch Menschen, und sieht der Bot hinein?")
print("=" * 100)
print("%-34s %8s %8s %-13s %-11s %s" % (
    "Gruppe", "Joins", "Aktive", "Bot-Status", "Mitglieder", "Telegram sagt"))
print("-" * 100)

zeilen = con.execute("""
    SELECT g.chat_id, g.title, g.status,
           (SELECT COUNT(*) FROM joins j WHERE j.chat_id = g.chat_id) AS joins,
           (SELECT COUNT(*) FROM user_group_activity a WHERE a.group_id = g.chat_id) AS aktive
    FROM groups g WHERE g.status <> 'managed' ORDER BY joins DESC
""").fetchall()

for z in zeilen:
    mit = ruf("getChatMember", chat_id=z["chat_id"], user_id=me)
    if mit.get("ok"):
        status = mit["result"]["status"]
        anmerkung = "erreichbar"
    else:
        status = "-"
        anmerkung = (mit.get("description") or "?")[:38]
    anzahl = ruf("getChatMemberCount", chat_id=z["chat_id"])
    zahl = anzahl.get("result") if anzahl.get("ok") else "-"
    print("%-34s %8d %8d %-13s %-11s %s" % (
        (z["title"] or "")[:34], z["joins"], z["aktive"], status, zahl, anmerkung))

print("")
print("LESEHILFE")
print("  'administrator'/'member' + Mitgliederzahl -> die Gruppe LEBT, der Bot ist drin,")
print("     aber status='disabled' schaltet alle Regeln ab. Das ist ein toter Winkel.")
print("  'left'/'kicked' oder 'chat not found' -> der Bot ist raus. Dann ist nur die")
print("     Alt-Datenlage in der Datenbank betroffen, keine laufende Luecke.")

# --- Und: laufen in diesen Gruppen noch Beitritte? -----------------------
print("")
print("=" * 100)
print("BEITRITTE IN NICHT VERWALTETEN GRUPPEN, nach Monat")
print("=" * 100)
zeilen2 = con.execute("""
    SELECT g.title, strftime('%Y-%m', j.joined_at/1000, 'unixepoch') AS monat, COUNT(*) AS n
    FROM joins j JOIN groups g ON g.chat_id = j.chat_id
    WHERE g.status <> 'managed'
    GROUP BY g.title, monat ORDER BY monat DESC, n DESC LIMIT 25
""").fetchall()
for z in zeilen2:
    print("  %-40s %s  %5d" % ((z["title"] or "")[:40], z["monat"], z["n"]))

con.close()
