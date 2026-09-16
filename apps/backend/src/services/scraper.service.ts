import * as fs from 'fs';
import * as path from 'path';
import { ScrapeRequestDto, ScrapeResultDto, BatchScrapeResultDto } from '../domain/types/scraper.types.js';
import { BrowserPool } from '../infrastructure/browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../infrastructure/browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';
import { ProxyRotator } from '../infrastructure/proxies/proxy-rotator.js';
import { ResilientSelectorEngine } from '../infrastructure/selectors/resilient-selector.engine.js';
import { OddsNetworkInterceptor } from '../infrastructure/network/odds-interceptor.js';
import { SiteAdapterRegistry } from '../infrastructure/network/adapter-registry.js';
import type { SiteOddsAdapter } from '../domain/types/site-adapter.js';
import type { BookmakerOdd } from '../domain/types/surebet.types.js';
import { stakeKickerAdapter } from '../infrastructure/network/adapters/stake-kicker.adapter.js';
import { betplayKambiAdapter } from '../infrastructure/network/adapters/betplay-kambi.adapter.js';
import { OddsPersistenceService } from './odds-persistence.service.js';
import { EvasionService } from './evasion.service.js';
import { SingleTestService } from './single-test.service.js';
import { env } from '../infrastructure/config/environment.js';
import { BrowserContext, Page } from 'playwright';

function deriveBookmakerFromUrl(url: string): string | undefined {
  try {
    let host = new URL(url).hostname.toLowerCase();
    // quitar subdominios genéricos iterativamente: m, www, apuestas, apuesta, tienda, bet, sports, deportes, mobile
    const genericPrefixes = ['m', 'www', 'apuestas', 'apuesta', 'tienda', 'bet', 'sports', 'deportes', 'mobile', 'api'];
    let prev: string;
    do {
      prev = host;
      const pattern = new RegExp(`^(${genericPrefixes.join('|')})\\.`, 'i');
      host = host.replace(pattern, '');
    } while (host !== prev);
    const firstLabel = host.split('.')[0];
    if (!firstLabel) return undefined;
    return firstLabel.charAt(0).toUpperCase() + firstLabel.slice(1);
  } catch {
    return undefined;
  }
}

export class ScraperService {
  private browserPool = BrowserPool.getInstance();
  private proxyRotator = ProxyRotator.getInstance();
  private adapterRegistry = SiteAdapterRegistry.getInstance();

  /**
   * Executes mass concurrent scraping across multiple bookmaker URLs using Promise.all
   * Guarantees 100% thread/task isolation and dynamic residential proxy rotation per target
   */
  public async executeBatchScrape(request: ScrapeRequestDto): Promise<BatchScrapeResultDto> {
    const startTime = Date.now();
    const urls = request.urls && request.urls.length > 0 ? request.urls : request.url ? [request.url] : [];

    if (urls.length === 0) {
      throw new Error('Debe proporcionar al menos una URL objetivo para ejecutar el scraping.');
    }

    // Execute all extractions concurrently across isolated workers
    const scrapePromises = urls.map((targetUrl, index) => {
      const perTaskSessionId = request.sessionId ? `${request.sessionId}-worker-${index}` : `task_${Date.now()}_${index}`;
      const workerStart = Date.now();
      return this.executeSingleScrape({
        ...request,
        url: targetUrl,
        sessionId: perTaskSessionId,
      }).catch((err: any) => {
        // Safe catch per worker so one failed URL does not abort the entire batch
        const elapsed = Date.now() - workerStart;
        const batchDuration = Date.now() - startTime;
        console.error(
          `[ScraperService][Batch] worker ${index} failed for ${targetUrl} after ${elapsed}ms (batch ${batchDuration}ms): ${err?.message || err}`,
        );
        if (err?.stack) console.error(err.stack);
        const failedResult: ScrapeResultDto = {
          id: `scr_err_${Date.now()}_${index}`,
          url: targetUrl,
          status: 'ERROR',
          source: 'dom',
          statusCode: 500,
          pageTitle: 'Error de Conexión',
          htmlLength: 0,
          extractedData: {
            error: err?.message || 'Error de conexión o timeout en el hilo de scraping',
            stack: err?.stack ? String(err.stack).slice(0, 3000) : undefined,
            elapsedMs: elapsed,
          },
          stealthMetrics: {
            stealthLevelApplied: 'paranoid',
            fingerprintUsed: {},
            bypassedAntiBot: false,
            durationMs: elapsed,
          },
          createdAt: new Date().toISOString(),
        };
        return failedResult;
      });
    });

    const results = await Promise.all(scrapePromises);
    const successfulCount = results.filter((r) => r.status === 'SUCCESS' || r.status === 'DOM_STRUCTURE_CHANGED').length;
    const blockedCount = results.filter((r) => r.status === 'BLOCKED' || r.status === 'ERROR').length;
    const durationMs = Date.now() - startTime;

    return {
      success: true,
      totalRequested: urls.length,
      successfulCount,
      blockedCount,
      results,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Executes an individual scraping mission applying maximum stealth and resilient extraction
   */
  public async executeSingleScrape(request: ScrapeRequestDto): Promise<ScrapeResultDto> {
    const startTime = Date.now();
    let targetUrl = request.url!;
    // Normalizar URL con acentos/espacios: idempotente si ya viene encoded
    try {
      targetUrl = encodeURI(decodeURI(targetUrl));
    } catch {
      try {
        targetUrl = encodeURI(targetUrl);
      } catch {
        // dejar url original si falla el encoding
      }
    }
    const stealthLevel = 'paranoid'; // Always apply maximum evasion profile natively

    // ⚠️ MODO PRUEBA ÚNICA - BLOQUEO DE SEGURIDAD EXTREMO
    if (env.singleTest.enabled && env.singleTest.allowDirectIP) {
      console.warn('⚠️ MODO PRUEBA ÚNICA ACTIVADO - USANDO IP DOMÉSTICA');
      const testService = SingleTestService.getInstance();
      try {
        const result = await testService.executeSingleTest(targetUrl);
        if (!result.success) {
          throw new Error('Prueba única fallida');
        }
        if (result.executionCount >= env.singleTest.maxExecutions) {
          console.log('🔴 LÍMITE DE PRUEBA ALCANZADO - DESACTIVANDO MODO');
          env.singleTest.enabled = false;
          process.env.SINGLE_TEST_MODE = 'false';
        }
        // Convertir resultado de SingleTest a ScrapeResultDto para compatibilidad
        return {
          id: `single_test_${Date.now()}`,
          url: targetUrl,
          status: 'SUCCESS',
          source: 'dom',
          statusCode: 200,
          pageTitle: result.title || 'Prueba única completada',
          htmlLength: 0,
          extractedData: { singleTest: true, ip: result.ip, title: result.title },
          stealthMetrics: {
            stealthLevelApplied: 'paranoid',
            fingerprintUsed: {},
            proxyUsed: 'IP DOMÉSTICA DIRECTA (MODO PRUEBA ÚNICA)',
            bypassedAntiBot: true,
            durationMs: Date.now() - startTime,
          },
          createdAt: new Date().toISOString(),
        };
      } catch (err: any) {
        // Si falla, desactivar igualmente si alcanzó límite y relanzar
        if (testService.getExecutionCount() >= env.singleTest.maxExecutions) {
          env.singleTest.enabled = false;
          process.env.SINGLE_TEST_MODE = 'false';
        }
        throw err;
      }
    }

    // Proxy: respect PROXY_ENABLED env and request flag. Real proxies from env, no dummy-filter needed.
    const useProxy = request.useProxy !== false && env.proxy.enabled;
    let proxy = useProxy ? this.proxyRotator.getProxy(request.sessionId) : undefined;
    const proxyConfig = proxy ? this.proxyRotator.getProxyServerWithAuth(proxy) : undefined;
    const proxyServer = proxyConfig?.server;
    // Tarea 2: logging proxy
    if (proxyConfig) {
      console.log('🌐 Usando proxy:', proxyConfig.server, proxyConfig.username ? `(user:${proxyConfig.username})` : '');
    } else if (env.proxy.enabled) {
      console.warn('⚠️ PROXY_ENABLED=true pero sin proxy disponible — usando IP directa (configura PROXY_LIST_URL o PROXY_API_KEY)');
    } else {
      console.log('🌐 Sin proxy — IP directa');
    }

    // 🔥 Forzar fingerprint CO para Stake (evita 406 en events-by-path)
    let fingerprint;
    try {
      const domainScrape = new URL(targetUrl).hostname.toLowerCase();
      if (domainScrape.includes('stake.com.co')) {
        console.log('🇨🇴 Forzando fingerprint CO para Stake');
        fingerprint = FingerprintGenerator.generate(stealthLevel, 'CO');
        // Forzar valores CO explícitos
        (fingerprint as any).timezoneId = 'America/Bogota';
        (fingerprint as any).locale = 'es-CO,es;q=0.9,en;q=0.8';
        console.log(`🇨🇴 Fingerprint aplicado: ${fingerprint.timezoneId} / ${fingerprint.locale}`);
        console.log(`🌐 User-Agent: ${fingerprint.userAgent}`);
        console.log(`📱 Viewport: ${fingerprint.viewport.width}x${fingerprint.viewport.height}`);
      } else {
        fingerprint = proxy?.country
          ? FingerprintGenerator.generate(stealthLevel, proxy.country)
          : FingerprintGenerator.generate(stealthLevel);
        console.log(`🌐 Fingerprint: ${fingerprint.locale} / ${fingerprint.timezoneId}`);
        console.log(`📱 User-Agent: ${fingerprint.userAgent.slice(0, 80)}...`);
      }
    } catch {
      fingerprint = proxy?.country
        ? FingerprintGenerator.generate(stealthLevel, proxy.country)
        : FingerprintGenerator.generate(stealthLevel);
    }

    if (useProxy && !proxy) {
      console.warn(`[ScraperService] PROXY_ENABLED=true pero no hay proxies disponibles -> usando IP directa para ${targetUrl}. Configura PROXY_LIST_URL.`);
    }

    // Acquire shared browser instance (proxy is isolated per context, not per browser)
    const browser = await this.browserPool.acquireBrowser();
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let oddsInterceptor: OddsNetworkInterceptor | null = null;

    try {
      // 1. Create completely isolated ephemeral context per thread/task with its own proxy
      context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel, proxyConfig);
      page = await context.newPage();

      // 2. Inject anti-fingerprinting stealth evasion scripts before DOM scripts execute
      await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

      // 2b. Si existe adapter de red para este dominio, interceptamos las respuestas JSON
      const networkAdapter: SiteOddsAdapter | null = this.adapterRegistry.getForUrl(targetUrl);
      if (networkAdapter) {
        oddsInterceptor = new OddsNetworkInterceptor(networkAdapter.urlPatterns);
        oddsInterceptor.attach(page);
      }

      // 3. Navigate to bookmaker target with realistic headers
      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: request.timeoutMs || env.browserTimeoutMs,
      }).catch(async (navErr) => {
        const msg: string = navErr?.message || '';
        const isProxyError =
          proxyConfig &&
          (/PROXY|TUNNEL|ECONNREFUSED|ETIMEDOUT|ERR_PROXY|NS_ERROR_PROXY|proxy/i.test(msg) ||
            msg.includes('407') || // Proxy Authentication Required
            msg.includes('ERR_TUNNEL_CONNECTION_FAILED'));

        if (isProxyError) {
          const latency = Date.now() - startTime;
          console.warn(`[ScraperService] Proxy ${proxyServer} failed (${msg.substring(0, 200)}). Marcando fallo y reintentando sin proxy.`);
          if (proxy) this.proxyRotator.markProxyFailure(proxy.id, `Proxy error: ${msg.substring(0, 80)}`, latency);
          if (context) await context.close().catch(() => {});
          context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel);
          page = await context.newPage();
          await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);
          console.warn(`[ScraperService] Reintentando sin proxy para ${targetUrl} tras fallo de proxy`);
          return await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: request.timeoutMs || env.browserTimeoutMs,
          });
        }
        // Diagnóstico permanente: loguear cualquier otro error de navegación (timeout, TLS, URL inválida, etc.)
        console.warn(`[ScraperService] page.goto failed for ${targetUrl} after ${Date.now() - startTime}ms: ${msg.slice(0, 500)}`);
        if ((navErr as any)?.stack) console.warn((navErr as any).stack.slice(0, 2000));
        throw navErr;
      });

      const statusCode = response?.status() || 200;

      // 4. Human behavior emulation avanzado & stochastic pacing (rotación per-request)
      await EvasionService.simulateAdvancedHumanBehavior(page);

      // 5. Element wait if specified
      if (request.waitForSelector) {
        await page.waitForSelector(request.waitForSelector, {
          timeout: 8000,
        }).catch(() => {});
      }

      // 6. Inspect anti-bot barrier status + captcha detection
      const pageTitle = await page.title();
      const htmlContent = await page.content();
      const isBlocked = EvasionService.isAntibotChallenge(htmlContent, pageTitle, statusCode);
      const captchaInfo = EvasionService.handleCaptchaDetected(htmlContent, proxy?.id);
      if (captchaInfo.detected) {
        // Se incluye en extractedData para métricas
        console.warn(`[ScraperService] Captcha ${captchaInfo.type} en ${targetUrl} -> proxy ${proxy?.id} rotará`);
      }

      // 7. Automatic Resilient Data & Sports Odds Extraction
      const extractedData: Record<string, unknown> = {
        title: pageTitle,
        captchaDetected: captchaInfo.detected,
        captchaType: captchaInfo.type,
      };

      let bookmakerOdds: BookmakerOdd[] = [];
      let domStructureAlert: { hasChanged: boolean; message?: string } | undefined;

      if (networkAdapter && oddsInterceptor) {
        // Extracción vía intercepción de red (API/JSON) — sin depender de selectores CSS
        const payloads = oddsInterceptor.getCaptured();
        bookmakerOdds = networkAdapter.extract(payloads);
        extractedData.strategyApplied = `Network Interception (${networkAdapter.domain})`;
        extractedData.capturedPayloads = payloads.length;
        extractedData.bookmakerOdds = bookmakerOdds;
        extractedData.oddsCount = bookmakerOdds.length;
      } else {
        // Fallback: extracción por selectores CSS (comportamiento original)
        const effectiveBookmaker = request.bookmaker?.trim() || deriveBookmakerFromUrl(targetUrl) || 'UnknownBookmaker';
        const oddsExtraction = await ResilientSelectorEngine.extractSportsOdds(page, effectiveBookmaker);
        bookmakerOdds = await ResilientSelectorEngine.extractBookmakerOdds(page, effectiveBookmaker);
        extractedData.sportsOdds = oddsExtraction.data;
        extractedData.bookmakerOdds = bookmakerOdds;
        extractedData.oddsCount = oddsExtraction.itemsCount;
        extractedData.strategyApplied = oddsExtraction.strategyApplied || 'Automated Resilient Selector Engine';

        // Volcado de diagnóstico: solo si cayó en una estrategia de último recurso / validación,
        // activado por DEBUG_DUMP_HTML para no llenar disco en producción.
        const shouldDump =
          env.debugDumpHtml &&
          oddsExtraction.strategyApplied &&
          (oddsExtraction.strategyApplied.includes('text_pattern_fallback') ||
            oddsExtraction.strategyApplied.includes('structured_price_class'));
        if (shouldDump) {
          try {
            const host = new URL(targetUrl).hostname.replace(/[^a-z0-9]/gi, '_');
            const dir = path.resolve(process.cwd(), 'debug');
            fs.mkdirSync(dir, { recursive: true });
            const rawHtml = await page.content();
            fs.writeFileSync(path.join(dir, `${host}-${Date.now()}.html`), rawHtml, 'utf-8');
            console.warn(`[ScraperService] HTML de diagnóstico volcado: debug/${host}-*.html (strategy=${oddsExtraction.strategyApplied})`);
          } catch {
            // ignorar fallo de volcado
          }
        }

        if (oddsExtraction.domStructureChanged && !isBlocked) {
          domStructureAlert = {
            hasChanged: true,
            message: oddsExtraction.alertMessage || 'Los selectores estables no encontraron cuotas decimales en el DOM renderizado.',
          };
        }
      }

      // Ingest live real scraped odds into the Surebet arbitrage engine + persistencia
      if (bookmakerOdds && bookmakerOdds.length > 0) {
        const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
        SurebetCalculatorService.getInstance().addScrapedOdds(bookmakerOdds);
        // Tarea 1: Persistencia Wplay/Stake
        const persistBookmaker = request.bookmaker || deriveBookmakerFromUrl(targetUrl) || bookmakerOdds[0]?.bookmaker || 'Unknown';
        OddsPersistenceService.getInstance().saveOddsForBookmaker(persistBookmaker, bookmakerOdds);
      }

      // 8. Capture Verification Screenshot if requested
      let screenshotBase64: string | undefined;
      if (request.captureScreenshot) {
        const buffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 60 });
        screenshotBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      }

      // 9. Proxy Health and Failover evaluation con métricas de rendimiento
      const durationMs = Date.now() - startTime;
      if (proxy) {
        if (isBlocked || captchaInfo.detected) {
          const reason = captchaInfo.detected ? `Captcha ${captchaInfo.type} detectado` : 'Barrera anti-bot detectada en casa de apuestas';
          this.proxyRotator.markProxyFailure(proxy.id, reason, durationMs);
        } else {
          this.proxyRotator.markProxySuccess(proxy.id, durationMs);
        }
      }
      let finalStatus: 'SUCCESS' | 'BLOCKED' | 'DOM_STRUCTURE_CHANGED' = isBlocked ? 'BLOCKED' : 'SUCCESS';
      if (!isBlocked && domStructureAlert?.hasChanged) {
        finalStatus = 'DOM_STRUCTURE_CHANGED';
      }

      return {
        id: `scr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        url: targetUrl,
        status: finalStatus,
        source: networkAdapter ? 'network' : 'dom',
        statusCode,
        pageTitle,
        htmlLength: htmlContent.length,
        extractedData,
        domAlert: domStructureAlert,
        stealthMetrics: {
          stealthLevelApplied: stealthLevel,
          fingerprintUsed: {
            userAgent: fingerprint.userAgent,
            platform: fingerprint.platform,
            viewport: fingerprint.viewport,
          },
          proxyUsed: proxyServer || 'Directo / Socket Limpio',
          bypassedAntiBot: !isBlocked,
          durationMs,
        },
        screenshotBase64,
        createdAt: new Date().toISOString(),
      };
    } finally {
      // Strict cleanup to eliminate memory leaks and guarantee context termination
      if (page && oddsInterceptor) oddsInterceptor.detach(page);
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      await this.browserPool.releaseBrowser(browser, false);
    }
  }

  /**
   * CONSOLA CONCURRENTE — DOM ONLY (sin adapters)
   * Siempre usa ResilientSelectorEngine (4 estrategias), nunca SiteAdapterRegistry.
   * Incluso stake.com.co aquí debe dar DOM_STRUCTURE_CHANGED / 0 odds.
   */
  public async executeSingleScrapeDomOnly(request: ScrapeRequestDto): Promise<ScrapeResultDto> {
    const startTime = Date.now();
    let targetUrl = request.url!;
    try {
      targetUrl = encodeURI(decodeURI(targetUrl));
    } catch {
      try {
        targetUrl = encodeURI(targetUrl);
      } catch {}
    }
    const stealthLevel = 'paranoid';
    if (env.singleTest.enabled && env.singleTest.allowDirectIP) {
      console.warn('⚠️ MODO PRUEBA ÚNICA ACTIVADO - USANDO IP DOMÉSTICA');
      const testService = SingleTestService.getInstance();
      try {
        const result = await testService.executeSingleTest(targetUrl);
        if (!result.success) throw new Error('Prueba única fallida');
        if (result.executionCount >= env.singleTest.maxExecutions) {
          env.singleTest.enabled = false;
          process.env.SINGLE_TEST_MODE = 'false';
        }
        return {
          id: `single_test_${Date.now()}`,
          url: targetUrl,
          status: 'SUCCESS',
          source: 'dom',
          statusCode: 200,
          pageTitle: result.title || 'Prueba única completada',
          htmlLength: 0,
          extractedData: { singleTest: true, ip: result.ip, title: result.title },
          stealthMetrics: { stealthLevelApplied: 'paranoid', fingerprintUsed: {}, proxyUsed: 'IP DOMÉSTICA DIRECTA', bypassedAntiBot: true, durationMs: Date.now() - startTime },
          createdAt: new Date().toISOString(),
        };
      } catch (err: any) {
        if (testService.getExecutionCount() >= env.singleTest.maxExecutions) {
          env.singleTest.enabled = false;
          process.env.SINGLE_TEST_MODE = 'false';
        }
        throw err;
      }
    }
    const useProxy = request.useProxy !== false && env.proxy.enabled;
    let proxy = useProxy ? this.proxyRotator.getProxy(request.sessionId) : undefined;
    const proxyConfig = proxy ? this.proxyRotator.getProxyServerWithAuth(proxy) : undefined;
    const proxyServer = proxyConfig?.server;
    if (proxyConfig) console.log('🌐 [DOM-ONLY] Usando proxy:', proxyConfig.server);
    else if (env.proxy.enabled) console.warn('⚠️ PROXY_ENABLED=true pero sin proxy — IP directa');
    else console.log('🌐 [DOM-ONLY] Sin proxy — IP directa');
    // Fingerprint (sin forzar CO especial, solo rotación normal)
    const fingerprint = proxy?.country ? FingerprintGenerator.generate(stealthLevel, proxy.country) : FingerprintGenerator.generate(stealthLevel);
    console.log(`🌐 [DOM-ONLY] Fingerprint: ${fingerprint.locale} / ${fingerprint.timezoneId}`);
    const browser = await this.browserPool.acquireBrowser();
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    try {
      context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel, proxyConfig);
      page = await context.newPage();
      await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);
      // NO adapter / NO interceptor — solo DOM
      const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: request.timeoutMs || env.browserTimeoutMs }).catch(async (navErr) => {
        const msg: string = navErr?.message || '';
        const isProxyError = proxyConfig && (/PROXY|TUNNEL|ECONNREFUSED|ETIMEDOUT|ERR_PROXY|NS_ERROR_PROXY|proxy/i.test(msg) || msg.includes('407') || msg.includes('ERR_TUNNEL_CONNECTION_FAILED'));
        if (isProxyError) {
          const latency = Date.now() - startTime;
          console.warn(`[DOM-ONLY] Proxy ${proxyServer} failed (${msg.substring(0, 200)}). Reintentando sin proxy.`);
          if (proxy) this.proxyRotator.markProxyFailure(proxy.id, `Proxy error: ${msg.substring(0, 80)}`, latency);
          if (context) await context.close().catch(() => {});
          context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel);
          page = await context.newPage();
          await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);
          return await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: request.timeoutMs || env.browserTimeoutMs });
        }
        console.warn(`[DOM-ONLY] page.goto failed for ${targetUrl} after ${Date.now() - startTime}ms: ${msg.slice(0, 500)}`);
        throw navErr;
      });
      const statusCode = response?.status() || 200;
      await EvasionService.simulateAdvancedHumanBehavior(page);
      if (request.waitForSelector) await page.waitForSelector(request.waitForSelector, { timeout: 8000 }).catch(() => {});
      const pageTitle = await page.title();
      const htmlContent = await page.content();
      const isBlocked = EvasionService.isAntibotChallenge(htmlContent, pageTitle, statusCode);
      const captchaInfo = EvasionService.handleCaptchaDetected(htmlContent, proxy?.id);
      if (captchaInfo.detected) console.warn(`[DOM-ONLY] Captcha ${captchaInfo.type} en ${targetUrl}`);
      const extractedData: Record<string, unknown> = { title: pageTitle, captchaDetected: captchaInfo.detected, captchaType: captchaInfo.type };
      const effectiveBookmaker = request.bookmaker?.trim() || deriveBookmakerFromUrl(targetUrl) || 'UnknownBookmaker';
      const oddsExtraction = await ResilientSelectorEngine.extractSportsOdds(page, effectiveBookmaker);
      const bookmakerOdds = await ResilientSelectorEngine.extractBookmakerOdds(page, effectiveBookmaker);
      extractedData.sportsOdds = oddsExtraction.data;
      extractedData.bookmakerOdds = bookmakerOdds;
      extractedData.oddsCount = oddsExtraction.itemsCount;
      extractedData.strategyApplied = oddsExtraction.strategyApplied || 'Automated Resilient Selector Engine';
      let domStructureAlert: { hasChanged: boolean; message?: string } | undefined;
      if (oddsExtraction.domStructureChanged && !isBlocked) domStructureAlert = { hasChanged: true, message: oddsExtraction.alertMessage || 'Selectores estables no encontraron cuotas.' };
      if (bookmakerOdds && bookmakerOdds.length > 0) {
        const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
        SurebetCalculatorService.getInstance().addScrapedOdds(bookmakerOdds);
        const persistBookmaker = request.bookmaker || deriveBookmakerFromUrl(targetUrl) || bookmakerOdds[0]?.bookmaker || 'Unknown';
        OddsPersistenceService.getInstance().saveOddsForBookmaker(persistBookmaker, bookmakerOdds);
      }
      let screenshotBase64: string | undefined;
      if (request.captureScreenshot) {
        const buffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 60 });
        screenshotBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      }
      const durationMs = Date.now() - startTime;
      if (proxy) {
        if (isBlocked || captchaInfo.detected) this.proxyRotator.markProxyFailure(proxy.id, captchaInfo.detected ? `Captcha ${captchaInfo.type}` : 'Barrera anti-bot', durationMs);
        else this.proxyRotator.markProxySuccess(proxy.id, durationMs);
      }
      let finalStatus: 'SUCCESS' | 'BLOCKED' | 'DOM_STRUCTURE_CHANGED' = isBlocked ? 'BLOCKED' : 'SUCCESS';
      if (!isBlocked && domStructureAlert?.hasChanged) finalStatus = 'DOM_STRUCTURE_CHANGED';
      console.log(`[DOM-ONLY] ${targetUrl} -> ${finalStatus} ${oddsExtraction.strategyApplied} odds=${bookmakerOdds.length}`);
      return {
        id: `scr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        url: targetUrl,
        status: finalStatus,
        source: 'dom',
        statusCode,
        pageTitle,
        htmlLength: htmlContent.length,
        extractedData,
        domAlert: domStructureAlert,
        stealthMetrics: { stealthLevelApplied: stealthLevel, fingerprintUsed: { userAgent: fingerprint.userAgent, platform: fingerprint.platform, viewport: fingerprint.viewport }, proxyUsed: proxyServer || 'Directo / Socket Limpio', bypassedAntiBot: !isBlocked, durationMs },
        screenshotBase64,
        createdAt: new Date().toISOString(),
      };
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      await this.browserPool.releaseBrowser(browser, false);
    }
  }

  public async executeBatchDomScrape(request: ScrapeRequestDto): Promise<BatchScrapeResultDto> {
    const startTime = Date.now();
    const urls = request.urls && request.urls.length > 0 ? request.urls : request.url ? [request.url] : [];
    if (urls.length === 0) throw new Error('Debe proporcionar al menos una URL');
    const results = await Promise.all(
      urls.map((targetUrl, index) => {
        const perTaskSessionId = request.sessionId ? `${request.sessionId}-worker-${index}` : `task_${Date.now()}_${index}`;
        const workerStart = Date.now();
        return this.executeSingleScrapeDomOnly({ ...request, url: targetUrl, sessionId: perTaskSessionId }).catch((err: any) => {
          const elapsed = Date.now() - workerStart;
          return {
            id: `scr_err_${Date.now()}_${index}`,
            url: targetUrl,
            status: 'ERROR' as const,
            source: 'dom' as const,
            statusCode: 500,
            pageTitle: 'Error de Conexión',
            htmlLength: 0,
            extractedData: { error: err?.message || 'Error', elapsedMs: elapsed },
            stealthMetrics: { stealthLevelApplied: 'paranoid' as const, fingerprintUsed: {}, bypassedAntiBot: false, durationMs: elapsed },
            createdAt: new Date().toISOString(),
          } as any;
        });
      })
    );
    return {
      success: true,
      totalRequested: urls.length,
      successfulCount: results.filter((r) => r.status === 'SUCCESS' || r.status === 'DOM_STRUCTURE_CHANGED').length,
      blockedCount: results.filter((r) => r.status === 'BLOCKED' || r.status === 'ERROR').length,
      results,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  // Tarea 3: Método específico para Network Interceptor (soporta múltiples URLs secuenciales)
  private async scrapeWithNetworkInterceptor(params: {
    url?: string;
    urls?: string[];
    useProxy?: boolean;
    timeoutMs?: number;
    sessionId?: string;
    adapter?: SiteOddsAdapter | null;
  }): Promise<any> {
    const { url, urls: rawUrls, useProxy, timeoutMs, sessionId, adapter } = params;
    const targetUrls = rawUrls && rawUrls.length > 0 ? rawUrls : url ? [url] : [];
    const primaryUrl = targetUrls[0] || '';
    const startTime = Date.now();
    console.log(`📡 [Network] Interceptando ${targetUrls.length} URL(s) para ${primaryUrl} ${adapter ? `con adapter ${adapter.domain}` : 'sin adapter (fallback Stake)'}`);
    let proxyConfig: any = null;
    let proxy: any = null;
    if (useProxy && env.proxy.enabled) {
      proxy = this.proxyRotator.getProxy(sessionId);
      if (proxy) {
        proxyConfig = this.proxyRotator.getProxyServerWithAuth(proxy);
        console.log(`🌐 Usando proxy: ${proxyConfig.server}`);
      }
    }
    const fingerprint = (() => {
      try {
        const domain = new URL(primaryUrl).hostname.toLowerCase();
        if (domain.includes('stake.com.co')) {
          const fp = FingerprintGenerator.generate('paranoid', 'CO');
          (fp as any).timezoneId = 'America/Bogota';
          (fp as any).locale = 'es-CO,es;q=0.9,en;q=0.8';
          // Para Stake con Chromium, garantizar User-Agent de Chrome (evita 406 por discrepancia TLS/Blink)
          fp.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
          fp.platform = 'Win32';
          return fp;
        }
      } catch {}
      return FingerprintGenerator.generate('paranoid', proxy?.country);
    })();
    const browser = await this.browserPool.acquireBrowser(proxyConfig);
    const effectiveAdapter = adapter || this.adapterRegistry.getForUrl(primaryUrl);
    const allCapturedPayloads: any[] = [];
    const successfulUrls: string[] = [];
    const failedUrls: Array<{ url: string; error: string; durationMs: number }> = [];
    const extraPayloads: any[] = [];
    let globalHidenseek = '';
    let globalEndpointBase = 'https://pre-115o-sp.websbkt.com/cache/115/es/co/America-Bogota/events-by-path.json';

    let context: BrowserContext | null = null;

    try {
      context = await PlaywrightStealthFactory.createContext(browser, fingerprint, 'paranoid', proxyConfig);

      // Captura instantánea de hidenseek a nivel de contexto (intercepta peticiones salientes de KickerTech)
      context.on('request', (req) => {
        try {
          const u = req.url();
          if (u.includes('hidenseek=')) {
            const match = u.match(/hidenseek=([^&]+)/);
            if (match) {
              const token = decodeURIComponent(match[1]);
              if (!globalHidenseek || u.includes('events-by-path')) {
                globalHidenseek = token;
                console.log('🔑 [Stake Multi] Hidenseek capturado de request:', globalHidenseek.slice(0, 25) + '...', 'URL:', u.slice(0, 90));
              }
            }
          }
          if (u.includes('events-by-path.json')) {
            globalEndpointBase = u.split('?')[0];
            console.log('📍 [Stake Multi] Base de API detectada de events-by-path:', globalEndpointBase);
          } else if (u.includes('prematch-left-menu.json')) {
            globalEndpointBase = u.replace('prematch-left-menu.json', 'events-by-path.json').split('?')[0];
            console.log('📍 [Stake Multi] Base de API detectada de prematch-left-menu:', globalEndpointBase);
          }
        } catch {}
      });

      for (let i = 0; i < targetUrls.length; i++) {
        const currentUrl = targetUrls[i];
        if (successfulUrls.includes(currentUrl)) {
          console.log(`⏩ [Stake Multi] (${i + 1}/${targetUrls.length}) ${currentUrl} ya extraído exitosamente en sesión activa — omitiendo navegación.`);
          continue;
        }
        const urlStartTime = Date.now();
        const MAX_RETRIES = 1;
        let attempt = 0;
        let urlSuccess = false;

        while (attempt <= MAX_RETRIES && !urlSuccess) {
          attempt++;
          let page: Page | null = null;
          let pageInterceptor: OddsNetworkInterceptor | null = null;

          try {
            page = await context.newPage();
            await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

            pageInterceptor = new OddsNetworkInterceptor(effectiveAdapter?.urlPatterns || []);
            pageInterceptor.attach(page);

            if (i > 0 || attempt > 1) {
              // Pausa humana orgánica entre deportes o reintentos
              await EvasionService.humanDelay(1000, 200, 600);
            }
            console.log(`📡 [Stake Multi] (${i + 1}/${targetUrls.length}) Navegando a ${currentUrl}${attempt > 1 ? ` (reintento ${attempt - 1})` : ''}`);

            // Listener específico para eventos: espera exclusivamente a events-by-path con cuotas reales
            const eventsPromise = page.waitForResponse(
              (res) => res.url().includes('events-by-path') && res.status() === 200,
              { timeout: i === 0 && !globalHidenseek ? 18000 : 3500 }
            ).catch(() => null);

            await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 26000 }).catch(async () => {
              if (page) await page.waitForTimeout(2000);
            });

            // Despertar widgets inmediatamente con scroll suave
            await page.evaluate(() => window.scrollBy(0, 350)).catch(() => {});
            await EvasionService.simulateAdvancedHumanBehavior(page);

            // Esperar a que eventsPromise resuelva si no tenemos hidenseek, o brevemente si ya lo tenemos
            if (i === 0 && !globalHidenseek) {
              await eventsPromise;
            } else {
              await Promise.race([eventsPromise, page.waitForTimeout(2500)]);
            }

            const pagePayloads = pageInterceptor ? pageInterceptor.getCaptured() : [];

            // Extraer hidenseek global si aún no lo tenemos
            if (!globalHidenseek) {
              const hsPayload = pagePayloads.slice().reverse().find((p: any) => typeof p.url === 'string' && p.url.includes('hidenseek='));
              if (hsPayload) {
                const match = hsPayload.url.match(/hidenseek=([^&]+)/);
                if (match) {
                  globalHidenseek = decodeURIComponent(match[1]);
                  console.log('🔑 [Stake Multi] Hidenseek capturado de payload:', globalHidenseek.slice(0, 25) + '...');
                }
              }
            }
            if (!globalHidenseek && page) {
              try {
                const perfToken = await page.evaluate(() => {
                  const entries = performance.getEntriesByType('resource');
                  for (const e of entries) {
                    const u = (e as any).name || '';
                    if (u.includes('hidenseek=')) {
                      const m = u.match(/hidenseek=([^&]+)/);
                      if (m) return decodeURIComponent(m[1]);
                    }
                  }
                  return null;
                });
                if (perfToken) {
                  globalHidenseek = perfToken;
                  console.log('🔑 [Stake Multi] Hidenseek capturado de performance entries:', globalHidenseek.slice(0, 25) + '...');
                }
              } catch {}
            }
            if (!globalHidenseek && page) {
              globalHidenseek = await stakeKickerAdapter.getHidenseek(page);
              if (globalHidenseek) {
                console.log('🔑 [Stake Multi] Hidenseek capturado de DOM:', globalHidenseek.slice(0, 25) + '...');
              }
            }

            // Comprobación estricta de cuotas reales
            let hasRealEvents = pagePayloads.some((p: any) => {
              const data = p?.json || p?.body;
              if (!data) return false;
              return (Array.isArray(data.events) && data.events.length > 0) || (Array.isArray(data.data?.events) && data.data.events.length > 0);
            });

            // Si el UI no emitió cuotas automáticamente (tenis, basket, tenis de mesa), extraer directamente vía API interna
            const isStakeDomain = currentUrl.includes('stake.com.co') || effectiveAdapter === stakeKickerAdapter;
            if (!hasRealEvents && isStakeDomain && page && globalHidenseek) {
              const urlParts = currentUrl.split('/').filter(Boolean);
              let rawSlug = urlParts[urlParts.length - 1] || 'football';
              if (rawSlug === 'deportes') rawSlug = 'football';
              const sportSlug = rawSlug === 'table_tennis' ? 'table-tennis' : rawSlug;
              const expansionDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

              console.log(`📡 [Stake Multi] Extrayendo cuotas directas vía in-page para '${sportSlug}'...`);
              const fetchRes: any = await page.evaluate(async ({ base, hs, sport, date }) => {
                const targetUrl = `${base}?path=${encodeURIComponent(sport)}&date=${date}&hidenseek=${encodeURIComponent(hs)}`;
                try {
                  const res = await fetch(targetUrl, { headers: { Accept: 'application/json' } });
                  if (res.status === 200) {
                    const json = await res.json();
                    const count = Array.isArray(json.events) ? json.events.length : 0;
                    if (count > 0) return { status: 200, json, url: targetUrl };
                  }
                  return { status: res.status, json: null, url: targetUrl };
                } catch (e: any) {
                  return { status: 0, json: null, url: targetUrl, error: e?.message };
                }
              }, { base: globalEndpointBase, hs: globalHidenseek, sport: sportSlug, date: expansionDateStr });

              if (fetchRes.status === 200 && fetchRes.json) {
                pagePayloads.push({
                  url: fetchRes.url,
                  json: fetchRes.json,
                  timestamp: new Date().toISOString(),
                });
                hasRealEvents = true;
                const count = Array.isArray(fetchRes.json.events) ? fetchRes.json.events.length : 0;
                console.log(`✅ [Stake Multi] ${count} eventos recuperados directamente para '${sportSlug}'`);
              } else {
                console.warn(`⚠️ [Stake Multi] Fetch directo falló para '${sportSlug}': status=${fetchRes.status} error=${fetchRes.error || 'none'}`);
              }
            }

            console.log(`📡 [Stake Multi] Payloads capturados para ${currentUrl}: ${pagePayloads.length} (hasRealEvents: ${hasRealEvents})`);

            if (hasRealEvents) {
              allCapturedPayloads.push(...pagePayloads);
              successfulUrls.push(currentUrl);
              urlSuccess = true;

              if (isStakeDomain && page && globalHidenseek) {
                // Extraer de inmediato todos los demás deportes del lote desde esta misma sesión activa e hidratada
                const remainingUrls = targetUrls.slice(i + 1);
                for (let j = 0; j < remainingUrls.length; j++) {
                  const nextUrl = remainingUrls[j];
                  if (successfulUrls.includes(nextUrl)) continue;
                  const urlParts = nextUrl.split('/').filter(Boolean);
                  let rawSlug = urlParts[urlParts.length - 1] || 'football';
                  if (rawSlug === 'deportes') rawSlug = 'football';
                  const sportSlug = rawSlug === 'table_tennis' ? 'table-tennis' : rawSlug;
                  const expansionDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

                  console.log(`📡 [Stake Multi] Extrayendo directamente en sesión activa para '${sportSlug}'...`);
                  const subFetchRes: any = await page.evaluate(async ({ base, hs, sport, date }) => {
                    const targetUrl = `${base}?path=${encodeURIComponent(sport)}&date=${date}&hidenseek=${encodeURIComponent(hs)}`;
                    try {
                      const res = await fetch(targetUrl, { headers: { Accept: 'application/json' } });
                      if (res.status === 200) {
                        const json = await res.json();
                        const count = Array.isArray(json.events) ? json.events.length : 0;
                        if (count > 0) return { status: 200, json, url: targetUrl };
                      }
                      return { status: res.status, json: null, url: targetUrl };
                    } catch (e: any) {
                      return { status: 0, json: null, url: targetUrl, error: e?.message };
                    }
                  }, { base: globalEndpointBase, hs: globalHidenseek, sport: sportSlug, date: expansionDateStr });

                  if (subFetchRes.status === 200 && subFetchRes.json) {
                    allCapturedPayloads.push({
                      url: subFetchRes.url,
                      json: subFetchRes.json,
                      timestamp: new Date().toISOString(),
                    });
                    successfulUrls.push(nextUrl);
                    const count = Array.isArray(subFetchRes.json.events) ? subFetchRes.json.events.length : 0;
                    console.log(`✅ [Stake Multi] (${i + 2 + j}/${targetUrls.length}) ${count} eventos recuperados directamente para '${sportSlug}'`);
                  } else {
                    console.warn(`⚠️ [Stake Multi] Extracción directa en sesión falló para '${sportSlug}' (status=${subFetchRes.status})`);
                  }
                }
              }
            } else if (attempt <= MAX_RETRIES) {
              console.warn(`⚠️ [Stake Multi] Intento ${attempt} sin eventos para ${currentUrl} — reintentando...`);
            } else {
              console.warn(`⚠️ [Stake Multi] 0 eventos para ${currentUrl} tras ${attempt} intentos — URL fallida`);
              failedUrls.push({
                url: currentUrl,
                error: 'No se capturaron eventos de cuotas tras reintento',
                durationMs: Date.now() - urlStartTime,
              });
            }
          } catch (navErr: any) {
            console.warn(`⚠️ [Stake Multi] Error en intento ${attempt} para ${currentUrl}: ${navErr?.message}`);
            if (attempt > MAX_RETRIES) {
              failedUrls.push({
                url: currentUrl,
                error: navErr?.message || 'Error de navegación o timeout',
                durationMs: Date.now() - urlStartTime,
              });
            }
          } finally {
            if (page && pageInterceptor) {
              pageInterceptor.detach(page);
              await page.close().catch(() => {});
            }
          }
        }
      }

      let allPayloads = [...allCapturedPayloads, ...extraPayloads];
      console.log(`📦 Payloads totales capturados en el batch: ${allPayloads.length}`);

      let odds: BookmakerOdd[] = [];
      if (effectiveAdapter) {
        odds = effectiveAdapter.extract(allPayloads as any);
      } else if (primaryUrl.includes('stake.com.co')) {
        const stakeAdapter = stakeKickerAdapter;
        odds = stakeAdapter.extract(allPayloads as any);
      }
      console.log(`📊 Odds extraídas en batch: ${odds.length} (exitosas: ${successfulUrls.length}, fallidas: ${failedUrls.length})`);

      // GUARDA: Alimentar motor de Surebets + persistencia temporal ÚNICAMENTE si odds.length > 0
      if (odds.length > 0) {
        const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
        SurebetCalculatorService.getInstance().addScrapedOdds(odds);
        const persistBookmaker = odds[0]?.bookmaker || deriveBookmakerFromUrl(primaryUrl) || 'Stake';
        OddsPersistenceService.getInstance().saveOddsForBookmaker(persistBookmaker, odds);
        console.log(`💾 [Stake Multi] ${odds.length} cuotas guardadas para ${persistBookmaker}`);
      } else {
        console.warn('⚠️ [Stake Multi] 0 cuotas extraídas en todo el batch — se conserva intacto el histórico en disco');
      }

      const matches = this.convertBookmakerOddsToMatches(odds);

      return {
        source: 'network' as const,
        oddsCount: odds.length,
        matches,
        totalMatches: matches.length,
        payloads: allPayloads.length,
        successfulUrls,
        failedUrls,
        durationMs: Date.now() - startTime,
        odds,
        url: primaryUrl,
        urls: targetUrls,
      };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
      await this.browserPool.releaseBrowser(browser, !!proxyConfig);
    }
  }

  // ==================== SELECTORES PERSONALIZADOS (FRONTEND) ====================
  public async scrapeWithCustomSelectors(request: {
    url?: string;
    urls?: string[];
    selectors: Record<string, string>;
    useProxy?: boolean;
    timeoutMs?: number;
    sessionId?: string;
  }): Promise<{
    success: boolean;
    url: string;
    urls?: string[];
    successfulUrls?: string[];
    failedUrls?: Array<{ url: string; error: string; durationMs: number }>;
    matches: any[];
    totalMatches: number;
    durationMs: number;
    selectorsUsed: string[];
    proxyUsed?: string;
    timestamp: string;
    error?: string;
    captchaType?: string | null;
    source?: 'network' | 'dom';
    oddsCount?: number;
    htmlSize?: number;
    bookmaker?: string;
  }> {
    const { url: rawUrl, urls: rawUrls, useProxy = true, timeoutMs, sessionId } = request;
    const targetUrls: string[] = rawUrls && rawUrls.length > 0 ? rawUrls : rawUrl ? [rawUrl] : [];
    const primaryRawUrl = targetUrls[0] || '';
    let selectors = request.selectors;
    const startTime = Date.now();
    // Normalizar URL igual que en executeSingleScrape (idempotente)
    let url: string;
    try {
      url = encodeURI(decodeURI(primaryRawUrl));
    } catch {
      try {
        url = encodeURI(primaryRawUrl);
      } catch {
        url = primaryRawUrl;
      }
    }

    // ✅ Logging diagnóstico del adapter (TAREA 2)
    console.log(`🔍 URL recibida: ${url} (Total en batch: ${targetUrls.length})`);
    try {
      console.log(`🔍 Dominio extraído: ${new URL(url).hostname}`);
    } catch {
      console.log(`🔍 Dominio extraído: invalid-url`);
    }
    const _diagAdapter = this.adapterRegistry.getForUrl(url);
    console.log(`🔍 URL: ${url}`);
    console.log(`🔍 Adapter encontrado: ${_diagAdapter ? '✅ Sí' : '❌ No'}`);
    if (_diagAdapter) {
      console.log(`🔍 Dominio del adapter: ${_diagAdapter.domain}`);
    } else {
      console.warn('⚠️ No se encontró adapter para esta URL, usando DOM fallback');
    }

    // Validar obligatorios — permitir vacíos si el dominio tiene adapter de red registrado
    // (fuerza interceptor en vez de selectores CSS). Stake se mantiene como fallback explícito
    // por si el hostname exacto no matchea el registro (subdominios, etc.).
    const isStakeUrl = url.includes('stake.com.co');
    const isWplayUrl = url.includes('wplay.co');
    const hasRegisteredAdapter = !!this.adapterRegistry.getForUrl(url);
    if (isStakeUrl || isWplayUrl || hasRegisteredAdapter) {
      // Normalizar a vacíos para forzar red
      selectors = {
        events: selectors.events || '',
        homeTeam: selectors.homeTeam || '',
        awayTeam: selectors.awayTeam || '',
        oddsHome: selectors.oddsHome || '',
        oddsDraw: selectors.oddsDraw || '',
        oddsAway: selectors.oddsAway || '',
      } as any;
    } else {
      const required = ['events', 'homeTeam', 'awayTeam', 'oddsHome', 'oddsDraw', 'oddsAway'];
      const missing = required.filter((k) => !selectors[k]);
      if (missing.length > 0) {
        throw new Error(`Faltan selectores obligatorios: ${missing.join(', ')}`);
      }
    }

    const effectiveUseProxy = useProxy && env.proxy.enabled;
    let proxy = effectiveUseProxy ? this.proxyRotator.getProxy(sessionId) : undefined;
    const proxyConfig = proxy ? this.proxyRotator.getProxyServerWithAuth(proxy) : undefined;
    const proxyServer = proxyConfig?.server;
    // Tarea 2: logging proxy para custom
    if (proxyConfig) {
      console.log('🌐 Usando proxy:', proxyConfig.server, proxyConfig.username ? `(user:${proxyConfig.username})` : '');
    } else if (env.proxy.enabled) {
      console.warn('⚠️ PROXY_ENABLED=true pero sin proxy disponible — usando IP directa');
    } else {
      console.log('🌐 Sin proxy — IP directa');
    }

    const stealthLevel = 'paranoid' as const;
    let fingerprint;
    // 🔥 Forzar fingerprint CO para Stake (Paso 1)
    try {
      const domain = new URL(url).hostname.toLowerCase();
      if (domain === 'stake.com.co' || domain === 'www.stake.com.co' || domain.includes('stake.com.co')) {
        console.log('🇨🇴 Forzando fingerprint CO para Stake');
        fingerprint = FingerprintGenerator.generate(stealthLevel, 'CO');
        // Forzar valores CO explícitos para evitar 406
        (fingerprint as any).timezoneId = 'America/Bogota';
        (fingerprint as any).locale = 'es-CO,es;q=0.9,en;q=0.8';
        console.log(`🇨🇴 Fingerprint aplicado: ${fingerprint.timezoneId} / ${fingerprint.locale}`);
        console.log(`🌐 User-Agent: ${fingerprint.userAgent}`);
        console.log(`📱 Viewport: ${fingerprint.viewport.width}x${fingerprint.viewport.height}`);
      } else {
        fingerprint = proxy?.country
          ? FingerprintGenerator.generate(stealthLevel, proxy.country)
          : FingerprintGenerator.generate(stealthLevel);
        console.log(`🌐 Fingerprint: ${fingerprint.locale} / ${fingerprint.timezoneId}`);
        console.log(`📱 User-Agent: ${fingerprint.userAgent.slice(0, 80)}...`);
      }
    } catch {
      fingerprint = proxy?.country
        ? FingerprintGenerator.generate(stealthLevel, proxy.country)
        : FingerprintGenerator.generate(stealthLevel);
    }

    // === BETPLAY: Fetch directo a la API de Kambi (sin Playwright) ===
    // BetPlay bloquea cualquier navegador headless con reCAPTCHA incluso usando proxy.
    // La API de Kambi es 100% pública (CORS abierto, sin auth). Hacemos el fetch
    // directamente desde Node, evitando Playwright por completo para este dominio.
    // El batch puede contener URLs de múltiples deportes; iteramos cada una de forma
    // independiente para que un fallo en un deporte no cancele el resto.
    try {
      const domain = new URL(url).hostname;
      const isBetPlay = domain.includes('betplay.com.co');
      if (isBetPlay) {
        console.log(`⚡ [BetPlay] Batch de ${targetUrls.length} URL(s) — fetch directo a Kambi (sin Playwright)`);
        const allBetPlayOdds: BookmakerOdd[] = [];
        const betPlaySuccessfulUrls: string[] = [];
        const betPlayFailedUrls: Array<{ url: string; error: string; durationMs: number }> = [];

        for (const targetUrl of targetUrls) {
          try {
            // Extraer el slug del deporte de la URL del frontend — parseo de string puro,
            // sin dependencia de navegador. El hash '#sports-hub/football' es solo un string
            // recibido como parámetro del request; Node.js lo divide directamente.
            // Formatos soportados:
            //   https://tienda.betplay.com.co/apuestas#sports-hub/football
            //   https://tienda.betplay.com.co/apuestas#sports-hub/table_tennis
            const hashPart = targetUrl.split('#')[1] || '';
            const sportSlug = hashPart.split('/').pop()?.toLowerCase().trim() || 'football';
            console.log(`📡 [BetPlay] Procesando URL: ${targetUrl} → sportSlug: '${sportSlug}'`);

            const urlOdds = await betplayKambiAdapter.fetchDirect(sportSlug);
            if (urlOdds.length > 0) {
              allBetPlayOdds.push(...urlOdds);
              betPlaySuccessfulUrls.push(targetUrl);
              console.log(`✅ [BetPlay] ${sportSlug}: ${urlOdds.length} odds`);
            } else {
              betPlayFailedUrls.push({ url: targetUrl, error: `Kambi no devolvió cuotas para '${sportSlug}'`, durationMs: 0 });
              console.warn(`⚠️ [BetPlay] ${targetUrl} → 0 odds para '${sportSlug}'`);
            }
          } catch (urlErr: any) {
            betPlayFailedUrls.push({ url: targetUrl, error: urlErr.message || 'Error desconocido', durationMs: 0 });
            console.error(`❌ [BetPlay] Error procesando ${targetUrl}:`, urlErr.message);
          }
        }

        // Persistir solo si hay cuotas reales — nunca sobreescribir con array vacío
        if (allBetPlayOdds.length > 0) {
          const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
          SurebetCalculatorService.getInstance().addScrapedOdds(allBetPlayOdds);
          OddsPersistenceService.getInstance().saveOddsForBookmaker('BetPlay', allBetPlayOdds);
          console.log(`✅ [BetPlay] Batch completo: ${allBetPlayOdds.length} odds de ${betPlaySuccessfulUrls.length} URL(s)`);
        } else {
          console.warn('⚠️ [BetPlay] Batch completo con 0 odds — no se sobreescribe el histórico en disco');
        }

        const bpMatches = this.convertBookmakerOddsToMatches(allBetPlayOdds);
        return {
          success: allBetPlayOdds.length > 0,
          url: primaryRawUrl,
          urls: targetUrls,
          successfulUrls: betPlaySuccessfulUrls,
          failedUrls: betPlayFailedUrls,
          matches: bpMatches,
          totalMatches: bpMatches.length,
          durationMs: Date.now() - startTime,
          selectorsUsed: [],
          proxyUsed: 'Directo (Kambi API pública)',
          timestamp: new Date().toISOString(),
          source: 'network' as const,
          oddsCount: allBetPlayOdds.length,
          htmlSize: 0,
          bookmaker: 'BetPlay',
          ...(allBetPlayOdds.length === 0 && {
            error: 'Kambi no devolvió cuotas en ninguna URL del batch — verifica que los deportes estén disponibles.',
          }),
        };
      }
    } catch (e: any) {
      console.warn('⚠️ [BetPlay] fetchDirect falló:', e.message);
    }

    // Fix 3B: Para adapters de tipo network-only (Stake y cualquier adapter registrado),
    // NUNCA caer al DOM fallback — Stake es un widget/canvas sin datos en el DOM.
    // Si el interceptor devuelve 0 cuotas, retornamos directamente con mensaje claro
    // en vez de perder ~30 s adicionales en un DOM fallback que siempre devuelve 0.
    try {
      const domain = new URL(url).hostname;
      const adapter = this.adapterRegistry.getForDomain(domain);
      const isStake = domain.includes('stake.com.co');
      if (adapter || isStake) {
        console.log(`📡 Usando Network Interceptor para ${domain} ${adapter ? `(${adapter.domain})` : '(Stake)'}`);
        const netResult = await this.scrapeWithNetworkInterceptor({
          urls: targetUrls,
          url,
          useProxy,
          timeoutMs,
          sessionId,
          adapter: adapter || null,
        });
        // Siempre retornar el resultado de red — jamás DOM fallback para adapters network-only.
        // Si oddsCount === 0, el proxy probablemente no pasó el challenge de Cloudflare.
        if (netResult.oddsCount === 0) {
          console.warn(`⚠️ [Network-only] 0 cuotas capturadas para ${domain}. Probable causa: proxy bloqueado o lento.`);
        } else {
          console.log(`✅ Network Interceptor éxito: ${netResult.oddsCount} odds (exitosas: ${netResult.successfulUrls?.length}, fallidas: ${netResult.failedUrls?.length})`);
        }
        return {
          success: netResult.oddsCount > 0,
          url: primaryRawUrl,
          urls: targetUrls,
          successfulUrls: netResult.successfulUrls || [],
          failedUrls: netResult.failedUrls || [],
          matches: netResult.matches,
          totalMatches: netResult.matches.length,
          durationMs: netResult.durationMs,
          selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
          proxyUsed: (netResult as any).proxyUsed || proxyServer || 'N/A',
          timestamp: new Date().toISOString(),
          source: 'network' as const,
          oddsCount: netResult.oddsCount,
          htmlSize: 0,
          bookmaker: adapter?.domain ?? 'Stake',
          // Mensaje claro para el frontend cuando el proxy falla silenciosamente
          ...(netResult.oddsCount === 0 && {
            error: 'El proxy asignado no pudo capturar datos de red para estas URLs. Esto suele deberse a un proxy bloqueado o lento — intenta de nuevo (rotará a un proxy distinto).',
          }),
        };
      }
    } catch (e: any) {
      console.warn('⚠️ Error en Network Interceptor:', e.message);
      // Solo relanzar si es un error de código, no de proxy
      throw e;
    }

    // === WPLAY: Extracción DOM Resiliente por lote (Playwright) ===
    try {
      const domain = new URL(url).hostname;
      const isWplay = domain.includes('wplay.co');
      if (isWplay) {
        console.log(`⚡ [Wplay] Batch de ${targetUrls.length} URL(s) — DOM Resiliente (Playwright)`);
        const allWplayOdds: BookmakerOdd[] = [];
        const wplaySuccessfulUrls: string[] = [];
        const wplayFailedUrls: Array<{ url: string; error: string; durationMs: number }> = [];

        const browser = await this.browserPool.acquireBrowser();
        const context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel, proxyConfig);
        const page = await context.newPage();
        await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

        try {
          for (const targetUrl of targetUrls) {
            const urlStart = Date.now();
            try {
              console.log(`📡 [Wplay] Navegando a URL: ${targetUrl}`);
              await page.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: timeoutMs || 30000,
              });

              // Esperar a que el DOM renderice botones con cuotas (o timeout suave)
              await page.waitForSelector('span.price.dec, button.price', { timeout: 8000 }).catch(() => {});
              await EvasionService.simulateAdvancedHumanBehavior(page);

              const pageOdds = await ResilientSelectorEngine.extractBookmakerOdds(page, 'Wplay');
              if (pageOdds.length > 0) {
                allWplayOdds.push(...pageOdds);
                wplaySuccessfulUrls.push(targetUrl);
                console.log(`✅ [Wplay] ${targetUrl}: ${pageOdds.length} odds extraídas en ${Date.now() - urlStart}ms`);
              } else {
                console.warn(`⚠️ [Wplay] ${targetUrl}: 0 odds extraídas`);
                wplayFailedUrls.push({ url: targetUrl, error: '0 cuotas detectadas en el DOM', durationMs: Date.now() - urlStart });
              }
            } catch (err: any) {
              console.warn(`❌ [Wplay] Error en ${targetUrl}:`, err.message);
              wplayFailedUrls.push({ url: targetUrl, error: err.message || 'Error de navegación', durationMs: Date.now() - urlStart });
            }
          }
        } finally {
          await page.close().catch(() => {});
          await context.close().catch(() => {});
        }

        if (allWplayOdds.length > 0) {
          const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
          SurebetCalculatorService.getInstance().addScrapedOdds(allWplayOdds);
          OddsPersistenceService.getInstance().saveOddsForBookmaker('Wplay', allWplayOdds);
          console.log(`✅ [Wplay] Batch completo: ${allWplayOdds.length} odds de ${wplaySuccessfulUrls.length} URL(s)`);
        } else {
          console.warn('⚠️ [Wplay] Batch completo con 0 odds — no se sobreescribe el histórico en disco');
        }

        const wpMatches = this.convertBookmakerOddsToMatches(allWplayOdds);
        return {
          success: allWplayOdds.length > 0,
          url: primaryRawUrl,
          urls: targetUrls,
          successfulUrls: wplaySuccessfulUrls,
          failedUrls: wplayFailedUrls,
          matches: wpMatches,
          totalMatches: wpMatches.length,
          durationMs: Date.now() - startTime,
          selectorsUsed: ['span.price.dec', 'button.price'],
          proxyUsed: proxyServer || 'Directo / Proxy',
          timestamp: new Date().toISOString(),
          source: 'dom' as const,
          oddsCount: allWplayOdds.length,
          htmlSize: 0,
          bookmaker: 'Wplay',
          ...(allWplayOdds.length === 0 && {
            error: 'No se encontraron cuotas en ninguna URL de Wplay — verifica que los eventos estén abiertos.',
          }),
        };
      }
    } catch (e: any) {
      console.warn('⚠️ [Wplay] scrapeWithCustomSelectors falló:', e.message);
    }

    const browser = await this.browserPool.acquireBrowser();
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let oddsInterceptor: OddsNetworkInterceptor | null = null;
    const wsPayloads: any[] = [];

    try {
      context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel, proxyConfig);
      page = await context.newPage();
      await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

      // Si existe adapter de red para este dominio, interceptar respuestas JSON antes de navegar (fallback, ya intentado arriba)
      const networkAdapter: SiteOddsAdapter | null = this.adapterRegistry.getForUrl(url);
      console.log(`🔍 Adapter encontrado (intercept): ${networkAdapter ? '✅ Sí' : '❌ No'}`);
      // Tarea 1: captura hidenseek desde requests
      const hidenseekFromRequests: string[] = [];
      page.on('request', (req: any) => {
        const u = req.url();
        if (u.includes('hidenseek')) {
          console.log('🔑 Hidenseek encontrado en request:', u.slice(0, 130));
          const m = u.match(/hidenseek=([^&]+)/);
          if (m) hidenseekFromRequests.push(decodeURIComponent(m[1]));
        }
      });
      if (networkAdapter) {
        console.log(`🔍 Dominio del adapter: ${networkAdapter.domain}`);
        oddsInterceptor = new OddsNetworkInterceptor(networkAdapter.urlPatterns);
        oddsInterceptor.attach(page);
        console.log(`[ScraperService][custom] Network interceptor activo para ${networkAdapter.domain} (${networkAdapter.urlPatterns.length} patrones)`);
        // También capturar WebSocket frames para KickerTech (Stake usa wss://fews.stake.com.co)
        page.on('websocket', (ws: any) => {
          ws.on('framereceived', (payload: any) => {
            try {
              const data = typeof payload.payload === 'string' ? payload.payload : JSON.stringify(payload.payload);
              // Buscar sports-payout y otros mensajes con odds
              if (data.includes('sports-payout') || data.includes('eventName') || data.includes('odds')) {
                try {
                  const json = JSON.parse(data.slice(data.indexOf('{')));
                  wsPayloads.push({ url: ws.url(), json, timestamp: new Date().toISOString() });
                } catch {
                  // Si no es JSON puro, guardar como texto
                  wsPayloads.push({ url: ws.url(), json: { raw: data.slice(0, 2000) }, timestamp: new Date().toISOString() });
                }
              }
            } catch {}
          });
        });
      } else {
        console.warn('⚠️ No se encontró adapter para esta URL, usando DOM fallback');
      }

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs || env.browserTimeoutMs,
      });

      const html = await page.content();
      const title = await page.title();
      const captchaInfo = EvasionService.handleCaptchaDetected(html, proxy?.id);
      if (captchaInfo.detected) {
        if (proxy) this.proxyRotator.markProxyFailure(proxy.id, `Captcha ${captchaInfo.type}`, Date.now() - startTime);
        if (page && oddsInterceptor) oddsInterceptor.detach(page);
        return {
          success: false,
          url,
          matches: [],
          totalMatches: 0,
          durationMs: Date.now() - startTime,
          selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
          proxyUsed: proxyServer,
          timestamp: new Date().toISOString(),
          error: `Captcha detectado: ${captchaInfo.type}`,
          captchaType: captchaInfo.type,
          source: 'dom',
          oddsCount: 0,
          htmlSize: html.length,
          bookmaker: deriveBookmakerFromUrl(url) || 'Unknown',
        };
      }

      await EvasionService.simulateAdvancedHumanBehavior(page);

      // Esperar a que KickerTech cargue sus payloads — similar a discovery (4000ms + scroll)
      await page.waitForTimeout(4000);
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);
      } catch {}

      // Tarea 3: Extraer hidenseek dinámicamente de la página
      let hidenseek = '';
      try {
        hidenseek = await page.evaluate(() => {
          const cfg = (window as any).__config__;
          if (cfg?.hidenseek) return cfg.hidenseek;
          if ((window as any).hidenseek) return (window as any).hidenseek;
          // Buscar en localStorage
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              if (k && k.toLowerCase().includes('hidenseek')) {
                const v = localStorage.getItem(k);
                if (v) return v;
              }
            }
          } catch {}
          return '';
        });
        if (!hidenseek) {
          // Buscar en performance entries
          hidenseek = await page.evaluate(() => {
            const entries = (performance.getEntriesByType('resource') as any[]) || [];
            for (const e of entries) {
              const m = (e.name || '').match(/hidenseek=([^&]+)/);
              if (m) return decodeURIComponent(m[1]);
            }
            return '';
          });
        }
        // Fallback a request intercept (más fiable)
        if (!hidenseek && (hidenseekFromRequests as any).length > 0) {
          hidenseek = (hidenseekFromRequests as any)[0];
          console.log(`🔑 Hidenseek extraído de request intercept: ${hidenseek.slice(0, 30)}...`);
        }
        console.log(`🔑 Hidenseek extraído: ${hidenseek ? '✅ ' + hidenseek.slice(0, 30) + '...' : '❌ vacío'}`);
      } catch (error: any) {
        console.warn('⚠️ No se pudo extraer hidenseek:', error.message);
      }

      // Si tenemos hidenseek, intentar fetch directo con token válido (solución 406)
      if (hidenseek && networkAdapter?.domain === 'stake.com.co') {
        const dateStr = new Date().toISOString().split('T')[0];
        console.log(`🔑 Intentando fetchWithDate con hidenseek para ${dateStr}...`);
        try {
          const hidData = await (stakeKickerAdapter as any).fetchWithDate(dateStr, hidenseek);
          if (hidData && hidData.length > 0) {
            const hidOdds = stakeKickerAdapter.extract(hidData as any);
            if (hidOdds.length > 0) {
              console.log(`✅ Hidenseek fetch éxito: ${hidOdds.length} odds`);
            }
            if (hidOdds.length > 0) {
              const matches = this.convertBookmakerOddsToMatches(hidOdds);
              const durationMs = Date.now() - startTime;
              if (proxy) this.proxyRotator.markProxySuccess(proxy.id, durationMs);
              const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
              SurebetCalculatorService.getInstance().addScrapedOdds(hidOdds);
              OddsPersistenceService.getInstance().saveOddsForBookmaker(deriveBookmakerFromUrl(url) || 'Stake', hidOdds);
              return {
                success: true,
                url,
                matches,
                totalMatches: matches.length,
                durationMs,
                selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
                proxyUsed: proxyServer || 'Directo / Socket Limpio',
                timestamp: new Date().toISOString(),
                source: 'network',
                oddsCount: hidOdds.length,
                htmlSize: html.length,
                bookmaker: deriveBookmakerFromUrl(url) || 'Stake',
              };
            } else {
              console.warn('⚠️ Hidenseek fetch sin odds, continuando con interceptor');
            }
          }
        } catch (e: any) {
          console.warn('⚠️ Hidenseek fetch error:', e.message);
        }
      }

      // Si se capturaron datos por red, usarlos (prioridad sobre DOM) — Paso 3 con fecha dinámica y retry
      if (networkAdapter && (oddsInterceptor || wsPayloads.length > 0)) {
        const httpPayloads = oddsInterceptor ? oddsInterceptor.getCaptured() : [];
        // Combinar HTTP + WS payloads para el adapter (WS contiene sports-payout)
        let capturedPayloads: any[] = [...httpPayloads, ...wsPayloads];
        let bookmakerOdds: BookmakerOdd[] = [];
        // Tarea 3: Forzar interceptor — logs según spec
        if (capturedPayloads.length > 0) {
          console.log(`📡 Procesando ${capturedPayloads.length} payloads...`);
          console.log(`📡 [custom] Usando ${capturedPayloads.length} payloads de red (HTTP:${httpPayloads.length} WS:${wsPayloads.length}) para ${url}`);
          // Log de URLs capturadas para diagnóstico cuando 0 odds
          const kickerUrls = capturedPayloads.filter((p) => /websbkt|events-by-path|prematch|fews\.stake|scws/i.test(p.url)).map((p) => p.url.slice(0, 100));
          if (kickerUrls.length > 0) console.log(`📡 [custom] Kicker URLs: ${kickerUrls.slice(0, 5).join(' | ')}`);
          else if (capturedPayloads.length < 5) {
            console.log(`📡 [custom] Payload URLs: ${capturedPayloads.map((p) => p.url.slice(0, 80)).join(' | ')}`);
          }
          bookmakerOdds = networkAdapter.extract(capturedPayloads);
          if (bookmakerOdds.length > 0) {
            console.log(`✅ Extraídas ${bookmakerOdds.length} odds de red`);
            const matches = this.convertBookmakerOddsToMatches(bookmakerOdds);
            const durationMs = Date.now() - startTime;
            if (proxy) this.proxyRotator.markProxySuccess(proxy.id, durationMs);
            // Ingest en surebet engine + persistencia
            if (bookmakerOdds.length > 0) {
              const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
              SurebetCalculatorService.getInstance().addScrapedOdds(bookmakerOdds);
              OddsPersistenceService.getInstance().saveOddsForBookmaker(deriveBookmakerFromUrl(url) || 'Stake', bookmakerOdds);
            }
            return {
              success: true,
              url,
              matches,
              totalMatches: matches.length,
              durationMs,
              selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
              proxyUsed: proxyServer || 'Directo / Socket Limpio',
              timestamp: new Date().toISOString(),
              source: 'network',
              oddsCount: bookmakerOdds.length,
              htmlSize: html.length,
              bookmaker: deriveBookmakerFromUrl(url) || 'Stake',
            };
          } else {
            console.warn('⚠️ Adapter no pudo extraer odds de los payloads');
            console.log('Payloads:', capturedPayloads.map((p: any) => ({ url: p.url, status: (p as any).status || 200 })));
            console.log(`📡 [custom] Adapter ${networkAdapter.domain} capturó ${capturedPayloads.length} payloads pero 0 odds — fallback a DOM`);
            // Log detallado para diagnóstico (solo primeros 3)
            capturedPayloads.slice(0, 3).forEach((p, i) => {
              const keys = Object.keys((p.json as any) || (p as any).body || {}).slice(0, 8).join(',');
              console.log(`  [${i}] ${p.url.slice(0, 100)} keys:${keys} status:200`);
            });
          }
        } else {
          console.warn('⚠️ Adapter no pudo extraer odds de los payloads - 0 payloads capturados');
        }
        // Paso 3: Reintento con fecha dinámica si 0 payloads o 406 o 0 odds
        const has406 = capturedPayloads.some((p: any) => p.status === 406) || capturedPayloads.length === 0 || bookmakerOdds.length === 0;
        if (has406 && networkAdapter.domain === 'stake.com.co') {
          console.warn('⚠️ 406 detectado o 0 payloads/0 odds, reintentando con fecha actual...');
          const dateStr = new Date().toISOString().split('T')[0];
          console.log(`📅 Fecha dinámica: ${dateStr}`);
          const retryPayloads = await this.retryWithDate(url, dateStr);
          if (retryPayloads.length > 0) {
            console.log(`✅ Reintento exitoso: ${retryPayloads.length} payloads con fecha ${dateStr}`);
            const retryOdds = networkAdapter.extract(retryPayloads);
            if (retryOdds.length > 0) {
              const matches = this.convertBookmakerOddsToMatches(retryOdds);
              const durationMs = Date.now() - startTime;
              if (proxy) this.proxyRotator.markProxySuccess(proxy.id, durationMs);
              const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
              SurebetCalculatorService.getInstance().addScrapedOdds(retryOdds);
              OddsPersistenceService.getInstance().saveOddsForBookmaker(deriveBookmakerFromUrl(url) || 'Stake', retryOdds);
              return {
                success: true,
                url,
                matches,
                totalMatches: matches.length,
                durationMs,
                selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
                proxyUsed: proxyServer || 'Directo / Socket Limpio',
                timestamp: new Date().toISOString(),
                source: 'network',
                oddsCount: retryOdds.length,
                htmlSize: html.length,
                bookmaker: deriveBookmakerFromUrl(url) || 'Stake',
              };
            }
          }
        }
      }

      // Tarea 3: Si no hay datos de red, usar DOM fallback
      console.warn('⚠️ Usando DOM fallback');
      const matches = await this.extractWithCustomSelectors(page, selectors);
      const htmlAfter = await page.content().catch(() => html);
      const durationMs = Date.now() - startTime;
      if (proxy) this.proxyRotator.markProxySuccess(proxy.id, durationMs);

      return {
        success: true,
        url,
        matches,
        totalMatches: matches.length,
        durationMs,
        selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
        proxyUsed: proxyServer || 'Directo / Socket Limpio',
        timestamp: new Date().toISOString(),
        source: 'dom',
        oddsCount: matches.length,
        htmlSize: htmlAfter.length,
        bookmaker: deriveBookmakerFromUrl(url) || 'Unknown',
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      if (proxy && error.message?.includes('PROXY')) {
        this.proxyRotator.markProxyFailure(proxy.id, error.message, durationMs);
      }
      return {
        success: false,
        url,
        matches: [],
        totalMatches: 0,
        durationMs,
        selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
        proxyUsed: proxyServer,
        timestamp: new Date().toISOString(),
        error: error.message || 'Error en scraping custom',
        captchaType: null,
        source: 'dom',
        oddsCount: 0,
        htmlSize: 0,
        bookmaker: deriveBookmakerFromUrl(url) || 'Unknown',
      };
    } finally {
      if (page && oddsInterceptor) oddsInterceptor.detach(page);
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      await this.browserPool.releaseBrowser(browser, false);
    }
  }

  /**
   * Helper para retry con fecha dinámica (Paso 2/3) — usa fetch directo con fecha actual
   */
  private async retryWithDate(url: string, dateStr: string): Promise<any[]> {
    try {
      // Reintentar via adapter fetchWithDate
      const payloads = await (stakeKickerAdapter as any).fetchWithDate(dateStr);
      if (payloads && payloads.length > 0) {
        console.log(`📅 retryWithDate ${dateStr} -> ${payloads.length} payloads`);
        return payloads;
      }
    } catch (e) {
      console.warn('⚠️ retryWithDate error', e);
    }
    // Fallback: intentar construir URL con date param y re-fetch genérico
    console.warn(`⚠️ retryWithDate sin resultados para ${dateStr}`);
    return [];
  }

  /**
   * Scrape con retry exponencial específico para Stake (Paso 3)
   * Forza CO, fecha dinámica, networkidle, scroll y backoff 1s→2s→4s
   */
  public async scrapeStakeWithRetry(url: string, selectors?: Record<string, string>): Promise<any> {
    const maxRetries = 3;
    let retryCount = 0;
    let delay = 1000;
    let lastError: any = null;
    const stealthLevel = 'paranoid' as const;

    while (retryCount < maxRetries) {
      let context: BrowserContext | null = null;
      let page: Page | null = null;
      let interceptor: OddsNetworkInterceptor | null = null;
      try {
        // 1. Forzar fingerprint CO
        const fingerprint = FingerprintGenerator.generate(stealthLevel, 'CO');
        (fingerprint as any).timezoneId = 'America/Bogota';
        (fingerprint as any).locale = 'es-CO,es;q=0.9,en;q=0.8';
        console.log(`🇨🇴 [Retry ${retryCount + 1}] Fingerprint CO: ${fingerprint.timezoneId}/${fingerprint.locale}`);

        // 2. Fecha dinámica
        const dateStr = new Date().toISOString().split('T')[0];
        const urlWithDate = url.includes('?') ? `${url}&date=${dateStr}` : `${url}${url.includes('stake.com.co') ? `?date=${dateStr}` : ''}`;
        console.log(`📅 [Retry ${retryCount + 1}] URL con fecha: ${urlWithDate}`);

        // 3. Crear contexto
        const browser = await this.browserPool.acquireBrowser();
        context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel);
        page = await context.newPage();
        await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

        // 4. Interceptar
        interceptor = new OddsNetworkInterceptor(stakeKickerAdapter.urlPatterns);
        interceptor.attach(page);
        page.on('websocket', (ws: any) => {
          ws.on('framereceived', (payload: any) => {
            try {
              const data = typeof payload.payload === 'string' ? payload.payload : JSON.stringify(payload.payload);
              if (data.includes('sports-payout') || data.includes('eventName')) {
                // capturado via wsPayloads si se requiere
              }
            } catch {}
          });
        });

        // 5. Navegar
        await page.goto(urlWithDate, { waitUntil: 'networkidle', timeout: 30000 });

        // 6. Esperar y scroll
        await page.waitForTimeout(3000);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);

        // 7. Payloads
        const payloads = interceptor.getCaptured();
        console.log(`📡 [Retry ${retryCount + 1}] Captured ${payloads.length} payloads`);

        // 8. Verificar
        if (payloads.length > 0) {
          const odds = stakeKickerAdapter.extract(payloads);
          if (odds.length > 0 && !payloads.some((p: any) => p.status === 406)) {
            console.log(`✅ [Retry ${retryCount + 1}] Éxito: ${odds.length} odds`);
            if (page) await page.close().catch(() => {});
            if (context) await context.close().catch(() => {});
            await this.browserPool.releaseBrowser(browser, false);
            return { source: 'network', payloads, odds, retryCount, dateStr };
          }
        }
        console.warn(`⚠️ Intento ${retryCount + 1} falló (0 odds o 406), reintentando...`);
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        await this.browserPool.releaseBrowser(browser, false);
      } catch (error: any) {
        lastError = error;
        console.warn(`⚠️ Intento ${retryCount + 1} falló: ${error.message}`);
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
      }
      // 10. Backoff exponencial
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
      retryCount++;
    }
    // 11. Fallback a DOM
    console.warn('⚠️ Todos los intentos fallaron, usando DOM fallback');
    if (selectors) {
      return await this.scrapeWithCustomSelectors({ url, selectors });
    }
    throw lastError || new Error('Stake retry agotado');
  }

  private convertBookmakerOddsToMatches(odds: BookmakerOdd[]): any[] {
    // Agrupar por eventName para construir matches con 1X2 + mercados adicionales
    interface GroupedMatch {
      homeTeam: string;
      awayTeam: string;
      eventName: string;
      sport?: string;
      oddsHome?: number;
      oddsDraw?: number;
      oddsAway?: number;
      bothScoreYes?: number;
      bothScoreNo?: number;
      overOdds?: number;
      underOdds?: number;
    }
    const grouped = new Map<string, GroupedMatch>();
    for (const o of odds) {
      const eventName = o.eventName || 'Unknown';
      if (!grouped.has(eventName)) {
        const parts = eventName.split(' vs ');
        grouped.set(eventName, {
          eventName,
          homeTeam: parts[0]?.trim() || 'Home',
          awayTeam: parts[1]?.trim() || 'Away',
          sport: o.sport || 'football',
        });
      }
      const g = grouped.get(eventName)!;
      if (!g.sport && o.sport) g.sport = o.sport;
      const sel = (o.selection || '').toLowerCase();

      // Mercados no-1X2: distinguir explícitamente por marketType para no contaminar
      // las columnas 1X2 con odds de otros mercados (BTTS, Over/Under, etc.)
      if (o.marketType === 'BOTH_TEAMS_SCORE') {
        if (sel === 'si' || sel === 'sí' || sel === 'yes') g.bothScoreYes = o.odd;
        else if (sel === 'no') g.bothScoreNo = o.odd;
        continue;
      }
      if (o.marketType === 'OVER_UNDER_2_5') {
        if (sel === 'over' || sel === 'más de' || sel === 'mas de') g.overOdds = o.odd;
        else if (sel === 'under' || sel === 'menos de') g.underOdds = o.odd;
        continue;
      }

      // Mercado 1X2 (o desconocido, por compatibilidad con adapters previos)
      const isDraw = sel.includes('empate') || sel === 'x' || sel === 'draw';
      const isHome = !isDraw && (sel === g.homeTeam.toLowerCase() || sel === '1' || sel === 'home');
      const isAway = !isDraw && (sel === g.awayTeam.toLowerCase() || sel === '2' || sel === 'away');
      // Fallback: si no es draw, asignar por orden de aparición
      if (isDraw) g.oddsDraw = o.odd;
      else if (isHome) g.oddsHome = o.odd;
      else if (isAway) g.oddsAway = o.odd;
      else {
        // Heurística: si es 2-way (sin empate), asignar a home y luego directamente a away
        const is2Way = o.marketType === 'MONEYLINE_2WAY' || g.sport === 'tennis' || g.sport === 'basketball' || g.sport === 'table_tennis';
        if (g.oddsHome === undefined) g.oddsHome = o.odd;
        else if (is2Way) g.oddsAway = o.odd;
        else if (g.oddsDraw === undefined) g.oddsDraw = o.odd;
        else if (g.oddsAway === undefined) g.oddsAway = o.odd;
      }
    }
    // Convertir a array de matches con formato esperado por frontend
    return Array.from(grouped.values()).map((g) => ({
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      sport: g.sport || 'football',
      oddsHome: g.oddsHome ?? null,
      oddsDraw: g.oddsDraw ?? null,
      oddsAway: g.oddsAway ?? null,
      bothScoreYes: g.bothScoreYes ?? null,
      bothScoreNo: g.bothScoreNo ?? null,
      overOdds: g.overOdds ?? null,
      underOdds: g.underOdds ?? null,
      eventName: g.eventName,
      // Mantener compatibilidad con ResilientSelector
      matchTime: undefined,
      leagueName: undefined,
    }));
  }

  private async extractWithCustomSelectors(page: Page, selectors: Record<string, string>): Promise<any[]> {
    const results: any[] = [];
    // Si selectors vacíos (forzar interceptor), no intentar DOM
    if (!selectors.events || selectors.events.trim() === '') {
      console.log('⚠️ Selectors vacíos — DOM fallback omitido (se espera network)');
      return [];
    }
    try {
      const eventElements = await page.$$(selectors.events);
      if (eventElements.length === 0) return [];

      for (const event of eventElements) {
        try {
          const getText = async (sel: string): Promise<string> => {
            try {
              const el = await event.$(sel);
              if (el) {
                const t = await el.textContent();
                return t?.trim() || '';
              }
              return '';
            } catch {
              return '';
            }
          };
          const getNumber = async (sel: string): Promise<number | null> => {
            const text = await getText(sel);
            if (!text) return null;
            const cleaned = text.replace(',', '.').replace(/[^\d.\-]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
          };

          const match: any = {};
          match.homeTeam = await getText(selectors.homeTeam);
          match.awayTeam = await getText(selectors.awayTeam);
          match.oddsHome = await getNumber(selectors.oddsHome);
          match.oddsDraw = await getNumber(selectors.oddsDraw);
          match.oddsAway = await getNumber(selectors.oddsAway);

          if (selectors.matchTime) match.matchTime = await getText(selectors.matchTime);
          if (selectors.leagueName) match.leagueName = await getText(selectors.leagueName);
          if (selectors.matchStatus) match.matchStatus = await getText(selectors.matchStatus);
          if (selectors.homeScore) match.homeScore = await getNumber(selectors.homeScore);
          if (selectors.awayScore) match.awayScore = await getNumber(selectors.awayScore);
          if (selectors.overOdds) match.overOdds = await getNumber(selectors.overOdds);
          if (selectors.underOdds) match.underOdds = await getNumber(selectors.underOdds);
          if (selectors.handicapHome) match.handicapHome = await getNumber(selectors.handicapHome);
          if (selectors.handicapAway) match.handicapAway = await getNumber(selectors.handicapAway);
          if (selectors.bothScoreYes) match.bothScoreYes = await getNumber(selectors.bothScoreYes);
          if (selectors.bothScoreNo) match.bothScoreNo = await getNumber(selectors.bothScoreNo);

          // Capturar cualquier selector extra dinámico
          for (const [key, sel] of Object.entries(selectors)) {
            if (['events', 'homeTeam', 'awayTeam', 'oddsHome', 'oddsDraw', 'oddsAway', 'matchTime', 'leagueName', 'matchStatus', 'homeScore', 'awayScore', 'overOdds', 'underOdds', 'handicapHome', 'handicapAway', 'bothScoreYes', 'bothScoreNo'].includes(key)) continue;
            if (sel) match[key] = await getText(sel);
          }

          if (match.homeTeam || match.awayTeam) results.push(match);
        } catch {
          // continuar con siguiente evento
        }
      }
    } catch (e) {
      console.error('Error extractWithCustomSelectors', e);
    }
    return results;
  }

  /**
   * Compatibility wrapper for single-URL calls
   */
  public async executeScrape(request: ScrapeRequestDto): Promise<ScrapeResultDto> {
    return await this.executeSingleScrape(request);
  }
}
