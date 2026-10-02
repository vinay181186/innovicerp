// QC Call Register — the Excel export (EVERY call matching the filters, ADR-201)
// and the "NC raised" banner. Split out of routes/index.tsx so that file stays
// under the 400-line ceiling.

import type {
  IncomingQcCompletedRow,
  IncomingQcPendingRow,
  QcHistoryLogRow,
  QcHistoryPendingRow,
  QcRegisterQuery,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fetchAllPages } from '@/lib/list-paging';
import { Banner } from '@/ui/feedback/Banner';
import { fetchQcRegister } from '@/modules/qc-history/api';
import { exportCompletedQc, exportPendingQc } from '@/modules/qc-history/lib/export';
import type { RaisedNc } from './qc-call-inspect-form';
import type { CompletedVM } from './qc-call-completed-columns';
import type { PendingVM } from './qc-call-pending-columns';
import type { QcView } from './qc-sheet';

/** Export every call matching the register query (search + stage + Mine). */
export async function exportRegister(
  query: Omit<QcRegisterQuery, 'limit' | 'offset'>,
  view: QcView,
): Promise<void> {
  const all = await fetchAllPages((limit, offset) => fetchQcRegister({ ...query, limit, offset }));
  if (view === 'pending') {
    const ops: QcHistoryPendingRow[] = [];
    const inc: IncomingQcPendingRow[] = [];
    for (const it of all as PendingVM[]) {
      if (it.kind === 'op') ops.push(it.row);
      else inc.push(it.row);
    }
    exportPendingQc(ops, inc);
    return;
  }
  const ops: QcHistoryLogRow[] = [];
  const inc: IncomingQcCompletedRow[] = [];
  for (const it of all as CompletedVM[]) {
    if (it.kind === 'op') ops.push(it.row);
    else inc.push(it.row);
  }
  exportCompletedQc(ops, inc);
}

/** The NC the last QC submit raised (ADR-190), with a link to dispose it. */
export function RaisedNcBanner(props: { nc: RaisedNc; onDismiss: () => void }): React.JSX.Element {
  const { nc, onDismiss } = props;
  return (
    <Banner
      tone="warn"
      accent
      onDismiss={onDismiss}
      title={
        <>
          NC{' '}
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {nc.code}
          </span>{' '}
          raised —{' '}
          <Link to="/nc-register/$id" params={{ id: nc.id }}>
            Dispose now →
          </Link>
        </>
      }
    >
      The rejected qty from the QC Inspection just saved is on this NC until it is disposed.
    </Banner>
  );
}
