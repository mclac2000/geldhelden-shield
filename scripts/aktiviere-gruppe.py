#!/usr/bin/env python3
"""
aktiviere-gruppe.py — Setzt eine Gruppe auf 'managed', aber nur wenn es auch
wirklich etwas nuetzt.

Das Skript weigert sich, wenn der Bot in der Gruppe nicht erreichbar oder kein
Administrator mit Sperrrecht ist. Eine Gruppe auf 'managed' zu setzen, in der
der Bot nichts darf, sieht im Datenbestand nach Schutz aus und ist keiner —
genau diese Art stiller Fehler soll hier nicht entstehen.

Aufruf:
    python3 scripts/aktiviere-gruppe.py <chat_id> [<chat_id> ...]
    python3 scripts/aktiviere-gruppe.py --alle-bereiten
        aktiviert alle Gruppen, in denen der Bot bereits Administrator ist

Legt vor jeder Aenderung eine Sicherung der Datenbank an.
"""
import argparse
import json
import re
import shutil
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


def pruefe_bereit(chat_id, bot_id):
    """(bereit, begruendung)"""
    mit = ruf("getChatMember", chat_id=chat_id, user_id=bot_id)
    if not mit.get("ok"):
        return False, "nicht erreichbar: %s" % (mit.get("description") or "?")
    st = mit["result"].get("status")
    if st != "administrator":
        return False, "Bot ist '%s', kein Administrator" % st
    if not mit["result"].get("can_restrict_members"):
        return False, "Administrator, aber ohne Recht 'Nutzer sperren'"
    if not mit["result"].get("can_delete_messages"):
        return False, "Administrator, aber ohne Recht 'Nachrichten loeschen'"
    return True, "Administrator mit Sperr- und Loeschrecht"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("chat_ids", nargs="*")
    p.add_argument("--alle-bereiten", action="store_true")
    p.add_argument("--trockenlauf", action="store_true",
                   help="nur pruefen, nichts schreiben")
    args = p.parse_args()

    bot_id = ruf("getMe")["result"]["id"]

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    if args.alle_bereiten:
        ziele = [r["chat_id"] for r in con.execute(
            "SELECT chat_id FROM groups WHERE status <> 'managed'").fetchall()]
    else:
        ziele = args.chat_ids
    if not ziele:
        con.close()
        raise SystemExit("Keine Gruppe angegeben. --alle-bereiten oder chat_id.")

    aendern = []
    for cid in ziele:
        zeile = con.execute(
            "SELECT chat_id, title, status FROM groups WHERE chat_id = ?", (cid,)).fetchone()
        if not zeile:
            print("  UNBEKANNT  %s — steht nicht in der Datenbank" % cid)
            continue
        if zeile["status"] == "managed":
            print("  SCHON AN   %-40s" % (zeile["title"] or cid)[:40])
            continue
        bereit, grund = pruefe_bereit(cid, bot_id)
        if bereit:
            print("  BEREIT     %-40s %s" % ((zeile["title"] or cid)[:40], grund))
            aendern.append((cid, zeile["title"]))
        else:
            print("  NICHT      %-40s %s" % ((zeile["title"] or cid)[:40], grund))

    if not aendern:
        print("")
        print("Nichts zu tun — keine Gruppe ist bereit.")
        con.close()
        sys.exit(0)

    if args.trockenlauf:
        print("")
        print("Trockenlauf: %d Gruppe(n) waeren aktiviert worden." % len(aendern))
        con.close()
        sys.exit(0)

    sicherung = "%s/backups/shield.db.vor-aktivierung-%s" % (
        BASIS, time.strftime("%Y%m%d-%H%M%S"))
    shutil.copy2(DB, sicherung)
    print("")
    print("Sicherung: %s" % sicherung)

    jetzt = int(time.time() * 1000)
    for cid, titel in aendern:
        con.execute("UPDATE groups SET status = 'managed', updated_at = ? WHERE chat_id = ?",
                    (jetzt, cid))
        print("  aktiviert: %s" % (titel or cid))
    con.commit()

    # Gegenprobe aus der Datenbank, nicht aus der Absicht
    for cid, titel in aendern:
        neu = con.execute("SELECT status FROM groups WHERE chat_id = ?", (cid,)).fetchone()
        if neu["status"] != "managed":
            print("  FEHLER: %s steht weiterhin auf '%s'" % (cid, neu["status"]))
            sys.exit(1)
    print("")
    print("Gegenprobe bestanden: %d Gruppe(n) stehen jetzt auf 'managed'." % len(aendern))
    print("Der Bot muss neu gestartet werden, damit er sie uebernimmt:")
    print("  cd \"%s\" && docker compose up -d" % BASIS)
    con.close()


if __name__ == "__main__":
    main()
