import { Router } from 'express';
import { ScraperController } from '../controllers/scraper.controller.js';

const router = Router();
const controller = new ScraperController();

router.post('/run', controller.runScrape);
router.post('/scrape', controller.runScrape);
router.post('/batch', controller.runScrape);
router.get('/proxies', controller.getProxies);
router.post('/proxies/rotate', controller.rotateProxy);

export default router;
