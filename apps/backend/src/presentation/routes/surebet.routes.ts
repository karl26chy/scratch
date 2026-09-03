import { Router } from 'express';
import { SurebetController } from '../controllers/surebet.controller.js';

const router = Router();
const controller = new SurebetController();

router.post('/analyze', controller.analyzeSurebets);
router.get('/live-opportunities', controller.getLiveOpportunities);
// Tarea 2: nuevos endpoints para persistencia
router.get('/calculate', controller.calculate);
router.get('/history', controller.history);
router.post('/refresh', controller.refresh);

export default router;
