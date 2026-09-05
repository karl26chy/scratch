import React, { useEffect, useState } from 'react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { AdaptersApi } from '../../adapters/services/adaptersApi.js';

const API_BASE = 'http://localhost:4000/api';
export const STAKE_URL = 'https://stake.com.co/deportes/football';
const STORAGE_KEY = 'scraping_stake_last_result';

// Módulo dedicado de scraping para Stake (stake.com.co) — motor KickerTech.
// Usa el mismo endpoint que "Selectores Custom" (/api/scrape/custom) con la URL
// preconfigurada y selectores vacíos: las cuotas se obtienen vía el adapter de
// red stakeKickerAdapter (intercepción de events-by-path.json), incluyendo
// 1X2, Ambos Anotan (BTTS) y Over/Under 2.5.
export const StakePage: React.FC = () => {
  const [url, setUrl] = useState(STAKE_URL);
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
  const [hasAdapter, setHasAdapter] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AdaptersApi.check('stake.com.co')
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

  const handleScrape = async () => {
    if (!url) {
      setError('Por favor ingresa una URL');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch(`${API_BASE}/scrape/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          selectors: {
            events: '',
            homeTeam: '',
            awayTeam: '',
            oddsHome: '',
            oddsDraw: '',
            oddsAway: '',
          },
          useProxy,
          timeoutMs: 60000,
        }),
      });
      const data = await res.json();
      if (data.matches && data.matches.length > 0) {
        setResults(data);
        setError(null);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {}
      } else if (data.status === 'success') {
        setError('No se encontraron cuotas — el adapter no capturó datos de red esta vez, reintenta.');
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

  const hasBts = results?.matches?.some((m: any) => m.bothScoreYes != null || m.bothScoreNo != null);
  const hasOU = results?.matches?.some((m: any) => m.overOdds != null || m.underOdds != null);

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>🎰 Scraping Stake</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Módulo dedicado para stake.com.co (fútbol). Intercepta events-by-path.json — 1X2, Ambos Anotan y Over/Under 2.5, sin selectores CSS.
        </p>
      </div>

      <Card title="1. Configurar URL" subtitle="Preconfigurada para el hub de fútbol de Stake">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>URL de Stake</label>
            <input
              type="text"
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
          </div>

          {hasAdapter === true && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Badge variant="purple">📡 Network Interceptor activo (KickerTech)</Badge>
            </div>
          )}
          {hasAdapter === false && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Badge variant="warning">⚠️ Adapter no detectado — reinicia el backend</Badge>
            </div>
          )}

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
          background: loading || !url ? 'rgba(239,68,68,0.4)' : 'linear-gradient(90deg, #dc2626, #f59e0b)',
          color: '#fff',
          fontWeight: 700,
          cursor: loading || !url ? 'not-allowed' : 'pointer',
          fontSize: '0.95rem',
        }}
      >
        {loading ? '⏳ Ejecutando... (puede tardar ~20s)' : '🚀 Ejecutar Scraping Stake'}
      </button>

      {error && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
      )}

      {results && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card title="📊 Resultados del Scraping" subtitle={`${results.totalMatches || results.matches?.length || 0} partidos en ${results.durationMs}ms — Fuente: ${results.source || 'dom'} ${results.oddsCount !== undefined ? `· ${results.oddsCount} cuotas` : ''}`}>
            <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div><strong>URL:</strong> {results.url}</div>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span><strong>Proxy:</strong> {results.proxyUsed || 'N/A'}</span>
                <Badge variant={results.source === 'network' ? 'purple' : 'info'}>{results.source === 'network' ? '📡 Red (KickerTech)' : '🔍 DOM'}</Badge>
                {results.oddsCount !== undefined && <Badge variant="success">{results.oddsCount} cuotas</Badge>}
                <Badge variant="warning">Stake</Badge>
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
                      {hasBts && <th style={{ padding: '0.6rem' }}>BTTS Sí</th>}
                      {hasBts && <th style={{ padding: '0.6rem' }}>BTTS No</th>}
                      {hasOU && <th style={{ padding: '0.6rem' }}>Over 2.5</th>}
                      {hasOU && <th style={{ padding: '0.6rem' }}>Under 2.5</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {results.matches.map((m: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '0.6rem' }}>{m.homeTeam || '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.awayTeam || '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.oddsHome ?? '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.oddsDraw ?? '-'}</td>
                        <td style={{ padding: '0.6rem' }}>{m.oddsAway ?? '-'}</td>
                        {hasBts && <td style={{ padding: '0.6rem' }}>{m.bothScoreYes ?? '-'}</td>}
                        {hasBts && <td style={{ padding: '0.6rem' }}>{m.bothScoreNo ?? '-'}</td>}
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

export default StakePage;
