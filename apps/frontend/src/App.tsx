import React, { useState } from 'react';
import { Header } from './shared/components/Header.js';
import { Sidebar, NavTab } from './shared/components/Sidebar.js';
import { DashboardPage } from './modules/dashboard/pages/DashboardPage.js';
import { ScraperRunnerPage } from './modules/scrapers/pages/ScraperRunnerPage.js';
import { SelectorConfigPage } from './modules/scrapers/pages/SelectorConfigPage.js';
import { AdaptersPage } from './modules/adapters/pages/AdaptersPage.js';
import { SurebetDashboardPage } from './modules/surebets/pages/SurebetDashboardPage.js';
import SurebetPage from './modules/surebets/pages/SurebetPage.js';
import { useDashboardMetrics } from './modules/dashboard/hooks/useDashboardMetrics.js';
import { ScrapeResult } from './shared/types/common.types.js';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [history, setHistory] = useState<ScrapeResult[]>([]);
  const [activeResults, setActiveResults] = useState<ScrapeResult[] | null>(null);

  const { health, metrics } = useDashboardMetrics(history);

  const handleScrapeCompleted = (results: ScrapeResult[]) => {
    setHistory((prev) => [...results, ...prev]);
  };

  const handleInspectFromTable = (result: ScrapeResult) => {
    setActiveResults([result]);
    setCurrentTab('scrapers');
  };

  return (
    <div className="app-container">
      <Sidebar currentTab={currentTab} onSelectTab={setCurrentTab} />

      <div className="main-content">
        <Header health={health} />

        <main className="page-wrapper">
          {currentTab === 'dashboard' && (
            <DashboardPage
              health={health}
              history={history}
              metrics={metrics}
              onSelectResult={handleInspectFromTable}
            />
          )}

          {currentTab === 'scrapers' && (
            <ScraperRunnerPage
              onScrapeCompleted={handleScrapeCompleted}
              activeResults={activeResults}
              setActiveResults={setActiveResults}
            />
          )}

          {currentTab === 'selector-config' && <SelectorConfigPage />}

          {currentTab === 'adapters' && <AdaptersPage />}

          {currentTab === 'surebets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <SurebetPage />
              <SurebetDashboardPage />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
