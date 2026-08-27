import React from 'react';
import { LayoutDashboard, PlaySquare, TrendingUp, ShieldAlert, Network, Layers } from 'lucide-react';

export type NavTab = 'dashboard' | 'scrapers' | 'selector-config' | 'surebets';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab }) => {
  const items = [
    { id: 'dashboard' as NavTab, label: 'Telemetría de Evasión', icon: <LayoutDashboard size={18} /> },
    { id: 'scrapers' as NavTab, label: 'Consola de Scraping', icon: <PlaySquare size={18} /> },
    { id: 'selector-config' as NavTab, label: 'Selectores Custom', icon: <Layers size={18} /> },
    { id: 'surebets' as NavTab, label: 'Arbitraje & Surebets', icon: <TrendingUp size={18} /> },
  ];

  return (
    <aside
      style={{
        width: '260px',
        backgroundColor: 'rgba(12, 16, 26, 0.95)',
        borderRight: '1px solid var(--border-color)',
        padding: '1.5rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <div style={{ marginBottom: '1.5rem', paddingLeft: '0.75rem' }}>
          <span
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              fontWeight: 700,
              letterSpacing: '0.08em',
            }}
          >
            Módulos del Sistema
          </span>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {items.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  border: isActive ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid transparent',
                  background: isActive
                    ? 'linear-gradient(90deg, rgba(99, 102, 241, 0.15) 0%, rgba(6, 182, 212, 0.05) 100%)'
                    : 'transparent',
                  color: isActive ? '#fff' : 'var(--text-secondary)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ color: isActive ? 'var(--accent-secondary)' : 'inherit' }}>
                  {item.icon}
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Stealth Engine Status Card */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <ShieldAlert size={16} color="var(--accent-success)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Motor de Evasión
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Layers size={12} /> Playwright Stealth v4.3
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Network size={12} /> Pool Residencial Activo
          </div>
        </div>
      </div>
    </aside>
  );
};
