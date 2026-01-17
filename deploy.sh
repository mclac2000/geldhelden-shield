#!/bin/bash
# ============================================================================
# Geldhelden Shield – Deploy Script
# ============================================================================
# Verwendung: ./deploy.sh
#
# Was es tut:
# 1. Holt neuesten Code von GitHub
# 2. Baut Docker-Container neu (falls nötig)
# 3. Startet Services neu
# ============================================================================

set -e  # Stoppt bei Fehlern

echo "═══════════════════════════════════════════════════════════"
echo "🚀 Geldhelden Shield – Deployment"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Zum Projektverzeichnis wechseln
cd "$(dirname "$0")"

# 1. Neuesten Code holen
echo "📥 Hole neuesten Code von GitHub..."
git fetch origin
git reset --hard origin/main
echo "✓ Code aktualisiert"
echo ""

# 2. Prüfen ob Docker-Rebuild nötig
echo "🐳 Prüfe Docker-Images..."
if git diff --name-only HEAD~1 HEAD | grep -qE '(Dockerfile|package.*json)'; then
    echo "📦 Änderungen erkannt – baue Images neu..."
    docker-compose build --no-cache
else
    echo "✓ Kein Rebuild nötig"
fi
echo ""

# 3. Services neu starten
echo "🔄 Starte Services neu..."
docker-compose up -d bot
echo "✓ Bot gestartet"
echo ""

# 4. Status anzeigen
echo "═══════════════════════════════════════════════════════════"
echo "✅ Deployment abgeschlossen!"
echo "═══════════════════════════════════════════════════════════"
echo ""
docker-compose ps
echo ""
echo "📋 Logs anzeigen: docker-compose logs -f bot"
