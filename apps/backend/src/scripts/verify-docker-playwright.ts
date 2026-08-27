import { chromium } from 'playwright';

async function verifyDockerPlaywright() {
  console.log('🔍 VERIFICANDO PLAYWRIGHT EN DOCKER');
  console.log('='.repeat(50));

  try {
    // 1. Verificar versión
    let version = 'unknown';
    try {
      const pkg: any = await import('playwright/package.json', { with: { type: 'json' } } as any).catch(() => null);
      version = pkg?.default?.version ?? pkg?.version ?? version;
    } catch {
      try {
        // fallback
        const mod = await import('playwright');
        version = (mod as any).version ?? version;
      } catch {}
    }
    // Intentar require como fallback
    if (version === 'unknown') {
      try {
        // @ts-ignore
        version = require('playwright/package.json').version;
      } catch {}
    }
    console.log('📦 Versión de Playwright:', version);

    // 2. Verificar que Chromium se lanza
    console.log('🚀 Lanzando Chromium...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    console.log('✅ Chromium lanzado correctamente');

    // 3. Probar navegación
    console.log('🌐 Navegando a ipify.org...');
    const page = await browser.newPage();
    await page.goto('https://api.ipify.org?format=json', { timeout: 10000, waitUntil: 'domcontentloaded' });
    const content = await page.textContent('body');
    console.log('🌍 IP obtenida:', content?.trim().substring(0, 100));

    await browser.close();
    console.log('✅ Playwright funciona correctamente en Docker');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 Soluciones:');
    console.log('  1. Ejecutar: ./scripts/docker-install-playwright.sh');
    console.log('  2. Ejecutar: ./scripts/docker-rebuild.sh');
    console.log('  3. Entrar al contenedor: docker compose exec backend bash');
    console.log('  4. Instalar navegadores: npx playwright install chromium');
    process.exit(1);
  }
}

verifyDockerPlaywright();
