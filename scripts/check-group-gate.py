#!/usr/bin/env python3
"""
check-group-gate.py — Zustand der Zutritts-Einstellungen je Gruppe.

Beantwortet vor jedem Test die Fragen, die daruber entscheiden, ob der Schalter
"Neue Mitglieder bestaetigen" ueberhaupt das tut, was man erwartet:

  - Ist die Gruppe oeffentlich (@name) oder privat?
    Das ist entscheidend: Laut Telegram-Client-Quellen bedeutet derselbe
    Schalter je nach Gruppentyp etwas anderes.
      privat    -> "Admin muss jeden bestaetigen, der BEITRETEN will"
      oeffentl. -> "Admin muss jeden bestaetigen, der SCHREIBEN will"
    In einer oeffentlichen Gruppe waere es also keine Tuer, sondern ein
    Maulkorb fuer alle Neuen.
  - Steht join_by_request schon an?
  - Hat der Bot can_invite_users? Ohne dieses Recht liefert Telegram gar
    keine chat_join_request-Updates aus.

Aufruf:  python3 scripts/check-group-gate.py [chat_id ...]
Aendert nichts. Reine Abfrage.
"""
import json
import os
import re
import sys
import urllib.request

BASIS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STANDARD_GRUPPEN = [
    "-1003365870767",  # Wolfsburg (Testvorschlag)
    "-1003291528575",  # Osnabrueck (Alternative)
    "-1003647088624",  # Portugal / Algarve (Alternative)
    "-1002504808604",  # Berlin (hat join_by_request bereits an)
]


def lies_token() -> str:
    pfad = os.path.join(BASIS, ".env")
    with open(pfad, "r", encoding="utf-8") as fh:
        for zeile in fh:
            treffer = re.match(r"^BOT_TOKEN=(.*)$", zeile.strip())
            if treffer:
                return treffer.group(1).strip().strip('"').strip("'")
    raise SystemExit("FEHLER: BOT_TOKEN nicht in .env gefunden")


def hole(api: str, methode: str, **params):
    url = api + "/" + methode
    if params:
        url += "?" + "&".join("%s=%s" % (k, v) for k, v in params.items())
    with urllib.request.urlopen(url, timeout=25) as antwort:
        return json.loads(antwort.read().decode("utf-8"))


def main() -> None:
    api = "https://api.telegram.org/bot" + lies_token()

    ich = hole(api, "getMe")
    if not ich.get("ok"):
        raise SystemExit("FEHLER: getMe fehlgeschlagen — Token pruefen")
    bot_id = ich["result"]["id"]
    print("Bot: @%s (Kennung %s)" % (ich["result"].get("username"), bot_id))
    print("")

    gruppen = sys.argv[1:] or STANDARD_GRUPPEN
    kopf = "%-34s %-18s %-12s %-14s %s" % (
        "Gruppe", "oeffentlich?", "Genehmigung", "Schreibsperre", "Bot-Rechte")
    print(kopf)
    print("-" * len(kopf))

    for cid in gruppen:
        chat = hole(api, "getChat", chat_id=cid)
        if not chat.get("ok"):
            print("%-34s ABRUF FEHLGESCHLAGEN: %s" % (cid, chat.get("description")))
            continue
        d = chat["result"]
        mit = hole(api, "getChatMember", chat_id=cid, user_id=bot_id)
        m = mit.get("result", {}) if mit.get("ok") else {}

        username = d.get("username")
        oeffentlich = ("JA (@%s)" % username) if username else "nein (privat)"
        print("%-34s %-18s %-12s %-14s einladen=%s sperren=%s" % (
            (d.get("title") or "")[:34],
            oeffentlich,
            "JA" if d.get("join_by_request") else "nein",
            "JA" if d.get("join_to_send_messages") else "nein",
            m.get("can_invite_users"),
            m.get("can_restrict_members"),
        ))

    print("")
    print("LESEHILFE")
    print("  Genehmigung=JA in einer PRIVATEN Gruppe  -> echte Tuer vor dem Beitritt.")
    print("  Genehmigung=JA in einer OEFFENTLICHEN Gruppe -> betrifft das Schreiben,")
    print("     nicht den Beitritt. Fuer einen Zutrittstest ist das der falsche Schalter.")
    print("  einladen=None -> Recht fehlt: Telegram liefert dann gar keine")
    print("     Beitrittsanfragen an den Bot aus.")


if __name__ == "__main__":
    main()
