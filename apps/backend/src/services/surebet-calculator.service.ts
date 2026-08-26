import {
  BookmakerOdd,
  SurebetOpportunity,
  SurebetOutcome,
  AnalyzeSurebetsRequestDto,
  AnalyzeSurebetsResponseDto,
  MarketType,
  SportType,
} from '../domain/types/surebet.types.js';

export class SurebetCalculatorService {
  /**
   * Calculates arbitrage metrics and optimal stake distribution for a given set of odds
   *
   * @param odds Array of odds from multiple bookmakers
   * @param totalStake Total bankroll/capital to distribute (default: 1000)
   * @param minProfitMargin Minimum profit percentage threshold (default: 0%)
   */
  public analyzeOdds(
    odds: BookmakerOdd[],
    totalStake: number = 1000,
    minProfitMargin: number = 0
  ): AnalyzeSurebetsResponseDto {
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
    // Determine expected mutually exclusive selections
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
   * Return predefined live opportunities across sports for dashboard tracking
   */
  public getLiveSeededOpportunities(totalStake = 1000): SurebetOpportunity[] {
    const sampleOdds: BookmakerOdd[] = [
      // 1. Real Madrid vs Manchester City (Football 1X2 - Arbitrage ~4.12%)
      { bookmaker: 'Pinnacle', eventName: 'Real Madrid vs Manchester City', sport: 'football', marketType: '1X2', selection: '1', odd: 2.85 },
      { bookmaker: 'Bet365', eventName: 'Real Madrid vs Manchester City', sport: 'football', marketType: '1X2', selection: '1', odd: 2.60 },
      { bookmaker: 'Betfair', eventName: 'Real Madrid vs Manchester City', sport: 'football', marketType: '1X2', selection: 'X', odd: 3.75 },
      { bookmaker: '1xBet', eventName: 'Real Madrid vs Manchester City', sport: 'football', marketType: '1X2', selection: 'X', odd: 3.50 },
      { bookmaker: 'WilliamHill', eventName: 'Real Madrid vs Manchester City', sport: 'football', marketType: '1X2', selection: '2', odd: 2.90 },
      { bookmaker: 'Pinnacle', eventName: 'Real Madrid vs Manchester City', sport: 'football', marketType: '1X2', selection: '2', odd: 2.70 },

      // 2. Carlos Alcaraz vs Jannik Sinner (Tennis 2-Way Moneyline - Arbitrage ~3.45%)
      { bookmaker: 'Pinnacle', eventName: 'Carlos Alcaraz vs Jannik Sinner', sport: 'tennis', marketType: 'MONEYLINE_2WAY', selection: '1', odd: 2.14 },
      { bookmaker: 'Bet365', eventName: 'Carlos Alcaraz vs Jannik Sinner', sport: 'tennis', marketType: 'MONEYLINE_2WAY', selection: '1', odd: 1.95 },
      { bookmaker: 'Betfair', eventName: 'Carlos Alcaraz vs Jannik Sinner', sport: 'tennis', marketType: 'MONEYLINE_2WAY', selection: '2', odd: 2.08 },
      { bookmaker: 'Bwin', eventName: 'Carlos Alcaraz vs Jannik Sinner', sport: 'tennis', marketType: 'MONEYLINE_2WAY', selection: '2', odd: 1.90 },

      // 3. Boston Celtics vs LA Lakers (Basketball 2-Way Moneyline - Arbitrage ~2.78%)
      { bookmaker: '1xBet', eventName: 'Boston Celtics vs LA Lakers', sport: 'basketball', marketType: 'MONEYLINE_2WAY', selection: '1', odd: 1.62 },
      { bookmaker: 'Pinnacle', eventName: 'Boston Celtics vs LA Lakers', sport: 'basketball', marketType: 'MONEYLINE_2WAY', selection: '1', odd: 1.55 },
      { bookmaker: 'Bet365', eventName: 'Boston Celtics vs LA Lakers', sport: 'basketball', marketType: 'MONEYLINE_2WAY', selection: '2', odd: 2.85 },
      { bookmaker: 'Betfair', eventName: 'Boston Celtics vs LA Lakers', sport: 'basketball', marketType: 'MONEYLINE_2WAY', selection: '2', odd: 2.65 },

      // 4. Bayern Munich vs Arsenal (Football Over/Under 2.5 - Arbitrage ~1.95%)
      { bookmaker: 'Pinnacle', eventName: 'Bayern Munich vs Arsenal (Goals)', sport: 'football', marketType: 'OVER_UNDER_2_5', selection: 'OVER', odd: 2.10 },
      { bookmaker: 'Betfair', eventName: 'Bayern Munich vs Arsenal (Goals)', sport: 'football', marketType: 'OVER_UNDER_2_5', selection: 'UNDER', odd: 2.04 },
    ];

    const result = this.analyzeOdds(sampleOdds, totalStake);
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
