import { Page } from 'playwright';
import { BookmakerOdd, SportType, MarketType } from '../../domain/types/surebet.types.js';

export interface SportsMarketOdd {
  marketId: string;
  marketName: string;
  sport: SportType;
  selection: string;
  eventName?: string;
  oddValue: number;
  formattedOdd: string;
  bookmaker?: string;
  strategyUsed: 'stable_attribute' | 'semantic_aria' | 'structured_price_class' | 'text_pattern_fallback';
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
      combined.includes('tenis-de-mesa') ||
      combined.includes('/tabl/') ||
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
      // Fall through to Strategy 2.5
    }

    // Strategy 2.5: Structured price-class (span.price.dec) — sitios que renderizan
    // cuotas en spans con clase price.dec / price.frac / price.us (p.ej. Wplay y similares)
    try {
      const structuredMatches = await page.$$eval(
        'button',
        (elements, { bookmakerName, sportCategory }) => {
          const matches: Array<{
            marketId: string;
            marketName: string;
            sport: any;
            selection: string;
            eventName?: string;
            oddValue: number;
            formattedOdd: string;
            bookmaker: string;
            strategyUsed: 'structured_price_class';
          }> = [];

          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            const decEl = el.querySelector('span.price.dec');
            if (!decEl) continue;
            const oddRaw = decEl.textContent ? decEl.textContent.trim() : '';
            const oddValue = parseFloat(oddRaw.replace(',', '.'));
            if (isNaN(oddValue) || oddValue <= 1.0) continue;

            // Detección estructural de empate en Wplay:
            const isDrawBtn =
              !!el.querySelector('.seln-draw-label') ||
              el.classList.contains('seln-draw') ||
              /^(empate|draw|x)$/i.test((el.getAttribute('title') || '').trim());
            let selection = isDrawBtn ? 'Empate' : '';

            if (!selection) {
              // Selección: primer <span> del botón sin clase "price" que NO contenga spans de precio
              const allLabelSpans = el.querySelectorAll('span:not([class*="price"])');
              let labelEl = null;
              for (let k = 0; k < allLabelSpans.length; k++) {
                const s = allLabelSpans[k];
                const hasPriceDescendant = s.querySelector('[class*="price"]');
                const t = s.textContent ? s.textContent.trim() : '';
                if (!hasPriceDescendant && t.length > 0 && /[a-zA-ZÀ-ÿ]/.test(t)) {
                  labelEl = s;
                  break;
                }
              }
              selection = labelEl && labelEl.textContent ? labelEl.textContent.trim() : '';
              if (!selection) selection = el.getAttribute('title') ? (el.getAttribute('title') || '').trim() : `Option-${matches.length + 1}`;
            }

            // marketName: intentar inferir de data-market-name en el DOM; si no, genérico
            const closestMarket = el.closest('[data-market-name]');
            const marketName = closestMarket ? (closestMarket.getAttribute('data-market-name') || 'Match Winner') : 'Match Winner';

            // eventName: resolución robusta y local para evitar capturar partidos de cabecera
            let rawEventName = '';

            // 1) Si el botón tiene clase ev-(\d+), buscar el link correspondiente a ese ID específico
            const evClassMatch = el.className ? el.className.match(/\bev-(\d+)\b/) : null;
            const specificEvId = evClassMatch ? evClassMatch[1] : null;
            if (specificEvId) {
              const specificLink = document.querySelector(`a[href*="/es/e/${specificEvId}/"]`);
              if (specificLink) {
                const href = specificLink.getAttribute('href') || '';
                const parts = href.split('/').filter(Boolean);
                let slug = parts[parts.length - 1] || '';
                try { slug = decodeURIComponent(slug); } catch {}
                let name = slug.replace(/-v-/g, ' vs ').replace(/-/g, ' ');
                name = name.replace(/\s+/g, ' ').trim();
                name = name.replace(/\s+v\s+/g, ' vs ');
                if (name.length > 3 && /[a-zA-Z]/.test(name)) rawEventName = name;
              }
            }

            // 2) Live/inplay: h6 dentro de .expander
            if (!rawEventName) {
              const expander = el.closest('.expander');
              if (expander) {
                const h6 = expander.querySelector('h6');
                if (h6) rawEventName = (h6.getAttribute('title') || h6.textContent || '').trim();
              }
            }

            // 3) Contenedor local del evento (máximo nivel de fila: .ev, [data-ev_id], .event-row, .mkt, tr)
            // IMPORTANTE: acotado a este contenedor local para no subir al header global de la página
            const eventContainer = el.closest('.ev, [data-ev_id], .event-row, .mkt, tr');
            if (!rawEventName && eventContainer) {
              const evEl = eventContainer.querySelector('span.ev-name');
              if (evEl && evEl.textContent && evEl.textContent.trim().length > 3) {
                rawEventName = evEl.textContent.trim();
              }
              if (!rawEventName) {
                const h6b = eventContainer.querySelector('h6');
                if (h6b) rawEventName = (h6b.getAttribute('title') || h6b.textContent || '').trim();
              }
              if (!rawEventName) {
                const a = eventContainer.querySelector('a[href*="/es/e/"]');
                if (a) {
                  const href = a.getAttribute('href') || '';
                  const parts = href.split('/').filter(Boolean);
                  let slug = parts[parts.length - 1] || '';
                  try { slug = decodeURIComponent(slug); } catch {}
                  let name = slug.replace(/-v-/g, ' vs ').replace(/-/g, ' ');
                  name = name.replace(/\s+/g, ' ').trim();
                  name = name.replace(/\s+v\s+/g, ' vs ');
                  if (name.length > 3 && /[a-zA-Z]/.test(name)) rawEventName = name;
                }
              }
            }

            if (!rawEventName) {
              const fb = el.closest('[data-ev_id], .ev');
              if (fb) rawEventName = (fb.getAttribute('title') || '').trim();
            }
            const eventName = rawEventName ? rawEventName.replace(/\s+v\s+/g, ' vs ') : undefined;

            matches.push({
              marketId: `structured-${matches.length + 1}`,
              marketName,
              sport: sportCategory,
              selection,
              eventName,
              oddValue,
              formattedOdd: oddValue.toFixed(2),
              bookmaker: bookmakerName,
              strategyUsed: 'structured_price_class',
            });
          }
          return matches;
        },
        { bookmakerName: defaultBookmaker, sportCategory: pageSport }
      );

      if (structuredMatches.length > 0) {
        return {
          success: true,
          data: structuredMatches,
          itemsCount: structuredMatches.length,
          strategyApplied: 'structured_price_class (span.price.dec)',
          domStructureChanged: false,
        };
      }
    } catch (e) {
      console.warn('[structured_price_class] failed:', (e as Error)?.message);
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
    const fallbackEventName = title.replace(/[-|].*$/, '').trim() || 'Evento Deportivo';
    const sport = this.classifySport(title, pageUrl);
    const result = await this.extractSportsOdds(page, defaultBookmaker);
    if (!result.data || result.data.length === 0) return [];

    // Identificar eventos que tienen opción de empate (inequívocamente fútbol)
    const eventsWithDraw = new Set<string>();
    for (const item of result.data) {
      const sel = (item.selection || '').toLowerCase().trim();
      if (sel.includes('empate') || sel === 'x' || sel === 'draw') {
        if (item.eventName) eventsWithDraw.add(item.eventName);
      }
    }

    return result.data.map((item) => {
      const isFootballByDraw = item.eventName ? eventsWithDraw.has(item.eventName) : false;
      const effectiveSport: SportType = isFootballByDraw ? 'football' : sport;
      let marketType: MarketType = '1X2';

      if (item.marketName.includes('Over') || item.marketName.includes('Under')) {
        marketType = 'OVER_UNDER_2_5';
      } else if (effectiveSport === 'tennis' || effectiveSport === 'basketball' || effectiveSport === 'table_tennis') {
        marketType = 'MONEYLINE_2WAY';
      }

      return {
        bookmaker: item.bookmaker || defaultBookmaker,
        eventName: item.eventName || fallbackEventName,
        sport: effectiveSport,
        marketType,
        selection: item.selection,
        odd: item.oddValue,
        timestamp: new Date().toISOString(),
      };
    });
  }
}
