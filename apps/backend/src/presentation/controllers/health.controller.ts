import { Request, Response } from 'express';
import { BrowserPool } from '../../infrastructure/browser/browser-pool.js';
import { env } from '../../infrastructure/config/environment.js';
import { HealthCheckResponse } from '../../domain/types/scraper.types.js';

export class HealthController {
  private browserPool = BrowserPool.getInstance();

  public getHealth = (_req: Request, res: Response): void => {
    const stats = this.browserPool.getStats();

    const response: HealthCheckResponse = {
      status: 'healthy',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      environment: env.nodeEnv,
      browserPool: {
        activeInstances: stats.activeBorrowCount,
        maxCapacity: stats.maxCapacity,
        isHealthy: true,
      },
    };

    res.status(200).json(response);
  };
}
