import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  RefreshCw,
  Sliders,
  Target,
  Zap,
  Activity,
  Layers,
  Calculator,
} from 'lucide-react';
import { SurebetCard } from '../components/SurebetCard.js';
import { ManualArbitrageAnalyzer } from '../components/ManualArbitrageAnalyzer.js';
import { SurebetApi } from '../services/surebetApi.js';
import { SurebetOpportunity } from '../../../shared/types/common.types.js';

export const SurebetDashboardPage: React.FC = () => {
  const [opportunities, setOpportunities] = useState<SurebetOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [minProfit, setMinProfit] = useState<number>(0);
  const [viewMode, setViewMode] = useState<'feed' | 'calculator'>('feed');

  /**
   * Asynchronously queries the backend API for live detected opportunities
   */
  const loadOpportunities = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await SurebetApi.fetchLiveOpportunities(1000);
      setOpportunities(data || []);
    } catch (err) {
      console.error('Error al consultar oportunidades de surebets en vivo:', err);
      setOpportunities([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOpportunities();
  }, [loadOpportunities]);

  /**
   * Dynamically extract unique sports present in real backend opportunities
   * Eliminates hardcoded or static category buttons
   */
  const availableSports = useMemo(() => {
    const unique = new Set<string>();
    opportunities.forEach((o) => {
      if (o.sport) unique.add(o.sport);
    });
    return Array.from(unique);
  }, [opportunities]);

  // Formatter for dynamic sport tags
  const getSportLabel = (sport: string): string => {
    switch (sport.toLowerCase()) {
      case 'football':
      case 'soccer':
        return '⚽ Fútbol';
      case 'tennis':
        return '🎾 Tenis';
      case 'basketball':
        return '🏀 Baloncesto';
      case 'baseball':
        return '⚾ Béisbol';
      case 'esports':
        return '🎮 eSports';
      default:
        return `🏆 ${sport.charAt(0).toUpperCase() + sport.slice(1)}`;
    }
  };

  // Filter opportunities by dynamic sports and minimum profit margin threshold
  const filtered = useMemo(() => {
    return opportunities.filter((o) => {
      if (selectedSport !== 'all' && o.sport !== selectedSport) return false;
      if (o.profitMarginPercentage < minProfit) return false;
      return true;
    });
  }, [opportunities, selectedSport, minProfit]);

  // Real-time telemetry calculations (Start at 0 without static mocks)
  const totalOpps = opportunities.length;
  const maxProfit = opportunities.length > 0 ? Math.max(...opportunities.map((o) => o.profitMarginPercentage)) : 0;
  const avgProfit =
    opportunities.length > 0
      ? (opportunities.reduce((acc, curr) => acc + curr.profitMarginPercentage, 0) / opportunities.length).toFixed(2)
      : '0.00';

  // Count distinct bookmakers in active opportunities
  const activeBookmakers = useMemo(() => {
    const set = new Set<string>();
    opportunities.forEach((o) => o.outcomes.forEach((out) => set.add(out.bookmaker)));
    return set;
  }, [opportunities]);

  const monitoredCount = activeBookmakers.size;

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
              transition: 'all 0.2s ease',
            }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
            {isLoading ? 'Sincronizando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {/* Telemetry Metrics Grid (Starts at 0 without static mocks) */}
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
          <span style={{ fontSize: '0.75rem', color: totalOpps > 0 ? 'var(--accent-success)' : 'var(--text-muted)', fontWeight: 600 }}>
            {totalOpps > 0 ? '● Oportunidades en Vivo' : 'Sin surebets detectadas'}
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
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: totalOpps > 0 ? '#34d399' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            +{maxProfit.toFixed(2)}%
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {totalOpps > 0 ? 'Retorno instantáneo garantizado' : 'Pendiente de escaneo'}
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
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: totalOpps > 0 ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
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
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: monitoredCount > 0 ? '#38bdf8' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {monitoredCount}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {monitoredCount > 0 ? `${monitoredCount} casas con cuotas activas` : 'Ninguna casa registrada'}
          </span>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'calculator' ? (
        <ManualArbitrageAnalyzer />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Dynamic Filter Bar (Clean: starts with "Todos los Deportes" and grows only with real detected sports) */}
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
            {/* Dynamic Sport Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => setSelectedSport('all')}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  border: selectedSport === 'all' ? '1px solid var(--accent-primary)' : '1px solid transparent',
                  background: selectedSport === 'all' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                  color: selectedSport === 'all' ? '#fff' : 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Todos los Deportes
              </button>

              {availableSports.map((sportKey) => (
                <button
                  key={sportKey}
                  onClick={() => setSelectedSport(sportKey)}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: 'var(--radius-md)',
                    border: selectedSport === sportKey ? '1px solid var(--accent-primary)' : '1px solid transparent',
                    background: selectedSport === sportKey ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                    color: selectedSport === sportKey ? '#fff' : 'var(--text-secondary)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  {getSportLabel(sportKey)}
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

          {/* Surebets Cards List or Empty State */}
          {filtered.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '4rem 1.5rem',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-lg)',
              }}
            >
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 1.25rem auto',
                }}
              >
                <Activity size={32} color="var(--accent-primary)" />
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                No hay surebets activas
              </h3>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.9rem',
                  maxWidth: '520px',
                  margin: '0.5rem auto 1.5rem auto',
                  lineHeight: '1.5',
                }}
              >
                No se han detectado oportunidades de arbitraje aún. Realiza un escaneo concurrente en la <strong>Consola de Scraping</strong> o ingresa cuotas en el <strong>Analizador Manual</strong>.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setViewMode('calculator')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 1.25rem',
                    backgroundColor: 'var(--accent-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-glow)',
                  }}
                >
                  <Calculator size={16} />
                  Abrir Calculadora Manual
                </button>

                <button
                  onClick={loadOpportunities}
                  disabled={isLoading}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 1.25rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} style={isLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                  {isLoading ? 'Consultando Backend...' : 'Reintentar Consulta'}
                </button>
              </div>
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
