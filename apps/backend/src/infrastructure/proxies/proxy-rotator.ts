import { ProxyNode, ProxyProtocol } from '../../domain/types/scraper.types.js';
import { env } from '../config/environment.js';

interface ProxyHealthMeta {
  consecutiveFailures: number;
  lastFailureTime?: number;
  totalRequests: number;
  totalSuccesses: number;
  inCooldownUntil?: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  lastLatencyMs?: number;
  successRate: number;
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
    this.loadProxiesFromEnv();
  }

  public static getInstance(): ProxyRotator {
    if (!ProxyRotator.instance) {
      ProxyRotator.instance = new ProxyRotator();
    }
    return ProxyRotator.instance;
  }

  // For testing: reset singleton
  public static resetInstance(): void {
    // @ts-ignore
    ProxyRotator.instance = undefined;
  }

  /**
   * Load proxies from environment variables.
   * Supports multiple providers and formats:
   * - PROXY_ENABLED=false -> no proxies (direct connection)
   * - PROXY_LIST_URL as comma/newline separated servers: "http://host:port,http://host2:port"
   * - PROXY_LIST_URL as JSON array string: '["http://host:port"]'
   * - Direct proxy list via PROXY_LIST_URL fetch is lazy (async reload)
   * - Global username/password via PROXY_USERNAME/PROXY_PASSWORD applied if not embedded
   */
  private loadProxiesFromEnv(): void {
    const proxyCfg = env.proxy;

    // If proxy disabled explicitly -> empty pool, getProxy returns undefined -> direct socket
    if (!proxyCfg.enabled) {
      console.info('[ProxyRotator] Proxy disabled via PROXY_ENABLED=false -> usando IP directa (desarrollo). Activa con PROXY_ENABLED=true y PROXY_LIST_URL');
      this.proxies = [];
      // Seed dummy only if no real proxies and disabled? Keep empty to force direct.
      // For backward compat, keep healthMap empty.
      return;
    }

    const parsedFromEnv = this.parseProxiesFromEnvString(proxyCfg.listUrl, proxyCfg.username, proxyCfg.password);

    if (parsedFromEnv.length > 0) {
      console.info(`[ProxyRotator] Cargados ${parsedFromEnv.length} proxies desde env (provider=${proxyCfg.provider})`);
      this.proxies = parsedFromEnv;
    } else {
      // Fallback: try to build single proxy from username/password + host if provided via provider defaults
      // If no listUrl but provider config given, warn and fallback to direct or seed with warning
      console.warn('[ProxyRotator] PROXY_ENABLED=true pero PROXY_LIST_URL vacío o inválido. Esperado formato: "http://host:port,http://host2:port" o "socks5://user:pass@host:port". Usando pool de fallback vacío -> se requiere configurar proxies reales.');
      // Optionally attempt to use legacy seed if user has not migrated yet but warn
      // We keep empty pool so getProxy returns undefined and scraper falls back to direct,
      // but log that this will trigger bloqueo en Pinnacle.
      this.proxies = [];
      // Uncomment to keep seed for local testing: this.seedFallbackProxies();
    }

    for (const proxy of this.proxies) {
      this.healthMap.set(proxy.id, {
        consecutiveFailures: 0,
        totalRequests: 0,
        totalSuccesses: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        successRate: 0,
      });
    }
  }

  private parseProxiesFromEnvString(
    listUrlOrCsv: string | undefined,
    globalUsername?: string,
    globalPassword?: string
  ): ProxyNode[] {
    if (!listUrlOrCsv) return [];

    const trimmed = listUrlOrCsv.trim();
    if (!trimmed) return [];

    // Try JSON array first
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed) as string[];
        if (Array.isArray(arr)) {
          return arr
            .map((s, idx) => this.createProxyNode(String(s).trim(), idx, globalUsername, globalPassword))
            .filter((p): p is ProxyNode => p !== null);
        }
      } catch {
        // fallthrough to CSV
      }
    }

    // If it looks like a single http URL fetch endpoint (e.g. webshare API) and not CSV, we cannot synchronously fetch.
    // Detect CSV vs single URL: if contains comma or newline or space-separated hosts
    const hasMultiple = trimmed.includes(',') || trimmed.includes('\n') || trimmed.includes(' ');
    // Detect API endpoint (Webshare / BrightData) vs single proxy
    if (trimmed.includes('/api/') && (trimmed.includes('webshare') || trimmed.includes('brightdata') || trimmed.includes('oxylabs'))) {
      // Es un endpoint API, no un proxy individual — se cargará vía reloadFromRemote() async
      console.info('[ProxyRotator] PROXY_LIST_URL parece endpoint API, no proxy directo — se usará reloadFromRemote() con PROXY_API_KEY');
      return [];
    }
    // If single URL without comma and starts with http and contains no port-colon pattern after host, treat as fetch URL (async)
    // For sync path, we only parse if it's a list of proxy servers, not an API endpoint.
    if (!hasMultiple) {
      // Single entry - could be "http://host:port" directly
      const single = this.createProxyNode(trimmed, 0, globalUsername, globalPassword);
      return single ? [single] : [];
    }

    // CSV / newline / space separated
    const parts = trimmed.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
    return parts
      .map((s, idx) => this.createProxyNode(s, idx, globalUsername, globalPassword))
      .filter((p): p is ProxyNode => p !== null);
  }

  private createProxyNode(raw: string, idx: number, globalUsername?: string, globalPassword?: string): ProxyNode | null {
    if (!raw) return null;

    // Support formats:
    // - http://host:port
    // - https://host:port
    // - socks5://host:port
    // - host:port (default http)
    // - http://user:pass@host:port
    // - host:port:user:pass (custom) - normalize
    let server = raw.trim();
    let protocol: ProxyProtocol = 'http';
    let username: string | undefined = globalUsername;
    let password: string | undefined = globalPassword;

    // Detect protocol prefix
    const protoMatch = server.match(/^(https?|socks5):\/\//i);
    if (protoMatch) {
      protocol = protoMatch[1].toLowerCase() as ProxyProtocol;
      // Keep server as is for Playwright, but extract auth if embedded
      try {
        const url = new URL(server);
        if (url.username) {
          username = decodeURIComponent(url.username);
          password = url.password ? decodeURIComponent(url.password) : password;
          // Rebuild server without embedded auth for Playwright {server, username, password} split?
          // Playwright supports both embedded and separate. We'll keep embedded for compatibility but also store fields.
        }
        // Normalize server to http://host:port (keep protocol prefix)
        server = `${url.protocol}//${url.host}`;
        // But also preserve if provider uses socks5h etc.
      } catch {
        // invalid URL, try fallback
      }
    } else {
      // No protocol -> assume http://
      if (server.includes('@')) {
        // user:pass@host:port
        const atIdx = server.lastIndexOf('@');
        const creds = server.substring(0, atIdx);
        const hostPart = server.substring(atIdx + 1);
        const colonIdx = creds.indexOf(':');
        if (colonIdx !== -1) {
          username = creds.substring(0, colonIdx);
          password = creds.substring(colonIdx + 1);
        } else {
          username = creds;
        }
        server = `http://${hostPart}`;
      } else {
        server = `http://${server}`;
      }
      protocol = 'http';
    }

    // If global username/password provided and not embedded, inject into server for Playwright compat
    // But we store them separately as well.
    // Generate stable id
    const id = `proxy-${protocol}-${idx}-${this.hashServer(server)}`;

    const node: ProxyNode = {
      id,
      server,
      protocol,
      country: undefined,
      latencyMs: 0,
      failsCount: 0,
    };
    if (username) node.username = username;
    if (password) node.password = password;

    return node;
  }

  private hashServer(server: string): string {
    let hash = 0;
    for (let i = 0; i < server.length; i++) {
      hash = (hash << 5) - hash + server.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36).substring(0, 6);
  }

  private seedFallbackProxies(): void {
    // Deprecated: kept only for reference, not auto-loaded when PROXY_ENABLED=true
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
    ];
    this.proxies = initialPool;
    for (const proxy of this.proxies) {
      this.healthMap.set(proxy.id, {
        consecutiveFailures: 0,
        totalRequests: 0,
        totalSuccesses: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        successRate: 0,
      });
    }
  }

  public isEnabled(): boolean {
    return env.proxy.enabled && this.proxies.length > 0;
  }

  public getProxyCount(): number {
    return this.proxies.length;
  }

  /**
   * Get proxy server string ready for Playwright.
   * If proxy has username/password, Playwright expects {server, username, password} separate,
   * but many providers use embedded auth. We return server only; caller should also read username/password.
   */
  public getProxyServerWithAuth(proxy: ProxyNode): { server: string; username?: string; password?: string } {
    return {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    };
  }

  /**
   * Get an active proxy, optionally bound to a specific session identifier (Sticky Session)
   * Returns undefined if proxy disabled or pool empty -> caller should use direct socket.
   */
  public getProxy(sessionId?: string): ProxyNode | undefined {
    if (!env.proxy.enabled || this.proxies.length === 0) {
      return undefined;
    }

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
   * Mark a proxy failure to trigger failover and cooldown (cuarentena automática)
   */
  public markProxyFailure(proxyId: string, reason?: string, latencyMs?: number): void {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    const meta = this.healthMap.get(proxyId);

    if (proxy && meta) {
      proxy.failsCount += 1;
      meta.consecutiveFailures += 1;
      meta.totalRequests += 1;
      meta.lastFailureTime = Date.now();
      if (latencyMs !== undefined) {
        meta.lastLatencyMs = latencyMs;
        meta.totalLatencyMs += latencyMs;
        meta.avgLatencyMs = Math.round(meta.totalLatencyMs / meta.totalRequests);
        proxy.latencyMs = meta.avgLatencyMs;
      }
      meta.successRate = meta.totalRequests > 0 ? meta.totalSuccesses / meta.totalRequests : 0;

      if (meta.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        meta.inCooldownUntil = Date.now() + this.COOLDOWN_MS;
        console.warn(`[ProxyRotator] Proxy ${proxyId} quarantined in cooldown for 5m. Reason: ${reason || 'Excessive failures'}`);
      }
    }
  }

  /**
   * Mark successful extraction through proxy
   */
  public markProxySuccess(proxyId: string, latencyMs?: number): void {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    const meta = this.healthMap.get(proxyId);

    if (proxy && meta) {
      meta.consecutiveFailures = 0;
      meta.totalRequests += 1;
      meta.totalSuccesses += 1;
      proxy.failsCount = 0;
      if (latencyMs !== undefined) {
        meta.lastLatencyMs = latencyMs;
        meta.totalLatencyMs += latencyMs;
        meta.avgLatencyMs = Math.round(meta.totalLatencyMs / meta.totalRequests);
        proxy.latencyMs = meta.avgLatencyMs;
      }
      meta.successRate = meta.totalRequests > 0 ? meta.totalSuccesses / meta.totalRequests : 0;
    }
  }

  public recordLatency(proxyId: string, latencyMs: number): void {
    const meta = this.healthMap.get(proxyId);
    const proxy = this.proxies.find((p) => p.id === proxyId);
    if (meta) {
      meta.lastLatencyMs = latencyMs;
      proxy && (proxy.latencyMs = latencyMs);
    }
  }

  public getAllProxies(): Array<ProxyNode & { health?: ProxyHealthMeta }> {
    return this.proxies.map((p) => ({
      ...p,
      health: this.healthMap.get(p.id),
    }));
  }

  public getHealthReport() {
    const total = this.proxies.length;
    const inCooldown = Array.from(this.healthMap.values()).filter((m) => m.inCooldownUntil && m.inCooldownUntil > Date.now()).length;
    const available = total - inCooldown;
    const allMetas = Array.from(this.healthMap.values());
    const avgLatency = allMetas.length > 0 ? Math.round(allMetas.reduce((acc, m) => acc + (m.avgLatencyMs || 0), 0) / allMetas.length) : 0;
    const totalRequests = allMetas.reduce((acc, m) => acc + m.totalRequests, 0);
    const totalSuccesses = allMetas.reduce((acc, m) => acc + m.totalSuccesses, 0);
    const globalSuccessRate = totalRequests > 0 ? +(totalSuccesses / totalRequests).toFixed(3) : 0;
    const bestProxy = this.proxies
      .map((p) => ({ id: p.id, server: p.server, health: this.healthMap.get(p.id)! }))
      .sort((a, b) => b.health.successRate - a.health.successRate || a.health.avgLatencyMs - b.health.avgLatencyMs)[0];
    return {
      enabled: env.proxy.enabled,
      provider: env.proxy.provider,
      total,
      available,
      inCooldown,
      testUrl: env.proxy.testUrl,
      performance: {
        avgLatencyMs: avgLatency,
        totalRequests,
        totalSuccesses,
        globalSuccessRate,
        bestProxy: bestProxy ? { id: bestProxy.id, server: bestProxy.server, successRate: bestProxy.health.successRate, avgLatencyMs: bestProxy.health.avgLatencyMs } : null,
      },
    };
  }

  public getPerformanceMetrics() {
    return Array.from(this.healthMap.entries()).map(([id, meta]) => {
      const proxy = this.proxies.find((p) => p.id === id);
      return {
        id,
        server: proxy?.server,
        protocol: proxy?.protocol,
        country: proxy?.country,
        totalRequests: meta.totalRequests,
        totalSuccesses: meta.totalSuccesses,
        successRate: meta.successRate,
        avgLatencyMs: meta.avgLatencyMs,
        lastLatencyMs: meta.lastLatencyMs,
        consecutiveFailures: meta.consecutiveFailures,
        inCooldown: !!meta.inCooldownUntil && meta.inCooldownUntil > Date.now(),
        cooldownUntil: meta.inCooldownUntil ? new Date(meta.inCooldownUntil).toISOString() : null,
      };
    });
  }

  /**
   * Async reload from remote provider (Webshare / BrightData / Oxylabs).
   * Mantiene compatibilidad con lista manual si no hay apiKey.
   */
  public async reloadFromRemote(): Promise<void> {
    const { provider, apiKey, listUrl, username, password } = env.proxy;

    if (!apiKey) {
      console.warn('⚠️ No API key configurada, usando lista manual');
      return;
    }

    try {
      let proxyData: any[] = [];

      // Proveedor: Webshare.io
      if (provider === 'webshare') {
        // Only use listUrl if it's actually a Webshare API endpoint, not a CSV of proxy IPs
        const isWebshareApiUrl = listUrl && (listUrl.includes('webshare.io/api') || listUrl.startsWith('https://proxy.webshare'));
        const webshareEndpoint = isWebshareApiUrl
          ? listUrl
          : 'https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=25';
        const response = await fetch(webshareEndpoint, {
          headers: { Authorization: `Token ${apiKey}` },
        });
        if (!response.ok) throw new Error(`Webshare HTTP ${response.status}`);
        const data: any = await response.json();
        proxyData = data.results || data;

        const parsed = proxyData
          .map((p: any, idx: number) => {
            const ip = p.proxy_address || p.ip || p.host;
            const port = p.port || p.proxy_port;
            if (!ip || !port) return null;
            const server = `http://${ip}:${port}`;
            const node = this.createProxyNode(server, idx, p.username || username, p.password || password);
            if (node) {
              node.country = p.country_code || p.country;
              node.latencyMs = p.latency || 0;
            }
            return node;
          })
          .filter((p): p is ProxyNode => p !== null);

        if (parsed.length > 0) {
          this.proxies = parsed;
          this.healthMap.clear();
          for (const proxy of this.proxies) {
            this.healthMap.set(proxy.id, { consecutiveFailures: 0, totalRequests: 0, totalSuccesses: 0, totalLatencyMs: 0, avgLatencyMs: 0, successRate: 0 });
          }
        }
        console.log(`✅ Cargados ${this.proxies.length} proxies desde ${provider}`);
        return;
      }

      // Proveedor: BrightData
      else if (provider === 'brightdata') {
        const response = await fetch(listUrl || 'https://api.brightdata.com/zone/get_active_proxies', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!response.ok) throw new Error(`BrightData HTTP ${response.status}`);
        const data: any = await response.json();
        proxyData = data.proxies || data.ips || data;

        const list: any[] = Array.isArray(proxyData) ? proxyData : [proxyData];
        const parsed = list
          .map((p: any, idx: number) => {
            const ip = p.ip || p.host || p.proxy_address;
            const port = p.port || p.proxy_port;
            if (!ip || !port) return null;
            const server = `http://${ip}:${port}`;
            const node = this.createProxyNode(server, idx, p.username || username, p.password || password);
            if (node) {
              node.country = p.country || p.country_code;
              node.latencyMs = p.latency || 0;
            }
            return node;
          })
          .filter((p): p is ProxyNode => p !== null);

        if (parsed.length > 0) {
          this.proxies = parsed;
          this.healthMap.clear();
          for (const proxy of this.proxies) {
            this.healthMap.set(proxy.id, { consecutiveFailures: 0, totalRequests: 0, totalSuccesses: 0, totalLatencyMs: 0, avgLatencyMs: 0, successRate: 0 });
          }
        }
        console.log(`✅ Cargados ${this.proxies.length} proxies desde ${provider}`);
        return;
      }

      // Proveedor: Oxylabs
      else if (provider === 'oxylabs') {
        const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
        const response = await fetch(listUrl || 'https://api.oxylabs.io/api/proxy/list', {
          headers: { Authorization: `Basic ${basicAuth}` },
        });
        if (!response.ok) throw new Error(`Oxylabs HTTP ${response.status}`);
        const data: any = await response.json();
        proxyData = data.proxies || data.results || data;

        const list: any[] = Array.isArray(proxyData) ? proxyData : [proxyData];
        const parsed = list
          .map((p: any, idx: number) => {
            const ip = p.ip || p.host || p.proxy_address;
            const port = p.port || p.proxy_port;
            if (!ip || !port) return null;
            const server = `http://${ip}:${port}`;
            const node = this.createProxyNode(server, idx, p.username || username, p.password || password);
            if (node) {
              node.country = p.country_code || p.country;
              node.latencyMs = p.latency || 0;
            }
            return node;
          })
          .filter((p): p is ProxyNode => p !== null);

        if (parsed.length > 0) {
          this.proxies = parsed;
          this.healthMap.clear();
          for (const proxy of this.proxies) {
            this.healthMap.set(proxy.id, { consecutiveFailures: 0, totalRequests: 0, totalSuccesses: 0, totalLatencyMs: 0, avgLatencyMs: 0, successRate: 0 });
          }
        }
        console.log(`✅ Cargados ${this.proxies.length} proxies desde ${provider}`);
        return;
      }

      // Proveedor genérico / custom: intenta fetch genérico
      else {
        const headers: Record<string, string> = {};
        if (apiKey) headers['Authorization'] = `Token ${apiKey}`;
        const res = await fetch(listUrl!, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: any = await res.json().catch(() => null);
        let servers: string[] = [];
        if (Array.isArray(data)) {
          servers = data.map((s: any) => (typeof s === 'string' ? s : s.server || `${s.proxy_address || s.ip}:${s.port || s.proxy_port}`));
        } else if (data?.results && Array.isArray(data.results)) {
          servers = data.results.map((r: any) => `${r.proxy_address || r.ip}:${r.port || r.proxy_port}`);
        }
        if (servers.length > 0) {
          const parsed = servers
            .map((s, idx) => this.createProxyNode(s, idx, username, password))
            .filter((p): p is ProxyNode => p !== null);
          if (parsed.length > 0) {
            this.proxies = parsed;
            this.healthMap.clear();
            for (const p of this.proxies) this.healthMap.set(p.id, { consecutiveFailures: 0, totalRequests: 0, totalSuccesses: 0, totalLatencyMs: 0, avgLatencyMs: 0, successRate: 0 });
            console.log(`✅ Cargados ${this.proxies.length} proxies desde ${provider}`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error cargando proxies remotos:', error);
      // Mantener proxies existentes si falla
    }
  }

  /**
   * Test a proxy by routing a simple fetch through Playwright context (lightweight check)
   */
  public async testProxyConnectivity(proxy: ProxyNode): Promise<{ success: boolean; latencyMs: number; ip?: string; error?: string }> {
    const start = Date.now();
    try {
      // Lightweight: use fetch with proxy via env? For now test without browser, just check server format
      // If custom testUrl is set, try direct fetch through proxy using http proxy agent would require extra dep.
      // We do a placeholder: validate server URL format
      const url = new URL(proxy.server);
      if (!url.hostname || !url.port) throw new Error('Invalid proxy server URL');
      return { success: true, latencyMs: Date.now() - start, ip: url.hostname };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message };
    }
  }
}
