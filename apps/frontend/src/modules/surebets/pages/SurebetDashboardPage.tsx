import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  RefreshCw,
  Sliders,
  Target,
  Zap,
  Activity,
  Layers,
} from 'lucide-react';
import { SurebetCard } from '../components/SurebetCard.js';
import { ManualArbitrageAnalyzer } from '../components/ManualArbitrageAnalyzer.js';
import { SurebetApi } from '../services/surebetApi.js';
import { SurebetOpportunity } from '../../../shared/types/common.types.js';

export const SurebetDashboardPage: React.FC = () => {
  const [opportunities, setOpportunities] = useState<SurebetOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [minProfit, setMinProfit] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'feed' | 'calculator'>('feed');

  const loadOpportunities = async () => {
    setIsLoading(true);
    try {
      const data = await SurebetApi.fetchLiveOpportunities(1000);
      setOpportunities(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOpportunities();
  }, []);

  // Filter opportunities
  const filtered = opportunities.filter((o) => {
    if (selectedSport !== 'all' && o.sport !== selectedSport) return false;
    if (o.profitMarginPercentage < minProfit) return false;
    return true;
  });

  const totalOpps = opportunities.length;
  const maxProfit = opportunities.length > 0 ? Math.max(...opportunities.map((o) => o.profitMarginPercentage)) : 0;
  const avgProfit =
    opportunities.length > 0
      ? (opportunities.reduce((acc, curr) => acc + curr.profitMarginPercentage, 0) / opportunities.length).toFixed(2)
      : '0.00';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Header with Title and Mode Switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Módulo de Detección de Surebets & Arbitraje Deportivo
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.3rem' }}>
            Monitoreo en tiempo real de discrepancias en cuotas decimales con cálculo de probabilidad implícita total (TIP) y optimización de capital.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              display: 'flex',
              background: '#090d16',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '0.25rem',
            }}
          >
            <button
              onClick={() => setViewMode('feed')}
              style={{
                padding: '0.45rem 0.9rem',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: viewMode === 'feed' ? 'var(--accent-primary)' : 'transparent',
                color: viewMode === 'feed' ? '#fff' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Feed de Oportunidades
            </button>
            <button
              onClick={() => setViewMode('calculator')}
              style={{
                padding: '0.45rem 0.9rem',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: viewMode === 'calculator' ? 'var(--accent-primary)' : 'transparent',
                color: viewMode === 'calculator' ? '#fff' : 'var(--text-secondary)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              Calculadora Manual
            </button>
          </div>

          <button
            onClick={loadOpportunities}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.55rem 0.9rem',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Telemetry Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Surebets Activas</span>
            <Target size={18} color="var(--accent-primary)" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {totalOpps}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--accent-success)', fontWeight: 600 }}>
            ● 100% Sin Riesgo de Pérdida
          </span>
        </div>

        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Mayor Margen Detectado</span>
            <TrendingUp size={18} color="var(--accent-success)" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
            +{maxProfit.toFixed(2)}%
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Retorno instantáneo garantizado
          </span>
        </div>

        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>ROI Promedio</span>
            <Zap size={18} color="var(--accent-secondary)" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            +{avgProfit}%
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Por ciclo de arbitraje
          </span>
        </div>

        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Casas Monitorizadas</span>
            <Layers size={18} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
            6
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Pinnacle, Bet365, Betfair, 1xBet, WH, Bwin
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'calculator' ? (
        <ManualArbitrageAnalyzer />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Filter Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              padding: '1rem 1.25rem',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            {/* Sport Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: 'Todos los Deportes' },
                { id: 'football', label: '⚽ Fútbol' },
                { id: 'tennis', label: '🎾 Tenis' },
                { id: 'basketball', label: '🏀 Baloncesto' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedSport(tab.id)}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 'var(--radius-md)',
                    border: selectedSport === tab.id ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    background: selectedSport === tab.id ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: selectedSport === tab.id ? '#fff' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Min Profit Slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Sliders size={15} color="var(--text-muted)" />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Margen Mínimo: <strong>{minProfit}%</strong>
              </span>
              <input
                type="range"
                min="0"
                max="5"
                step="0.5"
                value={minProfit}
                onChange={(e) => setMinProfit(parseFloat(e.target.value))}
                style={{ width: '100px', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Surebets Cards List */}
          {filtered.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '3rem 1rem',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              <Activity size={32} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem auto' }} />
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                No se encontraron oportunidades con los filtros seleccionados
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.3rem' }}>
                Prueba a reducir el umbral de margen mínimo o selecciona otra disciplina deportiva.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {filtered.map((opp) => (
                <SurebetCard key={opp.id} opportunity={opp} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
