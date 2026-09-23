// Incoming-QC pending row for the unified QC Call Register: a GRN line awaiting
// inspection. Clicking it opens the accept/reject popup (IncomingQcInspectModal
// — the same one the Incoming QC page's "🔬 Inspect" shows — which credits
// accepted qty to stock via POST /incoming-qc/:id/inspect). Extracted so the
// QC Call Register can show incoming-material QC alongside process (JC-op) QC
// on a single approval screen. The line is drawn by the register's ruled sheet
// (qc-call-register/components/qc-sheet.tsx PendingSheetRow); the popup is
// mounted by the register page. Completed incoming rows are drawn by the sheet
// directly (CompletedIncomingSheetRow).

import { type IncomingQcPendingRow, opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { PendingSheetRow } from '@/modules/qc-call-register/components/qc-sheet';

export function IncomingPendingRow(props: {
  o: IncomingQcPendingRow;
  /** Open the inspect popup for this line. */
  onInspect: () => void;
}): React.JSX.Element {
  const { o, onInspect } = props;
  // Incoming material is its OWN form key — this row sits on the QC Call
  // Register, but accepting a GRN line is qc_incoming `entry` (what
  // incoming-qc's submitIncomingQc enforces), not qc_submit. Same gate the
  // popup's form applies; here it decides whether the line opens at all.
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_incoming').entry;

  return (
    <PendingSheetRow
      code={
        <Link
          to="/goods-receipt-notes/$id"
          params={{ id: o.grnId }}
          title="Open this GRN"
          style={{ color: 'inherit' }}
        >
          {o.grnNo}
        </Link>
      }
      partName={o.itemName}
      // An OSP return traces to an SO line and shows CODE/REV; a vendor's
      // raw-material receipt has no SO behind it and correctly shows the bare
      // code. The "no job card" line below says which is which.
      itemCode={itemCodeWithRev(o.itemCode, o.itemRevision)}
      context={
        <>
          {o.vendorName ?? '—'} · GRN <span className="mono">{o.grnNo}</span>
          {/* POL — the CUSTOMER's own PO line number off the SO line behind this
              receipt. Same purple mono chip the Job Card list uses; absent on a
              raw-material receipt, which has no sales order behind it. */}
          {o.clientPoLineNo ? (
            <>
              {' '}
              · POL{' '}
              <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                {o.clientPoLineNo}
              </span>
            </>
          ) : null}
          {o.soCode ? (
            <>
              {' '}
              · SO <span className="mono">{o.soCode}</span>
            </>
          ) : null}
        </>
      }
      contextLine2={
        o.jcCode ? (
          <>
            → <span className="mono">{o.jcCode}</span> Op {o.opSeq != null ? opSrNo(o.opSeq) : ''}
            {o.opName ? ` · ${o.opName}` : ''}
          </>
        ) : (
          <span style={{ color: 'var(--amber)', fontWeight: 700 }}>No job card</span>
        )
      }
      qty={o.pendingQty}
      calledDate={o.grnDate}
      waitDays={o.waitDays}
      overdue={false}
      stage="incoming"
      // No `entry` → the line reads "View only" and opens nothing.
      canInspect={canEntry}
      onInspect={onInspect}
    />
  );
}
