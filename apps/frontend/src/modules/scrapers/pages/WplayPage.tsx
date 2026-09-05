import React, { useState } from 'react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';

const API_BASE = 'http://localhost:4000/api';
const STORAGE_KEY = 'scraping_wplay_last_result';
export const WPLAY_URL = 'https://apuestas.wplay.co/es/s/FOOT/F%C3%BAtbol';

interface GroupedMatch {
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  oddsHome?: number;
  oddsDraw?: number;
  oddsAway?: number;
  overOdds?: number;
  underOdds?: number;
}

// Agrupa el array plano de BookmakerOdd[] (que devuelve /api/run en extractedData.bookmakerOdds)
// en filas por partido — el backend no hace este agrupado para el pipeline DOM-only.
function groupOdds(odds: any[]): GroupedMatch[] {
  const grouped = new Map<string, GroupedMatch>();
  for (const o of odds || []) {
    const eventName = o.eventName || 'Unknown';
    if (!grouped.has(eventName)) {
      const parts = eventName.split(' vs ');
      grouped.set(eventName, { eventName, homeTeam: parts[0]?.trim() || 'Home', awayTeam: parts[1]?.trim() || 'Away' });
    }
    const g = grouped.get(eventName)!;
    const sel = (o.selection || '').toLowerCase();

    if (o.marketType === 'OVER_UNDER_2_5') {
      if (sel.includes('over') || sel.includes('más') || sel.includes('mas')) g.overOdds = o.odd;
      else if (sel.includes('under') || sel.includes('menos')) g.underOdds = o.odd;
      continue;
    }

    const isDraw = sel.includes('empate') || sel === 'x' || sel === 'draw';
    const isHome = !isDraw && sel === g.homeTeam.toLowerCase();
    const isAway = !isDraw && sel === g.awayTeam.toLowerCase();
    if (isDraw) g.oddsDraw = o.odd;
    else if (isHome) g.oddsHome = o.odd;
    else if (isAway) g.oddsAway = o.odd;
    else {
      if (g.oddsHome === undefined) g.oddsHome = o.odd;
      else if (g.oddsDraw === undefined) g.oddsDraw = o.odd;
      else if (g.oddsAway === undefined) g.oddsAway = o.odd;
    }
  }
  return Array.from(grouped.values());
}

// Módulo dedicado de scraping para Wplay. A diferencia de BetPlay/Stake, Wplay no
// tiene adapter de red — usa el motor DOM de estrategias resilientes (ResilientSelectorEngine,
// estrategia "structured_price_class" ya afinada para su markup span.price.dec) vía /api/run,
// sin necesidad de selectores CSS manuales.
export const WplayPage: React.FC = () => {
  const [url, setUrl] = useState(WPLAY_URL);
  const [useProxy, setUseProxy] = useState(true);
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

  const handleScrape = async () => {
    if (!url) {
      setError('Ingresa la URL del sitio de apuestas de Wplay (ej. hub de fútbol)');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch(`${API_BASE}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [{ url, bookmaker: 'Wplay', useProxy, captureScreenshot: false }],
        }),
      });
      const data = await res.json();
      const single = data.results?.[0] || data.data?.[0];
      if (!single) {
        setError(data.message || data.error || 'Error en el scraping');
        return;
      }
      const bookmakerOdds = single.extractedData?.bookmakerOdds || [];
      const matches = groupOdds(bookmakerOdds);
      const normalized = {
        url: single.url,
        status: single.status,
        source: single.source,
        durationMs: single.durationMs,
        proxyUsed: single.proxyUsed,
        oddsCount: single.oddsCount ?? bookmakerOdds.length,
        strategyApplied: single.extractedData?.strategyApplied,
        matches,
      };
      if (matches.length > 0) {
        setResults(normalized);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        } catch {}
      } else {
        setError(single.domAlert?.message || 'No se encontraron cuotas — revisa que la URL sea la del listado de partidos de fútbol.');
        setResults(normalized);
      }
    } catch {
      setError('Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  const hasOU = results?.matches?.some((m: GroupedMatch) => m.overOdds != null || m.underOdds != null);

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>🎲 Scraping Wplay</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Módulo dedicado para Wplay. Sin adapter de red — usa el motor DOM resiliente (estrategia afinada a su markup), sin selectores CSS manuales.
        </p>
      </div>

      <Card title="1. Configurar URL" subtitle="Pega la URL del listado de fútbol de Wplay">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>URL de Wplay</label>
            <input
              type="text"
              placeholder="https://www.wplay.co/apuestas-deportivas/futbol"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{
                width: '100%',
                marginTop: '0.4rem',
                padding: '0.6rem 0.8rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                background: 'rgba(255,255,255,0.04)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            />
            {!WPLAY_URL && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                Aún no hay una URL preconfigurada para Wplay — pégala aquí cada vez, o pídele a Claude que la fije como valor por defecto.
              </p>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} />
            Usar Proxy
            <Badge variant={useProxy ? 'success' : 'warning'}>{useProxy ? '✅ Proxy activo' : '⚠️ IP directa'}</Badge>
          </label>
        </div>
      </Card>

      <button
        onClick={handleScrape}
        disabled={!url || loading}
        style={{
          width: '100%',
          marginTop: '1.5rem',
          padding: '0.85rem',
          borderRadius: 'var(--radius-md)',
          border: 'none',
          background: loading || !url ? 'rgba(168,85,247,0.4)' : 'linear-gradient(90deg, #9333ea, #ec4899)',
          color: '#fff',
          fontWeight: 700,
          cursor: loading || !url ? 'not-allowed' : 'pointer',
          fontSize: '0.95rem',
        }}
      >
        {loading ? '⏳ Ejecutando...' : '🚀 Ejecutar Scraping Wplay'}
      </button>

      {error && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
      )}

      {results && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card title="📊 Resultados del Scraping" subtitle={`${results.matches?.length || 0} partidos en ${results.durationMs}ms — Fuente: ${results.source || 'dom'} ${results.oddsCount !== undefined ? `· ${results.oddsCount} cuotas` : ''}`}>
            <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div><strong>URL:</strong> {results.url}</div>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span><strong>Proxy:</strong> {results.proxyUsed || 'N/A'}</span>
                <Badge variant="info">🔍 DOM ({results.strategyApplied || 'resilient engine'})</Badge>
                {results.oddsCount !== undefined && <Badge variant="success">{results.oddsCount} cuotas</Badge>}
                <Badge variant="warning">Wplay</Badge>
              </div>
            </div>
            {results.matches && results.matches.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem' }}>Local</th>
                      <th style={{ padding: '0.6rem' }}>Visitante</th>
                      <th style={{ padding: '0.6rem' }}>1</th>
                      <th style={{ padding: '0.6rem' }}>X</th>
                      <th style={{ padding: '0.6rem' }}>2</th>
                      {hasOU && <th style={{ padding: '0.6rem' }}>Over 2.5</th>}
                      {hasOU && <th style={{ padding: '0.6rem' }}>Under 2.5</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {results.matches.map((m: GroupedMatch, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '0.6rem' }}>{m.homeTeam || '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.awayTeam || '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.oddsHome ?? '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.oddsDraw ?? '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.oddsAway ?? '-'}</td>
                        {hasOU && <td style={{ padding: '0.6rem' }}>{m.overOdds ?? '-'}</td>}
                        {hasOU && <td style={{ padding: '0.6rem' }}>{m.underOdds ?? '-'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No se encontraron partidos.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default WplayPage;
