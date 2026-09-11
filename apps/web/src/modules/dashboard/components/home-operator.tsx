// Operator home — mirror of legacy _homeOperatorView (L2674). Currently
// running, today's output, ready-for-you table. The operator-strip My Work is
// rendered by the shell.

import type { HomeResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatStrip } from '@/components/shared/stat-strip';
import { itemCodeWithRev } from '@/lib/item-code';

function elapsedStr(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

export function HomeOperator({ home }: { home: HomeResponse }): React.JSX.Element {
  const o = home.operator!;
  return (
    <div>
      {o.running.length > 0 ? (
        <div className="panel" style={{ padding: 0, marginBottom: 14, borderLeft: '4px solid var(--sig-warn)' }}>
          <div className="panel-hdr" style={{ background: 'var(--sig-warn-bg)' }}>
            <span className="panel-title" style={{ color: 'var(--sig-warn)' }}>▶ Currently Running</span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            {o.running.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--cyan)' }}>{r.jcCode} · Op {r.opSeq}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>{r.operation} on <b>{r.machine ?? '—'}</b></div>
                  {/* WHAT is on the machine -- the JC number alone says which
                      JOB, not which part. This row is a flexWrap strip of
                      minWidth-200 blocks and a fifth sibling block wraps the
                      whole card on a phone-width panel, so the item goes INSIDE
                      the block that already carries the JC number: a third line,
                      no new flex child, card exactly as wide as before. A long
                      part name ellipsises on one line and carries its full text
                      in the title. No item at all renders nothing, not a dash. */}
                  {r.itemCode !== null || r.itemName !== null ? (
                    <div
                      title={[itemCodeWithRev(r.itemCode, r.itemRevision, ''), r.itemName ?? '']
                        .filter((t) => t !== '')
                        .join(' · ')}
                      style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {/* The code is the readable part of this line; the name
                          after it may stay muted. See the item-code rule. */}
                      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(r.itemCode, r.itemRevision, '')}
                      </span>
                      {r.itemCode !== null && r.itemName !== null ? ' · ' : ''}
                      {r.itemName ?? ''}
                    </div>
                  ) : null}
                </div>
                <div><div style={{ fontSize: 10, color: 'var(--text3)' }}>ELAPSED</div><div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>{elapsedStr(r.elapsedMin)}</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text3)' }}>PROGRESS</div><div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>{r.completed}/{r.orderQty}</div></div>
                <Link to="/op-entry" className="btn btn-success btn-sm">✓ Log Completion</Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* One strip, same as the admin and specialist homes (styling Rule 3). */}
      <StatStrip
        items={[
          {
            key: 'output',
            label: 'My Output Today',
            count: `${o.myOutputQty} pcs`,
            color: 'var(--sig-ok)',
            to: '/op-entry',
            sub: `Across ${o.myEntries} entries`,
          },
          {
            key: 'ready',
            label: 'Ready to Work',
            count: o.readyCount,
            color: 'var(--dept-production)',
            to: '/op-entry',
            sub:
              o.readyCount > 0 ? 'Pick an op below to start' : 'All ops waiting on material',
          },
          {
            key: 'running',
            label: 'Running Now',
            count: `${o.allRunningCount} in factory`,
            color: 'var(--sig-warn)',
            to: '/production-dashboard',
            sub: 'All running operations',
          },
        ]}
      />

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-hdr">
          <span className="panel-title">Ready for You</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Top {o.ready.length} operations sorted by due date</span>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: '50vh' }}>
          <table className="innovic-table">
            <thead>
              {/* Item Name sits beside the code it belongs to: the code names the
                  drawing, the name is what the operator recognises on the rack. */}
              <tr><th>JC</th><th>Op</th><th>Machine</th><th>Item</th><th>Item Name</th><th className="td-ctr">Available</th><th>Due</th><th /></tr>
            </thead>
            <tbody>
              {o.ready.length === 0 ? (
                <tr><td colSpan={8} className="empty-state">No operations ready. Check back soon or speak to your supervisor.</td></tr>
              ) : (
                o.ready.map((r, i) => (
                  <tr key={i}>
                    <td className="td-code" style={{ color: 'var(--cyan)', fontWeight: 700 }}>{r.jcCode}</td>
                    <td className="td-ctr mono">{r.opSeq}</td>
                    <td><b>{r.machine ?? '—'}</b></td>
                    {/* The item code is how an operator finds the drawing, so it
                        gets the darkest text token and the bold weight rather
                        than the muted grey it used to carry. The part name in
                        the next cell stays muted on purpose — a quiet name
                        beside a strong code is what makes the code findable. */}
                    <td className="td-code fw-700" style={{ color: 'var(--text)', fontSize: 11 }}>{itemCodeWithRev(r.itemCode, r.itemRevision, '')}</td>
                    {/* A part name can run long, so it truncates on one line and
                        keeps the whole thing in the tooltip. A card with no SO
                        line behind it has no name to show and the cell stays
                        blank rather than printing a dash. */}
                    <td style={{ fontSize: 11, color: 'var(--text2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.itemName ?? ''}>{r.itemName ?? ''}</td>
                    <td className="td-ctr mono" style={{ fontSize: 15, fontWeight: 800, color: 'var(--sig-warn)' }}>{r.available}</td>
                    <td style={{ fontSize: 11, color: r.isOverdue ? 'var(--sig-critical)' : 'var(--text2)', fontWeight: r.isOverdue ? 700 : 400 }}>
                      {r.dueDate ?? '—'}{r.isOverdue ? ' ⚠' : ''}
                    </td>
                    <td><Link to="/op-entry" className="btn btn-success btn-sm" style={{ fontSize: 11 }}>▶ Start</Link></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
