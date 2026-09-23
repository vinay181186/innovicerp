import React from 'react';
export function SortHeader({ label, active = false, dir = 'asc', onSort }) {
  return <span role="button" tabIndex={0} onClick={onSort} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort && onSort(); } }} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
    {label}<span aria-hidden="true" style={{ fontSize: 'var(--fs-xs)', opacity: active ? 1 : 0.3, color: active ? 'var(--cyan)' : 'inherit' }}>{active ? (dir === 'desc' ? '▼' : '▲') : '↕'}</span>
  </span>;
}
