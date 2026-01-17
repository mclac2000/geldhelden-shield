#!/bin/bash
set -e
echo "🚀 Geldhelden Shield – Deployment"
cd "$(dirname "$0")"
echo "📥 Hole neuesten Code von GitHub..."
git fetch origin
git reset --hard origin/main
echo "✓ Code aktualisiert"
echo "🐳 Baue und starte Services neu..."
docker compose up -d --build
echo "✅ Deployment abgeschlossen!"
docker compose ps
