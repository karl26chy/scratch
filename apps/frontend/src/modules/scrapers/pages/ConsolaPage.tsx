import React, { useState } from 'react';

const API_BASE = 'http://localhost:4000/api';

// Consola de Scraping Concurrente - Tarea 1: Forzar selectores vacíos para Stake
export const ConsolaPage: React.FC = () => {
  const [url, setUrl] = useState('https://stake.com.co/deportes/football');
  const [bookmaker, setBookmaker] = useState('Stake');
  const [useProxy, setUseProxy] = useState(true);
  const [result, setResult] = useState<any>(null);

  const handleScrape = async () => {
    // Tarea 1: Forzar selectores vacíos para usar interceptor (Stake)
    const payload = {
      urls: [
        {
          url: url,
          bookmaker: bookmaker || 'Stake',
          useProxy: true,
          captureScreenshot: true,
          selectors: {
            events: '',
            homeTeam: '',
            awayTeam: '',
            oddsHome: '',
            oddsDraw: '',
            oddsAway: '',
          },
        },
      ],
    };

    const response = await fetch(`${API_BASE}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setResult(data);
  };

  return (
    <div>
      <h2>Consola de Scraping Concurrente</h2>
      <button onClick={handleScrape}>Ejecutar</button>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
};

export default ConsolaPage;
