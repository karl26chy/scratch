import React, { useState } from 'react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';

const API_BASE = 'http://localhost:4000/api';
export const WPLAY_URL = 'https://apuestas.wplay.co/es/s/FOOT/F%C3%BAtbol';
const STORAGE_KEY = 'scraping_wplay_last_result';

interface SportPreset {
  label: string;
  icon: string;
  url: string;
  sportKey: string;
}

const PRESETS: SportPreset[] = [
  { label: 'Fútbol', icon: '⚽', url: 'https://apuestas.wplay.co/es/s/FOOT/F%C3%BAtbol', sportKey: 'football' },
  { label: 'Tenis', icon: '🎾', url: 'https://apuestas.wplay.co/es/s/TENN/Tenis', sportKey: 'tennis' },
  { label: 'Baloncesto', icon: '🏀', url: 'https://apuestas.wplay.co/es/s/BASK/Baloncesto', sportKey: 'basketball' },
  { label: 'Tenis de Mesa', icon: '🏓', url: 'https://apuestas.wplay.co/es/s/TABL/Tenis-de-mesa', sportKey: 'table_tennis' },
];

function isWplayDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return (host === 'apuestas.wplay.co' || host === 'wplay.co') && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

interface GroupedMatch {
  eventName?: string;
  homeTeam: string;
  awayTeam: string;
  sport?: string;
  oddsHome?: number | null;
  oddsDraw?: number | null;
  oddsAway?: number | null;
  overOdds?: number | null;
  underOdds?: number | null;
  bothScoreYes?: number | null;
  bothScoreNo?: number | null;
}

// Módulo dedicado de scraping para Wplay (apuestas.wplay.co).
// Soporte multi-deporte: hasta 10 URLs en un mismo batch. Motor DOM Resiliente
// con estrategia structured_price_class, extracción por ID de evento y discriminación 1X2 / 2-Way.
export const WplayPage: React.FC = () => {
  const [urls, setUrls] = useState<string[]>([WPLAY_URL]);
  const [useProxy, setUseProxy] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [selectedSportFilter, setSelectedSportFilter] = useState<string>('ALL');

  const handleAddUrl = (presetUrl?: string) => {
    if (urls.length >= 10) return;
    setUrls([...urls, presetUrl || '']);
  };

  const handleUpdateUrl = (index: number, val: string) => {
    const updated = [...urls];
    updated[index] = val;
    setUrls(updated);
  };

  const handleRemoveUrl = (index: number) => {
    if (urls.length <= 1) return;
    setUrls(urls.filter((_, i) => i !== index));
  };

  // Validaciones
  const hasEmptyUrl = urls.some((u) => !u.trim());
  const invalidDomainUrls = urls.filter((u) => u.trim() && !isWplayDomain(u));
  const hasDuplicateUrls = new Set(urls.map((u) => u.trim().toLowerCase())).size !== urls.length;
  const canScrape = urls.length > 0 && !hasEmptyUrl && invalidDomainUrls.length === 0 && !loading;

  const handleScrape = async () => {
    if (hasEmptyUrl) {
      setError('Por favor completa o elimina las URLs vacías.');
      return;
    }
    if (invalidDomainUrls.length > 0) {
      setError(`Todas las URLs deben pertenecer a apuestas.wplay.co. URL no permitida: ${invalidDomainUrls[0]}`);
      return;
    }
    if (urls.length > 10) {
      setError('Máximo 10 URLs permitidas por ejecución.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setSelectedSportFilter('ALL');

    try {
      const res = await fetch(`${API_BASE}/scrape/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urls.map((u) => u.trim()),
          selectors: {
            events: '',
            homeTeam: '',
            awayTeam: '',
            oddsHome: '',
            oddsDraw: '',
            oddsAway: '',
          },
          useProxy,
          timeoutMs: 35000,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.status === 'error') {
        setError(data.message || data.error || 'Error al ejecutar scraping');
        return;
      }

      setResults(data);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch {}
    } catch {
      setError('Error de conexión con el backend');
    } finally {
      setLoading(false);
    }
  };

  // Filtrado de partidos por deporte seleccionado
  const matches: GroupedMatch[] = results?.matches || [];
  const filteredMatches = matches.filter((m) => {
    if (selectedSportFilter === 'ALL') return true;
    return (m.sport || 'football').toLowerCase() === selectedSportFilter.toLowerCase();
  });

  // Conteo por deporte
  const sportCounts = matches.reduce((acc: Record<string, number>, m) => {
    const k = (m.sport || 'football').toLowerCase();
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const hasOU = matches.some((m) => m.overOdds != null || m.underOdds != null);
  const successfulCount = results?.successfulUrls?.length ?? (results?.status === 'success' ? urls.length : 0);
  const failedCount = results?.failedUrls?.length ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Encabezado */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            🎲 Scraping Wplay
          </h1>
          <Badge variant="info">DOM Resiliente (Estrategia 2.5)</Badge>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.35rem' }}>
          Módulo multi-deporte para Wplay (apuestas.wplay.co). Soporta hasta 10 URLs por batch con extracción por ID de evento y discriminación 1X2 / 2-Way.
        </p>
      </div>

      {/* Selector de Presets de Deportes */}
      <Card title="1. Presets de Deportes" subtitle="Haz clic para agregar rápidamente la URL de cada deporte">
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          {PRESETS.map((preset) => {
            const isAlreadyAdded = urls.some((u) => u.trim() === preset.url);
            return (
              <button
                key={preset.sportKey}
                onClick={() => handleAddUrl(preset.url)}
                disabled={isAlreadyAdded || urls.length >= 10 || loading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.9rem',
                  borderRadius: 'var(--radius-md)',
                  border: isAlreadyAdded ? '1px solid rgba(52,211,153,0.4)' : '1px solid var(--border-color)',
                  background: isAlreadyAdded ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.03)',
                  color: isAlreadyAdded ? '#34d399' : 'var(--text-primary)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: isAlreadyAdded || urls.length >= 10 || loading ? 'not-allowed' : 'pointer',
                }}
              >
                <span>{preset.icon}</span>
                <span>{preset.label}</span>
                {isAlreadyAdded && <span style={{ fontSize: '0.75rem' }}>✓</span>}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Lista de URLs */}
      <Card
        title={`2. URLs para Scraping (${urls.length}/10)`}
        subtitle="Agrega hasta 10 URLs del sitio apuestas.wplay.co"
        action={
          <button
            onClick={() => handleAddUrl()}
            disabled={urls.length >= 10 || loading}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-color)',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: urls.length >= 10 || loading ? 'not-allowed' : 'pointer',
            }}
          >
            + Agregar URL
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {urls.map((u, idx) => {
            const isInvalid = u.trim() && !isWplayDomain(u);
            const isPreset = PRESETS.find((p) => p.url === u.trim());
            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span
                  style={{
                    minWidth: '24px',
                    textAlign: 'center',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  #{idx + 1}
                </span>
                {isPreset && <span style={{ fontSize: '1rem' }}>{isPreset.icon}</span>}
                <input
                  type="text"
                  placeholder="https://apuestas.wplay.co/es/s/FOOT/F%C3%BAtbol"
                  value={u}
                  onChange={(e) => handleUpdateUrl(idx, e.target.value)}
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '0.5rem 0.8rem',
                    borderRadius: 'var(--radius-md)',
                    border: isInvalid ? '1px solid #ef4444' : '1px solid var(--border-color)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
                {urls.length > 1 && (
                  <button
                    onClick={() => handleRemoveUrl(idx)}
                    disabled={loading}
                    title="Eliminar URL"
                    style={{
                      padding: '0.45rem 0.7rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(239,68,68,0.3)',
                      background: 'rgba(239,68,68,0.1)',
                      color: '#f87171',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} disabled={loading} />
              <span>Usar Proxy</span>
              <Badge variant={useProxy ? 'success' : 'warning'}>{useProxy ? '✅ Proxy activo' : '⚠️ IP directa'}</Badge>
            </label>
          </div>

          {hasDuplicateUrls && (
            <p style={{ fontSize: '0.75rem', color: '#f59e0b', margin: 0 }}>
              ⚠️ Hay URLs duplicadas en la lista — se procesará cada una independientemente.
            </p>
          )}
        </div>
      </Card>

      {/* Botón de Ejecución */}
      <button
        onClick={handleScrape}
        disabled={!canScrape}
        style={{
          width: '100%',
          padding: '0.85rem',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: !canScrape ? 'rgba(168,85,247,0.3)' : 'linear-gradient(90deg, #9333ea, #ec4899)',
          color: '#fff',
          fontWeight: 700,
          cursor: !canScrape ? 'not-allowed' : 'pointer',
          fontSize: '0.95rem',
        }}
      >
        {loading
          ? `⏳ Extrayendo ${urls.length} URL(s) de Wplay...`
          : `🚀 Ejecutar Scraping Wplay (${urls.length} URL${urls.length > 1 ? 's' : ''})`}
      </button>

      {error && (
        <div
          style={{
            padding: '1rem',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#f87171',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Resultados */}
      {results && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Métricas del Batch */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
            }}
          >
            <div style={{ padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>URLs Exitosas</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                {successfulCount}/{urls.length}
              </div>
            </div>

            <div style={{ padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Cuotas Extraídas</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                {results.oddsCount ?? 0}
              </div>
            </div>

            <div style={{ padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Partidos</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {matches.length}
              </div>
            </div>

            <div style={{ padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tiempo Total</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {((results.durationMs || 0) / 1000).toFixed(2)}s
              </div>
            </div>
          </div>

          {/* URLs fallidas si hubo alguna */}
          {failedCount > 0 && (
            <div style={{ padding: '0.8rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}>
              <span style={{ color: '#f87171', fontWeight: 600 }}>{failedCount} URL(s) con error o sin cuotas:</span>
              <ul style={{ margin: '0.4rem 0 0 1rem', padding: 0 }}>
                {results.failedUrls.map((f: any, i: number) => (
                  <li key={i} style={{ color: 'var(--text-secondary)' }}>
                    <code style={{ fontSize: '0.75rem' }}>{f.url}</code>: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Filtros por Deporte */}
          {matches.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Filtrar:</span>
              <button
                onClick={() => setSelectedSportFilter('ALL')}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  border: selectedSportFilter === 'ALL' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  background: selectedSportFilter === 'ALL' ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: selectedSportFilter === 'ALL' ? '#fff' : 'var(--text-secondary)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Todos ({matches.length})
              </button>
              {PRESETS.map((p) => {
                const count = sportCounts[p.sportKey] || 0;
                if (count === 0) return null;
                const isSelected = selectedSportFilter.toLowerCase() === p.sportKey.toLowerCase();
                return (
                  <button
                    key={p.sportKey}
                    onClick={() => setSelectedSportFilter(p.sportKey)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      background: isSelected ? 'rgba(99,102,241,0.15)' : 'transparent',
                      color: isSelected ? '#fff' : 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {p.icon} {p.label} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Tabla de Resultados */}
          <Card
            title="📊 Partidos y Cuotas Extraídas"
            subtitle={`Mostrando ${filteredMatches.length} de ${matches.length} partidos`}
          >
            {filteredMatches.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem' }}>Deporte</th>
                      <th style={{ padding: '0.6rem' }}>Local / Participante 1</th>
                      <th style={{ padding: '0.6rem' }}>Visitante / Participante 2</th>
                      <th style={{ padding: '0.6rem' }}>1</th>
                      <th style={{ padding: '0.6rem' }}>X</th>
                      <th style={{ padding: '0.6rem' }}>2</th>
                      {hasOU && <th style={{ padding: '0.6rem' }}>Over 2.5</th>}
                      {hasOU && <th style={{ padding: '0.6rem' }}>Under 2.5</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatches.map((m: GroupedMatch, i: number) => {
                      const sport = (m.sport || 'football').toLowerCase();
                      const isTwoWay = sport === 'tennis' || sport === 'basketball' || sport === 'table_tennis';
                      const sportIcon =
                        sport === 'tennis'
                          ? '🎾 Tenis'
                          : sport === 'basketball'
                            ? '🏀 Basket'
                            : sport === 'table_tennis'
                              ? '🏓 T. Mesa'
                              : '⚽ Fútbol';

                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.6rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{sportIcon}</td>
                          <td style={{ padding: '0.6rem', fontWeight: 600 }}>{m.homeTeam || '-'}</td>
                          <td style={{ padding: '0.6rem', fontWeight: 600 }}>{m.awayTeam || '-'}</td>
                          <td style={{ padding: '0.6rem', color: '#38bdf8', fontWeight: 700 }}>{m.oddsHome ?? '-'}</td>
                          <td style={{ padding: '0.6rem' }}>
                            {isTwoWay ? (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>-</span>
                            ) : (
                              <span style={{ color: '#f59e0b', fontWeight: 700 }}>{m.oddsDraw ?? '-'}</span>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem', color: '#34d399', fontWeight: 700 }}>{m.oddsAway ?? '-'}</td>
                          {hasOU && <td style={{ padding: '0.6rem' }}>{m.overOdds ?? '-'}</td>}
                          {hasOU && <td style={{ padding: '0.6rem' }}>{m.underOdds ?? '-'}</td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No se encontraron partidos para el filtro seleccionado.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default WplayPage;
