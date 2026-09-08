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

  // Tarea 3: Método específico para Network Interceptor (extraído)
  private async scrapeWithNetworkInterceptor(params: {
    url: string;
    useProxy?: boolean;
    timeoutMs?: number;
    sessionId?: string;
    adapter?: SiteOddsAdapter | null;
  }): Promise<any> {
    const { url, useProxy, timeoutMs, sessionId, adapter } = params;
    const startTime = Date.now();
    console.log(`📡 [Network] Interceptando ${url} ${adapter ? `con adapter ${adapter.domain}` : 'sin adapter (fallback Stake)'}`);
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
        const domain = new URL(url).hostname.toLowerCase();
        if (domain.includes('stake.com.co')) {
          const fp = FingerprintGenerator.generate('paranoid', 'CO');
          (fp as any).timezoneId = 'America/Bogota';
          (fp as any).locale = 'es-CO,es;q=0.9,en;q=0.8';
          return fp;
        }
      } catch {}
      return FingerprintGenerator.generate('paranoid', proxy?.country);
    })();
    const browser = await this.browserPool.acquireBrowser(proxyConfig);
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let interceptor: OddsNetworkInterceptor | null = null;
    try {
      context = await PlaywrightStealthFactory.createContext(browser, fingerprint, 'paranoid', proxyConfig);
      page = await context.newPage();
      await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);
      const effectiveAdapter = adapter || this.adapterRegistry.getForUrl(url);
      if (effectiveAdapter) {
        interceptor = new OddsNetworkInterceptor(effectiveAdapter.urlPatterns);
        await interceptor.attach(page);
        console.log(`📡 Interceptor activo para ${effectiveAdapter.domain}`);
      } else {
        interceptor = new OddsNetworkInterceptor();
        await interceptor.attach(page);
      }
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs || 30000 });
      await page.waitForTimeout(3000);
      await EvasionService.simulateAdvancedHumanBehavior(page);
      let payloads = interceptor.getCaptured();
      console.log(`📦 Payloads capturados: ${payloads.length}`);

      // Stake: events-by-path.json?date=YYYY-MM-DD solo devuelve los eventos de ESE día
      // (lo que capturamos al navegar son solo los ~40 de "hoy"). Se probaron varias
      // fechas replicando el request (multi-día) pero el anti-bot devuelve 406 la mayoría
      // de las veces para requests fuera del flujo natural de la página, aun compartiendo
      // cookies/hidenseek/sesión. El hallazgo real: quitando el parámetro `date` por completo
      // el mismo endpoint devuelve TODOS los eventos de fútbol futuros en una sola respuesta
      // (~1500, igual al contador "Fútbol (1550)" del sidebar) — equivalente a lo que hace
      // Kambi/BetPlay con /all/all.json. Un solo fetch adicional desde la pestaña basta.
      const isStakeDomain = url.includes('stake.com.co') || effectiveAdapter === stakeKickerAdapter;
      if (isStakeDomain) {
        const hidenseekPayload = payloads.find((p: any) => typeof p.url === 'string' && p.url.includes('hidenseek='));
        const hidenseekMatch = hidenseekPayload ? hidenseekPayload.url.match(/hidenseek=([^&]+)/) : null;
        const hidenseek = hidenseekMatch ? decodeURIComponent(hidenseekMatch[1]) : '';
        const endpointBase = hidenseekPayload ? hidenseekPayload.url.split('?')[0] : '';
        if (hidenseek && endpointBase) {
          console.log('📅 [Stake] Expandiendo cobertura: consultando TODOS los eventos futuros (sin filtro de fecha) desde la pestaña...');
          // Se pasa como STRING (no como función serializada) porque tsx/esbuild inyecta
          // un helper `__name` al transpilar que no existe en el contexto aislado del
          // navegador, y page.evaluate(fn, args) revienta con "__name is not defined".
          // Con un string, Playwright lo evalúa tal cual, sin pasar por Function.toString().
          const evalCode = `(async () => {
            const base = ${JSON.stringify(endpointBase)};
            const hidenseek = ${JSON.stringify(hidenseek)};
            try {
              const res = await fetch(base + '?path=football&hidenseek=' + encodeURIComponent(hidenseek), { headers: { Accept: 'application/json' } });
              if (res.status === 200) return { json: await res.json(), status: 200 };
              return { json: null, status: res.status };
            } catch (e) {
              return { json: null, status: 0 };
            }
          })()`;
          const result: { json: unknown; status: number } = await page.evaluate(evalCode);
          if (result.status === 200 && result.json) {
            payloads = [...payloads, { url: `${endpointBase}?path=football (all dates)`, json: result.json, timestamp: new Date().toISOString() }];
            const allEventsCount = Array.isArray((result.json as any)?.events) ? (result.json as any).events.length : 0;
            console.log(`📦 [Stake] Cobertura completa obtenida: ${allEventsCount} eventos futuros en total`);
          } else {
            console.warn(`⚠️ [Stake] Fetch sin filtro de fecha falló (status ${result.status}) — se mantiene solo el día capturado naturalmente`);
          }
        } else {
          console.warn('⚠️ [Stake] No se capturó hidenseek en el payload inicial — se omite expansión de cobertura');
        }
      }

      let odds: BookmakerOdd[] = [];
      if (effectiveAdapter) {
        odds = effectiveAdapter.extract(payloads as any);
      } else if (url.includes('stake.com.co')) {
        const stakeAdapter = stakeKickerAdapter;
        odds = stakeAdapter.extract(payloads as any);
      }
      console.log(`📊 Odds extraídas: ${odds.length}`);

      // Alimentar el motor de Surebets + persistencia temporal (data/odds.json),
      // igual que hacen los demás caminos de scraping. Antes esta ruta (la que
      // realmente usan Selectores Custom / Scraping BetPlay / Scraping Stake vía
      // adapter de red) devolvía los odds al frontend pero nunca los mandaba a
      // Arbitraje & Surebets.
      if (odds.length > 0) {
        const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
        SurebetCalculatorService.getInstance().addScrapedOdds(odds);
        const persistBookmaker = odds[0]?.bookmaker || deriveBookmakerFromUrl(url) || 'Unknown';
        OddsPersistenceService.getInstance().saveOddsForBookmaker(persistBookmaker, odds);
      }

      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await this.browserPool.releaseBrowser(browser, !!proxyConfig);
      return {
        source: 'network' as const,
        oddsCount: odds.length,
        matches: this.convertBookmakerOddsToMatches(odds),
        payloads: payloads.length,
        durationMs: Date.now() - startTime,
        odds,
      };
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      await this.browserPool.releaseBrowser(browser, !!proxyConfig);
    }
  }

  // ==================== SELECTORES PERSONALIZADOS (FRONTEND) ====================
  public async scrapeWithCustomSelectors(request: {
    url: string;
    selectors: Record<string, string>;
    useProxy?: boolean;
    timeoutMs?: number;
    sessionId?: string;
  }): Promise<{
    success: boolean;
    url: string;
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
    const { url: rawUrl, useProxy = true, timeoutMs, sessionId } = request;
    let selectors = request.selectors;
    const startTime = Date.now();
    // Normalizar URL igual que en executeSingleScrape (idempotente)
    let url: string;
    try {
      url = encodeURI(decodeURI(rawUrl));
    } catch {
      try {
        url = encodeURI(rawUrl);
      } catch {
        url = rawUrl;
      }
    }

    // ✅ Logging diagnóstico del adapter (TAREA 2)
    console.log(`🔍 URL recibida: ${url}`);
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
    const hasRegisteredAdapter = !!this.adapterRegistry.getForUrl(url);
    if (isStakeUrl || hasRegisteredAdapter) {
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
    try {
      const domain = new URL(url).hostname;
      const isBetPlay = domain.includes('betplay.com.co');
      if (isBetPlay) {
        console.log(`⚡ [BetPlay] Usando fetchDirect() a la API Kambi (sin Playwright)`);
        const directOdds = await betplayKambiAdapter.fetchDirect();
        if (directOdds.length > 0) {
          // Persistir en motor de Surebets y en disco
          const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
          SurebetCalculatorService.getInstance().addScrapedOdds(directOdds);
          OddsPersistenceService.getInstance().saveOddsForBookmaker('BetPlay', directOdds);
          console.log(`✅ [BetPlay] fetchDirect exitoso: ${directOdds.length} odds`);
          return {
            success: true,
            url,
            matches: this.convertBookmakerOddsToMatches(directOdds),
            totalMatches: this.convertBookmakerOddsToMatches(directOdds).length,
            durationMs: Date.now() - startTime,
            selectorsUsed: [],
            proxyUsed: 'Directo (Kambi API pública)',
            timestamp: new Date().toISOString(),
            source: 'network' as const,
            oddsCount: directOdds.length,
            htmlSize: 0,
            bookmaker: 'BetPlay',
          };
        }
        console.warn('⚠️ [BetPlay] fetchDirect no obtuvo odds, intentando con Playwright...');
      }
    } catch (e: any) {
      console.warn('⚠️ [BetPlay] fetchDirect falló, intentando con Playwright:', e.message);
    }

    // Tarea 2: Si hay adapter o es Stake, usar Network Interceptor (ignorar selectors)
    try {
      const domain = new URL(url).hostname;
      const adapter = this.adapterRegistry.getForDomain(domain);
      const isStake = domain.includes('stake.com.co');
      if (adapter || isStake) {
        console.log(`📡 Usando Network Interceptor para ${domain} ${adapter ? `(${adapter.domain})` : '(Stake)'}`);
        const netResult = await this.scrapeWithNetworkInterceptor({ url, useProxy, timeoutMs, sessionId, adapter: adapter || null });
        if (netResult && netResult.oddsCount > 0) {
          console.log(`✅ Network Interceptor éxito: ${netResult.oddsCount} odds`);
          return {
            success: true,
            url,
            matches: netResult.matches,
            totalMatches: netResult.matches.length,
            durationMs: netResult.durationMs,
            selectorsUsed: Object.keys(selectors).filter((k) => selectors[k]),
            proxyUsed: (netResult as any).proxyUsed || proxyServer || 'N/A',
            timestamp: new Date().toISOString(),
            source: 'network' as const,
            oddsCount: netResult.oddsCount,
            htmlSize: 0,
            bookmaker: 'Stake',
          };
        }
        console.warn(`⚠️ Network Interceptor no extrajo odds para ${domain}, usando DOM fallback`);
      }
    } catch (e: any) {
      console.warn('⚠️ Error en Network Interceptor, fallback a DOM:', e.message);
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
        });
      }
      const g = grouped.get(eventName)!;
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
        // Heurística: si falta home, asignar a home, luego draw, luego away
        if (g.oddsHome === undefined) g.oddsHome = o.odd;
        else if (g.oddsDraw === undefined) g.oddsDraw = o.odd;
        else if (g.oddsAway === undefined) g.oddsAway = o.odd;
      }
    }
    // Convertir a array de matches con formato esperado por frontend
    return Array.from(grouped.values()).map((g) => ({
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
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
