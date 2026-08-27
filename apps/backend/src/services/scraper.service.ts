import { ScrapeRequestDto, ScrapeResultDto, BatchScrapeResultDto } from '../domain/types/scraper.types.js';
import { BrowserPool } from '../infrastructure/browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../infrastructure/browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';
import { ProxyRotator } from '../infrastructure/proxies/proxy-rotator.js';
import { ResilientSelectorEngine } from '../infrastructure/selectors/resilient-selector.engine.js';
import { EvasionService } from './evasion.service.js';
import { SingleTestService } from './single-test.service.js';
import { env } from '../infrastructure/config/environment.js';
import { BrowserContext, Page } from 'playwright';

export class ScraperService {
  private browserPool = BrowserPool.getInstance();
  private proxyRotator = ProxyRotator.getInstance();

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
      return this.executeSingleScrape({
        ...request,
        url: targetUrl,
        sessionId: perTaskSessionId,
      }).catch((err) => {
        // Safe catch per worker so one failed URL does not abort the entire batch
        const failedResult: ScrapeResultDto = {
          id: `scr_err_${Date.now()}_${index}`,
          url: targetUrl,
          status: 'ERROR',
          statusCode: 500,
          pageTitle: 'Error de Conexión',
          htmlLength: 0,
          extractedData: { error: err.message || 'Error de conexión o timeout en el hilo de scraping' },
          stealthMetrics: {
            stealthLevelApplied: 'paranoid',
            fingerprintUsed: {},
            bypassedAntiBot: false,
            durationMs: 0,
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
    const targetUrl = request.url!;
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

    // Rotación de User-Agent/fingerprint por petición, alineada con país del proxy para coherencia IP
    const fingerprint = proxy?.country
      ? FingerprintGenerator.generate(stealthLevel, proxy.country)
      : FingerprintGenerator.generate(stealthLevel);

    if (useProxy && !proxy) {
      console.warn(`[ScraperService] PROXY_ENABLED=true pero no hay proxies disponibles -> usando IP directa para ${targetUrl}. Configura PROXY_LIST_URL.`);
    }

    // Acquire shared browser instance (proxy is isolated per context, not per browser)
    const browser = await this.browserPool.acquireBrowser();
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // 1. Create completely isolated ephemeral context per thread/task with its own proxy
      context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel, proxyConfig);
      page = await context.newPage();

      // 2. Inject anti-fingerprinting stealth evasion scripts before DOM scripts execute
      await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

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
          console.warn(`[ScraperService] Proxy ${proxyServer} failed (${msg.substring(0, 120)}). Marcando fallo y reintentando sin proxy.`);
          if (proxy) this.proxyRotator.markProxyFailure(proxy.id, `Proxy error: ${msg.substring(0, 80)}`, latency);
          if (context) await context.close().catch(() => {});
          context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel);
          page = await context.newPage();
          await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);
          return await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: request.timeoutMs || env.browserTimeoutMs,
          });
        }
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

      // Automatically extract structured bookmaker odds and sports market items
      const oddsExtraction = await ResilientSelectorEngine.extractSportsOdds(page);
      const bookmakerOdds = await ResilientSelectorEngine.extractBookmakerOdds(page);

      // Ingest live real scraped odds into the Surebet arbitrage engine
      if (bookmakerOdds && bookmakerOdds.length > 0) {
        const { SurebetCalculatorService } = await import('./surebet-calculator.service.js');
        SurebetCalculatorService.getInstance().addScrapedOdds(bookmakerOdds);
      }

      extractedData.sportsOdds = oddsExtraction.data;
      extractedData.bookmakerOdds = bookmakerOdds;
      extractedData.oddsCount = oddsExtraction.itemsCount;
      extractedData.strategyApplied = oddsExtraction.strategyApplied || 'Automated Resilient Selector Engine';

      let domStructureAlert: { hasChanged: boolean; message?: string } | undefined;
      if (oddsExtraction.domStructureChanged && !isBlocked) {
        domStructureAlert = {
          hasChanged: true,
          message: oddsExtraction.alertMessage || 'Los selectores estables no encontraron cuotas decimales en el DOM renderizado.',
        };
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
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      await this.browserPool.releaseBrowser(browser, false);
    }
  }

  /**
   * Compatibility wrapper for single-URL calls
   */
  public async executeScrape(request: ScrapeRequestDto): Promise<ScrapeResultDto> {
    return await this.executeSingleScrape(request);
  }
}
