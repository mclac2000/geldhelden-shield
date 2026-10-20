#!/bin/bash
set -e
echo "🚀 Geldhelden Shield – Deployment"
cd "$(dirname "$0")"
echo "📥 Hole neuesten Code von GitHub..."
git fetch origin
git reset --hard origin/main
echo "✓ Code aktualisiert"
echo "🧪 Selbsttests (npm test, seit 20.10.2026: rote Tests = kein Neustart)..."
if ! npm test >/tmp/shield-selbsttests.log 2>&1; then
  echo "❌ Selbsttests rot – Container bleibt auf dem alten Stand. Log: /tmp/shield-selbsttests.log"
  tail -20 /tmp/shield-selbsttests.log
  exit 1
fi
echo "✓ Selbsttests grün"
echo "🐳 Baue und starte Services neu..."
docker compose up -d --build
echo "✅ Deployment abgeschlossen!"
docker compose ps
