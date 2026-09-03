import React, { useState } from 'react';

interface JsonNodeProps {
  data: unknown;
  keyName?: string;
  depth: number;
}

const JsonNode: React.FC<JsonNodeProps> = ({ data, keyName, depth }) => {
  const [open, setOpen] = useState(depth < 2);

  const isArray = Array.isArray(data);
  const isObject = typeof data === 'object' && data !== null;

  if (!isObject) {
    const valueColor =
      typeof data === 'string'
        ? '#86efac'
        : typeof data === 'number'
          ? '#fca5a5'
          : typeof data === 'boolean'
            ? '#c4b5fd'
            : '#94a3b8';
    return (
      <div style={{ paddingLeft: `${depth * 14}px`, fontSize: '0.8rem', lineHeight: 1.5 }}>
        {keyName && <span style={{ color: '#7dd3fc' }}>{keyName}: </span>}
        <span style={{ color: valueColor }}>{JSON.stringify(data)}</span>
      </div>
    );
  }

  const entries: [string | number, unknown][] = isArray
    ? (data as unknown[]).map((v, i) => [i, v])
    : Object.entries(data as Record<string, unknown>);
  const summary = isArray ? `Array(${entries.length})` : `{${entries.length}}`;

  return (
    <div>
      <div
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: `${depth * 14}px`, cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1.5 }}
      >
        <span style={{ color: '#94a3b8' }}>{open ? '▼' : '▶'}</span>{' '}
        {keyName && <span style={{ color: '#7dd3fc' }}>{keyName}: </span>}
        {!open && <span style={{ color: '#64748b' }}>{summary}</span>}
      </div>
      {open &&
        entries.map(([k, v], i) => (
          <JsonNode key={i} keyName={isArray ? `[${k}]` : String(k)} data={v} depth={depth + 1} />
        ))}
    </div>
  );
};

export const JsonTree: React.FC<{ data: unknown }> = ({ data }) => {
  return (
    <div
      style={{
        background: '#090d16',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        padding: '0.75rem',
        maxHeight: '480px',
        overflow: 'auto',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <JsonNode data={data} depth={0} />
    </div>
  );
};
