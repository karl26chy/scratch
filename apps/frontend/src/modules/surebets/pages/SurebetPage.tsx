import React, { useState, useEffect } from 'react';

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
}

export const SurebetPage: React.FC = () => {
  const [bankroll, setBankroll] = useState<number>(1000);
  const [surebets, setSurebets] = useState<SurebetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{ wplay: number; stake: number; total: number } | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const fetchSurebets = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:4000/api/surebets/calculate?totalStake=${bankroll}`);
      const json = await res.json();
      if (json.success) {
        setSurebets(json.data.opportunities || []);
        setStats(json.data.stats || json.data.sources || null);
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
            Wplay ({stats?.wplay ?? 0}) + Stake ({stats?.stake ?? 0}) = {stats?.total ?? 0} odds | TIP = 1/mejor1 + 1/mejorX + 1/mejor2 &lt; 1.0
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.8rem' }}>Bankroll:</label>
          <input
            type="number"
            value={bankroll}
            onChange={(e) => setBankroll(Number(e.target.value) || 1000)}
            style={{ width: '120px', padding: '0.4rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}
          />
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

      {surebets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <p style={{ color: 'var(--text-muted)' }}>No hay surebets — scrapear Wplay (Consola) y Stake (Selectores) para combinar.</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>Se necesitan al menos 2 bookmakers con mismo evento (ej. Wplay + Stake) y TIP &lt; 1.0</p>
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
                    <td style={{ padding: '0.7rem', fontWeight: 600 }}>{sb.eventName}</td>
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
