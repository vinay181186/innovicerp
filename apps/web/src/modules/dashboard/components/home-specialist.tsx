// Specialist home (QC / Purchase / Design) — mirror of legacy
// _homeSpecialistView (L2769). Dept KPIs + dept panels.

import type { HomeResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { KpiCard } from './kpi-card';

export function HomeSpecialist({ home }: { home: HomeResponse }): React.JSX.Element {
  const s = home.specialist!;
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {s.kpis.map((k, i) => (
          <KpiCard key={i} label={k.label} value={k.value} color={k.color} navPage={k.navPage} sub={k.sub} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: s.panels.length > 1 ? '1fr 1fr' : '1fr', gap: 14 }}>
        {s.panels.map((p, pi) => (
          <div key={pi} className="panel" style={{ padding: 0 }}>
            <div className="panel-hdr">
              <span className="panel-title" style={p.titleColor ? { color: p.titleColor } : undefined}>{p.title}</span>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: '40vh' }}>
              <table className="innovic-table">
                <thead>
                  <tr>{p.headers.map((h, hi) => <th key={hi}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {p.rows.length === 0 ? (
                    <tr><td colSpan={p.headers.length} className="empty-state" style={{ color: 'var(--sig-ok)', fontWeight: 700 }}>{p.emptyText}</td></tr>
                  ) : (
                    p.rows.map((r, ri) => (
                      <tr key={ri} style={{ cursor: 'pointer' }}>
                        {r.cells.map((c, ci) => (
                          <td key={ci} className={ci === 0 ? 'td-code' : undefined} style={ci === 0 ? { color: 'var(--cyan)' } : { fontSize: 11 }}>
                            {ci === 0 ? <Link to={r.navPage} style={{ color: 'var(--cyan)', textDecoration: 'none' }}>{c}</Link> : c}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
