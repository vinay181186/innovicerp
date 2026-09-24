import React from 'react';
export function QtyStrip({ items = [] }) {
  return <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6 }}>
    {items.map((it, i) => <div key={i} style={{ padding: '4px 12px', textAlign: 'center', minWidth: 58, borderLeft: i ? '1px solid var(--border)' : undefined }}>
      <div className="mono fw-700" style={{ fontSize: 'var(--fs-md)', color: it.color || 'var(--text)', lineHeight: 1.2 }}>{it.value}</div>
      <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{it.label}</div>
    </div>)}
  </div>;
}
export function Fact({ label, value, color, big = false }) {
  return <div className="form-grp"><span className="form-label">{label}</span><div style={{ fontWeight: 600, color, fontSize: big ? 16 : undefined }}>{value == null || value === '' ? '—' : value}</div></div>;
}
