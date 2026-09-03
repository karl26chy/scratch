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
  const [liveOpps, setLiveOpps] = useState<any>(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const handleLaunchScrape = async (request: ScrapeRequest) => {
    setIsLoading(true);
    setErrorMsg(null);
    setLiveOpps(null);
    try {
      const results = await ScraperApi.executeScrape(request);
      setActiveResults(results);
      onScrapeCompleted(results);
      // Fetch live surebets acumuladas tras scrape exitoso (solo bajo demanda, no polling)
      if (results && results.length > 0 && results.some((r) => r.status === 'SUCCESS')) {
        setLiveLoading(true);
        try {
          const res = await fetch('http://localhost:4000/api/surebets/live-opportunities');
          const json = await res.json();
          setLiveOpps(json.data);
        } catch (e) {
          console.warn('No se pudo cargar live-opportunities', e);
        } finally {
          setLiveLoading(false);
        }
      }
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

      {/* Live Surebets acumuladas (in-memory) tras scrape */}
      {liveLoading && <div style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando oportunidades acumuladas...</div>}
      {liveOpps && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 'var(--radius-md)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>📊 Surebets Acumuladas (liveOddsStore)</h3>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Oportunidades: {liveOpps.opportunities?.length ?? liveOpps.totalCount ?? 0} | Timestamp: {liveOpps.timestamp}
          </div>
          <pre style={{ fontSize: '0.75rem', background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '4px', overflowX: 'auto', maxHeight: '300px' }}>
            {JSON.stringify(liveOpps, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
