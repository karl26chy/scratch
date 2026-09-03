import { BrowserPool } from '../infrastructure/browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../infrastructure/browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';

async function extractHidenseek() {
  console.log('🔍 EXTRAYENDO HIDENSEEK DE STAKE');
  console.log('='.repeat(50));

  const browser = await BrowserPool.getInstance().acquireBrowser();
  let context: any = null;
  let page: any = null;

  try {
    const fingerprint = FingerprintGenerator.generate('paranoid', 'CO');
    // Forzar CO explícito
    (fingerprint as any).timezoneId = 'America/Bogota';
    (fingerprint as any).locale = 'es-CO,es;q=0.9,en;q=0.8';
    console.log(`🇨🇴 Fingerprint CO: ${fingerprint.locale} / ${fingerprint.timezoneId}`);
    console.log(`🌐 User-Agent: ${fingerprint.userAgent.slice(0, 80)}...`);

    context = await PlaywrightStealthFactory.createContext(browser, fingerprint, 'paranoid');
    page = await context.newPage();
    await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

    const hidenseekUrls: string[] = [];
    const allRequests: string[] = [];

    // Interceptar peticiones para ver hidenseek
    page.on('request', (request: any) => {
      const url = request.url();
      allRequests.push(url);
      if (url.includes('hidenseek')) {
        console.log('🔑 Hidenseek encontrado en request:', url);
        hidenseekUrls.push(url);
      }
    });

    page.on('response', async (response: any) => {
      const url = response.url();
      if (url.includes('hidenseek') || url.includes('events-by-path') || url.includes('prematch-by-tournaments')) {
        const status = response.status();
        console.log(`📡 Response ${status} ${url.slice(0, 120)}`);
        if (status === 406) {
          console.warn(`⚠️ 406 para ${url.slice(0, 100)}`);
        }
      }
    });

    console.log('🚀 Navegando a https://stake.com.co/deportes/football ...');
    await page.goto('https://stake.com.co/deportes/football', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    console.log('⏳ Esperando 5s para capturar hidenseek...');
    await page.waitForTimeout(5000);

    // Buscar hidenseek en el HTML
    const html = await page.content();

    // Patrones múltiples
    const patterns = [
      /hidenseek[=:]["']([^"']+)["']/g,
      /hidenseek=([^&"'\s]+)/g,
      /hidenseek["']?\s*:\s*["']([^"']+)["']/g,
      /"hidenseek"\s*:\s*"([^"]+)"/g,
    ];

    console.log('\n🔍 Buscando hidenseek en HTML...');
    let foundInHtml = false;
    for (const pat of patterns) {
      let match;
      // Reset lastIndex
      pat.lastIndex = 0;
      while ((match = pat.exec(html)) !== null) {
        console.log('🔑 Hidenseek en HTML:', match[1].slice(0, 100));
        foundInHtml = true;
      }
    }
    if (!foundInHtml) console.log('  (no encontrado en HTML con patrones simples)');

    // Buscar en window.__config__ y otros globales
    console.log('\n🔍 Buscando en window.__config__ y globales...');
    try {
      const configHidenseek = await page.evaluate(() => {
        const results: Record<string, any> = {};
        // __config__
        const cfg = (window as any).__config__;
        if (cfg) {
          results.__config = cfg;
          if (cfg.hidenseek) results.hidenseek_in_config = cfg.hidenseek;
        }
        // Buscar en localStorage
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.toLowerCase().includes('hidenseek')) {
              results[`localStorage:${key}`] = localStorage.getItem(key);
            }
          }
        } catch {}
        // Buscar en sessionStorage
        try {
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.toLowerCase().includes('hidenseek')) {
              results[`sessionStorage:${key}`] = sessionStorage.getItem(key);
            }
          }
        } catch {}
        // Buscar en scripts
        const scripts = Array.from(document.querySelectorAll('script')).map(s => s.src || s.textContent?.slice(0, 200) || '').join(' ').slice(0, 2000);
        results.scripts_sample = scripts.slice(0, 500);
        // Buscar en cookies document.cookie
        results.cookies = document.cookie.slice(0, 1000);
        // Buscar en window global
        const winKeys = Object.keys(window as any).filter(k => k.toLowerCase().includes('hidenseek') || k.toLowerCase().includes('kicker'));
        results.window_keys = winKeys;
        return results;
      });
      console.log('  window eval:', JSON.stringify(configHidenseek, null, 2).slice(0, 2000));
    } catch (e: any) {
      console.warn('⚠️ Error evaluando window:', e.message);
    }

    // Buscar en peticiones de red capturadas
    console.log('\n📡 Resumen peticiones con hidenseek:');
    if (hidenseekUrls.length > 0) {
      hidenseekUrls.forEach((u, i) => console.log(`  [${i}] ${u}`));
      // Extraer token
      for (const u of hidenseekUrls) {
        try {
          const parsed = new URL(u);
          const token = parsed.searchParams.get('hidenseek');
          if (token) console.log(`  🔑 Token extraído: ${token.slice(0, 30)}... (len ${token.length})`);
        } catch {}
      }
    } else {
      console.log('  (ninguna request con hidenseek interceptada)');
      console.log(`  Total requests: ${allRequests.length}`);
      // Mostrar algunas requests kicker para debug
      const kickerReqs = allRequests.filter(u => /websbkt|kicker|events-by-path/i.test(u)).slice(0, 5);
      console.log('  Kicker requests sample:', kickerReqs);
    }

    // Extraer de network via page.evaluate de performance
    console.log('\n📡 Buscando hidenseek en performance entries...');
    try {
      const perfUrls = await page.evaluate(() => {
        return performance.getEntriesByType('resource').map((e: any) => e.name).filter((u: string) => u.includes('hidenseek') || u.includes('events-by-path')).slice(0, 5);
      });
      console.log('  Performance URLs:', perfUrls);
    } catch {}

    await page.waitForTimeout(3000);
    console.log('\n✅ Extracción completada');
    if (hidenseekUrls.length > 0) {
      console.log('✅ HIDENSEEK EXTRAÍDO');
    } else {
      console.log('⚠️ No se interceptó hidenseek — puede estar en HTML/JS encriptado');
    }
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    console.error(e.stack?.slice(0, 1000));
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    await BrowserPool.getInstance().releaseBrowser(browser, false);
  }
}

extractHidenseek().catch((e) => {
  console.error(e);
  process.exit(1);
});
