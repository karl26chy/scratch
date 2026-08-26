export type SportType = 'football' | 'tennis' | 'basketball' | 'baseball' | 'esports' | 'other';

export type MarketType = '1X2' | 'MONEYLINE_2WAY' | 'OVER_UNDER_2_5' | 'BOTH_TEAMS_SCORE';

export interface BookmakerOdd {
  bookmaker: string;
  eventName: string;
  sport: SportType;
  marketType: MarketType;
  selection: string; // '1' | 'X' | '2' | 'HOME' | 'AWAY' | 'OVER' | 'UNDER'
  odd: number; // Decimal odd, e.g. 2.15
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
  totalImpliedProbability: number; // TIP, e.g. 0.965 (96.5%)
  isSurebet: boolean; // true if TIP < 1.0
  profitMarginPercentage: number; // e.g. 3.63%
  totalInvestment: number; // Base stake used for calculation (e.g. 1000)
  guaranteedPayout: number; // Total payout regardless of outcome
  guaranteedProfit: number; // Guaranteed net profit
  detectedAt: string;
}

export interface AnalyzeSurebetsRequestDto {
  totalStake?: number;
  minProfitMargin?: number;
  marketType?: MarketType;
  oddsData?: BookmakerOdd[];
}

export interface AnalyzeSurebetsResponseDto {
  success: boolean;
  opportunities: SurebetOpportunity[];
  analyzedEventsCount: number;
  surebetsFoundCount: number;
  highestProfitMargin: number;
  timestamp: string;
}
