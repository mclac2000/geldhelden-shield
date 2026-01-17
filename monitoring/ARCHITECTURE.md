# Log Health Service – Architektur

## Übersicht

Eigenständiger Monitoring-Service für Geldhelden Shield.
- **Nur Read-Zugriff** auf Docker Logs
- **Fail-safe** – Fehler im Monitor dürfen Bot nicht beeinflussen
- **Separater Bot-Token** für Telegram-Reports

## Verzeichnisstruktur

```
monitoring/
├── src/
│   ├── index.ts           # Haupteinstiegspunkt
│   ├── collector.ts       # Docker Log Collector
│   ├── classifier.ts      # Log-Klassifizierung
│   ├── aggregator.ts      # Fehler-Verdichtung
│   ├── reporter.ts        # Health-Report Generator
│   └── telegram.ts        # Telegram-Versand
├── config.ts              # Konfiguration
├── types.ts               # TypeScript-Typen
├── package.json
├── tsconfig.json
├── Dockerfile
└── README.md
```

## Datenfluss

```
Docker Logs (geldhelden-shield-bot)
        ↓
   [Collector]  ← docker logs --since 24h
        ↓
   [Classifier] ← Pattern-Matching nach Log-Prefixes
        ↓
   [Aggregator] ← Gruppierung + Deduplizierung
        ↓
   [Reporter]   ← Markdown Health-Report
        ↓
   [Telegram]   ← Versand an ADMIN_LOG_CHAT
```

## Log-Klassifizierung

### Severity Levels

| Level | Prefixes | Bedeutung |
|-------|----------|-----------|
| FATAL | `[FATAL]`, `[DB][FATAL]` | Kritisch, sofortige Aufmerksamkeit |
| ERROR | `[ERROR]`, `[Shield][ERROR]` | Fehler, Aktion empfohlen |
| WARN | `[WARN]`, `[DB] Warnung` | Warnung, beobachten |
| INFO | `[JOIN]`, `[WELCOME]`, `[STARTUP]` | Normale Operationen |
| DEBUG | `[DB] operation=` | Detaillierte Logs |

### Aggregations-Regeln

1. **Gleiche Fehlermeldungen** → Zählen, nicht wiederholen
2. **User-spezifische Fehler** → Anonymisieren (user=XXX)
3. **Chat-spezifische Fehler** → Gruppieren nach Chat-ID

## Health-Report Format

```markdown
🩺 **Shield Health Report** – 2026-01-17

## Status: 🟢 HEALTHY | 🟡 WARNINGS | 🔴 CRITICAL

### Zusammenfassung (24h)
- Joins verarbeitet: 142
- Bans ausgeführt: 3
- Welcome gesendet: 89

### ⚠️ Warnungen (5)
- [WARN] Bot has no admin rights: 3× (chat -1001234...)
- [WARN] Team-Liste leer: 2×

### ❌ Fehler (0)
Keine Fehler in den letzten 24h.

### 📊 Metriken
- Uptime: 99.8%
- DB-Writes: 1,234
- Avg Response: 120ms
```

## Konfiguration

```env
# monitoring/.env
MONITOR_BOT_TOKEN=xxx        # Separater Bot für Reports
ADMIN_LOG_CHAT=-100xxx       # Ziel-Gruppe (gleich wie Haupt-Bot)
CONTAINER_NAME=geldhelden-shield-bot
REPORT_SCHEDULE=0 8 * * *   # Täglich um 08:00
LOG_WINDOW_HOURS=24
```

## Docker Integration

```yaml
# docker-compose.yml (Erweiterung)
services:
  monitor:
    build: ./monitoring
    container_name: shield-monitor
    restart: unless-stopped
    depends_on:
      - bot
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro  # Read-only!
    env_file:
      - ./monitoring/.env
```

## Sicherheit

1. **Docker Socket Read-Only** – Nur Log-Lesezugriff
2. **Kein DB-Zugriff** – Monitor liest nur Logs
3. **Separater Bot-Token** – Fehler im Monitor können Bot nicht stören
4. **Fail-Safe** – Bei Fehlern: Log + Skip, kein Crash

## Rollback-Strategie

```bash
# Monitor deaktivieren ohne Bot zu beeinflussen
docker-compose stop monitor

# Bei Problemen: Container entfernen
docker-compose rm -f monitor

# Bot läuft unverändert weiter
```

## Zukunft: GPT-Integration

Der Health-Report wird für zwei GPT-Agenten optimiert:

1. **Log-Health-GPT** – Analysiert Reports, erkennt Patterns
2. **Repair-GPT** – Schlägt Fixes vor, erstellt Patches

Das Report-Format ist bereits Markdown-optimiert für LLM-Konsum.
