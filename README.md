# Geldhelden Shield - Telegram Anti-Scam Bot

Ein professioneller Telegram Bot zur automatischen Erkennung und Bekämpfung von Scammern über mehrere Gruppen hinweg.

## Features

- ✅ **Multi-Gruppen-Tracking**: Verfolgt User-Joins über 40+ Telegram-Gruppen
- ✅ **Automatische Risiko-Bewertung**: Erkennt verdächtige Joining-Patterns
- ✅ **Shadow-Restrict**: Automatische Einschränkung verdächtiger User ohne offensichtliche Benachrichtigung
- ✅ **Globale Blacklist**: Bannt User automatisch in allen bekannten Gruppen
- ✅ **SQLite-Datenbank**: Lokale, performante Datenspeicherung
- ✅ **Admin-Commands**: Vollständige Kontrolle über User-Status und Aktionen
- ✅ **Long Polling**: Zuverlässiger Betrieb ohne Webhook-Setup

## Anforderungen

- Node.js >= 18.0.0, < 25.0.0 (empfohlen: 18.x oder 20.x LTS)
  - **Hinweis**: Node.js 25.x hat Kompatibilitätsprobleme mit `better-sqlite3`. Nutze Node.js 20.x LTS oder Docker.
- npm oder yarn
- Telegram Bot Token (von [@BotFather](https://t.me/BotFather))
- Build-Tools (für `better-sqlite3`):
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `build-essential`, `python3`, `make`, `g++`
  - **Windows**: Visual Studio Build Tools

## Schnellstart (Lokale Installation)

### 1. Repository klonen

```bash
git clone <repository-url>
cd geldhelden-shield
```

### 2. Dependencies installieren

```bash
npm install
```

### 3. Konfiguration

Kopiere `.env.example` zu `.env` und fülle die Werte aus:

```bash
cp .env.example .env
```

Bearbeite `.env`:

```env
BOT_TOKEN=dein_bot_token_hier
ADMIN_LOG_CHAT=-1001234567890
ADMIN_IDS=123456789,987654321
JOIN_WINDOW_HOURS=24
JOIN_THRESHOLD=5
ACTION_MODE=restrict

# Risk Scoring - Gewichtungen
RISK_JOIN_EVENT=10
RISK_MULTI_JOIN_BONUS=20
RISK_ACCOUNT_AGE_THRESHOLD=7
RISK_ACCOUNT_AGE_BONUS=30
RISK_NO_USERNAME=15
RISK_NO_PROFILE_PHOTO=10

# Risk Scoring - Schwellenwerte
RISK_RESTRICT_THRESHOLD=60
RISK_BAN_THRESHOLD=120

# Risk Scoring - Decay
RISK_DECAY_AMOUNT=20
RISK_DECAY_HOURS=24
RISK_AUTO_UNRESTRICT_BUFFER=20

TZ=Asia/Manila
```

**Erklärung der Variablen:**
- `BOT_TOKEN`: Token von @BotFather
- `ADMIN_LOG_CHAT`: Chat-ID wo Vorfälle geloggt werden (z.B. private Gruppe oder Kanal)
- `ADMIN_IDS`: Komma-separierte Liste deiner Telegram User-IDs (ohne Leerzeichen)
- `JOIN_WINDOW_HOURS`: Zeitfenster für Join-Erkennung (Standard: 24)
- `JOIN_THRESHOLD`: Anzahl Joins die als verdächtig gelten (Standard: 5)
- `ACTION_MODE`: `restrict` (Shadow-Restrict) oder `ban` (direkter Ban)
- `TZ`: Zeitzone (Standard: Asia/Manila)

### 4. Bot starten

**Development-Modus:**
```bash
npm run dev
```

**Production-Modus:**
```bash
npm run build
npm start
```

## Lokale Einrichtung (ohne Server-Arbeit)

Diese Anleitung zeigt dir, wie du **alles lokal auf macOS konfigurierst** und danach nur noch per Drag & Drop auf den Server kopieren musst. Kein Docker, kein SSH, kein Server-Zugriff erforderlich!

### Schritt 1: Dependencies installieren

Stelle sicher, dass Node.js >= 18.0.0 installiert ist (empfohlen: 20.x LTS), dann installiere die Dependencies:

```bash
npm install
```

### Schritt 2: Bot-Token konfigurieren

Die `.env` Datei im Projektroot ist bereits vorbereitet und enthält den `BOT_TOKEN`. Falls die Datei nicht existiert, kopiere `.env.example` zu `.env`:

```bash
cp .env.example .env
```

Die `.env` Datei enthält bereits:
```
BOT_TOKEN=7956976212:AAGwNWFw8IKhWZ-SqYu31HI-Sj_FNySVcLY
ADMIN_IDS=
ADMIN_LOG_CHAT=
ACTION_MODE=restrict
```

### Schritt 3: Telegram-IDs automatisch abrufen

Führe das Helper-Script aus, um automatisch deine Telegram-IDs zu finden:

```bash
npm run get-ids
```

**Was passiert?**
1. Das Script ruft die Telegram API `getUpdates` auf
2. Es analysiert alle verfügbaren Updates vom Bot
3. Es extrahiert alle gefundenen **Chat-IDs** (Gruppen, Kanäle, private Chats)
4. Es extrahiert alle gefundenen **User-IDs** (nur echte User, keine Bots)
5. Es gibt eine übersichtliche Ausgabe in der Konsole

**Wichtig:** Damit das Script IDs findet, musst du zuvor:
- Dem Bot eine **private Nachricht** gesendet haben, ODER
- Den Bot zu einer **Gruppe hinzugefügt** haben, ODER
- Eine **Aktion** in einer Gruppe durchgeführt haben, wo der Bot Mitglied ist

### Schritt 4: IDs in .env eintragen

Das Script gibt dir am Ende eine fertige Konfiguration aus, die so aussieht:

```
═══════════════════════════════════════════════════════════
📋 FERTIGE KONFIGURATION FÜR .env:
═══════════════════════════════════════════════════════════

ADMIN_IDS=123456789,987654321
ADMIN_LOG_CHAT=-1001234567890
```

**Kopiere diese Werte** und trage sie in deine `.env` Datei ein:

```env
BOT_TOKEN=7956976212:AAGwNWFw8IKhWZ-SqYu31HI-Sj_FNySVcLY
ADMIN_IDS=123456789,987654321
ADMIN_LOG_CHAT=-1001234567890
ACTION_MODE=restrict
```

**Erklärung:**
- **ADMIN_IDS**: Deine Telegram User-ID(n), komma-separiert ohne Leerzeichen. Mehrere Admins: `123456789,987654321,111222333`
- **ADMIN_LOG_CHAT**: Die Chat-ID der Gruppe oder des Kanals, wo Logs gesendet werden sollen. Normalerweise eine negative Zahl (z.B. `-1001234567890` für Gruppen)

### Schritt 5: Bot lokal testen (optional)

Starte den Bot lokal, um sicherzustellen, dass alles funktioniert:

```bash
npm run dev
```

Der Bot sollte jetzt starten und in der Konsole Logs ausgeben. Drücke `Ctrl+C` um den Bot zu stoppen.

### Schritt 6: Auf Server deployen

Jetzt kannst du einfach den **gesamten Projektordner** per Drag & Drop auf deinen Server kopieren (z.B. per SFTP, SCP, oder Datei-Explorer).

**Auf dem Server:**

1. Öffne ein Terminal und navigiere zum Projektordner
2. Starte den Bot mit Docker Compose:

```bash
docker compose up -d
```

3. Prüfe die Logs:

```bash
docker compose logs -f bot
```

**Fertig!** Der Bot läuft jetzt auf dem Server.

### Troubleshooting

**"Keine Updates gefunden" beim `npm run get-ids`:**
- Stelle sicher, dass du dem Bot eine private Nachricht gesendet oder ihn zu einer Gruppe hinzugefügt hast
- Warte ein paar Sekunden und führe das Script erneut aus
- Prüfe, ob der BOT_TOKEN korrekt ist

**"ADMIN_LOG_CHAT ist leer":**
- Füge den Bot zu einer Gruppe hinzu, wo die Logs gesendet werden sollen
- Führe `npm run get-ids` erneut aus
- Oder verwende die Chat-ID direkt: Öffne die Gruppe im Web-Client, die URL sieht aus wie `https://web.telegram.org/k/#-1001234567890` - die Zahl nach `#` ist die Chat-ID

**"ADMIN_IDS ist leer":**
- Sende dem Bot eine private Nachricht
- Führe `npm run get-ids` erneut aus
- Deine User-ID sollte jetzt in der Ausgabe erscheinen

## Deployment (No-Code / Drag & Drop)

Das Projekt ist vollständig konfiguriert und bereit für den Einsatz.

**So geht's:**

1. **Vorbereitung:** Cursor erledigt alle Konfigurationsschritte automatisch
2. **Hochladen:** Lade den kompletten Projektordner per Mountain Duck auf deinen Server hoch
3. **Starten:** Der Bot wird serverseitig gestartet

Keine lokale Programmierung, keine Terminal-Befehle, keine zusätzlichen Schritte nötig. Einfach hochladen und fertig.

## Bot als Admin zu Gruppen hinzufügen

### Notwendige Bot-Rechte

Der Bot benötigt folgende Administrator-Rechte in allen Gruppen:

- ✅ **Nutzer bannen** (für Ban-Funktionalität)
- ✅ **Nutzer einschränken** (für Restrict-Funktionalität)
- ✅ **Nutzer zu Gruppen hinzufügen** (optional, für Join-Tracking)

### Bot hinzufügen

1. Öffne die Gruppeneinstellungen
2. Gehe zu "Administratoren" → "Administrator hinzufügen"
3. Suche nach deinem Bot (z.B. `@dein_bot_name`)
4. Setze die oben genannten Rechte
5. Speichere

Der Bot registriert sich automatisch, wenn er einer Gruppe hinzugefügt wird.

**Manuelle Registrierung:**

Wenn der Bot bereits in der Gruppe ist, verwende den Command:
```
/register
```
(Erfordert Admin-Rechte)

## Admin-Commands

Alle Commands erfordern, dass der ausführende User in `ADMIN_IDS` enthalten ist.

### `/status <user_id>`

Zeigt Status, Join-Statistik und letzte Aktionen für einen User.

**Beispiel:**
```
/status 123456789
```

### `/allow <user_id>`

Setzt User-Status auf "ok" und entfernt alle Restrictions in allen Gruppen.

**Beispiel:**
```
/allow 123456789
```

### `/ban <user_id>`

Setzt User-Status auf "banned" und bannt den User in ALLEN registrierten Gruppen.

**Beispiel:**
```
/ban 123456789
```

### `/unrestrict <user_id>`

Entfernt nur Restrictions (ohne Status-Änderung auf "ok").

**Beispiel:**
```
/unrestrict 123456789
```

### `/groups`

Zeigt die Anzahl registrierter Gruppen.

**Beispiel:**
```
/groups
```

## Deployment auf Server

### Docker Compose (Empfohlen)

1. Stelle sicher, dass Docker und Docker Compose installiert sind:
```bash
docker --version
docker-compose --version
```

2. Erstelle `.env` Datei (siehe Schnellstart)

3. Starte den Container:
```bash
docker-compose up -d
```

4. Prüfe Logs:
```bash
docker-compose logs -f bot
```

5. Stoppe den Bot:
```bash
docker-compose down
```

### Manuelles Deployment

1. Auf dem Server:
```bash
# Repository klonen
git clone <repository-url>
cd geldhelden-shield

# Dependencies installieren
npm ci

# Build
npm run build

# Starte mit PM2 (empfohlen)
npm install -g pm2
pm2 start dist/index.js --name geldhelden-shield
pm2 save
pm2 startup
```

### Systemd Service (Alternative)

Erstelle `/etc/systemd/system/geldhelden-shield.service`:

```ini
[Unit]
Description=Geldhelden Shield Telegram Bot
After=network.target

[Service]
Type=simple
User=dein-user
WorkingDirectory=/path/to/geldhelden-shield
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Dann:
```bash
sudo systemctl daemon-reload
sudo systemctl enable geldhelden-shield
sudo systemctl start geldhelden-shield
sudo systemctl status geldhelden-shield
```

## Datenbank

Die SQLite-Datenbank wird automatisch erstellt beim ersten Start.

**Datenbank-Pfad:**
- Lokal: `./shield.db`
- Docker: `/data/shield.db`

**Tabellen:**
- `groups`: Registrierte Gruppen
- `users`: Getrackte User mit Status und Risk-Score
- `joins`: Alle Join-Events
- `actions`: Alle durchgeführten Aktionen (restrict/ban/unrestrict/allow)

**Backup:**
```bash
# Backup erstellen
cp shield.db shield.db.backup

# Oder mit Docker
docker-compose exec bot cp /data/shield.db /data/shield.db.backup
```

## Funktionsweise

1. **Join-Tracking**: Bot verfolgt alle User-Joins über `new_chat_members` und `chat_member` Events
2. **Risk-Scoring**: Berechnet Risk-Score basierend auf verschiedenen Faktoren (siehe unten)
3. **Automatische Aktion**: Bei Überschreitung der Schwellenwerte:
   - **Restrict**: Risk Score ≥ `RISK_RESTRICT_THRESHOLD` → Shadow-Restrict
   - **Ban**: Risk Score ≥ `RISK_BAN_THRESHOLD` → Global Ban
   - Vorfall wird in ADMIN_LOG_CHAT geloggt
4. **Risk-Decay**: Automatische Verringerung des Risk-Scores alle 24h (-20 Punkte)
5. **Auto-Unrestrict**: Wenn Score unter Threshold fällt → automatisches Unrestrict
6. **Globale Aktionen**: `/ban` Command bannt User in allen registrierten Gruppen

## Risk-Scoring-System

Das Bot verwendet ein deterministisches Risk-Scoring-System zur Bewertung von User-Risiko:

### Risk-Faktoren → Punkte

| Faktor | Punkte | Beschreibung |
|--------|--------|--------------|
| **JOIN_EVENT** | +10 | Pro Gruppenbeitritt (innerhalb 1 Stunde) |
| **MULTI_JOIN_BONUS** | +20 | Wenn >1 Join innerhalb 1 Stunde |
| **ACCOUNT_AGE < 7 Tage** | +30 | Account jünger als 7 Tage |
| **NO_USERNAME** | +15 | User hat keinen @username |
| **NO_PROFILE_PHOTO** | +10 | User hat kein Profilbild |

**Hinweis**: Alle Faktoren sind konfigurierbar via ENV-Variablen (siehe `.env.example`).

### Schwellenwerte → Aktionen

| Score | Aktion | Beschreibung |
|-------|--------|--------------|
| **< 60** | ✅ OK | Keine Aktion |
| **≥ 60** | 🔒 RESTRICT | Shadow-Restrict in aktueller Gruppe |
| **≥ 120** | 🚫 BAN | Global Ban in allen Gruppen |

**Konfiguration**:
- `RISK_RESTRICT_THRESHOLD` = 60 (Standard)
- `RISK_BAN_THRESHOLD` = 120 (Standard)

### Risk-Decay (Automatische Entspannung)

Das System implementiert automatischen Risk-Decay:

- **Alle 24 Stunden**: Risk-Score wird um `RISK_DECAY_AMOUNT` (Standard: 20) reduziert
- **Auto-Unrestrict**: Wenn Score < (`RISK_RESTRICT_THRESHOLD` - `RISK_AUTO_UNRESTRICT_BUFFER`):
  - User wird automatisch unrestricted in allen Gruppen
  - Status wird auf "ok" gesetzt
  - Log: `[Shield] User X auto-unrestricted (risk decay)`

**Beispiel**:
- User hat Score 65 (restricted)
- Nach 24h Decay: Score = 45
- Score < (60 - 20) = 40 → **Auto-Unrestrict ausgeführt**

### Wartungsjob

Ein automatischer Wartungsjob läuft **alle 60 Minuten**:

1. Prüft alle User mit Risk-Score > 0
2. Wendet Decay an (falls fällig)
3. Führt Auto-Unrestrict aus (falls Score unter Threshold)
4. Loggt Ergebnisse in Console

**Hinweis**: Der Wartungsjob startet automatisch beim Bot-Start und läuft kontinuierlich.

## Warum Shadow-Restrict statt direktem Ban?

**Shadow-Restrict** (Standard-Modus) ist die empfohlene Methode zur Bekämpfung von Scammern:

### Vorteile von Shadow-Restrict:

1. **Unauffällig**: User kann weiterhin Nachrichten "schreiben", aber diese werden nicht veröffentlicht
2. **Keine Warnung**: Scammer merkt nicht sofort, dass er blockiert wurde → verliert Zeit
3. **Beweissammlung**: Du kannst weiterhin sehen, was der Scammer versucht zu senden
4. **Reversible**: Einfaches `/unrestrict` oder `/allow` ermöglicht schnelle Korrektur bei False Positives

### Wann Ban verwenden:

- **ACTION_MODE=ban**: Direkter Ban für sofortige Entfernung
- Nützlich wenn du Scammer komplett aus allen Gruppen entfernen willst
- Achtung: Ban kann nicht einfach rückgängig gemacht werden (muss manuell aufgehoben werden)

**Empfehlung**: Verwende Shadow-Restrict (Standard) für automatische Erkennung und Ban nur bei manuellen `/ban` Commands für bestätigte Scammer.

## Telegram Limits & Safety

### Rate-Limits

Der Bot implementiert robusten Rate-Limit-Schutz:

- **350ms Delay** zwischen allen Telegram-Aktionen (automatisch via Queue)
- **FloodWait-Handling**: Automatisches Warten bei Telegram Rate-Limits
- **Retry-Logik**: Ein automatischer Retry bei Rate-Limit-Fehlern

**Telegram API Limits:**
- ~30 Messages/Sekunde pro Bot
- FloodWait kann bis zu mehreren Stunden dauern (selten)
- Der Bot wartet automatisch und führt Retry durch

### Sicherheits-Checks

Der Bot führt vor **jeder** Action automatische Checks durch:

1. **Admin-Protection**: Admin-User (aus `ADMIN_IDS`) werden **niemals** gebannt/restricted
2. **Bot-Protection**: Bot selbst wird **niemals** gebannt/restricted
3. **Group-Admin-Protection**: Gruppen-Administratoren werden **niemals** gebannt/restricted
4. **Silent-Fail**: Bei fehlenden Rechten oder `USER_NOT_PARTICIPANT` → leise überspringen (kein Crash)

### Fehlerbehandlung

Alle Telegram-Aktionen sind in try/catch-Blöcken gekapselt:

- **TelegramForbiddenError**: Fehlende Rechte → leise überspringen
- **TelegramRateLimitError**: Rate-Limit → automatisches Warten + Retry
- **TelegramBadRequestError**: Ungültige Parameter → Fehler loggen, weiter machen
- Keine Crashes bei API-Fehlern

## Was passiert bei False Positives?

### Automatische Erkennung

Wenn ein normaler User fälschlicherweise als Scammer erkannt wird (z.B. legitimer User mit mehreren Joins):

1. **Shadow-Restrict wird ausgeführt** (oder Ban bei `ACTION_MODE=ban`)
2. **Log wird gesendet** → Du siehst es sofort im `ADMIN_LOG_CHAT`
3. **Schnelle Korrektur** möglich via Commands

### Korrektur-Optionen

**Option 1: /allow**
```
/allow <user_id>
```
- Setzt Status auf "ok"
- Entfernt alle Restrictions in **allen** Gruppen
- User kann wieder normal schreiben

**Option 2: /unrestrict**
```
/unrestrict <user_id>
```
- Entfernt nur Restrictions (Status bleibt unverändert)
- Nützlich wenn Status auf "ok" bleiben soll, aber Restrictions entfernt werden

**Option 3: Manuelles Entfernen**
- Via Telegram Gruppen-Einstellungen manuell Unrestrict/Ban entfernen
- Bot erkennt automatisch, dass User wieder normale Rechte hat

### Prävention

Um False Positives zu minimieren:

1. **Threshold anpassen**: `JOIN_THRESHOLD` erhöhen (z.B. von 5 auf 8)
2. **Zeitfenster anpassen**: `JOIN_WINDOW_HOURS` erhöhen (z.B. von 24h auf 48h)
3. **Whitelist-Funktion**: (Zukünftige Funktion) Bestimmte User-IDs immer erlauben

### Best Practices

- **Regelmäßige Logs prüfen**: Schaue täglich in `ADMIN_LOG_CHAT`
- **Threshold bei Bedarf anpassen**: Beobachte False Positive Rate
- **Bei Unsicherheit**: Verwende Shadow-Restrict statt Ban (leichter rückgängig zu machen)

## Fehlerbehebung

### Bot antwortet nicht

- Prüfe ob Bot-Token korrekt ist
- Stelle sicher, dass Bot in den Gruppen Admin-Rechte hat
- Prüfe Logs: `npm run dev` oder `docker-compose logs -f`

### Joins werden nicht erkannt

- Stelle sicher, dass Bot Admin ist und Rechte hat
- Prüfe ob Gruppe registriert ist: `/groups` Command
- Manuelle Registrierung: `/register` in der Gruppe

### Rate-Limit Fehler

- Bot hat eingebauten Rate-Limit-Schutz (350ms Delay zwischen Aktionen)
- **FloodWait-Handling**: Bot wartet automatisch bei Rate-Limits
- Bei sehr vielen Gruppen kann es zu Verzögerungen kommen
- Telegrams Rate-Limit: ~30 Messages/Sekunde
- Alle Actions werden sequenziell über eine Queue abgearbeitet

### Datenbank-Fehler

- Prüfe Schreibrechte im Datenbank-Verzeichnis
- Stelle sicher, dass genug Speicherplatz vorhanden ist
- Bei Docker: Prüfe Volume-Mounts

## Sicherheit

- ⚠️ **Bot-Token geheim halten**: Niemals in Git committen
- ⚠️ **Admin-IDs sicher verwahren**: Nur vertrauenswürdige IDs hinzufügen
- ⚠️ **Datenbank-Backups**: Regelmäßig Backups erstellen
- ⚠️ **Logs nicht öffentlich**: Logs können sensible Daten enthalten

## Lizenz

MIT License

## Support

Bei Problemen oder Fragen, erstelle ein Issue im Repository.
