// KPI card — mirror of legacy _kpiCard (L2550). Clickable navigates to navPage.
//
// The <Link> IS the card (via .dash-link / .dash-surface) rather than a wrapper
// around one. Before, `flex: 1; minWidth: 150` was declared on both the Link and
// the div inside it, and `cursor: pointer` sat on the inner div while focus
// landed on the outer <a> — so the hover affordance and the focus target were
// two different elements, and neither had any visible focus state at all.

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
  const surface: React.CSSProperties = {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderLeft: `4px solid ${color ?? 'var(--sig-neutral)'}`,
    borderRadius: 'var(--radius2)',
    padding: '14px 16px',
    height: '100%',
  };
  const body = (
    <>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: color ?? 'var(--text)',
          marginTop: 4,
          fontFamily: 'var(--mono)',
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{sub}</div> : null}
    </>
  );

  // Not clickable → a plain box. It must not look or behave like a link.
  if (!navPage) {
    return <div style={surface}>{body}</div>;
  }
  return (
    <Link to={navPage} className="dash-link" style={{ flex: 1, minWidth: 160 }}>
      <div className="dash-surface" style={surface}>
        {body}
      </div>
    </Link>
  );
}
