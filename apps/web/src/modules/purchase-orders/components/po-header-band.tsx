// PO detail header facts — the one shared detail layout, `<ClusterGrid stack>`:
// label above value, named clusters in the order a PO is read — who it is with,
// which order it is, how much has come in, what it is worth (ending on Total,
// the row's result), and who signed it off.
//
// Owner 2026-11-04: this replaced a hand-made four-column band (SUPPLIER | ORDER
// REFERENCES | TOTALS | TAX & APPROVAL). PRESENTATION ONLY — same facts, same
// values, same sources, same price gate; nothing is computed or fetched
// differently here. A fact that used to vanish when blank now shows `—`.

import type { DocumentEditChange, PurchaseOrderDetail, Vendor } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import {
  gstTaxRows,
  signedRoundOff,
  taxTypeLabel as gstTaxTypeLabel,
} from '@/modules/sales-orders/lib/gst-rows';
import { Cluster, ClusterFact, ClusterGrid } from '@/ui/forms';
import { PO_TYPE_LABELS, taxTypeLabel } from '../lib/po-labels';

export function PoHeaderBand({
  detail,
  vendor,
  totalQty,
  grnReceivedQty,
  qcAcceptedQty,
  pendingChanges = [],
}: {
  detail: PurchaseOrderDetail;
  vendor: Vendor | null | undefined;
  totalQty: number;
  /** ADR-222 — Σ of the lines' GRN-booked qty. The honest receipt total, which
   *  MAY exceed Total Qty when a rejected piece was returned and replaced. */
  grnReceivedQty: number;
  /** Σ of the lines' QC-passed qty — Pending is measured off this. */
  qcAcceptedQty: number;
  /** ADR-202 — staged header changes awaiting approval, for the inline chips. */
  pendingChanges?: readonly DocumentEditChange[];
}): React.JSX.Element {
  // The PO edit diff emits these field keys (purchase-orders/service.ts).
  const chip = (field: string): React.JSX.Element | null => {
    const c = headerPendingChange(pendingChanges, field);
    return c ? <PendingChangeChip after={c.after} /> : null;
  };
  // Full address incl. pincode (A38 / A39) — street, city, state, pincode.
  const address = [vendor?.addressLine1, vendor?.city, vendor?.state, vendor?.pincode]
    .filter(Boolean)
    .join(', ');
  const vendorCode = detail.vendorCode ?? detail.vendorCodeText;
  const vendorName = detail.vendorName ?? detail.vendorCodeText;
  const rejected = Boolean(detail.rejectedAt ?? detail.rejectedBy ?? detail.rejectionReason);
  // Money is dropped entirely for viewers who may not see prices — the API
  // returns null for these amounts.
  const moneyShown = detail.totalAmount != null;
  // ADR-246 — the server's money roll-up (CGST + SGST or IGST from ONE GST %,
  // Round-off, rounded total). The server sends it on the detail read AND on
  // the create / update / approve responses. It is null for an old PO whose
  // stored percentages are mixed (and when prices are hidden) — then the
  // stored Tax / Total rows show exactly as before.
  const totals = detail.totals ?? null;
  const gstPercent =
    totals?.gstPercent ??
    Math.round(
      (Number(detail.sgstPct ?? 0) + Number(detail.cgstPct ?? 0) + Number(detail.igstPct ?? 0)) *
        100,
    ) / 100;
  const taxRows: { label: string; value: string }[] = totals
    ? [
        ...gstTaxRows(totals).map((r) => ({ label: r.label, value: `₹${r.amount.toFixed(2)}` })),
        { label: 'Round-off', value: signedRoundOff(totals.roundOff) },
      ]
    : [{ label: 'Tax', value: `₹${(detail.taxAmount ?? 0).toFixed(2)}` }];
  // Subtotal + tax rows + Total comes to 3, 4 or 5 facts. Four fill the row; three
  // let Total take the spare cell; five need a `wide` row, Total alone on the
  // second line below the 8-across width.
  const moneyFacts = taxRows.length + 2;
  const totalSpan = moneyFacts === 3 ? 2 : moneyFacts === 5 ? 4 : 1;

  return (
    <div className="panel-body">
      <ClusterGrid stack>
        <Cluster name="Vendor">
          <ClusterFact
            num
            label="Vendor Code"
            empty={!vendorCode}
            value={vendorCode ? <span style={{ color: 'var(--purple)' }}>{vendorCode}</span> : '—'}
          />
          <ClusterFact
            label="Vendor"
            empty={!vendorName}
            title={vendorName ?? undefined}
            value={vendorName ?? '—'}
            after={chip('vendorId')}
          />
          <ClusterFact
            num
            label="GSTIN"
            empty={!vendor?.gstNumber}
            value={vendor?.gstNumber ?? '—'}
          />
          <ClusterFact
            label="Contact"
            empty={!vendor?.contactPerson}
            title={vendor?.contactPerson ?? undefined}
            value={vendor?.contactPerson ?? '—'}
          />
        </Cluster>
        <Cluster name={null}>
          <ClusterFact
            span={4}
            wrap
            label="Vendor Address"
            empty={!address}
            value={address || '—'}
          />
        </Cluster>

        {/* Eight facts, or seven with GST % hidden — then SO No. takes its room. */}
        <Cluster name="Order" wide>
          <ClusterFact
            num
            label="PO No."
            value={<span style={{ color: 'var(--blue)' }}>{detail.code}</span>}
          />
          <ClusterFact
            label="PO Type"
            value={PO_TYPE_LABELS[detail.poType]}
            after={chip('poType')}
          />
          <ClusterFact num label="PO Date" value={fmtDate(detail.poDate)} after={chip('poDate')} />
          <ClusterFact
            num
            label="Due Date"
            empty={!detail.dueDate}
            value={fmtDate(detail.dueDate)}
            after={chip('dueDate')}
          />
          <ClusterFact
            num
            label="PR No."
            empty={!detail.prCodeText}
            value={
              detail.prCodeText ? (
                <span style={{ color: 'var(--blue)' }}>{detail.prCodeText}</span>
              ) : (
                '—'
              )
            }
            after={chip('prCodeText')}
          />
          {/* The customer order this PO ultimately serves, resolved through the
              PO lines' source SO line. Planning stamps it on every line of a PO
              raised off a Job Card; a hand-raised PO has no order behind it. */}
          <ClusterFact
            num
            span={moneyShown ? 1 : 2}
            label="SO No."
            empty={!detail.soCode}
            value={
              detail.soCode ? (
                <span style={{ color: 'var(--blue)' }}>
                  {soNoWithInternal(detail.soCode, detail.soInternalNo)}
                  {detail.soLineNo ? <span className="text3"> · Ln {detail.soLineNo}</span> : null}
                </span>
              ) : (
                '—'
              )
            }
          />
          {/* ADR-246 — ONE GST %; the Tax Type is the server's, from the
              vendor's State (null with totals = State unknown → CGST + SGST). */}
          {moneyShown ? <ClusterFact num label="GST %" value={`${gstPercent}%`} /> : null}
          <ClusterFact
            label="Tax Type"
            value={totals ? gstTaxTypeLabel(totals.taxType) : taxTypeLabel(detail.taxType)}
          />
        </Cluster>

        <Cluster name="Quantity">
          <ClusterFact num label="Lines" value={detail.lines.length} />
          <ClusterFact num label="Total Qty" value={totalQty} />
          <ClusterFact
            num
            label="GRN Received"
            value={<span style={{ color: 'var(--green2)' }}>{grnReceivedQty}</span>}
          />
          {/* Accepted = the pieces that passed QC. Pending reads off this. */}
          <ClusterFact
            num
            label="Accepted"
            value={<span style={{ color: 'var(--green2)' }}>{qcAcceptedQty}</span>}
          />
        </Cluster>

        {moneyShown ? (
          <Cluster name="Amount" wide={moneyFacts === 5}>
            <ClusterFact num label="Subtotal" value={`₹${(detail.subtotal ?? 0).toFixed(2)}`} />
            {taxRows.map((r) => (
              <ClusterFact key={r.label} num label={r.label} value={r.value} />
            ))}
            <ClusterFact
              num
              lead
              span={totalSpan}
              label="Total"
              value={`₹${(totals?.grandTotal ?? detail.totalAmount ?? 0).toFixed(2)}`}
            />
          </Cluster>
        ) : null}

        <Cluster name="Approval">
          <ClusterFact
            num
            label="Approved At"
            empty={!detail.approvedAt}
            value={fmtDateTime(detail.approvedAt)}
          />
          <ClusterFact
            wrap
            label="Approval Remarks"
            empty={!detail.approvalRemarks}
            value={detail.approvalRemarks ?? '—'}
            after={chip('approvalRemarks')}
          />
          <ClusterFact
            span={2}
            wrap
            label="Remarks"
            empty={!detail.remarks}
            value={detail.remarks ?? '—'}
            after={chip('remarks')}
          />
        </Cluster>
        {rejected ? (
          <Cluster name={null}>
            <ClusterFact
              num
              label="Rejected At"
              value={<span style={{ color: 'var(--red2)' }}>{fmtDateTime(detail.rejectedAt)}</span>}
            />
            <ClusterFact
              span={3}
              wrap
              label="Rejection Reason"
              empty={!detail.rejectionReason}
              value={
                detail.rejectionReason ? (
                  <span style={{ color: 'var(--red2)' }}>{detail.rejectionReason}</span>
                ) : (
                  '—'
                )
              }
            />
          </Cluster>
        ) : null}
      </ClusterGrid>
    </div>
  );
}
