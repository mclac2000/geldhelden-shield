#!/usr/bin/env python3
"""
pruefe-zielgroesse.py — Misst unsere Messung nach.

Anlass (11.09.2026): Marco hat zwei Betrugsprofile aus der Community gemeldet,
die unser Zaehler nicht hatte. Damit steht die Frage im Raum, ob die Zielgroesse
"spaeter auffaellig" ueberhaupt Betrug misst — oder nur ENTDECKUNG.

Das Skript liest nur. Es aendert nichts.
"""
import os
import sqlite3
import sys

DB = os.environ.get("SHIELD_DB", "/root/Geldhelden Shield/data/shield.db")
TAG = 24 * 60 * 60 * 1000
SONDER = (777000, 42777, 136817688, 1087968824, 1271266957, 5434988373)
IMPORTTAG = "2026-08-27"

con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
con.row_factory = sqlite3.Row


def q(sql, args=()):
    return con.execute(sql, args).fetchall()


def titel(text):
    print("")
    print("=" * 78)
    print(text)
    print("=" * 78)


# ---------------------------------------------------------------- 1. Abdeckung
titel("1. ABDECKUNG — welche Gruppen sieht der Bot ueberhaupt nicht?")

zeilen = q("""
    SELECT g.chat_id, g.title, g.status,
           (SELECT COUNT(*) FROM joins j WHERE j.chat_id = g.chat_id) AS joins,
           (SELECT COUNT(*) FROM joins j WHERE j.chat_id = g.chat_id
              AND j.joined_at >= strftime('%s','now','-90 days')*1000) AS joins_90t,
           (SELECT COUNT(*) FROM scam_events s WHERE s.chat_id = g.chat_id) AS scam,
           (SELECT COUNT(*) FROM user_group_activity a WHERE a.group_id = g.chat_id) AS aktive
    FROM groups g WHERE g.status <> 'managed'
    ORDER BY joins DESC
""")
print("%-34s %-10s %8s %9s %6s %8s" % ("Gruppe", "Status", "Joins", "90 Tage", "Scam", "Aktive"))
print("-" * 78)
for z in zeilen:
    print("%-34s %-10s %8d %9d %6d %8d" % (
        (z["title"] or "")[:34], z["status"], z["joins"], z["joins_90t"], z["scam"], z["aktive"]))
summe = sum(z["aktive"] for z in zeilen)
print("")
print("Summe erfasster Mitglieder in NICHT verwalteten Gruppen: %d" % summe)
print("In diesen Gruppen greift KEINE Regel — weder Erstnachricht noch Risiko.")

# ------------------------------------------------------ 2. Die zwei Profile
titel("2. DIE ZWEI GEMELDETEN PROFILE")

suchen = ["Weninger", "Anni", "Anneliese", "Schoen", "Schön"]
gefunden = {}
for begriff in suchen:
    tr = q("""
        SELECT h.user_id, h.username, h.first_name, h.last_name,
               datetime(h.seen_at/1000,'unixepoch') AS gesehen
        FROM user_name_history h
        WHERE h.first_name LIKE ? OR h.last_name LIKE ?
    """, ("%" + begriff + "%", "%" + begriff + "%"))
    for t in tr:
        gefunden[t["user_id"]] = t

if not gefunden:
    print("KEIN Treffer in user_name_history (die Tabelle hat nur %d Zeilen insgesamt)."
          % q("SELECT COUNT(*) c FROM user_name_history")[0]["c"])
    print("")
    print("WICHTIG: users.first_name/last_name/username sind bei ALLEN Konten leer.")
    print("Namen werden im System praktisch nicht gespeichert. Eine Suche nach")
    print("Anzeigenamen ist deshalb strukturell nicht moeglich —")
    print("das ist kein leeres Ergebnis, sondern eine fehlende Datenquelle.")
else:
    for uid, t in gefunden.items():
        print("Kennung %s: %s %s (@%s), gesehen %s" % (
            uid, t["first_name"], t["last_name"], t["username"], t["gesehen"]))

# ------------------------------ 3. Menschliche Meldung vs. eigene Erkennung
titel("3. WER FINDET DIE BETRUEGER — MENSCH ODER BOT?")

gesamt_bl = q("SELECT COUNT(*) c FROM blacklist")[0]["c"]
manuell = q("""SELECT COUNT(*) c FROM blacklist
               WHERE reason LIKE 'Cross-Ban: Manuell gebannt%'""")[0]["c"]
cluster = q("""SELECT COUNT(*) c FROM blacklist
               WHERE reason LIKE '%luster%'""")[0]["c"]
rest = gesamt_bl - manuell - cluster

print("Gebannte Konten insgesamt:                    %5d" % gesamt_bl)
print("  davon durch MENSCHEN gebannt (Cross-Ban):   %5d  (%.1f %%)" % (
    manuell, 100.0 * manuell / gesamt_bl))
print("  davon durch Cluster-Erkennung:              %5d  (%.1f %%)" % (
    cluster, 100.0 * cluster / gesamt_bl))
print("  sonstige Gruende:                           %5d  (%.1f %%)" % (
    rest, 100.0 * rest / gesamt_bl))

# Wie viele der manuell Gebannten hatte der Bot vorher inhaltlich erkannt?
zeile = q("""
    SELECT COUNT(*) AS gesamt,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM scam_events s WHERE s.user_id = b.user_id)
                    THEN 1 ELSE 0 END) AS auch_vom_bot
    FROM blacklist b WHERE b.reason LIKE 'Cross-Ban: Manuell gebannt%'
""")[0]
print("")
print("Von den %d durch Menschen gebannten Konten hatte der Bot" % zeile["gesamt"])
print("vorher %d inhaltlich auffaellig gefunden (%.1f %%)." % (
    zeile["auch_vom_bot"], 100.0 * zeile["auch_vom_bot"] / max(1, zeile["gesamt"])))
print("=> Bei %.1f %% der von Menschen gemeldeten Faelle war der Bot BLIND." % (
    100.0 - 100.0 * zeile["auch_vom_bot"] / max(1, zeile["gesamt"])))

# Und umgekehrt
zeile2 = q("""
    SELECT COUNT(DISTINCT s.user_id) AS bot_erkannt,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM blacklist b WHERE b.user_id = s.user_id)
                    THEN 1 ELSE 0 END) AS auch_gebannt
    FROM (SELECT DISTINCT user_id FROM scam_events) s
""")[0]
print("")
print("Umgekehrt: %d Konten hat der Bot inhaltlich erkannt," % zeile2["bot_erkannt"])
print("davon wurden %d auch gebannt (%.1f %%)." % (
    zeile2["auch_gebannt"], 100.0 * zeile2["auch_gebannt"] / max(1, zeile2["bot_erkannt"])))

# ------------------------------------------- 4. Neu zaehlen, engere Zielgroesse
titel("4. NEU GEZAEHLT — nur MENSCHLICH gemeldete Faelle als Zielgroesse")
print("Begruendung: Wer Mitglieder privat anschreibt, hinterlaesst in der Gruppe")
print("nichts. Der Bot kann das nicht sehen. Nur ein Mensch meldet so jemanden.")
print("Deshalb ist 'von einem Menschen gebannt' die ehrlichere Zielgroesse fuer")
print("die Frage 'wer schreibt unsere Leute an?'.")

basis_sql = """
    WITH joiner AS (
      SELECT j.user_id, MIN(j.joined_at) AS jat
      FROM joins j
      WHERE j.joined_at <= strftime('%s','now','-30 days')*1000
        AND date(j.joined_at/1000,'unixepoch') <> ?
        AND j.user_id > 0
      GROUP BY j.user_id
    )
    SELECT u.has_username AS hu, COUNT(*) AS n,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM blacklist b
            WHERE b.user_id = jo.user_id
              AND b.reason LIKE 'Cross-Ban: Manuell gebannt%') THEN 1 ELSE 0 END) AS mensch,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM scam_events s
            WHERE s.user_id = jo.user_id) THEN 1 ELSE 0 END) AS bot
    FROM joiner jo JOIN users u ON u.user_id = jo.user_id
    WHERE u.user_id NOT IN (777000,42777,136817688,1087968824,1271266957,5434988373)
    GROUP BY u.has_username
"""
print("")
print("%-18s %7s | %9s %8s | %9s %8s" % (
    "", "n", "MENSCH", "Anteil", "BOT", "Anteil"))
print("-" * 74)
for z in q(basis_sql, (IMPORTTAG,)):
    name = "ohne Username" if z["hu"] == 0 else "mit Username"
    print("%-18s %7d | %9d %7.2f%% | %9d %7.2f%%" % (
        name, z["n"], z["mensch"], 100.0 * z["mensch"] / z["n"],
        z["bot"], 100.0 * z["bot"] / z["n"]))

# ------------------------------------------------ 5. Merkmale kombinieren
titel("5. MERKMALE KOMBINIERT — Benutzername x Kontoalter")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try:
    from scripts.kontoalter_py import schaetze_erstellt  # optional
except Exception:
    schaetze_erstellt = None

# Ankertabelle direkt hier, damit das Skript ohne TypeScript laeuft.
ANKER = [
    (2768409, "2013-11-01"), (44634663, "2014-05-06"), (63263518, "2014-10-27"),
    (101260938, "2015-03-06"), (130029930, "2015-09-03"), (148670295, "2016-01-08"),
    (222021233, "2016-06-08"), (297621225, "2016-12-16"), (369669043, "2017-03-31"),
    (400169472, "2017-07-31"), (616816630, "2018-06-22"), (796147074, "2018-11-04"),
    (925078064, "2019-07-16"), (1057704545, "2020-01-30"), (1227964864, "2020-07-30"),
    (1382531194, "2020-09-15"), (1658586909, "2021-02-12"), (1807942741, "2021-07-05"),
    (1974255900, "2021-10-12"), (2138472342, "2021-11-22"), (5031711230, "2021-12-06"),
    (5170390109, "2022-02-15"), (5468950164, "2022-08-15"), (5869978651, "2023-02-15"),
    (6523424924, "2023-08-15"), (6718059849, "2024-02-15"), (7357703634, "2024-08-15"),
    (7964511972, "2025-02-15"), (8189642292, "2025-08-15"), (8354987771, "2025-11-15"),
    (8598220666, "2026-01-31"), (8786937871, "2026-02-28"), (8998028726, "2026-05-31"),
]
import datetime
ANKER_TS = [(i, datetime.datetime.strptime(d, "%Y-%m-%d")
             .replace(tzinfo=datetime.timezone.utc).timestamp() * 1000) for i, d in ANKER]
LUECKE = (2145338053, 5000000000)


def erstellt(uid):
    if uid <= 0 or uid in SONDER:
        return None
    if LUECKE[0] < uid < LUECKE[1]:
        return None
    if uid <= ANKER_TS[0][0]:
        return ANKER_TS[0][1]
    if uid >= ANKER_TS[-1][0]:
        a, b = ANKER_TS[-2], ANKER_TS[-1]
        rate = (b[0] - a[0]) / (b[1] - a[1])
        return min(b[1] + (uid - b[0]) / rate,
                   datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)
    for k in range(1, len(ANKER_TS)):
        a, b = ANKER_TS[k - 1], ANKER_TS[k]
        if a[0] <= uid <= b[0]:
            if a[0] <= LUECKE[0] and b[0] >= LUECKE[1]:
                return a[1] if uid <= LUECKE[0] else b[1]
            anteil = (uid - a[0]) / (b[0] - a[0])
            return a[1] + anteil * (b[1] - a[1])
    return None


rows = q("""
    WITH joiner AS (
      SELECT j.user_id, MIN(j.joined_at) AS jat FROM joins j
      WHERE j.joined_at <= strftime('%s','now','-30 days')*1000
        AND date(j.joined_at/1000,'unixepoch') <> ?
        AND j.user_id > 0
      GROUP BY j.user_id
    )
    SELECT jo.user_id, jo.jat, u.has_username AS hu,
      EXISTS (SELECT 1 FROM blacklist b WHERE b.user_id = jo.user_id
              AND b.reason LIKE 'Cross-Ban: Manuell gebannt%') AS mensch,
      EXISTS (SELECT 1 FROM scam_events s WHERE s.user_id = jo.user_id) AS bot,
      EXISTS (SELECT 1 FROM blacklist b2 WHERE b2.user_id = jo.user_id) AS gebannt
    FROM joiner jo JOIN users u ON u.user_id = jo.user_id
    WHERE u.user_id NOT IN (777000,42777,136817688,1087968824,1271266957,5434988373)
""", (IMPORTTAG,))

eimer = {}
for r in rows:
    c = erstellt(r["user_id"])
    if c is None:
        continue
    alter_jahre = (r["jat"] - c) / TAG / 365.0
    jung = alter_jahre < 1.0
    key = ("ohne Username" if r["hu"] == 0 else "mit Username",
           "juenger 1 Jahr" if jung else "aelter 1 Jahr")
    e = eimer.setdefault(key, {"n": 0, "mensch": 0, "bot": 0, "irgend": 0})
    e["n"] += 1
    e["mensch"] += 1 if r["mensch"] else 0
    e["bot"] += 1 if r["bot"] else 0
    e["irgend"] += 1 if (r["mensch"] or r["bot"] or r["gebannt"]) else 0

print("")
print("%-16s %-16s %6s | %8s %7s | %8s %7s" % (
    "Username", "Kontoalter", "n", "MENSCH", "Anteil", "BOT", "Anteil"))
print("-" * 78)
for key in sorted(eimer):
    e = eimer[key]
    print("%-16s %-16s %6d | %8d %6.2f%% | %8d %6.2f%%" % (
        key[0], key[1], e["n"],
        e["mensch"], 100.0 * e["mensch"] / e["n"],
        e["bot"], 100.0 * e["bot"] / e["n"]))

print("")
print("Zum Vergleich, Grundquoten ueber alle:")
gn = sum(e["n"] for e in eimer.values())
gm = sum(e["mensch"] for e in eimer.values())
gb = sum(e["bot"] for e in eimer.values())
print("  n=%d | von Menschen gebannt %.2f %% | vom Bot erkannt %.2f %%" % (
    gn, 100.0 * gm / gn, 100.0 * gb / gn))

# ------------------------------------------------------- 6. Wolfsburg
titel("6. WOLFSBURG — Beitrittsanfragen bisher?")
try:
    n = q("SELECT COUNT(*) c FROM username_gate_log")[0]["c"]
    print("Eintraege im Protokoll der Zutrittsregel: %d" % n)
    if n:
        for z in q("""SELECT datetime(created_at/1000,'unixepoch') t, user_id,
                             chat_id, hat_username, entscheidung, grund
                      FROM username_gate_log ORDER BY created_at DESC LIMIT 20"""):
            print("  %s  Kennung %s  Gruppe %s  Username=%s  -> %s (%s)" % (
                z["t"], z["user_id"], z["chat_id"],
                "ja" if z["hat_username"] else "nein", z["entscheidung"], z["grund"]))
except sqlite3.Error as e:
    print("Protokolltabelle noch nicht vorhanden: %s" % e)

con.close()
print("")
