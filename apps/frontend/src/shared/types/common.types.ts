export type StealthLevel = 'basic' | 'standard' | 'advanced' | 'paranoid';

export type SportType = 'football' | 'tennis' | 'basketball' | 'baseball' | 'esports' | 'other';
export type MarketType = '1X2' | 'MONEYLINE_2WAY' | 'OVER_UNDER_2_5' | 'BOTH_TEAMS_SCORE';

export interface BookmakerOdd {
  bookmaker: string;
  eventName: string;
  sport: SportType;
  marketType: MarketType;
  selection: string;
  odd: number;
  url?: string;
  timestamp?: string;
}

export interface SurebetOutcome {
  selection: string;
  bookmaker: string;
  odd: number;
  stakePercentage: number;
  recommendedStake: number;
  expectedPayout: number;
}

export interface SurebetOpportunity {
  id: string;
  eventName: string;
  sport: SportType;
  marketType: MarketType;
  outcomes: SurebetOutcome[];
  totalImpliedProbability: number;
  isSurebet: boolean;
  profitMarginPercentage: number;
  totalInvestment: number;
  guaranteedPayout: number;
  guaranteedProfit: number;
  detectedAt: string;
}

export interface ScrapeRequest {
  url?: string;
  urls?: string[];
  useProxy: boolean;
  captureScreenshot: boolean;
  waitForSelector?: string;
  timeoutMs?: number;
}

export interface ScrapeResult {
  id: string;
  url: string;
  status: 'SUCCESS' | 'BLOCKED' | 'ERROR' | 'DOM_STRUCTURE_CHANGED';
  statusCode?: number;
  pageTitle?: string;
  htmlLength: number;
  extractedData?: Record<string, any>;
  domAlert?: {
    hasChanged: boolean;
    message?: string;
  };
  stealthMetrics: {
    stealthLevelApplied: StealthLevel;
    fingerprintUsed: {
      userAgent?: string;
      platform?: string;
      viewport?: { width: number; height: number };
    };
    proxyUsed?: string;
    bypassedAntiBot: boolean;
    durationMs: number;
  };
  screenshotBase64?: string;
  createdAt: string;
}

export interface BatchScrapeResult {
  success: boolean;
  totalRequested: number;
  successfulCount: number;
  blockedCount: number;
  results: ScrapeResult[];
  durationMs: number;
  timestamp: string;
}

export interface ProxyItem {
  id: string;
  server: string;
  protocol: string;
  country?: string;
  latencyMs?: number;
  failsCount: number;
}

export interface SystemHealth {
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
