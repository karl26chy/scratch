#!/bin/bash

echo "🔄 Instalando Playwright y navegadores..."

# 1. Instalar navegadores en el backend
cd apps/backend
npx playwright install chromium

# 2. Verificar instalación
echo "✅ Playwright instalado: $(npx playwright --version)"

# 3. Probar navegador
node -e "
const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.launch({ headless: true });
    console.log('✅ Chromium funciona correctamente');
    await browser.close();
  } catch (e) {
    console.error('❌ Error con Chromium:', e.message);
    process.exit(1);
  }
})()
"

echo "✅ Instalación completada"
