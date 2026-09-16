import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import type { BookmakerOdd } from '../../../domain/types/surebet.types.js';
import type { CapturedPayload } from '../odds-interceptor.js';

/**
 * Adapter para Stake.com.co — KickerTech
 * El sportsbook de Stake carga las cuotas vía widget KickerTech (SbBroadcastChannel)
 * que no renderiza cuotas en el DOM inicial. Este adapter intercepta las
 * respuestas de red de KickerTech y las normaliza a BookmakerOdd[].
 *
 * Estado: PLACEHOLDER — pendiente de identificar el endpoint real y el formato
 * JSON (ver stake-kicker-discovery.ts). Una vez capturado, completar el mapeo
 * en adapt().
 */
/**
 * Helper para fecha dinámica (evita 406 por date fija)
 */
function getDynamicDateStr(): string {
  const today = new Date();
  return today.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Extrae hidenseek dinámicamente de la página (Tarea 2)
 */
export async function getHidenseek(page: any): Promise<string> {
  try {
    // 1. Buscar en window.__config__
    const hidenseek = await page.evaluate(() => {
      const config = (window as any).__config__;
      if (config && config.hidenseek) {
        return config.hidenseek;
      }
      // Buscar en window global
      const winKeys = Object.keys(window as any).filter((k) => k.toLowerCase().includes('hidenseek'));
      for (const k of winKeys) {
        const v = (window as any)[k];
        if (typeof v === 'string' && v.length > 10) return v;
      }
      return null;
    });
    if (hidenseek) {
      console.log('🔑 Hidenseek extraído de __config__:', String(hidenseek).slice(0, 30) + '...');
      return String(hidenseek);
    }
  } catch (e: any) {
    console.warn('⚠️ Error extrayendo hidenseek de __config__:', e.message);
  }

  // 2. Buscar en cookies/localStorage como fallback
  try {
    const fallback = await page.evaluate(() => {
      const cookies = document.cookie;
      const match = cookies.match(/hidenseek=([^;]+)/);
      if (match) return match[1];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.toLowerCase().includes('hidenseek')) return localStorage.getItem(k) || '';
        }
      } catch {}
      return '';
    });
    if (fallback) {
      console.log('🔑 Hidenseek extraído de cookies/localStorage:', fallback.slice(0, 30) + '...');
      return fallback;
    }
  } catch {}
  return '';
}

/**
 * Intenta fetch directo a Kicker con fecha dinámica + hidenseek (Tarea 2)
 */
async function fetchWithDate(dateStr: string, hidenseek: string = ''): Promise<CapturedPayload[]> {
  const baseUrls = [
    'https://pre-115o-sp.websbkt.com/cache/115/es/co/America-Bogota',
    'https://pre-115o-sp.websbkt.com/cache/115/es/co/Europe-Bogota',
    'https://pre-115o-sp.websbkt.com/cache/115/es/co/Europe-London',
  ];
  // Si no hay hidenseek, intentar sin token (probablemente 406, pero útil para diagnóstico)
  const hidenseekParam = hidenseek ? `&hidenseek=${encodeURIComponent(hidenseek)}` : '';
  if (!hidenseek) {
    console.warn('⚠️ fetchWithDate sin hidenseek — probablemente 406');
  }
  for (const baseUrl of baseUrls) {
    const url = `${baseUrl}/events-by-path.json?path=football&date=${dateStr}${hidenseekParam}`;
    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'es-CO,es;q=0.9',
          'Referer': 'https://stake.com.co/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
        },
      });
      if (response.status === 200) {
        const data = await response.json();
        console.log(`✅ fetchWithDate éxito ${dateStr} con hidenseek ${hidenseek ? '✅' : '❌'} -> ${baseUrl} | eventos: ${(data as any).events?.length || 0}`);
        return [{ url, json: data, timestamp: new Date().toISOString() }];
      } else {
        console.warn(`⚠️ fetchWithDate ${response.status} para ${dateStr} ${baseUrl} hidenseek=${hidenseek ? 'presente' : 'ausente'}`);
      }
    } catch (error: any) {
      console.warn(`⚠️ Error fetching with date ${baseUrl}:`, error.message);
    }
  }
  return [];
}

// Nota: events-by-path.json está acotado a UN día por llamada (parámetro `date`).
// La expansión a varios días se hace desde scraper.service.ts vía page.evaluate()
// (fetch dentro de la pestaña), no aquí — un fetch de Node sin las cookies/huella
// TLS de la sesión del navegador recibe 406 aunque se reenvíe el hidenseek correcto.

export const stakeKickerAdapter: SiteOddsAdapter & {
  fetchWithDate: typeof fetchWithDate;
  getHidenseek: typeof getHidenseek;
} = {
  domain: 'stake.com.co',

  // Patrones que deben coincidir con las URLs de la API interna de KickerTech
  // Incluye websbkt cache y WebSocket no es capturado por interceptor, pero se mapea si llega via payload
  urlPatterns: [
    /kickertech/i,
    /odds\.kickertech/i,
    /kicker/i,
    /sb\/api/i,
    /sportsbook\/odds/i,
    /market/i,
    /event/i,
    /websbkt/i,
    /events-by-path/i,
    /prematch-by-tournaments/i,
    /cache\/115/i,
  ],

  // Exponer helpers para uso externo (Tarea 2/3)
  fetchWithDate,
  getHidenseek,

  extract(payloads: any[]): BookmakerOdd[] {
    // Paso 1: fecha dinámica
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // 2026-09-03
    if (!payloads || payloads.length === 0) {
      console.warn(`⚠️ 0 payloads para fecha ${dateStr}, posible 406 — reintentar con fetchWithDate`);
      return [];
    }

    // Si los payloads contienen 406, advertir
    const has406 = payloads.some((p: any) => p.status === 406 || (p.json && (p.json as any).error === 406) || String(p.url).includes('406'));
    if (has406) {
      console.warn('⚠️ 406 detectado en payloads, reintentando con fecha actual...', dateStr);
    }

    const odds: BookmakerOdd[] = [];
    const now = new Date().toISOString();
    // Evita duplicar el mismo evento si dos payloads de fechas distintas se solapan
    const seenEventIds = new Set<unknown>();
    console.log(`📡 Extrayendo de ${payloads.length} payloads...`);

    for (const payload of payloads) {
      try {
        // Tarea 2: verificar body/json (Paso 2)
        if (!payload || (!payload.body && !payload.json && !payload.url)) {
          console.log('⚠️ Payload sin body:', (payload as any)?.url || 'unknown');
          continue;
        }
        let data: any = (payload as any).json ?? (payload as any).body ?? payload;
        // Si body es string, parsear
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            continue;
          }
        }
        // Si payload tiene body string, parsear body
        if ((payload as any).body && typeof (payload as any).body === 'string') {
          try {
            data = JSON.parse((payload as any).body);
          } catch {}
        }
        if (!data) {
          console.log('⚠️ Payload sin eventos:', (payload as any)?.url || 'unknown');
          continue;
        }
        if (!data.events && !data.data?.events && !data.result?.events && !data.items) {
          // Solo log si no es WS sports-payout
          if (!data.room && !Array.isArray(data.items)) {
            // console.log('⚠️ Payload sin eventos:', (payload as any)?.url || 'unknown');
          }
        } else if (data.events) {
          console.log(`📦 Eventos encontrados: ${Array.isArray(data.events) ? data.events.length : Object.keys(data.events).length} en ${(payload as any).url?.slice(0, 60) || 'unknown'}`);
        }
        const url = (payload as any).url || 'unknown';

      // Caso 1: KickerTech cache events-by-path.json — estructura real con main_odds.main (ODD_S1, ODD_SX, ODD_S2)
      // data = { events: [{ teams:{home,away}, tournament_name, main_odds:{main:{id:{odd_value, team_name, name}}} }], ... }
      const eventsArray: any[] =
        (Array.isArray(data.events) && data.events) ||
        (Array.isArray(data.data?.events) && data.data.events) ||
        (Array.isArray(data.result?.events) && data.result.events) ||
        (data.events && typeof data.events === 'object' && !Array.isArray(data.events) ? Object.values(data.events) : null) ||
        [];

      if (eventsArray.length > 0 && eventsArray[0]?.main_odds) {
        for (const ev of eventsArray) {
          // Dedupe: el mismo evento puede repetirse si dos fechas consultadas se solapan
          const evId = ev.id ?? ev.event_id ?? ev.short_id;
          if (evId !== undefined && seenEventIds.has(evId)) continue;
          if (evId !== undefined) seenEventIds.add(evId);

          // teams puede ser {home, away} o el evento ya trae homeTeam/awayTeam separados
          const homeTeam: string = ev.teams?.home ?? ev.home?.name ?? ev.homeTeam ?? ev.participants?.[0]?.name ?? 'Home';
          const awayTeam: string = ev.teams?.away ?? ev.away?.name ?? ev.awayTeam ?? ev.participants?.[1]?.name ?? 'Away';
          const eventName = homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : ev.eventName ?? ev.name ?? `${homeTeam} vs ${awayTeam}`;

          // Metadato informativo del deporte
          const pathParam = typeof url === 'string' ? (url.match(/[?&]path=([^&]+)/)?.[1] || '') : '';
          const rawSport = (ev.sport_name || ev.sport?.name || ev.sport_slug || pathParam || '').toLowerCase();
          const sport: any = rawSport.includes('table') || rawSport.includes('mesa')
            ? 'table_tennis'
            : rawSport.includes('tennis') || rawSport === 'tenis'
              ? 'tennis'
              : rawSport.includes('basket') || rawSport.includes('baloncesto')
                ? 'basketball'
                : 'football';

          // Clasificación estructural por mercado: presencia real de cuota de empate ('ODD_SX' o 'X')
          // Si tiene empate → 1X2 (3 vías). Si no tiene empate (tenis, basket, tenis de mesa, etc.) → MONEYLINE_2WAY (2 vías).
          const mainOdds = ev.main_odds?.main;
          const hasDraw = mainOdds && typeof mainOdds === 'object'
            ? Object.values(mainOdds).some((o: any) => o && typeof o.odd_value === 'number' && (o.odd_code === 'ODD_SX' || o.name === 'X'))
            : false;
          const marketType = hasDraw ? '1X2' : 'MONEYLINE_2WAY';

          if (mainOdds && typeof mainOdds === 'object') {
            for (const key of Object.keys(mainOdds)) {
              const o: any = mainOdds[key];
              if (!o || typeof o.odd_value !== 'number') continue;
              // Determinar selección por odd_code o name
              let selection: string = o.team_name || o.name || '';
              if (o.odd_code === 'ODD_S1' || o.name === '1') selection = homeTeam;
              else if (o.odd_code === 'ODD_SX' || o.name === 'X') selection = 'Empate';
              else if (o.odd_code === 'ODD_S2' || o.name === '2') selection = awayTeam;
              if (!selection) selection = o.team_name || o.name;

              odds.push({
                bookmaker: 'Stake',
                eventName,
                sport,
                marketType,
                selection,
                odd: Number(o.odd_value),
                timestamp: now,
              });
            }
          }

          // Mercado "Ambos Equipos Marcan" — main_odds.bothscore (ODD_FTB_BOTHTEAMSSCORE_YES/NO)
          const bothscoreOdds = ev.main_odds?.bothscore;
          if (bothscoreOdds && typeof bothscoreOdds === 'object') {
            for (const key of Object.keys(bothscoreOdds)) {
              const o: any = bothscoreOdds[key];
              if (!o || typeof o.odd_value !== 'number') continue;
              const isYes = o.odd_code === 'ODD_FTB_BOTHTEAMSSCORE_YES';
              const isNo = o.odd_code === 'ODD_FTB_BOTHTEAMSSCORE_NO';
              if (!isYes && !isNo) continue;
              odds.push({
                bookmaker: 'Stake',
                eventName,
                sport,
                marketType: 'BOTH_TEAMS_SCORE',
                selection: isYes ? 'SI' : 'NO',
                odd: Number(o.odd_value),
                timestamp: now,
              });
            }
          }

          // Mercado "Total de Goles" — main_odds.total, filtrado a la línea 2.5 (ODD_TTL_*_OVR/_UND, additional_value_raw===2.5)
          const totalOdds = ev.main_odds?.total;
          if (totalOdds && typeof totalOdds === 'object') {
            for (const key of Object.keys(totalOdds)) {
              const o: any = totalOdds[key];
              if (!o || typeof o.odd_value !== 'number') continue;
              if (Number(o.additional_value_raw) !== 2.5) continue;
              const isOver = typeof o.odd_code === 'string' && o.odd_code.endsWith('_OVR');
              const isUnder = typeof o.odd_code === 'string' && o.odd_code.endsWith('_UND');
              if (!isOver && !isUnder) continue;
              odds.push({
                bookmaker: 'Stake',
                eventName,
                sport,
                marketType: 'OVER_UNDER_2_5',
                selection: isOver ? 'OVER' : 'UNDER',
                odd: Number(o.odd_value),
                timestamp: now,
              });
            }
          }

          // Log Paso 2
          if (Object.keys(mainOdds || {}).length > 0) {
            console.log(`✅ Evento: ${homeTeam} vs ${awayTeam}`);
          }
        }
        continue;
      }

      // Caso 2: Estructura genérica con events[].markets[]->outcomes[] (tipo match_winner)
      if (eventsArray.length > 0 && eventsArray[0]?.markets) {
        for (const ev of eventsArray) {
          const homeTeam = ev.home?.name ?? ev.teams?.home ?? 'Home';
          const awayTeam = ev.away?.name ?? ev.teams?.away ?? 'Away';
          const eventName = `${homeTeam} vs ${awayTeam}`;
          const markets: any[] = ev.markets || [];
          const market = markets.find((m: any) => m.type === '1X2' || m.type === 'match_winner' || m.name === '1X2');
          if (market?.outcomes) {
            for (const out of market.outcomes) {
              const type = out.type;
              let selection = out.name || type;
              if (type === 'home') selection = homeTeam;
              else if (type === 'draw') selection = 'Empate';
              else if (type === 'away') selection = awayTeam;
              const price = out.price ?? out.odds ?? out.odd_value;
              if (price) {
                odds.push({
                  bookmaker: 'Stake',
                  eventName,
                  sport: 'football',
                  marketType: '1X2',
                  selection,
                  odd: Number(price),
                  timestamp: now,
                });
              }
            }
          }
        }
        continue;
      }

      // Caso 3: WebSocket sports-payout — { room:"sports-payout", data:{items:[{events:[{eventName, selectionName, marketName, odds}]}]}}
      // También puede venir como { room, data } directo si el interceptor capturara WS (actualmente no, pero preparado)
      if (data.room === 'sports-payout' && data.data?.items) {
        for (const item of data.data.items) {
          for (const ev of item.events || []) {
            const eventName = ev.eventName || 'Unknown';
            const selection = ev.selectionName || ev.marketName || 'Unknown';
            const odd = Number(ev.odds);
            if (!isNaN(odd) && odd > 1) {
              odds.push({
                bookmaker: 'Stake',
                eventName,
                sport: 'football',
                marketType: '1X2',
                selection,
                odd,
                timestamp: now,
              });
            }
          }
        }
        continue;
      }

      // Caso 4: Payload directo de sports-payout sin room wrapper (si se intercepta el frame crudo)
      if (Array.isArray(data.items) && data.items[0]?.events) {
        for (const item of data.items) {
          for (const ev of item.events || []) {
            const eventName = ev.eventName || 'Unknown';
            const selection = ev.selectionName || 'Unknown';
            const odd = Number(ev.odds);
            if (!isNaN(odd) && odd > 1) {
              odds.push({
                bookmaker: 'Stake',
                eventName,
                sport: 'football',
                marketType: '1X2',
                selection,
                odd,
                timestamp: now,
              });
            }
          }
        }
        continue;
      }

      // Fallback genérico: si no se reconoció, intentar buscar cualquier array con odds
      const altEvents = data?.data?.events ?? data?.markets ?? data?.result ?? null;
      if (Array.isArray(altEvents)) {
        for (const ev of altEvents) {
          const home = ev.home?.name ?? ev.teams?.home ?? 'Home';
          const away = ev.away?.name ?? ev.teams?.away ?? 'Away';
          const eventName = `${home} vs ${away}`;
          const selections = ev.odds ?? ev.selections ?? ev.outcomes ?? [];
          if (selections && typeof selections === 'object' && !Array.isArray(selections)) {
            if ((selections as any).home) odds.push({ bookmaker: 'Stake', eventName, sport: 'football', marketType: '1X2', selection: home, odd: Number((selections as any).home), timestamp: now });
            if ((selections as any).draw) odds.push({ bookmaker: 'Stake', eventName, sport: 'football', marketType: '1X2', selection: 'Empate', odd: Number((selections as any).draw), timestamp: now });
            if ((selections as any).away) odds.push({ bookmaker: 'Stake', eventName, sport: 'football', marketType: '1X2', selection: away, odd: Number((selections as any).away), timestamp: now });
          }
        }
      }
      } catch (error: any) {
        console.warn('⚠️ Error procesando payload:', error.message);
      }
    }

    console.log(`📊 Total odds extraídas: ${odds.length}`);
    return odds.filter((o) => !isNaN(o.odd) && o.odd > 1.0);
  },
};
