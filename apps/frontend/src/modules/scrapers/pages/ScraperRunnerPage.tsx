import React, { useState } from 'react';
import { ScraperForm } from '../components/ScraperForm.js';
import { ScrapeResultViewer } from '../components/ScrapeResultViewer.js';
import { ScraperApi } from '../services/scraperApi.js';
import { ScrapeRequest, ScrapeResult } from '../../../shared/types/common.types.js';

interface ScraperRunnerPageProps {
  onScrapeCompleted: (results: ScrapeResult[]) => void;
  activeResults: ScrapeResult[] | null;
  setActiveResults: (res: ScrapeResult[] | null) => void;
}

export const ScraperRunnerPage: React.FC<ScraperRunnerPageProps> = ({
  onScrapeCompleted,
  activeResults,
  setActiveResults,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLaunchScrape = async (request: ScrapeRequest) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const results = await ScraperApi.executeScrape(request);
      setActiveResults(results);
      onScrapeCompleted(results);
    } catch (err: any) {
      setErrorMsg(err.message || 'Ocurrió un error inesperado durante la ejecución');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
          Consola de Scraping Concurrente de Casas de Apuestas
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Extracción simultánea multi-hilo contra casas de apuestas deportivas con bypass de Cloudflare/Datadome y proxies residenciales rotativos.
        </p>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '1rem',
            marginBottom: '1.5rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            color: '#f87171',
            fontSize: '0.85rem',
          }}
        >
          <strong>Error de Ejecución:</strong> {errorMsg}
        </div>
      )}

      <ScraperForm onSubmit={handleLaunchScrape} isLoading={isLoading} />

      <ScrapeResultViewer results={activeResults} />
    </div>
  );
};
