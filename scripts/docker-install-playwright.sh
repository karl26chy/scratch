#!/bin/bash

echo "🔧 Instalando Playwright en el contenedor Docker..."
echo "=================================================="

# 1. Verificar que el contenedor está corriendo
if ! docker compose ps 2>/dev/null | grep -q "backend.*Up" && ! docker-compose ps 2>/dev/null | grep -q "backend.*Up"; then
    echo "❌ El contenedor backend no está corriendo."
    echo "📋 Ejecutando: docker compose up -d"
    if command -v docker &> /dev/null && docker compose version &> /dev/null; then
      docker compose up -d
    else
      docker-compose up -d
    fi
    sleep 5
fi

# Detectar comando docker compose
COMPOSE="docker compose"
if ! docker compose version &> /dev/null; then
  COMPOSE="docker-compose"
fi

# 2. Instalar navegadores en el contenedor
echo "📦 Instalando Chromium en el contenedor..."
$COMPOSE exec backend npx playwright install chromium

# 3. Instalar dependencias del sistema
echo "📦 Instalando dependencias del sistema..."
$COMPOSE exec backend npx playwright install-deps || $COMPOSE exec backend npx playwright install-deps chromium

# 4. Verificar instalación
echo ""
echo "✅ Verificando instalación:"
$COMPOSE exec backend npx playwright --version

# 5. Probar navegador
echo ""
echo "🧪 Probando navegador en el contenedor..."
$COMPOSE exec backend node -e "
const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.launch({ headless: true });
    console.log('✅ Chromium funciona correctamente en Docker');
    await browser.close();
  } catch (e) {
    console.error('❌ Error con Chromium:', e.message);
    process.exit(1);
  }
})()
"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Playwright instalado correctamente en el contenedor"
    echo "🔴 RECUERDA: Reiniciar el backend: $COMPOSE restart backend"
else
    echo ""
    echo "❌ Error en la instalación. Revisa los logs."
    exit 1
fi
