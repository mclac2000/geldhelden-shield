# Geldhelden Shield — Schutz gegen Admin-Impersonation und Strohmann-Anwerbung

**Stand:** 04.09.2026
**Anlass:** Wiederkehrender zweistufiger Angriff — Kopie von Marcos Account + Strohmänner, die in eine Fake-Gruppe einladen
**Status:** Befund + Plan. Es wurde **nichts** in Produktion verändert. Alle Server-Zugriffe waren lesend.

---

## 0. Sofort, unabhängig vom Rest: Bot-Token ist kompromittiert

Der Bot-Token steht **im Klartext in der versionierten `README.md`** (Zeile ~130 und ~160) und in `.env`:

```
BOT_TOKEN=7956976212:AAGwNWFw8IKhWZ-SqYu31HI-Sj_FNySVcLY
```

Wer diesen Token hat, kann **den Bot vollständig übernehmen**: in allen 62 Gruppen als Admin agieren, Mitglieder bannen, Nachrichten löschen und lesen, im Namen des Bots posten. Das Repo liegt auf GitHub. Der Token ist in der Git-Historie und lässt sich nicht durch bloßes Löschen der Zeile entfernen.

**Zu tun (Reihenfolge einhalten):**
1. `@BotFather` → `/revoke` → neuen Token erzeugen
2. Neuen Token nur in `.env` auf dem Server eintragen (nie ins Repo)
3. `README.md` bereinigen, `.env` in `.gitignore` prüfen (steht dort bereits, wurde aber offenbar früher committet)
4. Container neu starten

Aufwand: 15 Minuten. Das ist unabhängig vom Impersonation-Thema und sollte zuerst passieren.

---

# Teil 1 — Befund: Was das System heute ist und tut

## 1.1 Wo es liegt

| | |
|---|---|
| **Code** | `~/development/geldhelden-shield/` (TypeScript, ~19.850 Zeilen in `src/`) |
| **Server** | APS-Server `77.42.42.65`, SSH-Alias `freihelden-crm` (in `CLAUDE.md` als `geldhelden-aps` geführt — der Alias existiert im Terminal-MCP nicht, das ist zu korrigieren) |
| **Laufzeit** | Docker-Container `geldhelden-shield-bot`, läuft seit 01.06.2026 |
| **Verzeichnis** | `/root/Geldhelden Shield/` |
| **Datenbank** | SQLite, `/root/Geldhelden Shield/data/shield.db`, **143 MB** |
| **Deploy** | manuell per SSH + `docker compose up -d --build` |
| **Stand** | Deployed = lokales Repo (Commit `563127d`), keine Abweichung |

**Der Bot lebt und arbeitet.** Letzter Join: 03.09.2026 17:14. Letztes Scam-Event: 03.09.2026 13:06.

## 1.2 Größe des Bestands (aus der Produktions-DB, 04.09.2026)

| Kennzahl | Wert |
|---|---|
| Verwaltete Gruppen (`status='managed'`) | **62** (nicht 49 — die Doku ist veraltet) |
| Bekannte Mitglieder (distinct) | **7.179** |
| Davon gebannt | 448 |
| Blacklist (numerische IDs) | 425 |
| Username-Blacklist | 44 |
| Pending-Username-Blacklist | 26 |
| Team-Whitelist | 67 |
| Scam-Events August 2026 | 219 |
| Blacklist-Neueinträge August 2026 | 99 |

Das System ist also **real wirksam** — rund 100 Sperrungen im Monat.

## 1.3 Welche Signale ausgewertet werden

**Drei getrennte, nicht miteinander verbundene Systeme:**

### a) Punkte-Risk-Score (`risk.ts`)
| Signal | Gewicht |
|---|---|
| Join-Event | +10 je Join/Stunde |
| Multi-Join (>1 in 1h) | +20 |
| Account jünger als 7 Tage | +30 |
| **Kein Username** | **+15** |
| **Kein Profilfoto** | **+10** |

Schwellen: 60 → Restrict, 120 → Ban. Decay −20 alle 24 h.

> **Befund:** Die drei Einmal-Faktoren (Username, Foto, Alter) sind wegen eines Logikfehlers in `risk.ts:238` **faktisch wirkungslos**. Die Metadaten werden in `risk.ts:213-224` gesetzt, und erst *danach* wird geprüft, ob sie „gerade neu gesetzt wurden" — was dann immer `false` ergibt. In der Praxis wächst der Score also nur über Joins. Der Restrict-Schwellwert 60 wird durch ein einzelnes Join-Ereignis realistisch nie erreicht.
>
> **Zweiter Befund:** Das Account-Alter ist eine grobe Rechenformel auf Basis der User-ID (`risk.ts:32-61`) — Telegram liefert kein Registrierungsdatum. Ab etwa `userId > 1,24 Mrd.` liefert die Formel ein Datum in der Zukunft und wird auf „jetzt" gekappt. Da reale Neuanmeldungen heute bei 6–8 Mrd. liegen, gilt praktisch **jeder heute beitretende Account als 0 Tage alt** und bekäme pauschal +30 Punkte. IDs unter 1 Mrd. bekommen dagegen Festdaten (2009/2012/2016/2019) und lösen den Bonus nie aus.

### b) Risk-Level CLEAN/LOW/MEDIUM/HIGH (`riskLevel.ts`)
Steuert nur die Formulierung der Willkommensnachricht. **Löst keine Sanktion aus.** Die Username-Heuristik ist dort auskommentiert (`riskLevel.ts:75-91`).

### c) Cluster-Erkennung — das ist der real wirksame Auto-Ban-Pfad
- `cluster2.ts` (Echtzeit, bei jedem Join und jeder Nachricht): ein User in ≥3 verwalteten Gruppen in 24 h → beobachten; ≥5 → Restrict; **≥7 → globaler Ban**
- `cluster.ts` (nächtlicher Batch): erkennt echte Netzwerke — User-Paare mit ≥3 gemeinsamen Gruppen, Dreier-Kombinationen mit ≥4 gemeinsamen Gruppen → **globaler Ban aller Beteiligten**

Das ist der wirksamste Teil des Systems und genau der, der gegen Strohmann-Netzwerke greift.

### d) Scam-Erkennung (`scam.ts`) — reine Regex auf Nachrichtentext
- **HIGH (Gewicht 10):** Account-/Verifizierungs-Scam, Support-Scam, „schreib mir privat", Job-Spam mit Einkommensversprechen
- **MEDIUM (6):** Gewinnspiel/Airdrop/Bonus, Investment, MLM-Recruiting-Formulierungen
- **LOW (3):** Signal-Gruppe, VIP-Gruppe, Cloud Mining
- Zuschläge: nicht-gelistete URL +8, **privater Einladungslink `t.me/+…` +10**, URL-Shortener +10, Weiterleitung + verdächtige Wörter +4
- Schwellen: ≥10 MEDIUM (löschen), ≥18 HIGH (löschen + Restrict, da `ACTION_MODE=restrict`)

> **Befund:** Öffentliche Gruppenlinks der Form `t.me/gruppenname` (ohne `+`) werden **nicht** als Einladungslink erkannt (`scam.ts:317`). Genau diese Form nutzt der beschriebene Angriff.
>
> **Zweiter Befund:** `t.me` steht per Default auf der URL-Allowlist (`db.ts:3653`). Telegram-Links werden also ausdrücklich durchgelassen.
>
> **Dritter Befund:** Die Homoglyphen-Normalisierung wird berechnet, aber die Regex-Patterns prüfen den unnormalisierten Text (`scam.ts:356 vs. 360/368/376`) — sie ist wirkungslos.

## 1.4 Wird per Username oder per ID gesperrt?

**Beides — aber getrennt und mit sehr unterschiedlicher Qualität.**

| Tabelle | Schlüssel | Zweck |
|---|---|---|
| `blacklist` | `user_id` (numerisch) | die harte, wirksame Sperre |
| `username_blacklist` | `username` | greift beim Join, solange der Name gleich bleibt |
| `pending_username_blacklist` | `username` | für unbekannte Namen |

Ablauf bei `/ban @name` (`admin.ts:182-265`):
1. Name kommt in `username_blacklist`
2. Es wird in `baseline_members` nach passenden IDs gesucht
3. Treffer → echter globaler Ban per ID
4. **Kein Treffer → Platzhalter-User mit negativer Pseudo-ID** aus der Zeichensumme des Namens (`admin.ts:220-221`), Eintrag in `pending_username_blacklist`, und der Admin bekommt die Meldung:
   > „⚠️ Sobald dieser User irgendwo sichtbar wird (join/message), wird er automatisch global gebannt."

> **Befund — das ist die Kernschwäche:** Diese Zusage wird **nicht eingelöst**. Die Funktionen `convertPendingUsernameBlacklistToBan()` (`db.ts:2750`) und `isPendingUsernameBlacklisted()` (`db.ts:2710`) sind implementiert, werden aber **nirgends aufgerufen**. 26 Einträge liegen dort und tun nichts.
>
> Wichtig: `/ban @name` versucht **gar nicht**, den Namen über `getChat('@name')` in eine numerische ID aufzulösen — obwohl `/unban` genau das tut (`admin.ts:902`). Das ist eine Zeile Code Unterschied und der Grund, warum jede Umbenennung die Sperre aushebelt.

**Cross-Ban über alle Gruppen** (`telegram.ts:785-840`): iteriert über `getManagedGroups()`, prüft je Gruppe live die Bot-Adminrechte, ruft `banChatMember`. Bei Telegram-Fehler 429 gibt es **einen** Wiederholungsversuch nach der von Telegram genannten Wartezeit (`telegram.ts:704-718`); scheitert auch der, wird der Ban nur gezählt und **nicht erneut versucht** — er bleibt dauerhaft offen. Es gibt keine persistente Wiederholungsliste.

## 1.5 Was beim Beitritt eines neuen Mitglieds passiert

Abonnierte Updates (`index.ts:2180`):
```
['message', 'my_chat_member', 'chat_member', 'callback_query', 'channel_post']
```

Ablauf: Dedup → Gruppe registrieren → Join speichern → **Blacklist-Prüfung (ID)** → **Username-Blacklist-Prüfung** → Baseline speichern → Willkommensnachricht → Cluster-Check → Risikobewertung inkl. Impersonations-Prüfung.

> **Befund:** **`chat_join_request` ist nicht abonniert.** `approveChatJoinRequest` / `declineChatJoinRequest` kommen im gesamten Repo nicht vor. Es gibt **kein Beitritts-Genehmigungsverfahren und kein Captcha** (kein einziger Treffer für „captcha" im Code).

## 1.6 Impersonation-Erkennung — existiert, aber zahnlos

`checkImpersonation()` in `telegram.ts:1491-1547` ist im Ansatz brauchbar:
- Exakter Treffer = 100 %, Teilstring = 95 %, sonst Levenshtein-Distanz
- Normalisierung optisch ähnlicher **ASCII**-Zeichen in `telegram.ts:1475-1485` (`normalizeSimilarChars`): `l/I/1`, `o/0`, `a/@`, `e/3`, `s/5/$`, `z/2`
- Geschützte Namen (`config.ts:229`, Default, da `PROTECTED_NAMES` in der Server-`.env` **nicht gesetzt** ist):
  `Marco, McLac2000, Geldhelden, Geldhelden Team, Geldhelden Support`
- Schwelle: 80 % Ähnlichkeit

**Aber:**
0. **Es gibt keinen Homoglyphen-Schutz im Impersonations-Pfad.** `normalizeSimilarChars` behandelt nur ASCII-Verwechslungen. Ein Name mit **kyrillischem** „Мarco" oder „Gеldhelden" (kyrillisches е) läuft ungefiltert durch — auch an der Exakt- und Teilstring-Prüfung vorbei. Die passende Funktion existiert im Projekt (`normalizeText()` in `scam.ts`, behandelt kyrillisch а/е/о/р/с/і/у, Nullbreite-Zeichen, Vollbreiten-Ziffern), wird von `checkImpersonation()` aber **nicht verwendet** — und ist auch in `scam.ts` selbst ungenutzt (siehe 1.3). **Das ist die einfachste Umgehung des gesamten Schutzes und mit zwei Zeilen zu schließen.**
1. Die Folge ist **ausschließlich eine Log-Meldung mit Buttons** (`telegram.ts:1552-1607`) — keine automatische Sanktion, kein Restrict, keine Warnung in der Gruppe
2. Sie läuft **nur beim Beitritt** (`index.ts:515-540`) — nicht bei Umbenennung
3. Der zweite Aufruf im Text-Handler (`index.ts:1636-1672`) ist **unerreichbar**: `bot.on('message', …)` in `index.ts:1489` ruft kein `next()` auf, damit läuft in Telegraf v4 keine nachgelagerte Middleware mehr. Aus demselben Grund sind auch `/video_status`, `/video_open`, `/video_mine`, `/video_stats` tot.
4. **Kein Profilfoto-Vergleich.** Es wird nur ein Ja/Nein-Flag gespeichert (`users.has_profile_photo`), kein `file_unique_id`, kein Hash.
5. **Keine Namens-Historie.** `baseline_members` überschreibt Username und Namen bei jedem Update (`db.ts:3273`). Eine Umbenennung ist im Nachhinein nicht nachvollziehbar.

## 1.7 Meldeverfahren für Mitglieder

**Existiert nicht.** Kein `/report`, kein anderes Kommando. Die Willkommensnachricht sagt „bitte melden" (`config.ts:284`), ohne technisches Gegenstück. Meldungen kommen ausschließlich privat bei Marco an.

## 1.8 Weitere gravierende Befunde

| Befund | Beleg |
|---|---|
| **Ban-Schleife:** 1.017.043 Ban-Aktionen bei nur 20.052 eindeutigen User/Gruppe-Paaren = **50-fache Wiederholung.** Ein einzelner User wurde 17.630-mal gebannt, laut Zeitstempeln alle ~2 Minuten durch „L3 cluster detection". Ursache: `banUserGlobally` prüft `isBlacklisted()` **nur, um den Blacklist-Eintrag zu setzen** (`telegram.ts:1051`) — danach wird ungeprüft in allen 62 Gruppen gebannt, auch wenn der User dort längst gesperrt ist. Ein vorhandener Skip-Pfad existiert nur für Admins und Team-Mitglieder, nicht für bereits Gebannte. Ergebnis: ~200.000 überflüssige Telegram-API-Calls pro Monat und ein echtes Flood-Limit-Risiko — es kann dazu führen, dass **legitime** Bans nicht durchgehen. | `actions`-Tabelle, `telegram.ts:1032-1070`, `cluster.ts:218` |
| **11 Admin-Kommandos sind Platzhalter:** `/status`, `/allow`, `/unrestrict`, `/groups`, `/manage`, `/disable`, `/unmanage`, `/whereami`, `/weekly` (2×), `/scan status` antworten mit *„Implementation missing – please restore from backup"* | `admin.ts:123, 131, 327, 335, 343, 351, 359, 430, 438, 446, 486` |
| **`moderationCore.ts` (zentrale Guardrails, 252 Zeilen) ist toter Code** — von keiner Datei importiert | — |
| **`evaluateScam()` (198 Zeilen) wird nie aufgerufen.** `/scam threshold` und `/scam action` schreiben Werte, die die Live-Pipeline ignoriert | `scam.ts:460-658` |
| **`/support/i` mit Gewicht 10** trifft jedes Wort mit „support" — auch „Kundensupport". Zusammen mit einem beliebigen Link (10+8=18) ergibt das HIGH → Restrict eines unbescholtenen Mitglieds | `scam.ts:49` |
| **`isDomainAllowed()` nutzt `includes()`** — `geldhelden.org.betrueger.com` gilt als erlaubt | `groupIntelligence.ts:156` |
| Link-Policy greift **nur in den ersten 30 Minuten** nach Beitritt (Gruppen-Default `link_policy_new_user_window_minutes`, pro Gruppe änderbar) und **löscht nur**, ohne Sanktion | `linkPolicy.ts:119-122, 144`, `db.ts:3653` |
| `edited_message` fehlt in `allowedUpdates` → Scam-Check auf nachträglich bearbeitete Nachrichten greift nicht | `index.ts:1574, 2181` |
| **Zweiter toter Konfigurationspfad:** Der Gruppen-Default `scam_threshold = 70` (`db.ts:3653`) steht neben den fest kodierten Schwellen 10/18 in `scam.ts:442-452`. Da die Live-Pipeline `scoreScam` nutzt und nicht `evaluateScam`, wirkt der konfigurierbare Wert nirgends — passend zum Befund, dass `/scam threshold` folgenlos bleibt | `db.ts:3653`, `scam.ts:442-452` |

**Zusammengefasst:** Das System ist konzeptionell durchdacht und in der Cluster-Erkennung stark. Aber ein erheblicher Teil des gegen genau diesen Angriff gebauten Codes läuft nicht — teils wegen kleiner Logikfehler, teils weil Funktionen nie verdrahtet wurden.

---

# Teil 2 — Die Username-Hypothese: geprüft und widerlegt

Marcos Vorschlag war, Mitglieder mit ausgeblendetem Username zu warnen, zu sperren oder gar nicht erst hereinzulassen. Der Gedanke ist nachvollziehbar — die Strohmänner nutzen das gezielt. Aber die Daten sagen etwas anderes.

## 2.1 Wie viele echte Mitglieder haben keinen Username?

| Gruppe | ohne Username | mit Username | Anteil ohne |
|---|---:|---:|---:|
| **Alle bekannten Mitglieder** | 4.160 | 3.019 | **58,0 %** |
| **Aktive Schreiber** (haben nachweislich in einer Gruppe gepostet) | 903 | 1.502 | **37,5 %** |
| **Langzeit-Mitglieder** (>180 Tage bekannt) | 1.265 | 1.377 | **47,9 %** |

Ein automatischer Bann würde **mindestens 1.265 langjährige, unbescholtene Mitglieder** treffen, darunter **903 aktive Schreiber**.

## 2.2 Sagt „kein Username" überhaupt Scammer voraus?

Das ist die entscheidende Frage. Antwort: **Nein — das Signal ist umgekehrt.**

| | gebannt | nicht gebannt | **Ban-Rate** |
|---|---:|---:|---:|
| **ohne Username** | 185 | 3.975 | **4,45 %** |
| **mit Username** | 226 | 2.793 | **7,49 %** |

Gegenprobe über die zweite Tabelle (`users.has_username`), unabhängig erhoben:

| | gebannt | ok | **Ban-Rate** |
|---|---:|---:|---:|
| ohne Username | 268 | 5.037 | **5,05 %** |
| mit Username | 180 | 1.950 | **8,45 %** |

**Beide Auswertungen zeigen dasselbe: Mitglieder ohne Username werden seltener gesperrt als Mitglieder mit Username — etwa 40 % seltener.**

## 2.3 Was das bedeutet

Die Erklärung ist plausibel: Der typische deutschsprachige Telegram-Nutzer über 40 richtet nie einen Username ein. Das ist bei Geldhelden die *Mehrheit* der Mitglieder. Die Strohmänner blenden ihren Namen zwar aus — aber sie verschwinden dadurch in einer sehr großen, sehr harmlosen Menge.

**Ein Bann auf dieses Signal wäre ein Eigentor:** Um vielleicht 5–10 Strohmänner im Monat zu erwischen, würden über 1.200 echte Mitglieder getroffen. Das Signal ist als *alleiniges* Kriterium unbrauchbar.

**Als Kombinationssignal bleibt es wertvoll.** „Kein Username" **plus** „neu beigetreten" **plus** „in ≥3 Gruppen in 24 h" **plus** „schreibt Mitglieder privat an" ist ein starkes Muster. Genau so — als ein Faktor unter mehreren, nie allein — sollte es verwendet werden. Das ist im Plan unten in Stufe 2 abgebildet.

---

# Teil 3 — Recherche: Was heute möglich ist

## 3.1 Der wichtigste Fund: Telegram hat im Juni 2026 genau dafür eine Schnittstelle gebaut

**Bot API 10.1 (11.06.2026), Abschnitt „Join Request Queries"** — das ist neuer als der gesamte Shield-Code und beantwortet das Problem an der Wurzel:

| Neuerung | Bedeutung |
|---|---|
| `guard_bot` in `ChatFullInfo` | Eine Gruppe kann offiziell einen **Wächter-Bot** benennen |
| `query_id` in `ChatJoinRequest` | Beitrittsanfrage kommt mit Vorgangsnummer |
| `sendChatJoinRequestWebApp` | Der Bot zeigt dem Beitrittswilligen **eine Mini-App zur Prüfung**, bevor entschieden wird |
| `answerChatJoinRequestQuery` | Entscheidung: `approve`, `decline` oder `queue` (an menschliche Admins weiterreichen) |
| `supports_join_request_queries` in `User` | Flag, ob ein Bot das kann |

Wörtlich aus der API-Doku zu `query_id`:
> „*Optional*. Identifier of the join request query; for bots assigned to process join requests only. **If present, then the bot must call sendChatJoinRequestWebApp or directly call answerChatJoinRequestQuery within 10 seconds.**"

Und zu `guard_bot`:
> „*Optional*. The bot that processes join request queries in the chat. **The field is only available to chat administrators.**"

**Einschränkung, die in der Planung berücksichtigt werden muss:** Die Bot API bietet **keine Methode, um einen Bot zum `guard_bot` zu machen**. Das Feld ist nur lesbar. Die Zuweisung erfolgt offenbar in den Gruppeneinstellungen der Telegram-App. Das ist vor einem Rollout auf 62 Gruppen praktisch zu prüfen.

**Wichtig und sofort nutzbar, unabhängig von `guard_bot`:** Die klassischen Methoden `approveChatJoinRequest` / `declineChatJoinRequest` gibt es seit Bot API 5.4 (2021). Sie brauchen nur das Adminrecht `can_invite_users`. Und laut Doku wird `chat_join_request` **standardmäßig geliefert** — anders als `chat_member`:

> „Specify an empty list to receive all update types except *chat_member*, *message_reaction*, and *message_reaction_count* (default)."

Das heißt: `chat_join_request` muss zwar in `allowedUpdates` aufgenommen werden, weil der Shield eine explizite Liste setzt — aber es ist keine Sonderfreischaltung nötig.

## 3.2 Weitere neue, direkt verwertbare API-Möglichkeiten

| Feature | API-Version | Nutzen hier |
|---|---|---|
| **`setChatMemberTag`** — sichtbares Namensschild für normale Mitglieder, 0–16 Zeichen | 9.5 (01.03.2026) | Echte Team-Mitglieder tragen sichtbar „Geldhelden Team". Ein Fake-Marco hat das nicht. **Achtung:** Nutzer dürfen ihren Tag selbst ändern, wenn `can_edit_tag` in den `ChatPermissions` gesetzt ist — das muss abgeschaltet werden, sonst ist der Tag wertlos. |
| **`verifyUser` / `verifyChat`** — Verifikations-Abzeichen im Namen einer Organisation | 8.2 (01.01.2025) | Marcos echter Account und die echten Gruppen bekommen ein Abzeichen. **Aber:** die Doku sagt nicht, wie man eine berechtigte Organisation wird, und es gibt **kein `is_verified`-Feld** — der Bot kann den Status nicht auslesen. Nur als optische Maßnahme für Mitglieder brauchbar. |
| **`ChatFullInfo.photo`** mit `big_file_unique_id` | vorhanden | **Das ist der Schlüssel zur Foto-Impersonations-Erkennung.** Doku wörtlich: „Unique file identifier … **which is supposed to be the same over time and for different bots.** Can't be used to download or reuse the file." Zwei Accounts mit demselben `big_file_unique_id` haben **dasselbe Profilbild**. Ein einziger `getChat`-Aufruf genügt. |
| **`ChatFullInfo.bio`** | vorhanden | Fake-Accounts kopieren oft auch die Bio |
| **`ChatFullInfo.has_private_forwards`** | vorhanden | „Weiterleitungen zu mir zeigen keinen Link auf mein Profil" — genau die Einstellung, die die Strohmänner nutzen |
| **`ChatJoinRequest.bio`** | vorhanden | Bio schon **vor** dem Beitritt prüfbar |
| **`UserRating`** in `ChatFullInfo` | 9.3 (31.12.2025) | Telegram-eigener Vertrauenswert. Doku: „a negative level is likely reason for concern" |
| **Ephemeral Messages** — Nachricht in der Gruppe, die nur ein bestimmter Nutzer sieht | 10.2/10.3 (2026) | Verifikationsdialoge und Warnungen ohne Gruppen-Spam. Als Admin darf der Bot das jederzeit an jedes Nicht-Bot-Mitglied. |
| **`ChatMemberUpdated.via_join_request`** | 7.3 (06.05.2024) | Nachvollziehen, ob jemand über Genehmigung kam |
| **`deleteMessages`** (Bulk, 1–100 IDs, nur <48 h alt) | 7.0 | Aufräumen nach einer Spam-Welle |

## 3.3 Weiterleitungen — warum die Meldung des Mitglieds nicht reicht

Bei einer weitergeleiteten Nachricht gibt es zwei Fälle:

- **`MessageOriginUser`** — enthält das vollständige `User`-Objekt inklusive **numerischer ID**. Perfekt für ein Meldekommando.
- **`MessageOriginHiddenUser`** — enthält laut Doku nur `sender_user_name`: *„Name of the user that sent the message originally"*. **Ein reiner Anzeigename als Zeichenkette. Keine ID, kein Username, nicht überprüfbar.**

Genau das ist der technische Kern des Angriffs: Wer „Weiterleitungen verbergen" aktiviert, ist über eine weitergeleitete Nachricht **prinzipiell nicht identifizierbar**. Das lässt sich nicht wegprogrammieren. Was geht: das Muster erkennen und den Absender über die *Gruppe*, in der er aufgetreten ist, greifen — nicht über den Forward.

## 3.4 Was etablierte Schutzsysteme können

| Bot | Ansatz | Für Geldhelden relevant? |
|---|---|---|
| **Shieldy** | Captcha beim Beitritt (Button, Rechenaufgabe, eigene Frage) — sonst nichts | Konzept ja, Produkt nein |
| **Rose** | Warnungen, Filter, Captcha-Gate, **Föderations-Bans über mehrere Gruppen** | Föderations-Idee = Shields Cross-Ban, schon vorhanden |
| **GroupHelp** | Menügeführt: Anti-Flood, Anti-Spam, Captcha, Inhaltsfilter | — |
| **Combot** | Mustererkennung + maschinelles Lernen, plus Statistik | ML-Ansatz wäre langfristig interessant |

**Keiner dieser Bots löst das Impersonations-Problem.** Alle arbeiten nach dem Beitritt und gegen generischen Spam. Der Angriff auf Geldhelden ist zielgerichtet und persönlich — der Shield ist ihm mit Cluster-Erkennung und `PROTECTED_NAMES` konzeptionell bereits **voraus**. Der Vorsprung wird nur nicht ausgespielt, weil die Teile nicht verdrahtet sind.

## 3.5 Was Telegram selbst anbietet

- **`@NoToScam`** — offizieller Bot speziell für Impersonations-Meldungen
- **`abuse@telegram.org`** — E-Mail-Weg, mit Screenshots und Links belegen
- **In-App-Meldung** — Profil → ⋯ → Melden → „Fake Account"
- **Verifikation über Organisationen** (`telegram.org/verify`)

Empfehlung: **Beides parallel fahren.** Jede erkannte Kopie sollte automatisch als vorbereiteter Meldetext ausgegeben werden, damit die Meldung an Telegram in Sekunden statt Minuten rausgeht. Der Shield sperrt in den eigenen Gruppen; nur Telegram kann den Account global löschen.

---

# Teil 4 — Plan

Aufsteigend nach Aufwand. Die Stufen sind unabhängig — jede allein bringt schon etwas.

---

## Stufe 0 — Reparatur, keine neue Funktion (0,5 Tage)

Kein Risiko für Mitglieder. Diese Punkte machen bestehenden Code erst wirksam.

| # | Maßnahme | Ort | Nebenwirkung |
|---|---|---|---|
| 0.1 | **Bot-Token rotieren** (siehe Abschnitt 0) | `.env`, `README.md`, BotFather | Container-Neustart |
| 0.2 | **`/ban @name` löst den Namen auf** — `getChat('@name')` ergänzen, wie es `/unban` in `admin.ts:902` bereits tut. Damit landet auch bei Namensangabe die **numerische ID** in der Blacklist. ⚠️ **Nicht 1:1 von `/unban` kopieren:** dort wird bei einem Treffer in der Pending-Liste schon in `admin.ts:894-898` per `return` abgebrochen, das `getChat` läuft also nicht immer | `admin.ts:182` | keine |
| 0.3 | **Pending-Username-Blacklist verdrahten** — `isPendingUsernameBlacklisted()` und `convertPendingUsernameBlacklistToBan()` im Join-Handler aufrufen. 26 wartende Einträge werden wirksam, die Zusage an den Admin wird eingelöst | `index.ts:344`, `db.ts:2710/2750` | Diese 26 Namen werden beim nächsten Auftreten gebannt — vorher durchsehen |
| 0.4 | **Ban-Schleife stoppen** — in `banUserGlobally` einen Skip-Pfad für bereits gebannte User ergänzen (der `isBlacklisted()`-Aufruf in `telegram.ts:1051` steuert heute nur den Blacklist-Eintrag, nicht den Ban selbst). Ergänzend in `cluster.ts` bereits gebannte Cluster-Mitglieder überspringen. Spart ~200.000 API-Calls/Monat und beseitigt das Flood-Limit-Risiko | `telegram.ts:1051`, `cluster.ts:214-218` | **positiv:** legitime Bans gehen wieder zuverlässig durch |
| 0.5 | **Middleware-Kette reparieren** — `next()` in `index.ts:1489` ergänzen. Macht den Impersonations-Check auf Nachrichten und 4 Video-Kommandos wieder erreichbar | `index.ts:1489` | Nachrichten-Handler laufen weiter — kurz beobachten |
| 0.6 | **Risk-Score-Logikfehler beheben** — Einmal-Faktoren *vor* dem Setzen der Metadaten auswerten | `risk.ts:238` | ⚠️ **Vorsicht:** Danach zählen +15/+10/+30 tatsächlich. Wegen 0.7 wird das sonst zu vielen Restricts führen. Nur zusammen mit 0.7 ausrollen. |
| 0.7 | **Account-Alter-Heuristik korrigieren oder abschalten.** Die Formel liefert für alle modernen IDs „0 Tage" und damit pauschal +30. Empfehlung: bis zu einer belastbaren Kalibrierung `RISK_ACCOUNT_AGE_BONUS=0` setzen | `risk.ts:32-61`, `.env` | verhindert Massen-Fehlalarme durch 0.6 |
| 0.8 | **`t.me/gruppenname` als Einladungslink erkennen** (bisher nur `t.me/+…`). Genau die Form, die im aktuellen Angriff verwendet wird | `scam.ts:317` | ⚠️ Mitglieder verlinken auch legitime Geldhelden-Gruppen → **eigene Gruppen-IDs auf die Allowlist**, sonst Fehlalarme |
| 0.9 | **`/support/i` entschärfen** — Gewicht von 10 auf 3, oder Wortgrenzen erzwingen. Trifft heute „Kundensupport" | `scam.ts:49` | weniger Fehlalarme |
| 0.10 | **`isDomainAllowed()` auf exakten Domain-Vergleich umstellen** statt `includes()` | `groupIntelligence.ts:156` | schließt Umgehung über `geldhelden.org.xyz.com` |
| 0.11 | **`PROTECTED_NAMES` explizit in `.env` setzen** und um alle real genutzten Schreibweisen ergänzen (Marcos exakter Anzeigename, Nachname, „Geldhelden Marco", Kanalnamen) | `.env` | mehr Treffer im Impersonations-Log |
| 0.12 | **`edited_message` in `allowedUpdates`** aufnehmen | `index.ts:2181` | Scam-Check greift auch bei nachträglicher Bearbeitung |
| 0.13 | **Homoglyphen-Schutz in `checkImpersonation()` verdrahten** — `normalizeText()` aus `scam.ts` vor dem Namensvergleich anwenden. Zwei Zeilen. Schließt die einfachste Umgehung des gesamten Impersonations-Schutzes (kyrillisches „Мarco") | `telegram.ts:1475-1547` | mehr Treffer im Log; keine automatische Sanktion, solange Stufe 1.2 nicht umgesetzt ist |

---

## Stufe 1 — Impersonation aktiv erkennen statt abwarten (1–2 Tage)

Das ist der eigentliche Hebel gegen Punkt 1 des Angriffs.

### 1.1 Profilfoto-Abgleich (der stärkste einzelne Hebel)

`getChat(userId)` liefert `ChatFullInfo.photo.big_file_unique_id`. Zwei Accounts mit demselben Wert haben **dasselbe Profilbild**.

**Umsetzung:**
1. Einmalig die `big_file_unique_id` von Marcos echtem Account und allen Team-Accounts erfassen und als Referenz ablegen
2. Neue Spalten in `users`: `photo_unique_id`, `bio`, `has_private_forwards`
3. Beim Beitritt und beim ersten Nachrichtenkontakt: `getChat` → vergleichen
4. **Treffer = Foto von Marco + fremde User-ID → sofortiger globaler Ban.** Das ist praktisch fälschungssicher und hat nahezu keine Fehlalarmquote.

**Nebenwirkung:** ein zusätzlicher `getChat`-Aufruf pro neuem Mitglied. Bei 47 Joins im September vernachlässigbar; bei Spitzenlasten (August: 2.095 Joins) Rate-Limiting einplanen.

### 1.2 Namensprüfung schärfen und automatisch handeln

`checkImpersonation()` ist gut, tut aber nichts. Vorschlag für Abstufung:

| Ähnlichkeit | Heute | Vorschlag |
|---|---|---|
| ≥95 % oder Foto-Treffer | Log | **Sofort-Ban global + Meldung an Marco** |
| 80–94 % | Log | **Restrict + Alarm mit Ban-Button** (bereits vorhanden) |
| 65–79 % | nichts | Log + beobachten |

Setzt **Maßnahme 0.13 voraus** (Homoglyphen-Normalisierung verdrahten) — ohne die ist jede Verschärfung der Schwellen wirkungslos, weil ein kyrillischer Buchstabe genügt, um an der Prüfung vorbeizukommen.

Zusätzlich als eigenes Signal behandeln: **unsichtbare Zeichen im Namen** (Zero-Width-Space U+200B, Zero-Width-Joiner U+200D, Zero-Width-Non-Joiner U+200C) und **gemischte Schriftsysteme** (lateinische und kyrillische Buchstaben im selben Wort). Beides hat in einem echten Namen praktisch keinen legitimen Grund und ist für sich genommen schon ein starkes Verdachtsmerkmal — unabhängig von der Ähnlichkeit zu einem geschützten Namen.

### 1.3 Umbenennungen erkennen

Heute werden Namen überschrieben, Umbenennungen sind unsichtbar. Vorschlag:
- Neue Tabelle `user_name_history` (user_id, username, first_name, last_name, seen_at)
- Bei jeder Nachricht und jedem Join: aktuelle Werte gegen den letzten Stand vergleichen, bei Abweichung Zeile schreiben
- **Impersonations-Prüfung bei jeder erkannten Umbenennung** — das schließt die Lücke „unauffällig beitreten, später umbenennen"
- Der Zeitverlauf ist außerdem forensisch wertvoll für Meldungen an Telegram

**Nebenwirkung:** ein zusätzlicher DB-Schreibvorgang pro Namensänderung. Vernachlässigbar.

---

## Stufe 2 — Torwächter statt Türsteher (2–3 Tage)

Das ist der Hebel gegen Punkt 2 und 3 des Angriffs: **Strohmänner sollen gar nicht erst hereinkommen.**

### 2.1 Beitritt nur nach Genehmigung

Gruppen auf „Beitritt muss genehmigt werden" umstellen, `chat_join_request` in `allowedUpdates` aufnehmen, und der Bot entscheidet automatisch:

| Situation | Entscheidung |
|---|---|
| Auf Blacklist (ID oder Username) | **automatisch ablehnen** |
| Profilfoto = Marcos Foto | **automatisch ablehnen + Alarm** |
| Namensähnlichkeit ≥80 % zu geschützten Namen | **automatisch ablehnen + Alarm** |
| Bio enthält Scam-Muster (`ChatJoinRequest.bio` ist verfügbar!) | **automatisch ablehnen** |
| Bereits in ≥3 Geldhelden-Gruppen in 24 h | zur manuellen Prüfung zurückstellen |
| Kein Username **und** Account nachweislich neu **und** ≥2 gleichzeitige Anfragen | zur manuellen Prüfung zurückstellen |
| Alles andere | **automatisch genehmigen** |

**Das ist die eigentliche Antwort auf Marcos Username-Idee:** Statt zu sperren, wird bei Verdacht *verlangsamt*. Wer keinen Username hat und sonst unauffällig ist, kommt weiterhin sofort rein — das sind die 1.265 Langzeitmitglieder, die kein Kollateralschaden werden dürfen.

**Nebenwirkungen — ehrlich benannt:**
- Beitritt über Einladungslinks funktioniert danach anders; alle geteilten Links müssen ggf. neu erzeugt werden
- Bei Bot-Ausfall stauen sich Anfragen. Es braucht einen Notfallschalter („bei Ausfall alles genehmigen") und Monitoring
- **Auf einer Gruppe testen, mindestens 2 Wochen, bevor die anderen 61 folgen**

### 2.2 Mini-App-Prüfung (optional, Ausbaustufe)

`sendChatJoinRequestWebApp` erlaubt, dem Beitrittswilligen eine kleine Web-Seite zu zeigen — Rückfrage, Regelbestätigung, Captcha. Die Mini-App bekommt über `WebAppUser.photo_url` sogar Zugriff auf das Profilbild.

Voraussetzung: Der Bot muss `guard_bot` der Gruppe sein — und **wie man das wird, steht nicht in der API-Doku**. Vor einer Planung praktisch an einer Testgruppe klären. Deshalb bewusst als Ausbaustufe nach 2.1, nicht als Voraussetzung.

### 2.3 Sichtbares Namensschild für das Team

`setChatMemberTag` für alle 67 Team-Mitglieder: sichtbares Label „Geldhelden Team" an jeder Nachricht (`Message.sender_tag`).

**Zwingend dazu:** `can_edit_tag` in den `ChatPermissions` der Gruppe deaktivieren — sonst kann sich jeder Fake-Marco denselben Tag selbst geben, und die Maßnahme wird zum Bumerang.

Aufwand: ~2 Stunden. Wirkung: Mitglieder sehen auf einen Blick, wer echt ist.

---

## Stufe 3 — Frühwarnung und Meldeweg (1–2 Tage)

Heute erfährt Marco von einem Angriff erst, wenn ein Mitglied ihn privat anschreibt. Das ist der langsamste Teil der Kette.

### 3.1 `/melde` — Meldekommando für alle Mitglieder

Ein Mitglied leitet die verdächtige Nachricht in die Gruppe oder direkt an den Bot weiter und schreibt `/melde`. Der Bot:
1. Liest `forward_origin`
   - `MessageOriginUser` → **numerische ID direkt verfügbar** → automatisch in die Beobachtungsliste, Alarm an Marco mit Ein-Klick-Ban-Button
   - `MessageOriginHiddenUser` → nur der Anzeigename → als Muster speichern, Alarm mit Kontext
2. Extrahiert alle enthaltenen `t.me`-Links → prüft, ob die Zielgruppe bereits bekannt/gesperrt ist
3. Bestätigt dem Melder **per Ephemeral Message** (nur für ihn sichtbar, kein Gruppen-Spam)
4. Legt den Vorgang in einer neuen Tabelle `reports` ab

**Das ist die größte Zeitersparnis im ganzen Plan:** Meldung → Sperre in Minuten statt Stunden, und jede Meldung reichert automatisch die Musterdatenbank an.

### 3.2 Honigtopf-Konten

2–3 unauffällige Konten (normale Vornamen, Profilbild, kein Username — genau das Profil, das die Angreifer anschreiben) in allen 62 Gruppen. Diese Konten:
- schreiben nie
- werden von den Strohmännern als Erste kontaktiert
- eingehende Privatnachrichten werden automatisch ausgewertet und alarmieren

**Vorbehalte, die vor der Umsetzung geklärt werden müssen:**
- Über die **Bot** API geht das **nicht** — private Nachrichten an einen Bot kommen nur, wenn der Bot angeschrieben wird, und Scammer schreiben Bots nicht an. Es bräuchte einen echten Nutzer-Account über MTProto (Telethon o.ä.). Das ist laut `CLAUDE.md` ausdrücklich unerwünscht („NO TELETHON!"). **Alternative:** Ein manuell betreutes Zweitkonto (z. B. eines Team-Mitglieds), das Verdächtiges einfach per `/melde` weiterleitet. Deutlich weniger Aufwand, fast dieselbe Wirkung.
- Mehrere Telegram-Konten pro Person brauchen je eine Telefonnummer

**Empfehlung:** mit 2–3 eingeweihten Team-Mitgliedern als „menschliche Honigtöpfe" starten, die konsequent `/melde` nutzen. Technische Automatisierung erst, wenn sich das Muster als stabil erweist.

### 3.3 Tagesbericht statt Wochenbericht

`/weekly` ist ein Platzhalter. Vorschlag: täglicher Kurzbericht in den Admin-Chat — neue Impersonations-Verdachtsfälle, Meldungen, Cluster-Treffer, abgelehnte Beitrittsanfragen. Aufwand ~3 Stunden, `dailyBriefing.ts` existiert bereits als Grundlage.

---

## Stufe 4 — Durchlauf über alle 62 Gruppen (0,5 Tage + Laufzeit)

Marcos Idee eines Reinigungslaufs — machbar, aber die Reihenfolge ist entscheidend.

**Erst nach Stufe 1**, sonst fehlen die Erkennungsmerkmale.

1. **Nur lesend, ohne jede Aktion:** über alle 62 Gruppen laufen, für jedes Mitglied `getChat` aufrufen, `photo.big_file_unique_id`, `bio`, Namen erfassen und gegen die Referenzen prüfen
2. **Bericht erzeugen**, nicht sperren: Liste aller Verdachtsfälle mit Ähnlichkeitswert, Foto-Treffer, Gruppenzugehörigkeit
3. **Marco entscheidet** — Sammelfreigabe per Kommando
4. Erst dann sperren

**Zwingende Randbedingungen:**
- **Telegram-Rate-Limits beachten.** Bei ~7.200 bekannten Mitgliedern und ~1 Anfrage/Sekunde dauert der Durchlauf ~2 Stunden. Der bestehende Baseline-Scan (`scan.ts`) nutzt bereits 200 ms Pause — als Vorlage geeignet
- **Erst 0.4 umsetzen** (Ban-Schleife), sonst kollidiert der Durchlauf mit den 200.000 überflüssigen API-Calls
- `getChat` liefert nur für Nutzer Daten, deren Privatsphäre-Einstellungen es zulassen. Fehlschläge sind normal und **dürfen nicht als Risiko gewertet werden** — das ist der Fehler, der in `risk.ts:96-97` heute gemacht wird (fehlgeschlagener Foto-Abruf = „kein Foto" = Risikopunkte)
- **Kein automatisches Sperren im ersten Durchlauf.** Nur Bericht.

---

## Stufe 5 — Aufklärung der Mitglieder (0,5 Tage, größte Wirkung pro Aufwand)

Technik allein löst das nicht. Der Angriff funktioniert, weil Mitglieder nicht wissen, dass Marco sie nie zuerst anschreibt.

**Eine feste, überall identische Regel:**

> **Marco schreibt dich nie zuerst an.**
> Nicht über Gewinnspiele. Nicht über Investments. Nicht über „exklusive Gruppen".
> Wer das tut, ist eine Fälschung — egal wie echt das Profilbild aussieht.
> Melde es sofort mit `/melde` (Nachricht weiterleiten + `/melde` schreiben).

**Wohin:**
1. **Angepinnte Nachricht in allen 62 Gruppen** — automatisiert machbar über die bestehende Gruppen-Iteration
2. **In die Willkommensnachricht** (`welcomeTemplates.ts` / `config.ts:284`) — die aktuelle Formulierung „Wenn dir jemand ‚Support' anbietet → bitte melden" ist zu schwach und nennt keinen Weg
3. **Ins Gruppenregelwerk**
4. **Einmalige Ansage in allen Gruppen** beim Rollout

**Warum das so wirksam ist:** Es ist die einzige Maßnahme, die auch dann greift, wenn der Angreifer alles Technische umgeht. Und sie kostet einen halben Tag.

---

## Übersicht

| Stufe | Inhalt | Aufwand | Risiko für Mitglieder | Wirkung gegen den Angriff |
|---|---|---|---|---|
| **0** | Token rotieren, Reparaturen | 0,5 T | keines | mittel — macht Bestehendes erst wirksam |
| **1** | Foto-Hash, Namensprüfung, Umbenennungs-Historie | 1–2 T | sehr gering | **hoch** — trifft Punkt 1 |
| **2** | Beitrittsgenehmigung, Team-Tags | 2–3 T | mittel — Rollout gestaffelt | **sehr hoch** — trifft Punkt 2+3 |
| **3** | `/melde`, Frühwarnung, Tagesbericht | 1–2 T | keines | **hoch** — Reaktionszeit von Stunden auf Minuten |
| **4** | Durchlauf über 62 Gruppen | 0,5 T + 2 h | gering, wenn nur Bericht | hoch — einmalige Bereinigung |
| **5** | Aufklärung, Pinned Message | 0,5 T | keines | **hoch** — wirkt auch bei technischer Umgehung |

**Empfohlene Reihenfolge:** 0 → 5 → 1 → 3 → 4 → 2

Stufe 5 vorziehen, weil sie sofort wirkt und nichts kostet. Stufe 2 zuletzt, weil sie den größten Eingriff darstellt und am gründlichsten getestet werden muss.

---

## Was bewusst nicht vorgeschlagen wird

- **Automatischer Bann bei fehlendem Username** — durch die Daten in Teil 2 widerlegt. Träfe 1.265 Langzeitmitglieder, um ein Signal zu nutzen, das Scammer *seltener* auszeichnet als normale Mitglieder.
- **Telethon / Nutzer-Account-Automatisierung** — laut `CLAUDE.md` ausgeschlossen, und mit echtem Sperrrisiko für den betroffenen Account verbunden.
- **Verlassen auf Telegrams `verifyUser`** — es gibt kein auslesbares `is_verified`-Feld, und die Voraussetzungen sind nicht dokumentiert. Als alleinige Maßnahme unbrauchbar.

---

## Quellen

- [Telegram Bot API — Referenz (Stand 10.3, 24.08.2026)](https://core.telegram.org/bots/api)
- [Telegram Bot API — Changelog](https://core.telegram.org/bots/api-changelog)
- [Telegram — Third-Party Verification](https://telegram.org/verify)
- [How to report a scammer on Telegram (2026)](https://www.redpoints.com/blog/how-to-report-scam-on-telegram/) — @NoToScam, abuse@telegram.org
- [Bytescare — How to Report Impersonation on Telegram](https://bytescare.com/blog/how-to-report-impersonation-on-telegram)
- [Best Telegram Anti-Spam Bots in 2026: Combot vs Rose vs ModerAI](https://medium.com/@PersonymAi/best-telegram-anti-spam-bots-in-2026-combot-vs-rose-vs-moderai-4cdcceb2cdbb)
- [Metricgram — Best Telegram Anti-Spam Bots 2026](https://metricgram.com/blog/telegram-anti-spam-bots)
- [collony.ai — The 7 Best Telegram Moderation Bots in 2026](https://www.collony.ai/blog/best-telegram-moderation-bots)
- [SlowMist — Fake Safeguard Scam on Telegram](https://slowmist.medium.com/new-scam-technique-fake-safeguard-scam-on-telegram-bb4803bad521)
- [Gridinsoft — Telegram App Scams 2026](https://blog.gridinsoft.com/top-11-latest-telegram-scams/)
- [tg-watchdog (GitHub) — Join-Request-basierter Schutz](https://github.com/astrian/tg-watchdog)

**Interne Belege:** `geldhelden-shield/src/` (risk.ts, scam.ts, telegram.ts, admin.ts, index.ts, db.ts, cluster.ts, cluster2.ts, linkPolicy.ts, config.ts) sowie die Produktionsdatenbank `/root/Geldhelden Shield/data/shield.db` auf `77.42.42.65` (lesend, Snapshot vom 04.09.2026).
