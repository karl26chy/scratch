import React, { useEffect, useState } from 'react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { AdaptersApi } from '../../adapters/services/adaptersApi.js';

const API_BASE = 'http://localhost:4000/api';
export const BWIN_URL = 'https://www.bwin.co/es/sports/f%C3%BAtbol-4/apuestas';
const STORAGE_KEY = 'scraping_bwin_last_result';
const MAX_URLS = 10;

interface SportPreset {
  label: string;
  icon: string;
  url: string;
  sportKey: string;
}

// El deporte se identifica por el número final del slug (fútbol-4, tenis-5, baloncesto-7, tenis-de-mesa-56).
const PRESETS: SportPreset[] = [
  { label: 'Fútbol', icon: '⚽', url: BWIN_URL, sportKey: 'football' },
  { label: 'Tenis', icon: '🎾', url: 'https://www.bwin.co/es/sports/tenis-5/apuestas', sportKey: 'tennis' },
  { label: 'Baloncesto', icon: '🏀', url: 'https://www.bwin.co/es/sports/baloncesto-7/apuestas', sportKey: 'basketball' },
  { label: 'Tenis de Mesa', icon: '🏓', url: 'https://www.bwin.co/es/sports/tenis-de-mesa-56/apuestas', sportKey: 'table_tennis' },
];

function isBwinDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'bwin.co' && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

const SPORT_LABELS: Record<string, string> = {
  football: '⚽ Fútbol',
  tennis: '🎾 Tenis',
  basketball: '🏀 Baloncesto',
  table_tennis: '🏓 Tenis de Mesa',
};

// Módulo dedicado de scraping para Bwin Colombia (www.bwin.co) — plataforma Entain.
// Multi-deporte: hasta 10 URLs por lote. Las cuotas se obtienen vía fetch directo a la CDS API
// pública de Bwin (sin Playwright, sin proxy), incluyendo partidos prepartido y en vivo.
export const BwinPage: React.FC = () => {
  const [urls, setUrls] = useState<string[]>([BWIN_URL]);
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
  const [hasAdapter, setHasAdapter] = useState<boolean | null>(null);
  const [selectedSportFilter, setSelectedSportFilter] = useState<string>('ALL');

  useEffect(() => {
    let cancelled = false;
    AdaptersApi.check('bwin.co')
      .then((res) => {
        if (!cancelled) setHasAdapter(res.hasAdapter);
      })
      .catch(() => {
        if (!cancelled) setHasAdapter(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAddUrl = (presetUrl?: string) => {
    if (urls.length >= MAX_URLS) return;
    setUrls([...urls, presetUrl || '']);
  };
  const handleUpdateUrl = (index: number, val: string) => setUrls(urls.map((u, i) => (i === index ? val : u)));
  const handleRemoveUrl = (index: number) => {
    if (urls.length <= 1) return;
    setUrls(urls.filter((_, i) => i !== index));
  };

  const hasEmptyUrl = urls.some((u) => !u.trim());
  const invalidDomainUrls = urls.filter((u) => u.trim() && !isBwinDomain(u));
  const hasDuplicateUrls = new Set(urls.map((u) => u.trim().toLowerCase())).size !== urls.length;
  const canScrape = urls.length > 0 && !hasEmptyUrl && invalidDomainUrls.length === 0 && !loading;

  const handleScrape = async () => {
    if (!canScrape) return;
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
          selectors: { events: '', homeTeam: '', awayTeam: '', oddsHome: '', oddsDraw: '', oddsAway: '' },
          useProxy: false, // Bwin va directo a su CDS API — el proxy no aplica
          timeoutMs: 45000,
        }),
      });
      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        setResults(data);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {}
      } else {
        setError(data.message || data.error || 'No se encontraron cuotas en Bwin.');
        if (data.failedUrls?.length) setResults(data);
      }
    } catch {
      setError('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  // Partidos con 1X2/ganador primero (en fútbol Bwin no publica 1X2 estándar en todos los partidos)
  const matches: any[] = [...(results?.matches || [])].sort(
    (a, b) => Number(b.oddsHome != null) - Number(a.oddsHome != null),
  );
  const sportsMap: Record<string, number> = {};
  for (const m of matches) {
    const sp = m.sport || 'football';
    sportsMap[sp] = (sportsMap[sp] || 0) + 1;
  }
  const availableSports = Object.keys(sportsMap);
  const filteredMatches =
    selectedSportFilter === 'ALL' ? matches : matches.filter((m: any) => (m.sport || 'football') === selectedSportFilter);
  const showFootballCols = filteredMatches.some((m: any) => (m.sport || 'football') === 'football');

  const filterBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.35rem 0.75rem',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-color)',
    background: active ? 'rgba(234,179,8,0.2)' : 'rgba(255,255,255,0.03)',
    color: active ? '#facc15' : 'var(--text-primary)',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>🟡 Scraping Bwin (Multi-Deporte)</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Módulo dedicado para www.bwin.co con soporte para hasta {MAX_URLS} URLs simultáneas. Fetch directo a la CDS API
          pública de Bwin — sin Playwright, sin proxy, prepartido y en vivo. Fútbol: 1X2, Más/Menos 2.5 y Ambos marcan.
          Tenis, baloncesto y tenis de mesa: ganador del partido.
        </p>
      </div>

      <Card title="1. Configurar URLs por Deporte" subtitle={`Hasta ${MAX_URLS} URLs de bwin.co (${urls.length} / ${MAX_URLS} configuradas)`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Presets rápidos de deportes:</span>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {PRESETS.map((p) => {
                const alreadyAdded = urls.includes(p.url);
                const disabled = urls.length >= MAX_URLS || alreadyAdded;
                return (
                  <button
                    key={p.sportKey}
                    id={`bwin-preset-${p.sportKey}`}
                    type="button"
                    onClick={() => handleAddUrl(p.url)}
                    disabled={disabled}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.4rem 0.75rem',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      background: alreadyAdded ? 'rgba(255,255,255,0.02)' : 'rgba(234,179,8,0.12)',
                      color: alreadyAdded ? 'var(--text-muted)' : 'var(--text-primary)',
                      fontSize: '0.8rem',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span>{p.icon}</span>
                    <span>{p.label}</span>
                    {alreadyAdded && <span style={{ fontSize: '0.7rem' }}>✓</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {urls.map((u, idx) => {
              const isInvalid = u.trim().length > 0 && !isBwinDomain(u);
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '24px', textAlign: 'center' }}>
                      #{idx + 1}
                    </span>
                    <input
                      id={`bwin-url-${idx}`}
                      type="text"
                      placeholder="https://www.bwin.co/es/sports/fútbol-4/apuestas"
                      value={u}
                      onChange={(e) => handleUpdateUrl(idx, e.target.value)}
                      style={{
                        flex: 1,
                        padding: '0.6rem 0.8rem',
                        borderRadius: 'var(--radius-md)',
                        border: isInvalid ? '1px solid #ef4444' : '1px solid var(--border-color)',
                        background: isInvalid ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveUrl(idx)}
                      disabled={urls.length <= 1}
                      title={urls.length <= 1 ? 'Se requiere al menos una URL' : 'Eliminar URL'}
                      style={{
                        padding: '0.55rem 0.8rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        background: urls.length <= 1 ? 'transparent' : 'rgba(239,68,68,0.1)',
                        color: urls.length <= 1 ? 'var(--text-muted)' : '#f87171',
                        cursor: urls.length <= 1 ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  {isInvalid && (
                    <span style={{ fontSize: '0.75rem', color: '#f87171', marginLeft: '32px' }}>
                      ⚠️ Dominio inválido: solo se permiten URLs de <strong>bwin.co</strong>.
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <button
              type="button"
              onClick={() => handleAddUrl()}
              disabled={urls.length >= MAX_URLS}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-color)',
                background: urls.length >= MAX_URLS ? 'transparent' : 'rgba(255,255,255,0.03)',
                color: urls.length >= MAX_URLS ? 'var(--text-muted)' : 'var(--text-primary)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: urls.length >= MAX_URLS ? 'not-allowed' : 'pointer',
              }}
            >
              + Agregar otra URL ({urls.length}/{MAX_URLS})
            </button>
          </div>

          {hasDuplicateUrls && <div style={{ fontSize: '0.75rem', color: '#fbbf24' }}>ℹ️ Advertencia: Tienes URLs repetidas en la lista.</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            {hasAdapter === true && <Badge variant="purple">📡 Network Adapter activo (Bwin CDS API)</Badge>}
            {hasAdapter === false && <Badge variant="warning">⚠️ Adapter no detectado — reinicia el backend</Badge>}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ℹ️ Incluye partidos en vivo: sus cuotas cambian en segundos, vuelve a scrapear para refrescarlas. El deporte se detecta por el número final de la URL.
            </div>
          </div>
        </div>
      </Card>

      <button
        id="bwin-scrape-btn"
        onClick={handleScrape}
        disabled={!canScrape}
        style={{
          width: '100%',
          marginTop: '1.5rem',
          padding: '0.85rem',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: !canScrape ? 'rgba(234,179,8,0.3)' : 'linear-gradient(90deg, #eab308, #f97316)',
          color: '#fff',
          fontWeight: 700,
          cursor: !canScrape ? 'not-allowed' : 'pointer',
          fontSize: '0.95rem',
        }}
      >
        {loading ? '⏳ Consultando Bwin CDS API...' : `🚀 Ejecutar Scraping Bwin (${urls.length} deporte${urls.length !== 1 ? 's' : ''})`}
      </button>

      {error && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
      )}

      {results?.failedUrls && results.failedUrls.length > 0 && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-md)', color: '#fbbf24', fontSize: '0.85rem' }}>
          <strong>⚠️ Scraping Parcial:</strong> {results.failedUrls.length} URL(s) no pudieron procesarse:
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.2rem', marginBottom: 0 }}>
            {results.failedUrls.map((f: any, idx: number) => (
              <li key={idx}>
                <code>{f.url}</code> — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {results && matches.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card
            title="📊 Resultados Consolidados del Scraping"
            subtitle={`${results.totalMatches || matches.length} partidos en ${results.durationMs}ms — Fuente: Bwin CDS API${results.oddsCount !== undefined ? ` · ${results.oddsCount} cuotas` : ''}`}
          >
            <div style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge variant="purple">📡 Bwin CDS API (fetchDirect)</Badge>
              {results.oddsCount !== undefined && <Badge variant="success">{results.oddsCount} cuotas</Badge>}
              <Badge variant="warning">Bwin</Badge>
              {results.successfulUrls && <Badge variant="info">{results.successfulUrls.length} deporte(s) exitoso(s)</Badge>}
            </div>

            {availableSports.length > 1 && (
              <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Filtrar por deporte:</span>
                <button type="button" onClick={() => setSelectedSportFilter('ALL')} style={filterBtnStyle(selectedSportFilter === 'ALL')}>
                  Todos ({matches.length})
                </button>
                {availableSports.map((sp) => (
                  <button key={sp} type="button" onClick={() => setSelectedSportFilter(sp)} style={filterBtnStyle(selectedSportFilter === sp)}>
                    {SPORT_LABELS[sp] || sp} ({sportsMap[sp]})
                  </button>
                ))}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '0.6rem' }}>Deporte</th>
                    <th style={{ padding: '0.6rem' }}>Local</th>
                    <th style={{ padding: '0.6rem' }}>Visitante</th>
                    <th style={{ padding: '0.6rem' }}>1</th>
                    <th style={{ padding: '0.6rem' }}>X</th>
                    <th style={{ padding: '0.6rem' }}>2</th>
                    {showFootballCols && (
                      <>
                        <th style={{ padding: '0.6rem' }}>Más 2.5</th>
                        <th style={{ padding: '0.6rem' }}>Menos 2.5</th>
                        <th style={{ padding: '0.6rem' }}>Ambos Sí</th>
                        <th style={{ padding: '0.6rem' }}>Ambos No</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.map((m: any, i: number) => {
                    const sport = m.sport || 'football';
                    const is2Way = sport !== 'football';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '0.6rem' }}>{SPORT_LABELS[sport] || sport}</td>
                        <td style={{ padding: '0.6rem' }}>{m.homeTeam || '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.awayTeam || '-'}</td>
                        <td style={{ padding: '0.6rem', fontWeight: 600 }}>{m.oddsHome ?? '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{is2Way ? '-' : (m.oddsDraw ?? '-')}</td>
                        <td style={{ padding: '0.6rem', fontWeight: 600 }}>{m.oddsAway ?? '-'}</td>
                        {showFootballCols && (
                          <>
                            <td style={{ padding: '0.6rem' }}>{m.overOdds ?? '-'}</td>
                            <td style={{ padding: '0.6rem' }}>{m.underOdds ?? '-'}</td>
                            <td style={{ padding: '0.6rem' }}>{m.bothScoreYes ?? '-'}</td>
                            <td style={{ padding: '0.6rem' }}>{m.bothScoreNo ?? '-'}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default BwinPage;
