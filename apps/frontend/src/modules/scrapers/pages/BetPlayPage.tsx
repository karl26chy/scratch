import React, { useEffect, useState } from 'react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { AdaptersApi } from '../../adapters/services/adaptersApi.js';

const API_BASE = 'http://localhost:4000/api';
export const BETPLAY_URL = 'https://tienda.betplay.com.co/apuestas#sports-hub/football';
const STORAGE_KEY = 'scraping_betplay_last_result';

interface SportPreset {
  label: string;
  icon: string;
  url: string;
  sportKey: string;
}

const PRESETS: SportPreset[] = [
  { label: 'Fútbol',        icon: '⚽', url: 'https://tienda.betplay.com.co/apuestas#sports-hub/football',     sportKey: 'football'     },
  { label: 'Tenis',         icon: '🎾', url: 'https://tienda.betplay.com.co/apuestas#sports-hub/tennis',       sportKey: 'tennis'       },
  { label: 'Baloncesto',    icon: '🏀', url: 'https://tienda.betplay.com.co/apuestas#sports-hub/basketball',   sportKey: 'basketball'   },
  { label: 'Tenis de Mesa', icon: '🏓', url: 'https://tienda.betplay.com.co/apuestas#sports-hub/table_tennis', sportKey: 'table_tennis' },
];

function isBetPlayDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'tienda.betplay.com.co' && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

// Módulo dedicado de scraping para BetPlay (tienda.betplay.com.co) — motor Kambi.
// Soporte multi-deporte: hasta 10 URLs en un mismo batch. Las cuotas se obtienen
// vía fetch directo al Offering API de Kambi (sin Playwright, sin proxy).
export const BetPlayPage: React.FC = () => {
  const [urls, setUrls] = useState<string[]>([BETPLAY_URL]);
  const [loading, setLoading] = useState(false);
  // Se guarda el último resultado en localStorage para no perderlo al cambiar de pestaña
  // (persistencia temporal — no requiere backend, se limpia al re-scrapear o limpiar el navegador).
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
    AdaptersApi.check('tienda.betplay.com.co')
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
  const invalidDomainUrls = urls.filter((u) => u.trim() && !isBetPlayDomain(u));
  const hasDuplicateUrls = new Set(urls.map((u) => u.trim().toLowerCase())).size !== urls.length;
  const canScrape = urls.length > 0 && !hasEmptyUrl && invalidDomainUrls.length === 0 && !loading;

  const handleScrape = async () => {
    if (hasEmptyUrl) {
      setError('Por favor completa o elimina las URLs vacías.');
      return;
    }
    if (invalidDomainUrls.length > 0) {
      setError(`Todas las URLs deben pertenecer a tienda.betplay.com.co. URL no permitida: ${invalidDomainUrls[0]}`);
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
          useProxy: false,   // BetPlay siempre va directo a Kambi — el proxy no aplica
          timeoutMs: 30000,  // Kambi responde en <500ms; 30s es muy generoso
        }),
      });
      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        setResults(data);
        setError(null);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {}
      } else if (data.status === 'success' || data.status === 'partial_success') {
        setError(data.error || 'No se encontraron cuotas — verifica que los deportes estén disponibles en Kambi.');
        setResults(data);
      } else {
        setError(data.message || data.error || 'Error en el scraping');
      }
    } catch {
      setError('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  // Filtro por deporte
  const matches = results?.matches || [];
  const sportsMap: Record<string, number> = {};
  for (const m of matches) {
    const sp = m.sport || 'football';
    sportsMap[sp] = (sportsMap[sp] || 0) + 1;
  }
  const availableSports = Object.keys(sportsMap);

  const filteredMatches = selectedSportFilter === 'ALL'
    ? matches
    : matches.filter((m: any) => (m.sport || 'football') === selectedSportFilter);

  const getSportBadge = (sport?: string) => {
    switch (sport) {
      case 'tennis':       return <Badge variant="success">🎾 Tenis</Badge>;
      case 'basketball':   return <Badge variant="warning">🏀 Baloncesto</Badge>;
      case 'table_tennis': return <Badge variant="purple">🏓 Tenis de Mesa</Badge>;
      case 'football':
      default:             return <Badge variant="info">⚽ Fútbol</Badge>;
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>🟢 Scraping BetPlay (Multi-Deporte)</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Módulo dedicado para tienda.betplay.com.co con soporte para hasta 10 URLs simultáneas.
          Fetch directo al Offering API de Kambi — sin Playwright, sin proxy, cuotas en &lt;1s.
        </p>
      </div>

      <Card
        title="1. Configurar URLs por Deporte"
        subtitle={`Hasta 10 URLs de tienda.betplay.com.co (${urls.length} / 10 configuradas)`}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Presets rápidos */}
          <div>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Presets rápidos de deportes:</span>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
              {PRESETS.map((p) => {
                const alreadyAdded = urls.includes(p.url);
                return (
                  <button
                    key={p.sportKey}
                    id={`betplay-preset-${p.sportKey}`}
                    type="button"
                    onClick={() => handleAddUrl(p.url)}
                    disabled={urls.length >= 10 || alreadyAdded}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.4rem 0.75rem',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      background: alreadyAdded ? 'rgba(255,255,255,0.02)' : 'rgba(22,163,74,0.12)',
                      color: alreadyAdded ? 'var(--text-muted)' : 'var(--text-primary)',
                      fontSize: '0.8rem',
                      cursor: urls.length >= 10 || alreadyAdded ? 'not-allowed' : 'pointer',
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

          {/* Lista de inputs dinámicos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {urls.map((u, idx) => {
              const isInvalid = u.trim().length > 0 && !isBetPlayDomain(u);
              return (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        color: 'var(--text-secondary)',
                        minWidth: '24px',
                        textAlign: 'center',
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <input
                      id={`betplay-url-${idx}`}
                      type="text"
                      placeholder="https://tienda.betplay.com.co/apuestas#sports-hub/..."
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
                      ⚠️ Dominio inválido: solo se permiten URLs de <strong>tienda.betplay.com.co</strong>.
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Botón para añadir URL manual */}
          <div>
            <button
              type="button"
              onClick={() => handleAddUrl()}
              disabled={urls.length >= 10}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-color)',
                background: urls.length >= 10 ? 'transparent' : 'rgba(255,255,255,0.03)',
                color: urls.length >= 10 ? 'var(--text-muted)' : 'var(--text-primary)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: urls.length >= 10 ? 'not-allowed' : 'pointer',
              }}
            >
              + Agregar otra URL ({urls.length}/10)
            </button>
          </div>

          {hasDuplicateUrls && (
            <div style={{ fontSize: '0.75rem', color: '#fbbf24' }}>
              ℹ️ Advertencia: Tienes URLs repetidas en la lista.
            </div>
          )}

          {/* Status del adapter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            {hasAdapter === true && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Badge variant="purple">📡 Network Interceptor activo (Kambi Offering API)</Badge>
              </div>
            )}
            {hasAdapter === false && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Badge variant="warning">⚠️ Adapter no detectado — reinicia el backend</Badge>
              </div>
            )}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              ℹ️ BetPlay usa fetch directo al API Kambi — no requiere proxy ni Playwright.
            </div>
          </div>
        </div>
      </Card>

      <button
        id="betplay-scrape-btn"
        onClick={handleScrape}
        disabled={!canScrape}
        style={{
          width: '100%',
          marginTop: '1.5rem',
          padding: '0.85rem',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: !canScrape ? 'rgba(34,197,94,0.3)' : 'linear-gradient(90deg, #16a34a, #06b6d4)',
          color: '#fff',
          fontWeight: 700,
          cursor: !canScrape ? 'not-allowed' : 'pointer',
          fontSize: '0.95rem',
        }}
      >
        {loading
          ? `⏳ Consultando Kambi API... (~${urls.length}s)`
          : `🚀 Ejecutar Scraping BetPlay (${urls.length} deporte${urls.length !== 1 ? 's' : ''})`}
      </button>

      {error && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
      )}

      {/* Alerta de fallos parciales */}
      {results?.failedUrls && results.failedUrls.length > 0 && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-md)', color: '#fbbf24', fontSize: '0.85rem' }}>
          <strong>⚠️ Scraping Parcial:</strong> {results.failedUrls.length} de {urls.length} URL(s) no pudieron procesarse:
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.2rem', marginBottom: '0.25rem' }}>
            {results.failedUrls.map((f: any, idx: number) => (
              <li key={idx}>
                <code>{f.url}</code> — {f.error}
              </li>
            ))}
          </ul>
          <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>Se muestran los resultados combinados de las URLs que respondieron exitosamente.</span>
        </div>
      )}

      {results && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card
            title="📊 Resultados Consolidados del Scraping"
            subtitle={`${results.totalMatches || results.matches?.length || 0} partidos combinados en ${results.durationMs}ms — Fuente: Kambi API ${results.oddsCount !== undefined ? `· ${results.oddsCount} cuotas` : ''}`}
          >
            {/* Meta info */}
            <div style={{ marginBottom: '1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge variant="purple">📡 Kambi API (fetchDirect)</Badge>
                {results.oddsCount !== undefined && <Badge variant="success">{results.oddsCount} cuotas</Badge>}
                <Badge variant="warning">BetPlay</Badge>
                {results.successfulUrls && (
                  <Badge variant="info">{results.successfulUrls.length} deporte(s) exitoso(s)</Badge>
                )}
              </div>
            </div>

            {/* Selector / Filtro por deporte */}
            {availableSports.length > 1 && (
              <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Filtrar por deporte:</span>
                <button
                  type="button"
                  onClick={() => setSelectedSportFilter('ALL')}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    background: selectedSportFilter === 'ALL' ? 'rgba(22,163,74,0.2)' : 'rgba(255,255,255,0.03)',
                    color: selectedSportFilter === 'ALL' ? '#4ade80' : 'var(--text-primary)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Todos ({matches.length})
                </button>
                {availableSports.map((sp) => {
                  const count = sportsMap[sp];
                  const label = sp === 'tennis' ? '🎾 Tenis' : sp === 'basketball' ? '🏀 Baloncesto' : sp === 'table_tennis' ? '🏓 Tenis de Mesa' : '⚽ Fútbol';
                  const isSelected = selectedSportFilter === sp;
                  return (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => setSelectedSportFilter(sp)}
                      style={{
                        padding: '0.35rem 0.75rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        background: isSelected ? 'rgba(22,163,74,0.2)' : 'rgba(255,255,255,0.03)',
                        color: isSelected ? '#4ade80' : 'var(--text-primary)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {filteredMatches && filteredMatches.length > 0 ? (
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMatches.map((m: any, i: number) => {
                      // Mostrar '-' en columna X para deportes sin empate (MONEYLINE_2WAY)
                      const is2Way = m.sport === 'tennis' || m.sport === 'table_tennis' || m.sport === 'basketball';
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.6rem' }}>{getSportBadge(m.sport)}</td>
                          <td style={{ padding: '0.6rem' }}>{m.homeTeam || '-'}</td>
                          <td style={{ padding: '0.6rem' }}>{m.awayTeam || '-'}</td>
                          <td style={{ padding: '0.6rem', fontWeight: 600 }}>{m.oddsHome ?? '-'}</td>
                          <td style={{ padding: '0.6rem' }}>{is2Way ? '-' : (m.oddsDraw ?? '-')}</td>
                          <td style={{ padding: '0.6rem', fontWeight: 600 }}>{m.oddsAway ?? '-'}</td>
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

export default BetPlayPage;
