import React from 'react';
const DEF = { loading: '⟳ Loading…', error: 'Failed to load', empty: 'No records', noaccess: '⛔ This page is hidden for your access. Ask an admin if you need access to it.' };
export function PageState({ state = 'empty', message, as = 'panel', colSpan = 1 }) {
  const color = state === 'error' ? 'var(--red)' : state === 'noaccess' ? 'var(--amber)' : undefined;
  const text = message || DEF[state];
  if (as === 'row') return <tr><td colSpan={colSpan} className="empty-state" style={{ padding: 24, color }}>{text}</td></tr>;
  if (as === 'inline') return <div style={{ padding: '12px 16px', fontSize: 'var(--fs-sm)', color: color || 'var(--text3)' }}>{text}</div>;
  return <div className={as === 'page' ? 'empty-state' : 'panel empty-state'} style={{ padding: as === 'page' ? 40 : 24, color }}>{text}</div>;
}
