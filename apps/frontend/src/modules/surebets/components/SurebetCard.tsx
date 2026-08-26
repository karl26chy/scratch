import React, { useState } from 'react';
import { TrendingUp, ShieldCheck, Calculator } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { SurebetOpportunity } from '../../../shared/types/common.types.js';

interface SurebetCardProps {
  opportunity: SurebetOpportunity;
}

export const SurebetCard: React.FC<SurebetCardProps> = ({ opportunity }) => {
  const [bankroll, setBankroll] = useState<number>(opportunity.totalInvestment || 1000);

  // Recalculate dynamic stakes based on user-controlled bankroll
  const tip = opportunity.totalImpliedProbability;
  const isSurebet = opportunity.isSurebet;

  const dynamicOutcomes = opportunity.outcomes.map((outcome) => {
    const rawStake = (bankroll * outcome.stakePercentage) / 100;
    const stake = Math.round(rawStake * 100) / 100;
    const payout = Math.round(stake * outcome.odd * 100) / 100;
    return {
      ...outcome,
      calculatedStake: stake,
      calculatedPayout: payout,
    };
  });

  const minPayout = Math.min(...dynamicOutcomes.map((o) => o.calculatedPayout));
  const netProfit = Math.round((minPayout - bankroll) * 100) / 100;

  const getSportIcon = (sport: string) => {
    switch (sport) {
      case 'football':
        return '⚽ Fútbol';
      case 'tennis':
        return '🎾 Tenis';
      case 'basketball':
        return '🏀 Baloncesto';
      case 'table_tennis':
        return '🏓 Tenis de Mesa';
      default:
        return '🏆 Deportes';
    }
  };

  const getMarketLabel = (market: string) => {
    switch (market) {
      case '1X2':
        return '1X2 (3-Way Ganador)';
      case 'MONEYLINE_2WAY':
        return 'Moneyline (2-Way Sin Empate)';
      case 'OVER_UNDER_2_5':
        return 'Más/Menos 2.5 Goles';
      default:
        return market;
    }
  };

  return (
    <Card
      title={opportunity.eventName}
      subtitle={`${getSportIcon(opportunity.sport)} • ${getMarketLabel(opportunity.marketType)}`}
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Badge variant={isSurebet ? 'success' : 'warning'} icon={<TrendingUp size={13} />}>
            +{opportunity.profitMarginPercentage.toFixed(2)}% ROI
          </Badge>
          <span
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '0.2rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            TIP: {(tip * 100).toFixed(2)}%
          </span>
        </div>
      }
    >
      {/* Odds Comparison Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${opportunity.outcomes.length}, 1fr)`,
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        {dynamicOutcomes.map((outcome, idx) => (
          <div
            key={idx}
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-md)',
              padding: '0.85rem',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: 'var(--text-muted)',
                marginBottom: '0.25rem',
              }}
            >
              Selección {outcome.selection}
            </div>

            <div
              style={{
                fontSize: '1.4rem',
                fontWeight: 800,
                color: 'var(--accent-primary)',
                fontFamily: 'var(--font-mono)',
                margin: '0.2rem 0',
              }}
            >
              {outcome.odd.toFixed(2)}
            </div>

            <div
              style={{
                display: 'inline-block',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#38bdf8',
                background: 'rgba(56, 189, 248, 0.1)',
                padding: '0.15rem 0.5rem',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {outcome.bookmaker}
            </div>
          </div>
        ))}
      </div>

      {/* Interactive Stake Distribution Calculator */}
      <div
        style={{
          background: '#090d16',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            <Calculator size={15} color="var(--accent-secondary)" />
            Distribución Óptima de Capital (Bankroll)
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Capital Total:</span>
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 'var(--radius-sm)', padding: '0.15rem 0.5rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginRight: '0.2rem' }}>$</span>
              <input
                type="number"
                min="10"
                step="50"
                value={bankroll}
                onChange={(e) => setBankroll(Math.max(1, parseFloat(e.target.value) || 0))}
                style={{
                  width: '75px',
                  background: 'transparent',
                  border: 'none',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
            </div>
          </div>
        </div>

        {/* Breakdown table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', textAlign: 'left' }}>
                <th style={{ padding: '0.4rem 0.5rem' }}>Casa</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Apuesta a</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Cuota</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>% Capital</th>
                <th style={{ padding: '0.4rem 0.5rem' }}>Monto Sugerido</th>
                <th style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>Retorno Bruto</th>
              </tr>
            </thead>
            <tbody>
              {dynamicOutcomes.map((outcome, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.03)' }}>
                  <td style={{ padding: '0.45rem 0.5rem', fontWeight: 600, color: '#38bdf8' }}>{outcome.bookmaker}</td>
                  <td style={{ padding: '0.45rem 0.5rem', color: 'var(--text-secondary)' }}>Selección {outcome.selection}</td>
                  <td style={{ padding: '0.45rem 0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)', fontWeight: 600 }}>{outcome.odd.toFixed(2)}</td>
                  <td style={{ padding: '0.45rem 0.5rem', color: 'var(--text-muted)' }}>{outcome.stakePercentage.toFixed(1)}%</td>
                  <td style={{ padding: '0.45rem 0.5rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    ${outcome.calculatedStake.toFixed(2)}
                  </td>
                  <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontWeight: 600, color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                    ${outcome.calculatedPayout.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Guaranteed Return Summary */}
        <div
          style={{
            marginTop: '0.85rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-success)', fontSize: '0.85rem', fontWeight: 700 }}>
            <ShieldCheck size={16} /> Beneficio Libre de Riesgo Garantizado
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Retorno Mínimo: </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                ${minPayout.toFixed(2)}
              </span>
            </div>

            <div style={{ background: 'rgba(52, 211, 153, 0.1)', border: '1px solid rgba(52, 211, 153, 0.2)', padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: '0.3rem' }}>Ganancia Neta:</span>
              <span style={{ fontSize: '0.9rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                +${netProfit.toFixed(2)} (+{opportunity.profitMarginPercentage.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
