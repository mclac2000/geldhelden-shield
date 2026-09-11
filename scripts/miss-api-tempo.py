#!/usr/bin/env python3
"""
miss-api-tempo.py — Wie lange braucht ein einzelner Telegram-Aufruf?

Gebaut am 11.09.2026, weil der Erreichbarkeits-Waechter minutenlang schwieg und
nicht klar war, ob er haengt oder nur langsam ist. Ein Skript, das minutenlang
nichts sagt, sieht aus wie ein kaputtes Skript — und dann sucht man am falschen
Ende.

Liest nur.
"""
import re
import time
import urllib.error
import urllib.parse
import urllib.request

BASIS = "/root/Geldhelden Shield"


def token():
    for z in open(BASIS + "/.env", encoding="utf-8"):
        t = re.match(r"^BOT_TOKEN=(.*)$", z.strip())
        if t:
            return t.group(1).strip().strip('"').strip("'")
    raise SystemExit("BOT_TOKEN nicht gefunden")


API = "https://api.telegram.org/bot" + token()


def zeit(methode, **p):
    url = API + "/" + methode
    if p:
        url += "?" + urllib.parse.urlencode(p)
    t = time.time()
    try:
        urllib.request.urlopen(url, timeout=10).read()
        return time.time() - t, "ok"
    except urllib.error.HTTPError as e:
        e.read()
        return time.time() - t, "HTTP %s" % e.code
    except Exception as e:
        return time.time() - t, str(e)[:44]


d, s = zeit("getMe")
print("getMe                       %6.2fs  %s" % (d, s))
bot_id = None
try:
    import json
    bot_id = json.load(urllib.request.urlopen(API + "/getMe", timeout=10))["result"]["id"]
except Exception:
    pass

proben = [
    ("erreichbar (Geldhelden Chat)", "-1001661003062"),
    ("erreichbar (Wolfsburg)", "-1003365870767"),
    ("erreichbar (Gemeinschaft)", "-1002854099024"),
    ("UNERREICHBAR (Muenchen)", "-1002599391472"),
]
gesamt = 0.0
for name, cid in proben:
    d, s = zeit("getChatMember", chat_id=cid, user_id=bot_id)
    gesamt += d
    print("%-27s %6.2fs  %s" % (name, d, s))

print("")
erreichbar = [p for p in proben if "UNERREICHBAR" not in p[0]]
print("Hochrechnung fuer 54 erreichbare Gruppen: etwa %.0f Sekunden"
      % (54 * (gesamt / max(1, len(proben)))))
print("Wenn ein einzelner Aufruf unter einer Sekunde bleibt, ist der Waechter")
print("nicht langsam, sondern haengt an den unerreichbaren Chats — die laufen")
print("in den vollen Zeitablauf und werden deshalb uebersprungen.")
