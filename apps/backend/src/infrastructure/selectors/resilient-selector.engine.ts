import { Page } from 'playwright';
import { BookmakerOdd, SportType, MarketType } from '../../domain/types/surebet.types.js';

export interface SportsMarketOdd {
  marketId: string;
  marketName: string;
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
   * Resilient sports odds extractor demonstrating anti-fragile multi-strategy scraping
   * Defeats ephemeral/hash CSS classes by relying on:
   * 1. Stable data-* attributes ([data-market-id], [data-testid], [data-bookmaker])
   * 2. Semantic ARIA roles & labels ([role="button"][aria-label*="Cuota"])
   * 3. Text contextual heuristics
   */
  public static async extractSportsOdds(page: Page, defaultBookmaker = 'UnknownBookmaker'): Promise<ExtractionResult<SportsMarketOdd[]>> {
    // Strategy 1: Stable Data Attributes ([data-market-id], [data-testid="odds-button"], [data-selection])
    try {
      const stableDataMatches = await page.$$eval('[data-market-id]', (elements, bookmakerName) => {
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
            selection,
            oddValue: isNaN(oddValue) ? 0 : oddValue,
            formattedOdd: isNaN(oddValue) ? oddRaw : oddValue.toFixed(2),
            bookmaker,
            strategyUsed: 'stable_attribute' as const,
          };
        }).filter((item) => item.oddValue > 1.0);
      }, defaultBookmaker);

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
      const semanticAriaMatches = await page.$$eval('[role="button"][aria-label*="."], [role="cell"]', (elements, bookmakerName) => {
        return elements.map((el, idx) => {
          const ariaLabel = el.getAttribute('aria-label') || el.textContent || '';
          const oddMatch = ariaLabel.match(/([0-9]+\.[0-9]{2})/);
          const oddValue = oddMatch ? parseFloat(oddMatch[1]) : 0;

          return {
            marketId: `semantic-market-${idx + 1}`,
            marketName: 'Match Winner / Odds',
            selection: ariaLabel.split(' ')[0] || `Selection-${idx + 1}`,
            oddValue,
            formattedOdd: oddValue > 0 ? oddValue.toFixed(2) : '0.00',
            bookmaker: bookmakerName,
            strategyUsed: 'semantic_aria' as const,
          };
        }).filter((item) => item.oddValue > 1.0);
      }, defaultBookmaker);

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
      const textMatches = await page.$$eval('button, span, div', (elements, bookmakerName) => {
        const matches: Array<{
          marketId: string;
          marketName: string;
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
      }, defaultBookmaker);

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
   * Structured multi-bookmaker odds extractor for arbitrage pipeline
   */
  public static async extractBookmakerOdds(page: Page, defaultBookmaker = 'UnknownBookmaker'): Promise<BookmakerOdd[]> {
    const title = await page.title();
    const eventName = title.replace(/[-|].*$/, '').trim() || 'Evento Deportivo';
    const result = await this.extractSportsOdds(page, defaultBookmaker);

    if (!result.data || result.data.length === 0) return [];

    return result.data.map((item) => ({
      bookmaker: item.bookmaker || defaultBookmaker,
      eventName,
      sport: 'football' as SportType,
      marketType: (item.marketName.includes('Over') || item.marketName.includes('Under') ? 'OVER_UNDER_2_5' : '1X2') as MarketType,
      selection: item.selection,
      odd: item.oddValue,
      timestamp: new Date().toISOString(),
    }));
  }
}
