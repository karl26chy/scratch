import { ScrapeRequest, ScrapeResult, ProxyItem } from '../../../shared/types/common.types.js';

const API_BASE = 'http://localhost:4000/api';

export class ScraperApi {
  /**
   * Execute single or mass concurrent scrape against target bookmaker URLs
   */
  public static async executeScrape(request: ScrapeRequest): Promise<ScrapeResult[]> {
    const urls = request.urls && request.urls.length > 0 ? request.urls : request.url ? [request.url] : [];

    const res = await fetch(`${API_BASE}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls,
        useProxy: request.useProxy,
        captureScreenshot: request.captureScreenshot,
        waitForSelector: request.waitForSelector,
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
