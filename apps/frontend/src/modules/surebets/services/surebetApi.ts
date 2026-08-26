import { SurebetOpportunity, BookmakerOdd } from '../../../shared/types/common.types.js';

const API_BASE = 'http://localhost:4000/api';

export class SurebetApi {
  /**
   * Fetch live opportunities detected by the engine
   */
  public static async fetchLiveOpportunities(totalStake: number = 1000): Promise<SurebetOpportunity[]> {
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
   * Analyze custom user-provided odds for arbitrage
   */
  public static async analyzeCustomOdds(
    oddsData: BookmakerOdd[],
    totalStake: number = 1000,
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
