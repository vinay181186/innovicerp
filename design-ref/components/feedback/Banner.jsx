import React from 'react';
const T = {
  warn: { bg: 'var(--amber3)', bd: 'var(--amber)', fg: 'var(--amber2)' },
  ok: { bg: 'var(--green3)', bd: 'var(--green)', fg: 'var(--green2)' },
  error: { bg: 'var(--red3)', bd: 'var(--red)', fg: 'var(--red2)' },
  info: { bg: 'var(--sig-info-bg)', bd: 'var(--sig-info-bd)', fg: 'var(--blue2)' },
};
export function Banner({ tone = 'warn', title, children, accent = false, onDismiss }) {
  const t = T[tone];
  return <div role="status" style={{ background: t.bg, border: '1px solid ' + t.bd, borderLeft: accent ? '4px solid ' + t.bd : undefined, borderRadius: accent ? 8 : 6, padding: accent ? '8px 12px' : 12, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
    <div style={{ flex: 1 }}>
      {title ? <div className="fw-700" style={{ fontSize: 'var(--fs-sm)', color: t.fg, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>{title}</div> : null}
      {children ? <div style={{ fontSize: title ? 12 : 13, color: title ? 'var(--text2)' : t.fg, marginTop: title ? 2 : 0 }}>{children}</div> : null}
    </div>
    {onDismiss ? <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 'var(--fs-xs)' }} onClick={onDismiss}>✕</button> : null}
  </div>;
}
