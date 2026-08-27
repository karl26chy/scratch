import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ScraperService } from '../../services/scraper.service.js';
import { ProxyRotator } from '../../infrastructure/proxies/proxy-rotator.js';

const ScrapeSchema = z.object({
  url: z.string().url('Se requiere una URL válida').optional(),
  urls: z.array(z.string().url('Cada elemento debe ser una URL válida')).optional(),
  waitForSelector: z.string().optional(),
  timeoutMs: z.number().positive().max(120000).optional(),
  sessionId: z.string().optional(),
  useProxy: z.boolean().default(true),
  captureScreenshot: z.boolean().default(true),
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

  /**
   * Primary scraping endpoint supporting single or mass concurrent execution:
   * POST /api/scrape, POST /api/scrape/batch, or POST /api/v1/scrapers/run
   */
  public runScrape = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validatedBody = ScrapeSchema.parse(req.body);

      // Normalize URLs array
      let targets: string[] = [];
      if (validatedBody.urls && validatedBody.urls.length > 0) {
        targets = validatedBody.urls;
      } else if (validatedBody.url) {
        targets = [validatedBody.url];
      } else {
        res.status(400).json({
          success: false,
          error: 'Debe ingresar al menos una URL en el campo "url" o una lista en "urls".',
        });
        return;
      }

      // Execute concurrent scraping pipeline across all target bookmakers
      const batchResult = await this.scraperService.executeBatchScrape({
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
   * Scraping con selectores personalizados (frontend)
   */
  public scrapeWithCustomSelectors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CustomScrapeSchema.parse(req.body);
      const { url, selectors, useProxy, timeoutMs, sessionId } = parsed;

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
