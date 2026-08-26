import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apiRouter from './routes/index.js';
import scraperRoutes from './routes/scraper.routes.js';
import surebetRoutes from './routes/surebet.routes.js';
import { requestLogger } from './middlewares/logging.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { env } from '../infrastructure/config/environment.js';

export function createServer(): Express {
  const app = express();

  // Basic security and parsing middlewares
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: [env.frontendOrigin, 'http://localhost:3000'],
      credentials: true,
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // Mount API endpoints: supports /api/scrape, /api/surebets as well as versioned /api/v1/...
  app.use('/api', scraperRoutes);
  app.use('/api/surebets', surebetRoutes);
  app.use('/api/v1', apiRouter);

  // Central error handling
  app.use(errorHandler);

  return app;
}
