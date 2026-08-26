import React, { useState } from 'react';
import { Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';
import { MarketType } from '../../../shared/types/common.types.js';

export const ManualArbitrageAnalyzer: React.FC = () => {
  const [marketType, setMarketType] = useState<MarketType>('1X2');
  const [bankroll, setBankroll] = useState<number>(1000);

  // 3-way default values
  const [bookmaker1, setBookmaker1] = useState('Pinnacle');
  const [odd1, setOdd1] = useState('2.85');

  const [bookmakerX, setBookmakerX] = useState('Betfair');
  const [oddX, setOddX] = useState('3.75');

  const [bookmaker2, setBookmaker2] = useState('WilliamHill');
  const [odd2, setOdd2] = useState('2.90');

  // Calculation state
  const o1 = parseFloat(odd1) || 0;
  const ox = parseFloat(oddX) || 0;
  const o2 = parseFloat(odd2) || 0;

  let tip = 0;
  let isValid = false;
  let items: Array<{ name: string; bookmaker: string; odd: number }> = [];

  if (marketType === '1X2') {
    if (o1 > 1 && ox > 1 && o2 > 1) {
      tip = 1 / o1 + 1 / ox + 1 / o2;
      isValid = true;
      items = [
        { name: '1 (Local)', bookmaker: bookmaker1, odd: o1 },
        { name: 'X (Empate)', bookmaker: bookmakerX, odd: ox },
        { name: '2 (Visitante)', bookmaker: bookmaker2, odd: o2 },
      ];
    }
  } else {
    if (o1 > 1 && o2 > 1) {
      tip = 1 / o1 + 1 / o2;
      isValid = true;
      items = [
        { name: '1 (Opción A)', bookmaker: bookmaker1, odd: o1 },
        { name: '2 (Opción B)', bookmaker: bookmaker2, odd: o2 },
      ];
    }
  }

  const isSurebet = isValid && tip < 1.0;
  const profitMargin = isValid ? ((1 / tip) - 1) * 100 : 0;

  const stakes = items.map((item) => {
    const rawStake = (bankroll * (1 / (tip * item.odd)));
    const rounded = Math.round(rawStake * 100) / 100;
    const payout = Math.round(rounded * item.odd * 100) / 100;
    return {
      ...item,
      stake: rounded,
      payout,
      percentage: (1 / (tip * item.odd)) * 100,
    };
  });

  const minPayout = stakes.length > 0 ? Math.min(...stakes.map((s) => s.payout)) : 0;
  const netProfit = Math.round((minPayout - bankroll) * 100) / 100;

  return (
    <Card
      title="Calculadora y Simulador Manual de Arbitraje Deportivo"
      subtitle="Prueba combinaciones de cuotas de 2 o 3 opciones para validar matemáticamente la condición de Surebet"
      icon={<Sparkles size={18} />}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Market Type Selector and Bankroll */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Tipo de Mercado
            </label>
            <select
              value={marketType}
              onChange={(e) => setMarketType(e.target.value as MarketType)}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            >
              <option value="1X2">3 Opciones (1X2 Fútbol: Local / Empate / Visitante)</option>
              <option value="MONEYLINE_2WAY">2 Opciones (Moneyline / Más/Menos / Tenis / Basket)</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Capital Total a Invertir ($)
            </label>
            <input
              type="number"
              min="10"
              value={bankroll}
              onChange={(e) => setBankroll(Math.max(1, parseFloat(e.target.value) || 0))}
              style={{
                width: '100%',
                padding: '0.65rem 0.85rem',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Inputs Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: marketType === '1X2' ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
            gap: '1rem',
          }}
        >
          {/* Option 1 */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>
              Opción 1 (Local / A)
            </span>
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Casa de Apuestas"
                value={bookmaker1}
                onChange={(e) => setBookmaker1(e.target.value)}
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)', background: '#090d16', color: '#38bdf8' }}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Cuota Decimal (ej. 2.85)"
                value={odd1}
                onChange={(e) => setOdd1(e.target.value)}
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)', background: '#090d16', color: '#fff' }}
              />
            </div>
          </div>

          {/* Option X if 1X2 */}
          {marketType === '1X2' && (
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-secondary)', textTransform: 'uppercase' }}>
                Opción X (Empate)
              </span>
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Casa de Apuestas"
                  value={bookmakerX}
                  onChange={(e) => setBookmakerX(e.target.value)}
                  style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)', background: '#090d16', color: '#38bdf8' }}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Cuota Decimal (ej. 3.75)"
                  value={oddX}
                  onChange={(e) => setOddX(e.target.value)}
                  style={{ padding: '0.45rem 0.6rem', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)', background: '#090d16', color: '#fff' }}
                />
              </div>
            </div>
          )}

          {/* Option 2 */}
          <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase' }}>
              Opción 2 (Visitante / B)
            </span>
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Casa de Apuestas"
                value={bookmaker2}
                onChange={(e) => setBookmaker2(e.target.value)}
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.8rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)', background: '#090d16', color: '#38bdf8' }}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Cuota Decimal (ej. 2.90)"
                value={odd2}
                onChange={(e) => setOdd2(e.target.value)}
                style={{ padding: '0.45rem 0.6rem', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'var(--font-mono)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.1)', background: '#090d16', color: '#fff' }}
              />
            </div>
          </div>
        </div>

        {/* Results Banner */}
        {isValid && (
          <div
            style={{
              padding: '1.25rem',
              borderRadius: 'var(--radius-md)',
              background: isSurebet ? 'rgba(52, 211, 153, 0.05)' : 'rgba(239, 68, 68, 0.05)',
              border: isSurebet ? '1px solid rgba(52, 211, 153, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {isSurebet ? (
                  <CheckCircle2 size={20} color="var(--accent-success)" />
                ) : (
                  <AlertCircle size={20} color="var(--accent-danger)" />
                )}
                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: isSurebet ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                    {isSurebet ? '¡SUREBET DETECTADA! (ARBITRAJE POSITIVO)' : 'NO ES SUREBET (MARGEN NEGATIVO)'}
                  </h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {isSurebet
                      ? 'La suma de probabilidades implícitas es menor al 100%, garantizando ganancia matemática.'
                      : 'La probabilidad implícita total excede el 100% (margen a favor de las casas de apuestas).'}
                  </p>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Margen de Beneficio:</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: isSurebet ? '#34d399' : 'var(--accent-danger)' }}>
                  {isSurebet ? `+${profitMargin.toFixed(2)}%` : `${profitMargin.toFixed(2)}%`}
                </div>
              </div>
            </div>

            {/* Stakes preview */}
            {isSurebet && (
              <div style={{ background: '#090d16', padding: '0.85rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stakes.length}, 1fr)`, gap: '0.5rem', textAlign: 'center' }}>
                  {stakes.map((s, idx) => (
                    <div key={idx} style={{ padding: '0.4rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Apostar en {s.bookmaker}:</span>
                      <strong style={{ fontSize: '0.95rem', color: '#fff', fontFamily: 'var(--font-mono)' }}>${s.stake.toFixed(2)}</strong>
                      <span style={{ fontSize: '0.7rem', color: '#38bdf8', display: 'block' }}>({s.percentage.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '0.6rem', textAlign: 'center', fontSize: '0.8rem', color: '#34d399', fontWeight: 700 }}>
                  Retorno Garantizado: ${minPayout.toFixed(2)} (Ganancia Neta: +${netProfit.toFixed(2)})
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
