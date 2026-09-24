import React, { useEffect, useRef, useState } from 'react';
import { Zap, Loader2, CheckCircle2, XCircle, Circle, AlertTriangle } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { formatCOP } from '../../../shared/utils/formatters.js';
import { API_BASE, HOUSES, SPORTS, scrapeHouse } from '../houses.js';
import type { HouseKey, HouseResult, SportKey } from '../houses.js';

const DEFAULT_BANKROLL = 1000000; // COP
const STORAGE_KEY = 'scraping_global_selection';

type SportChoice = 'all' | SportKey;

/** Cómo se reparten las casas seleccionadas en el tiempo. */
type ExecMode = 'smart' | 'parallel' | 'sequential';

const EXEC_MODES: Array<{ key: ExecMode; label: string; hint: string }> = [
  {
    key: 'smart',
    label: '⚡ Recomendado',
    hint: 'Casas con API al mismo tiempo; Stake y Wplay (navegador) una tras otra. Evita los bloqueos intermitentes de Stake.',
  },
  {
    key: 'parallel',
    label: '🚀 Todas al mismo tiempo',
    hint: 'Las casas seleccionadas arrancan a la vez, incluidos Stake y Wplay. Es lo más rápido, pero Stake puede fallar a veces.',
  },
  {
    key: 'sequential',
    label: '🐢 Una por una',
    hint: 'Solo una casa a la vez, en el orden de la lista. Es lo más lento y lo más estable.',
  },
];

interface FreshnessRow {
  bookmaker: string;
  sport: SportKey;
  count: number;
  ageMinutes: number;
  stale: boolean;
}

interface SurebetRow {
  id: string;
  eventName: string;
  sport: SportKey;
  marketType: string;
  outcomes: Array<{ selection: string; bookmaker: string; odd: number }>;
  profitMarginPercentage: number;
  isLive?: boolean;
}

const ALL_HOUSE_KEYS = HOUSES.map((h) => h.key);
const idleResults = (): Record<HouseKey, HouseResult> =>
  Object.fromEntries(ALL_HOUSE_KEYS.map((k) => [k, { state: 'idle' } as HouseResult])) as Record<HouseKey, HouseResult>;

function loadSelection(): { houses: HouseKey[]; sport: SportChoice; mode: ExecMode } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const houses = (raw?.houses as HouseKey[] | undefined)?.filter((k) => ALL_HOUSE_KEYS.includes(k));
    const sport: SportChoice = raw?.sport === 'all' || SPORTS.some((s) => s.key === raw?.sport) ? raw.sport : 'all';
    const mode: ExecMode = EXEC_MODES.some((m) => m.key === raw?.mode) ? raw.mode : 'smart';
    if (houses && houses.length > 0) return { houses, sport, mode };
  } catch {
    /* sin almacenamiento: usa valores por defecto */
  }
  return { houses: ALL_HOUSE_KEYS, sport: 'all', mode: 'smart' };
}

const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// Módulo "Scraping Global": scrapea varias casas de apuestas al mismo tiempo, para todos los deportes
// o para uno solo, y calcula los surebets con las cuotas recién obtenidas.
export const ScrapeGlobalPage: React.FC = () => {
  const initial = useRef(loadSelection()).current;
  const [selectedHouses, setSelectedHouses] = useState<HouseKey[]>(initial.houses);
  const [sport, setSport] = useState<SportChoice>(initial.sport);
  const [mode, setMode] = useState<ExecMode>(initial.mode);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<HouseKey, HouseResult>>(idleResults());
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [ranScope, setRanScope] = useState<{ houses: HouseKey[]; sport: SportChoice; mode: ExecMode } | null>(null);
  const [surebets, setSurebets] = useState<SurebetRow[]>([]);
  const [totalOdds, setTotalOdds] = useState<number | null>(null);
  const [freshness, setFreshness] = useState<FreshnessRow[]>([]);
  const [ttlMinutes, setTtlMinutes] = useState(60);
  const [surebetsError, setSurebetsError] = useState<string | null>(null);
  const startedAt = useRef<Record<string, number>>({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ houses: selectedHouses, sport, mode }));
    } catch {
      /* ignorar */
    }
  }, [selectedHouses, sport, mode]);

  // Cronómetro por casa mientras está en curso
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      const now = Date.now();
      setElapsed(Object.fromEntries(Object.entries(startedAt.current).map(([k, v]) => [k, now - v])));
    }, 250);
    return () => clearInterval(t);
  }, [running]);

  const allSelected = selectedHouses.length === HOUSES.length;
  const toggleHouse = (key: HouseKey) =>
    setSelectedHouses((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  const toggleAll = () => setSelectedHouses(allSelected ? [] : ALL_HOUSE_KEYS);

  const sportsToRun: SportKey[] = sport === 'all' ? SPORTS.map((s) => s.key) : [sport];
  const canRun = !running && selectedHouses.length > 0;

  const handleRun = async () => {
    if (!canRun) return;
    const houses = HOUSES.filter((h) => selectedHouses.includes(h.key));
    const scopeSport = sport;
    const scopeMode = mode;
    setRunning(true);
    setDone(false);
    setSurebets([]);
    setFreshness([]);
    setSurebetsError(null);
    setTotalMs(null);
    setRanScope({ houses: houses.map((h) => h.key), sport: scopeSport, mode: scopeMode });

    const t0 = Date.now();
    startedAt.current = {};
    setElapsed({});
    // Casas que arrancan de inmediato y casas que esperan turno, según el modo elegido.
    const startsNow = (h: (typeof HOUSES)[number], index: number) =>
      scopeMode === 'parallel' || (scopeMode === 'smart' && !h.browser) || (scopeMode === 'sequential' && index === 0);
    setResults({
      ...idleResults(),
      ...Object.fromEntries(
        houses.map((h, i) => [h.key, { state: startsNow(h, i) ? 'loading' : 'queued' } as HouseResult]),
      ),
    });

    const runOne = async (house: (typeof HOUSES)[number]) => {
      startedAt.current[house.key] = Date.now();
      setResults((cur) => ({ ...cur, [house.key]: { state: 'loading' } }));
      const result = await scrapeHouse(house, sportsToRun);
      delete startedAt.current[house.key];
      setResults((cur) => ({ ...cur, [house.key]: result }));
    };

    if (scopeMode === 'parallel') {
      await Promise.all(houses.map(runOne));
    } else if (scopeMode === 'sequential') {
      for (const house of houses) await runOne(house);
    } else {
      // Recomendado: API directa en paralelo; casas con navegador (Stake, Wplay) una tras otra, en paralelo
      // con las anteriores — dos navegadores a la vez provocaban bloqueos intermitentes de Stake.
      const browserQueue = houses.filter((h) => h.browser);
      await Promise.all([
        ...houses.filter((h) => !h.browser).map(runOne),
        (async () => {
          for (const house of browserQueue) await runOne(house);
        })(),
      ]);
    }

    setTotalMs(Date.now() - t0);
    try {
      const res = await fetch(`${API_BASE}/surebets/calculate?totalStake=${DEFAULT_BANKROLL}`);
      const json = await res.json();
      if (json.success) {
        setSurebets(json.data.opportunities || []);
        setTotalOdds(json.data.stats?.total ?? null);
        setFreshness(json.data.freshness || []);
        setTtlMinutes(json.data.ttlMinutes ?? 60);
      } else {
        setSurebetsError('No se pudo calcular surebets tras el scraping.');
      }
    } catch {
      setSurebetsError('Error de conexión al calcular surebets.');
    } finally {
      setRunning(false);
      setDone(true);
    }
  };

  // Solo oportunidades del deporte elegido y con todas las patas en las casas scrapeadas
  const scope = ranScope ?? { houses: selectedHouses, sport };
  const visibleSurebets = surebets.filter(
    (sb) =>
      (scope.sport === 'all' || sb.sport === scope.sport) &&
      sb.outcomes.every((o) => scope.houses.some((h) => o.bookmaker.toLowerCase().includes(h))),
  );

  // Datos guardados de las casas/deporte elegidos que superan el TTL: la calculadora los ignoró.
  const staleRows = freshness.filter(
    (f) =>
      f.stale &&
      scope.houses.some((h) => f.bookmaker.toLowerCase().includes(h)) &&
      (scope.sport === 'all' || f.sport === scope.sport),
  );

  const renderIcon = (r: HouseResult) => {
    if (r.state === 'queued') return <Circle size={16} color="#94a3b8" />;
    if (r.state === 'loading') return <Loader2 size={16} color="#38bdf8" style={{ animation: 'spin 1s linear infinite' }} />;
    if (r.state === 'success') return <CheckCircle2 size={16} color="#34d399" />;
    if (r.state === 'partial') return <AlertTriangle size={16} color="#fbbf24" />;
    if (r.state === 'error') return <XCircle size={16} color="#f87171" />;
    return <Circle size={16} color="var(--text-muted)" />;
  };

  const chip = (active: boolean, disabled = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    padding: '0.5rem 0.9rem',
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${active ? 'rgba(99,102,241,0.7)' : 'var(--border-color)'}`,
    background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.03)',
    color: active ? '#a5b4fc' : 'var(--text-primary)',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  });

  const sportLabel = (k: SportKey) => {
    const s = SPORTS.find((x) => x.key === k);
    return s ? `${s.icon} ${s.label}` : k;
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>🌐 Scraping Global</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Scrapea varias casas de apuestas al mismo tiempo, para todos los deportes o solo uno, y calcula los surebets
          automáticamente al terminar.
        </p>
      </div>

      <Card title="1. Casas de apuestas" subtitle={`${selectedHouses.length} de ${HOUSES.length} seleccionadas`}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button id="global-house-all" type="button" disabled={running} onClick={toggleAll} style={chip(allSelected, running)}>
            {allSelected ? '✓ ' : ''}Todas las casas
          </button>
          {HOUSES.map((h) => {
            const active = selectedHouses.includes(h.key);
            return (
              <button
                key={h.key}
                id={`global-house-${h.key}`}
                type="button"
                disabled={running}
                onClick={() => toggleHouse(h.key)}
                style={chip(active, running)}
                title={h.method}
              >
                {active ? '✓ ' : ''}
                {h.label}
              </button>
            );
          })}
        </div>
      </Card>

      <div style={{ height: '1rem' }} />

      <Card title="2. Deporte" subtitle="Todos los deportes o uno específico">
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button id="global-sport-all" type="button" disabled={running} onClick={() => setSport('all')} style={chip(sport === 'all', running)}>
            🌐 Todos los deportes
          </button>
          {SPORTS.map((s) => (
            <button
              key={s.key}
              id={`global-sport-${s.key}`}
              type="button"
              disabled={running}
              onClick={() => setSport(s.key)}
              style={chip(sport === s.key, running)}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </Card>

      <div style={{ height: '1rem' }} />

      <Card title="3. Ejecución" subtitle="Qué casas se scrapean al mismo tiempo">
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {EXEC_MODES.map((m) => (
            <button
              key={m.key}
              id={`global-mode-${m.key}`}
              type="button"
              disabled={running}
              onClick={() => setMode(m.key)}
              style={chip(mode === m.key, running)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {EXEC_MODES.find((m) => m.key === mode)?.hint}
        </p>
        {(mode === 'smart' || mode === 'sequential') && selectedHouses.some((k) => HOUSES.find((h) => h.key === k)?.browser) && (
          <p style={{ marginTop: '0.25rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            ℹ️ Stake y Wplay usan navegador: con todos los deportes tardan bastante más que las casas con API directa.
          </p>
        )}
      </Card>

      <button
        id="global-scrape-btn"
        onClick={handleRun}
        disabled={!canRun}
        style={{
          width: '100%',
          marginTop: '1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          padding: '0.9rem',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: !canRun ? 'rgba(99,102,241,0.3)' : 'linear-gradient(90deg, #6366f1, #06b6d4)',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.95rem',
          cursor: !canRun ? 'not-allowed' : 'pointer',
        }}
      >
        {running ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={18} />}
        {running
          ? `Scrapeando ${selectedHouses.length} casa${selectedHouses.length !== 1 ? 's' : ''}...`
          : selectedHouses.length === 0
            ? 'Selecciona al menos una casa'
            : `Scrapear ${allSelected ? 'todas las casas' : `${selectedHouses.length} casa${selectedHouses.length !== 1 ? 's' : ''}`} · ${
                sport === 'all' ? 'todos los deportes' : SPORTS.find((s) => s.key === sport)?.label
              }`}
      </button>

      {(running || done) && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card
            title="📡 Progreso por casa"
            subtitle={
              totalMs !== null
                ? `Scraping completado en ${fmtSecs(totalMs)}`
                : (ranScope?.mode ?? mode) === 'parallel'
                  ? 'Todas las casas al mismo tiempo'
                  : (ranScope?.mode ?? mode) === 'sequential'
                    ? 'Una casa a la vez'
                    : 'Casas con API en paralelo · casas con navegador en cola'
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {HOUSES.filter((h) => (ranScope?.houses ?? selectedHouses).includes(h.key)).map((h) => {
                const r = results[h.key];
                const secs = r.state === 'loading' ? elapsed[h.key] : r.durationMs;
                return (
                  <div
                    key={h.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                      padding: '0.6rem 0.75rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    {renderIcon(r)}
                    <strong style={{ minWidth: '80px', color: 'var(--text-primary)' }}>{h.label}</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', minWidth: '70px' }}>
                      {secs !== undefined ? fmtSecs(secs) : ''}
                    </span>
                    {(r.state === 'success' || r.state === 'partial') && (
                      <>
                        <Badge variant="success">{r.matches} partidos</Badge>
                        <Badge variant="info">{r.oddsCount} cuotas</Badge>
                        {(Object.entries(r.bySport || {}) as Array<[SportKey, number]>).map(([sp, n]) => (
                          <span key={sp} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {sportLabel(sp)} {n}
                          </span>
                        ))}
                      </>
                    )}
                    {r.state === 'partial' && (
                      <span style={{ fontSize: '0.75rem', color: '#fbbf24' }}>
                        sin datos: {(r.failedSports || []).map(sportLabel).join(', ')}
                      </span>
                    )}
                    {r.state === 'queued' && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>en cola</span>}
                    {r.state === 'error' && <span style={{ fontSize: '0.8rem', color: '#f87171' }}>{r.error}</span>}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {done && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card
            title="📊 Surebets"
            subtitle={`${totalOdds ?? 0} cuotas combinadas · bankroll ${formatCOP(DEFAULT_BANKROLL)} · ${
              scope.sport === 'all' ? 'todos los deportes' : SPORTS.find((s) => s.key === scope.sport)?.label
            } · solo entre las casas scrapeadas`}
          >
            {staleRows.length > 0 && (
              <div
                style={{
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  background: 'rgba(245,158,11,0.1)',
                  border: '1px solid rgba(245,158,11,0.3)',
                  borderRadius: 'var(--radius-md)',
                  color: '#fbbf24',
                  fontSize: '0.8rem',
                }}
              >
                <strong>⚠️ Cuotas vencidas (más de {ttlMinutes} min) que NO entraron al cálculo:</strong>{' '}
                {staleRows.map((f) => `${f.bookmaker} · ${sportLabel(f.sport)} (hace ${f.ageMinutes} min)`).join(' · ')}. Vuelve a
                scrapear esas casas y deportes para incluirlas.
              </div>
            )}
            {surebetsError ? (
              <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{surebetsError}</p>
            ) : visibleSurebets.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No se detectaron surebets con esta ronda de cuotas. Se necesitan al menos 2 casas con el mismo partido.
              </p>
            ) : (
              <>
                <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <Badge variant="success">{visibleSurebets.length} oportunidades</Badge>
                  {visibleSurebets.some((sb) => sb.isLive) && (
                    <Badge variant="warning">🔴 {visibleSurebets.filter((sb) => sb.isLive).length} en vivo (cuotas muy volátiles)</Badge>
                  )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem' }}>Deporte</th>
                        <th style={{ padding: '0.5rem' }}>Partido</th>
                        <th style={{ padding: '0.5rem' }}>Mercado</th>
                        <th style={{ padding: '0.5rem' }}>Ganancia</th>
                        <th style={{ padding: '0.5rem' }}>Fuentes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSurebets.slice(0, 25).map((sb) => (
                        <tr key={sb.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.5rem' }}>{sportLabel(sb.sport)}</td>
                          <td style={{ padding: '0.5rem', fontWeight: 600 }}>
                            {sb.eventName}
                            {sb.isLive && (
                              <span style={{ marginLeft: '0.5rem' }}>
                                <Badge variant="warning">🔴 EN VIVO</Badge>
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sb.marketType}</td>
                          <td style={{ padding: '0.5rem' }}>
                            <Badge variant="success">+{sb.profitMarginPercentage.toFixed(2)}%</Badge>
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {sb.outcomes.map((o) => `${o.bookmaker} ${o.selection} (${o.odd})`).join(' + ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {visibleSurebets.length > 25 && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Mostrando 25 de {visibleSurebets.length}. El detalle completo está en <strong>Arbitraje & Surebets</strong>.
                  </p>
                )}
                <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  ⚠️ Los márgenes muy altos suelen venir de partidos en vivo o de cuotas capturadas en momentos distintos:
                  verifica cada cuota en la casa antes de apostar.
                </p>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default ScrapeGlobalPage;
