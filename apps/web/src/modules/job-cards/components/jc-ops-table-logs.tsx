// Job Card Operations tab — the "Recent logs" line inside an op's ▸ detail:
// the latest three entries, worded as today's op card (jc-op-card.tsx
// L769-841), with the NC each reject raised linked to the register.
import type { NcStatus, OpLog } from '@innovic/shared';
import { NC_STATUS_LABELS, SHIFT_LABELS } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { statusText } from '@/lib/status-text';
import { fmtJcStamp } from '../lib/fmt-jc-date';

const dash = <span className="text3">—</span>;

export function JcOpsTableLogs({ logs }: { logs: OpLog[] }): React.JSX.Element {
  /** `logs` is latest first (jc-status-view.tsx logsByOp). */
  const recent = logs.slice(0, 3);
  return (
    <div className="jc-ops-logs">
      <span className="jc-ops-lk">Recent logs</span>
      {recent.length === 0
        ? dash
        : recent.map((l) => (
            <span key={l.id} title={l.remarks ?? undefined}>
              <span className="mono text3">{fmtJcStamp(l.logDate, l.startTime)}</span>
              {' · '}
              {SHIFT_LABELS[l.shift]}
              {' · Qty '}
              <b className="jc-ops-good">+{l.qty}</b>
              {l.rejectQty > 0 ? (
                <>
                  {' · Deviated '}
                  <b className="jc-ops-bad">{l.rejectQty}</b>
                </>
              ) : null}
              {' · '}
              <b>{l.operatorName ?? '—'}</b>
              {l.ncs.length > 0 ? (
                <>
                  {' · '}
                  <Link
                    to="/nc-register/$id"
                    params={{ id: l.ncs[0]!.id }}
                    className="mono fw-700 jc-ops-warn"
                    title={`Open ${l.ncs[0]!.code}`}
                  >
                    {l.ncs[0]!.code}
                  </Link>{' '}
                  <span className="text3">
                    {NC_STATUS_LABELS[l.ncs[0]!.status as NcStatus] ?? statusText(l.ncs[0]!.status)}
                  </span>
                  {l.ncs.length > 1 ? (
                    <span className="text3"> +{l.ncs.length - 1} more</span>
                  ) : null}
                </>
              ) : null}
            </span>
          ))}
    </div>
  );
}
