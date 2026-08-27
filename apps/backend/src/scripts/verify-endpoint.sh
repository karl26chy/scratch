#!/bin/bash

echo "🔍 Verificando endpoint de scraping..."

# 1. Verificar que el backend está corriendo
echo "1. Verificando backend..."
curl -s http://localhost:4000/api/health || curl -s http://localhost:4000/api/v1/health || {
  echo "❌ Backend no está corriendo. Ejecuta: npm run dev"
  exit 1
}
echo "✅ Backend responde"

# 2. Verificar que el endpoint existe
echo "2. Verificando endpoint /api/scrape/custom..."
RESPONSE=$(curl -s -X POST http://localhost:4000/api/scrape/custom \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.betplay.com/apuestas-deportivas/futbol","selectors":{"events":"[id*=\"table-list\"] > li:first-child","homeTeam":".KambiBC-event-participants__name-participant-name:first-child","awayTeam":".KambiBC-event-participants__name-participant-name:last-child","oddsHome":".KambiBC-betty-outcome:first-child","oddsDraw":".KambiBC-betty-outcome:nth-child(2)","oddsAway":".KambiBC-betty-outcome:last-child"}}')

echo "$RESPONSE" | head -c 500
echo ""

# Intentar parsear status con jq si existe, sino grep
if command -v jq &> /dev/null; then
  echo "$RESPONSE" | jq .status 2>/dev/null || echo "$RESPONSE" | grep -o '"status":"[^"]*"'
else
  echo "$RESPONSE" | grep -o '"status":"[^"]*"'
fi

echo ""
echo "✅ Verificación completada"
echo "   Tip: 404 = endpoint no existe | 423 = captcha | 200 success = OK"
