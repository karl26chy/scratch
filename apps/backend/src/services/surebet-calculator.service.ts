import {
  BookmakerOdd,
  SurebetOpportunity,
  SurebetOutcome,
  AnalyzeSurebetsResponseDto,
  MarketType,
  SportType,
} from '../domain/types/surebet.types.js';

export class SurebetCalculatorService {
  private static instance: SurebetCalculatorService;
  private liveOddsStore: BookmakerOdd[] = [];

  public static getInstance(): SurebetCalculatorService {
    if (!SurebetCalculatorService.instance) {
      SurebetCalculatorService.instance = new SurebetCalculatorService();
    }
    return SurebetCalculatorService.instance;
  }

  /**
   * Adds newly scraped odds from live bookmaker missions into the active pipeline
   */
  public addScrapedOdds(odds: BookmakerOdd[]): void {
    if (!odds || odds.length === 0) return;
    this.liveOddsStore = [...odds, ...this.liveOddsStore].slice(0, 500); // retain latest 500 odds
  }

  /**
   * Clears in-memory live odds store
   */
  public clearLiveOdds(): void {
    this.liveOddsStore = [];
  }

  /**
   * Retrieves active live odds
   */
  public getLiveOdds(): BookmakerOdd[] {
    return this.liveOddsStore;
  }

  /**
   * Calculates arbitrage metrics and optimal stake distribution for a given set of odds
   *
   * @param odds Array of real odds from multiple bookmakers
   * @param totalStake Total bankroll/capital to distribute (default: 1000)
   * @param minProfitMargin Minimum profit percentage threshold (default: 0%)
   */
  public analyzeOdds(
    odds: BookmakerOdd[],
    totalStake: number = 1000,
    minProfitMargin: number = 0
  ): AnalyzeSurebetsResponseDto {
    if (!odds || odds.length === 0) {
      return {
        success: true,
        opportunities: [],
        analyzedEventsCount: 0,
        surebetsFoundCount: 0,
        highestProfitMargin: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // 1. Group odds by eventName and marketType
    const eventMarketMap = new Map<string, BookmakerOdd[]>();

    for (const odd of odds) {
      if (!odd.odd || isNaN(odd.odd) || odd.odd <= 1.0) continue;
      const key = `${odd.eventName.trim().toLowerCase()}:::${odd.marketType}`;
      const existing = eventMarketMap.get(key) || [];
      existing.push(odd);
      eventMarketMap.set(key, existing);
    }

    const opportunities: SurebetOpportunity[] = [];

    // 2. Process each event market to find optimal cross-bookmaker combinations
    for (const [key, groupOdds] of eventMarketMap.entries()) {
      const [eventName, marketTypeStr] = key.split(':::');
      const marketType = marketTypeStr as MarketType;
      const sport = groupOdds[0]?.sport || 'football';

      const opportunity = this.calculateOpportunityForMarket(
        groupOdds,
        eventName,
        marketType,
        sport,
        totalStake
      );

      if (opportunity && opportunity.profitMarginPercentage >= minProfitMargin) {
        opportunities.push(opportunity);
      }
    }

    // Sort opportunities by highest profit margin first
    opportunities.sort((a, b) => b.profitMarginPercentage - a.profitMarginPercentage);

    const highestProfitMargin = opportunities.length > 0 ? opportunities[0].profitMarginPercentage : 0;
    const surebetsFoundCount = opportunities.filter((o) => o.isSurebet).length;

    return {
      success: true,
      opportunities,
      analyzedEventsCount: eventMarketMap.size,
      surebetsFoundCount,
      highestProfitMargin: parseFloat(highestProfitMargin.toFixed(2)),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Evaluates if a set of odds for a market produces a mathematically valid Surebet
   */
  public calculateOpportunityForMarket(
    odds: BookmakerOdd[],
    eventName: string,
    marketType: MarketType,
    sport: SportType,
    totalStake: number
  ): SurebetOpportunity | null {
    const requiredSelections = this.getRequiredSelectionsForMarket(marketType);
    if (!requiredSelections || requiredSelections.length === 0) return null;

    // Find highest decimal odd available across bookmakers for each selection
    const bestOddsPerSelection = new Map<string, BookmakerOdd>();

    for (const odd of odds) {
      const normalizedSel = this.normalizeSelection(odd.selection);
      if (!requiredSelections.includes(normalizedSel)) continue;

      const currentBest = bestOddsPerSelection.get(normalizedSel);
      if (!currentBest || odd.odd > currentBest.odd) {
        bestOddsPerSelection.set(normalizedSel, { ...odd, selection: normalizedSel });
      }
    }

    // Ensure all mutually exclusive outcomes have at least one valid odd
    if (bestOddsPerSelection.size < requiredSelections.length) {
      return null;
    }

    // 3. Mathematical Arbitrage Computation:
    // Total Implied Probability (TIP) = Sum of (1 / BestOdd_i)
    let totalImpliedProbability = 0;
    const selectedBestOdds: BookmakerOdd[] = [];

    for (const sel of requiredSelections) {
      const best = bestOddsPerSelection.get(sel)!;
      selectedBestOdds.push(best);
      totalImpliedProbability += 1 / best.odd;
    }

    // Condition of Arbitrage: TIP < 1.0 (or TIP < 100%)
    const isSurebet = totalImpliedProbability < 1.0;

    // Profit Margin (%) = ((1 / TIP) - 1) * 100
    const profitMarginPercentage = ((1 / totalImpliedProbability) - 1) * 100;

    // 4. Optimal Stake Distribution:
    // Stake_i = TotalStake / (TIP * BestOdd_i)
    const outcomes: SurebetOutcome[] = [];
    let allocatedStakeSum = 0;

    for (const best of selectedBestOdds) {
      const stakePercentage = (1 / (totalImpliedProbability * best.odd)) * 100;
      const rawStake = (totalStake * stakePercentage) / 100;
      const roundedStake = Math.round(rawStake * 100) / 100;
      const expectedPayout = Math.round(roundedStake * best.odd * 100) / 100;

      allocatedStakeSum += roundedStake;

      outcomes.push({
        selection: best.selection,
        bookmaker: best.bookmaker,
        odd: best.odd,
        stakePercentage: parseFloat(stakePercentage.toFixed(2)),
        recommendedStake: roundedStake,
        expectedPayout,
      });
    }

    // Correct precision delta on last outcome
    const delta = Math.round((totalStake - allocatedStakeSum) * 100) / 100;
    if (delta !== 0 && outcomes.length > 0) {
      outcomes[outcomes.length - 1].recommendedStake = Math.round((outcomes[outcomes.length - 1].recommendedStake + delta) * 100) / 100;
      outcomes[outcomes.length - 1].expectedPayout = Math.round(outcomes[outcomes.length - 1].recommendedStake * outcomes[outcomes.length - 1].odd * 100) / 100;
    }

    const minPayout = Math.min(...outcomes.map((o) => o.expectedPayout));
    const guaranteedProfit = Math.round((minPayout - totalStake) * 100) / 100;

    return {
      id: `sb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      eventName: this.formatEventTitle(eventName),
      sport,
      marketType,
      outcomes,
      totalImpliedProbability: parseFloat(totalImpliedProbability.toFixed(4)),
      isSurebet,
      profitMarginPercentage: parseFloat(profitMarginPercentage.toFixed(2)),
      totalInvestment: totalStake,
      guaranteedPayout: minPayout,
      guaranteedProfit,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * Return live calculated opportunities from real scraped data (starts empty [] if no data scraped yet)
   */
  public getLiveOpportunities(totalStake = 1000): SurebetOpportunity[] {
    if (this.liveOddsStore.length === 0) {
      return [];
    }
    const result = this.analyzeOdds(this.liveOddsStore, totalStake);
    return result.opportunities;
  }

  private getRequiredSelectionsForMarket(marketType: MarketType): string[] {
    switch (marketType) {
      case '1X2':
        return ['1', 'X', '2'];
      case 'MONEYLINE_2WAY':
        return ['1', '2'];
      case 'OVER_UNDER_2_5':
        return ['OVER', 'UNDER'];
      case 'BOTH_TEAMS_SCORE':
        return ['YES', 'NO'];
      default:
        return ['1', '2'];
    }
  }

  private normalizeSelection(raw: string): string {
    const upper = raw.trim().toUpperCase();
    if (upper === '1' || upper === 'HOME' || upper === 'LOCAL' || upper === 'TEAM1') return '1';
    if (upper === 'X' || upper === 'DRAW' || upper === 'EMPATE') return 'X';
    if (upper === '2' || upper === 'AWAY' || upper === 'VISITANTE' || upper === 'TEAM2') return '2';
    if (upper.includes('OVER') || upper.includes('MÁS')) return 'OVER';
    if (upper.includes('UNDER') || upper.includes('MENOS')) return 'UNDER';
    if (upper === 'YES' || upper === 'SI' || upper === 'SÍ') return 'YES';
    if (upper === 'NO') return 'NO';
    return upper;
  }

  private formatEventTitle(title: string): string {
    return title
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
}
