// Rework Cycles tab (legacy _qccRenderRework L18920). Ops inspected more than
// once, or once with rejects — these directly impact project timeline.

import { type QcReworkRow, opSrNo } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';

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
            ✅ No rework cycles — all items accepted at first QC
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC / Op</th>
                  {/* POL — the CUSTOMER's own purchase-order line number, its
                      own column immediately before the item. */}
                  <th style={{ color: 'var(--purple)' }}>POL</th>
                  <th>Item Code</th>
                  <th>SO No.</th>
                  <th className="td-ctr">Attempts</th>
                  <th className="td-ctr">Rejected</th>
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
                      <span style={{ color: 'var(--red)', fontWeight: 700 }}>
                        Op{opSrNo(g.opSeq)}
                      </span>
                    </td>
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {g.clientPoLineNo ?? '—'}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {/* Legacy L18939 hardcodes #8B5CF6, not var(--purple). */}
                      <span style={{ color: '#8B5CF6', fontWeight: 600 }}>
                        {itemCodeWithRev(g.itemCode, g.itemRevision)}
                      </span>
                      {/* The Item column named the drawing but never the part.
                          Whoever chases a root cause off this list reads the
                          part name, not the code, so it sits directly under the
                          code in the column that already claims to be the item.
                          The cell is no-wrap, so the name is capped and
                          truncated with the full text on hover rather than
                          stretching the table sideways; a row with no item name
                          shows nothing extra. */}
                      {g.itemName ? (
                        <>
                          <br />
                          <span
                            className="fw-700"
                            style={{
                              display: 'inline-block',
                              maxWidth: 200,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'bottom',
                            }}
                            title={g.itemName}
                          >
                            {g.itemName}
                          </span>
                        </>
                      ) : null}
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
    </>
  );
}
