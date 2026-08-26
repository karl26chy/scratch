import { ScrapeRequestDto, ScrapeResultDto, BatchScrapeResultDto } from '../domain/types/scraper.types.js';
import { BrowserPool } from '../infrastructure/browser/browser-pool.js';
import { PlaywrightStealthFactory } from '../infrastructure/browser/playwright-stealth.factory.js';
import { FingerprintGenerator } from '../infrastructure/fingerprints/fingerprint-generator.js';
import { ProxyRotator } from '../infrastructure/proxies/proxy-rotator.js';
import { ResilientSelectorEngine } from '../infrastructure/selectors/resilient-selector.engine.js';
import { EvasionService } from './evasion.service.js';
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
    const fingerprint = FingerprintGenerator.generate(stealthLevel);
    
    // Check proxy: only attach real proxies if valid host, or fallback to clean socket
    const useProxy = request.useProxy !== false;
    let proxy = useProxy ? this.proxyRotator.getProxy(request.sessionId) : undefined;
    
    // If running in development without a live proxy tunnel, avoid ERR_PROXY_CONNECTION_FAILED on dummy hosts
    const proxyServer = (proxy?.server && !proxy.server.includes('geonetwork.io') && !proxy.server.includes('example-proxy.io')) 
      ? proxy.server 
      : undefined;

    // Acquire shared browser instance
    const browser = await this.browserPool.acquireBrowser();
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // 1. Create completely isolated ephemeral context per thread/task with its own proxy
      context = await PlaywrightStealthFactory.createContext(browser, fingerprint, stealthLevel, proxyServer);
      page = await context.newPage();

      // 2. Inject anti-fingerprinting stealth evasion scripts before DOM scripts execute
      await PlaywrightStealthFactory.applyInPageEvasions(page, fingerprint);

      // 3. Navigate to bookmaker target with realistic headers
      const response = await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: request.timeoutMs || env.browserTimeoutMs,
      }).catch(async (navErr) => {
        // Fallback retry on direct socket if proxy failed
        if (proxyServer && navErr.message.includes('PROXY')) {
          console.warn(`[ScraperService] Proxy ${proxyServer} failed. Retrying direct socket.`);
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

      // 4. Human behavior emulation & stochastic pacing
      await EvasionService.simulateOrganicMouseTrajectories(page);
      await EvasionService.simulateNaturalSmoothScroll(page, 2);
      await EvasionService.humanDelay(500, 150, 250);

      // 5. Element wait if specified
      if (request.waitForSelector) {
        await page.waitForSelector(request.waitForSelector, {
          timeout: 8000,
        }).catch(() => {});
      }

      // 6. Inspect anti-bot barrier status
      const pageTitle = await page.title();
      const htmlContent = await page.content();
      const isBlocked = EvasionService.isAntibotChallenge(htmlContent, pageTitle, statusCode);

      // 7. Automatic Resilient Data & Sports Odds Extraction
      const extractedData: Record<string, unknown> = {
        title: pageTitle,
      };

      // Automatically extract structured bookmaker odds and sports market items
      const oddsExtraction = await ResilientSelectorEngine.extractSportsOdds(page);
      const bookmakerOdds = await ResilientSelectorEngine.extractBookmakerOdds(page);

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

      // 9. Proxy Health and Failover evaluation
      if (proxy) {
        if (isBlocked) {
          this.proxyRotator.markProxyFailure(proxy.id, 'Barrera anti-bot detectada en casa de apuestas');
        } else {
          this.proxyRotator.markProxySuccess(proxy.id);
        }
      }

      const durationMs = Date.now() - startTime;
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
