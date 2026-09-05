import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ScraperService } from '../../services/scraper.service.js';
import { ProxyRotator } from '../../infrastructure/proxies/proxy-rotator.js';
import { SiteAdapterRegistry } from '../../infrastructure/network/adapter-registry.js';

const ScrapeSchema = z.object({
  url: z.string().url('Se requiere una URL válida').optional(),
  urls: z
    .array(
      z.union([
        z.string().url('Cada elemento debe ser una URL válida'),
        z.object({
          url: z.string().url('Se requiere URL válida'),
          bookmaker: z.string().optional(),
          useProxy: z.boolean().optional(),
          captureScreenshot: z.boolean().optional(),
          selectors: z.record(z.string()).optional(),
        }),
      ])
    )
    .optional(),
  waitForSelector: z.string().optional(),
  timeoutMs: z.number().positive().max(120000).optional(),
  sessionId: z.string().optional(),
  useProxy: z.boolean().default(true),
  captureScreenshot: z.boolean().default(true),
  bookmaker: z.string().optional(),
});

const CustomScrapeSchema = z.object({
  url: z.string().url('URL requerida'),
  selectors: z.record(z.string()),
  useProxy: z.boolean().optional().default(true),
  timeoutMs: z.number().positive().max(120000).optional().default(30000),
  sessionId: z.string().optional(),
});

export class ScraperController {
  private scraperService = new ScraperService();
  private proxyRotator = ProxyRotator.getInstance();
  private adapterRegistry = SiteAdapterRegistry.getInstance();

  /**
    * Primary scraping endpoint supporting single or mass concurrent execution:
    * POST /api/scrape, POST /api/scrape/batch, or POST /api/v1/scrapers/run
    * Tarea 3: Si urls es array de objetos, usa scrapeWithCustomSelectors para forzar interceptor (Stake)
    */
  public runScrape = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validatedBody = ScrapeSchema.parse(req.body);

      // Tarea 3: Detectar formato nuevo (array de objetos) vs antiguo (array de strings)
      const rawUrls: any[] = (validatedBody as any).urls || (validatedBody.url ? [validatedBody.url] : []);
      if (rawUrls.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Debe ingresar al menos una URL en el campo "url" o una lista en "urls".',
        });
        return;
      }

      // Consola Concurrente — SIEMPRE DOM (ResilientSelectorEngine), NUNCA adapter (incluso stake)
      const isNewFormat = typeof rawUrls[0] === 'object' && rawUrls[0] !== null && 'url' in rawUrls[0];
      if (isNewFormat) {
        // Tarea 1-3: Consola nunca usa SiteAdapterRegistry, solo DOM
        console.log('[Consola] Ejecutando pipeline DOM-ONLY (ResilientSelectorEngine) para', rawUrls.length, 'URLs');
        const results: any[] = [];
        // Ejecutar concurrentemente con DOM-ONLY
        const domPromises = (rawUrls as Array<{ url: string; bookmaker?: string; useProxy?: boolean; captureScreenshot?: boolean }>).map(
          async (item, idx) => {
            try {
              const r = await this.scraperService.executeSingleScrapeDomOnly({
                url: item.url,
                bookmaker: item.bookmaker || validatedBody.bookmaker,
                useProxy: item.useProxy !== undefined ? item.useProxy : validatedBody.useProxy,
                captureScreenshot: item.captureScreenshot ?? validatedBody.captureScreenshot,
                timeoutMs: validatedBody.timeoutMs,
                sessionId: `run_${Date.now()}_${idx}`,
              } as any);
              return {
                id: r.id,
                url: r.url,
                bookmaker: item.bookmaker || (r as any).bookmaker || (r.extractedData as any)?.bookmaker || 'Unknown',
                status: r.status,
                source: r.source,
                statusCode: r.statusCode,
                pageTitle: r.pageTitle,
                htmlLength: r.htmlLength,
                extractedData: r.extractedData,
                stealthMetrics: r.stealthMetrics,
                domAlert: r.domAlert,
                screenshotBase64: r.screenshotBase64,
                createdAt: r.createdAt,
                // Compatibilidad viewer
                oddsCount: (r.extractedData as any)?.oddsCount,
                matches: (r.extractedData as any)?.bookmakerOdds || [],
                totalMatches: (r.extractedData as any)?.oddsCount || 0,
                durationMs: r.stealthMetrics.durationMs,
                proxyUsed: r.stealthMetrics.proxyUsed,
                htmlSize: r.htmlLength,
              };
            } catch (err: any) {
              return {
                id: `err_${Date.now()}_${idx}`,
                url: item.url,
                bookmaker: item.bookmaker || 'Unknown',
                status: 'ERROR' as const,
                source: 'dom' as const,
                statusCode: 500,
                pageTitle: 'Error',
                htmlLength: 0,
                extractedData: { error: err.message, oddsCount: 0 },
                stealthMetrics: { stealthLevelApplied: 'paranoid' as const, fingerprintUsed: {}, bypassedAntiBot: false, durationMs: 0 },
                createdAt: new Date().toISOString(),
                oddsCount: 0,
                matches: [],
                totalMatches: 0,
                durationMs: 0,
                proxyUsed: 'N/A',
                htmlSize: 0,
              };
            }
          }
        );
        const domResults = await Promise.all(domPromises);
        results.push(...domResults);
        const successfulCount = results.filter((r) => r.status === 'SUCCESS').length;
        res.status(200).json({
          success: true,
          status: 'success',
          results,
          data: results,
          totalProcessed: results.length,
          successfulCount,
          batch: { results, successfulCount, totalRequested: results.length },
        });
        return;
      }

      // Formato antiguo: array de strings -> batch DOM-ONLY (sin adapters)
      let targets: string[] = [];
      if (validatedBody.urls && validatedBody.urls.length > 0) {
        // Filtrar solo strings
        targets = (validatedBody.urls as any[]).filter((u) => typeof u === 'string') as string[];
        // Si no hay strings pero hay objetos, ya manejado arriba
        if (targets.length === 0 && (validatedBody as any).urls.length > 0) {
          // Fallback: extraer url de objetos
          targets = (validatedBody.urls as any[]).map((u: any) => (typeof u === 'string' ? u : u.url)).filter(Boolean);
        }
      } else if (validatedBody.url) {
        targets = [validatedBody.url];
      }

      // Consola siempre DOM-ONLY (ResilientSelectorEngine, 4 estrategias)
      console.log('[Consola] Ejecutando batch DOM-ONLY para', targets.length, 'URLs');
      const batchResult = await this.scraperService.executeBatchDomScrape({
        ...validatedBody,
        urls: targets,
      });

      // If single URL was requested, also expose data property for retrocompatibility
      const isSingle = targets.length === 1;
      const primaryResult = batchResult.results[0];

      res.status(200).json({
        success: true,
        batch: batchResult,
        data: isSingle ? primaryResult : batchResult.results,
        totalProcessed: batchResult.totalRequested,
        successfulCount: batchResult.successfulCount,
        durationMs: batchResult.durationMs,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * Retrieve active proxy pool metrics con performance
   */
  public getProxies = (_req: Request, res: Response): void => {
    const proxies = this.proxyRotator.getAllProxies();
    const performance = this.proxyRotator.getPerformanceMetrics();
    res.status(200).json({
      success: true,
      data: proxies,
      performance,
    });
  };

  /**
   * Rotate proxy for a given session
   */
  public rotateProxy = (req: Request, res: Response): void => {
    const sessionId = (req.body?.sessionId || req.query?.sessionId) as string;
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId es requerido' });
      return;
    }

    const newProxy = this.proxyRotator.rotateSessionProxy(sessionId);
    res.status(200).json({
      success: true,
      message: `Proxy rotado con éxito para la sesión ${sessionId}`,
      data: newProxy,
    });
  };

  /**
   * Health del pool de proxies (para verificación y diagnóstico) con métricas
   */
  public getProxyHealth = (_req: Request, res: Response): void => {
    const report = this.proxyRotator.getHealthReport();
    const all = this.proxyRotator.getAllProxies();
    const performance = this.proxyRotator.getPerformanceMetrics();
    res.status(200).json({
      success: true,
      health: report,
      performance,
      proxies: all.map((p) => ({
        id: p.id,
        server: p.server,
        protocol: p.protocol,
        country: p.country,
        failsCount: p.failsCount,
        lastUsedAt: p.lastUsedAt,
        hasAuth: !!(p.username && p.password),
        health: p.health,
      })),
      diagnosis:
        !report.enabled
          ? 'PROXY_ENABLED=false -> IP directa. Para evitar bloqueo de Pinnacle activa proxies residenciales.'
          : report.total === 0
            ? 'PROXY_ENABLED=true pero pool vacío -> configura PROXY_LIST_URL con proxies reales (ej: Webshare). '
            : report.available === 0
              ? 'Todos los proxies en cooldown -> posible bloqueo masivo o fallo de red.'
              : `Pool operativo: ${report.available}/${report.total} disponibles vía ${report.provider}`,
    });
  };

  /**
    * Endpoint normal redirigido a custom para forzar interceptor (Tarea 2)
    * POST /api/scrape — usa misma lógica que /scrape/custom para Stake
    */
  public scrape = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { url, selectors, useProxy = true, timeoutMs = 30000 } = req.body;
      if (!url) {
        res.status(400).json({ status: 'error', message: 'URL requerida' });
        return;
      }
      // ✅ Usar misma lógica que scrapeWithCustomSelectors — forzar vacíos para sitios con adapter de red
      const isStake = url.includes('stake.com.co');
      const hasRegisteredAdapter = !!this.adapterRegistry.getForUrl(url);
      const effectiveSelectors = isStake || hasRegisteredAdapter
        ? { events: '', homeTeam: '', awayTeam: '', oddsHome: '', oddsDraw: '', oddsAway: '' }
        : selectors && selectors.events && selectors.homeTeam
          ? selectors
          : {
              events: 'div',
              homeTeam: 'div',
              awayTeam: 'div',
              oddsHome: 'div',
              oddsDraw: 'div',
              oddsAway: 'div',
            };
      const result = await this.scraperService.scrapeWithCustomSelectors({
        url,
        selectors: effectiveSelectors,
        useProxy,
        timeoutMs,
        sessionId: (req as any).session?.id || `scr_${Date.now()}`,
      });
      res.status(200).json({
        status: 'success',
        ...result,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ status: 'error', message: 'Validación fallida', errors: error.errors });
        return;
      }
      next(error);
    }
  };

  /**
    * Scraping con selectores personalizados (frontend)
    */
  public scrapeWithCustomSelectors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CustomScrapeSchema.parse(req.body);
      let { url, selectors, useProxy, timeoutMs, sessionId } = parsed;

      // Permitir selectores vacíos (forzar interceptor de red) para Stake o cualquier
      // dominio con adapter de red registrado (p.ej. BetPlay/Kambi)
      const isStake = url.includes('stake.com.co');
      const hasRegisteredAdapter = !!this.adapterRegistry.getForUrl(url);
      if (isStake || hasRegisteredAdapter) {
        // Normalizar a vacíos si no vienen
        selectors = {
          events: selectors.events || '',
          homeTeam: selectors.homeTeam || '',
          awayTeam: selectors.awayTeam || '',
          oddsHome: selectors.oddsHome || '',
          oddsDraw: selectors.oddsDraw || '',
          oddsAway: selectors.oddsAway || '',
        };
      } else {
        const required = ['events', 'homeTeam', 'awayTeam', 'oddsHome', 'oddsDraw', 'oddsAway'];
        const missing = required.filter((k) => !selectors[k]);
        if (missing.length > 0) {
          res.status(400).json({
            status: 'error',
            message: `Faltan selectores obligatorios: ${missing.join(', ')}`,
            required,
          });
          return;
        }
      }

      const result = await this.scraperService.scrapeWithCustomSelectors({
        url,
        selectors,
        useProxy,
        timeoutMs,
        sessionId: sessionId || `custom_${Date.now()}`,
      });

      if (!result.success) {
        res.status(result.captchaType ? 423 : 500).json({
          status: result.captchaType ? 'captcha' : 'error',
          ...result,
        });
        return;
      }

      // Asegurar que la respuesta incluye los odds (network o dom) para el frontend
      res.status(200).json({
        status: 'success',
        source: result.source || 'dom',
        oddsCount: result.oddsCount ?? result.totalMatches ?? 0,
        matches: result.matches || [],
        totalMatches: result.totalMatches,
        durationMs: result.durationMs || 0,
        htmlSize: result.htmlSize || 0,
        bookmaker: result.bookmaker || new URL(url).hostname,
        proxyUsed: result.proxyUsed,
        selectorsUsed: result.selectorsUsed,
        timestamp: result.timestamp,
        url: result.url,
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ status: 'error', message: 'Validación fallida', errors: error.errors });
        return;
      }
      next(error);
    }
  };

  /**
   * Testea conectividad de un proxy específico o del pool
   */
  public testProxy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { proxyId, server } = req.body || {};
      let target: ReturnType<typeof this.proxyRotator.getProxy> | undefined;

      if (proxyId) {
        target = this.proxyRotator.getAllProxies().find((p) => p.id === proxyId);
      } else if (server) {
        target = this.proxyRotator.getAllProxies().find((p) => p.server === server);
      } else {
        target = this.proxyRotator.getProxy('health-check');
      }

      if (!target) {
        res.status(404).json({ success: false, error: 'No hay proxy disponible para testear. Verifica PROXY_ENABLED y PROXY_LIST_URL.' });
        return;
      }

      const result = await this.proxyRotator.testProxyConnectivity(target);
      res.status(200).json({
        success: result.success,
        proxy: { id: target.id, server: target.server, protocol: target.protocol, hasAuth: !!(target.username && target.password) },
        result,
        testUrl: this.proxyRotator.getHealthReport().testUrl,
      });
    } catch (error) {
      next(error);
    }
  };
}
