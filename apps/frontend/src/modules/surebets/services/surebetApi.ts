import { SurebetOpportunity, BookmakerOdd } from '../../../shared/types/common.types.js';

const API_BASE = 'http://localhost:4000/api';

export class SurebetApi {
  /**
   * Fetch live opportunities detected by the engine
   */
  public static async fetchLiveOpportunities(totalStake: number = 1000000): Promise<SurebetOpportunity[]> {
    try {
      const res = await fetch(`${API_BASE}/surebets/live-opportunities?totalStake=${totalStake}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      return json.data?.opportunities || [];
    } catch (err) {
      console.error('Error fetching live surebets:', err);
      return [];
    }
  }

  /**
   * Trae los cruces reales entre casas más cercanos a ser surebet, aunque todavía
   * no sean rentables (margen negativo) — útil para mostrar que el motor está
   * comparando cuotas de verdad entre casas, no que está "roto" cuando no hay
   * arbitraje disponible en este momento (lo normal la mayor parte del tiempo).
   */
  public static async fetchNearMisses(totalStake: number = 1000000, limit = 5): Promise<SurebetOpportunity[]> {
    try {
      const res = await fetch(`${API_BASE}/surebets/calculate?totalStake=${totalStake}&minProfit=-100`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      const opportunities: SurebetOpportunity[] = json.data?.opportunities || [];
      const crossBookmaker = opportunities.filter((o) => new Set(o.outcomes.map((out) => out.bookmaker)).size >= 2);
      return crossBookmaker.sort((a, b) => b.profitMarginPercentage - a.profitMarginPercentage).slice(0, limit);
    } catch (err) {
      console.error('Error fetching near-miss surebets:', err);
      return [];
    }
  }

  /**
   * Analyze custom user-provided odds for arbitrage
   */
  public static async analyzeCustomOdds(
    oddsData: BookmakerOdd[],
    totalStake: number = 1000000,
    minProfitMargin: number = 0
  ): Promise<SurebetOpportunity[]> {
    try {
      const res = await fetch(`${API_BASE}/surebets/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oddsData,
          totalStake,
          minProfitMargin,
        }),
      });

      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      return json.data?.opportunities || [];
    } catch (err) {
      console.error('Error analyzing surebets:', err);
      throw err;
    }
  }
}
