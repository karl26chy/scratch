export type SportType = 'football' | 'tennis' | 'basketball' | 'table_tennis';

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
  /** Hora de inicio del partido (ISO 8601 UTC). Permite no mezclar partidos distintos entre los mismos rivales. */
  startTime?: string;
  /** El partido ya empezó (cuota en vivo): se mueve en segundos y cada casa la actualiza a su ritmo. */
  isLive?: boolean;
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
  /** Alguna pata del surebet es una cuota en vivo: suele ser un desfase momentáneo entre casas. */
  isLive?: boolean;
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
