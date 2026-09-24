import React, { useState, useEffect } from 'react';
import { formatCOP } from '../../../shared/utils/formatters.js';

interface SurebetRow {
  id: string;
  eventName: string;
  sport: string;
  marketType: string;
  outcomes: Array<{ selection: string; bookmaker: string; odd: number; stakePercentage: number; recommendedStake: number }>;
  totalImpliedProbability: number;
  isSurebet: boolean;
  profitMarginPercentage: number;
  totalInvestment: number;
  guaranteedProfit: number;
  isLive?: boolean;
}

export const SurebetPage: React.FC = () => {
  const [bankroll, setBankroll] = useState<number>(1000000);
  const [surebets, setSurebets] = useState<SurebetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ wplay: number; stake: number; betplay: number; bwin: number; rushbet: number; total: number; byBookmaker?: Record<string, number> } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [lastGlobalAt, setLastGlobalAt] = useState<string | null>(null);

  const fetchSurebets = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:4000/api/surebets/calculate?totalStake=${bankroll}`);
      const json = await res.json();
      if (json.success) {
        setSurebets(json.data.opportunities || []);
        setStats(json.data.stats || json.data.sources || null);
        setLastGlobalAt(json.data.stats?.timestamp ?? null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/surebets/history');
      const json = await res.json();
      if (json.success) setHistory(json.data || []);
    } catch {}
  };

  useEffect(() => {
    fetchSurebets();
    fetchHistory();
  }, []);

  // Antigüedad del último Scraping Global (el cálculo usa solo esos datos)
  const globalAgeMin = lastGlobalAt && (stats?.total ?? 0) > 0 ? Math.max(0, Math.round((Date.now() - new Date(lastGlobalAt).getTime()) / 60000)) : null;

  const handleCalculate = () => {
    fetchSurebets();
  };

  const handleRefresh = async () => {
    await fetch('http://localhost:4000/api/surebets/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalStake: bankroll }),
    });
    fetchSurebets();
    fetchHistory();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>💰 Surebets — Arbitraje Deportivo</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Wplay ({stats?.wplay ?? 0}) + Stake ({stats?.stake ?? 0}) + BetPlay ({stats?.betplay ?? 0}) + Bwin ({stats?.bwin ?? 0}) + Rushbet ({stats?.rushbet ?? 0}) = {stats?.total ?? 0} odds | TIP = 1/mejor1 + 1/mejorX + 1/mejor2 &lt; 1.0
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem' }}>Bankroll (COP):</label>
          <input
            type="number"
            step={10000}
            value={bankroll}
            onChange={(e) => setBankroll(Number(e.target.value) || 1000000)}
            style={{ width: '140px', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{formatCOP(bankroll)}</span>
          <button
            onClick={handleCalculate}
            disabled={loading}
            style={{ padding: '0.5rem 1rem', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 700, cursor: 'pointer' }}
          >
            {loading ? 'Calculando...' : 'Calcular Surebets'}
          </button>
          <button
            onClick={handleRefresh}
            style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          padding: '0.75rem 1rem',
          borderRadius: '10px',
          fontSize: '0.8rem',
          border: `1px solid ${globalAgeMin === null ? 'rgba(245,158,11,0.3)' : 'rgba(99,102,241,0.3)'}`,
          background: globalAgeMin === null ? 'rgba(245,158,11,0.1)' : 'rgba(99,102,241,0.08)',
          color: globalAgeMin === null ? '#fbbf24' : 'var(--text-secondary)',
        }}
      >
        {globalAgeMin === null ? (
          <>🌐 Aún no hay datos: este módulo calcula <strong>solo con el Scraping Global</strong>. Ejecuta uno desde <strong>Scraping Global</strong> (el scraping de cada casa por separado no entra al cálculo).</>
        ) : (
          <>🌐 Calculando con los datos del <strong>último Scraping Global</strong> (hace {globalAgeMin} min). El scraping de cada casa por separado no entra al cálculo.</>
        )}
      </div>

      {surebets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <p style={{ color: 'var(--text-muted)' }}>No hay surebets — ejecuta un Scraping Global para combinar las cuotas de todas las casas.</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Se necesitan al menos 2 bookmakers con el mismo evento (ej. Wplay + Stake) y TIP &lt; 1.0</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '0.7rem' }}>Partido</th>
                <th style={{ padding: '0.7rem' }}>Mejor 1</th>
                <th style={{ padding: '0.7rem' }}>Mejor X</th>
                <th style={{ padding: '0.7rem' }}>Mejor 2</th>
                <th style={{ padding: '0.7rem' }}>Ganancia</th>
                <th style={{ padding: '0.7rem' }}>Fuentes</th>
              </tr>
            </thead>
            <tbody>
              {surebets.map((sb) => {
                const best1 = sb.outcomes.find((o) => o.selection === '1');
                const bestX = sb.outcomes.find((o) => o.selection === 'X');
                const best2 = sb.outcomes.find((o) => o.selection === '2');
                return (
                  <tr key={sb.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.7rem', fontWeight: 600 }}>
                      {sb.eventName}
                      {sb.isLive && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: '#fbbf24' }}>🔴 EN VIVO</span>}
                    </td>
                    <td style={{ padding: '0.7rem' }}>{best1 ? `${best1.odd} (${best1.bookmaker})` : '-'}</td>
                    <td style={{ padding: '0.7rem' }}>{bestX ? `${bestX.odd} (${bestX.bookmaker})` : '-'}</td>
                    <td style={{ padding: '0.7rem' }}>{best2 ? `${best2.odd} (${best2.bookmaker})` : '-'}</td>
                    <td style={{ padding: '0.7rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '999px',
                          fontWeight: 700,
                          fontSize: '0.75rem',
                          background: sb.profitMarginPercentage > 0 ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)',
                          color: sb.profitMarginPercentage > 0 ? '#34d399' : '#f87171',
                          border: `1px solid ${sb.profitMarginPercentage > 0 ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
                        }}
                      >
                        {sb.profitMarginPercentage.toFixed(2)}%
                      </span>
                    </td>
                    <td style={{ padding: '0.7rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {sb.outcomes.map((o) => o.bookmaker).join(' + ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>Histórico (últimos 5)</h3>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {history.slice(0, 5).map((h: any, i: number) => (
              <div key={i} style={{ padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', fontSize: '0.75rem', border: '1px solid var(--border-color)' }}>
                {new Date(h.timestamp).toLocaleTimeString()} — {h.surebetsFoundCount} surebets — {h.highestProfitMargin?.toFixed(2)}%
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SurebetPage;
