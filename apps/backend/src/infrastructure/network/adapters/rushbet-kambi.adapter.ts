import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import type { BookmakerOdd, SportType } from '../../../domain/types/surebet.types.js';
import type { CapturedPayload } from '../odds-interceptor.js';
import { fetchKambiListing } from './kambi-listing.js';

/**
 * Adapter para Rushbet Colombia (www.rushbet.co) — motor Kambi, oferta `rsico`.
 * La página (`/?page=sportsbook#filter/football/`) monta el widget de Kambi vía
 * `rsi-kambi-controller` + `client-static.bc.kambicdn.com/client/rsico/...` y las cuotas salen de
 * la API pública de Kambi, sin cookies ni login:
 *
 *   https://us.offering-api.kambicdn.com/offering/v2018/rsico/listView/{sport}/all/all.json
 *     ?lang=es_CO&market=CO&client_id=2&channel_id=1&useCombined=true&useCombinedLive=true
 *
 * ESTRATEGIA PRINCIPAL — fetchDirect(): fetch() directo desde Node (sin Playwright). Kambi limita `listView` a los
 * partidos próximos según la hora (`soonMode`), por eso se usa fetchKambiListing, que barre las regiones si hace falta.
 * FALLBACK — extract(): parsea payloads capturados por el interceptor.
 *
 * Estructura: { events: [ { event: { id, homeName, awayName, sport, state }, betOffers: [...] } ] }.
 * Mercados de listView (betOfferType.id):
 *   - 2 : resultado final. Con outcome OT_CROSS (empate) → '1X2'; sin empate → 'MONEYLINE_2WAY'.
 *   - 6 : Más/Menos (Total). Solo se toma fútbol, "Total de goles", línea 2.5 → 'OVER_UNDER_2_5'.
 *   - 1 : hándicap (no se extrae).
 * `odds` viene como entero decimal × 1000 (1490 → 1.49) y los outcomes suspendidos no traen `odds`.
 * Incluye partidos en vivo (event.state === 'STARTED'); sus cuotas envejecen en segundos.
 */

const KAMBI_OFFERING = 'rsico';
const KAMBI_HOSTS = ['us', 'eu'];

const KAMBI_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': 'https://www.rushbet.co/',
  'Origin': 'https://www.rushbet.co',
  'Cache-Control': 'no-cache',
};

const KAMBI_SPORTS: Record<string, SportType> = {
  football: 'football',
  tennis: 'tennis',
  basketball: 'basketball',
  table_tennis: 'table_tennis',
};

/** Alias de slugs (URL de Rushbet o español) → slug de Kambi. */
const SPORT_SLUG_ALIASES: Record<string, string> = {
  futbol: 'football',
  'fútbol': 'football',
  tenis: 'tennis',
  baloncesto: 'basketball',
  'table-tennis': 'table_tennis',
  'tenis-de-mesa': 'table_tennis',
  tenis_de_mesa: 'table_tennis',
};

/**
 * Deporte a partir de la URL de Rushbet: '...#filter/football/' → 'football'.
 * Sin hash reconocible se asume fútbol.
 */
export function parseRushbetSportSlug(url: string): string {
  const hash = url.split('#')[1] || '';
  const m = hash.match(/filter\/([^/?#]+)/i);
  const raw = decodeURIComponent(m?.[1] || 'football').toLowerCase().trim();
  return SPORT_SLUG_ALIASES[raw] ?? raw;
}

function parseKambiEvents(data: any): BookmakerOdd[] {
  const odds: BookmakerOdd[] = [];
  const now = new Date().toISOString();
  const events: any[] = Array.isArray(data?.events) ? data.events : [];

  for (const item of events) {
    try {
      const ev = item?.event;
      if (!ev) continue;
      const sport = KAMBI_SPORTS[String(ev.sport || '').toLowerCase()];
      if (!sport) continue;
      const homeTeam: string = ev.homeName || (ev.name || '').split(ev.nameDelimiter || '-')[0]?.trim();
      const awayTeam: string = ev.awayName || (ev.name || '').split(ev.nameDelimiter || '-')[1]?.trim();
      if (!homeTeam || !awayTeam) continue;
      const eventName = `${homeTeam} vs ${awayTeam}`;
      const startTime: string | undefined = typeof ev.start === 'string' ? ev.start : undefined;
      const isLive = ev.state === 'STARTED';

      for (const offer of Array.isArray(item.betOffers) ? item.betOffers : []) {
        if (!Array.isArray(offer?.outcomes)) continue;
        const offerTypeId: number = offer?.betOfferType?.id;

        if (offerTypeId === 2) {
          const hasDraw = offer.outcomes.some((o: any) => o.type === 'OT_CROSS');
          const marketType = hasDraw ? '1X2' : 'MONEYLINE_2WAY';
          for (const o of offer.outcomes) {
            if (typeof o?.odds !== 'number') continue;
            let selection: string;
            if (o.type === 'OT_ONE') selection = homeTeam;
            else if (o.type === 'OT_CROSS') selection = 'Empate';
            else if (o.type === 'OT_TWO') selection = awayTeam;
            else continue;
            odds.push({ bookmaker: 'Rushbet', eventName, sport, marketType, selection, odd: o.odds / 1000, timestamp: now, ...(startTime ? { startTime } : {}), ...(isLive ? { isLive } : {}) });
          }
        } else if (offerTypeId === 6 && sport === 'football') {
          const isGoals = /goles|goals/i.test(`${offer.criterion?.label ?? ''} ${offer.criterion?.englishLabel ?? ''}`);
          if (!isGoals) continue;
          for (const o of offer.outcomes) {
            if (typeof o?.odds !== 'number' || o.line !== 2500) continue;
            if (o.type !== 'OT_OVER' && o.type !== 'OT_UNDER') continue;
            odds.push({
              bookmaker: 'Rushbet',
              eventName,
              sport,
              marketType: 'OVER_UNDER_2_5',
              selection: `${o.type === 'OT_OVER' ? 'Más de' : 'Menos de'} 2.5`,
              odd: o.odds / 1000,
              timestamp: now,
              ...(startTime ? { startTime } : {}),
              ...(isLive ? { isLive } : {}),
            });
          }
        }
      }
    } catch (error: any) {
      console.warn('⚠️ [Rushbet/Kambi] Error procesando evento:', error.message);
    }
  }

  return odds.filter((o) => !isNaN(o.odd) && o.odd > 1.0);
}

export const rushbetKambiAdapter: SiteOddsAdapter & {
  fetchDirect: (sportSlug?: string) => Promise<BookmakerOdd[]>;
} = {
  domain: 'rushbet.co',

  urlPatterns: [/kambicdn\.com/i, /offering-api/i, /\/offering\/v2018\/rsico\//i, /listView\//i],

  /**
   * Fetch directo a la API pública de Kambi (oferta rsico). Lanza si ningún host responde;
   * devuelve [] si el deporte no tiene eventos.
   * @param sportSlug slug Kambi: 'football' | 'tennis' | 'basketball' | 'table_tennis'
   */
  async fetchDirect(sportSlug: string = 'football'): Promise<BookmakerOdd[]> {
    if (!KAMBI_SPORTS[sportSlug]) {
      throw new Error(`Rushbet: deporte '${sportSlug}' no soportado (soportados: ${Object.keys(KAMBI_SPORTS).join(', ')})`);
    }
    const listing = await fetchKambiListing(sportSlug, {
      offering: KAMBI_OFFERING,
      hosts: KAMBI_HOSTS,
      headers: KAMBI_HEADERS,
      query: 'lang=es_CO&market=CO&client_id=2&channel_id=1',
    });
    const odds = parseKambiEvents({ events: listing.events });
    console.log(
      `✅ [Rushbet/Kambi] [${sportSlug}]: ${odds.length} odds (${listing.events.length} eventos${
        listing.swept ? `, barrido de regiones por modo ${listing.soonMode}: ${listing.regionsFetched} ok / ${listing.regionsFailed} fallidas` : ''
      })`,
    );
    return odds;
  },

  /** Fallback: extrae odds de los payloads capturados por el interceptor Playwright. */
  extract(payloads: CapturedPayload[]): BookmakerOdd[] {
    const odds: BookmakerOdd[] = [];
    for (const payload of payloads) {
      const data: any = (payload as any)?.json ?? (payload as any)?.body ?? payload;
      odds.push(...parseKambiEvents(data));
    }
    console.log(`📊 [Rushbet/Kambi] extract() vía interceptor: ${odds.length} odds`);
    return odds;
  },
};
