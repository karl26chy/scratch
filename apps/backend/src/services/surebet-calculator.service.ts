import {
  BookmakerOdd,
  SurebetOpportunity,
  SurebetOutcome,
  AnalyzeSurebetsResponseDto,
  MarketType,
  SportType,
} from '../domain/types/surebet.types.js';
import { OddsPersistenceService } from './odds-persistence.service.js';
import { distance } from 'fastest-levenshtein';

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
   * TTL: filtra odds con más de 2 minutos para no mezclar obsoletas
   */
  public addScrapedOdds(odds: BookmakerOdd[]): void {
    if (!odds || odds.length === 0) return;
    const now = Date.now();
    const twoMin = 2 * 60 * 1000;
    // Filtrar existentes >2min y nuevos con timestamp
    const freshExisting = this.liveOddsStore.filter((o) => {
      if (!o.timestamp) return true;
      return now - new Date(o.timestamp).getTime() < twoMin;
    });
    this.liveOddsStore = [...odds, ...freshExisting].slice(0, 500); // retain latest 500 fresh
    console.log(`📊 [Surebet] addScrapedOdds: +${odds.length} => total ${this.liveOddsStore.length} (filtro 2min, antes ${freshExisting.length + odds.length})`);
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
    totalStake: number = 1000000, // COP
    minProfitMargin: number = 0
  ): AnalyzeSurebetsResponseDto {
    // TTL: ignorar odds con más de 60 minutos para análisis. El scraping es manual
    // (botón "Scrapear Todas las Casas" o los módulos dedicados), no continuo, así
    // que una ventana de 5 minutos descartaba casi siempre el último scrape para
    // cuando el usuario llegaba a revisar el feed de oportunidades.
    const ttlMs = 60 * 60 * 1000;
    const now = Date.now();
    const freshOdds = odds.filter((o) => {
      if (!o.timestamp) return true;
      return now - new Date(o.timestamp).getTime() < ttlMs;
    });
    odds = freshOdds;
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

    // 1. Group odds by eventName (normalizado entre casas) y marketType usando fuzzy matching.
    // Cada casa nombra el mismo partido distinto (acentos, sufijos de club como
    // "FC"/"AFC", abreviaciones — ej. "Real Ma." vs "Real Madrid"). Un match exacto
    // casi nunca cruza dos casas para el mismo partido real.
    // Solución: Levenshtein similarity >= 0.80 entre las partes normalizadas del evento.
    // La key incluye sport para que partidos distintos (fútbol vs basketball) no colisionen.
    const eventMarketMap = new Map<string, { originalName: string; odds: BookmakerOdd[] }>();

    for (const odd of odds) {
      if (!odd.odd || isNaN(odd.odd) || odd.odd <= 1.0) continue;

      const newEventPart = this.normalizeEventKey(odd.eventName);
      const newMarketPart = odd.marketType;
      const newSportPart = odd.sport || 'football';
      const newKey = `${newEventPart}:::${newMarketPart}:::${newSportPart}`;

      // O(n·m): buscar un grupo existente con mismo marketType+sport cuyo
      // nombre normalizado sea difusamente similar al del odd actual.
      let foundKey: string | null = null;
      for (const [existingKey] of eventMarketMap) {
        const [existingEventPart, existingMarketPart, existingSportPart] = existingKey.split(':::');
        if (existingMarketPart !== newMarketPart) continue;
        if (existingSportPart !== newSportPart) continue;
        const areSimilar =
          newSportPart === 'table_tennis'
            ? this.tableTennisEventsMatch(newEventPart, existingEventPart)
            : this.eventNamesAreSimilar(newEventPart, existingEventPart);
        if (areSimilar) {
          foundKey = existingKey;
          break;
        }
      }

      if (foundKey) {
        eventMarketMap.get(foundKey)!.odds.push(odd);
      } else {
        // originalName: nombre humano del PRIMER odd del grupo.
        // Es lo que el usuario verá al final (nunca la clave interna con '|').
        eventMarketMap.set(newKey, { originalName: odd.eventName, odds: [odd] });
      }
    }

    const opportunities: SurebetOpportunity[] = [];

    // 2. Process each event market to find optimal cross-bookmaker combinations
    for (const [key, { originalName, odds: groupOdds }] of eventMarketMap.entries()) {
      // Key tiene 3 partes: eventPart:::marketType:::sport
      const keyParts = key.split(':::');
      const marketType = keyParts[1] as MarketType;
      const sport = (keyParts[2] as SportType) || groupOdds[0]?.sport || 'football';

      const opportunity = this.calculateOpportunityForMarket(
        groupOdds,
        originalName,
        marketType,
        sport,
        totalStake
      );

      if (opportunity && (minProfitMargin < 0 || opportunity.isSurebet) && opportunity.profitMarginPercentage >= minProfitMargin) {
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
      const normalizedSel = this.resolveSelectionLabel(odd);
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

    // Condition of Arbitrage: TIP < 1.0 (or TIP < 100%) and at least 2 distinct bookmakers
    const distinctBookmakers = new Set(selectedBestOdds.map((o) => o.bookmaker.trim().toLowerCase())).size;
    if (distinctBookmakers < 2) {
      return null;
    }
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
   * Ahora incluye persistencia (wplay + stake) para combinar ambas vistas
   */
  public getLiveOpportunities(totalStake = 1000000): SurebetOpportunity[] { // COP
    const persisted = OddsPersistenceService.getInstance().getAllOdds();
    const combined = [...persisted, ...this.liveOddsStore];
    // Deduplicar por bookmaker+event+selection
    const seen = new Set<string>();
    const deduped: BookmakerOdd[] = [];
    for (const o of combined) {
      const key = `${o.bookmaker}:${o.eventName}:${o.selection}:${o.marketType}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(o);
      }
    }
    if (deduped.length === 0) {
      return [];
    }
    const result = this.analyzeOdds(deduped, totalStake);
    return result.opportunities;
  }

  public getPersistedStats(): { wplay: number; stake: number; betplay: number; total: number; timestamp: string; live: number; byBookmaker: Record<string, number> } {
    const stats = OddsPersistenceService.getInstance().getStats();
    return { ...stats, live: this.liveOddsStore.length };
  }

  public getAllPersistedOdds(): BookmakerOdd[] {
    return OddsPersistenceService.getInstance().getAllOdds();
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

  /**
   * Compara dos claves de evento normalizadas (salida de normalizeEventKey, con '|')
   * usando similitud de Levenshtein. Threshold 0.80: captura abreviaciones comunes
   * ("Real Ma." ≈ "Real Madrid") sin colapsar equipos distintos.
   *
   * Si la clave tiene dos partes ("local|visitante"), compara home con home
   * y away con away POR SEPARADO para no confundir equipos entre sí.
   */
  private eventNamesAreSimilar(a: string, b: string, threshold = 0.80): boolean {
    if (a === b) return true;
    const partsA = a.split('|');
    const partsB = b.split('|');
    if (partsA.length === 2 && partsB.length === 2) {
      const simHome = this.levenshteinSimilarity(partsA[0], partsB[0]);
      const simAway = this.levenshteinSimilarity(partsA[1], partsB[1]);
      return simHome >= threshold && simAway >= threshold;
    }
    return this.levenshteinSimilarity(a, b) >= threshold;
  }

  private levenshteinSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - distance(s1, s2) / maxLen;
  }

  /**
   * Emparejamiento especializado para Tenis de Mesa:
   * Maneja el caso de casas que publican 'Apellido Inicial.' (ej. Stake: 'Urbaniec R.')
   * frente a casas que publican 'Nombre Apellido' (ej. BetPlay: 'Radim Urbaniec').
   */
  private tableTennisPlayersMatch(p1: string, p2: string): boolean {
    if (p1 === p2) return true;
    if (this.levenshteinSimilarity(p1, p2) >= 0.80) return true;

    const tokens1 = p1.toLowerCase().split(/\s+/).filter(Boolean);
    const tokens2 = p2.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens1.length === 0 || tokens2.length === 0) return false;

    // Identificar el apellido como el token más largo (ej. 'urbaniec' vs 'r'/'radim')
    const surname1 = tokens1.reduce((a, b) => (b.length > a.length ? b : a), '');
    const surname2 = tokens2.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (this.levenshteinSimilarity(surname1, surname2) < 0.85) return false;

    const rem1 = tokens1.filter((t) => t !== surname1);
    const rem2 = tokens2.filter((t) => t !== surname2);
    if (rem1.length === 0 || rem2.length === 0) return true;

    // Verificar si la inicial de uno es prefijo del nombre de pila del otro
    for (const r1 of rem1) {
      for (const r2 of rem2) {
        if (r1.startsWith(r2) || r2.startsWith(r1)) return true;
      }
    }
    return false;
  }

  private tableTennisEventsMatch(ev1: string, ev2: string): boolean {
    const parts1 = ev1.split('|');
    const parts2 = ev2.split('|');
    if (parts1.length !== 2 || parts2.length !== 2) {
      return this.levenshteinSimilarity(ev1, ev2) >= 0.80;
    }
    // Mantener estricto el orden Home vs Home y Away vs Away
    return (
      this.tableTennisPlayersMatch(parts1[0], parts2[0]) &&
      this.tableTennisPlayersMatch(parts1[1], parts2[1])
    );
  }

  /**
   * Normaliza un nombre de equipo para poder comparar el mismo partido real entre
   * casas de apuestas que lo nombran distinto: quita acentos, pasa a minúsculas
   * y elimina sufijos de tipo de club (FC, CF, SC, AFC, CD, SD, UD, AC, "Club")
   * que unas casas incluyen y otras no (ej. "Preston Lions" vs "Preston Lions FC").
   */
  private normalizeTeamName(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\b(fc|cf|sc|afc|cd|sd|ud|ac|club)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Clave de agrupación robusta para un evento: separa "Local vs Visitante" y
   * normaliza cada equipo (acentos, sufijos de club).
   *
   * IMPORTANTE: el orden local/visitante SÍ importa y NO se debe ignorar
   * (nada de ordenar alfabéticamente para "que dé igual el orden"). Se probó
   * y rompía en la práctica: partidos de eSports (mismos dos jugadores/clubes
   * jugando ida y vuelta, ej. "Lecce (Voron) vs Napoli (palkan)" seguido de
   * "Napoli (palkan) vs Lecce (Voron)") son partidos DISTINTOS con resultados
   * y cuotas propias — fusionarlos por tener los mismos dos nombres en cualquier
   * orden generaba "surebets" completamente falsos (cuotas de dos eventos
   * reales distintos combinadas como si fueran el mismo mercado).
   */
  private normalizeEventKey(eventName: string): string {
    const parts = eventName
      .split(/\s+vs\.?\s+|\s+v\s+/i)
      .map((p) => this.normalizeTeamName(p))
      .filter(Boolean);
    if (parts.length !== 2) return this.normalizeTeamName(eventName);
    return parts.join('|');
  }

  /**
   * Resuelve la selección de un odd a '1' | 'X' | '2' | 'OVER' | 'UNDER' | 'YES' | 'NO'.
   *
   * IMPORTANTE: ningún adapter de esta app guarda la selección de 1X2 como literal
   * "1"/"HOME"/"2"/"AWAY" — todos guardan el NOMBRE REAL del equipo (ej. selection:
   * "Real Madrid"), como hace un humano leyendo la casa de apuestas. Por eso hay que
   * comparar la selección contra el local/visitante del PROPIO evento de ese odd
   * (no contra un patrón fijo), o el mercado 1X2 nunca produce coincidencias — que
   * era la causa real de que el feed de oportunidades nunca detectara nada.
   */
  private resolveSelectionLabel(odd: BookmakerOdd): string {
    const raw = odd.selection || '';
    const upper = raw.trim().toUpperCase();
    if (upper === 'X' || upper === 'DRAW' || upper === 'EMPATE') return 'X';
    if (upper.includes('OVER') || upper.includes('MÁS') || upper.includes('MAS')) return 'OVER';
    if (upper.includes('UNDER') || upper.includes('MENOS')) return 'UNDER';
    if (upper === 'YES' || upper === 'SI' || upper === 'SÍ') return 'YES';
    if (upper === 'NO') return 'NO';
    if (upper === '1' || upper === 'HOME' || upper === 'LOCAL' || upper === 'TEAM1') return '1';
    if (upper === '2' || upper === 'AWAY' || upper === 'VISITANTE' || upper === 'TEAM2') return '2';

    // Fallback: comparar el nombre de la selección contra el local/visitante
    // del propio eventName de este odd (cada odd trae su propio "Local vs Visitante").
    const parts = (odd.eventName || '').split(/\s+vs\.?\s+|\s+v\s+/i);
    if (parts.length === 2) {
      const home = this.normalizeTeamName(parts[0]);
      const away = this.normalizeTeamName(parts[1]);
      const sel = this.normalizeTeamName(raw);
      if (sel && home && sel === home) return '1';
      if (sel && away && sel === away) return '2';
    }
    return upper;
  }

  private formatEventTitle(title: string): string {
    return title
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }
}
