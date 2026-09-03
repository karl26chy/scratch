import { Router } from 'express';
import { AdapterController } from '../controllers/adapter.controller.js';

const router = Router();
const controller = new AdapterController();

// Tarea 5: Endpoints específicos (nuevos)
router.get('/adapters/check', controller.checkAdapter);
router.get('/adapters', controller.listAdapters);
// Compatibilidad con ?domain=
router.get('/adapters/list', controller.listAdapters);
router.post('/debug/capture', controller.captureNetwork);
// Mantener compatibilidad antigua /adapters?domain=x via listOrCheck
router.get('/adapters-legacy', controller.listOrCheckAdapters);

export default router;
