import React from 'react';
import { MetricsGrid } from '../components/MetricsGrid.js';
import { ActiveScrapesTable } from '../components/ActiveScrapesTable.js';
import { ScrapeAllPanel } from '../components/ScrapeAllPanel.js';
import { SystemHealth, ScrapeResult } from '../../../shared/types/common.types.js';

interface DashboardPageProps {
  health: SystemHealth | null;
  history: ScrapeResult[];
  metrics: {
    totalScrapes: number;
    successfulScrapes: number;
    blockedScrapes: number;
    bypassRate: string;
    avgDuration: string;
  };
  onSelectResult: (result: ScrapeResult) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ health, history, metrics, onSelectResult }) => {
  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
          Telemetría de Evasión & Estado del Sistema
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Métricas en tiempo real de bypass anti-detección headless, asignación de navegadores y proxies residenciales.
        </p>
      </div>

      <ScrapeAllPanel />

      <MetricsGrid
        metrics={metrics}
        activeBrowsers={health?.browserPool.activeInstances ?? 0}
        maxCapacity={health?.browserPool.maxCapacity ?? 5}
      />

      <ActiveScrapesTable history={history} onSelectResult={onSelectResult} />
    </div>
  );
};
