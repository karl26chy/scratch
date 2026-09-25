import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import type { BookmakerOdd, MarketType, SportType } from '../../../domain/types/surebet.types.js';
import type { CapturedPayload } from '../odds-interceptor.js';

/**
 * Adapter para Betsson Colombia (www.betsson.co) — plataforma propia "Sportsbook" de Betsson Group (OBG).
 * La SPA carga todo desde su API interna (`/api/sb/v1/widgets/...`), pública para usuarios anónimos:
 *
 *  1) LISTA de partidos: GET /api/sb/v1/widgets/view/v1?categoryIds={id}&...&slug={slug}
 *     Devuelve widgets; los de prematch / en vivo / competiciones traen, por fecha, `metaData[]` con
 *     `eventId` y `startDate` (sin cuotas). El widget de "outrights" (apuestas de temporada) pesa ~4 MB y se excluye.
 *
 *  2) CUOTAS: GET /api/sb/v1/widgets/event-market/v1?marketids=m-{eventId}-{plantilla},...
 *     El id de mercado se arma con el id del evento y la plantilla. La URL admite ~2.000 caracteres (IIS devuelve
 *     404 por encima), así que se pide por lotes. Devuelve `events`, `markets` y `marketSelections` (con `odds`).
 *
 * Plantillas usadas:
 *   - Fútbol: MW3W (1X2: HOME/DRAW/AWAY), MTG2W-2.5 (Total de goles: OVER/UNDER; la línea 2.5 llega con
 *     marketTemplateId 'MTG2W25', las demás 'MTG2W'), BTTS (Ambos anotan: YES/NO).
 *   - Tenis, baloncesto, tenis de mesa: MW2W ("Ganador del partido": HOME/AWAY).
 *   (MWOU = "ganador + total", MTG2W = "total de goles" simple; HTG/ATG = total por equipo.)
 *
 * Cabeceras: la API valida un juego de cabeceras `x-sb-*` / `brandid` / `sessiontoken`. Para un visitante anónimo son
 * constantes de la marca (brandId, ids de contexto, un JWT anónimo de usuario ficticio), capturadas del tráfico real
 * de la web. Si Betsson las rota, sobreescribir con BETSSON_BRAND_ID / BETSSON_SESSION_TOKEN o volver a capturarlas.
 *
 * Se extraen partidos prepartido y en vivo (`phase === 'Live'`); las cuotas en vivo envejecen en segundos.
 */

const BETSSON_BASE = 'https://www.betsson.co';
const BRAND_ID = process.env.BETSSON_BRAND_ID || '6a6d80b9-16ac-4387-a413-244d93a74deb';
const SESSION_TOKEN =
  process.env.BETSSON_SESSION_TOKEN ||
  'ew0KICAiYWxnIjogIkhTMjU2IiwNCiAgInR5cCI6ICJKV1QiDQp9.ew0KICAianVyaXNkaWN0aW9uIjogIlVua25vd24iLA0KICAidXNlcklkIjogIjExMTExMTExLTExMTEtMTExMS0xMTExLTExMTExMTExMTExMSIsDQogICJsb2dpblNlc3Npb25JZCI6ICIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiDQp9.yuBO_qNKJHtbCWK3z04cEqU59EKU8pZb2kXHhZ7IeuI';

interface BetssonSport {
  categoryId: number;
  slug: string;
  sport: SportType;
  /** Plantillas de mercado a pedir por partido. */
  templates: string[];
}

/** Slug de la URL pública → categoría de Betsson. */
const BETSSON_SPORTS: Record<string, BetssonSport> = {
  futbol: { categoryId: 1, slug: 'futbol', sport: 'football', templates: ['MW3W', 'MTG2W-2.5', 'BTTS'] },
  tenis: { categoryId: 11, slug: 'tenis', sport: 'tennis', templates: ['MW2W'] },
  baloncesto: { categoryId: 4, slug: 'baloncesto', sport: 'basketball', templates: ['MW2W'] },
  'tenis-de-mesa': { categoryId: 138, slug: 'tenis-de-mesa', sport: 'table_tennis', templates: ['MW2W'] },
};

const MAX_URL_LENGTH = 1900; // por encima, el servidor responde 404
const CONCURRENCY = 6;

function buildHeaders(identifier: string, referer: string): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'es-CO',
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    referer,
    brandid: BRAND_ID,
    marketcode: 'co',
    sessiontoken: SESSION_TOKEN,
    'x-obg-channel': 'Web',
    'x-obg-device': 'Desktop',
    'x-sb-type': 'b2b',
    'x-sb-device-type': 'Desktop',
    'x-sb-channel': 'Web',
    'x-sb-jurisdiction': 'Coljuegos',
    'x-sb-currency-code': 'COP',
    'x-sb-language-code': 'co',
    'x-sb-country-code': 'CO',
    'x-sb-content-id': '2d543995-acff-41c1-bc73-9ec46bd70602',
    'x-sb-segment-id': '1a68008c-4da6-4f77-acbc-0614cb030d7d',
    'x-sb-static-context-id': 'stc--55774027',
    'x-sb-user-context-id': 'stc--55774027',
    'x-sb-app-version': '8.2.18.5223-r9e23605',
    'x-sb-identifier': identifier,
    correlationid: crypto.randomUUID(),
  };
}

/**
 * Deporte a partir de la URL pública: '/apuestas-deportivas/futbol?tab=allLeagues' → 'futbol'.
 * Sin ruta reconocible se asume fútbol.
 */
export function parseBetssonSportSlug(url: string): string {
  try {
    const m = decodeURIComponent(new URL(url).pathname).match(/\/apuestas-deportivas\/([^/?#]+)/i);
    if (m) return m[1].toLowerCase();
  } catch {
    /* URL inválida → default */
  }
  return 'futbol';
}

async function getJson(url: string, identifier: string, referer: string, attempts = 2): Promise<any> {
  let lastError: Error = new Error('sin respuesta');
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(url, { headers: buildHeaders(identifier, referer) });
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
      if (res.status < 500) break; // 4xx: reintentar no cambia nada
    } catch (e: any) {
      lastError = e; // fallo de red: un reintento
    }
  }
  throw lastError;
}

interface ListedEvent {
  eventId: string;
  startDate?: string;
}

/** Lista de eventos (id + hora) de una categoría a partir de los widgets prematch / en vivo / competiciones. */
async function listEvents(cfg: BetssonSport): Promise<ListedEvent[]> {
  const qs = new URLSearchParams({
    categoryIds: String(cfg.categoryId),
    configurationKey: 'sportsbook.category',
    excludedWidgetKeys: 'sportsbook.tournament.carousel,sportsbook.category.outrights',
    nodeIdentifier: String(cfg.categoryId),
    slug: cfg.slug,
    timezoneOffsetMinutes: '-300',
    priceFormats: '1',
  });
  const referer = `${BETSSON_BASE}/apuestas-deportivas/${cfg.slug}?tab=allLeagues`;
  const view = await getJson(`${BETSSON_BASE}/api/sb/v1/widgets/view/v1?${qs.toString()}`, 'SPORTSBOOK_CATEGORY_WIDGET_REQUEST', referer);

  const events = new Map<string, ListedEvent>();
  for (const widget of view?.data?.widgets ?? []) {
    if (!/^sportsbook\.category\.(prematch|live|competition)$/.test(widget?.key)) continue;
    for (const item of widget?.data?.data?.items ?? []) {
      for (const meta of item?.metaData ?? []) {
        if (typeof meta?.eventId === 'string' && !events.has(meta.eventId)) events.set(meta.eventId, { eventId: meta.eventId, startDate: meta.startDate });
      }
    }
  }
  return [...events.values()];
}

/** Agrupa ids de evento en lotes cuya URL de event-market no supere MAX_URL_LENGTH. */
function batchEvents(ids: string[], templates: string[]): string[][] {
  const prefix = `${BETSSON_BASE}/api/sb/v1/widgets/event-market/v1?includescoreboards=false&marketids=`;
  const batches: string[][] = [];
  let current: string[] = [];
  let length = prefix.length;
  for (const id of ids) {
    const cost = templates.reduce((n, t) => n + `m-${id}-${t},`.length, 0);
    if (current.length > 0 && length + cost > MAX_URL_LENGTH) {
      batches.push(current);
      current = [];
      length = prefix.length;
    }
    current.push(id);
    length += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Nombre de participante normalizado: sin espacios sobrantes y, en tenis/tenis de mesa, 'Apellido, Nombre' →
 * 'Nombre Apellido' (así lo publican las demás casas).
 */
function cleanParticipant(label: string, sport: SportType): string {
  const name = label.trim().replace(/\s+/g, ' ');
  if ((sport === 'tennis' || sport === 'table_tennis') && name.includes(', ')) {
    const [surname, ...given] = name.split(', ');
    return `${given.join(' ')} ${surname}`.trim();
  }
  return name;
}

/** Convierte una respuesta de event-market en cuotas normalizadas (función pura). */
export function parseBetssonMarkets(data: any, sport: SportType, timestamp = new Date().toISOString()): BookmakerOdd[] {
  const odds: BookmakerOdd[] = [];
  const events: any[] = Array.isArray(data?.events) ? data.events : [];
  const markets: any[] = Array.isArray(data?.markets) ? data.markets : [];
  const selections: any[] = Array.isArray(data?.marketSelections) ? data.marketSelections : [];

  const selectionsByMarket = new Map<string, any[]>();
  for (const s of selections) {
    if (!selectionsByMarket.has(s?.marketId)) selectionsByMarket.set(s?.marketId, []);
    selectionsByMarket.get(s?.marketId)!.push(s);
  }
  const eventsById = new Map<string, any>(events.map((e) => [e?.id, e]));

  for (const market of markets) {
    if (market?.status !== 'Open') continue;
    const ev = eventsById.get(market.eventId);
    if (!ev) continue;
    const parts: any[] = Array.isArray(ev.participants) ? ev.participants : [];
    const homeRaw: string | undefined = parts.find((p) => p?.side === 1)?.label;
    const awayRaw: string | undefined = parts.find((p) => p?.side === 2)?.label;
    if (!homeRaw || !awayRaw) continue; // outrights / eventos sin dos lados
    const home = cleanParticipant(homeRaw, sport);
    const away = cleanParticipant(awayRaw, sport);
    const eventName = `${home} vs ${away}`;
    const startTime: string | undefined = typeof ev.startDate === 'string' ? ev.startDate : undefined;
    const isLive = ev.phase === 'Live';

    const push = (marketType: MarketType, selection: string, price: unknown) => {
      if (typeof price !== 'number' || !(price > 1.0)) return;
      odds.push({ bookmaker: 'Betsson', eventName, sport, marketType, selection, odd: price, timestamp, ...(startTime ? { startTime } : {}), ...(isLive ? { isLive } : {}) });
    };

    const template: string = market.marketTemplateId;
    const open = (selectionsByMarket.get(market.id) ?? []).filter((s) => s?.status === 'Open');

    if (template === 'MW3W' && sport === 'football') {
      for (const s of open) {
        if (s.selectionTemplateId === 'HOME') push('1X2', home, s.odds);
        else if (s.selectionTemplateId === 'DRAW') push('1X2', 'Empate', s.odds);
        else if (s.selectionTemplateId === 'AWAY') push('1X2', away, s.odds);
      }
    } else if (/^MTG2W/.test(template) && sport === 'football' && Number(market.lineValue) === 2.5) {
      for (const s of open) {
        if (s.selectionTemplateId === 'OVER') push('OVER_UNDER_2_5', 'Más de 2.5', s.odds);
        else if (s.selectionTemplateId === 'UNDER') push('OVER_UNDER_2_5', 'Menos de 2.5', s.odds);
      }
    } else if (template === 'BTTS' && sport === 'football') {
      for (const s of open) {
        if (s.selectionTemplateId === 'YES') push('BOTH_TEAMS_SCORE', 'Sí', s.odds);
        else if (s.selectionTemplateId === 'NO') push('BOTH_TEAMS_SCORE', 'No', s.odds);
      }
    } else if (template === 'MW2W' && sport !== 'football') {
      for (const s of open) {
        if (s.selectionTemplateId === 'HOME') push('MONEYLINE_2WAY', home, s.odds);
        else if (s.selectionTemplateId === 'AWAY') push('MONEYLINE_2WAY', away, s.odds);
      }
    }
  }
  return odds;
}

export const betssonAdapter: SiteOddsAdapter & {
  fetchDirect: (sportSlug?: string) => Promise<BookmakerOdd[]>;
} = {
  domain: 'betsson.co',

  urlPatterns: [/\/api\/sb\/v1\/widgets\/event-market\/v1/i, /\/api\/sb\/v1\/widgets\/view\/v1/i],

  /**
   * Fetch directo a la API interna de Betsson: lista de partidos + cuotas por lotes. Lanza si la lista falla;
   * los lotes de cuotas que fallen se omiten (se registran) para no perder el resto.
   * @param sportSlug 'futbol' | 'tenis' | 'baloncesto' | 'tenis-de-mesa'
   */
  async fetchDirect(sportSlug: string = 'futbol'): Promise<BookmakerOdd[]> {
    const cfg = BETSSON_SPORTS[sportSlug];
    if (!cfg) throw new Error(`Betsson: deporte '${sportSlug}' no soportado (soportados: ${Object.keys(BETSSON_SPORTS).join(', ')})`);

    const listed = await listEvents(cfg);
    console.log(`📡 [Betsson] [${sportSlug}] ${listed.length} partidos listados`);
    if (listed.length === 0) return [];

    const referer = `${BETSSON_BASE}/apuestas-deportivas/${cfg.slug}?tab=allLeagues`;
    const batches = batchEvents(
      listed.map((e) => e.eventId),
      cfg.templates,
    );
    const all: BookmakerOdd[] = [];
    let failed = 0;
    const queue = [...batches];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          const ids = queue.shift()!;
          const marketIds = ids.flatMap((id) => cfg.templates.map((t) => `m-${id}-${t}`));
          const url = `${BETSSON_BASE}/api/sb/v1/widgets/event-market/v1?includescoreboards=false&marketids=${marketIds.join(',')}`;
          try {
            const json = await getJson(url, 'SPORTSBOOK_CATEGORY_WIDGET_REQUEST', referer);
            all.push(...parseBetssonMarkets(json?.data, cfg.sport));
          } catch (e: any) {
            failed++;
            console.warn(`⚠️ [Betsson] lote de ${ids.length} partidos falló: ${e.message}`);
          }
        }
      }),
    );

    console.log(`✅ [Betsson] fetchDirect [${sportSlug}]: ${all.length} odds (${batches.length} lotes${failed ? `, ${failed} fallidos` : ''})`);
    return all;
  },

  /** Fallback: extrae odds de respuestas de event-market capturadas por el interceptor Playwright. */
  extract(payloads: CapturedPayload[]): BookmakerOdd[] {
    const odds: BookmakerOdd[] = [];
    for (const payload of payloads) {
      const json: any = (payload as any)?.json ?? (payload as any)?.body ?? payload;
      const data = json?.data ?? json;
      const category = data?.events?.[0]?.categoryId;
      const sport = (Object.values(BETSSON_SPORTS).find((s) => String(s.categoryId) === String(category)) ?? BETSSON_SPORTS.futbol).sport;
      odds.push(...parseBetssonMarkets(data, sport));
    }
    console.log(`📊 [Betsson] extract() vía interceptor: ${odds.length} odds`);
    return odds;
  },
};
