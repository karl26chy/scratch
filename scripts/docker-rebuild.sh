#!/bin/bash

echo "🔄 RECONSTRUYENDO CONTENEDORES CON PLAYWRIGHT"
echo "============================================="

# Detectar comando
COMPOSE="docker compose"
if ! docker compose version &> /dev/null; then
  COMPOSE="docker-compose"
fi

# 1. Detener contenedores
echo "1. Deteniendo contenedores..."
$COMPOSE down

# 2. Limpiar caché de Docker
echo "2. Limpiando caché de Docker..."
docker system prune -f || echo "prune skipped"

# 3. Reconstruir sin caché
echo "3. Reconstruyendo contenedores..."
$COMPOSE build --no-cache

# 4. Levantar contenedores
echo "4. Levantando contenedores..."
$COMPOSE up -d

# 5. Verificar que están corriendo
echo "5. Verificando contenedores..."
$COMPOSE ps

# 6. Instalar Playwright en el contenedor
echo "6. Instalando Playwright en el contenedor..."
$COMPOSE exec backend npx playwright install chromium || echo "install chromium skipped (already in image)"
$COMPOSE exec backend npx playwright install-deps || $COMPOSE exec backend npx playwright install-deps chromium || echo "install-deps skipped"

# 7. Verificar Playwright
echo "7. Verificando Playwright..."
$COMPOSE exec backend npx playwright --version
$COMPOSE exec backend node -e "const { chromium } = require('playwright'); (async () => { const browser = await chromium.launch(); console.log('✅ Playwright funciona en Docker'); await browser.close(); })()"

echo ""
echo "✅ RECONSTRUCCIÓN COMPLETADA"
echo "📋 Backend: http://localhost:4000"
echo "📋 Frontend: http://localhost:3000"
echo "📋 Selectores Custom: http://localhost:3000/selector-config"
