import * as fs from 'fs';
import * as path from 'path';
import { BrowserPool } from '../infrastructure/browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../infrastructure/browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';
import { env } from '../infrastructure/config/environment.js';

async function discoverKickerAPI() {
  console.log('🔍 DISCOVERY - STAKE KICKERTECH (Opción A: CO fingerprint + networkidle 12s + headed fallback via xvfb)');
  console.log('='.repeat(50));
  console.log(`ℹ️ HEADLESS_MODE env=${env.headlessMode} (en Docker se usa headless true con fingerprint CO para estabilidad; headed requiere xvfb-run)`);
  console.log(`ℹ️ Si se requiere headed real, ejecutar: docker compose exec -T backend xvfb-run -a npx tsx src/scripts/stake-kicker-discovery.ts`);

  const browser = await BrowserPool.getInstance().acquireBrowser();
  let context: any = null;
  let page: any = null;

  const responses: any[] = [];
  const requestFailed: any[] = [];
  const consoleLogs: string[] = [];
  const wsEvents: any[] = [];
  const capturedPayloads: any[] = [];
  const kickerUrlPattern = /kicker|odds|market|sb\/api|sportsbook|websbkt|events-by-path|prematch-by-tournaments|cache\/115|fe-api.*sport/i;

  try {
    // Fingerprint CO forzado para coherencia con stake.com.co (es-CO / America/Bogota)
    // Nota: Para diagnosticar ERR_INVALID_ARGUMENT, probamos primero sin CO y luego con CO
    const useCO = process.env.FORCE_CO === 'true';
    const fingerprint = useCO ? FingerprintGenerator.generate('paranoid', 'CO') : FingerprintGenerator.generate('paranoid');
    console.log(`🎭 Fingerprint ${useCO ? 'CO' : 'random'}: ${fingerprint.locale} / ${fingerprint.timezoneId} / ${fingerprint.userAgent.slice(0, 60)}...`);
    console.log(`🔍 Extra headers: Accept-Language=${fingerprint.locale} Sec-Ch-Ua-Platform="${fingerprint.platform}"`);
    context = await PlaywrightStealthFactory.createContext(browser, fingerprint, 'paranoid');
    page = await context.newPage();
    await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

    // Capturar console del browser para ver logs de KickerTech
    page.on('console', (msg: any) => {
      const text = `[browser console ${msg.type()}] ${msg.text()}`;
      if (msg.type() === 'error' || msg.text().toLowerCase().includes('kicker') || msg.text().toLowerCase().includes('sb')) {
        console.log(text);
      }
      consoleLogs.push(text);
    });

    page.on('pageerror', (err: any) => {
      console.log(`[pageerror] ${err.message}`);
      consoleLogs.push(`[pageerror] ${err.message}`);
    });

    page.on('requestfailed', (req: any) => {
      const failure = req.failure()?.errorText || 'unknown';
      console.log(`❌ requestfailed ${req.method()} ${req.url().slice(0, 100)} -> ${failure}`);
      requestFailed.push({ url: req.url(), method: req.method(), failure });
    });

    // Interceptar WebSockets (Kicker puede usar wss://)
    page.on('websocket', (ws: any) => {
      console.log(`🔌 websocket opened ${ws.url()}`);
      wsEvents.push({ type: 'open', url: ws.url(), at: new Date().toISOString() });
      ws.on('framereceived', (payload: any) => {
        const txt = typeof payload.payload === 'string' ? payload.payload.slice(0, 500) : JSON.stringify(payload.payload).slice(0, 500);
        console.log(`🔌 ws framereceived ${ws.url().slice(0, 80)}: ${txt.slice(0, 200)}`);
        wsEvents.push({ type: 'framereceived', url: ws.url(), payload: txt.slice(0, 2000) });
      });
      ws.on('framesent', (payload: any) => {
        wsEvents.push({ type: 'framesent', url: ws.url() });
      });
      ws.on('close', () => {
        console.log(`🔌 websocket closed ${ws.url()}`);
        wsEvents.push({ type: 'close', url: ws.url() });
      });
    });

    // Interceptar TODAS las respuestas + capturar bodies JSON para Kicker
    page.on('response', async (response: any) => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] || '';
      const cfMitigated = response.headers()['cf-mitigated'] || response.headers()['cf-ray'] || '';
      if (status >= 400 || url.includes('kicker') || url.includes('odds') || url.includes('market') || url.includes('sb/api') || url.includes('stake') || kickerUrlPattern.test(url)) {
        console.log(`📡 ${status} ${cfMitigated ? `[cf:${cfMitigated.slice(0, 20)}]` : ''} - ${url.substring(0, 140)}... [ct:${contentType}]`);
      }
      responses.push({
        url,
        status,
        contentType,
        size: response.headers()['content-length'] || 0,
        cfRay: response.headers()['cf-ray'] || '',
      });

      // Capturar JSON bodies para análisis real del adapter
      if (kickerUrlPattern.test(url) && contentType.toLowerCase().includes('application/json')) {
        try {
          const json = await response.json().catch(() => null);
          if (json !== null) {
            capturedPayloads.push({ url, status, json, timestamp: new Date().toISOString() });
            console.log(`💾 Captured JSON payload ${url.slice(0, 80)}... (${JSON.stringify(json).length} chars)`);
          }
        } catch {}
      }
    });

    // Navegar con networkidle 12s (más fiel a usuario real) + timeout extendido
    console.log('🚀 Navegando a Stake (networkidle 12s, timeout 45000)...');
    await page
      .goto('https://stake.com.co/deportes/football', {
        waitUntil: 'networkidle',
        timeout: 45000,
      })
      .catch((err: any) => console.warn('⚠️ goto:', err.message));

    console.log(`⏳ Post-goto: ${responses.length} respuestas capturadas, esperando 5000ms inicial...`);
    await page.waitForTimeout(5000);

    // Intentar forzar hidratación Kicker: scroll + hover + posible click en Deportes
    console.log('📜 Scroll + human behavior para activar KickerTech...');
    try {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        window.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('scroll'));
      });
      // Intentar clicar en un elemento del sidebar Deportes si existe
      const deportesLink = page.locator('a[href="/es/deportes"]');
      if ((await deportesLink.count()) > 0) {
        console.log('🖱️ Click en /es/deportes para forzar carga');
        await deportesLink.first().click().catch(() => {});
      }
    } catch (e) {
      console.warn('⚠️ scroll/click falló', e);
    }
    await page.waitForTimeout(3000);

    // Segundo scroll + wait 4000 para lazy widgets
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(4000);

    console.log(`⏳ Total tras waits: ${responses.length} respuestas, ${requestFailed.length} failed, ${wsEvents.length} ws events`);

    // Buscar peticiones a KickerTech (incluye kicker, odds, market, sb/api, sportsbook, fe-api sports, websbkt cache)
    const kickerResponses = responses.filter(
      (r) =>
        /kicker/i.test(r.url) ||
        /odds/i.test(r.url) ||
        /market/i.test(r.url) ||
        /sb\/api/i.test(r.url) ||
        /sportsbook/i.test(r.url) ||
        /fe-api.*sport/i.test(r.url) ||
        /websbkt/i.test(r.url) ||
        /events-by-path/i.test(r.url) ||
        /prematch-by-tournaments/i.test(r.url) ||
        /cache\/115/i.test(r.url) ||
        /event/i.test(r.url),
    );

    console.log(`\n📊 RESULTADOS:`);
    console.log(`Total respuestas: ${responses.length}`);
    console.log(`Request failed: ${requestFailed.length}`);
    console.log(`WebSockets: ${wsEvents.length}`);
    console.log(`Kicker/odds responses: ${kickerResponses.length}`);
    if (requestFailed.length > 0) {
      console.log('❌ Failed requests:');
      requestFailed.slice(0, 10).forEach((r) => console.log(`  - ${r.method} ${r.url.slice(0, 120)} -> ${r.failure}`));
    }
    if (wsEvents.length > 0) {
      console.log('🔌 WebSocket events:');
      wsEvents.slice(0, 20).forEach((w) => console.log(`  - ${w.type} ${w.url}`));
    }

    const outDir = path.resolve(process.cwd(), 'debug');
    fs.mkdirSync(outDir, { recursive: true });

    // Guardar diagnóstico completo siempre
    fs.writeFileSync(path.join(outDir, 'stake-all-responses.json'), JSON.stringify({ responses, requestFailed, wsEvents, consoleLogs, capturedPayloads: capturedPayloads.map((p) => ({ url: p.url, status: p.status, keys: Object.keys(p.json || {}).slice(0, 10) })) }, null, 2));
    // Guardar payloads completos con bodies para analyze-stake-data.ts
    if (capturedPayloads.length > 0) {
      fs.writeFileSync(path.join(outDir, 'stake-captured-payloads.json'), JSON.stringify(capturedPayloads, null, 2));
      console.log(`💾 Captured payloads completos: ${capturedPayloads.length} -> stake-captured-payloads.json`);
    }
    // Guardar WS frames completos
    if (wsEvents.length > 0) {
      fs.writeFileSync(path.join(outDir, 'stake-ws-frames.json'), JSON.stringify(wsEvents, null, 2));
    }

    if (kickerResponses.length > 0) {
      console.log('\n✅ Candidatos encontrados:');
      kickerResponses.forEach((r) => {
        console.log(`  - ${r.status} ${r.url}`);
      });
      fs.writeFileSync(path.join(outDir, 'stake-kicker-responses.json'), JSON.stringify(kickerResponses, null, 2));
      console.log(`💾 Guardado en ${outDir}/stake-kicker-responses.json`);
    } else {
      console.log('\n⚠️ No se encontraron peticiones a KickerTech');
      console.log('💡 Posibles causas:');
      console.log('  1. KickerTech se carga con un clic/acción');
      console.log('  2. Usa WebSockets en lugar de HTTP');
      console.log('  3. Bloquea navegadores headless (probar HEADLESS_MODE=false con xvfb)');
      console.log(`  4. Requiere IP CO (actual: Directo / Socket Limpio, fingerprint CO ${responses.length > 0 ? 'aplicado' : 'no aplicado'})`);
    }

    // Capturar screenshot
    try {
      const screenshotPath = path.join(outDir, 'stake-kicker-screen.png');
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`📸 Screenshot guardado en ${screenshotPath}`);
    } catch (e) {
      console.warn('⚠️ Screenshot falló', e);
    }

    // También guardar HTML para inspección
    try {
      const html = await page.content();
      fs.writeFileSync(path.join(outDir, 'stake-kicker-discovery.html'), html, 'utf-8');
      console.log(`📄 HTML guardado (${html.length} bytes)`);
    } catch {}
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    await BrowserPool.getInstance().releaseBrowser(browser, false);
  }

  console.log('✅ Discovery completado');
}

discoverKickerAPI().catch((err) => {
  console.error('❌ Error discovery', err);
  process.exit(1);
});
