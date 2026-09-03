# Site Odds Adapters

Este directorio implementa el mecanismo de extracción de cuotas por **intercepción de red**
(como alternativa a los selectores CSS). Cada casa de apuestas tiene un `SiteOddsAdapter`
que sabe cómo transformar los payloads JSON capturados de su API interna en `BookmakerOdd[]`.

## Flujo para agregar un adapter nuevo

### 1. Capturar el tráfico real

```bash
npm run debug:capture -- "https://www.la-casa-de-apuestas.com/evento/123"
```

El script navega con stealth, intercepta todas las respuestas `application/json` cuyo
patrón de URL coincida con `/api/`, `/graphql`, `odds`, `market`, `sport`, `event`, `.json`,
espera `networkidle` + 2.5s y vuelca todo a:

```
debug/<host>_<timestamp>.json
```

### 2. Identificar el payload correcto

Abre el archivo generado y busca, dentro de `captured[]`, la entrada cuya:

- `url` apunte a un endpoint de datos (`/api/...`, `/graphql`, `/odds`, `/market`...).
- `json` contenga estructuras con nombres como `odds`, `price`, `selection`, `market`,
  `home`, `away`, `event`, `runner`, `outcome`.

Esa es la respuesta de la que tu adapter extraerá las cuotas. Copia la forma del JSON
para mapearla en `extract()`.

### 3. Plantilla mínima de un adapter

```ts
// apps/backend/src/infrastructure/network/adapters/bet365.adapter.ts
import type { SiteOddsAdapter } from '../../../domain/types/site-adapter.js';
import type { BookmakerOdd } from '../../../domain/types/surebet.types.js';
import type { CapturedPayload } from '../odds-interceptor.js';

export const bet365Adapter: SiteOddsAdapter = {
  domain: 'bet365.com',

  // Solo se capturan las respuestas cuya URL matchee alguno de estos patrones.
  urlPatterns: [/\/api\//i, /odds/i],

  extract(payloads: CapturedPayload[]): BookmakerOdd[] {
    const odds: BookmakerOdd[] = [];

    for (const { json } of payloads) {
      // 1) Navegar la estructura real del JSON (ajustar a lo visto en debug/).
      const events = (json as any)?.data?.events ?? [];
      for (const ev of events) {
        for (const sel of ev.selections ?? []) {
          odds.push({
            bookmaker: 'Bet365',
            eventName: ev.name ?? 'Unknown',
            sport: 'football',                 // SportType
            marketType: '1X2',                // MarketType
            selection: sel.name,              // '1' | 'X' | '2' | ...
            odd: Number(sel.price),           // cuota decimal
            url: undefined,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return odds;
  },
};
```

### 4. Registrarlo

En `apps/backend/src/infrastructure/network/adapters/index.ts`:

```ts
import { bet365Adapter } from './bet365.adapter.js';

export function registerAllAdapters(): void {
  const registry = SiteAdapterRegistry.getInstance();
  registry.register(bet365Adapter);
}
```

Con el adapter registrado, `scraper.service.ts` lo detecta por hostname y usa
intercepción de red automáticamente; si no hay adapter para el dominio, cae al
scraping por selectores CSS original.

## Archivos

- `odds-interceptor.ts` — `OddsNetworkInterceptor` (captura responses JSON).
- `adapter-registry.ts` — `SiteAdapterRegistry` singleton (`register`, `getForUrl`).
- `site-adapter.ts` (en `domain/types`) — interfaz `SiteOddsAdapter`.
- `index.ts` — `registerAllAdapters()` (punto de registro central).
- `debug-capture.ts` (en `src/scripts`) — script de inspección.
