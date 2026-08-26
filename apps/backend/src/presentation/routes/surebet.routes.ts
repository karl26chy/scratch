import { Router } from 'express';
import { SurebetController } from '../controllers/surebet.controller.js';

const router = Router();
const controller = new SurebetController();

router.post('/analyze', controller.analyzeSurebets);
router.get('/live-opportunities', controller.getLiveOpportunities);

export default router;
