#!/bin/bash

echo "🧹 Limpiando caché del frontend..."
rm -rf apps/frontend/node_modules/.vite

echo "🧹 Limpiando caché de Vite en backend..."
rm -rf apps/backend/node_modules/.vite

echo "🧹 Limpiando caché de TypeScript..."
rm -rf apps/frontend/dist
rm -rf apps/backend/dist

echo "✅ Caché limpiada correctamente"
echo ""
echo "📋 Próximos pasos:"
echo "1. Reinicia el frontend: cd apps/frontend && npm run dev -- --force"
echo "2. Abre el navegador en modo incógnito"
echo "3. Ve a http://localhost:3000/selector-config"
echo "4. Ejecuta el scraping con los selectores de BetPlay"
