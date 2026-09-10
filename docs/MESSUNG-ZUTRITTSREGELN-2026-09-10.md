# Zutrittsregeln: was gemessen wurde und was daraus folgt

**Datum:** 10.09.2026 · **Anlass:** Häufung von Profilen ohne Benutzernamen und ohne
sichtbare Telefonnummer, dazu mehrere Betrugsmeldungen von Mitgliedern, die
angeschrieben wurden.

> **Wenn jemand in ein paar Monaten wieder vorschlägt, Konten ohne Benutzernamen
> auszusperren: bitte zuerst diese Seite lesen. Die Regel wurde gemessen. Sie wirkt nicht.**

---

## Das Ergebnis in zwei Zahlen

Grundlage: 4.110 Beitritte, die mindestens 30 Tage zurückliegen (damit eine spätere
Auffälligkeit überhaupt Zeit hatte zu entstehen). Der Importtag 27.08.2026 mit
1.318 Einträgen in einer Minute ist ausgeschlossen.

| Beitretende | Anzahl | später auffällig | Anteil |
|---|---|---|---|
| **ohne** Benutzernamen | 2.319 | 566 | **24,41 %** |
| **mit** Benutzernamen | 1.713 | 409 | **23,88 %** |

**Kein Unterschied.** Wer keinen Benutzernamen hat, wird nicht häufiger auffällig
als alle anderen.

Bei den Konten, die ein Mensch von Hand gebannt hat (Cross-Ban aus einer Gruppe
heraus), zeigt das Merkmal sogar **in die Gegenrichtung**:

| Beitretende | Anzahl | manuell gebannt | Anteil |
|---|---|---|---|
| **ohne** Benutzernamen | 2.397 | 145 | **6,05 %** |
| **mit** Benutzernamen | 1.713 | 158 | **9,22 %** |

Zum Vergleich von der anderen Seite: Unter den vom Bot erkannten Betrugsfällen der
letzten 90 Tage haben 72,8 % keinen Benutzernamen — unter **allen** Mitgliedern
sind es 71,3 %. Betrüger sehen in diesem Merkmal aus wie alle anderen.

**Was die Regel gekostet hätte:** In den 14 Tagen vor der Messung gab es 334
Beitritte, davon 184 ohne Benutzernamen — **55,1 %**. Die Regel hätte also mehr als
jeden zweiten Neuzugang abgewiesen und die Betrugsquote nicht gesenkt.

---

## Was technisch überhaupt prüfbar ist

Geprüft an der offiziellen Dokumentation, **Bot API 10.3 (24.08.2026)**.

**Die Telefonnummer ist für einen Bot nicht sichtbar.** Das `User`-Objekt hat kein
solches Feld. Für fremde Nutzer gibt es ausschließlich: `id`, `is_bot`,
`first_name`, `last_name`, `username`, `language_code`, `is_premium`,
`added_to_attachment_menu`. Auch `SharedUser` (der „Nutzer teilen"-Knopf) enthält
keine Nummer. Ein Bot bekommt eine Telefonnummer nur, wenn der Nutzer sie aktiv
über einen `request_contact`-Knopf im Privatchat sendet.

**Der ursprüngliche Wunsch „Benutzername ODER Telefonnummer" ist damit nicht
umsetzbar.** Übrig bleibt allein der Benutzername — und der trennt nicht.

---

## Zwei Wege hinein, und nur einer ist sauber

| | Anzahl Gruppen | Beitritte in 14 Tagen |
|---|---|---|
| **mit** Genehmigungspflicht (`join_by_request`) — Ablehnung vor dem Eintritt möglich | **3** | **0** |
| **ohne** Genehmigungspflicht — nur nachträgliches Entfernen möglich | **51** | **334** |

Die drei Gruppen mit Genehmigungspflicht sind Berlin, Aarau und Gützkow. Dort fand
in 14 Tagen kein einziger Beitritt statt.

**Der saubere Weg deckt 0 % des echten Zulaufs ab.** Jede Zutrittsregel wäre heute
in der Praxis „erst hereinlassen, dann wieder hinauswerfen" — sichtbar für alle
Anwesenden. Deshalb entfernt `src/usernameGate.ts` bewusst niemanden nachträglich.

Nebenbei: Es sind **54 aktive Gruppen, nicht 62** (dazu 9 stillgelegte).

---

## Der Hinweis an den Abgewiesenen kommt meistens nicht an

- `declineChatJoinRequest` nimmt nur `chat_id` und `user_id` — **eine Begründung
  lässt sich nicht mitschicken.**
- Das einzige Zeitfenster für eine Privatnachricht an einen Fremden ist das Feld
  `user_chat_id` einer Beitrittsanfrage: gültig „for 5 minutes", solange die
  Anfrage noch nicht bearbeitet ist. Deshalb schickt der Code **erst** den
  Hinweis und lehnt **danach** ab. Diese Reihenfolge ist kein Stilfrage.
- In den 51 Gruppen ohne Genehmigungspflicht gibt es **gar keinen Weg**: ein Bot
  darf niemanden anschreiben, der ihn nie gestartet hat, und eine Nachricht in
  die Gruppe sieht der Entfernte nicht mehr.

---

## Was stattdessen wirkt: das Kontoalter

Dasselbe Messverfahren, angewandt auf das geschätzte Kontoalter zum
Beitrittszeitpunkt:

| Kontoalter beim Beitritt | Anzahl | später auffällig | Anteil |
|---|---|---|---|
| unter 3 Monate | 554 | 226 | 40,8 % |
| 3–6 Monate | 457 | 188 | 41,1 % |
| 6–12 Monate | 291 | 123 | 42,3 % |
| 1–2 Jahre | 865 | 196 | 22,7 % |
| 2–5 Jahre | 783 | 139 | 17,8 % |
| **über 5 Jahre** | 1.160 | 105 | **9,1 %** |

Grundquote: 23,8 %. Der Unterschied zwischen jüngsten und ältesten Konten ist
**mehr als das Vierfache** — das Merkmal trennt also wirklich, anders als der
Benutzername.

**Aber es taugt nicht als Türsteher.** Bei einer Schwelle von einem Jahr wären
1.302 Menschen betroffen, davon 537 später auffällig — **59 % der Abgewiesenen
wären unbescholten**. Als Risikopunkt neben anderen Faktoren ist das Merkmal
sinnvoll, als Alleinkriterium nicht.

### Warum das Merkmal vorher blind war

Die alte Schätzung in `risk.ts` rechnete „~100.000 Kennungen pro Tag seit 2020".
Bei heutigen Kennungen (~9 Milliarden) ergab das ein Datum Jahrhunderte in der
Zukunft, das auf „heute" gekappt wurde: **jedes moderne Konto galt als 0 Tage alt.**
Genau deshalb stand `RISK_ACCOUNT_AGE_BONUS` auf 0 — der Faktor wäre ein
Massen-Fehlalarm gewesen.

Die Korrektur liegt in `src/accountAge.ts`. Prüfung an 7.560 Konten gegen die
Regel „ein Konto kann nicht nach seiner Erstsichtung angelegt worden sein":

| | unmögliche Werte | im Schnitt daneben |
|---|---|---|
| alte Schätzung | **79,2 %** (5.989) | 123 Tage |
| neue Schätzung | **0,3 %** (19) | 7 Tage |

**Die Reparatur ändert am Live-Verhalten nichts**, weil der Bonus weiterhin auf 0
steht. Das Einschalten ist eine eigene Entscheidung, keine Nebenwirkung.

### Grenzen der Alters-Schätzung — vor dem Setzen einer Schwelle lesen

Telegram vergibt Kennungen **nicht streng der Reihe nach**. Gemessen an
öffentlichen Anmeldedaten sind rund 5,7 % aller Paare invertiert; die größte
beobachtete Rückläufigkeit beträgt etwa 582 Millionen Kennungen. Realistische
Genauigkeit: **±2–3 Monate** (2022 bis heute), ±9–12 Monate für 2017–2021,
±6 Monate für 2026 (Extrapolation).

**Eine Schwelle wie „jünger als 7 Tage" ist aus der Kennung nicht entscheidbar.**
Der aktuell eingetragene Wert `RISK_ACCOUNT_AGE_THRESHOLD=7` ist deshalb sinnlos,
sobald der Bonus eingeschaltet wird — der Bot warnt beim Start davor. Sinnvoll
sind Werte ab 365.

---

## Stand der Erstnachrichten-Prüfung

Scharf seit 05.09.2026 (`FIRST_MESSAGE_ARMED_AT`), mit Auto-Sperre.

| Quelle | geprüft | würden gesperrt | nur Alarm |
|---|---|---|---|
| echte Nachrichten seit Erfassungsbeginn | 161 (92 Konten) | **0** | **0** |
| Bios echter Mitglieder (Ersatzstichprobe, ungünstigster Fall) | 36 | **0** | **0** |
| bekannte Betrüger (Positivkontrolle, über die Bio) | 6 | **4** | 2 |

**Lesart:** Die Regel schlägt bei echtem Menschentext nicht an — keine Fehlalarme
in 161 echten Nachrichten und 36 Bios. Sie kann auslösen, wie die Positivkontrolle
zeigt. In fünf Tagen Echtbetrieb ist sie schlicht nie gebraucht worden.

**Einschränkung, die dazugehört:** Die Positivkontrolle prüft an genau den Fällen,
für die die Regel vermutlich entworfen wurde. Sie belegt, dass die Regel feuern
*kann* — nicht, dass sie neue, andersartige Betrugsmuster erkennt. Und 161
Nachrichten sind eine dünne Grundlage. Vor dem 05.09.2026 hat Shield nirgends
Nachrichtentext gespeichert; eine rückwirkende Messung an echten Nachrichten ist
deshalb unmöglich.

---

## Genehmigungspflicht: was ein Bot kann und was nicht

**Ein Bot kann die Genehmigungspflicht nicht einschalten.** Es gibt im Bot API keine
Methode dafür — `join_by_request` ist dort ausschließlich *lesbar* (über `getChat`).
Geschrieben wird die Einstellung nur über die Nutzer-Schnittstelle, also **von einem
Menschen in der Telegram-App**. Alle acht `setChat*`-Methoden der Bot-API
(`setChatTitle`, `setChatDescription`, `setChatPhoto`, `setChatPermissions`,
`setChatStickerSet`, `setChatAdministratorCustomTitle`, `setChatMemberTag`,
`setChatMenuButton`) können es nicht.

**Und der Schalter bedeutet je nach Gruppentyp etwas anderes** — das ist die Falle:

| Gruppentyp | „Neue Mitglieder bestätigen" bedeutet |
|---|---|
| **privat** (nur Einladungslink) | Admin genehmigt jeden, der **beitreten** will → echte Tür |
| **öffentlich** (@Benutzername) | Admin genehmigt jeden, der **schreiben** will → kein Zutrittsschutz |

Stand 10.09.2026, direkt abgefragt:

| Gruppe | öffentlich? | Genehmigung | Bot-Rechte |
|---|---|---|---|
| Meetup Wolfsburg | **nein (privat)** | nein | einladen ✓, sperren ✓ |
| Meetup Osnabrück | nein (privat) | nein | einladen ✓, sperren ✓ |
| Meetup Portugal/Algarve | nein (privat) | nein | einladen ✓, sperren ✓ |
| MeetUp Berlin | **JA (@ghberlin)** | JA | einladen ✓, sperren ✓ |

**Berlin ist öffentlich.** Die dort aktive Genehmigungspflicht ist also die
Schreib-Variante, keine Tür vor dem Beitritt. Von den drei „Genehmigungsgruppen"
ist damit mindestens eine keine echte Zutrittskontrolle.

Prüfen lässt sich das jederzeit:

```bash
python3 scripts/check-group-gate.py            # Standardgruppen
python3 scripts/check-group-gate.py -100123…   # beliebige Gruppen
```

Zwei weitere Punkte aus der Doku, die man vorher wissen sollte:

- Der Bot bekommt Beitrittsanfragen **nur** mit dem Adminrecht „Nutzer einladen"
  (`can_invite_users`) — und nur, wenn `chat_join_request` in `allowed_updates`
  steht. Beides ist erfüllt.
- Es gibt zwei getrennte Ebenen: ein **einzelner Einladungslink** kann per
  `createChatInviteLink(creates_join_request=true)` genehmigungspflichtig gemacht
  werden — das **kann** der Bot selbst. Das wirkt aber nur für diesen einen Link;
  wer die Gruppe anders findet, geht daran vorbei. Die gruppenweite Einstellung
  kann nur ein Mensch setzen.

---

## Datenschwächen, die beim Messen gefunden wurden

Zwei davon hätten die Zahlen fast verfälscht:

1. **1.734 Konten haben nie eine Profilabfrage bekommen.** Ihr Kennzeichen
   „hat Benutzernamen" steht auf dem Standardwert 0 — ununterscheidbar von einem
   echten „kein Benutzername". *Geprüft:* Alle 334 Beitritte der letzten 14 Tage
   haben erhobene Daten; die Kreuztabellen wurden zusätzlich auf erhobene Daten
   eingeschränkt, das Ergebnis blieb gleich.
2. **Am 27.08.2026 wurden 1.318 „Beitritte" innerhalb einer Minute eingetragen** —
   ein Import, kein Zulauf. Aus allen Messungen ausgeschlossen.
3. **Die Spalten `users.username`, `first_name`, `last_name` sind bei allen 7.587
   Konten leer.** Tote Spalten; nur die Ja/Nein-Kennzeichen werden gepflegt.
4. **27 Einträge in `users` haben negative Kennungen, einer ist eine reservierte
   Telegram-Dienstkennung.** Das sind keine Menschen: negative Kennungen entstehen
   durch Beiträge im Namen eines Kanals oder durch anonyme Admins, `777000` ist
   Telegrams eigener Dienstabsender für Anmeldecodes.

   **Jede Messung, die sie nicht herausfiltert, ist verzerrt** — sie zählt
   Kanalbeiträge wie Mitglieder. `src/accountAge.ts` liefert für sie bewusst
   `null`. In SQL gehört in jede Auswertung:

   ```sql
   WHERE user_id > 0
     AND user_id NOT IN (777000, 42777, 136817688, 1087968824, 1271266957, 5434988373)
   ```

   Die Liste stammt aus `core.telegram.org/api/peers` (Service Notifications,
   Telegram Support, Channel_Bot, GroupAnonymousBot, Replies Bot, Anti-Spam Bot).
5. Das Kennzeichen spiegelt den **heutigen** Zustand, nicht den zum
   Beitrittszeitpunkt. Wer später einen Benutzernamen angelegt hat, zählt als
   „mit". Das schönt das Ergebnis **zugunsten** der Regel — und selbst so zeigt sie
   keine Wirkung.

---

## Wie man die Regel ein- und ausschaltet

```bash
# In der .env auf dem Server:
USERNAME_GATE_ENABLED=true
USERNAME_GATE_GROUPS=-1003365870767      # nur diese Gruppen, kommagetrennt
USERNAME_GATE_NOTIFY=true

# ⚠️ WICHTIG — und am 10.09.2026 auf die harte Tour gelernt:
# "docker compose restart" liest die .env NICHT neu ein. Der Container
# startet dann mit den ALTEN Werten weiter, und man merkt es nicht.
# Genau das ist beim Scharfschalten des Alters-Bonus passiert: .env sagte 15,
# der laufende Bot rechnete weiter mit 0.
#
# Der Container muss NEU ERZEUGT werden:
cd "/root/Geldhelden Shield" && docker compose up -d

# Danach immer nachsehen, ob es auch angekommen ist:
docker exec geldhelden-shield-bot printenv | grep -E "USERNAME_GATE|RISK_ACCOUNT_AGE"
```

**Not-Aus:** `USERNAME_GATE_ENABLED=false` in die `.env`, dann `docker compose up -d`.
Kein Deploy, kein Build, dauert Sekunden. Die Prüfung darüber gehört dazu — eine
Abschaltung, die man nicht nachgesehen hat, ist keine Abschaltung.

Ohne `USERNAME_GATE_GROUPS` bleibt die Regel wirkungslos, auch wenn sie
eingeschaltet ist. Das ist Absicht: ein Versehen darf nicht 54 Gruppen treffen.

**Jede Entscheidung wird protokolliert**, auch im abgeschalteten Zustand. Tabelle
`username_gate_log` mit Zeitpunkt, Gruppe, Nutzerkennung, Benutzername ja/nein,
Entscheidung, Grund und ob der Hinweis zugestellt werden konnte. Im
abgeschalteten Zustand steht dort `beobachtet` — man sieht also, was die Regel
getan *hätte*, ohne dass jemand betroffen ist.

```sql
-- Was hätte die Regel getan?
SELECT date(created_at/1000,'unixepoch') AS tag, entscheidung, COUNT(*)
FROM username_gate_log GROUP BY tag, entscheidung ORDER BY tag DESC;
```

---

## Messungen wiederholen

```bash
# Kontoalter: alte gegen neue Schätzung, Trennschärfe, Schwellenwirkung
docker exec -e SHIELD_DB=/data/shield.db geldhelden-shield-bot \
  npx tsx scripts/measure-account-age.ts

# Was würde das Einschalten des Alters-Bonus bewirken?
docker exec -e SHIELD_DB=/data/shield.db geldhelden-shield-bot \
  npx tsx scripts/measure-age-bonus-impact.ts

# Erstnachrichten-Prüfung
docker exec geldhelden-shield-bot npx tsx scripts/measure-first-message.ts
```

Alle drei ändern nichts. Sie lesen nur.
