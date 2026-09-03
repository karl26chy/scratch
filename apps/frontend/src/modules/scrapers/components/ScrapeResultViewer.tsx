import React, { useState } from 'react';
import { CheckCircle, AlertTriangle, Fingerprint, Image, Trophy, Network, Code } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';
import { Badge } from '../../../shared/components/Badge.js';
import { ScrapeResult } from '../../../shared/types/common.types.js';
import { formatBytes, formatDuration, truncateString } from '../../../shared/utils/formatters.js';

interface ScrapeResultViewerProps {
  results: ScrapeResult[] | null;
}

export const ScrapeResultViewer: React.FC<ScrapeResultViewerProps> = ({ results }) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  if (!results || results.length === 0) return null;

  const activeResult = results[selectedIndex] || results[0];
  const isSuccess = activeResult.status === 'SUCCESS';
  const isDomAlert = activeResult.status === 'DOM_STRUCTURE_CHANGED';
  const source = activeResult.source;

  const sportsOdds = (activeResult.extractedData?.sportsOdds || activeResult.extractedData?.bookmakerOdds) as any[] | undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '2rem' }}>
      {/* Batch Overview Tabs if multiple URLs were scraped */}
      {results.length > 1 && (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem',
          }}
        >
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.6rem', textTransform: 'uppercase' }}>
            Resultados del Lote Concurrente ({results.length} Casas de Apuestas Procesadas)
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.3rem' }}>
            {results.map((res, idx) => {
              const resSuccess = res.status === 'SUCCESS';
              const isSelected = selectedIndex === idx;
              return (
                 <button
                   key={res.id || idx}
                   onClick={() => setSelectedIndex(idx)}
                   style={{
                     display: 'flex',
                     alignItems: 'center',
                     gap: '0.4rem',
                     padding: '0.5rem 0.85rem',
                     borderRadius: 'var(--radius-md)',
                     border: isSelected ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.06)',
                     background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255,255,255,0.02)',
                     color: isSelected ? '#fff' : 'var(--text-secondary)',
                     fontWeight: 600,
                     fontSize: '0.8rem',
                     cursor: 'pointer',
                     whiteSpace: 'nowrap',
                   }}
                 >
                   <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: resSuccess ? 'var(--accent-success)' : 'var(--accent-danger)' }} />
                   Hilo #{idx + 1}: {truncateString(res.pageTitle || res.url, 22)}
                   <span
                     style={{
                       fontSize: '0.65rem',
                       fontWeight: 700,
                       padding: '0.05rem 0.4rem',
                       borderRadius: '9999px',
                       color: res.source === 'network' ? '#818cf8' : '#22d3ee',
                       border: `1px solid ${res.source === 'network' ? 'rgba(99,102,241,0.4)' : 'rgba(6,182,212,0.4)'}`,
                     }}
                   >
                     {res.source === 'network' ? 'RED' : res.source === 'dom' ? 'DOM' : 'N/A'}
                   </span>
                 </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected Result Report Card */}
      <Card
        title={`Reporte de Extracción: ${activeResult.pageTitle || 'Casa de Apuestas'}`}
        subtitle={`URL: ${activeResult.url} • Sesión: ${activeResult.id}`}
        action={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge
              variant={source === 'network' ? 'purple' : 'info'}
              icon={source === 'network' ? <Network size={14} /> : <Code size={14} />}
            >
              {source === 'network' ? 'RED' : source === 'dom' ? 'DOM' : 'N/A'}
            </Badge>
            <Badge
              variant={isSuccess ? 'success' : isDomAlert ? 'warning' : 'danger'}
              icon={isSuccess ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
            >
              {isSuccess ? 'ÉXITO (100% BYPASS)' : isDomAlert ? 'ALERTA DOM' : 'BLOQUEADO'} (HTTP {activeResult.statusCode || 200})
            </Badge>
          </span>
        }
      >
        {/* KPI Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem',
            padding: '1rem',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Título de la Página</span>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '0.2rem', color: 'var(--text-primary)' }}>
              {activeResult.pageTitle || 'N/A'}
            </p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tamaño HTML</span>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '0.2rem', color: 'var(--text-primary)' }}>
              {formatBytes(activeResult.htmlLength)}
            </p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Duración de Misión</span>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, marginTop: '0.2rem', color: 'var(--text-primary)' }}>
              {formatDuration(activeResult.stealthMetrics.durationMs)}
            </p>
          </div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cuotas Capturadas</span>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginTop: '0.2rem', color: '#38bdf8' }}>
              {activeResult.extractedData?.oddsCount || sportsOdds?.length || 0} cuotas decimales
            </p>
          </div>
        </div>

        {/* DOM Structure Change Alert if present */}
        {activeResult.domAlert?.hasChanged && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: '#fbbf24',
              fontSize: '0.85rem',
            }}
          >
            <strong>Alerta de Anomalía en el DOM:</strong> {activeResult.domAlert.message}
          </div>
        )}

        {/* Extracted Sports Odds Table */}
        {sportsOdds && sportsOdds.length > 0 && (
          <div style={{ marginTop: '1.25rem' }}>
            <h4
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: 'var(--accent-primary)',
                marginBottom: '0.5rem',
              }}
            >
              <Trophy size={16} /> Cuotas Deportivas Extraídas Automáticamente (Resilient Selectors)
            </h4>
            <div style={{ overflowX: 'auto', background: '#090d16', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Mercado / Evento</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Selección</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Cuota Decimal</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Casa</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Estrategia</th>
                  </tr>
                </thead>
                <tbody>
                  {sportsOdds.map((odd, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {odd.marketName || 'Ganador 1X2'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--accent-secondary)', fontWeight: 600 }}>
                        {odd.selection}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#34d399' }}>
                        {odd.formattedOdd || odd.oddValue}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#38bdf8' }}>
                        {odd.bookmaker || 'Desconocida'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {odd.strategyUsed || 'stable_attribute'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Applied Evasion Fingerprint Card */}
        <div style={{ marginTop: '1.25rem' }}>
          <h4
            style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: 'var(--accent-secondary)',
              marginBottom: '0.5rem',
            }}
          >
            <Fingerprint size={16} /> Huella Digital (Fingerprint) & Proxy Residencial
          </h4>
          <pre
            style={{
              background: '#090d16',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontFamily: 'var(--font-mono)',
              overflowX: 'auto',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {JSON.stringify(
              {
                nivelStealth: activeResult.stealthMetrics.stealthLevelApplied,
                nodoProxy: activeResult.stealthMetrics.proxyUsed || 'Directo / Socket Limpio',
                huellaNavegador: activeResult.stealthMetrics.fingerprintUsed,
              },
              null,
              2
            )}
          </pre>
        </div>

        {/* Screenshot preview */}
        {activeResult.screenshotBase64 && (
          <div style={{ marginTop: '1.25rem' }}>
            <h4
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                color: 'var(--text-primary)',
                marginBottom: '0.5rem',
              }}
            >
              <Image size={16} /> Captura de Verificación del Viewport Headless
            </h4>
            <div
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                maxHeight: '400px',
              }}
            >
              <img
                src={activeResult.screenshotBase64}
                alt="Captura del Viewport Headless"
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
