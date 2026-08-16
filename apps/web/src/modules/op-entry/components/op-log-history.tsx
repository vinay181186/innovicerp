// Op-log history — legacy chrome (.innovic-table).

import type { OpLog } from '@innovic/shared';
import { Loader2 } from 'lucide-react';

interface Props {
  logs: OpLog[];
  isLoading: boolean;
}

const TYPE_LABEL: Record<OpLog['logType'], string> = {
  start: 'Start',
  complete: 'Complete',
  qc: 'QC',
};

export function OpLogHistory({ logs, isLoading }: Props): React.JSX.Element {
  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Shift</th>
            <th>Type</th>
            <th>Machine</th>
            <th style={{ textAlign: 'center' }}>Qty</th>
            <th style={{ textAlign: 'center' }}>Reject</th>
            <th>Operator</th>
            <th>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={9} className="empty-state">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading log…
              </td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan={9} className="empty-state">
                No log entries yet.
              </td>
            </tr>
          ) : (
            logs.map((l) => (
              <tr key={l.id}>
                <td className="mono" style={{ fontSize: 11 }}>
                  {l.logDate}
                </td>
                {/* op_log.start_time. Historically only the 'start' marker
                    carried one — completion and QC rows were written with
                    null — so older rows legitimately show a dash. */}
                <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {l.startTime ? l.startTime.slice(0, 5) : '—'}
                </td>
                <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                  {l.shift}
                </td>
                <td className="text3" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                  {TYPE_LABEL[l.logType]}
                </td>
                {/* 0095: the machine stamped on THIS entry — survives a later
                    machine change on the op, so past qty stays attributed. */}
                <td className="mono" style={{ fontSize: 11 }}>
                  {l.machineCode ?? l.machineCodeText ?? '—'}
                </td>
                <td className="td-ctr mono">{l.qty}</td>
                <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                  {l.rejectQty || ''}
                </td>
                <td style={{ fontSize: 12 }}>{l.operatorName ?? '—'}</td>
                <td className="text3" style={{ fontSize: 11 }}>
                  {l.remarks ?? ''}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
