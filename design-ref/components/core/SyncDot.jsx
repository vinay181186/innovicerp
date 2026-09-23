import React from 'react';
export function SyncDot({ state = 'ok', label }) {
  const cls = 'sync-dot' + (state === 'offline' ? ' offline' : state === 'error' ? ' error' : '');
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', color: 'var(--text3)', fontFamily: 'var(--mono)' }}><span className={cls} />{label}</span>;
}
