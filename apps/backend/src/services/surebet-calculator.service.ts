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
  /** Una cuota por encima de esta proporción de la mediana (3+ casas) se considera un valor atípico. */
  private static readonly MAX_ODD_OVER_MEDIAN = 1.5;
  /** Antigüedad máxima (desde el scraping) de una cuota prepartido. Más vieja se ignora en el cálculo. */
  public static readonly ODDS_TTL_MS = 20 * 60 * 1000;
  /** Antigüedad máxima de una cuota en vivo: cambian en segundos. */
  public static readonly LIVE_ODDS_TTL_MS = 3 * 60 * 1000;
  /** Tolerancia entre horas de inicio para considerar que dos cuotas son del MISMO partido. */
  private static readonly MAX_START_DIFF_MS = 45 * 60 * 1000;
  /** Tenis: la hora publicada es un "no antes de" que Bwin y Stake desplazan hasta ~2 h respecto a las demás casas. */
  private static readonly MAX_START_DIFF_TENNIS_MS = 90 * 60 * 1000;
  /** Diferencia máxima de hora para aceptar un emparejamiento por nombre aproximado (ver relaxedSameMatch). */
  private static readonly RELAXED_START_DIFF_MS = 15 * 60 * 1000;
  /** Diferencia máxima de antigüedad entre las patas de un surebet prepartido. */
  private static readonly MAX_LEG_SKEW_MS = 10 * 60 * 1000;
  /** ...y cuando alguna pata es en vivo. */
  private static readonly MAX_LIVE_LEG_SKEW_MS = 2 * 60 * 1000;

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
    // Vigencia: el scraping es manual (Scraping Global), no continuo. Se ignoran las cuotas demasiado viejas
    // según su tipo (prepartido / en vivo) y las prepartido cuyo partido ya empezó.
    const now = Date.now();
    odds = odds.filter((o) => this.isOddCurrent(o, now));
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
    // Un grupo = un partido + mercado + deporte. Índices para no recorrer todos los grupos por cada cuota
    // (antes O(cuotas × grupos) con split + Levenshtein):
    //  - groupsBySlot: grupos separados por mercado+deporte (solo se comparan grupos comparables).
    //  - groupsByName: búsqueda directa por nombre normalizado exacto.
    // Semántica: gana el PRIMER grupo (en orden de creación) con nombre similar Y hora de inicio compatible.
    // La hora evita mezclar revanchas del mismo día entre los mismos rivales (habitual en tenis de mesa): dos
    // cuotas con hora conocida y más de MAX_START_DIFF_MS de diferencia son partidos distintos. Si alguna de las
    // dos no trae hora (p. ej. Wplay en vivo), se compara solo por nombre, como antes.
    interface MatchGroup {
      eventPart: string;
      marketType: MarketType;
      sport: SportType;
      originalName: string;
      start: number | null;
      odds: BookmakerOdd[];
      /** casa -> nombre con el que esa casa lista este partido (una casa no lista el mismo partido con dos nombres). */
      houseNames: Map<string, string>;
    }
    const groups: MatchGroup[] = [];
    const groupsBySlot = new Map<string, MatchGroup[]>();
    const groupsByName = new Map<string, MatchGroup[]>();
    const startsCompatible = (a: number | null, b: number | null, sport: SportType): boolean =>
      a === null ||
      b === null ||
      Math.abs(a - b) <=
        (sport === 'tennis' ? SurebetCalculatorService.MAX_START_DIFF_TENNIS_MS : SurebetCalculatorService.MAX_START_DIFF_MS);

    for (const odd of odds) {
      if (!odd.odd || isNaN(odd.odd) || odd.odd <= 1.0) continue;

      const eventPart = this.normalizeEventKey(odd.eventName);
      const marketType = odd.marketType;
      const sport = (odd.sport || 'football') as SportType;
      const slotKey = `${marketType}:::${sport}`;
      const nameKey = `${slotKey}:::${eventPart}`;
      const houseKey = odd.bookmaker.trim().toLowerCase();
      const parsedStart = odd.startTime ? new Date(odd.startTime).getTime() : NaN;
      const start = isNaN(parsedStart) ? null : parsedStart;

      let group: MatchGroup | undefined = groupsByName.get(nameKey)?.find((g) => startsCompatible(g.start, start, sport));
      if (!group) {
        // Las coincidencias estrictas ganan de inmediato. Las aproximadas (fútbol: traducciones y sufijos de club;
        // tenis: iniciales y dobles) solo se aceptan si hay UN único candidato: con dos es ambiguo y no se fusiona.
        const loose: MatchGroup[] = [];
        for (const candidate of groupsBySlot.get(slotKey) || []) {
          if (!startsCompatible(candidate.start, start, sport)) continue;
          const strict =
            sport === 'table_tennis'
              ? this.tableTennisEventsMatch(eventPart, candidate.eventPart)
              : this.eventNamesAreSimilar(eventPart, candidate.eventPart);
          if (strict) {
            group = candidate;
            break;
          }
          // Una casa nunca lista el mismo partido con dos nombres: si el candidato ya trae OTRO evento de esta casa,
          // no puede ser el mismo partido (evita fusionar, p. ej., dos partidos "(U-21)" de la misma casa).
          const sameHouseName = candidate.houseNames.get(houseKey);
          if (sameHouseName !== undefined && sameHouseName !== odd.eventName) continue;
          if (
            (sport === 'tennis' && this.tennisEventsMatch(odd.eventName, candidate.originalName)) ||
            this.relaxedSameMatch(sport, eventPart, candidate.eventPart, start, candidate.start)
          ) {
            loose.push(candidate);
          }
        }
        if (!group && loose.length === 1) group = loose[0];
      }

      if (group) {
        group.odds.push(odd);
        if (!group.houseNames.has(houseKey)) group.houseNames.set(houseKey, odd.eventName);
        if (group.start === null && start !== null) group.start = start;
        // Registrar también este nombre: las demás cuotas con el mismo nombre exacto (p. ej. Rushbet y BetPlay, mismo
        // proveedor) deben ir directo a este grupo y no re-evaluarse como candidatas aproximadas.
        const named = groupsByName.get(nameKey);
        if (!named) groupsByName.set(nameKey, [group]);
        else if (!named.includes(group)) named.push(group);
      } else {
        // originalName: nombre humano del PRIMER odd del grupo (es lo que verá el usuario, nunca la clave interna).
        const created: MatchGroup = { eventPart, marketType, sport, originalName: odd.eventName, start, odds: [odd], houseNames: new Map([[houseKey, odd.eventName]]) };
        groups.push(created);
        const slot = groupsBySlot.get(slotKey);
        if (slot) slot.push(created);
        else groupsBySlot.set(slotKey, [created]);
        const named = groupsByName.get(nameKey);
        if (named) named.push(created);
        else groupsByName.set(nameKey, [created]);
      }
    }

    const opportunities: SurebetOpportunity[] = [];

    // 2. Process each event market to find optimal cross-bookmaker combinations
    for (const group of groups) {
      const opportunity = this.calculateOpportunityForMarket(
        group.odds,
        group.originalName,
        group.marketType,
        group.sport,
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
      analyzedEventsCount: groups.length,
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

    // Cuotas por selección y por casa.
    const oddsBySelection = new Map<string, Map<string, BookmakerOdd[]>>();
    for (const odd of odds) {
      const normalizedSel = this.resolveSelectionLabel(odd);
      if (!requiredSelections.includes(normalizedSel)) continue;
      const house = odd.bookmaker.trim().toLowerCase();
      let byHouse = oddsBySelection.get(normalizedSel);
      if (!byHouse) oddsBySelection.set(normalizedSel, (byHouse = new Map()));
      const list = byHouse.get(house);
      if (list) list.push({ ...odd, selection: normalizedSel });
      else byHouse.set(house, [{ ...odd, selection: normalizedSel }]);
    }

    // Mejor cuota por selección, con dos defensas contra datos contaminados (falsos surebets):
    //  1) Contradicción: si una casa trae cuotas DISTINTAS para la misma selección del mismo partido, es que
    //     se mezclaron mercados (hándicap, sets, totales...) y no se sabe cuál es el principal → se descarta esa casa.
    //  2) Consenso: con 3+ casas, una cuota más de MAX_ODD_OVER_MEDIAN veces la mediana es casi seguro de otro
    //     mercado, de un partido distinto o desactualizada → se descarta. (Tope holgado: entre casas reales hay
    //     diferencias de hasta ~30 % en ligas de poca liquidez, como el tenis de mesa.)
    const bestOddsPerSelection = new Map<string, BookmakerOdd>();
    for (const [sel, byHouse] of oddsBySelection) {
      const consistent: BookmakerOdd[] = [];
      for (const list of byHouse.values()) {
        if (new Set(list.map((o) => o.odd)).size > 1) continue; // regla 1
        consistent.push(list[0]);
      }
      let candidates = consistent;
      if (consistent.length >= 3) {
        const sorted = consistent.map((o) => o.odd).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        candidates = consistent.filter((o) => o.odd <= median * SurebetCalculatorService.MAX_ODD_OVER_MEDIAN); // regla 2
      }
      for (const o of candidates) {
        const currentBest = bestOddsPerSelection.get(sel);
        if (!currentBest || o.odd > currentBest.odd) bestOddsPerSelection.set(sel, o);
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

    // 3) Frescura: las cuotas de un surebet deben ser de momentos cercanos; combinar una cuota de hace 40 min
    //    con otra de hace 1 min (sobre todo en vivo) genera arbitrajes que ya no existen.
    const stamps = selectedBestOdds.map((o) => (o.timestamp ? new Date(o.timestamp).getTime() : NaN)).filter((t) => !isNaN(t));
    const maxSkew = selectedBestOdds.some((o) => o.isLive)
      ? SurebetCalculatorService.MAX_LIVE_LEG_SKEW_MS
      : SurebetCalculatorService.MAX_LEG_SKEW_MS;
    if (stamps.length === selectedBestOdds.length && Math.max(...stamps) - Math.min(...stamps) > maxSkew) {
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
      ...(selectedBestOdds.some((o) => o.isLive) ? { isLive: true } : {}),
    };
  }

  /**
   * Return live calculated opportunities from real scraped data (starts empty [] if no data scraped yet)
   * Ahora incluye persistencia (wplay + stake) para combinar ambas vistas
   */
  public getLiveOpportunities(totalStake = 1000000): SurebetOpportunity[] { // COP
    // Solo las cuotas del último Scraping Global (no las de scrapers sueltos de cada módulo ni el store en memoria).
    const combined = OddsPersistenceService.getInstance().getAllOdds('global');
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

  public getPersistedStats(): { wplay: number; stake: number; betplay: number; bwin: number; rushbet: number; betsson: number; total: number; timestamp: string; live: number; byBookmaker: Record<string, number> } {
    const stats = OddsPersistenceService.getInstance().getStats('global');
    return { ...stats, live: this.liveOddsStore.length };
  }

  public getAllPersistedOdds(): BookmakerOdd[] {
    return OddsPersistenceService.getInstance().getAllOdds('global');
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
      return (
        this.similarAtLeast(partsA[0], partsB[0], threshold) && this.similarAtLeast(partsA[1], partsB[1], threshold)
      );
    }
    return this.similarAtLeast(a, b, threshold);
  }

  /**
   * levenshteinSimilarity(s1, s2) >= threshold, descartando sin calcular la distancia cuando la diferencia de
   * longitud ya lo hace imposible (distance >= |len1 - len2|, así que similitud <= 1 - |Δlen| / maxLen).
   */
  private similarAtLeast(s1: string, s2: string, threshold: number): boolean {
    if (s1 === s2) return true;
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return true;
    if (1 - Math.abs(s1.length - s2.length) / maxLen < threshold) return false;
    return this.levenshteinSimilarity(s1, s2) >= threshold;
  }

  private levenshteinSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1.0;
    return 1.0 - distance(s1, s2) / maxLen;
  }

  /** Vigente = dentro del TTL de su tipo y, si es prepartido, con el partido aún sin empezar. */
  private isOddCurrent(o: BookmakerOdd, now: number): boolean {
    if (o.timestamp) {
      const age = now - new Date(o.timestamp).getTime();
      const ttl = o.isLive ? SurebetCalculatorService.LIVE_ODDS_TTL_MS : SurebetCalculatorService.ODDS_TTL_MS;
      if (!(age < ttl)) return false;
    }
    if (!o.isLive && o.startTime) {
      const start = new Date(o.startTime).getTime();
      if (!isNaN(start) && start <= now) return false;
    }
    return true;
  }

  /**
   * Fútbol: acepta nombres aproximados (>= 0.60 por lado, en vez de 0.80) SOLO si las dos horas de inicio son
   * conocidas y están a <= 15 min. Cubre traducciones y sufijos ("Napoli"/"Nápoles", "Querétaro F.C."/"Querétaro").
   * La hora casi idéntica es la garantía; el llamador además exige que el candidato sea único.
   */
  private relaxedSameMatch(sport: SportType, keyA: string, keyB: string, startA: number | null, startB: number | null): boolean {
    if (sport !== 'football') return false;
    if (startA === null || startB === null || Math.abs(startA - startB) > SurebetCalculatorService.RELAXED_START_DIFF_MS) return false;
    const a = keyA.split('|');
    const b = keyB.split('|');
    if (a.length !== 2 || b.length !== 2) return false;
    return this.relaxedSideMatches(a[0], b[0]) && this.relaxedSideMatches(a[1], b[1]);
  }

  /**
   * Compara el nombre SIN sufijos de categoría (si no, "Estonia (U-21)" y "Eslovaquia (U-21)" se parecen por el sufijo).
   * La categoría de edad y la de reserva ("II", "B") deben coincidir; la de mujeres puede faltar en una casa.
   */
  private relaxedSideMatches(sideA: string, sideB: string): boolean {
    const a = this.splitQualifiers(sideA);
    const b = this.splitQualifiers(sideB);
    if (a.quals !== b.quals || a.core.length < 4 || b.core.length < 4) return false;
    return this.similarAtLeast(a.core, b.core, 0.6);
  }

  private splitQualifiers(side: string): { core: string; quals: string } {
    const tokens = side.split(' ').filter(Boolean);
    const quals: string[] = [];
    const core: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if ((t === 'u' || t === 'sub') && /^\d{2}$/.test(tokens[i + 1] || '')) {
        quals.push('u' + tokens[++i]);
      } else if (t === 'ii' || t === 'b') {
        quals.push('reserva');
      } else if (t !== 'f' && t !== 'fem' && t !== 'femenino' && t !== 'women' && t !== 'w') {
        core.push(t);
      }
    }
    return { core: core.join(' '), quals: quals.sort().join(',') };
  }

  /**
   * Tenis (individuales y dobles): las casas escriben "Bayldon B / Fancutt T", "B. Bayldon/T. Fancutt" o "A Kubareva" /
   * "Anna Kubareva", y en dobles a veces cambian el orden de la pareja. Se compara jugador a jugador (local con local,
   * visitante con visitante). Un jugador coincide si su apellido (token más largo) es casi igual y los demás tokens
   * son compatibles como iniciales.
   */
  private tennisEventsMatch(rawA: string, rawB: string): boolean {
    const a = this.splitEventName(rawA);
    const b = this.splitEventName(rawB);
    if (a.length !== 2 || b.length !== 2) return false;
    return this.tennisSideMatches(a[0], b[0]) && this.tennisSideMatches(a[1], b[1]);
  }

  private tennisSideMatches(sideA: string, sideB: string): boolean {
    const pa = sideA.split('/').map((p) => p.trim()).filter(Boolean);
    const pb = sideB.split('/').map((p) => p.trim()).filter(Boolean);
    if (pa.length === 0 || pa.length !== pb.length || pa.length > 2) return false;
    if (pa.length === 1) return this.tennisPlayersMatch(pa[0], pb[0]);
    return (
      (this.tennisPlayersMatch(pa[0], pb[0]) && this.tennisPlayersMatch(pa[1], pb[1])) ||
      (this.tennisPlayersMatch(pa[0], pb[1]) && this.tennisPlayersMatch(pa[1], pb[0]))
    );
  }

  private tennisPlayersMatch(p1: string, p2: string): boolean {
    const t1 = this.normalizeTeamName(p1).split(' ').filter(Boolean);
    const t2 = this.normalizeTeamName(p2).split(' ').filter(Boolean);
    if (t1.length === 0 || t2.length === 0) return false;
    const longest = (t: string[]) => t.reduce((x, y) => (y.length > x.length ? y : x), '');
    const s1 = longest(t1);
    const s2 = longest(t2);
    if (this.levenshteinSimilarity(s1, s2) < 0.85) return false;
    const r1 = t1.filter((t) => t !== s1);
    const r2 = t2.filter((t) => t !== s2);
    if (r1.length === 0 || r2.length === 0) return true;
    return r1.some((x) => r2.some((y) => x.startsWith(y) || y.startsWith(x)));
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
  /**
   * Parte "Local vs Visitante". Todos los adapters generan " vs "; " v " solo se usa si no hay " vs ", porque
   * dentro de un nombre puede haber una "V" suelta (dobles de tenis: "Cornea V / Neuchrist M").
   */
  private splitEventName(eventName: string): string[] {
    const byVs = (eventName || '').split(/\s+vs\.?\s+/i);
    if (byVs.length === 2) return byVs;
    const byV = (eventName || '').split(/\s+v\s+/i);
    return byV.length === 2 ? byV : byVs;
  }

  private normalizeEventKey(eventName: string): string {
    const parts = this.splitEventName(eventName)
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

    // Las etiquetas Más/Menos y Sí/No solo se interpretan en su mercado y al INICIO del texto. Antes se buscaba
    // "MAS"/"OVER"/"UNDER" como subcadena en cualquier selección, y nombres como "Las Palmas", "Tomas", "Thomas",
    // "Masarova", "Rovers" o "Thunder" se tomaban por Más/Menos y el partido se descartaba.
    if (odd.marketType === 'OVER_UNDER_2_5') {
      if (/^(OVER|M[ÁA]S)(\s|$)/.test(upper)) return 'OVER';
      if (/^(UNDER|MENOS)(\s|$)/.test(upper)) return 'UNDER';
      return upper;
    }
    if (odd.marketType === 'BOTH_TEAMS_SCORE') {
      if (upper === 'YES' || upper === 'SI' || upper === 'SÍ') return 'YES';
      if (upper === 'NO') return 'NO';
      return upper;
    }

    if (upper === 'X' || upper === 'DRAW' || upper === 'EMPATE') return 'X';
    if (upper === '1' || upper === 'HOME' || upper === 'LOCAL' || upper === 'TEAM1') return '1';
    if (upper === '2' || upper === 'AWAY' || upper === 'VISITANTE' || upper === 'TEAM2') return '2';

    // Comparar el nombre de la selección contra el local/visitante del propio eventName de este odd
    // (cada odd trae su propio "Local vs Visitante").
    const parts = this.splitEventName(odd.eventName || '');
    if (parts.length === 2) {
      const home = this.normalizeTeamName(parts[0]);
      const away = this.normalizeTeamName(parts[1]);
      const sel = this.normalizeTeamName(raw);
      if (sel && home && sel === home) return '1';
      if (sel && away && sel === away) return '2';
      // Nombres que la normalización deja vacíos (un equipo llamado solo "AFC"): comparar en crudo.
      const rawSel = raw.trim().toLowerCase();
      if (rawSel && rawSel === parts[0].trim().toLowerCase()) return '1';
      if (rawSel && rawSel === parts[1].trim().toLowerCase()) return '2';
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
