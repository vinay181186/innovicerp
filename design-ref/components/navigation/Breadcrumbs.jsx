import React from 'react';
export function Breadcrumbs({ crumbs = [], onNavigate }) {
  return <nav className="breadcrumbs" aria-label="Breadcrumb">
    {crumbs.map((c, i) => {
      const last = i === crumbs.length - 1;
      return <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {c.link && !last ? <a style={{ color: 'var(--cyan)', cursor: 'pointer' }} onClick={() => onNavigate && onNavigate(c)}>{c.label}</a>
          : <span style={{ color: last ? 'var(--text)' : 'var(--text3)', fontWeight: last ? 700 : 400 }}>{c.label}</span>}
        {!last ? <span style={{ color: 'var(--text3)' }}>›</span> : null}
      </span>;
    })}
  </nav>;
}
