// My Work panel — mirror of legacy _workListPanel (L3222). Severity-styled
// rows, age chips, action buttons, "N critical · M total" badge, show-all.

import type { WorkListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useWorkList } from '../api';

function sevColor(sev: string): string {
  return sev === 'critical' ? 'var(--sig-critical)' : sev === 'warn' ? 'var(--sig-warn)' : 'var(--sig-info)';
}

function Row({ it }: { it: WorkListItem }): React.JSX.Element {
  const btnCls = it.severity === 'critical' ? 'btn-danger' : it.severity === 'warn' ? 'btn-primary' : 'btn-ghost';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderBottom: '1px solid var(--border)',
        borderLeft: `3px solid ${sevColor(it.severity)}`,
      }}
    >
      <span style={{ fontSize: 14 }}>{it.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{it.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {it.detail}
        </div>
      </div>
      <span style={{ fontSize: 11, color: it.severity === 'critical' ? 'var(--sig-critical)' : 'var(--text3)', fontWeight: 700, width: 36, textAlign: 'right' }}>
        {it.age > 0 ? `${it.age}d` : '·'}
      </span>
      <Link to={it.navPage} className={`btn ${btnCls} btn-sm`} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {it.actionLabel} →
      </Link>
    </div>
  );
}

export function MyWorkPanel({ mode = 'full' }: { mode?: 'full' | 'strip' }): React.JSX.Element | null {
  const { data } = useWorkList();
  const [expanded, setExpanded] = useState(false);
  const items = data?.items ?? [];

  if (mode === 'strip' && items.length === 0) return null;
  if (items.length === 0) {
    return (
      <div className="panel" style={{ marginBottom: 14, padding: 0 }}>
        <div className="panel-hdr">
          <span className="panel-title">📋 My Work</span>
        </div>
        <div style={{ padding: 16, color: 'var(--sig-ok)', fontWeight: 600 }}>
          ✅ You're all caught up — no pending work.
        </div>
      </div>
    );
  }

  const visibleCount = mode === 'strip' ? 5 : expanded ? Math.min(items.length, 50) : 10;
  const visible = items.slice(0, visibleCount);
  const hidden = items.length - visibleCount;
  const critical = items.filter((i) => i.severity === 'critical').length;

  return (
    <div className="panel" style={{ marginBottom: 14, padding: 0 }}>
      <div className="panel-hdr">
        <span className="panel-title">📋 {mode === 'strip' ? 'My Assigned' : 'My Work'}</span>
        <span
          className="badge"
          style={critical > 0 ? { background: 'var(--sig-critical-bg)', color: 'var(--sig-critical)' } : undefined}
        >
          {critical > 0 ? `${critical} critical · ${items.length} total` : `${items.length} item${items.length > 1 ? 's' : ''}`}
        </span>
      </div>
      <div>
        {visible.map((it) => (
          <Row key={it.key} it={it} />
        ))}
      </div>
      {mode === 'full' && hidden > 0 ? (
        <div className="wl-footer" style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--cyan)' }} onClick={() => setExpanded(true)}>
          📋 {hidden} more item{hidden > 1 ? 's' : ''} · Show all →
        </div>
      ) : mode === 'full' && expanded && items.length > 10 ? (
        <div className="wl-footer" style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 12, color: 'var(--cyan)' }} onClick={() => setExpanded(false)}>
          ▴ Show less
        </div>
      ) : null}
    </div>
  );
}
