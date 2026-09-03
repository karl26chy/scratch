import React, { useEffect, useState } from 'react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { AdaptersApi, RegisteredAdapter } from '../services/adaptersApi.js';

export const AdaptersPage: React.FC = () => {
  const [adapters, setAdapters] = useState<RegisteredAdapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    AdaptersApi.list()
      .then((list) => {
        if (!cancelled) setAdapters(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Error al cargar adapters');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>🔌 Adapters de Captura por Red</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
          Sitios con extracción vía intercepción de red registrados en el backend. (Solo lectura por ahora.)
        </p>
      </div>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Cargando adapters…</p>}
      {error && (
        <div style={{ padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
      )}

      {!loading && !error && adapters.length === 0 && (
        <Card title="Sin adapters registrados">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No hay adapters de red activos. El scraper usa selectores CSS por fallback. Usa el modo debug
            (<code>npm run debug:capture</code>) para inspeccionar un sitio y luego registra su adapter en
            <code> infrastructure/network/adapters/</code>.
          </p>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {adapters.map((a) => (
          <Card key={a.domain} title={a.domain}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Patrones de URL</span>
              <Badge variant="purple">{a.patternCount}</Badge>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              <Badge variant="success">✅ Captura por red activa</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
