import React, { useState } from 'react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';

interface SelectorConfig {
  events: string;
  homeTeam: string;
  awayTeam: string;
  oddsHome: string;
  oddsDraw: string;
  oddsAway: string;
  matchTime?: string;
  leagueName?: string;
  matchStatus?: string;
  homeScore?: string;
  awayScore?: string;
  overOdds?: string;
  underOdds?: string;
  handicapHome?: string;
  handicapAway?: string;
  bothScoreYes?: string;
  bothScoreNo?: string;
  [key: string]: string | undefined;
}

const API_BASE = 'http://localhost:4000/api';

export const SelectorConfigPage: React.FC = () => {
  const [url, setUrl] = useState('');
  const [selectors, setSelectors] = useState<SelectorConfig>({
    events: '',
    homeTeam: '',
    awayTeam: '',
    oddsHome: '',
    oddsDraw: '',
    oddsAway: '',
  });
  const [useProxy, setUseProxy] = useState(true);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const updateSelector = (key: keyof SelectorConfig, value: string) => {
    setSelectors((prev) => ({ ...prev, [key]: value }));
  };

  const validateSelectors = (): boolean => {
    const required = ['events', 'homeTeam', 'awayTeam', 'oddsHome', 'oddsDraw', 'oddsAway'];
    const missing = required.filter((k) => !selectors[k as keyof SelectorConfig]);
    if (missing.length > 0) {
      setError(`Faltan selectores obligatorios: ${missing.join(', ')}`);
      return false;
    }
    return true;
  };

  const handleScrape = async () => {
    if (!url) {
      setError('Por favor ingresa una URL');
      return;
    }
    if (!validateSelectors()) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch(`${API_BASE}/scrape/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, selectors, useProxy, timeoutMs: 30000 }),
      });
      const data = await res.json();
      if (data.status === 'success') {
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

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>🎯 Scraping con Selectores Personalizados</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Configura los 6 selectores obligatorios y los opcionales. Funciona con cualquier sitio de apuestas sin tocar el backend.
        </p>
      </div>

      <Card title="1. Configurar URL" subtitle="Ingresa la URL del sitio de apuestas">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>URL del sitio de apuestas</label>
            <input
              type="text"
              placeholder="https://www.betplay.com/apuestas/futbol"
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
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={useProxy} onChange={(e) => setUseProxy(e.target.checked)} />
            Usar Proxy
            <Badge variant={useProxy ? 'success' : 'warning'}>{useProxy ? '✅ Proxy activo' : '⚠️ IP directa'}</Badge>
          </label>
        </div>
      </Card>

      <div style={{ height: '1.2rem' }} />

      <Card title="2. Configurar Selectores CSS" subtitle="Los selectores con * son obligatorios (mínimo 6)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          <SelectorInput label="Contenedor de eventos *" description="Elemento que contiene cada partido completo" placeholder=".match-card, .event-row, div[data-match]" value={selectors.events} onChange={(v) => updateSelector('events', v)} required />
          <SelectorInput label="Equipo local *" description="Nombre del equipo que juega en casa" placeholder=".team-home, .home-team" value={selectors.homeTeam} onChange={(v) => updateSelector('homeTeam', v)} required />
          <SelectorInput label="Equipo visitante *" description="Nombre del equipo visitante" placeholder=".team-away, .away-team" value={selectors.awayTeam} onChange={(v) => updateSelector('awayTeam', v)} required />
          <SelectorInput label="Cuota local (1) *" description="Cuota victoria local" placeholder=".odds-1, .price:first-child" value={selectors.oddsHome} onChange={(v) => updateSelector('oddsHome', v)} required />
          <SelectorInput label="Cuota empate (X) *" description="Cuota para empate" placeholder=".odds-x, .price:nth-child(2)" value={selectors.oddsDraw} onChange={(v) => updateSelector('oddsDraw', v)} required />
          <SelectorInput label="Cuota visitante (2) *" description="Cuota victoria visitante" placeholder=".odds-2, .price:last-child" value={selectors.oddsAway} onChange={(v) => updateSelector('oddsAway', v)} required />

          <SelectorInput label="Hora del partido" description="Horario del encuentro" placeholder=".match-time, .event-time" value={selectors.matchTime || ''} onChange={(v) => updateSelector('matchTime', v)} />
          <SelectorInput label="Nombre de la liga" description="Liga o torneo" placeholder=".league-name, .tournament" value={selectors.leagueName || ''} onChange={(v) => updateSelector('leagueName', v)} />
          <SelectorInput label="Estado del partido" description="En vivo, Finalizado, Programado" placeholder=".match-status, .event-status" value={selectors.matchStatus || ''} onChange={(v) => updateSelector('matchStatus', v)} />
          <SelectorInput label="Goles local" description="Goles del equipo local" placeholder=".score-home, .home-score" value={selectors.homeScore || ''} onChange={(v) => updateSelector('homeScore', v)} />
          <SelectorInput label="Goles visitante" description="Goles del equipo visitante" placeholder=".score-away, .away-score" value={selectors.awayScore || ''} onChange={(v) => updateSelector('awayScore', v)} />
          <SelectorInput label="Over 2.5" description="Cuota Over 2.5 goles" placeholder=".odds-over, .over-price" value={selectors.overOdds || ''} onChange={(v) => updateSelector('overOdds', v)} />
          <SelectorInput label="Under 2.5" description="Cuota Under 2.5 goles" placeholder=".odds-under, .under-price" value={selectors.underOdds || ''} onChange={(v) => updateSelector('underOdds', v)} />
          <SelectorInput label="Handicap local" description="Handicap asiático local" placeholder=".handicap-home" value={selectors.handicapHome || ''} onChange={(v) => updateSelector('handicapHome', v)} />
          <SelectorInput label="Handicap visitante" description="Handicap asiático visitante" placeholder=".handicap-away" value={selectors.handicapAway || ''} onChange={(v) => updateSelector('handicapAway', v)} />
          <SelectorInput label="Ambos marcan Sí" description="Cuota Ambos marcan Sí" placeholder=".both-score-yes" value={selectors.bothScoreYes || ''} onChange={(v) => updateSelector('bothScoreYes', v)} />
          <SelectorInput label="Ambos marcan No" description="Cuota Ambos marcan No" placeholder=".both-score-no" value={selectors.bothScoreNo || ''} onChange={(v) => updateSelector('bothScoreNo', v)} />
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
          background: loading || !url ? 'rgba(99,102,241,0.4)' : 'linear-gradient(90deg, #6366f1, #06b6d4)',
          color: '#fff',
          fontWeight: 700,
          cursor: loading || !url ? 'not-allowed' : 'pointer',
          fontSize: '0.95rem',
        }}
      >
        {loading ? '⏳ Ejecutando...' : '🚀 Ejecutar Scraping con Selectores'}
      </button>

      {error && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
      )}

      {results && (
        <div style={{ marginTop: '1.5rem' }}>
          <Card title="📊 Resultados del Scraping" subtitle={`${results.totalMatches || results.matches?.length || 0} partidos en ${results.durationMs}ms`}>
            <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <div><strong>URL:</strong> {results.url}</div>
              <div><strong>Proxy:</strong> {results.proxyUsed || 'N/A'}</div>
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
                      <th style={{ padding: '0.6rem' }}>Liga</th>
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
                        <td style={{ padding: '0.6rem' }}>{m.leagueName || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No se encontraron partidos con esos selectores. Revisa el contenedor `events` en DevTools.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

const SelectorInput: React.FC<{ label: string; description: string; placeholder: string; value: string; onChange: (v: string) => void; required?: boolean }> = ({ label, description, placeholder, value, onChange, required }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
        {label} {required && <span style={{ color: '#f87171' }}>*</span>}
      </label>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{description}</span>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '0.5rem 0.7rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          background: 'rgba(255,255,255,0.04)',
          color: 'var(--text-primary)',
          fontSize: '0.8rem',
        }}
      />
    </div>
  );
};
