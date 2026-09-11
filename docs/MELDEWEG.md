# Der Meldeweg

**Seit 11.09.2026.** Ein Mitglied leitet dem Bot eine private Betrugsnachricht
weiter — das ist die ganze Bedienung.

---

## Warum das der wichtigste Teil des Systems ist

| | |
|---|---|
| gesperrte Konten insgesamt | 477 |
| davon auf eine **menschliche** Entscheidung zurückgehend | **441 (92,5 %)** |
| davon hatte der Bot vorher erkannt | **38** |

> **In 91,4 % der von Menschen gemeldeten Fälle war der Bot blind.**

Der Grund ist strukturell und durch keine Regel zu beheben: **Der Bot sieht
Inhalte in Gruppen. Die Täter schreiben privat.** Eine Privatnachricht zwischen
zwei Menschen bekommt ein Bot nie zu sehen — nicht wegen einer Lücke, sondern
weil Telegram das so gebaut hat und gut daran tut.

Deshalb ist jede Zutrittsregel Kosmetik, solange dieser Weg fehlt. Man kann die
Tür beliebig verschärfen; wer hereinkommt und dann privat schreibt, ist
unsichtbar. Der einzige Hebel ist, dass ein Mitglied mit einem Handgriff sagen
kann: *„Der hier hat mich angeschrieben."*

---

## Die Bedienung

Im Privatchat mit dem Bot:

> Lange auf die Nachricht tippen → **„Weiterleiten"** → den Bot auswählen.

Kein Formular, keine Felder, keine Rückfragen. Was drei Schritte braucht,
benutzt niemand — und dann messen wir wieder nur unsere eigene Blindheit.

Das Mitglied bekommt sofort eine Bestätigung. Wer keine Rückmeldung bekommt,
meldet kein zweites Mal.

Wer dem Bot einfach so schreibt, bekommt in einem Satz erklärt, wie es geht.
Ein Doppelklick innerhalb von zehn Minuten erzeugt keinen zweiten Eintrag.

---

## Was ausdrücklich NICHT passiert

**Es wird niemand automatisch gesperrt.** Kein Automatismus, keine Schwelle,
kein Punktesystem.

Eine Meldung ist die Behauptung eines Menschen über einen anderen Menschen. Sie
gehört einem Admin vorgelegt, nicht sofort vollstreckt. Erst Sichtbarkeit, dann
Automatik — umgekehrt sperrt der Bot Unschuldige, und das kostet Mitglieder
statt Betrüger.

Wer später eine Automatik will, hat dann Daten dafür. Heute hätten wir nur eine
Vermutung.

---

## Der Grenzfall, der oft eintritt

Wer die **Weiterleitungs-Privatsphäre** aktiviert hat, erscheint beim
Weiterleiten nur mit Anzeigenamen — Telegram liefert dann **keine Kennung**.
Das ist bei Telegram Premium üblich, und Betrüger nutzen es.

Solche Meldungen werden trotzdem gespeichert, aber sie sind **keinem Konto
zuzuordnen**. Die Admin-Meldung sagt das ausdrücklich, damit niemand annimmt,
der Bot könne hier von sich aus etwas tun.

Beide von Marco am 11.09.2026 gemeldeten Profile wären vermutlich genau dieser
Fall gewesen.

| `herkunft` | Bedeutung |
|---|---|
| `kennung` | Konto eindeutig bestimmbar |
| `nur_name` | Weiterleitungs-Privatsphäre aktiv, nur Anzeigename |
| `kanal` | aus einem Kanal weitergeleitet |
| `unbekannt` | keine Herkunft erkennbar |

---

## Was gespeichert wird

Tabelle `meldungen`: Zeitpunkt, wer gemeldet hat, wer gemeldet wurde (Kennung,
Benutzername, Anzeigename, soweit vorhanden), die Art der Herkunft, der
Nachrichtentext, das Datum der Originalnachricht, ein `bearbeitet`-Kennzeichen
und ein Notizfeld.

```sql
-- Offene Meldungen
SELECT datetime(created_at/1000,'unixepoch') AS zeit,
       melder_username, gemeldet_id, gemeldet_username, gemeldet_name,
       herkunft, substr(text,1,80) AS anfang
FROM meldungen WHERE bearbeitet = 0 ORDER BY created_at DESC;

-- Wer wurde mehrfach gemeldet?
SELECT gemeldet_id, gemeldet_name, COUNT(*) AS meldungen,
       COUNT(DISTINCT melder_id) AS verschiedene_melder
FROM meldungen WHERE gemeldet_id IS NOT NULL
GROUP BY gemeldet_id HAVING meldungen > 1 ORDER BY meldungen DESC;

-- Wie viel sehen wir jetzt, das wir vorher nicht gesehen haben?
SELECT COUNT(*) AS meldungen,
       SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM scam_events s
             WHERE s.user_id = m.gemeldet_id) THEN 1 ELSE 0 END) AS davon_vom_bot_nie_erkannt
FROM meldungen m WHERE m.gemeldet_id IS NOT NULL;
```

Die letzte Abfrage ist die interessante: Sie misst in ein paar Wochen, wie groß
der blinde Fleck wirklich war.

---

## Bekannte Reibung

**Das Mitglied muss den Bot einmal gestartet haben**, bevor es ihm etwas
weiterleiten kann — so funktioniert Telegram. Beim ersten `/start` erklärt der
Bot in zwei Zeilen, wozu er da ist.

Das ist die einzige Hürde, und sie ist nicht wegzuprogrammieren. Sie ließe sich
senken, indem die Begrüßungsnachricht in den Gruppen den Weg erwähnt —
**noch nicht gemacht, bewusst nicht ungefragt.**

---

## Prüfen

```bash
docker exec geldhelden-shield-bot npx tsx scripts/test-meldeweg-ende-zu-ende.ts
```

Spielt beide Fälle durch (Absender sichtbar / Privatsphäre aktiv), prüft Eintrag,
Bestätigung und Admin-Meldung — und stellt dabei **echt** nach Telegram zu.
Räumt seine Testeinträge danach weg.
