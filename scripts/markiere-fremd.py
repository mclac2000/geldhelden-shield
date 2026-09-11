#!/usr/bin/env python3
"""
markiere-fremd.py — Fremde Gruppen dauerhaft aus der Bewachung nehmen.

ANLASS (11.09.2026): "Brückentage Butzbach" ist nicht unsere Gruppe. Sie stand
trotzdem in der Liste und hätte im Wächterbericht als Lücke erscheinen können.

Eine Liste, die fremde Gruppen mitzählt, erzeugt Alarme, die niemand beheben
kann — und die deshalb irgendwann alle ignorieren. Genau so stirbt eine
Überwachung.

Setzt eine neue Spalte `fremd`. Bewusst KEIN neuer Status-Wert: die Spalte
`status` hat eine CHECK-Bedingung, deren Änderung ein Umbauen der Tabelle
erfordern würde — für eine Kennzeichnung ist das zu viel Eingriff.

Aufruf:
    python3 scripts/markiere-fremd.py --liste
    python3 scripts/markiere-fremd.py <chat_id> [<chat_id> ...]
    python3 scripts/markiere-fremd.py --zurueck <chat_id>
"""
import argparse
import shutil
import sqlite3
import sys
import time

BASIS = "/root/Geldhelden Shield"
DB = BASIS + "/data/shield.db"


def stelle_spalte_sicher(con):
    spalten = [r[1] for r in con.execute("PRAGMA table_info(groups)").fetchall()]
    if "fremd" not in spalten:
        con.execute("ALTER TABLE groups ADD COLUMN fremd INTEGER NOT NULL DEFAULT 0")
        con.commit()
        print("Spalte groups.fremd ergaenzt")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("chat_ids", nargs="*")
    p.add_argument("--liste", action="store_true")
    p.add_argument("--zurueck", action="store_true",
                   help="Kennzeichnung wieder entfernen")
    args = p.parse_args()

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    stelle_spalte_sicher(con)

    if args.liste or not args.chat_ids:
        print("")
        print("%-44s %-9s %-6s %s" % ("Gruppe", "Status", "fremd", "Kennung"))
        print("-" * 92)
        for r in con.execute(
                "SELECT chat_id, title, status, fremd FROM groups ORDER BY fremd DESC, status, title"):
            print("%-44s %-9s %-6s %s" % (
                (r["title"] or "")[:44], r["status"],
                "JA" if r["fremd"] else "-", r["chat_id"]))
        con.close()
        return

    sicherung = "%s/backups/shield.db.vor-fremd-%s" % (BASIS, time.strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(DB, sicherung)
    print("Sicherung: %s" % sicherung)

    wert = 0 if args.zurueck else 1
    for cid in args.chat_ids:
        r = con.execute("SELECT title, status FROM groups WHERE chat_id = ?", (cid,)).fetchone()
        if not r:
            print("  UNBEKANNT %s" % cid)
            continue
        con.execute("UPDATE groups SET fremd = ? WHERE chat_id = ?", (wert, cid))
        print("  %s: %s" % ("nicht mehr fremd" if args.zurueck else "als fremd markiert",
                            r["title"]))
    con.commit()

    # Gegenprobe aus der Datenbank
    fehler = 0
    for cid in args.chat_ids:
        r = con.execute("SELECT fremd FROM groups WHERE chat_id = ?", (cid,)).fetchone()
        if r and r["fremd"] != wert:
            print("  FEHLER: %s steht weiterhin auf fremd=%s" % (cid, r["fremd"]))
            fehler += 1
    con.close()
    print("")
    print("Gegenprobe %s" % ("bestanden" if fehler == 0 else "FEHLGESCHLAGEN"))
    sys.exit(0 if fehler == 0 else 1)


if __name__ == "__main__":
    main()
