import React from 'react';
export function EmptyState({ icon, children, tone }) {
  const color = tone === 'ok' ? 'var(--sig-ok)' : tone === 'error' ? 'var(--red)' : undefined;
  return <div className="empty-state" style={color ? { color, fontWeight: 700 } : undefined}>
    {icon ? <div className="empty-icon">{icon}</div> : null}{children}
  </div>;
}
