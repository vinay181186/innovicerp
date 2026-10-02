// QC Call Register — the Excel export (EVERY call matching the filters, ADR-201)
// and the "NC raised" banner. Split out of routes/index.tsx so that file stays
// under the 400-line ceiling.

import type {
  IncomingQcCompletedRow,
  IncomingQcPendingRow,
  PartyGrnQcRow,
  QcHistoryLogRow,
  QcHistoryPendingRow,
  QcRegisterQuery,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fetchAllPages } from '@/lib/list-paging';
import { Banner } from '@/ui/feedback/Banner';
import { fetchQcRegister } from '@/modules/qc-history/api';
import { exportCompletedQc, exportPendingQc } from '@/modules/qc-history/lib/export';
import { PartyGrnQcModal } from '@/modules/party-grn/components/party-grn-qc-modal';
import type { RaisedNc } from './qc-call-inspect-form';
import type { CompletedVM } from './qc-call-completed-columns';
import { type PendingVM, pgrnMaterialOf, pgrnOrderOf } from './qc-call-pending-columns';
import type { QcView } from './qc-sheet';

// A Party GRN line (ADR-203) rides the export's incoming rows: its PGRN no.
// fills the GRN No. column, the customer stands in the vendor slot ("Incoming ·
// <customer>"), the JWSO line fills SO No. and the customer RM the Item Name.
function pgrnAsPending(r: PartyGrnQcRow): IncomingQcPendingRow {
  return {
    grnLineId: r.partyGrnLineId,
    grnId: r.partyGrnId,
    grnNo: r.partyGrnNo,
    grnDate: r.grnDate,
    poCode: null,
    vendorName: r.customerName,
    // The JWSO line (a job-work sales order) fills the SO No. column.
    soCode: pgrnOrderOf(r),
    jcCode: null,
    opSeq: null,
    opName: null,
    itemCode: r.partCode,
    itemRevision: r.partRevision,
    clientPoLineNo: null,
    itemName: `Customer RM ${pgrnMaterialOf(r)}`,
    receivedQty: r.receivedQty,
    pendingQty: r.pendingQty,
    waitDays: r.waitDays,
  };
}
function pgrnAsCompleted(r: PartyGrnQcRow): IncomingQcCompletedRow {
  return {
    grnLineId: r.partyGrnLineId,
    grnId: r.partyGrnId,
    grnNo: r.partyGrnNo,
    grnDate: r.grnDate,
    qcDate: r.qcDate,
    respDays: r.qcDate ? r.waitDays : null,
    vendorName: r.customerName,
    itemCode: r.partCode,
    itemRevision: r.partRevision,
    clientPoLineNo: null,
    itemName: `Customer RM ${pgrnMaterialOf(r)}`,
    receivedQty: r.receivedQty,
    acceptedQty: r.acceptedQty,
    rejectedQty: r.rejectedQty,
    disposition:
      r.rejectedQty > 0 ? (r.acceptedQty > 0 ? 'Partial Accept' : 'Rejected') : 'Accepted',
    qcAt: r.qcDate,
    qcInspectedBy: r.qcByName,
    qcRemarks: r.rejectReason,
    qcReportPath: null,
    qcReportName: null,
  };
}

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
      else if (it.kind === 'pgrn') inc.push(pgrnAsPending(it.row));
      else inc.push(it.row);
    }
    exportPendingQc(ops, inc);
    return;
  }
  const ops: QcHistoryLogRow[] = [];
  const inc: IncomingQcCompletedRow[] = [];
  for (const it of all as CompletedVM[]) {
    if (it.kind === 'op') ops.push(it.row);
    else if (it.kind === 'pgrn') inc.push(pgrnAsCompleted(it.row));
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

/** Incoming QC for ONE Party GRN line (ADR-203): the Party GRN QC popup,
 *  focused on that line. Saving refreshes the party-grn queries (the popup's
 *  own mutation); onClose refreshes the register. */
export function PgrnQcPopup(props: { row: PartyGrnQcRow; onClose: () => void }): React.JSX.Element {
  const { row, onClose } = props;
  return (
    <PartyGrnQcModal
      row={{
        id: row.partyGrnId,
        code: row.partyGrnNo,
        jwCodeText: row.jwCode,
        clientName: row.customerName,
        clientCodeText: null,
      }}
      onlyLineId={row.partyGrnLineId}
      onClose={onClose}
    />
  );
}
