import React from 'react';

export interface BadgeProps {
  variant?: 'success' | 'danger' | 'warning' | 'info' | 'purple';
  children: React.ReactNode;
  icon?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'info', children, icon }) => {
  const styles: Record<string, { bg: string; text: string; border: string }> = {
    success: {
      bg: 'rgba(16, 185, 129, 0.12)',
      text: '#34d399',
      border: 'rgba(16, 185, 129, 0.25)',
    },
    danger: {
      bg: 'rgba(239, 68, 68, 0.12)',
      text: '#f87171',
      border: 'rgba(239, 68, 68, 0.25)',
    },
    warning: {
      bg: 'rgba(245, 158, 11, 0.12)',
      text: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.25)',
    },
    info: {
      bg: 'rgba(6, 182, 212, 0.12)',
      text: '#22d3ee',
      border: 'rgba(6, 182, 212, 0.25)',
    },
    purple: {
      bg: 'rgba(99, 102, 241, 0.12)',
      text: '#818cf8',
      border: 'rgba(99, 102, 241, 0.25)',
    },
  };

  const current = styles[variant];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.2rem 0.6rem',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: current.bg,
        color: current.text,
        border: `1px solid ${current.border}`,
        letterSpacing: '0.025em',
      }}
    >
      {icon}
      {children}
    </span>
  );
};
