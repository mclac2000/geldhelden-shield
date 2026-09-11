#!/usr/bin/env python3
"""
miss-rechte.py — Wo darf der Bot heute tatsächlich etwas?

ANLASS (11.09.2026): Mein Aktivierungsskript hat neun von neun Gruppen
abgelehnt. Marco sagt, der Bot sei Admin. Einer der beiden Stände ist veraltet —
und neun von neun Ablehnungen sind zuerst ein Verdacht gegen die PRÜFUNG, nicht
gegen die Welt.

Deshalb hat dieses Skript eine POSITIVKONTROLLE eingebaut: Es prüft zuerst eine
Gruppe, in der der Bot nachweislich arbeitet (dort hat er schon gesperrt). Sagt
die Prüfung auch dort "nein", ist nicht die Welt leer, sondern die Prüfung
kaputt — und das Skript bricht ab, statt ein falsches Ergebnis zu melden.

Unterschieden werden vier Zustände. Nur der letzte reicht zum Bewachen:
  1  nicht erreichbar    — Telegram findet den Chat nicht (Kennung veraltet
                           oder der Bot war nie drin)
  2  draussen            — left/kicked
  3  Mitglied            — drin, aber keine Adminrechte
  4  Admin ohne Sperrrecht
  5  Admin mit Sperrrecht — BEWACHBAR

Liest nur. Ändert nichts.
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
        with urllib.request.urlopen(url, timeout=25) as a:
            return json.loads(a.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"ok": False, "description": "HTTP %s" % e.code}
    except Exception as e:
        return {"ok": False, "description": str(e)[:80]}


BOT_ID = ruf("getMe")["result"]["id"]


def miss(chat_id):
    """Fragt Telegram und liefert (zustand, darf_sperren, roh, text)."""
    r = ruf("getChatMember", chat_id=chat_id, user_id=BOT_ID)
    if not r.get("ok"):
        return ("nicht erreichbar", False, r, r.get("description") or "?")
    m = r["result"]
    st = m.get("status")
    if st in ("left", "kicked"):
        return ("draussen", False, m, st)
    if st != "administrator":
        return ("Mitglied", False, m, "Status '%s', keine Adminrechte" % st)
    if not m.get("can_restrict_members"):
        return ("Admin ohne Sperrrecht", False, m, "can_restrict_members fehlt")
    fehlend = [n for n in ("can_delete_messages", "can_invite_users")
               if not m.get(n)]
    hinweis = ("alles vorhanden" if not fehlend
               else "sperren ja, aber es fehlt: " + ", ".join(fehlend))
    return ("Admin mit Sperrrecht", True, m, hinweis)


# ----------------------------------------------------- Positivkontrolle
print("=" * 104)
print("POSITIVKONTROLLE — sagt die Prüfung dort ja, wo der Bot nachweislich arbeitet?")
print("=" * 104)

con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row

# Gruppen, in denen der Bot schon einmal wirklich gesperrt hat.
belegt = con.execute("""
    SELECT a.chat_id, g.title, COUNT(*) AS aktionen
    FROM actions a JOIN groups g ON g.chat_id = a.chat_id
    WHERE a.action IN ('ban','restrict') AND g.status = 'managed'
    GROUP BY a.chat_id ORDER BY aktionen DESC LIMIT 3
""").fetchall()

if not belegt:
    print("Keine Gruppe gefunden, in der der Bot nachweislich gesperrt hat —")
    print("Positivkontrolle nicht möglich. Weiter mit Vorbehalt.")
else:
    kontrolle_ok = False
    for k in belegt:
        zustand, darf, _roh, text = miss(k["chat_id"])
        print("  %-40s %-24s sperren=%-5s  (%d Aktionen belegt)  %s"
              % ((k["title"] or "")[:40], zustand, "JA" if darf else "nein",
                 k["aktionen"], text))
        if darf:
            kontrolle_ok = True
    print("")
    if not kontrolle_ok:
        print("ABBRUCH: Die Prüfung sagt selbst dort nein, wo der Bot nachweislich")
        print("gesperrt hat. Dann misst sie das Falsche. Kein Ergebnis gemeldet.")
        con.close()
        sys.exit(2)
    print("Positivkontrolle bestanden — die Prüfung erkennt einen arbeitenden Bot.")

# ----------------------------------------------------- Vollmessung
gemessen_am = time.strftime("%Y-%m-%d %H:%M:%S")
print("")
print("=" * 104)
print("VOLLMESSUNG aller erfassten Gruppen — gemessen am %s" % gemessen_am)
print("=" * 104)
print("%-42s %-9s %-24s %-8s %s" % ("Gruppe", "DB-Status", "gemessener Zustand",
                                    "sperren", "Anmerkung"))
print("-" * 104)

alle = con.execute("SELECT chat_id, title, status FROM groups ORDER BY status, title").fetchall()
con.close()

ergebnis = []
for g in alle:
    zustand, darf, roh, text = miss(g["chat_id"])
    ergebnis.append({
        "chat_id": g["chat_id"], "titel": g["title"] or "", "db": g["status"],
        "zustand": zustand, "darf": darf, "text": text, "gemessen_am": gemessen_am,
    })
    print("%-42s %-9s %-24s %-8s %s" % (
        (g["title"] or "")[:42], g["status"], zustand,
        "JA" if darf else "nein", text[:34]))

# ----------------------------------------------------- Zusammenfassung
print("")
print("=" * 104)
print("ZUSAMMENFASSUNG")
print("=" * 104)
from collections import Counter
z = Counter(e["zustand"] for e in ergebnis)
for name in ("Admin mit Sperrrecht", "Admin ohne Sperrrecht", "Mitglied",
             "draussen", "nicht erreichbar"):
    if z.get(name):
        print("  %-24s %d" % (name, z[name]))
bewachbar = [e for e in ergebnis if e["darf"]]
print("")
print("  BEWACHBAR (Admin mit Sperrrecht): %d von %d" % (len(bewachbar), len(ergebnis)))

nicht_bewachbar_verwaltet = [e for e in ergebnis if e["db"] == "managed" and not e["darf"]]
if nicht_bewachbar_verwaltet:
    print("")
    print("  ALS VERWALTET GEFÜHRT, ABER NICHT BEWACHBAR:")
    for e in nicht_bewachbar_verwaltet:
        print("    %-42s %s — %s" % (e["titel"][:42], e["zustand"], e["text"]))

bewachbar_nicht_verwaltet = [e for e in ergebnis if e["db"] != "managed" and e["darf"]]
if bewachbar_nicht_verwaltet:
    print("")
    print("  BEWACHBAR, ABER NICHT ALS VERWALTET GEFÜHRT (vergessen):")
    for e in bewachbar_nicht_verwaltet:
        print("    %-42s %s" % (e["titel"][:42], e["chat_id"]))

with open("/tmp/rechte-messung.json", "w", encoding="utf-8") as fh:
    json.dump(ergebnis, fh, ensure_ascii=False, indent=1)
print("")
print("Rohdaten: /tmp/rechte-messung.json")
