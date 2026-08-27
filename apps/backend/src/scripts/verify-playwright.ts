import { chromium } from 'playwright';

async function verifyPlaywright() {
  console.log('🔍 VERIFICANDO PLAYWRIGHT');
  console.log('='.repeat(40));

  try {
    // 1. Verificar versión
    try {
      // @ts-ignore
      const pkg = await import('playwright/package.json', { with: { type: 'json' } } as any).catch(() => null);
      if (pkg) console.log('📦 Versión:', (pkg as any).default?.version ?? (pkg as any).version);
    } catch {
      // fallback to require
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const v = require('playwright/package.json').version;
        console.log('📦 Versión:', v);
      } catch {}
    }

    // 2. Verificar navegadores instalados
    const browser = await chromium.launch({ headless: true });
    console.log('✅ Chromium lanzado correctamente');

    const page = await browser.newPage();
    await page.goto('https://api.ipify.org?format=json', { timeout: 15000, waitUntil: 'domcontentloaded' });
    const ip = await page.textContent('body');
    console.log('🌐 IP obtenida:', ip?.trim().substring(0, 80));

    await browser.close();
    console.log('✅ Playwright funciona correctamente');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 Solución: Ejecuta "npx playwright install chromium"');
    process.exit(1);
  }
}

verifyPlaywright();
