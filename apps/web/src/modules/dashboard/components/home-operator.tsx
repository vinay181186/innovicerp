// Operator home — mirror of legacy _homeOperatorView (L2674). Currently
// running, today's output, ready-for-you table. The operator-strip My Work is
// rendered by the shell.

import type { HomeResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { KpiCard } from './kpi-card';

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
                </div>
                <div><div style={{ fontSize: 10, color: 'var(--text3)' }}>ELAPSED</div><div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>{elapsedStr(r.elapsedMin)}</div></div>
                <div><div style={{ fontSize: 10, color: 'var(--text3)' }}>PROGRESS</div><div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>{r.completed}/{r.orderQty}</div></div>
                <Link to="/op-entry" className="btn btn-success btn-sm">✓ Log Completion</Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <KpiCard label="My Output Today" value={`${o.myOutputQty} pcs`} color="var(--sig-ok)" navPage="/op-entry" sub={`Across ${o.myEntries} entries`} />
        <KpiCard label="Ready to Work" value={o.readyCount} color="var(--dept-production)" navPage="/op-entry" sub={o.readyCount > 0 ? 'Pick an op below to start' : 'All ops waiting on material'} />
        <KpiCard label="Running Now" value={`(${o.allRunningCount} in factory)`} color="var(--sig-warn)" navPage="/production-dashboard" sub="All running operations" />
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-hdr">
          <span className="panel-title">Ready for You</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Top {o.ready.length} operations sorted by due date</span>
        </div>
        <div className="tbl-wrap" style={{ maxHeight: '50vh' }}>
          <table className="innovic-table">
            <thead>
              <tr><th>JC</th><th>Op</th><th>Machine</th><th>Item</th><th className="td-ctr">Available</th><th>Due</th><th /></tr>
            </thead>
            <tbody>
              {o.ready.length === 0 ? (
                <tr><td colSpan={7} className="empty-state">No operations ready. Check back soon or speak to your supervisor.</td></tr>
              ) : (
                o.ready.map((r, i) => (
                  <tr key={i}>
                    <td className="td-code" style={{ color: 'var(--cyan)', fontWeight: 700 }}>{r.jcCode}</td>
                    <td className="td-ctr mono">{r.opSeq}</td>
                    <td><b>{r.machine ?? '—'}</b></td>
                    <td className="td-code" style={{ color: 'var(--text2)', fontSize: 11 }}>{r.itemCode ?? ''}</td>
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
