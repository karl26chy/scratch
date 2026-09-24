import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import type { BookmakerOdd, MarketType, SportType } from '../../../domain/types/surebet.types.js';
import type { CapturedPayload } from '../odds-interceptor.js';

/**
 * Adapter para Bwin Colombia (www.bwin.co) — plataforma Entain (CDS API).
 * El sportsbook es una SPA que carga las cuotas desde la API interna pública:
 *
 *   GET https://www.bwin.co/cds-api/bettingoffer/fixtures?x-bwin-accessid=...&sportIds=4&skip=0&take=500 ...
 *
 * ESTRATEGIA PRINCIPAL — fetchDirect():
 *   La API no exige cookies ni login (solo el `x-bwin-accessid` público que la
 *   propia SPA envía y un Referer de bwin.co). Se hace fetch() directo desde Node,
 *   sin Playwright.
 *
 * Deportes soportados (sportId de Bwin → SportType): fútbol 4, tenis 5, baloncesto 7, tenis de mesa 56.
 * El sportId se toma del último número del slug de la URL pública ('/es/sports/tenis-5/apuestas' → 5).
 *
 * La API mezcla DOS formatos de partido:
 *   - V2: cuotas en `optionMarkets[]` (name, parameters[MarketType/MarketSubType/DecimalValue/Period], options[].price.odds).
 *         Local/visitante vienen en participants[].properties.type ('HomeTeam' | 'AwayTeam').
 *   - V1: cuotas en `games[]` (name, isMain, results[] con `odds` y `sourceName` '1'|'X'|'2').
 *         El local es el participante cuyo playerId coincide con el resultado '1'.
 *
 * Mercados extraídos (mismos tipos que BetPlay para poder cruzarlos en surebets):
 *   - Fútbol: '1X2' (3way estándar, sin MarketSubType: se excluye "VA +2"/2Up), 'OVER_UNDER_2_5', 'BOTH_TEAMS_SCORE'.
 *   - Tenis, baloncesto, tenis de mesa: 'MONEYLINE_2WAY' (ganador del partido, tiempo completo).
 *
 * Se extraen partidos prepartido y en vivo (stage 'Live'); las cuotas en vivo envejecen en segundos.
 * Se descartan outrights/especiales (sin local/visitante o sin exactamente 2 participantes en V1).
 */

const BWIN_BASE = 'https://www.bwin.co';
const BWIN_ACCESS_ID = process.env.BWIN_ACCESS_ID || 'NzAyNGFhZmYtY2UyNy00NWNjLThmODUtNWYwZDI1OGVmYWU0';
const BWIN_FOOTBALL_SPORT_ID = 4;
const BWIN_SPORTS: Record<number, SportType> = {
  4: 'football',
  5: 'tennis',
  7: 'basketball',
  56: 'table_tennis',
};
const PAGE_SIZE = 500;
const MAX_PAGES = 5;

const BWIN_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Referer': `${BWIN_BASE}/es/sports/f%C3%BAtbol-4/apuestas`,
  'Origin': BWIN_BASE,
};

function buildFixturesUrl(sportId: number, skip: number, take: number): string {
  const qs = new URLSearchParams({
    'x-bwin-accessid': BWIN_ACCESS_ID,
    lang: 'es-419',
    country: 'CO',
    userCountry: 'CO',
    fixtureTypes: 'Standard',
    state: 'Latest',
    offerMapping: 'Filtered',
    offerCategories: 'Gridable',
    fixtureCategories: 'Gridable,NonGridable,Other',
    sportIds: String(sportId),
    isPriceBoost: 'false',
    statisticsModes: 'None',
    skip: String(skip),
    take: String(take),
    sortBy: 'Tags',
  });
  return `${BWIN_BASE}/cds-api/bettingoffer/fixtures?${qs.toString()}`;
}

/**
 * Extrae el sportId de la URL pública de Bwin: el último segmento numérico del slug
 * del deporte. Ej: '/es/sports/fútbol-4/apuestas' → 4. Por defecto fútbol (4).
 */
export function parseBwinSportId(url: string): number {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const match = path.match(/\/sports\/[^/]*?-(\d+)(?:\/|$)/i);
    if (match) return Number(match[1]);
  } catch {
    /* URL inválida → default */
  }
  return BWIN_FOOTBALL_SPORT_ID;
}

function marketParams(market: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of Array.isArray(market?.parameters) ? market.parameters : []) {
    if (p?.key) out[p.key] = String(p.value);
  }
  return out;
}

/** '1,5' | '2.5' → 'Más de 2.5' (mismo formato que BetPlay para cruzar selecciones). */
function normalizeOverUnderLabel(raw: string): string {
  const isOver = /m[aá]s|over/i.test(raw);
  const line = raw.match(/(\d+(?:[.,]\d+)?)/)?.[1]?.replace(',', '.') ?? '2.5';
  return `${isOver ? 'Más de' : 'Menos de'} ${line}`;
}

/** 'Real Madrid (ESP)' → 'Real Madrid' (Bwin añade el país; las demás casas no). */
function cleanName(name: string | undefined): string {
  return (name ?? '').replace(/\s*\([A-Za-z]{2,3}\)\s*$/, '').trim();
}

/** Mercado principal de ganador a tiempo completo (V2): 'Resultado del partido' | 'Ganador' | 'Ganador del partido'. */
function isMainWinnerName(name: string | undefined): boolean {
  return /^(resultado del partido|ganador|ganador del partido)$/i.test((name ?? '').trim());
}

function parseBwinFixtures(data: any, defaultSport: SportType = 'football'): BookmakerOdd[] {
  const odds: BookmakerOdd[] = [];
  const now = new Date().toISOString();
  const fixtures: any[] = Array.isArray(data?.fixtures) ? data.fixtures : [];

  for (const fx of fixtures) {
    try {
      const participants: any[] = Array.isArray(fx?.participants) ? fx.participants : [];
      const sport: SportType = BWIN_SPORTS[Number(fx?.sport?.id)] ?? defaultSport;
      const is2Way = sport !== 'football';

      const push = (marketType: MarketType, selection: string, price: unknown, eventName: string) => {
        if (typeof price !== 'number' || !(price > 1.0)) return;
        odds.push({ bookmaker: 'Bwin', eventName, sport, marketType, selection, odd: price, timestamp: now, ...(fx.startDate ? { startTime: fx.startDate } : {}), ...(fx.stage === 'Live' ? { isLive: true } : {}) });
      };

      // ── Formato V2: optionMarkets ──────────────────────────────────────────
      if (Array.isArray(fx.optionMarkets) && fx.optionMarkets.length > 0) {
        const homeP = participants.find((p) => p?.properties?.type === 'HomeTeam');
        const awayP = participants.find((p) => p?.properties?.type === 'AwayTeam');
        if (!homeP || !awayP) continue;
        const homeRaw: string = homeP.name?.value;
        const awayRaw: string = awayP.name?.value;
        const homeTeam = cleanName(homeRaw);
        const awayTeam = cleanName(awayRaw);
        const eventName = `${homeTeam} vs ${awayTeam}`;

        for (const market of fx.optionMarkets) {
          if (market?.status !== 'Visible') continue;
          const params = marketParams(market);
          if (params.Period && params.Period !== 'RegularTime' && params.Period !== 'FullTime') continue;
          const options: any[] = (Array.isArray(market.options) ? market.options : []).filter((o: any) => o?.status === 'Visible');

          if (!is2Way && params.MarketType === '3way' && !params.MarketSubType && options.length === 3) {
            const homeOpt = options.find((o) => !o.parameters?.optionTypes?.includes('Draw') && o.name?.value === homeRaw);
            const awayOpt = options.find((o) => !o.parameters?.optionTypes?.includes('Draw') && o.name?.value === awayRaw);
            const drawOpt = options.find((o) => o.parameters?.optionTypes?.includes('Draw') || /^x$/i.test(o.name?.value ?? ''));
            if (!homeOpt || !awayOpt || !drawOpt) continue;
            push('1X2', homeTeam, homeOpt.price?.odds, eventName);
            push('1X2', 'Empate', drawOpt.price?.odds, eventName);
            push('1X2', awayTeam, awayOpt.price?.odds, eventName);
          } else if (is2Way && params.MarketType === '2way' && !params.MarketSubType && options.length === 2 && isMainWinnerName(market.name?.value)) {
            const homeOpt = options.find((o) => o.name?.value === homeRaw) ?? options[0];
            const awayOpt = options.find((o) => o.name?.value === awayRaw) ?? options[1];
            if (homeOpt === awayOpt) continue;
            push('MONEYLINE_2WAY', homeTeam, homeOpt.price?.odds, eventName);
            push('MONEYLINE_2WAY', awayTeam, awayOpt.price?.odds, eventName);
          } else if (!is2Way && params.MarketType === 'Over/Under' && Number(params.DecimalValue) === 2.5) {
            for (const o of options) push('OVER_UNDER_2_5', normalizeOverUnderLabel(o.name?.value ?? ''), o.price?.odds, eventName);
          } else if (!is2Way && params.MarketType === 'BTTS') {
            for (const o of options) {
              const label = /^s[ií]$|^yes$/i.test((o.name?.value ?? '').trim()) ? 'Sí' : 'No';
              push('BOTH_TEAMS_SCORE', label, o.price?.odds, eventName);
            }
          }
        }
        continue;
      }

      // ── Formato V1: games (tenis, baloncesto) ──────────────────────────────
      // Outrights/especiales no tienen exactamente 2 participantes. (En V2 los participantes pueden incluir
      // jugadores; ahí local/visitante se identifican por properties.type.)
      if (participants.length !== 2) continue;
      const games: any[] = Array.isArray(fx.games) ? fx.games : [];
      const main = games.find((g) => g?.isMain && g?.visibility === 'Visible' && Array.isArray(g.results) && g.results.length === 2);
      if (!main) continue;
      const r1 = main.results.find((r: any) => r?.sourceName?.value === '1');
      const r2 = main.results.find((r: any) => r?.sourceName?.value === '2');
      if (!r1 || !r2) continue;
      const nameOf = (r: any): string => cleanName(participants.find((p) => p?.participantId === r.playerId)?.name?.value ?? r.name?.value);
      const homeTeam = nameOf(r1);
      const awayTeam = nameOf(r2);
      if (!homeTeam || !awayTeam) continue;
      const eventName = `${homeTeam} vs ${awayTeam}`;
      if (r1.visibility === 'Visible') push('MONEYLINE_2WAY', homeTeam, r1.odds, eventName);
      if (r2.visibility === 'Visible') push('MONEYLINE_2WAY', awayTeam, r2.odds, eventName);
    } catch (error: any) {
      console.warn('⚠️ [Bwin] Error procesando evento:', error.message);
    }
  }

  return odds;
}

/** GET JSON con un reintento ante errores de red o 5xx (fallos transitorios como `fetch failed`). */
async function fetchJsonWithRetry(url: string, attempts = 2): Promise<any> {
  let lastError: Error = new Error('sin respuesta');
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    try {
      const response = await fetch(url, { headers: BWIN_HEADERS });
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500) break; // 4xx: reintentar no cambia nada
    } catch (e: any) {
      lastError = e;
    }
  }
  throw lastError;
}

export const bwinAdapter: SiteOddsAdapter & {
  fetchDirect: (sportId?: number) => Promise<BookmakerOdd[]>;
} = {
  domain: 'bwin.co',

  urlPatterns: [/cds-api\/bettingoffer\/fixtures/i],

  /**
   * Fetch directo a la CDS API de Bwin (paginado). Devuelve cuotas normalizadas.
   * Lanza si la primera página falla; páginas posteriores fallidas devuelven lo ya acumulado.
   */
  async fetchDirect(sportId: number = BWIN_FOOTBALL_SPORT_ID): Promise<BookmakerOdd[]> {
    const sport = BWIN_SPORTS[sportId];
    if (!sport) {
      throw new Error(`Bwin: sportId ${sportId} no soportado (soportados: ${Object.entries(BWIN_SPORTS).map(([id, n]) => `${n}=${id}`).join(', ')})`);
    }

    const all: BookmakerOdd[] = [];
    let skip = 0;
    let totalCount = Infinity;

    for (let page = 0; page < MAX_PAGES && skip < totalCount; page++) {
      const url = buildFixturesUrl(sportId, skip, PAGE_SIZE);
      console.log(`📡 [Bwin] Fetch directo fixtures [${sport}] (skip=${skip}, take=${PAGE_SIZE})`);
      try {
        const data: any = await fetchJsonWithRetry(url);
        totalCount = Number(data?.totalCount) || 0;
        const pageFixtures = Array.isArray(data?.fixtures) ? data.fixtures.length : 0;
        all.push(...parseBwinFixtures(data, sport));
        skip += PAGE_SIZE;
        if (pageFixtures === 0) break;
      } catch (error: any) {
        if (page === 0) throw new Error(`Bwin CDS API falló: ${error.message}`);
        console.warn(`⚠️ [Bwin] Página ${page + 1} falló (${error.message}) — se devuelve lo acumulado`);
        break;
      }
    }

    console.log(`✅ [Bwin] fetchDirect [${sport}]: ${all.length} odds`);
    return all;
  },

  /** Fallback: extrae odds de payloads capturados por el interceptor Playwright. */
  extract(payloads: CapturedPayload[]): BookmakerOdd[] {
    const odds: BookmakerOdd[] = [];
    for (const payload of payloads) {
      const data: any = (payload as any)?.json ?? (payload as any)?.body ?? payload;
      odds.push(...parseBwinFixtures(data));
    }
    console.log(`📊 [Bwin] extract() vía interceptor: ${odds.length} odds`);
    return odds;
  },
};
