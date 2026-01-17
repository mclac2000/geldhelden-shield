# Shield Monitor – Log Health Service

Eigenständiger Monitoring-Service für Geldhelden Shield. Sammelt Docker Logs, klassifiziert Fehler und sendet tägliche Health-Reports an Telegram.

## Features

- 📊 **Automatische Log-Analyse** – Klassifiziert Logs nach Severity (FATAL/ERROR/WARN/INFO)
- 🔄 **Fehler-Aggregation** – Dedupliziert und gruppiert gleiche Fehler
- 📱 **Telegram-Reports** – Sendet kompakte Health-Reports an Admin-Gruppe
- 🔒 **Fail-Safe** – Separater Service, kann Bot nicht beeinflussen
- 🤖 **GPT-Ready** – Report-Format optimiert für Log-Health-GPT & Repair-GPT

## Schnellstart

### 1. Konfiguration

```bash
cd monitoring
cp .env.example .env
```

Bearbeite `.env`:

```env
MONITOR_BOT_TOKEN=dein_monitor_bot_token    # Separater Bot!
ADMIN_LOG_CHAT=-100123456789                # Gleich wie Haupt-Bot
CONTAINER_NAME=geldhelden-shield-bot
LOG_WINDOW_HOURS=24
REPORT_SCHEDULE=0 8 * * *                   # Täglich 08:00
```

### 2. Manueller Test

```bash
# Einmaliger Report (ohne Scheduler)
npm run report

# Mit initialem Report + Scheduler
npm run dev -- --initial
```

### 3. Docker Deployment

Erweitere die `docker-compose.yml` im Hauptverzeichnis:

```yaml
services:
  # ... bestehender bot service ...

  monitor:
    build: ./monitoring
    container_name: shield-monitor
    restart: unless-stopped
    depends_on:
      - bot
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    env_file:
      - ./monitoring/.env
    networks:
      - shield-network
```

Dann starten:

```bash
docker-compose up -d monitor
```

## Report-Beispiel

```markdown
🩺 **Shield Health Report** – 2026-01-17

## Status: 🟢 HEALTHY

📅 Zeitraum: 08:00:00 – 08:00:00 (24h)

### 📊 Zusammenfassung
• Joins verarbeitet: 142
• Bans ausgeführt: 3
• Restricts: 12
• Welcome gesendet: 89
• Welcome übersprungen: 41
• DB-Operationen: 1,234
• Log-Zeilen gesamt: 5,678

### ❌ Fehler (0)
_Keine Fehler in den letzten 24h._

### ⚠️ Warnungen (5)
• [WARN] Bot has no admin rights: chat=XXX (3×)
• [DB] Migration Warnung: username Spalte existiert (2×)
```

## Architektur

```
Docker Logs (geldhelden-shield-bot)
        ↓
   [Collector]  ← docker logs --since 24h
        ↓
   [Classifier] ← Pattern-Matching
        ↓
   [Aggregator] ← Gruppierung + Dedup
        ↓
   [Reporter]   ← Markdown Report
        ↓
   [Telegram]   ← Versand
```

Siehe [ARCHITECTURE.md](./ARCHITECTURE.md) für Details.

## Sicherheit

- **Read-Only Docker Socket** – Nur Log-Lesezugriff
- **Kein DB-Zugriff** – Monitor liest nur Logs
- **Separater Bot-Token** – Fehler im Monitor können Bot nicht stören
- **Fail-Safe** – Bei Fehlern: Log + Skip, kein Crash

## Commands

```bash
# Development
npm run dev           # Startet mit ts-node
npm run dev -- --once # Einmaliger Report

# Production
npm run build         # TypeScript kompilieren
npm start             # Scheduler-Modus
npm run report        # Einmaliger Report
```

## Rollback

```bash
# Monitor deaktivieren (Bot läuft weiter)
docker-compose stop monitor

# Container entfernen
docker-compose rm -f monitor

# Bot bleibt unverändert
```

## Lizenz

MIT – Teil von Geldhelden Shield
