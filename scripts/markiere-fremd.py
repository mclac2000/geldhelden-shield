#!/usr/bin/env python3
"""
markiere-fremd.py — Gruppen kennzeichnen, die der Wächter nicht melden soll.

Zwei Kennzeichen, aus zwei verschiedenen Gründen:

  fremd       Die Gruppe gehört nicht uns. ANLASS (11.09.2026): "Brückentage
              Butzbach" stand in der Liste und hätte als Lücke erscheinen
              können. Eine Liste, die fremde Gruppen mitzählt, erzeugt Alarme,
              die niemand beheben kann — und die deshalb irgendwann alle
              ignorieren. Genau so stirbt eine Überwachung.

  ungeklaert  Die Gruppe gehört uns, aber es ist noch nicht entschieden, was mit
              ihr geschehen soll (Bot draußen, Kennung veraltet, Zugehörigkeit
              unbestätigt). Sie bleibt sichtbar, aber ein Wächter, der täglich
              neun unlösbare Probleme meldet, wird nach einer Woche nicht mehr
              gelesen. Ungeklärte erscheinen deshalb im Bericht, nicht im Alarm.

Beide sind bewusst eigene Spalten und KEIN neuer Status-Wert: `status` hat eine
CHECK-Bedingung, deren Änderung ein Umbauen der Tabelle erfordern würde.

WICHTIG: Diese Kennzeichen setzt ein Mensch. Ob eine Gruppe zu uns gehört,
entscheidet nicht ihr Titel, sondern dass wir sie führen. Der Titel ist ein
Hinweis — siehe scripts/pruefe-fremdverdacht.py, das Verdachtsfälle vorlegt,
aber nichts entscheidet.

Aufruf:
    python3 scripts/markiere-fremd.py --liste
    python3 scripts/markiere-fremd.py <chat_id> [<chat_id> ...]
    python3 scripts/markiere-fremd.py --ungeklaert "Grund" <chat_id> [...]
    python3 scripts/markiere-fremd.py --zurueck <chat_id>
"""
import argparse
import shutil
import sqlite3
import sys
import time

BASIS = "/root/Geldhelden Shield"
DB = BASIS + "/data/shield.db"


def stelle_spalten_sicher(con):
    spalten = [r[1] for r in con.execute("PRAGMA table_info(groups)").fetchall()]
    for name, sql in (
        ("fremd", "ALTER TABLE groups ADD COLUMN fremd INTEGER NOT NULL DEFAULT 0"),
        ("ungeklaert", "ALTER TABLE groups ADD COLUMN ungeklaert INTEGER NOT NULL DEFAULT 0"),
        ("ungeklaert_grund", "ALTER TABLE groups ADD COLUMN ungeklaert_grund TEXT"),
        ("ungeklaert_seit", "ALTER TABLE groups ADD COLUMN ungeklaert_seit INTEGER"),
    ):
        if name not in spalten:
            con.execute(sql)
            con.commit()
            print("Spalte groups.%s ergaenzt" % name)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("chat_ids", nargs="*")
    p.add_argument("--liste", action="store_true")
    p.add_argument("--ungeklaert", metavar="GRUND",
                   help="als ungeklaert kennzeichnen statt als fremd")
    p.add_argument("--zurueck", action="store_true",
                   help="Kennzeichnung wieder entfernen")
    args = p.parse_args()

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    stelle_spalten_sicher(con)

    if args.liste or not args.chat_ids:
        print("")
        print("%-40s %-9s %-6s %-11s %s" % ("Gruppe", "Status", "fremd", "ungeklaert", "Grund"))
        print("-" * 104)
        for r in con.execute("""SELECT chat_id, title, status, fremd, ungeklaert, ungeklaert_grund
                                FROM groups ORDER BY fremd DESC, ungeklaert DESC, status, title"""):
            print("%-40s %-9s %-6s %-11s %s" % (
                (r["title"] or "")[:40], r["status"],
                "JA" if r["fremd"] else "-",
                "JA" if r["ungeklaert"] else "-",
                (r["ungeklaert_grund"] or "")[:38]))
        con.close()
        return

    sicherung = "%s/backups/shield.db.vor-markierung-%s" % (BASIS, time.strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(DB, sicherung)
    print("Sicherung: %s" % sicherung)

    wert = 0 if args.zurueck else 1
    spalte = "ungeklaert" if args.ungeklaert else "fremd"

    for cid in args.chat_ids:
        r = con.execute("SELECT title FROM groups WHERE chat_id = ?", (cid,)).fetchone()
        if not r:
            print("  UNBEKANNT %s" % cid)
            continue
        if args.ungeklaert and not args.zurueck:
            con.execute("""UPDATE groups SET ungeklaert = 1, ungeklaert_grund = ?,
                           ungeklaert_seit = ? WHERE chat_id = ?""",
                        (args.ungeklaert, int(time.time() * 1000), cid))
        elif args.ungeklaert and args.zurueck:
            con.execute("""UPDATE groups SET ungeklaert = 0, ungeklaert_grund = NULL,
                           ungeklaert_seit = NULL WHERE chat_id = ?""", (cid,))
        else:
            con.execute("UPDATE groups SET fremd = ? WHERE chat_id = ?", (wert, cid))
        print("  %s: %s" % (
            ("nicht mehr " if args.zurueck else "") + ("ungeklaert" if args.ungeklaert else "fremd"),
            r["title"]))
    con.commit()

    # Gegenprobe aus der Datenbank, nicht aus der Absicht
    fehler = 0
    for cid in args.chat_ids:
        r = con.execute("SELECT %s AS w FROM groups WHERE chat_id = ?" % spalte, (cid,)).fetchone()
        if r and r["w"] != wert:
            print("  FEHLER: %s steht weiterhin auf %s=%s" % (cid, spalte, r["w"]))
            fehler += 1
    con.close()
    print("")
    print("Gegenprobe %s" % ("bestanden" if fehler == 0 else "FEHLGESCHLAGEN"))
    sys.exit(0 if fehler == 0 else 1)


if __name__ == "__main__":
    main()
