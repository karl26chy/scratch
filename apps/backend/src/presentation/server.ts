import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apiRouter from './routes/index.js';
import scraperRoutes from './routes/scraper.routes.js';
import surebetRoutes from './routes/surebet.routes.js';
import adapterRoutes from './routes/adapter.routes.js';
import { requestLogger } from './middlewares/logging.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { env } from '../infrastructure/config/environment.js';

export function createServer(): Express {
  const app = express();

  // Parse FRONTEND_ORIGIN as CSV to support multiple dev ports (3000, 3001, etc.)
  // e.g. "http://localhost:3000,http://localhost:3001"
  const allowedOrigins = env.frontendOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Basic security and parsing middlewares
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser requests (curl, healthchecks) without Origin
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // In development, allow any localhost port for convenience (3000/3001/5173...)
        if (env.nodeEnv !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  // Mount API endpoints: supports /api/scrape, /api/surebets as well as versioned /api/v1/...
  app.use('/api', scraperRoutes);
  app.use('/api', adapterRoutes);
  app.use('/api/surebets', surebetRoutes);
  app.use('/api/v1', apiRouter);

  // Central error handling
  app.use(errorHandler);

  return app;
}
