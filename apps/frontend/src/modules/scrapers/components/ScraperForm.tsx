import React, { useState } from 'react';
import { Play, Shield, Globe, Camera, Network, Loader2, Plus, Trash2, Zap, Layers, RotateCcw } from 'lucide-react';
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

export const ScraperForm: React.FC<ScraperFormProps> = ({ onSubmit, isLoading }) => {
  // Initial state empty or clean so user custom input is respected 100%
  const [urls, setUrls] = useState<string[]>([
    'https://pinnacle.com/es/sports/football',
    'https://betplay.com.co',
  ]);
  const [urlInput, setUrlInput] = useState('');
  const [useProxy, setUseProxy] = useState(true);
  const [captureScreenshot, setCaptureScreenshot] = useState(true);

  /**
   * Parses single or multiple URLs separated by newlines, commas, or spaces
   */
  const handleAddUrls = (customInput?: string) => {
    const rawText = customInput !== undefined ? customInput : urlInput;
    if (!rawText.trim()) return;

    // Split by newlines, spaces, or commas
    const extracted = rawText
      .split(/[\n,\s]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    // Normalize http/https prefix if missing
    const formatted = extracted.map((u) => (u.startsWith('http') ? u : `https://${u}`));

    const updated = Array.from(new Set([...urls, ...formatted]));
    setUrls(updated);
    setUrlInput('');
  };

  const handleRemoveUrl = (index: number) => {
    setUrls(urls.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    setUrls([]);
    setUrlInput('');
  };

  const handleLoadPresets = () => {
    setUrls(PRESET_BOOKMAKERS);
    setUrlInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // CRITICAL FIX: If user typed in the input without explicitly clicking "Agregar", include it automatically!
    let targetsToSubmit = [...urls];
    if (urlInput.trim()) {
      const extracted = urlInput
        .split(/[\n,\s]+/)
        .map((u) => u.trim())
        .filter((u) => u.length > 0)
        .map((u) => (u.startsWith('http') ? u : `https://${u}`));

      targetsToSubmit = Array.from(new Set([...targetsToSubmit, ...extracted]));
      setUrls(targetsToSubmit);
      setUrlInput('');
    }

    if (targetsToSubmit.length === 0) return;

    await onSubmit({
      urls: targetsToSubmit,
      useProxy,
      captureScreenshot,
    });
  };

  return (
    <Card
      title="Consola de Scraping Concurrente de Casas de Apuestas"
      subtitle="Extracción masiva multi-hilo con bypass de Cloudflare/Datadome y rotación de proxies residenciales"
      icon={<Shield size={18} />}
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Banner Informativo y Herramientas Rápidas */}
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
              <strong>Evasión Stealth Automática:</strong> Los hilos aplicarán enmascaramiento WebGL/Canvas y proxies rotativos a las URLs exactas que ingreses.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={handleClearAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                color: '#f87171',
                padding: '0.3rem 0.65rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Limpiar todas las URLs ingresadas"
            >
              <RotateCcw size={12} />
              Limpiar Lista
            </button>

            <button
              type="button"
              onClick={handleLoadPresets}
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
              Cargar Plantilla (7 Casas)
            </button>
          </div>
        </div>

        {/* Input de URLs Personalizadas */}
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
            Ingresar URLs Personalizadas (Escribe o pega una o múltiples URLs, ej. BetPlay, Wplay, Rushbet...)
          </label>

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
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrls();
                  }
                }}
                placeholder="Pega aquí una URL o varias separadas por comas/espacios (ej. betplay.com.co, wplay.co)"
                style={{
                  width: '100%',
                  padding: '0.7rem 1rem 0.7rem 2.5rem',
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
              onClick={() => handleAddUrls()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.7rem 1.25rem',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: 'var(--radius-md)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <Plus size={15} />
              Agregar a la Cola
            </button>
          </div>

          {/* Lista Activa de URLs a Procesar */}
          {urls.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                maxHeight: '230px',
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
                    padding: '0.5rem 0.75rem',
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden' }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontFamily: 'var(--font-mono)',
                        background: 'rgba(99, 102, 241, 0.15)',
                        color: 'var(--accent-primary)',
                        padding: '0.15rem 0.45rem',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 700,
                      }}
                    >
                      Hilo #{idx + 1}
                    </span>
                    <span
                      style={{
                        fontSize: '0.85rem',
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
                      padding: '0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    title="Eliminar esta URL"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '1.25rem',
                textAlign: 'center',
                background: 'rgba(255, 255, 255, 0.01)',
                border: '1px dashed var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-muted)',
                fontSize: '0.85rem',
              }}
            >
              No hay URLs en la cola. Ingresa tus URLs personalizadas en el campo superior o carga la plantilla.
            </div>
          )}
        </div>

        {/* Toggles (Default True) */}
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
            <span>Enrutar por Proxies Residenciales Rotativos</span>
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

        {/* Botón Principal de Envío */}
        <button
          type="submit"
          disabled={isLoading || (urls.length === 0 && !urlInput.trim())}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.95rem 1.5rem',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            fontWeight: 700,
            fontSize: '0.95rem',
            cursor: isLoading || (urls.length === 0 && !urlInput.trim()) ? 'not-allowed' : 'pointer',
            opacity: isLoading || (urls.length === 0 && !urlInput.trim()) ? 0.7 : 1,
            boxShadow: 'var(--shadow-glow)',
            transition: 'all 0.2s ease',
          }}
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
              Extrayendo de {urls.length || 1} Casas de Apuestas en Paralelo...
            </>
          ) : (
            <>
              <Play size={18} />
              Lanzar Scraping Concurrente ({urls.length + (urlInput.trim() && !urls.includes(urlInput.trim()) ? 1 : 0)} Casas en Paralelo)
            </>
          )}
        </button>
      </form>
    </Card>
  );
};
