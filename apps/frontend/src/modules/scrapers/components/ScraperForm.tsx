import React, { useState } from 'react';
import { Play, Shield, Globe, Camera, Network, Loader2, Plus, Trash2, Zap, Layers } from 'lucide-react';
import { Card } from '../../../shared/components/Card.js';
import { ScrapeRequest } from '../../../shared/types/common.types.js';

interface ScraperFormProps {
  onSubmit: (request: ScrapeRequest) => Promise<void>;
  isLoading: boolean;
}

const PRESET_BOOKMAKERS = [
  'https://pinnacle.com/es/sports/football',
  'https://pinnacle.com/es/sports/tennis',
  'https://bet365.com/#/IP/B1',
  'https://betfair.es/exchange/plus/football',
  'https://1xbet.com/es/line/basketball',
  'https://1xbet.com/es/line/table-tennis',
  'https://sports.williamhill.es/betting/es-es/futbol',
];

const SPORT_PRESETS = [
  { label: '⚽ Fútbol', url: 'https://pinnacle.com/es/sports/football' },
  { label: '🎾 Tenis', url: 'https://pinnacle.com/es/sports/tennis' },
  { label: '🏀 Baloncesto', url: 'https://1xbet.com/es/line/basketball' },
  { label: '🏓 Tenis de Mesa', url: 'https://1xbet.com/es/line/table-tennis' },
];

export const ScraperForm: React.FC<ScraperFormProps> = ({ onSubmit, isLoading }) => {
  const [urls, setUrls] = useState<string[]>([
    'https://pinnacle.com/es/sports/football',
    'https://pinnacle.com/es/sports/tennis',
    'https://1xbet.com/es/line/table-tennis',
    'https://1xbet.com/es/line/basketball',
  ]);
  const [newUrlInput, setNewUrlInput] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [captureScreenshot, setCaptureScreenshot] = useState(true);

  const handleAddUrl = (customUrl?: string) => {
    const target = customUrl || newUrlInput;
    const trimmed = target.trim();
    if (trimmed && !urls.includes(trimmed)) {
      setUrls([...urls, trimmed]);
      if (!customUrl) setNewUrlInput('');
    }
  };

  const handleRemoveUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleLoad7Bookmakers = () => {
    setUrls(PRESET_BOOKMAKERS);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (urls.length === 0) return;

    await onSubmit({
      urls,
      useProxy,
      captureScreenshot,
    });
  };

  return (
    <Card
      title="Consola de Scraping Concurrente (4 Deportes Principales)"
      subtitle="Extracción masiva multi-hilo enfocada en Fútbol, Tenis, Baloncesto y Tenis de Mesa con bypass anti-bot"
      icon={<Shield size={18} />}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Top Info Banner with Sport Quick Add Buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            background: 'linear-gradient(90deg, rgba(99, 102, 241, 0.08) 0%, rgba(6, 182, 212, 0.05) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#38bdf8' }}>
            <Zap size={15} />
            <span>
              <strong>Optimización a 4 Deportes:</strong> Extracción prioritaria en Fútbol, Tenis, Baloncesto y Tenis de Mesa para ahorro de ancho de banda y latencia.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {SPORT_PRESETS.map((preset, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleAddUrl(preset.url)}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-secondary)',
                  padding: '0.25rem 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                + {preset.label}
              </button>
            ))}

            <button
              type="button"
              onClick={handleLoad7Bookmakers}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                background: 'rgba(56, 189, 248, 0.12)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                color: '#38bdf8',
                padding: '0.3rem 0.7rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Layers size={13} />
              Cargar 7 Casas de Apuestas
            </button>
          </div>
        </div>

        {/* URLs Management List */}
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              marginBottom: '0.4rem',
            }}
          >
            URLs Objetivo a Procesar en Paralelo ({urls.length} seleccionadas)
          </label>

          {/* Add URL Row */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Globe
                size={16}
                style={{
                  position: 'absolute',
                  left: '1rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                type="url"
                value={newUrlInput}
                onChange={(e) => setNewUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrl();
                  }
                }}
                placeholder="https://casa-de-apuestas.com/sports/table-tennis"
                style={{
                  width: '100%',
                  padding: '0.65rem 1rem 0.65rem 2.5rem',
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
            <button
              type="button"
              onClick={() => handleAddUrl()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.65rem 1rem',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <Plus size={15} />
              Agregar URL
            </button>
          </div>

          {/* List of active URLs */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
              maxHeight: '220px',
              overflowY: 'auto',
              padding: '0.5rem',
              backgroundColor: '#090d16',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {urls.map((targetUrl, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.45rem 0.75rem',
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(255, 255, 255, 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontFamily: 'var(--font-mono)',
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: 'var(--accent-primary)',
                      padding: '0.1rem 0.4rem',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    Hilo #{idx + 1}
                  </span>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {targetUrl}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveUrl(idx)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-danger)',
                    cursor: 'pointer',
                    padding: '0.2rem',
                  }}
                  title="Eliminar URL"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Focused Toggles (Default True) */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2rem',
            padding: '0.85rem 1rem',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useProxy}
              onChange={(e) => setUseProxy(e.target.checked)}
            />
            <Network size={15} color="var(--accent-secondary)" />
            <span>Enrutar por Proxies Residenciales Rotativos (Recomendado)</span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={captureScreenshot}
              onChange={(e) => setCaptureScreenshot(e.target.checked)}
            />
            <Camera size={15} color="var(--accent-primary)" />
            <span>Capturar Screenshot de Verificación</span>
          </label>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading || urls.length === 0}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.9rem 1.5rem',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: isLoading || urls.length === 0 ? 'not-allowed' : 'pointer',
            opacity: isLoading || urls.length === 0 ? 0.7 : 1,
            boxShadow: 'var(--shadow-glow)',
            transition: 'all 0.2s ease',
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
              Extrayendo Cuotas de {urls.length} Casas de Apuestas (Multi-Hilo)...
            </>
          ) : (
            <>
              <Play size={18} />
              Lanzar Scraping Concurrente ({urls.length} Casas de Apuestas en Paralelo)
            </>
          )}
        </button>
      </form>
    </Card>
  );
};
