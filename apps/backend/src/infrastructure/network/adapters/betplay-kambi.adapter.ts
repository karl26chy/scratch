import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import type { BookmakerOdd } from '../../../domain/types/surebet.types.js';
import type { CapturedPayload } from '../odds-interceptor.js';
import { fetchKambiListing } from './kambi-listing.js';

/**
 * Adapter para BetPlay (tienda.betplay.com.co) — motor Kambi (KambiBC).
 * El sportsbook de BetPlay renderiza un widget Kambi que carga las cuotas vía
 * la API pública de Kambi (us.offering-api.kambicdn.com), no vía el DOM
 * directamente.
 *
 * ESTRATEGIA PRINCIPAL — fetchDirect():
 *   La API de Kambi es completamente pública (no requiere autenticación ni cookies).
 *   Se hace un fetch() directo Node.js al endpoint sin Playwright, evitando
 *   el bloqueo por reCAPTCHA que sufre cualquier navegador headless en BetPlay.
 *
 * ESTRATEGIA FALLBACK — extract() (interceptor Playwright):
 *   Se mantiene como fallback para casos donde la API directa falle (rate-limit, etc.)
 *
 * Endpoint de la API Kambi (fútbol, todos los eventos):
 *   https://us.offering-api.kambicdn.com/offering/v2018/betplay/listView/football/all/all.json
 *     ?lang=es_ES&market=CO&client_id=2&channel_id=1&useCombined=true&useCombinedLive=true
 *
 * Estructura de la respuesta:
 *   { events: [ { event: { id, name, homeName, awayName, ... }, betOffers: [...] } ] }
 *
 * El mercado 1X2 (Resultado Final) es el betOffer con betOfferType.id === 2; Más/Menos de goles es el id 6.
 * Cada outcome trae `type` ('OT_ONE' | 'OT_CROSS' | 'OT_TWO') y `odds` como
 * entero decimal * 1000 (p.ej. 1490 -> 1.49). Los outcomes suspendidos no
 * traen el campo `odds`.
 */

const KAMBI_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': 'https://tienda.betplay.com.co/',
  'Origin': 'https://tienda.betplay.com.co',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'Cache-Control': 'no-cache',
};

function parseKambiEvents(data: any): BookmakerOdd[] {
  const odds: BookmakerOdd[] = [];
  const now = new Date().toISOString();
  const events: any[] = Array.isArray(data?.events) ? data.events : [];

  for (const item of events) {
    try {
      const ev = item?.event;
      if (!ev) continue;
      const homeTeam: string = ev.homeName || (ev.name || '').split(ev.nameDelimiter || '-')[0]?.trim() || 'Home';
      const awayTeam: string = ev.awayName || (ev.name || '').split(ev.nameDelimiter || '-')[1]?.trim() || 'Away';
      const eventName = `${homeTeam} vs ${awayTeam}`;
      const startTime: string | undefined = typeof ev.start === 'string' ? ev.start : undefined;
      const isLive = ev.state === 'STARTED';

      // Deporte: leer directamente del campo nativo de Kambi (en mayúsculas) y convertir a slug minúscula.
      // Ej: 'FOOTBALL' → 'football', 'TABLE_TENNIS' → 'table_tennis'
      // Cast a SportType — los valores de event.sport de Kambi siempre pertenecen al union type.
      const sportRaw: string = ev.sport || ev.path?.[0]?.termKey || 'FOOTBALL';
      const sport = sportRaw.toLowerCase() as 'football' | 'tennis' | 'basketball' | 'table_tennis';

      const betOffers: any[] = Array.isArray(item.betOffers) ? item.betOffers : [];
      // 1X2 = betOfferType.id 2; Total de goles (Más/Menos) = 6; Ambos Anotan = 68 (no viene en listView)
      for (const offer of betOffers) {
        if (!Array.isArray(offer?.outcomes)) continue;
        const offerTypeId: number = offer?.betOfferType?.id;

        if (offerTypeId === 2) {
          // Mercado principal: detectar estructuralmente si hay empate (1X2) o no (MONEYLINE_2WAY).
          // OT_CROSS es el tipo oficial de Kambi para el empate — criterio estructural puro,
          // sin regex de texto. Si no existe OT_CROSS en el offer, el deporte no tiene empate
          // (tenis, baloncesto, tenis de mesa → MONEYLINE_2WAY).
          const hasDraw = offer.outcomes.some((o: any) => o.type === 'OT_CROSS');
          const marketType: '1X2' | 'MONEYLINE_2WAY' = hasDraw ? '1X2' : 'MONEYLINE_2WAY';

          for (const outcome of offer.outcomes) {
            if (typeof outcome?.odds !== 'number') continue;
            let selection: string;
            if (outcome.type === 'OT_ONE') selection = homeTeam;
            else if (outcome.type === 'OT_CROSS') selection = 'Empate';
            else if (outcome.type === 'OT_TWO') selection = awayTeam;
            else selection = outcome.label || outcome.englishLabel || 'Unknown';

            odds.push({
              bookmaker: 'BetPlay',
              eventName,
              sport,
              marketType,
              selection,
              odd: outcome.odds / 1000,
              timestamp: now,
              ...(startTime ? { startTime } : {}),
              ...(isLive ? { isLive } : {}),
            });
          }
        } else if (offerTypeId === 6 && sport === 'football') {
          // Total de goles (Más/Menos). La vista de lista trae UNA línea por partido y varía entre 1.5 y 8.5:
          // solo se toma la línea 2.5 para no mezclar líneas distintas bajo OVER_UNDER_2_5.
          const isGoals = /goles|goals/i.test(`${offer.criterion?.label ?? ''} ${offer.criterion?.englishLabel ?? ''}`);
          if (!isGoals) continue;
          for (const outcome of offer.outcomes) {
            if (typeof outcome?.odds !== 'number' || outcome.line !== 2500) continue;
            if (outcome.type !== 'OT_OVER' && outcome.type !== 'OT_UNDER') continue;
            odds.push({
              bookmaker: 'BetPlay',
              eventName,
              sport,
              marketType: 'OVER_UNDER_2_5',
              selection: `${outcome.type === 'OT_OVER' ? 'Más de' : 'Menos de'} 2.5`,
              odd: outcome.odds / 1000,
              timestamp: now,
              ...(startTime ? { startTime } : {}),
              ...(isLive ? { isLive } : {}),
            });
          }
        } else if (offerTypeId === 68) {
          // Mercado Ambos Anotan
          for (const outcome of offer.outcomes) {
            if (typeof outcome?.odds !== 'number') continue;
            odds.push({
              bookmaker: 'BetPlay',
              eventName,
              sport,
              marketType: 'BOTH_TEAMS_SCORE',
              selection: outcome.label || outcome.englishLabel || 'Unknown',
              odd: outcome.odds / 1000,
              timestamp: now,
              ...(startTime ? { startTime } : {}),
              ...(isLive ? { isLive } : {}),
            });
          }
        }
      }
    } catch (error: any) {
      console.warn('⚠️ [BetPlay/Kambi] Error procesando evento:', error.message);
    }
  }

  return odds.filter((o) => !isNaN(o.odd) && o.odd > 1.0);
}

export const betplayKambiAdapter: SiteOddsAdapter & {
  fetchDirect: (sportSlug?: string) => Promise<BookmakerOdd[]>;
} = {
  domain: 'tienda.betplay.com.co',

  urlPatterns: [
    /kambicdn\.com/i,
    /offering-api/i,
    /\/offering\/v2018\//i,
    /listView\//i,
    /betplay\/listView/i,
  ],

  /**
   * Fetch directo a la API pública de Kambi sin necesidad de Playwright.
   * Evita el bloqueo por reCAPTCHA que sufre el navegador headless en BetPlay.
   * La API es pública (CORS abierto, sin auth) y responde con todos los eventos del deporte indicado.
   *
   * @param sportSlug - Slug Kambi del deporte ('football', 'tennis', 'basketball', 'table_tennis').
   *                    Por defecto 'football' para mantener compatibilidad con callers existentes.
   */
  async fetchDirect(sportSlug: string = 'football'): Promise<BookmakerOdd[]> {
    try {
      console.log(`📡 [BetPlay/Kambi] Fetch directo [${sportSlug}]`);
      // Kambi limita listView a los partidos próximos según la hora (soonMode): fetchKambiListing barre las
      // regiones cuando hace falta para no perder partidos.
      const listing = await fetchKambiListing(sportSlug, {
        offering: 'betplay',
        hosts: ['us', 'eu'],
        headers: KAMBI_HEADERS,
        query: 'lang=es_ES&market=CO&client_id=2&channel_id=1',
      });
      const odds = parseKambiEvents({ events: listing.events });
      console.log(
        `✅ [BetPlay/Kambi] fetchDirect [${sportSlug}]: ${odds.length} odds (${listing.events.length} eventos${
          listing.swept ? `, barrido de regiones por modo ${listing.soonMode}: ${listing.regionsFetched} ok / ${listing.regionsFailed} fallidas` : ''
        })`,
      );
      return odds;
    } catch (error: any) {
      console.error(`❌ [BetPlay/Kambi] fetchDirect falló para [${sportSlug}]: ${error.message}`);
      return [];
    }
  },

  /**
   * Fallback: extrae odds de los payloads capturados por el interceptor Playwright.
   * Se usa cuando fetchDirect() no está disponible o cuando el interceptor ya capturó datos.
   */
  extract(payloads: CapturedPayload[]): BookmakerOdd[] {
    const odds: BookmakerOdd[] = [];

    for (const payload of payloads) {
      try {
        const data: any = (payload as any)?.json ?? (payload as any)?.body ?? payload;
        const result = parseKambiEvents(data);
        odds.push(...result);
      } catch (error: any) {
        console.warn('⚠️ [BetPlay/Kambi] Error procesando payload (interceptor):', error.message);
      }
    }

    console.log(`📊 [BetPlay/Kambi] extract() vía interceptor: ${odds.length} odds`);
    return odds;
  },
};
