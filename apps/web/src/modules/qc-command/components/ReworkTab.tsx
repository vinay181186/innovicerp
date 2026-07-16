// Rework Cycles tab (legacy _qccRenderRework L18920). Ops inspected more than
// once, or once with rejects — these directly impact project timeline.

import type { QcReworkRow } from '@innovic/shared';

function fmt(d: string | null): string {
  return d ?? '—';
}

function attemptColor(attempts: number): string {
  if (attempts === 1) return 'var(--amber)';
  if (attempts === 2) return '#F97316';
  return 'var(--red)';
}

export function ReworkTab({ rework }: { rework: QcReworkRow[] }): React.JSX.Element {
  return (
    <>
      <div className="panel">
        {/* Legacy L18924 hand-rolls this sub-header instead of .panel-hdr. */}
        <div
          style={{
            padding: '10px 14px',
            fontSize: 12,
            fontWeight: 700,
            borderBottom: '1px solid var(--border)',
            color: 'var(--text2)',
          }}
        >
          Rework Cycle Tracking — {rework.length} items with multiple attempts
        </div>
        {rework.length === 0 ? (
          <div className="empty-state" style={{ color: 'var(--green)' }}>
            ✅ No rework cycles — all items passed QC cleanly
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC / Op</th>
                  <th>Item</th>
                  <th>SO</th>
                  <th className="td-ctr">Attempts</th>
                  <th className="td-ctr">Total Rejected</th>
                  <th>First Entry</th>
                  <th>Last Entry</th>
                  <th className="td-ctr">Days Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {rework.map((g) => (
                  <tr key={g.jcOpId}>
                    <td className="td-code">
                      <span style={{ color: 'var(--cyan)' }}>{g.jcCode}</span>{' '}
                      <span style={{ color: 'var(--red)', fontWeight: 700 }}>Op{g.opSeq}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {/* Legacy L18939 hardcodes #8B5CF6, not var(--purple). */}
                      <span style={{ color: '#8B5CF6', fontWeight: 600 }}>{g.itemCode ?? '—'}</span>
                      <br />
                      <span className="text3">{g.operation}</span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--cyan)' }}>{g.soCode ?? '—'}</td>
                    <td className="td-ctr">
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          padding: '2px 10px',
                          borderRadius: 10,
                          background: 'rgba(0,0,0,0.05)',
                          color: attemptColor(g.attempts),
                        }}
                      >
                        {g.attempts}×
                      </span>
                    </td>
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>
                      {g.totalRejected}
                    </td>
                    <td style={{ fontSize: 11 }}>{fmt(g.firstEntry)}</td>
                    <td style={{ fontSize: 11 }}>{fmt(g.lastEntry)}</td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{ color: g.daysElapsed > 5 ? 'var(--red)' : 'var(--amber)' }}
                    >
                      {g.daysElapsed}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Legacy L18949 places the tip outside the panel, and its empty-state
          branch (L18925) returns before emitting it. */}
      {rework.length > 0 ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
          💡 Rework cycles directly impact project timeline. Items with 2+ attempts or &gt;5 day
          delays need root cause analysis.
        </div>
      ) : null}
    </>
  );
}
