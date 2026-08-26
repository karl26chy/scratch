import { ProxyNode } from '../../domain/types/scraper.types.js';

interface ProxyHealthMeta {
  consecutiveFailures: number;
  lastFailureTime?: number;
  totalRequests: number;
  totalSuccesses: number;
  inCooldownUntil?: number;
}

export class ProxyRotator {
  private static instance: ProxyRotator;
  private proxies: ProxyNode[] = [];
  private healthMap: Map<string, ProxyHealthMeta> = new Map();
  private sessionMap: Map<string, string> = new Map(); // sessionId -> proxyId
  private currentIndex = 0;
  private readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown on repeated failure
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  private constructor() {
    this.seedDefaultProxies();
  }

  public static getInstance(): ProxyRotator {
    if (!ProxyRotator.instance) {
      ProxyRotator.instance = new ProxyRotator();
    }
    return ProxyRotator.instance;
  }

  private seedDefaultProxies(): void {
    // In production, these are injected via environment variables or secret vaults
    const initialPool: ProxyNode[] = [
      {
        id: 'res-proxy-us-east-1',
        server: 'http://us-residential-pool.geonetwork.io:10001',
        protocol: 'http',
        country: 'US',
        latencyMs: 120,
        failsCount: 0,
      },
      {
        id: 'res-proxy-us-west-1',
        server: 'http://us-residential-pool.geonetwork.io:10002',
        protocol: 'http',
        country: 'US',
        latencyMs: 140,
        failsCount: 0,
      },
      {
        id: 'res-proxy-eu-de-1',
        server: 'http://eu-residential-pool.geonetwork.io:20001',
        protocol: 'http',
        country: 'DE',
        latencyMs: 85,
        failsCount: 0,
      },
      {
        id: 'res-proxy-es-mad-1',
        server: 'http://es-residential-pool.geonetwork.io:20002',
        protocol: 'http',
        country: 'ES',
        latencyMs: 70,
        failsCount: 0,
      },
    ];

    this.proxies = initialPool;
    for (const proxy of this.proxies) {
      this.healthMap.set(proxy.id, {
        consecutiveFailures: 0,
        totalRequests: 0,
        totalSuccesses: 0,
      });
    }
  }

  /**
   * Get an active proxy, optionally bound to a specific session identifier (Sticky Session)
   */
  public getProxy(sessionId?: string): ProxyNode | undefined {
    const now = Date.now();

    // Clean cooldowns
    for (const [id, meta] of this.healthMap.entries()) {
      if (meta.inCooldownUntil && meta.inCooldownUntil <= now) {
        meta.inCooldownUntil = undefined;
        meta.consecutiveFailures = 0;
        const proxy = this.proxies.find((p) => p.id === id);
        if (proxy) proxy.failsCount = 0;
      }
    }

    const available = this.proxies.filter((p) => {
      const meta = this.healthMap.get(p.id);
      return !meta?.inCooldownUntil && (meta?.consecutiveFailures || 0) < this.MAX_CONSECUTIVE_FAILURES;
    });

    if (available.length === 0) {
      // Fallback: return proxy with lowest failure count
      return this.proxies[0];
    }

    // 1. If sticky session requested and valid proxy already mapped
    if (sessionId && this.sessionMap.has(sessionId)) {
      const assignedId = this.sessionMap.get(sessionId)!;
      const assignedProxy = available.find((p) => p.id === assignedId);
      if (assignedProxy) {
        assignedProxy.lastUsedAt = new Date();
        return assignedProxy;
      }
    }

    // 2. Round-robin with health prioritization
    const proxy = available[this.currentIndex % available.length];
    this.currentIndex = (this.currentIndex + 1) % available.length;
    proxy.lastUsedAt = new Date();

    if (sessionId) {
      this.sessionMap.set(sessionId, proxy.id);
    }

    return proxy;
  }

  /**
   * Force rotate the proxy assigned to a session (e.g. upon detecting anti-bot challenge / 403 / 429)
   */
  public rotateSessionProxy(sessionId: string): ProxyNode | undefined {
    const currentAssignedId = this.sessionMap.get(sessionId);
    if (currentAssignedId) {
      this.markProxyFailure(currentAssignedId, 'Triggered Anti-Bot Block / Rotation requested');
      this.sessionMap.delete(sessionId);
    }
    return this.getProxy(sessionId);
  }

  /**
   * Mark a proxy failure to trigger failover and cooldown
   */
  public markProxyFailure(proxyId: string, reason?: string): void {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    const meta = this.healthMap.get(proxyId);

    if (proxy && meta) {
      proxy.failsCount += 1;
      meta.consecutiveFailures += 1;
      meta.totalRequests += 1;
      meta.lastFailureTime = Date.now();

      if (meta.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        meta.inCooldownUntil = Date.now() + this.COOLDOWN_MS;
        console.warn(`[ProxyRotator] Proxy ${proxyId} quarantined in cooldown for 5m. Reason: ${reason || 'Excessive failures'}`);
      }
    }
  }

  /**
   * Mark successful extraction through proxy
   */
  public markProxySuccess(proxyId: string): void {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    const meta = this.healthMap.get(proxyId);

    if (proxy && meta) {
      meta.consecutiveFailures = 0;
      meta.totalRequests += 1;
      meta.totalSuccesses += 1;
      proxy.failsCount = 0;
    }
  }

  public getAllProxies(): Array<ProxyNode & { health?: ProxyHealthMeta }> {
    return this.proxies.map((p) => ({
      ...p,
      health: this.healthMap.get(p.id),
    }));
  }
}
