import React from 'react';
import { ShieldCheck, Cpu, Terminal, Radio } from 'lucide-react';
import { Badge } from './Badge.js';
import { SystemHealth } from '../types/common.types.js';

interface HeaderProps {
  health: SystemHealth | null;
}

export const Header: React.FC<HeaderProps> = ({ health }) => {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 2rem',
        borderBottom: '1px solid var(--border-color)',
        background: 'rgba(9, 13, 22, 0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
            padding: '0.5rem',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-glow)',
          }}
        >
          <ShieldCheck size={20} color="#fff" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            STEALTH<span style={{ color: 'var(--accent-secondary)' }}>SCRAPER</span>
          </h1>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Motor Empresarial de Evasión Anti-Bot & Arbitraje
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <Cpu size={16} color="var(--accent-secondary)" />
          <span>Pool de Navegadores: <strong>{health?.browserPool.activeInstances ?? 0}</strong>/{health?.browserPool.maxCapacity ?? 5}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <Terminal size={16} color="var(--accent-primary)" />
          <span>Puerto API: <strong>4000</strong></span>
        </div>

        <Badge variant={health?.status === 'healthy' ? 'success' : 'warning'} icon={<Radio size={12} />}>
          {health?.status === 'healthy' ? 'SISTEMA OPERATIVO' : 'INICIALIZANDO'}
        </Badge>
      </div>
    </header>
  );
};
