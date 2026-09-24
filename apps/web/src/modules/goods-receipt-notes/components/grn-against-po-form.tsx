// GRN "Against PO" — the create form behind the 📦 Against PO tab of
// <UnifiedGrnForm>. The purchase order is the single source: pick one and its
// vendor and every line with a balance still to receive are loaded from it;
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

import { type CreateGoodsReceiptNoteInput, poSendsMaterialOut } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { usePurchaseOrder, usePurchaseOrdersList } from '@/modules/purchase-orders/api';

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
  poQty: number;
  receivedSoFar: number;
  balance: number;
  /** Kept as text so a half-typed value never snaps to 0 under the user. */
  receiveNow: string;
  dcRefNo: string;
  remarks: string;
  error: string | null;
}

export interface GrnAgainstPoFormProps {
  initialPurchaseOrderId?: string;
  onSubmit: (values: CreateGoodsReceiptNoteInput) => Promise<void>;
  submitError: string | null;
  onCancel: () => void;
}

/** One line's Receive Now check. Null = fine. */
function lineQtyError(raw: string, balance: number): string | null {
  const t = raw.trim();
  if (t === '') return null; // blank = 0 = skipped on submit
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Whole number only.';
  if (n < 0) return 'Min 0.';
  if (n > balance) return `Cannot exceed balance of ${balance}.`;
  return null;
}

export function GrnAgainstPoForm({
  initialPurchaseOrderId,
  onSubmit,
  submitError,
  onCancel,
}: GrnAgainstPoFormProps): React.JSX.Element {
  const [grnDate, setGrnDate] = useState(todayLocal());
  const [poId, setPoId] = useState<string | null>(initialPurchaseOrderId ?? null);
  const [poSearch, setPoSearch] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      return 'This PO sends material out to the vendor — receive it on the "Against JWPO / DC" tab.';
    }
    if (po.status !== 'open' && po.status !== 'partial') {
      return `This PO is ${po.status.replaceAll('_', ' ')} — only approved (open / partial) POs can be received.`;
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
          const balance = l.qty - l.receivedQty;
          if (balance <= 0) return null;
          return {
            purchaseOrderLineId: l.id,
            lineNo: l.lineNo,
            itemId: l.itemId,
            itemCodeDisplay: l.itemCode ?? l.itemCodeText ?? '',
            itemCodeText: l.itemCodeText ?? '',
            itemRevision: l.itemRevision,
            clientPoLineNo: l.clientPoLineNo,
            itemName: l.itemName,
            poQty: l.qty,
            receivedSoFar: l.receivedQty,
            balance,
            receiveNow: String(balance),
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

  const patchLine = (idx: number, patch: Partial<LineDraft>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    if (!grnDate) {
      setFormError('Date is required.');
      return;
    }
    if (!po) {
      setFormError('Pick a purchase order.');
      return;
    }
    if (poIneligible) {
      setFormError(poIneligible);
      return;
    }
    // Re-check every line and surface the errors inline; refuse if any.
    const checked = lines.map((l) => ({ ...l, error: lineQtyError(l.receiveNow, l.balance) }));
    setLines(checked);
    if (checked.some((l) => l.error !== null)) {
      setFormError('Fix the highlighted quantities.');
      return;
    }
    const toSend = checked.filter((l) => Number(l.receiveNow.trim() || '0') > 0);
    if (toSend.length === 0) {
      setFormError('Enter a Receive Now qty on at least one line.');
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
        ...(l.dcRefNo.trim() ? { dcRefNo: l.dcRefNo.trim() } : {}),
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

  const listLoading = openPos.isFetching || partialPos.isFetching;

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      {/* Header row 1 — GRN Date · Purchase Order (wide) · Vendor (from the PO). */}
      <div className="form-grid-4" style={{ marginBottom: 12 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="grnDate">
            GRN Date<span className="req">★</span>
          </label>
          <input
            id="grnDate"
            type="date"
            className="innovic-input"
            value={grnDate}
            onChange={(e) => setGrnDate(e.target.value)}
            required
          />
        </div>
        <div className="form-grp form-span-2">
          <label className="form-label" htmlFor="purchaseOrderId">
            Purchase Order<span className="req">★</span>
          </label>
          <SearchableSelect
            id="purchaseOrderId"
            value={poId}
            onChange={setPoId}
            options={poOptions}
            onSearch={setPoSearch}
            loading={listLoading}
            placeholder="🔍 Type PO number or vendor…"
            valueLabel={poValueLabel}
            emptyText="No approved purchase POs with pending lines match"
          />
          {poIneligible ? <div className="form-error">{poIneligible}</div> : null}
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="vendor">
            Vendor
          </label>
          <input
            id="vendor"
            className="innovic-input"
            readOnly
            value={vendorLabel}
            placeholder="— from the PO —"
            tabIndex={-1}
          />
        </div>
      </div>

      {/* Header row 2 — Invoice No. · Vendor Challan No. · Remarks (wide). */}
      <div className="form-grid-4" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="invoiceNo">
            Invoice No.
          </label>
          <input
            id="invoiceNo"
            className="innovic-input"
            autoComplete="off"
            placeholder="Vendor invoice"
            value={invoiceNo}
            onChange={(e) => setInvoiceNo(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="dcNo">
            Vendor Challan No.
          </label>
          <input
            id="dcNo"
            className="innovic-input"
            autoComplete="off"
            placeholder="Delivery challan"
            value={dcNo}
            onChange={(e) => setDcNo(e.target.value)}
          />
        </div>
        <div className="form-grp form-span-2">
          <label className="form-label" htmlFor="remarks">
            Remarks
          </label>
          <input
            id="remarks"
            className="innovic-input"
            autoComplete="off"
            placeholder="Notes"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>
      </div>

      <div
        className="form-label"
        style={{ fontSize: 12, marginBottom: 8, textTransform: 'uppercase' }}
      >
        Line items — pending on this PO
      </div>

      {/* Same shape as the SO form's line table: fixed layout, % widths. */}
      <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table className="innovic-table" style={{ width: '100%', tableLayout: 'fixed', minWidth: 960 }}>
          <thead>
            <tr>
              <th style={{ width: '4%' }}>Ln</th>
              {/* POL = the CUSTOMER's own PO line number off the SO line behind
                  this PO line. Widths below still total 100. */}
              <th style={{ width: '5%', color: 'var(--purple)' }}>POL</th>
              <th style={{ width: '14%' }}>Item Code</th>
              <th style={{ width: '17%' }}>Item Name</th>
              <th style={{ width: '7%' }}>PO Qty</th>
              <th style={{ width: '8%' }}>Received so far</th>
              <th style={{ width: '7%' }}>Pending</th>
              <th style={{ width: '10%' }}>
                Receive Now<span className="req">★</span>
              </th>
              <th style={{ width: '12%' }}>DC No.</th>
              <th style={{ width: '12%' }}>Remarks</th>
              <th style={{ width: '4%' }} />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={11} className="empty-state" style={{ padding: 14 }}>
                  {!poId
                    ? 'Pick a purchase order to load its pending lines.'
                    : !po
                      ? 'Loading PO lines…'
                      : 'Every line on this PO is fully received — nothing left to book in.'}
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={l.purchaseOrderLineId}>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                    {idx + 1}
                  </td>
                  {/* POL — the customer's PO line number; '—' when this line has
                      no sales order behind it (a stock buy). */}
                  <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                    {l.clientPoLineNo ?? '—'}
                  </td>
                  <td
                    className="mono fw-700"
                    style={{
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={itemCodeWithRev(l.itemCodeDisplay, l.itemRevision)}
                  >
                    {itemCodeWithRev(l.itemCodeDisplay, l.itemRevision)}
                  </td>
                  <td
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={l.itemName}
                  >
                    {l.itemName}
                  </td>
                  <td className="mono">{l.poQty}</td>
                  <td className="mono">{l.receivedSoFar}</td>
                  <td className="mono fw-700">{l.balance}</td>
                  <td>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={l.balance}
                      step={1}
                      className="innovic-input"
                      style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', padding: '4px 4px' }}
                      value={l.receiveNow}
                      onChange={(e) =>
                        patchLine(idx, {
                          receiveNow: e.target.value,
                          error: lineQtyError(e.target.value, l.balance),
                        })
                      }
                      aria-label={`Receive now, line ${idx + 1}`}
                    />
                    {l.error ? <div className="form-error">{l.error}</div> : null}
                  </td>
                  <td>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      value={l.dcRefNo}
                      onChange={(e) => patchLine(idx, { dcRefNo: e.target.value })}
                      aria-label={`DC ref, line ${idx + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      className="innovic-input"
                      autoComplete="off"
                      value={l.remarks}
                      onChange={(e) => patchLine(idx, { remarks: e.target.value })}
                      aria-label={`Remarks, line ${idx + 1}`}
                    />
                  </td>
                  <td>
                    {/* Removes the line from THIS GRN only; the PO is untouched. */}
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        background: 'transparent',
                        color: 'var(--red)',
                        border: '1px solid var(--red)',
                        padding: '3px 8px',
                      }}
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                      aria-label={`Remove line ${idx + 1}`}
                    >
                      Del
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        {formError || submitError ? (
          <div
            style={{
              color: 'var(--red)',
              background: 'var(--red3)',
              border: '1px solid var(--red)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            {formError ?? submitError}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-success"
            disabled={submitting || poIneligible !== null}
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
            ✓ Create GRN
          </button>
        </div>
      </div>
    </form>
  );
}
