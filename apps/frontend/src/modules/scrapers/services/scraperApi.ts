import { ScrapeRequest, ScrapeResult, ProxyItem } from '../../../shared/types/common.types.js';

const API_BASE = 'http://localhost:4000/api';

export class ScraperApi {
  /**
   * Execute single or mass concurrent scrape against target bookmaker URLs
   */
  public static async executeScrape(request: ScrapeRequest): Promise<ScrapeResult[]> {
    const urls = request.urls && request.urls.length > 0 ? request.urls : request.url ? [request.url] : [];

    // Consola Concurrente — SIEMPRE DOM (ResilientSelectorEngine), nunca /scrape/custom
    // Incluso stake.com.co aquí debe ir por /api/run DOM-ONLY (dará DOM_STRUCTURE_CHANGED)
    if (urls.length === 1 && urls[0].includes('stake.com.co')) {
      const res = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [{ url: urls[0], bookmaker: request.bookmaker || 'Stake', useProxy: request.useProxy, captureScreenshot: request.captureScreenshot }],
          useProxy: request.useProxy,
          timeoutMs: request.timeoutMs || 30000,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.message || `HTTP error ${res.status}`);
      }
      const json = await res.json();
      // /api/run devuelve {success, results:[ScrapeResult], data, batch}
      if (json.results) return json.results;
      if (json.data) return Array.isArray(json.data) ? json.data : [json.data];
      if (json.batch?.results) return json.batch.results;
      // Fallback custom shape (por si cambia)
      const single: ScrapeResult = {
        id: `scr_${Date.now()}`,
        url: json.url || urls[0],
        status: json.success ? 'SUCCESS' : 'ERROR',
        source: json.source,
        statusCode: 200,
        pageTitle: json.bookmaker || '',
        htmlLength: json.htmlSize || 0,
        extractedData: { oddsCount: json.oddsCount, matches: json.matches, source: json.source },
        stealthMetrics: { stealthLevelApplied: 'paranoid', fingerprintUsed: {}, proxyUsed: json.proxyUsed, bypassedAntiBot: true, durationMs: json.durationMs || 0 } as any,
        createdAt: json.timestamp || new Date().toISOString(),
      } as any;
      (single as any).matches = json.matches;
      (single as any).totalMatches = json.totalMatches;
      (single as any).oddsCount = json.oddsCount;
      return [single];
    }

    // Formato correcto para /api/run (Tarea 3): urls como array de objetos con selectors vacíos para Stake
    const isBatch = urls.length > 1;
    if (isBatch) {
      const res = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urls.map((u) => ({
            url: u,
            bookmaker: request.bookmaker,
            useProxy: request.useProxy,
            captureScreenshot: request.captureScreenshot,
            // Tarea 1: Forzar selectores vacíos para usar interceptor (Stake)
            selectors: {
              events: '',
              homeTeam: '',
              awayTeam: '',
              oddsHome: '',
              oddsDraw: '',
              oddsAway: '',
            },
          })),
          useProxy: request.useProxy,
          timeoutMs: request.timeoutMs,
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.message || `HTTP error ${res.status}`);
      }
      const json = await res.json();
      if (json.results) return json.results;
      if (json.data) return Array.isArray(json.data) ? json.data : [json.data];
      if (json.batch?.results) return json.batch.results;
      return [];
    }

    // Fallback para wplay y otros no-Stake: usar /api/run con formato objeto (maneja acentos via encodeURI en backend)
    const res = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urls.map((u) => ({
            url: u,
            bookmaker: request.bookmaker,
            useProxy: request.useProxy,
            captureScreenshot: request.captureScreenshot,
          })),
          useProxy: request.useProxy,
          timeoutMs: request.timeoutMs,
        }),
      });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP error ${res.status}`);
    }

    const json = await res.json();
    if (json.batch?.results) {
      return json.batch.results;
    }
    if (Array.isArray(json.data)) {
      return json.data;
    }
    if (json.data) {
      return [json.data];
    }
    return [];
  }

  /**
   * Fetch active residential proxy pool nodes
   */
  public static async fetchProxies(): Promise<ProxyItem[]> {
    const res = await fetch(`${API_BASE}/proxies`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const json = await res.json();
    return json.data;
  }
}
