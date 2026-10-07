// The GRN detail page's "Receipt" panel body — the identity line and the
// header grid. Split out of `routes/detail.tsx` (2026-10-06) under CLAUDE.md
// §12's 400-line cap; the route is now the page and its chrome.
//
// The layout is the screen-layout method (same primitive as the Plan screens
// ADR-214 and the Purchase Request screens ADR-213): an identity line saying
// WHICH receipt this is, then named one-line clusters in the order a receipt
// actually happens —
//
//   1 Against       which paper am I receiving against
//   2 Vendor        who delivered it
//   3 Vendor paper  their numbers
//   4 This receipt  how much it settles — the account, ending on `To Receive`
//
// Create GRN and Edit GRN fill the same clusters in the same order, so a clerk
// who has learned one GRN screen has learned all three. What this replaced was
// a legacy `form-grid form-grid-3` — three facts per row, each stacked over two
// lines — which the stylesheet itself marks "LEGACY … un-migrated markup".
//
// Row 4 is present only when the ROUTE hands down an account. This file never
// re-derives that decision; see the note on `account` below.

import type { DocumentEditChange, GoodsReceiptNoteDetail, Vendor } from '@innovic/shared';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { fmtDate } from '@/lib/date';
import { partyAddressLines } from '@/lib/print/company';
import { Cluster, ClusterFact, ClusterGrid, DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { type ReceiptAccount, fmtQty } from './grn-receipt-figures';

/** WHICH receipt this is: its own number, the paper it is against, that paper's
 *  number and the vendor who delivered. Identity, not facts about the GRN, so
 *  it heads the body instead of taking grid cells.
 *
 *  Before this layout the GRN code was an unlabelled 16px cyan title and the
 *  vendor was the panel's title; both are identity, so both moved here and the
 *  panel header now says what the panel is (plus the QC badge). */
export function ReceiptIdent(props: {
  detail: GoodsReceiptNoteDetail;
  /** `GRN Type`, resolved once by the route. Not re-derived here. */
  grnType: string | null;
}): React.JSX.Element {
  const { detail, grnType } = props;
  // The source document, in the order the GRN types are: the NC's own code on a
  // return, else the purchase order, else the challan it came in on.
  const source = detail.ncCode ?? detail.poCode ?? detail.poCodeText ?? detail.dcCode;
  const vendorName = detail.vendorName ?? detail.vendorCodeText;
  return (
    <DocIdent>
      <IdentCode>{detail.code}</IdentCode>
      {grnType ? (
        <>
          <IdentSep />
          <span>{grnType}</span>
        </>
      ) : null}
      {source ? (
        <>
          <IdentSep />
          <IdentCode>{source}</IdentCode>
        </>
      ) : null}
      {vendorName ? (
        <>
          <IdentSep />
          <span>{vendorName}</span>
        </>
      ) : null}
    </DocIdent>
  );
}

export function ReceiptGrid(props: {
  detail: GoodsReceiptNoteDetail;
  vendor: Vendor | null | undefined;
  pendingChanges: readonly DocumentEditChange[];
  /** `GRN Type`, resolved once by the route. Not re-derived here. */
  grnType: string | null;
  /** The receipt account, or null when there is none to state. The ROUTE owns
   *  that decision (Against PO only, and only when every line traces to a PO
   *  line) — this component asks no questions about the GRN's type, it just
   *  renders the fourth row when it is handed one. */
  account: ReceiptAccount | null;
}): React.JSX.Element {
  const { detail, vendor, pendingChanges, grnType, account } = props;
  const vendorAddress = partyAddressLines(vendor);
  const address = vendorAddress.length > 0 ? vendorAddress.join(', ') : null;
  const poNo = detail.poCode ?? detail.poCodeText;
  const vendorName = detail.vendorName ?? detail.vendorCodeText;
  const vendorCode = vendor?.code ?? detail.vendorCode ?? detail.vendorCodeText;
  // Two different numbers. `DC No.` is OUR outward delivery challan (resolved
  // from deliveryChallanId); `Vendor Challan No.` is the number the vendor
  // printed on THEIR paper, which the storekeeper typed. On a GRN raised by
  // receiving our own DC the receive service copies the DC code into `dcNo`, so
  // showing it twice would say the vendor's paper carries our number — hence the
  // "only when it differs" test, kept from the previous layout.
  //
  // `|| pending edit`: a staged change to this field must show its chip even on
  // a GRN that has no vendor challan number yet, or the amber chip — the only
  // sign on the page that an edit is waiting — would be the one thing the empty
  // field hides.
  const showVendorChallan =
    (!!detail.dcNo && detail.dcNo !== detail.dcCode) ||
    !!headerPendingChange(pendingChanges, 'dcNo');
  return (
    <ClusterGrid>
      {/* 1 — which paper am I receiving against. */}
      <Cluster name="Against">
        <ClusterFact label="GRN Type" empty={!grnType} value={grnType ?? '—'} />
        {/* On an NC-return GRN there is no PO: the header's poCodeText holds the
            NC code, so the cell is labelled for what it actually carries. */}
        {detail.ncCode ? (
          <ClusterFact num label="NC No." value={detail.ncCode} />
        ) : (
          <ClusterFact
            num
            label="PO No."
            empty={!poNo}
            value={poNo ?? '—'}
            after={<Chip changes={pendingChanges} field="poNo" />}
          />
        )}
        <ClusterFact
          num
          label="GRN Date"
          value={fmtDate(detail.grnDate)}
          after={<Chip changes={pendingChanges} field="grnDate" />}
        />
        {/* Our own outward DC, shown as `—` on a GRN that came off no challan:
            "this receipt has no DC behind it" is a fact worth reading, and the
            row stays four cells wide whichever GRN you open. */}
        <ClusterFact num label="DC No." empty={!detail.dcCode} value={detail.dcCode ?? '—'} />
      </Cluster>

      {/* 2 — who delivered it. */}
      <Cluster name="Vendor">
        <ClusterFact
          label="Vendor"
          empty={!vendorName}
          title={vendorName ?? undefined}
          value={vendorName ?? '—'}
          after={<Chip changes={pendingChanges} field="vendor" />}
        />
        <ClusterFact num label="Vendor Code" empty={!vendorCode} value={vendorCode ?? '—'} />
        <ClusterFact span={2} wrap label="Vendor Address" empty={!address} value={address ?? '—'} />
      </Cluster>

      {/* 3 — their paperwork. */}
      <Cluster name="Vendor paper">
        <ClusterFact
          num
          label="Vendor Invoice No."
          empty={!detail.invoiceNo}
          value={detail.invoiceNo ?? '—'}
          after={<Chip changes={pendingChanges} field="invoiceNo" />}
        />
        {showVendorChallan ? (
          <ClusterFact
            num
            label="Vendor Challan No."
            empty={!detail.dcNo}
            value={detail.dcNo ?? '—'}
            after={<Chip changes={pendingChanges} field="dcNo" />}
          />
        ) : null}
        {/* The GRN's own note. The LINE's note is `Remarks`, behind its ▸. The
            remarks cell takes whatever the row has left, so the row is full
            with and without the vendor's challan number. */}
        <ClusterFact
          span={showVendorChallan ? 2 : 3}
          wrap
          label="GRN Remarks"
          empty={!detail.remarks}
          value={detail.remarks ?? '—'}
          after={<Chip changes={pendingChanges} field="remarks" />}
        />
      </Cluster>

      {/* 4 — how much this receipt settles. An account: it reads left to right
          and ends on the result, which carries the green rule. The result is
          `To Receive` — what these PO lines still have to ARRIVE, the same
          word the GRN create screen uses. It was `Pending` until the PO screens
          re-based their own `Pending` onto QC-accepted qty (PO Qty − Accepted):
          two different facts cannot share one name, so the receivable one took
          its own. (`Balance` stays banned: NAMING.md, owner decision
          2026-10-06.)

          The row is DROPPED, not dashed, when the route hands down no account —
          on an Against JW PO / DC or Against NC receipt the figure the clerk
          typed against is the challan's `Sent Qty`, which the GRN detail
          response does not carry, so there is nothing truthful to put in these
          four cells. Four dashes would be a row of four empty cells pretending
          to be an account; those two types get three rows and every row stays
          full. */}
      {account ? (
        <Cluster name="This receipt">
          <ClusterFact num label="PO Qty" value={fmtQty(account.poQty)} />
          <ClusterFact
            num
            label="Received Earlier"
            title="Received against the same PO lines by other GRNs"
            value={fmtQty(account.earlier)}
          />
          <ClusterFact num label="Received" value={fmtQty(account.received)} />
          <ClusterFact
            num
            lead
            label="To Receive"
            title="PO Qty − Received Earlier − Received"
            value={fmtQty(account.pending)}
          />
        </Cluster>
      ) : null}
    </ClusterGrid>
  );
}

/** ADR-202 — the amber "→ after" chip beside a header fact whose edit is
 *  staged. It goes through `ClusterFact`'s `after`, never inside the value: the
 *  value is one clipped line, so a chip in there is the first thing an ellipsis
 *  eats. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}
