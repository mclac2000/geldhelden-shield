# Umsetzung Stufe 0 — Bericht

**Datum:** 04.09.2026
**Commits:** `3c8e09f`, `9fc2a81`
**Status:** ausgerollt auf `77.42.42.65`, Container `geldhelden-shield-bot` läuft, 62 verwaltete Gruppen
**Automatische Sperre:** `IMPERSONATION_AUTO_BAN=false` — es wird zunächst nur gemeldet

---

## 1. Was jetzt live ist

### Erkennung von Identitäts-Täuschung

Zwei Wege, bewusst unterschiedlich stark gewichtet:

| Weg | Beweiskraft | Folge |
|---|---|---|
| **Profilfoto-Fingerabdruck** identisch mit `@McLac2000` | Beweis | Sperre |
| **Name buchstabengenau nachgebaut**, aber nur nach Entfernen von Verschleierungszeichen | Beweis | Sperre |
| Name bloß ähnlich (Levenshtein, Teilstring) | Verdacht | nur Meldung |

Der Fotoabgleich nutzt `photo.big_file_unique_id` aus `getChat`. Laut Telegram-Doku ist dieser Wert *„supposed to be the same over time and for different bots"* — zwei Konten mit demselben Wert tragen dasselbe Bild.

Referenz erfasst (`npm run identity:reference`):

```
PROTECTED_USER_IDS=382863507
PROTECTED_PHOTO_IDS=AQADAQtrG5MI0hYB
PROTECTED_NAMES=Marco McLac2000,McLac2000,Geldhelden,Geldhelden Team,Geldhelden Support
```

> ⚠️ **Wenn Marco sein Profilbild wechselt, ändert sich der Fingerabdruck.**
> Dann `npm run identity:reference` erneut laufen lassen und den neuen Wert
> **zusätzlich** eintragen (alte Werte stehen lassen — sie schützen weiter gegen
> Kopien des alten Bildes).

### Der entscheidende Unterschied zur ersten Fassung

Ursprünglich sollte ein Namenstreffer **plus** ein Täuschungsmerkmal (kyrillische Zeichen, unsichtbare Steuerzeichen) eine Sperre auslösen. Das Code-Review hat gezeigt, dass das falsch ist:

- `Олена Geldhelden Team` — echte ukrainische Botschafterin → wäre gesperrt worden
- `Geldhelden Support 👨🏼‍💼` — Emoji mit Hautfarbe zerbricht die Emoji-Erkennung, der Zero-Width-Joiner blieb als „unsichtbares Zeichen" übrig → wäre gesperrt worden

Das Merkmal muss **ursächlich für den Treffer** sein. Deshalb wird der Name jetzt zweimal verglichen: einmal entschleiert, einmal unverändert. Nur wenn der Treffer **ausschließlich** in der entschleierten Fassung entsteht, ist die Verschleierung bewiesen.

```
"Олена Geldhelden Team"  → enthält "geldhelden" auch unverändert → nur Meldung
"Gеldhelden Support"     → enthält "geldhelden" erst nach Ersetzen
   (kyrillisches е)         des kyrillischen е                   → Sperre
```

Ein Levenshtein-Treffer löst nie eine Sperre aus — ein Tippfehler wie „Geldheldn" käme sonst auf 90 %.

### Umbenennungs-Erkennung

Neue Tabelle `user_name_history`. Bei jeder Nachricht wird der aktuelle Name mit dem letzten bekannten Stand verglichen. Bei Abweichung läuft die Identitätsprüfung erneut.

Das schließt den Angriffsweg **„unauffällig beitreten, später in ‚Marco' umbenennen"** — der vorher völlig unsichtbar war, weil `baseline_members` den Namen bei jedem Update überschrieb.

### Protokoll und Rücknahme

| Tabelle | Inhalt |
|---|---|
| `identity_events` | jede Entscheidung mit Grund, Ähnlichkeit, Merkmalen, Foto-Fingerabdruck |
| `pending_ban_log` | jede Sperre aus der Vormerk-Liste |
| `user_name_history` | Namensverlauf pro Mitglied |
| `identity_exempt` | dauerhaft ausgenommene Mitglieder |

Einsehbar über `/identity`, `/identity alarms`, `/identity pending`, `/identity <user_id>`.

Jede automatische Sperre kommt mit einem **„↩️ SPERRE AUFHEBEN"**-Knopf. Dieser entfernt die Sperre in allen Gruppen, markiert das Protokoll als zurückgenommen **und trägt das Mitglied dauerhaft in die Ausnahmeliste ein** — sonst wäre es beim nächsten Beitritt sofort wieder gesperrt.

### Not-Aus

`/panic on` stoppt ab sofort **alle** automatischen Sperren (Impersonation, Cluster, Risk) — sofort und ohne Neustart. Bisher hat dieser Befehl nur eine Meldung geschrieben und nichts abgeschaltet.

---

## 2. Reparaturen

| Was | Vorher | Jetzt |
|---|---|---|
| **Vorgemerkte Username-Sperren** | 27 Einträge lagen ungenutzt in der DB; die Zusage „wird automatisch gebannt" wurde nie eingelöst | werden bei Beitritt und Nachricht ausgewertet — mit **90-Tage-Verfallsfrist**, weil Telegram Benutzernamen gelöschter Konten wieder freigibt. 13 der 27 sind älter und verfallen automatisch, statt den falschen Menschen zu treffen. |
| **Ban-Schleife** | 1.017.043 Ban-Aktionen bei 20.052 eindeutigen User/Gruppe-Paaren; ein Konto wurde 17.630-mal gebannt, alle ~2 Minuten | Wiederholungsbremse (12 h). Greift nur, wenn der Ban auch wirklich fast überall angekommen ist — ein unvollständiger Ban wird sofort nachgeholt. Manuelle Admin-Bans umgehen die Bremse. |
| **Middleware-Kette** | fehlendes `next()` machte alle nachgelagerten Handler unerreichbar (4 Video-Kommandos, Eskalationslogik) | repariert; die teure Rechteprüfung wurde hinter die billigen DB-Abfragen verschoben, damit nicht pro Nachricht ein API-Call entsteht |
| **`edited_message`** | Handler war registriert, bekam aber nie Updates | in `allowedUpdates` ergänzt |
| **Domain-Prüfung** | `includes()` — `geldhelden.org.betrueger.com` galt als erlaubt | exakter Vergleich bzw. echte Subdomain |
| **`/ban @name`** | löste den Namen nicht in eine ID auf | zusätzlicher `getChat`-Versuch. Ehrlich: das schlägt für Nutzer meist fehl (`chat not found`) — die Datenbanksuche bleibt der Hauptweg. |
| **`RISK_ACCOUNT_AGE_BONUS`** | ließ sich nicht auf 0 setzen (Parser lehnte 0 ab und nahm still 30) | auf 0 gesetzt. Die Alters-Heuristik rechnet mit der User-ID und stuft praktisch jedes heutige Konto als „0 Tage alt" ein — bis zu einer Kalibrierung wäre der Bonus ein Massen-Fehlalarm. |

---

## 3. Nachweis

### Tests

69 Testfälle, alle grün (`npm run test:identity`) — darunter jeder echte Name aus der Produktionsdatenbank, der in einer früheren Fassung fälschlich getroffen worden wäre.

### Messung gegen die Produktionsdatenbank

Der **kompilierte Produktionscode** wurde im laufenden Container gegen alle Mitglieder ausgeführt (nur lesend):

| | alte Logik | neue Logik |
|---|---:|---:|
| Mitglieder geprüft | 7.174 | 7.174 |
| unberührt | 7.013 | **7.166** |
| Meldung | — | 4 |
| **automatische Sperre** | **161** | **4** |

**Die alte Logik hätte 161 Mitglieder als Fälschung markiert** — darunter Marco selbst, 23 echte Mitglieder namens Marco, und jeden einbuchstabigen Namen („A" passte zu 95 % auf „Marco", weil die Teilstring-Prüfung in beide Richtungen lief).

**Die neue Logik sperrt 4** — und alle vier sind zweifelsfreie Fälschungen von Marcos Benutzernamen:

```
McLac20OO    (Buchstabe O statt Null)
McLac2ooo    (drei kleine o statt Nullen)
McLacz000    (z statt 2)
McLac2O0O    (O/0 gemischt)
```

Die 4 Meldungen sind ebenfalls echte Fälscher, aber nicht buchstabengenau genug für eine automatische Sperre:

```
Mc_Lac2000            (Unterstrich)         → 90 %, Levenshtein
McLac200000           (zwei Nullen zu viel) → 95 %, Teilstring
GELDHELDEN / @Geldheldenkrypto              → 100 %, exakt
"Geldhelden Shield" / @KlausAssenmacher1974 → imitiert den Bot selbst
```

**Fehlalarmquote: 0 von 7.174.**

### Laufender Betrieb

```
Managed: 62
Anti-Impersonation:
   Geschützte Accounts: 382863507
   Referenz-Profilfotos: 1
   Ähnlichkeitsschwelle: 80 %
   Automatische Sperre: ✅ Aus (nur Alarm)
```

Alle vier neuen Tabellen sind angelegt. Der Bot verarbeitet Nachrichten (im Log: `[SCAM][HIGH] deleted+restricted … reasons=[unapproved_url,telegram_invite_link]`).

---

## 4. Was Marco noch selbst tun muss

### Bot-Token — widerrufen ✅, neuer Token fehlt noch ❗

**Stand 04.09.2026, 05:05 Uhr:** Der alte Token wurde widerrufen (Telegram
antwortet auf `getMe` mit `401: Unauthorized`). Das ist richtig so — aber der
**neue Token steht noch nicht in der `.env`**, deshalb ist der Bot offline.

Der Container wurde **angehalten** (`docker compose stop bot`), damit er nicht
alle 20 Sekunden gegen denselben 401 neu startet und dabei einen etwaigen
zweiten Fehler im Log-Rauschen unsichtbar macht. `set-token.sh` startet ihn
wieder — aus dem angehaltenen Zustand heraus ohne Zusatzschritt.

**Behebung — ein Befehl:**

```bash
ssh root@77.42.42.65
cd "/root/Geldhelden Shield"
./set-token.sh <neuer_token_von_botfather>
```

Das Skript prüft den Token erst gegen Telegram, legt eine Sicherung der `.env` an,
trägt ihn ein, startet den Bot neu und zeigt zur Kontrolle `Managed: 62`.
Bei einem ungültigen Token wird nichts geändert.

### Hintergrund zum Widerruf

Der Token steht **in der Git-Historie** des öffentlichen Repos (seit dem ersten Commit) und war bis heute in der `README.md`. Ich habe ihn aus der README entfernt, **aber die Historie lässt sich nicht bereinigen** — der Token ist dauerhaft verbrannt.

Wer ihn hat, kann den Bot übernehmen: in allen 62 Gruppen als Admin agieren, Mitglieder sperren, mitlesen, im Namen des Bots posten.

**Widerrufen erfordert @BotFather und damit Marcos Telegram-Konto:**

1. `@BotFather` öffnen → `/revoke` → `@geldhelden_shield_bot` wählen
2. Neuen Token kopieren
3. Auf dem Server eintragen:
   ```bash
   ssh root@77.42.42.65
   cd "/root/Geldhelden Shield"
   nano .env            # BOT_TOKEN=<neuer Token>
   docker compose up -d
   ```
4. Danach prüfen: `docker logs --tail 30 geldhelden-shield-bot` — es muss wieder `Managed: 62` erscheinen

Sag Bescheid, sobald der neue Token in der `.env` steht, dann prüfe ich, dass der Bot in allen 62 Gruppen weiterarbeitet.

### Automatische Sperre scharf stellen — erst nach Beobachtung

Aktuell meldet das System nur. Empfehlung: ein paar Tage `/identity alarms` beobachten. Wenn die Meldungen passen:

```bash
sed -i 's/^IMPERSONATION_AUTO_BAN=.*/IMPERSONATION_AUTO_BAN=true/' .env
docker compose up -d
```

Not-Aus jederzeit: `/panic on`.

Die 4 oben genannten Konten werden dann gesperrt, sobald sie das nächste Mal schreiben oder einer Gruppe beitreten. Ein Rückwirkungslauf über den Bestand ist bewusst **nicht** eingebaut — das wäre Stufe 4 und gehört gesondert freigegeben.

---

## 4b. Nachtrag: Schutz, der nur auf dem Papier stand

Beim Verifizieren des Rollouts fiel auf, dass **alles hinter `bot.launch()` in
keinem einzigen Start je ausgeführt wurde**. `bot.launch()` löst im
Long-Polling-Betrieb nicht auf — der Code dahinter ist unerreichbar.

Nachweis: `[Startup] ✅ Bot erfolgreich gestartet!` steht direkt hinter dem
Aufruf und taucht in **keinem** Log auf.

Betroffen war nicht nur eine Logzeile:

| Was dort hing | Folge |
|---|---|
| **Wochenbericht-Cron** (sonntags 20:00) | war **nie registriert** — es gab nie einen automatischen Wochenbericht |
| **Baseline-Scan-Cron** (monatlich) | war **nie registriert** (siehe Einordnung unten — die Auswirkung ist kleiner, als der Name vermuten lässt) |
| Bot-ID über `getMe` | nie ermittelt |
| `sendStartupLog()` | nie gesendet |
| einmaliger Wartungslauf beim Start | nie ausgeführt (der Stundentakt lief separat) |

Alles wurde vor `bot.launch()` gezogen und ist nachweislich aktiv:

```
[1] Bot-ID erfolgreich ermittelt
[1] Wochenreport-Job gestartet
[1] Baseline-Scan-Job gestartet
```

### Korrektur: Was der Baseline-Scan wirklich tut

Ich hatte zunächst geschrieben, die Mitgliederbasis sei acht Monate lang nicht
aufgefrischt worden. **Das war zu scharf formuliert.** Der nachgeholte Lauf am
04.09.2026 zeigt es:

```
54 von 55 Gruppen in 31 Sekunden, 3 neue Mitglieder, 1 Fehler
Basis vorher:  7.185 Mitglieder / 8.760 Einträge
Basis nachher: 7.185 Mitglieder / 8.763 Einträge
```

Der Grund steht im Kopf von `scan.ts`: *„Erfasst sichtbare Mitglieder aus
bekannten Quellen (Events, Nachrichten, Admins) — KEINE verbotenen API-Aufrufe
wie getChatMembers."* Die Telegram-Bot-API erlaubt kein Auflisten aller
Mitglieder. Der Scan holt live **nur `getChatAdministrators`**; alles andere
liest er aus dem, was ohnehin schon in der Datenbank steht.

**Was das bedeutet:**

- Die eigentliche Mitgliederbasis entsteht **fortlaufend** aus Beitritten und
  Nachrichten (`source='join'` bzw. `'message'`). Dieser Weg hat nie ausgesetzt.
- Der Monats-Scan frischt im Wesentlichen die **Admin-Listen** auf. Sein Ausfall
  war ärgerlich, aber nicht der Datenverlust, den der Name nahelegt.
- Der Ausfall des **Wochenberichts** bleibt der schwerwiegendere der beiden:
  Marco hat acht Monate lang keinen automatischen Bericht bekommen und konnte
  deshalb nicht bemerken, dass etwas fehlt.

**Nebenbefund:** `scan.ts` schreibt überhaupt keine Zeile in `baseline_scans` —
das macht nur eine separate Funktion in `db.ts`, die der Scan nicht aufruft. Die
Anzeige „letzter Scan: 11.01.2026" bleibt deshalb dauerhaft stehen, egal wie oft
der Scan läuft. Als Kennzahl ist sie unbrauchbar und sollte entweder verdrahtet
oder entfernt werden.

**`checkAllGroupsOnStartup` ist dagegen entwarnt** — trotz Namen und
Aufrufkommentar („Prüfe alle Gruppen und setze Status automatisch basierend auf
Bot-Admin-Status") lädt die Funktion nur die Gruppenliste und schreibt eine
Logzeile. Sie prüft nichts. Der Kommentar wurde korrigiert; wer dort Schutz
erwartet, muss ihn erst bauen.

### Gruppenliste bereinigt: 62 → 55

Ein Live-Abgleich aller 63 Einträge gegen Telegram ergab **6 Gruppen, die der Bot
überhaupt nicht mehr erreicht** (`chat not found`), plus eine auf eine neue
Supergruppen-ID migrierte:

| Gruppe | Mitglieder | letzter Beitritt | Einordnung |
|---|---:|---|---|
| Geldhelden Meetup München | 5 | 16.03.2026 | eigene Gruppe, Bot entfernt |
| **Neue Freie Welt** | **534** | 13.03.2026 | große Gruppe, Bot entfernt |
| **(Titel in Zierschrift)** | **1218** | **27.08.2026** | große, aktive Gruppe, Bot erst kürzlich raus |
| TRADING 212 PLATFORM LLC. | 1 | nie | fremde Gruppe |
| Wahrheits-Community (Krypto-Investition) | 3 | 10.05.2026 | fremde Gruppe |
| Jjhhh | 1 | nie | Müll |
| Geldhelden Meetup Bali | 1 | nie | auf neue Supergruppen-ID migriert |

Alle sieben stehen jetzt auf `disabled` — **keine Zeile gelöscht**, jede lässt
sich mit `/group managed` zurückholen. Sicherung vor dem Eingriff liegt unter
`backups/shield-vor-gruppenbereinigung-*.db`.

> **Für Marco:** Bei den beiden großen Gruppen (534 und 1218 Mitglieder) wurde
> der Bot entfernt. Wenn das nicht beabsichtigt war, bitte wieder als Admin
> hinzufügen — dann `/group managed` in der Gruppe. Umgekehrt lohnt ein Blick
> darauf, wie der Bot in „TRADING 212 PLATFORM LLC." und
> „Wahrheits-Community (Krypto-Investition)" geraten ist.

Damit meldet der Start jetzt `Managed: 55` statt `62` — die Zahl beschreibt
tatsächlich erreichbare Gruppen.

### `ADMIN_SYNC`-Dauerfehler beseitigt (8 → 0)

`adminSync` nutzte `isGroupManaged()` aus `groupConfig.ts`. Das liest ein
**anderes** Feld (`group_config.managed`) als der Rest des Systems
(`groups.status`) und liefert für Gruppen ohne Eintrag `true` — deshalb wurden
auch deaktivierte Gruppen abgefragt. Jetzt läuft `getManagedGroups()`, dieselbe
Liste wie Sperren, Scans und Wellen-Erkennung. Ergebnis: `errors=0`.

Das war der eigentliche Schaden an den acht Fehlern: solange ein Bericht dauerhaft
Fehler wirft, sieht niemand mehr hin, wenn ein echter dazukommt.

---

## 5. Stufe 2 (Beitritt nur nach Genehmigung) — mein Urteil: **nicht bauen**

Marcos Bedingung war klar: nur vollautomatisch, keine Menschen, keine Warteschlange. Ich habe das geprüft und rate ab. Die Gründe, ehrlich:

### a) Gegen die Strohmänner gibt es beim Beitritt schlicht kein Signal

Der Angriff hat drei Schritte. Ein Beitritts-Tor kann nur den ersten treffen:

| Schritt | Erkennbar beim Beitritt? |
|---|---|
| 1. Kopie von Marcos Account | **ja** — Foto und Name |
| 2. Strohmänner („Lisa", „Klaus") schreiben Mitglieder an | **nein** |
| 3. Weiterleitung in die Fake-Gruppe | **nein** |

Ein Strohmann heißt Lisa Müller, hat ein unauffälliges Foto und eine leere Bio. Zum Zeitpunkt der Beitrittsanfrage hat er **nichts getan**. Es gibt kein Merkmal, an dem eine Automatik ihn von einem echten neuen Mitglied unterscheiden könnte. Jede Regel, die ihn erwischt, erwischt auch echte Neumitglieder — und die Zahlen aus Teil 2 des Konzepts zeigen, wie teuer das wird.

Was die Strohmänner tatsächlich verrät, ist ihr **Verhalten nach dem Beitritt**: viele Gruppen in kurzer Zeit (fängt die Cluster-Erkennung ab ≥7 Gruppen schon heute), private Ansprache, Weiterleitungen mit Einladungslinks. Das passiert alles **nach** dem Tor.

### b) Den Schritt, den das Tor könnte, erledigt der jetzige Stand bereits

Die Marco-Kopie wird seit heute erkannt — beim Beitritt, bei der ersten Nachricht und bei jeder Umbenennung, über Foto **und** Verschleierungs-Erkennung. Ein Tor davor bringt Sekunden, nicht Substanz.

### c) Die starke Variante steht diesem Bot nicht zur Verfügung

Telegram hat im Juni 2026 (Bot API 10.1) genau dafür etwas gebaut: `guard_bot`, `sendChatJoinRequestWebApp`, `answerChatJoinRequestQuery` — eine Mini-App, die den Beitrittswilligen vor der Entscheidung prüft. Ich habe live nachgesehen:

```
getMe → "supports_join_request_queries": false
```

Der Bot unterstützt es nicht, und die API bietet **keine Methode**, sich als `guard_bot` einzutragen — das Feld ist nur lesbar. Übrig bliebe das alte `approveChatJoinRequest` aus 2021, ohne Prüf-Oberfläche.

### d) Der Fotoabgleich funktioniert vor dem Beitritt vermutlich gar nicht

`getChat` liefert für aktive Mitglieder zuverlässig Daten (15 von 15 im Test). Für Konten **ohne** gemeinsame Gruppe kam dagegen `Bad Request: chat not found`. Bei einer Beitrittsanfrage ist der Mensch noch in keiner Gruppe — der stärkste Beweis stünde ausgerechnet dort nicht zur Verfügung. Das müsste man erst live nachmessen.

### e) Der Preis ist real

- Alle 62 Gruppen müssten umgestellt und alle geteilten Einladungslinks neu erzeugt werden
- Ist der Bot ausgefallen, kommt **niemand** mehr in **keine** Gruppe — ein neuer Totalausfallpunkt, den es heute nicht gibt
- Jeder Fehlalarm der Automatik ist eine stille Ablehnung, von der Marco nichts erfährt

### Was ich stattdessen empfehle: den Ziellink treffen

Alle Strohmänner einer Welle führen zu **einer** Fake-Gruppe. Dieser eine Link ist der gemeinsame Nenner der gesamten Kampagne — unabhängig davon, wie viele Strohmänner auftreten und wie sie heißen.

Heute wird er nicht erkannt: `isTelegramInviteLink` matcht nur `t.me/+…`, nicht `t.me/gruppenname`. Und `t.me` steht per Default auf der erlaubten Domain-Liste.

Vorschlag (halber Tag, vollautomatisch, kein Mensch im Prozess):

1. Jeden `t.me`-Link in Nachrichten erfassen und zählen — mit Absender, Gruppe, Zeit
2. Alle Links zu **eigenen** Geldhelden-Gruppen auf die Freigabeliste (einmalig aus der `groups`-Tabelle)
3. Ein fremder `t.me`-Link, der von **mehreren verschiedenen Konten** in **mehreren Gruppen** auftaucht, ist per Definition eine Kampagne → Link sperren, alle Nachrichten damit löschen, alle Absender melden
4. Damit fällt die gesamte Welle auf einmal — statt Strohmann für Strohmann

Das trifft Schritt 2 und 3 des Angriffs, ist vollständig automatisch, hat einen klaren Beweis (derselbe fremde Link aus mehreren Quellen) und keine Nebenwirkung auf normale Mitglieder.

**Wenn du willst, baue ich das als Nächstes.** Es ist aus meiner Sicht der wirksamste verbleibende Hebel — deutlich wirksamer als das Beitritts-Tor.
