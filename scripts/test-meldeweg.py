#!/usr/bin/env python3
"""
test-meldeweg.py — Kommt eine Wächter-Meldung wirklich in Telegram an?

Schickt EINE Nachricht in den Admin-Chat und zeigt die Antwort der
Telegram-Schnittstelle im Klartext. Eine Meldung, deren Zustellung man nicht
nachgesehen hat, ist keine Meldung.

Aufruf: python3 scripts/test-meldeweg.py
"""
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BASIS = "/root/Geldhelden Shield"


def env(schluessel):
    for z in open(BASIS + "/.env", encoding="utf-8"):
        t = re.match(r"^%s=(.*)$" % re.escape(schluessel), z.strip())
        if t:
            return t.group(1).strip().strip('"').strip("'")
    return None


TOKEN = env("BOT_TOKEN")
CHAT = env("ADMIN_LOG_CHAT")
print("BOT_TOKEN gesetzt:      %s" % ("ja" if TOKEN else "NEIN"))
print("ADMIN_LOG_CHAT gesetzt: %s" % ("ja" if CHAT else "NEIN"))
if not TOKEN or not CHAT:
    sys.exit("Ohne beides kann der Waechter nichts melden.")

API = "https://api.telegram.org/bot" + TOKEN
text = (
    "[Shield][WAECHTER] Einrichtungstest\n"
    "\n"
    "Ab heute prueft ein Waechter taeglich um 07:15, ob der Bot in jede "
    "verwaltete Gruppe noch hineinsieht.\n"
    "\n"
    "Anlass: die Gruppe \"Geldhelden Meetup Muenchen\" ist dem Bot im Fruehjahr "
    "abhanden gekommen und ein halbes Jahr lang hat es niemand bemerkt.\n"
    "\n"
    "Der Waechter meldet sich ab jetzt NUR noch, wenn etwas fehlt. Diese "
    "Nachricht ist der einmalige Nachweis, dass der Weg funktioniert."
)

url = API + "/sendMessage?" + urllib.parse.urlencode(
    {"chat_id": CHAT, "text": text, "disable_web_page_preview": "true"})
try:
    with urllib.request.urlopen(url, timeout=25) as a:
        antwort = json.loads(a.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    antwort = json.loads(e.read().decode("utf-8"))

if antwort.get("ok"):
    r = antwort["result"]
    print("")
    print("ZUGESTELLT.")
    print("  Chat:       %s (%s)" % (r["chat"].get("title") or r["chat"].get("id"),
                                     r["chat"].get("type")))
    print("  Nachricht:  %s" % r.get("message_id"))
    sys.exit(0)

print("")
print("NICHT ZUGESTELLT: %s" % antwort.get("description"))
sys.exit(1)
