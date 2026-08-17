// Specialist home (QC / Purchase / Design) — mirror of legacy
// _homeSpecialistView (L2769). Dept KPIs + dept panels.

import type { HomeResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatStrip } from '@/components/shared/stat-strip';

export function HomeSpecialist({ home }: { home: HomeResponse }): React.JSX.Element {
  const s = home.specialist!;
  return (
    <div>
      {/* One strip, same as the admin and operator homes (styling Rule 3). */}
      <StatStrip
        items={s.kpis.map((k, i) => ({
          key: `${k.label}-${i}`,
          label: k.label,
          count: k.value,
          color: k.color,
          to: k.navPage,
          sub: k.sub,
        }))}
      />

      {/* auto-fit rather than a hard '1fr 1fr': these panels hold tables, and a
          fixed half-width column made every table scroll sideways on a laptop. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns:
            s.panels.length > 1 ? 'repeat(auto-fit, minmax(340px, 1fr))' : '1fr',
          gap: 14,
        }}
      >
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
