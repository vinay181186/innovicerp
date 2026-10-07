// GRN "Against PO" — the create form behind the 📦 Against PO tab of
// <UnifiedGrnForm>. The purchase order is the single source: pick one and its
// vendor and every line with a qty still To Receive are loaded from it;
// change or clear the PO and everything below it is thrown away and reloaded.
// No free-text PO ref, no vendor fallback, no manual item entry, no QC fields
// — QC happens later at Incoming QC. No GRN No. box either: the server
// auto-numbers (nextGrnCode) when `header.code` is omitted, and the number is
// shown on the GRN list and detail.
//
// Eligible POs: approved (`open` / `partial`) and buying goods in
// (`!poSendsMaterialOut`). Job-work / service POs come back through a delivery
// challan on the other tab. The server enforces the same rules; this form just
// stops the user reaching the 4xx.
//
// The old <GoodsReceiptNoteForm> keeps serving /goods-receipt-notes/$id/edit;
// its create mode is no longer reached.

import { type CreateGoodsReceiptNoteInput, poSendsMaterialOut, roundQty } from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayIst } from '@/lib/date';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';
import { poStatusLabel } from '@/modules/purchase-orders/lib/po-labels';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterGrid, FormField } from '@/ui/forms';
import { GRN_CREATE_FORM_ID, type GrnTypeFormShellProps } from './grn-create-contract';
import { GrnLinesTable, GrnReceiptAccount } from './grn-lines-table';
import { GrnVendorCluster } from './grn-vendor-cluster';
import { type GrnLineRow, grnReceivedError, grnReceiptTotals } from './grn-receipt-figures';

interface LineDraft {
  purchaseOrderLineId: string;
  lineNo: number;
  itemId: string | null;
  /** What the row shows: live master code when linked, else the PO's snapshot. */
  itemCodeDisplay: string;
  /** The PO line's snapshot text — the ref sent when the line has no itemId. */
  itemCodeText: string;
  itemRevision: string | null;
  /** The CUSTOMER's PO line number off the SO line behind this PO line. */
  clientPoLineNo: string | null;
  itemName: string;
  /** The item's unit (items.uom, off the PO detail), shown beside the qty. */
  uom: string | null;
  poQty: number;
  receivedSoFar: number;
  pending: number;
  /** Kept as text so a half-typed value never snaps to 0 under the user. */
  receiveNow: string;
  dcRefNo: string;
  remarks: string;
  error: string | null;
}

export interface GrnAgainstPoFormProps extends GrnTypeFormShellProps {
  initialPurchaseOrderId?: string;
  onSubmit: (values: CreateGoodsReceiptNoteInput) => Promise<void>;
  submitError: string | null;
}

export function GrnAgainstPoForm({
  initialPurchaseOrderId,
  onSubmit,
  submitError,
  typeField,
  onStatusChange,
}: GrnAgainstPoFormProps): React.JSX.Element {
  const [grnDate, setGrnDate] = useState(todayIst());
  const [poId, setPoId] = useState<string | null>(initialPurchaseOrderId ?? null);
  const [poSearch, setPoSearch] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Any hand edit to the loaded lines — only feeds the "Not saved" pill.
  const [linesTouched, setLinesTouched] = useState(false);

  // Eligible POs. The list API takes ONE status per call, so approved =
  // open + partial is two calls merged (same shape jw-dc/routes/list.tsx uses
  // for two poTypes). Material-out POs are dropped after the merge.
  const term = poSearch.trim();
  const openPos = usePurchaseOrdersList({
    status: 'open',
    ...(term ? { search: term } : {}),
    limit: 100,
    offset: 0,
  });
  const partialPos = usePurchaseOrdersList({
    status: 'partial',
    ...(term ? { search: term } : {}),
    limit: 100,
    offset: 0,
  });
  const poOptions = useMemo(() => {
    const merged = [...(openPos.data?.items ?? []), ...(partialPos.data?.items ?? [])];
    return merged
      .filter((p) => !poSendsMaterialOut(p.poType))
      .map((p) => ({ id: p.id, code: p.code, name: p.vendorName ?? p.vendorCodeText ?? '—' }));
  }, [openPos.data, partialPos.data]);

  const { data: poData } = usePurchaseOrder(poId ?? undefined);
  // The detail may still be the PREVIOUS PO's for a render while the new one
  // loads (or a stale cache hit); only trust it when the ids agree. `po` is
  // undefined otherwise, so every use below narrows on it directly.
  const po = poId !== null && poData !== undefined && poData.id === poId ? poData : undefined;

  // Why the preselected / picked PO cannot be received against, if it cannot.
  // Mirrors the server guards so the message appears before Save, not after.
  const poIneligible = useMemo((): string | null => {
    if (!po) return null;
    if (poSendsMaterialOut(po.poType)) {
      return 'This is a Job Work PO. Choose GRN Type "Against JW PO / DC".';
    }
    if (po.status !== 'open' && po.status !== 'partial') {
      return `This PO is ${poStatusLabel(po.status)} — only approved (Open / Partly Received) POs can be received.`;
    }
    return null;
  }, [po]);

  // DEPENDENT-FIELD RULE: whenever the PO changes or is cleared, every line is
  // replaced from the newly selected PO (or emptied). No "pristine" guard — the
  // old form only filled lines once, so changing the PO left the previous PO's
  // items on screen. Vendor is derived from `po` below, so it resets for free.
  useEffect(() => {
    setFormError(null);
    if (!po) {
      setLines([]);
      return;
    }
    setLines(
      po.lines
        .map((l): LineDraft | null => {
          const pending = roundQty(l.qty - l.receivedQty);
          if (pending <= 0) return null;
          return {
            purchaseOrderLineId: l.id,
            lineNo: l.lineNo,
            itemId: l.itemId,
            itemCodeDisplay: l.itemCode ?? l.itemCodeText ?? '',
            itemCodeText: l.itemCodeText ?? '',
            itemRevision: l.itemRevision,
            clientPoLineNo: l.clientPoLineNo,
            itemName: l.itemName,
            uom: l.uom,
            poQty: l.qty,
            receivedSoFar: l.receivedQty,
            pending,
            receiveNow: String(pending),
            dcRefNo: '',
            remarks: '',
            error: null,
          };
        })
        .filter((l): l is LineDraft => l !== null),
    );
  }, [po]);

  const vendorLabel = po ? (po.vendorName ?? po.vendorCodeText ?? '') : '';

  // Label for the picked PO — from the option list when it is there, else from
  // the detail (a `?poId=` preselect may sit outside the first search page).
  const poValueLabel = useMemo(() => {
    if (!poId) return undefined;
    const opt = poOptions.find((o) => o.id === poId);
    if (opt) return `${opt.code} — ${opt.name}`;
    if (po) return `${po.code} — ${po.vendorName ?? po.vendorCodeText ?? '—'}`;
    return undefined;
  }, [poId, poOptions, po]);

  // The shared check, with this line's own cap and unit. Passing the UOM is new:
  // the PO line has always carried it, so a NOS / SET item is now refused a
  // fraction here instead of only by the server.
  const lineError = (l: LineDraft): string | null =>
    grnReceivedError(l.receiveNow, { uom: l.uom, cap: l.pending });

  const patchLine = (idx: number, patch: Partial<LineDraft>): void => {
    setLinesTouched(true);
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    if (!grnDate) {
      setFormError('GRN Date is required.');
      return;
    }
    if (!po) {
      setFormError('Purchase Order is required.');
      return;
    }
    if (poIneligible) {
      setFormError(poIneligible);
      return;
    }
    // Re-check every line and surface the errors inline; refuse if any.
    const checked = lines.map((l) => ({ ...l, error: lineError(l) }));
    setLines(checked);
    if (checked.some((l) => l.error !== null)) {
      setFormError('Fix the highlighted quantities.');
      return;
    }
    const toSend = checked.filter((l) => Number(l.receiveNow.trim() || '0') > 0);
    if (toSend.length === 0) {
      setFormError('Enter a Received qty on at least one line.');
      return;
    }

    const payload: CreateGoodsReceiptNoteInput = {
      header: {
        grnDate,
        purchaseOrderId: po.id,
        poCodeText: po.code,
        ...(po.vendorId ? { vendorId: po.vendorId } : {}),
        ...(po.vendorCodeText ? { vendorCodeText: po.vendorCodeText } : {}),
        ...(dcNo.trim() ? { dcNo: dcNo.trim() } : {}),
        ...(invoiceNo.trim() ? { invoiceNo: invoiceNo.trim() } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      },
      lines: toSend.map((l) => ({
        purchaseOrderLineId: l.purchaseOrderLineId,
        // Master-linked line → send the id; the server resolves the code.
        // Free-text PO line → send the snapshot text (per ADR-012 #10).
        ...(l.itemId ? { itemId: l.itemId } : { itemCodeText: l.itemCodeText.trim() }),
        itemName: l.itemName.trim(),
        receivedQty: Number(l.receiveNow.trim()),
        // QC is decided later in Incoming QC; the line is booked as pending.
        // Spelled out because the shared line type makes the defaults required.
        qcStatus: 'pending' as const,
        qcAcceptedQty: 0,
        qcRejectedQty: 0,
        // A line with no Vendor Challan No. of its own takes the header's.
        ...(l.dcRefNo.trim() || dcNo.trim() ? { dcRefNo: l.dcRefNo.trim() || dcNo.trim() } : {}),
        ...(l.remarks.trim() ? { remarks: l.remarks.trim() } : {}),
      })),
    };

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  };

  // ONE row list, read by the lines table AND by the header's account, so the
  // header figure and the table's totals row can never disagree.
  const rows: GrnLineRow[] = lines.map((l) => ({
    key: l.purchaseOrderLineId,
    clientPoLineNo: l.clientPoLineNo,
    itemCode: l.itemCodeDisplay,
    itemRevision: l.itemRevision,
    itemName: l.itemName,
    uom: l.uom,
    qty: l.poQty,
    receivedEarlier: l.receivedSoFar,
    pendingQty: l.pending,
    receiveNow: l.receiveNow,
    dcRefNo: l.dcRefNo,
    remarks: l.remarks,
    error: l.error,
  }));

  // The header's account, from the same rows and the same `accountOf` the table
  // foots and the view page reads — one rule, one rounding, one answer.
  const { account } = grnReceiptTotals(rows);

  const listLoading = openPos.isFetching || partialPos.isFetching;

  // Report to the shell so its header Save / "Not saved" pill stay truthful.
  const dirty =
    poId !== (initialPurchaseOrderId ?? null) ||
    invoiceNo !== '' ||
    dcNo !== '' ||
    remarks !== '' ||
    linesTouched;
  const blocked = poIneligible !== null;
  useEffect(() => {
    onStatusChange({ submitting, blocked, dirty });
  }, [onStatusChange, submitting, blocked, dirty]);

  const errorText = formError ?? submitError;

  return (
    <form id={GRN_CREATE_FORM_ID} onSubmit={(e) => void handleSubmit(e)}>
      {/* Validation summary right under the header, where Save is. */}
      {errorText ? (
        <Banner tone="error" role="alert">
          {errorText}
        </Banner>
      ) : null}

      {/* The receipt, in the order it happens: which paper am I receiving
          against → who delivered it → their paperwork → how much this receipt
          settles. Four rows of four, every row full, cluster names in the left
          gutter. Create and Edit share this grid and this sequence; only the
          controls differ (owner's layout method, rules 1-8). */}
      <Panel title="Receipt">
        <ClusterGrid>
          <Cluster name="Against">
            {typeField}
            <FormField
              label="PO No."
              required
              htmlFor="purchaseOrderId"
              className="cl-span-2"
              {...(poIneligible
                ? { error: poIneligible }
                : { help: 'Open and partly-received buying POs only' })}
            >
              <SearchableSelect
                id="purchaseOrderId"
                value={poId}
                onChange={setPoId}
                options={poOptions}
                onSearch={setPoSearch}
                loading={listLoading}
                placeholder="🔍 Type PO number or vendor…"
                valueLabel={poValueLabel}
                emptyText="No open POs with pending qty."
              />
            </FormField>
            <FormField label="GRN Date" required htmlFor="grnDate">
              <input
                id="grnDate"
                type="date"
                className="innovic-input"
                value={grnDate}
                onChange={(e) => setGrnDate(e.target.value)}
                required
              />
            </FormField>
          </Cluster>

          {/* All three come from the PO / the vendor master, so all three are
              one-line FACTS — not read-only boxes the user tries to type in. */}
          <GrnVendorCluster
            vendorId={po?.vendorId}
            vendorLabel={vendorLabel}
            vendorFrom={'— from the PO —'}
            codeFallback={po?.vendorCodeText ?? ''}
          />

          <Cluster name="Vendor paper">
            <FormField label="Vendor Invoice No." htmlFor="invoiceNo">
              <input
                id="invoiceNo"
                className="innovic-input"
                autoComplete="off"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
              />
            </FormField>
            <FormField label="Vendor Challan No." htmlFor="dcNo">
              <input
                id="dcNo"
                className="innovic-input"
                autoComplete="off"
                value={dcNo}
                onChange={(e) => setDcNo(e.target.value)}
              />
            </FormField>
            {/* The DOCUMENT's note. The line's own is `Remarks`, behind ▸ More. */}
            <FormField label="GRN Remarks" htmlFor="remarks" className="cl-span-2">
              <input
                id="remarks"
                className="innovic-input"
                autoComplete="off"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </FormField>
          </Cluster>

          {/* THE ACCOUNT — recomputed from the live rows on every keystroke.
              Null only if a row had no PO line behind it, which cannot happen
              here: every row IS a PO line. */}
          {account ? <GrnReceiptAccount account={account} qtyLabel="PO Qty" /> : null}
        </ClusterGrid>
      </Panel>

      <Panel title={`Line Items (${rows.length})`} bodyPadding="none">
        <GrnLinesTable
          rows={rows}
          decimal
          qtyLabel="PO Qty"
          showAccount
          challan={{
            headerValue: dcNo.trim(),
            onChange: (idx, v) => patchLine(idx, { dcRefNo: v }),
          }}
          emptyText={
            !poId
              ? 'Select a purchase order'
              : !po
                ? 'Loading PO lines…'
                : 'Every line on this PO is fully received.'
          }
          onReceiveNow={(idx, v) => {
            const l = lines[idx];
            if (l) patchLine(idx, { receiveNow: v, error: lineError({ ...l, receiveNow: v }) });
          }}
          onRemarks={(idx, v) => patchLine(idx, { remarks: v })}
          onRemove={(idx) => {
            setLinesTouched(true);
            setLines((prev) => prev.filter((_, i) => i !== idx));
          }}
        />
      </Panel>
    </form>
  );
}
