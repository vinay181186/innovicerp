// Incoming-QC pending row for the unified QC Call Register: a GRN line awaiting
// inspection with an inline accept/reject form (credits accepted qty to stock
// via POST /incoming-qc/:id/inspect). Extracted so the QC Call Register can
// show incoming-material QC alongside process (JC-op) QC on a single approval
// screen. The collapsed line is drawn by the register's ruled sheet
// (qc-call-register/components/qc-sheet.tsx PendingSheetRow); the expanded
// form is the shared IncomingQcInspectForm — the same one the Incoming QC
// page's "🔬 Inspect" popup shows — so the two screens cannot drift. Completed
// incoming rows are drawn by the sheet directly (CompletedIncomingSheetRow).

import { type IncomingQcPendingRow, opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { itemCodeWithRev } from '@/lib/item-code';
import { PendingSheetRow } from '@/modules/qc-call-register/components/qc-sheet';
import { IncomingQcInspectFormView, useIncomingQcInspect } from './incoming-qc-inspect-form';

export function IncomingPendingRow(props: {
  o: IncomingQcPendingRow;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, onToggle, onDone } = props;
  // The state lives on the ROW, not inside the expanded area: the sheet
  // unmounts that area on collapse, and a half-typed qty has always survived
  // Close / Inspect on this row.
  const form = useIncomingQcInspect({ o, onDone });

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
      open={open}
      onToggle={onToggle}
    >
      {/* No `entry` → the form is simply not drawn (and the sheet shows no
          Inspect toggle). No notice either: an expanded row that shows only
          its figures reads as view-only on its own. */}
      {form.canEntry ? <IncomingQcInspectFormView form={form} onCancel={onToggle} /> : null}
    </PendingSheetRow>
  );
}
