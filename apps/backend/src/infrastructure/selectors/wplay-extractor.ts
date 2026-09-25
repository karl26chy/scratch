import type { Page } from 'playwright';
import type { BookmakerOdd, SportType } from '../../domain/types/surebet.types.js';

/**
 * Extractor dedicado de Wplay (apuestas.wplay.co, plataforma Geneity/Playtech).
 *
 * Wplay renderiza las listas de deporte en el servidor: no hay API JSON de cuotas, solo DOM. El extractor genérico
 * tomaba TODOS los botones de cuota de la página y los nombraba por heurística, así que hándicaps, totales y sets
 * llegaban como "ganador", con selecciones vacías y a veces con el deporte equivocado. Este extractor lee la
 * estructura real:
 *
 *  - Cada botón de cuota (`button.price[name=add-to-slip]`) trae su evento (`ev-{id}`) y su mercado (`mkt-{id}`).
 *  - Diseño europeo (fútbol, tenis, tenis de mesa): un contenedor `.mkt` por partido con TODAS las selecciones del
 *    mercado principal; los nombres están en `.seln-name` y el empate se marca con `.seln-draw-label`.
 *  - Diseño US (baloncesto): una fila por equipo (visitante primero, local después) y una celda por mercado con
 *    clase `mkt-sort-{CÓDIGO}`: FHOT = hándicap, FTPO = total de puntos, H2HT = ganador (moneyline). Solo se usa H2HT.
 *
 * El deporte sale de la URL (`/FOOT/`, `/TENN/`, `/BASK/`, `/TABL/`), no de heurísticas de texto de la página, y solo
 * se lee la lista principal (`.pager`), no los widgets de destacados/en vivo que muestran otros deportes.
 */

const SPORT_BY_URL_CODE: Record<string, SportType> = {
  FOOT: 'football',
  TENN: 'tennis',
  BASK: 'basketball',
  TABL: 'table_tennis',
};

export function wplaySportFromUrl(url: string): SportType | null {
  const m = url.match(/\/es\/s\/([A-Z]{4})\b/);
  return (m && SPORT_BY_URL_CODE[m[1]]) || null;
}

interface RawButton {
  mktId: string | null;
  sortCode: string | null;
  name: string | null;
  isDraw: boolean;
  odd: number;
  rowIdx: number;
}

interface RawEvent {
  evId: string;
  slug: string;
  live: boolean;
  rowTeams: string[];
  /** Hora ('19:30') y fecha ('24 Sep') que muestra la fila; los partidos en vivo no traen fecha. */
  timeText: string;
  dateText: string;
  buttons: RawButton[];
}

/**
 * Script que corre en la página (como texto: tsx/esbuild inyecta helpers `__name` en las funciones anidadas que no
 * existen en el navegador). Agrupa los botones por evento.
 */
const IN_PAGE_SCRIPT = `(() => {
  var events = {};
  // Solo la lista principal del deporte (.pager). La página también trae widgets de "en vivo y próximos" y
  // destacados con partidos de OTROS deportes que contaminaban la extracción.
  var buttons = document.querySelectorAll('.pager button.price[name="add-to-slip"]');
  if (!buttons.length) buttons = document.querySelectorAll('button.price[name="add-to-slip"]');
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    var m = String(btn.className).match(/\\bev-(\\d+)\\b/);
    if (!m) continue;
    var evId = m[1];
    var decEl = btn.querySelector('span.price.dec');
    var odd = parseFloat(((decEl && decEl.textContent) || '').replace(',', '.'));
    if (!(odd > 1)) continue;

    var ev = events[evId];
    if (!ev) {
      var link = document.querySelector('a[href*="/es/e/' + evId + '/"]');
      var slug = '';
      if (link) {
        var parts = (link.getAttribute('href') || '').split('/').filter(Boolean);
        slug = parts[parts.length - 1] || '';
        try { slug = decodeURIComponent(slug); } catch (e) {}
      }
      var live = !!document.querySelector('.ev.ev-' + evId + '.inplay');
      var evBox = document.querySelector('div.ev.ev-' + evId);
      var tEl = evBox ? evBox.querySelector('span.time') : null;
      var dEl = evBox ? evBox.querySelector('span.date') : null;
      ev = events[evId] = {
        evId: evId, slug: slug, live: live, rowTeams: [],
        timeText: tEl ? (tEl.textContent || '').trim() : '',
        dateText: dEl ? (dEl.textContent || '').trim() : '',
        buttons: [],
      };
    }

    var mktEl = btn.closest('.mkt');
    var cell = btn.closest('td.mkt-sort');
    var sortMatch = cell ? String(cell.className).match(/mkt-sort-(\\w+)/) : null;
    var nameEl = btn.querySelector('.seln-name');
    var title = (btn.getAttribute('title') || '').trim();
    var isDraw = !!btn.querySelector('.seln-draw-label') || btn.classList.contains('seln-draw') || /^(empate|draw|x)$/i.test(title);
    var tr = btn.closest('tr');
    var tbody = tr ? tr.closest('tbody') : null;
    var rowIdx = -1;
    if (tr && tbody) {
      var rows = tbody.querySelectorAll(':scope > tr');
      for (var r = 0; r < rows.length; r++) {
        if (rows[r] === tr) {
          rowIdx = r;
          var teamEl = tr.querySelector('td.event-name .team-name a');
          if (teamEl) ev.rowTeams[r] = (teamEl.getAttribute('title') || teamEl.textContent || '').trim();
        }
      }
    }
    ev.buttons.push({
      mktId: mktEl ? mktEl.getAttribute('data-mkt_id') : null,
      sortCode: sortMatch ? sortMatch[1] : null,
      name: nameEl ? (nameEl.textContent || '').trim() : null,
      isDraw: isDraw,
      odd: odd,
      rowIdx: rowIdx,
    });
  }
  return Object.keys(events).map(function (k) { return events[k]; });
})()`;

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** El nombre de un participante debe aparecer en el slug del evento ("Elina-Svitolina-v-Greet-Minnen"). */
const inSlug = (name: string, slug: string): boolean => {
  const n = norm(name);
  return n.length > 0 && norm(slug).includes(n);
};

const MONTHS: Record<string, number> = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11 };

/**
 * '24 Sep' + '19:30' (la página muestra hora UTC-3, no la de Bogotá: medido contra BetPlay/Bwin, con UTC-5 todos los
 * deportes quedaban exactamente 120 min tarde) → ISO UTC. Sin fecha (en vivo) devuelve undefined.
 * El año se infiere: la fecha más cercana en el futuro (o de hasta 2 días atrás).
 */
export function parseWplayStart(dateText: string, timeText: string, now = new Date()): string | undefined {
  const d = dateText.match(/^(\d{1,2})\s+([A-Za-záéíóúñ]{3})/);
  const t = timeText.match(/^(\d{1,2}):(\d{2})/);
  if (!d || !t) return undefined;
  const month = MONTHS[d[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')];
  if (month === undefined) return undefined;
  const at = (year: number) => new Date(Date.UTC(year, month, Number(d[1]), Number(t[1]) + 3, Number(t[2])));
  let dt = at(now.getUTCFullYear());
  if (dt.getTime() < now.getTime() - 2 * 86400000) dt = at(now.getUTCFullYear() + 1);
  return dt.toISOString();
}

/** Convierte los eventos crudos de la página en cuotas normalizadas (función pura, testeable sin navegador). */
export function parseWplayEvents(events: RawEvent[], sport: SportType, timestamp = new Date().toISOString()): BookmakerOdd[] {
  const odds: BookmakerOdd[] = [];

  for (const ev of events) {
    const startTime = parseWplayStart(ev.dateText, ev.timeText);
    const push = (home: string, away: string, marketType: '1X2' | 'MONEYLINE_2WAY', sels: Array<[string, number]>) => {
      const eventName = `${home} vs ${away}`;
      for (const [selection, odd] of sels) {
        odds.push({ bookmaker: 'Wplay', eventName, sport, marketType, selection, odd, timestamp, ...(startTime ? { startTime } : {}), ...(ev.live ? { isLive: true } : {}) });
      }
    };

    if (sport === 'basketball') {
      // Diseño US: fila 0 = visitante, fila 1 = local. Ganador = celda H2HT (una cuota por fila).
      const ml = ev.buttons.filter((b) => b.sortCode === 'H2HT');
      const away = ml.find((b) => b.rowIdx === 0);
      const home = ml.find((b) => b.rowIdx === 1);
      const awayName = ev.rowTeams[0];
      const homeName = ev.rowTeams[1];
      if (!away || !home || !awayName || !homeName) continue;
      push(homeName, awayName, 'MONEYLINE_2WAY', [
        [homeName, home.odd],
        [awayName, away.odd],
      ]);
      continue;
    }

    // Diseño europeo: buscar, entre los mercados del evento, el de ganador (sus nombres son los participantes).
    const byMarket = new Map<string, RawButton[]>();
    for (const b of ev.buttons) {
      const key = b.mktId ?? 'none';
      if (!byMarket.has(key)) byMarket.set(key, []);
      byMarket.get(key)!.push(b);
    }
    for (const btns of byMarket.values()) {
      const named = btns.filter((b) => !b.isDraw);
      const draw = btns.find((b) => b.isDraw);
      if (sport === 'football') {
        if (btns.length !== 3 || named.length !== 2 || !draw || !named[0].name || !named[1].name) continue;
        if (!inSlug(named[0].name, ev.slug) || !inSlug(named[1].name, ev.slug)) continue;
        push(named[0].name, named[1].name, '1X2', [
          [named[0].name, named[0].odd],
          ['Empate', draw.odd],
          [named[1].name, named[1].odd],
        ]);
      } else {
        if (btns.length !== 2 || named.length !== 2 || !named[0].name || !named[1].name) continue;
        if (!inSlug(named[0].name, ev.slug) || !inSlug(named[1].name, ev.slug)) continue;
        push(named[0].name, named[1].name, 'MONEYLINE_2WAY', [
          [named[0].name, named[0].odd],
          [named[1].name, named[1].odd],
        ]);
      }
      break; // un solo mercado principal por evento
    }
  }

  return odds.filter((o) => o.odd > 1.0 && !isNaN(o.odd));
}

/** Extrae las cuotas de la página de deporte de Wplay actualmente cargada. */
export async function extractWplayOdds(page: Page, url: string): Promise<BookmakerOdd[]> {
  const sport = wplaySportFromUrl(url);
  if (!sport) throw new Error(`Wplay: no se reconoce el deporte en la URL ${url} (se esperaba /FOOT/, /TENN/, /BASK/ o /TABL/)`);
  const events: RawEvent[] = await page.evaluate(IN_PAGE_SCRIPT);
  return parseWplayEvents(events, sport);
}

/** Script expuesto para pruebas directas en el navegador. */
export const WPLAY_IN_PAGE_SCRIPT = IN_PAGE_SCRIPT;
