export type StealthLevel = 'basic' | 'standard' | 'advanced' | 'paranoid';

export type ProxyProtocol = 'http' | 'https' | 'socks5';

export interface ProxyNode {
  id: string;
  server: string;
  username?: string;
  password?: string;
  protocol: ProxyProtocol;
  country?: string;
  latencyMs?: number;
  failsCount: number;
  lastUsedAt?: Date;
}

export interface BrowserFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  locale: string;
  timezoneId: string;
  platform: string;
  webGlVendor: string;
  webGlRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
}

export interface ScrapeRequestDto {
  url?: string;
  urls?: string[]; // Array of target URLs for concurrent mass scraping (>= 7 bookmakers)
  stealthLevel?: StealthLevel;
  waitForSelector?: string;
  timeoutMs?: number;
  sessionId?: string;
  extractRules?: {
    title?: boolean;
    meta?: boolean;
    links?: boolean;
    customSelector?: string;
    sportsOdds?: boolean;
  };
  useProxy?: boolean;
  captureScreenshot?: boolean;
}

export interface ScrapeResultDto {
  id: string;
  url: string;
  status: 'SUCCESS' | 'BLOCKED' | 'ERROR' | 'DOM_STRUCTURE_CHANGED';
  statusCode?: number;
  pageTitle?: string;
  htmlLength: number;
  extractedData?: Record<string, unknown>;
  domAlert?: {
    hasChanged: boolean;
    message?: string;
  };
  stealthMetrics: {
    stealthLevelApplied: StealthLevel;
    fingerprintUsed: Partial<BrowserFingerprint>;
    proxyUsed?: string;
    bypassedAntiBot: boolean;
    durationMs: number;
  };
  screenshotBase64?: string;
  createdAt: string;
}

export interface BatchScrapeResultDto {
  success: boolean;
  totalRequested: number;
  successfulCount: number;
  blockedCount: number;
  results: ScrapeResultDto[];
  durationMs: number;
  timestamp: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptimeSeconds: number;
  timestamp: string;
  environment: string;
  browserPool: {
    activeInstances: number;
    maxCapacity: number;
    isHealthy: boolean;
  };
}
