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
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">
          Rework Cycle Tracking — {rework.length} items with multiple attempts
        </span>
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
                <th style={{ textAlign: 'center' }}>Attempts</th>
                <th style={{ textAlign: 'center' }}>Total Rejected</th>
                <th>First Entry</th>
                <th>Last Entry</th>
                <th style={{ textAlign: 'center' }}>Days Elapsed</th>
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
                    <span style={{ color: 'var(--purple)', fontWeight: 600 }}>
                      {g.itemCode ?? '—'}
                    </span>
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
                        background: 'var(--bg3)',
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
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Rework cycles directly impact project timeline. Items with 2+ attempts or &gt;5 day delays
        need root cause analysis.
      </div>
    </div>
  );
}
