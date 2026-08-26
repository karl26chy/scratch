import { Page } from 'playwright';
import { BookmakerOdd, SportType, MarketType } from '../../domain/types/surebet.types.js';

export interface SportsMarketOdd {
  marketId: string;
  marketName: string;
  sport: SportType;
  selection: string;
  oddValue: number;
  formattedOdd: string;
  bookmaker?: string;
  strategyUsed: 'stable_attribute' | 'semantic_aria' | 'text_pattern_fallback';
}

export interface ExtractionResult<T> {
  success: boolean;
  data: T | null;
  itemsCount: number;
  strategyApplied?: string;
  domStructureChanged: boolean;
  alertMessage?: string;
}

export class ResilientSelectorEngine {
  /**
   * Identifies if a market belongs to one of the 4 allowed core sports:
   * 'football' | 'tennis' | 'basketball' | 'table_tennis'
   */
  public static classifySport(text: string, url = ''): SportType {
    const combined = `${text} ${url}`.toLowerCase();

    // 1. Table Tennis / Tenis de Mesa
    if (
      combined.includes('table-tennis') ||
      combined.includes('table tennis') ||
      combined.includes('tenis de mesa') ||
      combined.includes('ping pong') ||
      combined.includes('ping-pong') ||
      combined.includes('tt-cup') ||
      combined.includes('setka cup')
    ) {
      return 'table_tennis';
    }

    // 2. Tennis
    if (
      combined.includes('tennis') ||
      combined.includes('tenis') ||
      combined.includes('atp') ||
      combined.includes('wta') ||
      combined.includes('itf') ||
      combined.includes('roland garros') ||
      combined.includes('wimbledon') ||
      combined.includes('australian open')
    ) {
      return 'tennis';
    }

    // 3. Basketball / Baloncesto
    if (
      combined.includes('basketball') ||
      combined.includes('baloncesto') ||
      combined.includes('basquet') ||
      combined.includes('nba') ||
      combined.includes('euroleague') ||
      combined.includes('acb') ||
      combined.includes('fibawc')
    ) {
      return 'basketball';
    }

    // 4. Football / Fútbol (Default)
    return 'football';
  }

  /**
   * Resilient sports odds extractor demonstrating anti-fragile multi-strategy scraping
   * Focused specifically on Football, Tennis, Basketball, and Table Tennis
   */
  public static async extractSportsOdds(page: Page, defaultBookmaker = 'UnknownBookmaker'): Promise<ExtractionResult<SportsMarketOdd[]>> {
    const pageUrl = page.url();
    const pageTitle = await page.title();
    const pageSport = this.classifySport(pageTitle, pageUrl);

    // Strategy 1: Stable Data Attributes ([data-market-id], [data-testid="odds-button"], [data-selection])
    try {
      const stableDataMatches = await page.$$eval(
        '[data-market-id]',
        (elements, { bookmakerName, sportCategory }) => {
          return elements.map((el) => {
            const marketId = el.getAttribute('data-market-id') || 'unknown-market';
            const marketName = el.getAttribute('data-market-name') || el.querySelector('header, .market-title')?.textContent?.trim() || '1X2 / Ganador';
            const selectionEl = el.querySelector('[data-selection], [data-team]');
            const selection = selectionEl?.getAttribute('data-selection') || selectionEl?.textContent?.trim() || '1';
            const oddEl = el.querySelector('[data-odd-value], [data-testid*="odd"], [data-price]');
            const oddRaw = oddEl?.getAttribute('data-odd-value') || oddEl?.textContent?.trim() || '0';
            const oddValue = parseFloat(oddRaw.replace(/[^0-9.]/g, ''));
            const bookmaker = el.getAttribute('data-bookmaker') || bookmakerName;

            return {
              marketId,
              marketName,
              sport: sportCategory as any,
              selection,
              oddValue: isNaN(oddValue) ? 0 : oddValue,
              formattedOdd: isNaN(oddValue) ? oddRaw : oddValue.toFixed(2),
              bookmaker,
              strategyUsed: 'stable_attribute' as const,
            };
          }).filter((item) => item.oddValue > 1.0);
        },
        { bookmakerName: defaultBookmaker, sportCategory: pageSport }
      );

      if (stableDataMatches.length > 0) {
        return {
          success: true,
          data: stableDataMatches,
          itemsCount: stableDataMatches.length,
          strategyApplied: 'stable_attribute ([data-market-id])',
          domStructureChanged: false,
        };
      }
    } catch {
      // Fall through to Strategy 2
    }

    // Strategy 2: Semantic ARIA and Microdata Roles
    try {
      const semanticAriaMatches = await page.$$eval(
        '[role="button"][aria-label*="."], [role="cell"]',
        (elements, { bookmakerName, sportCategory }) => {
          return elements.map((el, idx) => {
            const ariaLabel = el.getAttribute('aria-label') || el.textContent || '';
            const oddMatch = ariaLabel.match(/([0-9]+\.[0-9]{2})/);
            const oddValue = oddMatch ? parseFloat(oddMatch[1]) : 0;

            return {
              marketId: `semantic-market-${idx + 1}`,
              marketName: 'Match Winner / Odds',
              sport: sportCategory as any,
              selection: ariaLabel.split(' ')[0] || `Selection-${idx + 1}`,
              oddValue,
              formattedOdd: oddValue > 0 ? oddValue.toFixed(2) : '0.00',
              bookmaker: bookmakerName,
              strategyUsed: 'semantic_aria' as const,
            };
          }).filter((item) => item.oddValue > 1.0);
        },
        { bookmakerName: defaultBookmaker, sportCategory: pageSport }
      );

      if (semanticAriaMatches.length > 0) {
        return {
          success: true,
          data: semanticAriaMatches,
          itemsCount: semanticAriaMatches.length,
          strategyApplied: 'semantic_aria ([role="button"][aria-label])',
          domStructureChanged: false,
        };
      }
    } catch {
      // Fall through to Strategy 3
    }

    // Strategy 3: Text Contextual Heuristics (Regex on odds pattern)
    try {
      const textMatches = await page.$$eval(
        'button, span, div',
        (elements, { bookmakerName, sportCategory }) => {
          const matches: Array<{
            marketId: string;
            marketName: string;
            sport: any;
            selection: string;
            oddValue: number;
            formattedOdd: string;
            bookmaker: string;
            strategyUsed: 'text_pattern_fallback';
          }> = [];

          const oddPattern = /^[1-9][0-9]*\.[0-9]{2}$/;

          for (let i = 0; i < elements.length && matches.length < 20; i++) {
            const text = elements[i].textContent?.trim() || '';
            if (oddPattern.test(text)) {
              const val = parseFloat(text);
              if (val >= 1.01 && val <= 100.0) {
                matches.push({
                  marketId: `heuristic-${matches.length + 1}`,
                  marketName: 'Dynamic Market Heuristic',
                  sport: sportCategory,
                  selection: elements[i].previousElementSibling?.textContent?.trim() || `Option-${matches.length + 1}`,
                  oddValue: val,
                  formattedOdd: val.toFixed(2),
                  bookmaker: bookmakerName,
                  strategyUsed: 'text_pattern_fallback',
                });
              }
            }
          }
          return matches;
        },
        { bookmakerName: defaultBookmaker, sportCategory: pageSport }
      );

      if (textMatches.length > 0) {
        return {
          success: true,
          data: textMatches,
          itemsCount: textMatches.length,
          strategyApplied: 'text_pattern_fallback (Heuristic Regex)',
          domStructureChanged: false,
        };
      }
    } catch {
      // Structure missing
    }

    return {
      success: false,
      data: null,
      itemsCount: 0,
      domStructureChanged: true,
      alertMessage: 'ALERTA_DOM_ESTRUCTURAL: Los selectores estables ([data-market-id]) y los fallbacks semánticos no encontraron cuotas en el DOM.',
    };
  }

  /**
   * Structured multi-bookmaker odds extractor for arbitrage pipeline (Scoped to 4 core sports)
   */
  public static async extractBookmakerOdds(page: Page, defaultBookmaker = 'UnknownBookmaker'): Promise<BookmakerOdd[]> {
    const title = await page.title();
    const pageUrl = page.url();
    const eventName = title.replace(/[-|].*$/, '').trim() || 'Evento Deportivo';
    const sport = this.classifySport(title, pageUrl);
    const result = await this.extractSportsOdds(page, defaultBookmaker);

    if (!result.data || result.data.length === 0) return [];

    return result.data.map((item) => {
      let marketType: MarketType = '1X2';
      if (item.marketName.includes('Over') || item.marketName.includes('Under')) {
        marketType = 'OVER_UNDER_2_5';
      } else if (sport === 'tennis' || sport === 'basketball' || sport === 'table_tennis') {
        marketType = 'MONEYLINE_2WAY';
      }

      return {
        bookmaker: item.bookmaker || defaultBookmaker,
        eventName,
        sport,
        marketType,
        selection: item.selection,
        odd: item.oddValue,
        timestamp: new Date().toISOString(),
      };
    });
  }
}
