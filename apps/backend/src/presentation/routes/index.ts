import { Router } from 'express';
import healthRoutes from './health.routes.js';
import scraperRoutes from './scraper.routes.js';
import surebetRoutes from './surebet.routes.js';

const apiRouter = Router();

apiRouter.use('/health', healthRoutes);
apiRouter.use('/scrapers', scraperRoutes);
apiRouter.use('/surebets', surebetRoutes);

export default apiRouter;
