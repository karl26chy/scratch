import React from 'react';
import { ShieldCheck, Zap, Server, ShieldAlert } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';

interface MetricsGridProps {
  metrics: {
    totalScrapes: number;
    successfulScrapes: number;
    blockedScrapes: number;
    bypassRate: string;
    avgDuration: string;
  };
  activeBrowsers: number;
  maxCapacity: number;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({ metrics, activeBrowsers, maxCapacity }) => {
  const cards = [
    {
      title: 'Tasa de Éxito de Evasión',
      value: `${metrics.bypassRate}%`,
      subtitle: `${metrics.successfulScrapes} evadidos con éxito / ${metrics.blockedScrapes} bloqueados`,
      icon: <ShieldCheck size={22} color="var(--accent-success)" />,
      borderColor: 'rgba(16, 185, 129, 0.3)',
    },
    {
      title: 'Pool de Navegadores Activo',
      value: `${activeBrowsers} / ${maxCapacity}`,
      subtitle: 'Instancias y workers aislados de Playwright',
      icon: <Server size={22} color="var(--accent-secondary)" />,
      borderColor: 'rgba(6, 182, 212, 0.3)',
    },
    {
      title: 'Latencia Promedio de Evasión',
      value: `${metrics.avgDuration} ms`,
      subtitle: 'Incluye simulación de comportamiento humano',
      icon: <Zap size={22} color="var(--accent-primary)" />,
      borderColor: 'rgba(99, 102, 241, 0.3)',
    },
    {
      title: 'Extracciones Totales',
      value: `${metrics.totalScrapes}`,
      subtitle: 'Misiones de scraping ejecutadas',
      icon: <ShieldAlert size={22} color="var(--accent-warning)" />,
      borderColor: 'rgba(245, 158, 11, 0.3)',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '1.25rem',
        marginBottom: '2rem',
      }}
    >
      {cards.map((c, idx) => (
        <Card key={idx} style={{ borderLeft: `3px solid ${c.borderColor}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                {c.title}
              </p>
              <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0.35rem 0', color: 'var(--text-primary)' }}>
                {c.value}
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.subtitle}</p>
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '0.6rem',
                borderRadius: 'var(--radius-md)',
              }}
            >
              {c.icon}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};
