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
   * Retrieve active proxy pool metrics
   */
  public getProxies = (_req: Request, res: Response): void => {
    const proxies = this.proxyRotator.getAllProxies();
    res.status(200).json({
      success: true,
      data: proxies,
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
}
