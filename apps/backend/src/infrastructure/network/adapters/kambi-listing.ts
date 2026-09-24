/**
 * Listado completo de partidos de un deporte en la API pública de Kambi (BetPlay, Rushbet).
 *
 * `listView/{deporte}.json` no devuelve todo: según la hora, Kambi responde en "modo cercano" (`soonMode`:
 * HOURLY / DAILY / MONTHLY) y limita la lista a los partidos que empiezan pronto. Comprobado con Rushbet: la misma
 * llamada dio 757 partidos de fútbol en una hora y 162 en otra, cuando el árbol de grupos tenía más de 3.000 eventos.
 *
 * Solución: si la respuesta trae `soonMode`, se recorre cada región del árbol de grupos (`group.json`, ~76 en fútbol)
 * con `listView/{deporte}/{región}.json` y se unen los eventos por id. ~1,5 s con concurrencia 8 y recupera ~1.050
 * partidos de fútbol en 40 días. Bajar además al nivel de liga (189 llamadas más) solo suma ~3 %, así que no se hace.
 */

export interface KambiListingOptions {
  /** Oferta de Kambi: 'rsico' (Rushbet), 'betplay'. */
  offering: string;
  /** Hosts a probar en orden (p. ej. ['us', 'eu']). */
  hosts: string[];
  /** Cabeceras de la petición (Referer/Origin de la casa). */
  headers: Record<string, string>;
  /** Query fija de la casa: lang, market, client_id, channel_id. */
  query: string;
  /** Tope de llamadas simultáneas del barrido. */
  concurrency?: number;
}

export interface KambiListing {
  events: any[];
  soonMode?: string;
  swept: boolean;
  regionsFetched: number;
  regionsFailed: number;
}

async function getJson(url: string, headers: Record<string, string>): Promise<any | null> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchKambiListing(sportSlug: string, opts: KambiListingOptions): Promise<KambiListing> {
  const { offering, hosts, headers, query } = opts;
  const concurrency = opts.concurrency ?? 8;
  const flags = 'useCombined=true&useCombinedLive=true';
  const base = (host: string) => `https://${host}.offering-api.kambicdn.com/offering/v2018/${offering}`;
  const url = (host: string, path: string, extra = '') => `${base(host)}${path}?${query}&${flags}${extra}&ncid=${Date.now()}`;

  // 1) Llamada principal (con respaldo de host).
  let host = '';
  let main: any = null;
  let lastError = 'sin respuesta';
  for (const h of hosts) {
    for (let attempt = 0; attempt < 2 && !main; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(url(h, `/listView/${sportSlug}.json`), { headers });
        if (!res.ok) {
          lastError = `HTTP ${res.status} en ${h}`;
          if (res.status < 500) break; // 4xx: reintentar no cambia nada
          continue;
        }
        main = await res.json();
        host = h;
      } catch (e: any) {
        lastError = `${h}: ${e?.message}`; // fallo de red: un reintento
      }
    }
    if (main) break;
  }
  if (!main) throw new Error(`Kambi ${offering}/${sportSlug}: ${lastError}`);

  const events = new Map<number, any>();
  for (const e of Array.isArray(main.events) ? main.events : []) if (e?.event?.id !== undefined) events.set(e.event.id, e);

  // 2) Modo cercano: barrer las regiones del árbol de grupos.
  if (!main.soonMode) return { events: [...events.values()], swept: false, regionsFetched: 0, regionsFailed: 0 };

  const tree = await getJson(url(host, '/group.json', '&depth=3'), headers);
  const sportGroup = (tree?.group?.groups || []).find((g: any) => g?.termKey === sportSlug);
  const regions: string[] = (sportGroup?.groups || []).filter((r: any) => (r?.eventCount ?? 0) > 0).map((r: any) => r.termKey);

  let fetched = 0;
  let failed = 0;
  const queue = [...regions];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const region = queue.shift()!;
        const data = await getJson(url(host, `/listView/${sportSlug}/${encodeURIComponent(region)}.json`), headers);
        if (!data || !Array.isArray(data.events)) {
          failed++;
          continue;
        }
        fetched++;
        for (const e of data.events) if (e?.event?.id !== undefined) events.set(e.event.id, e);
      }
    }),
  );

  return { events: [...events.values()], soonMode: main.soonMode, swept: true, regionsFetched: fetched, regionsFailed: failed };
}
