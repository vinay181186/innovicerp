// Live operations board — legacy chrome (.panel / .innovic-table / .btn).

import type { RunningOp } from '@innovic/shared';
import { Square } from 'lucide-react';
import { useStopOp } from '../api';
import { RunningOpStatusBadge } from './status-badge';

interface Props {
  rows: RunningOp[];
}

export function RunningOpsBoard({ rows }: Props): React.JSX.Element {
  const stop = useStopOp();
  const running = rows.filter((r) => r.status === 'running');
  const recent = rows.filter((r) => r.status !== 'running').slice(0, 20);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Running now</span>
          <span className="mono text3" style={{ fontSize: 11 }}>
            {running.length} session{running.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>JC</th>
                <th>Op</th>
                <th>Operation</th>
                <th>Machine</th>
                <th>Operator</th>
                <th>Started</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {running.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No ops currently running.
                  </td>
                </tr>
              ) : (
                running.map((r) => (
                  <tr key={r.id}>
                    <td className="td-code cyan">{r.jobCardCode}</td>
                    <td className="mono">{r.opSeq}</td>
                    <td>{r.operation}</td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.machineCode ?? (r.isOsp ? 'OSP' : '—')}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.operatorName ?? '—'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {r.startDate} {r.startTime.slice(0, 5)}
                    </td>
                    <td>
                      <RunningOpStatusBadge status={r.status} />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={stop.isPending}
                        onClick={() => void stop.mutateAsync(r.id)}
                      >
                        <Square size={13} /> Stop
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {recent.length > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">Recent</span>
            <span className="mono text3" style={{ fontSize: 11 }}>
              last {recent.length}
            </span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>JC</th>
                  <th>Op</th>
                  <th>Operation</th>
                  <th>Machine</th>
                  <th>Operator</th>
                  <th>Ended</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="td-code">{r.jobCardCode}</td>
                    <td className="mono">{r.opSeq}</td>
                    <td>{r.operation}</td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.machineCode ?? (r.isOsp ? 'OSP' : '—')}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.operatorName ?? '—'}</td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.endedAt ? r.endedAt.slice(0, 16).replace('T', ' ') : '—'}
                    </td>
                    <td>
                      <RunningOpStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
