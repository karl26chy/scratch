import React from 'react';
import { Globe, Clock, CheckCircle2, XCircle, Shield } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { ScrapeResult } from '../../../shared/types/common.types.js';
import { formatBytes, formatDuration, truncateString } from '../../../shared/utils/formatters.js';

interface ActiveScrapesTableProps {
  history: ScrapeResult[];
  onSelectResult: (result: ScrapeResult) => void;
}

export const ActiveScrapesTable: React.FC<ActiveScrapesTableProps> = ({ history, onSelectResult }) => {
  return (
    <Card
      title="Operaciones de Scraping Recientes"
      subtitle="Registro de auditoría de desafíos anti-bot interceptados, nodos proxy y payloads extraídos"
      icon={<Globe size={18} />}
    >
      {history.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          <Shield size={36} style={{ margin: '0 auto 0.75rem auto', opacity: 0.4 }} />
          <p style={{ fontSize: '0.9rem' }}>No hay operaciones de scraping registradas aún.</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Dirígete al módulo de <strong>Consola de Scraping</strong> para lanzar tu primera tarea de evasión.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  color: 'var(--text-muted)',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                <th style={{ padding: '0.75rem 0.5rem' }}>Estado</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>URL Objetivo</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Perfil Stealth</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Tamaño Payload</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Latencia</th>
                <th style={{ padding: '0.75rem 0.5rem' }}>Hora</th>
                <th style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => {
                const isSuccess = item.status === 'SUCCESS';
                const isDomAlert = item.status === 'DOM_STRUCTURE_CHANGED';

                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <Badge
                        variant={isSuccess ? 'success' : isDomAlert ? 'warning' : 'danger'}
                        icon={isSuccess ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      >
                        {isSuccess ? 'ÉXITO' : isDomAlert ? 'CAMBIO DOM' : 'BLOQUEADO'}
                      </Badge>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-secondary)' }}>
                      {truncateString(item.url, 38)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem' }}>
                      <Badge variant="purple">
                        {item.stealthMetrics.stealthLevelApplied.toUpperCase()}
                      </Badge>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>
                      {formatBytes(item.htmlLength)}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-secondary)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Clock size={12} />
                        {formatDuration(item.stealthMetrics.durationMs)}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', color: 'var(--text-muted)' }}>
                      {new Date(item.createdAt).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '0.75rem 0.5rem', textAlign: 'right' }}>
                      <button
                        onClick={() => onSelectResult(item)}
                        style={{
                          background: 'rgba(99, 102, 241, 0.1)',
                          border: '1px solid rgba(99, 102, 241, 0.25)',
                          color: 'var(--accent-primary)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.3rem 0.6rem',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        Inspeccionar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
