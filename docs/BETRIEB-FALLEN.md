# Betrieb: Zugang, Fallen, Handgriffe

Stand 10.09.2026. Diese Seite sammelt, was schon Zeit gekostet hat.

---

## Zugang

- **SSH-Alias: `geldhelden-aps`** (`root@77.42.42.65`), Schlüssel
  `~/.ssh/id_ed25519_geldhelden_deploy`.

  Der frühere Alias **`freihelden-crm` ist entfernt** — er zeigte auf
  `~/.ssh/id_ed25519`, den der Server nicht mehr akzeptiert. Wer ihn noch irgendwo
  stehen sieht, korrigiert ihn bitte. Derselbe Eintrag steht in `~/.ssh/config`.
- Verzeichnis `/root/Geldhelden Shield/`, Container `geldhelden-shield-bot`,
  Datenbank `data/shield.db` (SQLite, **Zeitstempel sind Epoch-Millisekunden**).
- Der Deploy-Schlüssel **auf dem Server ist nur lesend**. Der Server kann nicht
  pushen. Commits gehen vom Mac aus
  (`/Users/marcol/development/geldhelden-shield`, HTTPS-Remote), danach auf dem
  Server `./deploy.sh`.

---

## Fallen

### `docker compose restart` liest die `.env` nicht neu ein

Das ist die teuerste. Der Container läuft mit den **alten** Werten weiter, ohne
Fehlermeldung, ohne Hinweis. Am 10.09.2026 stand in der `.env` bereits
`RISK_ACCOUNT_AGE_BONUS=15`, während der laufende Bot weiter mit `0` rechnete.

```bash
# Richtig — erzeugt den Container neu und liest die Umgebung ein:
cd "/root/Geldhelden Shield" && docker compose up -d

# Und danach IMMER nachsehen, ob es angekommen ist:
docker exec geldhelden-shield-bot printenv | grep -E "RISK_|USERNAME_GATE|FIRST_MESSAGE"
```

Eine Abschaltung, die man nicht nachgesehen hat, ist keine Abschaltung.

### `deploy.sh` macht `git reset --hard origin/main`

Uncommittete Änderungen an versionierten Dateien sind danach weg. `.env` und die
`.env.backup-*` sind gitignored und überleben. Vor jedem Deploy:

```bash
cd "/root/Geldhelden Shield" && git status --porcelain | grep -v '^??'
```

### Messskripte laufen im Container, nicht auf dem Host

`better-sqlite3` ist gegen die Node-Version des Containers gebaut. Auf dem Host
scheitert es mit `libnode.so.72: cannot open shared object file`.

```bash
docker exec -e SHIELD_DB=/data/shield.db geldhelden-shield-bot npx tsx scripts/measure-account-age.ts
```

Neue Skripte sind erst nach einem Deploy im Abbild. Für einen schnellen Test:
`docker cp scripts/xyz.ts geldhelden-shield-bot:/app/scripts/`

---

## Datenfallen in `shield.db`

### 27 negative Kennungen und Dienstkonten in `users`

Das sind **keine Menschen**: negative Kennungen entstehen durch Beiträge im Namen
eines Kanals oder durch anonyme Admins, `777000` ist Telegrams eigener
Dienstabsender für Anmeldecodes.

**Jede Messung, die sie nicht filtert, zählt Kanalbeiträge wie Mitglieder.**

```sql
WHERE user_id > 0
  AND user_id NOT IN (777000, 42777, 136817688, 1087968824, 1271266957, 5434988373)
```

Liste aus `core.telegram.org/api/peers`: Service Notifications, Telegram Support,
Channel_Bot, GroupAnonymousBot, Replies Bot, Anti-Spam Bot.

### Der Importtag 27.08.2026

1.318 „Beitritte" innerhalb einer Minute in zwei Gruppen. Kein Zulauf, ein Import.
Aus jeder Zeitreihe ausschließen:

```sql
AND date(joined_at/1000,'unixepoch') <> '2026-08-27'
```

### Tote Spalten

`users.username`, `users.first_name`, `users.last_name` sind bei **allen** Konten
leer. Nur die Ja/Nein-Kennzeichen (`has_username`, `has_profile_photo`) werden
gepflegt.

### `has_username = 0` heißt nicht immer „kein Benutzername"

Die Spalte ist `NOT NULL DEFAULT 0`. Bei 1.734 Konten wurden nie Profildaten
abgefragt — dort steht die 0 für „nie gemessen". Wer nur belastbare Fälle will,
schränkt auf `account_created_at IS NOT NULL` ein.

### Es sind 54 aktive Gruppen, nicht 62

Dazu 9 stillgelegte, 63 insgesamt erfasst. Die Zahl 62 steht noch in älteren
Notizen.

---

## Regeln ein- und ausschalten

| Regel | Schalter | Stand 10.09.2026 |
|---|---|---|
| Zutritt ohne Benutzernamen | `USERNAME_GATE_ENABLED` | **aus** (wirkt nicht, siehe Messung) |
| Kontoalter im Risiko | `RISK_ACCOUNT_AGE_BONUS` / `_THRESHOLD` | **15 / 365 Tage**, scharf seit 10.09. |
| Erstnachrichten-Prüfung | `FIRST_MESSAGE_CHECK_ENABLED` / `_AUTO_BAN` | an, scharf seit 05.09. |
| Profilprüfung | `PROFILE_CHECK_ENABLED` / `PROFILE_AUTO_BAN` | an |

Alle wirken über die `.env` — also `docker compose up -d`, nicht `restart`.

---

## Was in `.claude/CLAUDE.md` gehört

Diese Datei konnte aus der Arbeitssitzung heraus nicht geschrieben werden
(Schreibschutz). Bitte dort ergänzen:

> SSH-Alias ist **`geldhelden-aps`**, Schlüssel `id_ed25519_geldhelden_deploy`.
> `freihelden-crm` ist entfernt.
> Vor Änderungen an Zutrittsregeln: `docs/MESSUNG-ZUTRITTSREGELN-2026-09-10.md`.
> Betriebsfallen: `docs/BETRIEB-FALLEN.md`.
