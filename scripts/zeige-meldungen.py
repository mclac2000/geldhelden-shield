#!/usr/bin/env python3
"""
zeige-meldungen.py — Was ist bei einer echten Meldung tatsaechlich angekommen?

Beantwortet die eine Frage, die ueber den Meldeweg entscheidet:
Liefert Telegram in freier Wildbahn die Felder, die der Test nachgebaut hat?

Ein Meldeweg, der im Test funktioniert und in echt leere Felder bekommt, ist
kein Meldeweg — und das sieht man nur, wenn man die Rohdaten aufhebt.

Zeigt deshalb nebeneinander:
  - was mein Auswerter daraus gemacht hat
  - was Telegram wirklich geschickt hat

Aufruf:  python3 scripts/zeige-meldungen.py [anzahl]
Liest nur.
"""
import json
import sqlite3
import sys
import time

DB = "/root/Geldhelden Shield/data/shield.db"
anzahl = int(sys.argv[1]) if len(sys.argv) > 1 else 10

con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row

spalten = [r[1] for r in con.execute("PRAGMA table_info(meldungen)").fetchall()]
hat_roh = "roh_weiterleitung" in spalten

gesamt = con.execute("SELECT COUNT(*) AS n FROM meldungen").fetchone()["n"]
print("=" * 78)
print("MELDUNGEN — insgesamt %d" % gesamt)
print("=" * 78)

if gesamt == 0:
    print("")
    print("Noch keine Meldung eingegangen.")
    print("")
    print("Das ist kein Fehler: der Weg ist scharf, es hat nur noch niemand")
    print("etwas weitergeleitet. Zum Pruefen genuegt eine beliebige Nachricht,")
    print("im Privatchat an den Bot weitergeleitet.")
    print("")
    print("Rohdatenerfassung aktiv: %s" % ("ja" if hat_roh else "NEIN — dann waere der"
                                           " erste echte Fall nicht beurteilbar"))
    con.close()
    sys.exit(0)

for z in con.execute("SELECT * FROM meldungen ORDER BY created_at DESC LIMIT ?", (anzahl,)):
    print("")
    print("-" * 78)
    print("Meldung %s vom %s" % (
        z["id"], time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(z["created_at"] / 1000))))
    print("-" * 78)
    print("  Gemeldet von : %s (Kennung %s)" % (
        z["melder_username"] and "@" + z["melder_username"] or z["melder_name"] or "?",
        z["melder_id"]))
    print("")
    print("  MEIN AUSWERTER hat daraus gemacht:")
    print("    Herkunft   : %s" % z["herkunft"])
    print("    Kennung    : %s" % (z["gemeldet_id"] if z["gemeldet_id"] else "— keine —"))
    print("    Benutzername: %s" % (z["gemeldet_username"] or "—"))
    print("    Anzeigename: %s" % (z["gemeldet_name"] or "—"))
    print("    Text       : %s" % ((z["text"] or "(kein Text)")[:70]))

    if hat_roh:
        print("")
        print("  TELEGRAM HAT GELIEFERT (roh):")
        print("    Nachrichtenart: %s" % (z["roh_art"] or "?"))
        roh = z["roh_weiterleitung"]
        if not roh:
            print("    KEINE Rohdaten gespeichert.")
        else:
            try:
                d = json.loads(roh)
            except Exception:
                print("    (nicht lesbar) %s" % roh[:200])
                d = {}
            leer = [k for k, v in d.items() if v in (None, "", [], {})]
            gefuellt = {k: v for k, v in d.items() if v not in (None, "", [], {})}
            if not gefuellt:
                print("    ALLE Weiterleitungsfelder LEER.")
                print("    => Das ist der entscheidende Befund: Telegram hat zur")
                print("       Herkunft nichts mitgeliefert. Dann ist die Meldung")
                print("       keinem Konto zuzuordnen — kein Fehler im Code.")
            else:
                for k, v in gefuellt.items():
                    print("    %-22s %s" % (k + ":", json.dumps(v, ensure_ascii=False)[:150]))
                if leer:
                    print("    leer: %s" % ", ".join(leer))

    print("")
    print("  Bearbeitet : %s" % ("ja" if z["bearbeitet"] else "NEIN — wartet auf einen Menschen"))

print("")
print("=" * 78)
print("BEURTEILUNG")
print("=" * 78)
mit_kennung = con.execute(
    "SELECT COUNT(*) AS n FROM meldungen WHERE gemeldet_id IS NOT NULL").fetchone()["n"]
ohne = gesamt - mit_kennung
print("  Meldungen mit zuordenbarem Konto : %d von %d" % (mit_kennung, gesamt))
print("  Meldungen nur mit Anzeigename    : %d" % ohne)
if ohne and not mit_kennung:
    print("")
    print("  ACHTUNG: Bisher war KEINE Meldung einem Konto zuzuordnen.")
    print("  Bei einer einzelnen Meldung kann das die Weiterleitungs-Privatsphaere")
    print("  des Absenders sein. Bleibt es bei mehreren so, lohnt ein Blick in die")
    print("  Rohdaten oben — dort steht, ob Telegram ueberhaupt etwas geschickt hat.")

con.close()
