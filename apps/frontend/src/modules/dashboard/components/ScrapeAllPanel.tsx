import React, { useState } from 'react';
import { Zap, Loader2, CheckCircle2, XCircle, Circle } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { formatCOP } from '../../../shared/utils/formatters.js';
import { BETPLAY_URL } from '../../scrapers/pages/BetPlayPage.js';
import { STAKE_URL } from '../../scrapers/pages/StakePage.js';
import { WPLAY_URL } from '../../scrapers/pages/WplayPage.js';

const API_BASE = 'http://localhost:4000/api';
const EMPTY_SELECTORS = { events: '', homeTeam: '', awayTeam: '', oddsHome: '', oddsDraw: '', oddsAway: '' };
const DEFAULT_BANKROLL = 1000000; // COP

type BookKey = 'betplay' | 'stake' | 'wplay';
type BookStatus = { state: 'idle' | 'loading' | 'success' | 'error'; oddsCount?: number; error?: string };

interface SurebetRow {
  id: string;
  eventName: string;
  outcomes: Array<{ selection: string; bookmaker: string; odd: number }>;
  profitMarginPercentage: number;
}

const BOOK_LABELS: Record<BookKey, string> = { betplay: 'BetPlay', stake: 'Stake', wplay: 'Wplay' };

async function runBetPlay(): Promise<BookStatus> {
  try {
    const res = await fetch(`${API_BASE}/scrape/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: BETPLAY_URL, selectors: EMPTY_SELECTORS, useProxy: false, timeoutMs: 45000 }),
    });
    const data = await res.json();
    if (data.matches && data.matches.length > 0) return { state: 'success', oddsCount: data.oddsCount ?? data.matches.length };
    return { state: 'error', error: data.message || data.error || 'Sin cuotas capturadas' };
  } catch (e: any) {
    return { state: 'error', error: e.message || 'Error de conexión' };
  }
}

async function runStake(): Promise<BookStatus> {
  try {
    const res = await fetch(`${API_BASE}/scrape/custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: STAKE_URL, selectors: EMPTY_SELECTORS, useProxy: false, timeoutMs: 60000 }),
    });
    const data = await res.json();
    if (data.matches && data.matches.length > 0) return { state: 'success', oddsCount: data.oddsCount ?? data.matches.length };
    return { state: 'error', error: data.message || data.error || 'Sin cuotas capturadas' };
  } catch (e: any) {
    return { state: 'error', error: e.message || 'Error de conexión' };
  }
}

async function runWplay(): Promise<BookStatus> {
  try {
    const res = await fetch(`${API_BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [{ url: WPLAY_URL, bookmaker: 'Wplay', useProxy: false, captureScreenshot: false }] }),
    });
    const data = await res.json();
    const single = data.results?.[0] || data.data?.[0];
    const oddsCount = single?.oddsCount ?? (single?.extractedData?.bookmakerOdds || []).length;
    if (single && oddsCount > 0) return { state: 'success', oddsCount };
    return { state: 'error', error: single?.domAlert?.message || 'Sin cuotas capturadas' };
  } catch (e: any) {
    return { state: 'error', error: e.message || 'Error de conexión' };
  }
}

// Panel del dashboard inicial: dispara el scraping de las 3 casas dedicadas
// (BetPlay, Stake, Wplay) en paralelo y, al terminar, calcula automáticamente
// los surebets combinando los datos recién obtenidos.
export const ScrapeAllPanel: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<BookKey, BookStatus>>({
    betplay: { state: 'idle' },
    stake: { state: 'idle' },
    wplay: { state: 'idle' },
  });
  const [surebets, setSurebets] = useState<SurebetRow[]>([]);
  const [totalOdds, setTotalOdds] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [surebetsError, setSurebetsError] = useState<string | null>(null);

  const handleScrapeAll = async () => {
    setRunning(true);
    setDone(false);
    setSurebetsError(null);
    setSurebets([]);
    setStatuses({ betplay: { state: 'loading' }, stake: { state: 'loading' }, wplay: { state: 'loading' } });

    const [betplay, stake, wplay] = await Promise.all([runBetPlay(), runStake(), runWplay()]);
    setStatuses({ betplay, stake, wplay });

    try {
      const res = await fetch(`${API_BASE}/surebets/calculate?totalStake=${DEFAULT_BANKROLL}`);
      const json = await res.json();
      if (json.success) {
        setSurebets(json.data.opportunities || []);
        setTotalOdds(json.data.stats?.total ?? null);
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

  const renderStatusIcon = (s: BookStatus) => {
    if (s.state === 'loading') return <Loader2 size={14} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} color="#38bdf8" />;
    if (s.state === 'success') return <CheckCircle2 size={14} color="#34d399" />;
    if (s.state === 'error') return <XCircle size={14} color="#f87171" />;
    return <Circle size={14} color="var(--text-muted)" />;
  };

  return (
    <Card
      title="🚀 Scraping Rápido — Todas las Casas"
      subtitle="Extrae BetPlay + Stake + Wplay en paralelo y calcula los surebets automáticamente al terminar"
      icon={<Zap size={18} />}
      style={{ marginBottom: '1.5rem' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            onClick={handleScrapeAll}
            disabled={running}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: running ? 'rgba(99,102,241,0.4)' : 'linear-gradient(90deg, #6366f1, #06b6d4)',
              color: '#fff',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? <Loader2 size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={16} />}
            {running ? 'Scrapeando las 3 casas...' : 'Scrapear Todas las Casas'}
          </button>

          {(['betplay', 'stake', 'wplay'] as BookKey[]).map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {renderStatusIcon(statuses[key])}
              <span>{BOOK_LABELS[key]}</span>
              {statuses[key].state === 'success' && <Badge variant="success">{statuses[key].oddsCount} cuotas</Badge>}
              {statuses[key].state === 'error' && (
                <span style={{ color: '#f87171', fontSize: '0.75rem' }} title={statuses[key].error}>
                  falló
                </span>
              )}
            </div>
          ))}
        </div>

        {done && (
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            {surebetsError ? (
              <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{surebetsError}</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    📊 Surebets calculadas ({totalOdds ?? 0} cuotas combinadas, bankroll {formatCOP(DEFAULT_BANKROLL)})
                  </span>
                  <Badge variant={surebets.length > 0 ? 'success' : 'info'}>{surebets.length} oportunidades</Badge>
                </div>

                {surebets.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No se detectaron surebets con esta ronda de cuotas — revisa el módulo <strong>Arbitraje & Surebets</strong> más tarde o baja el margen mínimo.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                          <th style={{ padding: '0.5rem' }}>Partido</th>
                          <th style={{ padding: '0.5rem' }}>Ganancia</th>
                          <th style={{ padding: '0.5rem' }}>Fuentes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {surebets.slice(0, 8).map((sb) => (
                          <tr key={sb.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '0.5rem', fontWeight: 600 }}>{sb.eventName}</td>
                            <td style={{ padding: '0.5rem' }}>
                              <Badge variant="success">+{sb.profitMarginPercentage.toFixed(2)}%</Badge>
                            </td>
                            <td style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {sb.outcomes.map((o) => `${o.bookmaker} (${o.odd})`).join(' + ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default ScrapeAllPanel;
