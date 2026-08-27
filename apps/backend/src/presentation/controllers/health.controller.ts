import { Request, Response } from 'express';
import { BrowserPool } from '../../infrastructure/browser/browser-pool.js';
import { ProxyRotator } from '../../infrastructure/proxies/proxy-rotator.js';
import { env } from '../../infrastructure/config/environment.js';
import { HealthCheckResponse } from '../../domain/types/scraper.types.js';

export class HealthController {
  private browserPool = BrowserPool.getInstance();

  public getHealth = (_req: Request, res: Response): void => {
    const stats = this.browserPool.getStats();
    const proxyReport = ProxyRotator.getInstance().getHealthReport();

    const response: HealthCheckResponse & { proxy: ReturnType<ProxyRotator['getHealthReport']> } = {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      environment: env.nodeEnv,
      browserPool: {
        activeInstances: stats.activeBorrowCount,
        maxCapacity: stats.maxCapacity,
        isHealthy: true,
      },
      proxy: proxyReport,
    } as any;

    res.status(200).json(response);
  };
}
