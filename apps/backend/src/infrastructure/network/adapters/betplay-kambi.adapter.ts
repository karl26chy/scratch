import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import type { BookmakerOdd } from '../../../domain/types/surebet.types.js';
import type { CapturedPayload } from '../odds-interceptor.js';

/**
 * Adapter para BetPlay (tienda.betplay.com.co) — motor Kambi (KambiBC).
 * El sportsbook de BetPlay renderiza un widget Kambi que carga las cuotas vía
 * la API pública de Kambi (us.offering-api.kambicdn.com), no vía el DOM
 * directamente. Este adapter intercepta esas respuestas JSON y las normaliza
 * a BookmakerOdd[].
 *
 * Endpoint identificado (fútbol, listado general):
 *   https://us.offering-api.kambicdn.com/offering/v2018/betplay/listView/football/all/all.json
 *     ?lang=es_ES&market=CO&client_id=2&channel_id=1&ncid=<ts>&useCombined=true&useCombinedLive=true
 *
 * Estructura de la respuesta:
 *   { events: [ { event: { id, name, homeName, awayName, sport, ... }, betOffers: [...] } ] }
 *
 * El mercado 1X2 (Resultado Final) es el betOffer con betOfferType.id === 2.
 * Cada outcome trae `type` ('OT_ONE' | 'OT_CROSS' | 'OT_TWO') y `odds` como
 * entero decimal * 1000 (p.ej. 1490 -> 1.49). Los outcomes suspendidos no
 * traen el campo `odds`.
 */
export const betplayKambiAdapter: SiteOddsAdapter = {
  domain: 'tienda.betplay.com.co',

  urlPatterns: [
    /kambicdn\.com/i,
    /offering-api/i,
    /\/offering\/v2018\//i,
    /listView\//i,
    /betplay\/listView/i,
  ],

  extract(payloads: CapturedPayload[]): BookmakerOdd[] {
    const odds: BookmakerOdd[] = [];
    const now = new Date().toISOString();

    for (const payload of payloads) {
      try {
        const data: any = (payload as any)?.json ?? (payload as any)?.body ?? payload;
        const events: any[] = Array.isArray(data?.events) ? data.events : [];
        if (events.length === 0) continue;

        for (const item of events) {
          const ev = item?.event;
          if (!ev) continue;
          const homeTeam: string = ev.homeName || (ev.name || '').split(ev.nameDelimiter || '-')[0]?.trim() || 'Home';
          const awayTeam: string = ev.awayName || (ev.name || '').split(ev.nameDelimiter || '-')[1]?.trim() || 'Away';
          const eventName = `${homeTeam} vs ${awayTeam}`;

          const betOffers: any[] = Array.isArray(item.betOffers) ? item.betOffers : [];
          const mainOffer = betOffers.find((bo: any) => bo?.betOfferType?.id === 2);
          if (!mainOffer || !Array.isArray(mainOffer.outcomes)) continue;

          for (const outcome of mainOffer.outcomes) {
            if (typeof outcome?.odds !== 'number') continue; // suspendido / sin precio
            let selection: string;
            if (outcome.type === 'OT_ONE') selection = homeTeam;
            else if (outcome.type === 'OT_CROSS') selection = 'Empate';
            else if (outcome.type === 'OT_TWO') selection = awayTeam;
            else selection = outcome.label || outcome.englishLabel || 'Unknown';

            odds.push({
              bookmaker: 'BetPlay',
              eventName,
              sport: 'football',
              marketType: '1X2',
              selection,
              odd: outcome.odds / 1000,
              timestamp: now,
            });
          }
        }
      } catch (error: any) {
        console.warn('⚠️ [BetPlay/Kambi] Error procesando payload:', error.message);
      }
    }

    console.log(`📊 [BetPlay/Kambi] Total odds extraídas: ${odds.length}`);
    return odds.filter((o) => !isNaN(o.odd) && o.odd > 1.0);
  },
};
