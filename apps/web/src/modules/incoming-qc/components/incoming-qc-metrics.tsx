// Incoming QC pipeline strip — split out of routes/index.tsx (ADR-201 paging
// made that file longer). Every figure comes from the server's metrics, which
// cover the WHOLE pending queue, never the 25 rows on screen.

import type { IncomingQcMetrics } from '@innovic/shared';
import { StatStrip } from '@/components/shared/stat-strip';
import { daysText } from '../lib/qc-format';

export function IncomingQcMetricsStrip({ m }: { m: IncomingQcMetrics }): React.JSX.Element {
  return (
    <StatStrip
      items={[
        {
          key: 'grnsWaiting',
          label: 'GRNs Waiting',
          count: m.grnsWaiting,
          color: 'var(--amber2)',
          // Price-gated: the server sends null when prices are hidden.
          sub: m.valueInQc == null ? undefined : `₹${m.valueInQc.toLocaleString('en-IN')} in QC`,
        },
        {
          key: 'pendingQty',
          label: 'QC Pending',
          count: m.pendingQty,
          color: 'var(--amber2)',
        },
        {
          key: 'oldest',
          label: 'Oldest GRN',
          count: daysText(m.oldestDays),
          color: m.oldestDays > 5 ? 'var(--red2)' : 'var(--amber2)',
          sub: [m.oldestGrnNo, `Avg ${daysText(m.avgWaitDays)}`].filter(Boolean).join(' · '),
        },
        {
          key: 'todayAccepted',
          label: 'Today Accepted',
          count: m.todayAcceptedQty,
          color: 'var(--green2)',
          sub: `${m.todayAcceptedGrns} GRNs`,
        },
        {
          key: 'todayRejected',
          label: 'Today Deviated',
          count: m.todayRejectedQty,
          color: 'var(--red2)',
        },
      ]}
    />
  );
}
