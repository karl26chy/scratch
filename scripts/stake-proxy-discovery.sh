#!/bin/bash

echo "🔍 STAKE DISCOVERY CON PROXY"
echo "============================"

# 1. Verificar proxy
if [ -z "$PROXY_API_KEY" ]; then
    echo "❌ PROXY_API_KEY no configurada"
    echo "💡 Configura .env con PROXY_ENABLED=true"
    exit 1
fi

# 2. Ejecutar discovery en Docker
docker compose exec -T backend /app/node_modules/.bin/tsx src/scripts/stake-kicker-discovery.ts

# 3. Mostrar resultados
echo ""
echo "📊 RESULTADOS:"
if [ -f "apps/backend/debug/stake-kicker-responses.json" ]; then
    cat apps/backend/debug/stake-kicker-responses.json | jq '.[] | {url, status, contentType}'
else
    echo "⚠️ No se encontraron resultados"
fi
