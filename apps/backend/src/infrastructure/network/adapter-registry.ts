import type { SiteOddsAdapter } from '../../domain/types/site-adapter.js';

export class SiteAdapterRegistry {
  private static instance: SiteAdapterRegistry | undefined;
  private adapters: SiteOddsAdapter[] = [];

  public static getInstance(): SiteAdapterRegistry {
    if (!SiteAdapterRegistry.instance) {
      SiteAdapterRegistry.instance = new SiteAdapterRegistry();
    }
    return SiteAdapterRegistry.instance;
  }

  public register(adapter: SiteOddsAdapter): void {
    const existingIndex = this.adapters.findIndex((a) => a.domain === adapter.domain);
    if (existingIndex >= 0) {
      this.adapters[existingIndex] = adapter;
    } else {
      this.adapters.push(adapter);
    }
  }

  public unregister(domain: string): void {
    this.adapters = this.adapters.filter((a) => a.domain !== domain);
  }

  public getForUrl(url: string): SiteOddsAdapter | null {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return null;
    }

    const normalized = hostname.replace(/^www\./, '');
    for (const adapter of this.adapters) {
      const adapterHost = adapter.domain.replace(/^www\./, '');
      if (normalized === adapterHost || normalized.endsWith(`.${adapterHost}`)) {
        return adapter;
      }
    }
    return null;
  }

  public list(): SiteOddsAdapter[] {
    return [...this.adapters];
  }

  public getAllDomains(): string[] {
    return this.adapters.map((a) => a.domain);
  }

  public getForDomain(domain: string): SiteOddsAdapter | null {
    const normalized = domain.replace(/^www\./, '').toLowerCase();
    return this.adapters.find((a) => a.domain.replace(/^www\./, '').toLowerCase() === normalized) ?? null;
  }
}
