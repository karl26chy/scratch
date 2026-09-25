export const API_BASE = 'http://localhost:4000/api';

export type SportKey = 'football' | 'tennis' | 'basketball' | 'table_tennis';
export type HouseKey = 'betplay' | 'stake' | 'wplay' | 'bwin' | 'rushbet' | 'betsson';

export interface SportInfo {
  key: SportKey;
  label: string;
  icon: string;
}

export const SPORTS: SportInfo[] = [
  { key: 'football', label: 'Fútbol', icon: '⚽' },
  { key: 'tennis', label: 'Tenis', icon: '🎾' },
  { key: 'basketball', label: 'Baloncesto', icon: '🏀' },
  { key: 'table_tennis', label: 'Tenis de Mesa', icon: '🏓' },
];

export interface HouseConfig {
  key: HouseKey;
  label: string;
  /** URL de cada deporte, tal como las usa el módulo dedicado de la casa. */
  urls: Record<SportKey, string>;
  /** Tiempo máximo (ms) que el cliente espera la respuesta de la casa completa. */
  clientTimeoutMs: number;
  /** timeoutMs que se envía al backend. */
  backendTimeoutMs: number;
  /** Cómo obtiene las cuotas (informativo). */
  method: string;
  /** Usa un navegador (Playwright): se ejecuta en cola, una casa de navegador a la vez, para evitar bloqueos. */
  browser: boolean;
}

export const HOUSES: HouseConfig[] = [
  {
    key: 'betplay',
    label: 'BetPlay',
    urls: {
      football: 'https://tienda.betplay.com.co/apuestas#sports-hub/football',
      tennis: 'https://tienda.betplay.com.co/apuestas#sports-hub/tennis',
      basketball: 'https://tienda.betplay.com.co/apuestas#sports-hub/basketball',
      table_tennis: 'https://tienda.betplay.com.co/apuestas#sports-hub/table_tennis',
    },
    clientTimeoutMs: 60_000,
    backendTimeoutMs: 45_000,
    method: 'API Kambi',
    browser: false,
  },
  {
    key: 'stake',
    label: 'Stake',
    urls: {
      football: 'https://stake.com.co/deportes/football',
      tennis: 'https://stake.com.co/deportes/tennis',
      basketball: 'https://stake.com.co/deportes/basketball',
      table_tennis: 'https://stake.com.co/deportes/table-tennis',
    },
    clientTimeoutMs: 240_000,
    backendTimeoutMs: 60_000,
    method: 'Navegador (KickerTech)',
    browser: true,
  },
  {
    key: 'wplay',
    label: 'Wplay',
    urls: {
      football: 'https://apuestas.wplay.co/es/s/FOOT/F%C3%BAtbol',
      tennis: 'https://apuestas.wplay.co/es/s/TENN/Tenis',
      basketball: 'https://apuestas.wplay.co/es/s/BASK/Baloncesto',
      table_tennis: 'https://apuestas.wplay.co/es/s/TABL/Tenis-de-mesa',
    },
    clientTimeoutMs: 300_000,
    backendTimeoutMs: 35_000,
    method: 'Navegador',
    browser: true,
  },
  {
    key: 'bwin',
    label: 'Bwin',
    urls: {
      football: 'https://www.bwin.co/es/sports/f%C3%BAtbol-4/apuestas',
      tennis: 'https://www.bwin.co/es/sports/tenis-5/apuestas',
      basketball: 'https://www.bwin.co/es/sports/baloncesto-7/apuestas',
      table_tennis: 'https://www.bwin.co/es/sports/tenis-de-mesa-56/apuestas',
    },
    clientTimeoutMs: 60_000,
    backendTimeoutMs: 45_000,
    method: 'API directa',
    browser: false,
  },
  {
    key: 'rushbet',
    label: 'Rushbet',
    urls: {
      football: 'https://www.rushbet.co/?page=sportsbook#filter/football/',
      tennis: 'https://www.rushbet.co/?page=sportsbook#filter/tennis/',
      basketball: 'https://www.rushbet.co/?page=sportsbook#filter/basketball/',
      table_tennis: 'https://www.rushbet.co/?page=sportsbook#filter/table_tennis/',
    },
    clientTimeoutMs: 60_000,
    backendTimeoutMs: 45_000,
    method: 'API Kambi',
    browser: false,
  },
  {
    key: 'betsson',
    label: 'Betsson',
    urls: {
      football: 'https://www.betsson.co/apuestas-deportivas/futbol?tab=allLeagues',
      tennis: 'https://www.betsson.co/apuestas-deportivas/tenis',
      basketball: 'https://www.betsson.co/apuestas-deportivas/baloncesto',
      table_tennis: 'https://www.betsson.co/apuestas-deportivas/tenis-de-mesa',
    },
    clientTimeoutMs: 60_000,
    backendTimeoutMs: 45_000,
    method: 'API directa',
    browser: false,
  },
];

export interface HouseResult {
  state: 'idle' | 'queued' | 'loading' | 'success' | 'partial' | 'error';
  matches?: number;
  oddsCount?: number;
  bySport?: Partial<Record<SportKey, number>>;
  failedSports?: SportKey[];
  durationMs?: number;
  error?: string;
}

const EMPTY_SELECTORS = { events: '', homeTeam: '', awayTeam: '', oddsHome: '', oddsDraw: '', oddsAway: '' };

/** Scrapea una casa para los deportes indicados (una sola petición con todas las URLs). */
export async function scrapeHouse(house: HouseConfig, sports: SportKey[]): Promise<HouseResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), house.clientTimeoutMs);
  try {
    const urls = sports.map((s) => house.urls[s]);
    const res = await fetch(`${API_BASE}/scrape/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // origin: 'global' → el backend guarda estas cuotas en el almacén que usa el módulo Arbitraje & Surebets.
      body: JSON.stringify({ urls, selectors: EMPTY_SELECTORS, useProxy: false, timeoutMs: house.backendTimeoutMs, origin: 'global' }),
      signal: controller.signal,
    });
    const data = await res.json();
    const durationMs = Date.now() - started;
    const matches: any[] = Array.isArray(data.matches) ? data.matches : [];

    const bySport: Partial<Record<SportKey, number>> = {};
    for (const m of matches) {
      const sp = (m.sport || 'football') as SportKey;
      bySport[sp] = (bySport[sp] || 0) + 1;
    }

    if (matches.length === 0) {
      return { state: 'error', durationMs, error: data.message || data.error || 'Sin cuotas capturadas' };
    }

    const failedUrls: string[] = (data.failedUrls || []).map((f: any) => f.url);
    const failedSports = sports.filter((s) => failedUrls.includes(house.urls[s]));
    return {
      state: failedSports.length > 0 ? 'partial' : 'success',
      matches: matches.length,
      oddsCount: data.oddsCount ?? matches.length,
      bySport,
      failedSports,
      durationMs,
    };
  } catch (e: any) {
    const timedOut = e?.name === 'AbortError';
    return {
      state: 'error',
      durationMs: Date.now() - started,
      error: timedOut ? `Sin respuesta tras ${Math.round(house.clientTimeoutMs / 1000)} s` : e?.message || 'Error de conexión',
    };
  } finally {
    clearTimeout(timer);
  }
}
