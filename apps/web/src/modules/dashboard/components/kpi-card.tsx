// KPI card — mirror of legacy _kpiCard (L2550). Clickable navigates to navPage.

import { Link } from '@tanstack/react-router';

export function KpiCard({
  label,
  value,
  sub,
  color,
  navPage,
}: {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  color?: string;
  navPage?: string;
}): React.JSX.Element {
  const inner = (
    <div
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${color ?? 'var(--sig-neutral)'}`,
        borderRadius: 10,
        padding: '14px 16px',
        flex: 1,
        minWidth: 150,
        cursor: navPage ? 'pointer' : undefined,
      }}
    >
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: color ?? 'var(--text)', marginTop: 4, fontFamily: 'var(--mono)' }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
  return navPage ? (
    <Link to={navPage} style={{ flex: 1, minWidth: 150, textDecoration: 'none' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}
