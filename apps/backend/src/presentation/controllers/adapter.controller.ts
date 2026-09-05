import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SiteAdapterRegistry } from '../../infrastructure/network/adapter-registry.js';
import { captureNetworkPayloads } from '../../infrastructure/network/network-capture.service.js';

const CaptureSchema = z.object({
  url: z.string().url('Se requiere una URL válida'),
});

export class AdapterController {
  private registry = SiteAdapterRegistry.getInstance();

  // Tarea 4: Métodos específicos para /adapters y /adapters/check
  // Arrow functions: preservan `this` al pasarse como referencia directa a Express router.
  public checkAdapter = async (req: Request, res: Response): Promise<void> => {
    try {
      const domain = (req.query.domain as string) || (req.query as any).domain;
      if (!domain) {
        res.status(400).json({ status: 'error', message: 'Domain parameter required' });
        return;
      }
      const adapter = this.registry.getForDomain(domain as string) || this.registry.getForUrl(`https://${domain}`);
      res.json({
        domain,
        hasAdapter: !!adapter,
        adapterName: adapter ? (adapter as any).constructor?.name || adapter.domain : null,
        hasAdapterBool: !!adapter,
      });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  };

  public listAdapters = async (req: Request, res: Response): Promise<void> => {
    try {
      // Compatibilidad: si viene ?domain=, hacer check
      const domain = (req.query.domain as string) || (req.query as any).domain;
      if (domain) {
        const adapter = this.registry.getForDomain(domain as string) || this.registry.getForUrl(`https://${domain}`);
        res.json({
          domain,
          hasAdapter: !!adapter,
          adapterName: adapter ? (adapter as any).constructor?.name || adapter.domain : null,
          hasAdapterBool: !!adapter,
          adapter: adapter ? { domain: adapter.domain, patternCount: adapter.urlPatterns.length } : null,
        });
        return;
      }
      const domains = this.registry.getAllDomains();
      res.json({ domains, count: domains.length, adapters: domains.map((d) => ({ domain: d })) });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  };

  // Compatibilidad: GET /api/adapters?domain=x  (antiguo)
  public listOrCheckAdapters = (req: Request, res: Response): void => {
    const rawDomain = (req.query.domain as string | undefined)?.trim();
    if (rawDomain) {
      const candidate = rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`;
      const adapter = this.registry.getForUrl(candidate);
      if (adapter) {
        res.status(200).json({
          domain: adapter.domain,
          hasAdapter: true,
          adapter: { domain: adapter.domain, patternCount: adapter.urlPatterns.length },
        });
      } else {
        res.status(200).json({ domain: rawDomain, hasAdapter: false, adapter: null });
      }
      return;
    }

    const adapters = this.registry.list().map((a) => ({
      domain: a.domain,
      patternCount: a.urlPatterns.length,
    }));

    res.status(200).json({ success: true, count: adapters.length, adapters });
  };

  /**
   * POST /api/debug/capture { url } -> captura payloads JSON de red y los
   * devuelve en la respuesta (no escribe a disco).
   */
  public captureNetwork = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { url } = CaptureSchema.parse(req.body);
      const captured = await captureNetworkPayloads(url);
      res.status(200).json({
        success: true,
        url,
        count: captured.length,
        captured,
      });
    } catch (error) {
      next(error);
    }
  };
}
