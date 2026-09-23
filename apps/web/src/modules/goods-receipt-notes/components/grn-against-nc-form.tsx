// GRN "Against NC" — the nc_return type of <UnifiedGrnForm>.
//
// Chain (ADR-161): an NC disposed "return to vendor" gets exactly ONE
// return-to-vendor challan raised from the NC page (delivery_challans.nc_id
// set, no purchase order behind it, one line for the rejected qty). The pieces
// come back ONLY through POST /delivery-challans/:id/receive — the server then
// raises the GRN with nc_id, bumps the NC's rtv_received_qty, sets the NC to
// received_qc_pending, and Incoming QC later credits the NC and re-injects the
// pieces into the job-card operation.
//
// So "Against NC" = pick the NC → its return challan is the source → the SAME
// receive call the Against JWPO / DC type makes. This file is that form with
// the NC picker in front and no PO anywhere. An NC is eligible while its
// return challan is still `issued` with a balance to receive.
//
// No OK / Rejected split and no QC fields here: everything received lands on
// the auto-GRN as pending and the accept/reject decision is made at Incoming QC.

import type { CreateDeliveryChallanReceiptInput } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import {
  useDeliveryChallan,
  useDeliveryChallansList,
  useReceiveDeliveryChallan,
} from '@/modules/delivery-challans/api';
import { computeReceivedByLine } from '@/modules/delivery-challans/lib/receipt-math';
import { goodsReceiptNotesKeys } from '../api';

interface LineDraft {
  deliveryChallanLineId: string;
  lineNo: number;
  itemCode: string;
  itemRevision: string | null;
  /** The CUSTOMER's PO line number off the SO line behind this challan line. */
  clientPoLineNo: string | null;
  itemName: string;
  sentQty: number;
  receivedSoFar: number;
  balance: number;
  /** Kept as text so a half-typed value never snaps to 0 under the user. */
  receiveNow: string;
  remarks: string;
  error: string | null;
}

export interface GrnAgainstNcFormProps {
  /** The parent screen's exit-guard `leave`: runs the post-save navigation
   *  without the "Are you sure you want to exit?" question. The guard itself
   *  lives in <UnifiedGrnForm>, which owns this form — one screen, one guard. */
  onLeave: (go: () => void) => void;
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

export function GrnAgainstNcForm({ onLeave, onCancel }: GrnAgainstNcFormProps): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const receive = useReceiveDeliveryChallan();

  const [ncId, setNcId] = useState<string | null>(null);
  const [ncSearch, setNcSearch] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayLocal());
  const [vendorInvoiceText, setVendorInvoiceText] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The same query the DC form uses — every challan still awaiting receipt —
  // but keeping ONLY the return-to-vendor rows (ncId set). One challan per NC
  // by rule, so each such row IS one eligible NC. 200 is the API's max page
  // and is far above the number of issued-but-unreceived challans at any time.
  const dcList = useDeliveryChallansList({ status: 'issued', limit: 200, offset: 0 });
  const ncRows = useMemo(
    () => (dcList.data?.items ?? []).filter((d) => d.ncId !== null),
    [dcList.data],
  );

  // Option per NC. Search is client-side over the NC code, the job card, the
  // vendor and the composed "CODE — JC · Vendor" label — the last because the
  // picker re-sends its own selected label as the term when reopened.
  const ncOptions = useMemo(
    () =>
      ncRows
        .map((d) => ({
          id: d.ncId ?? d.id,
          code: d.ncCode ?? d.poCodeText,
          name: `${d.jobCardCode ?? '—'} · ${d.vendorName ?? d.vendorCodeText}`,
        }))
        .filter((o) => matchesSearchTerm([o.code, o.name, `${o.code} — ${o.name}`], ncSearch)),
    [ncRows, ncSearch],
  );

  // The picked NC's return challan row (from the list) — the source of the
  // job card, challan code and vendor shown in the header, and of `dcId`.
  const ncRow = useMemo(
    () => (ncId ? ncRows.find((d) => d.ncId === ncId) : undefined),
    [ncId, ncRows],
  );
  const dcId = ncRow?.id ?? null;

  const { data: dcData } = useDeliveryChallan(dcId ?? undefined);
  // Only trust the detail when it is the picked challan's (not the previous
  // one's, still cached, for the render before the new one loads). `dc` is
  // undefined otherwise, so every use below narrows on it directly.
  const dc = dcId !== null && dcData !== undefined && dcData.id === dcId ? dcData : undefined;

  // DEPENDENT-FIELD RULE (NC → challan → lines): pick / change / clear the NC
  // and the lines are rebuilt from its return challan or emptied. Job card,
  // challan code and vendor are derived from `ncRow` / `dc` below, so they
  // reset for free.
  useEffect(() => {
    setFormError(null);
    setSubmitError(null);
    if (!dc) {
      setLines([]);
      return;
    }
    const already = computeReceivedByLine(dc);
    setLines(
      dc.lines
        .map((l): LineDraft | null => {
          const sent = Number(l.qty);
          const got = already.get(l.id) ?? 0;
          const balance = sent - got;
          if (balance <= 0) return null;
          return {
            deliveryChallanLineId: l.id,
            lineNo: l.lineNo,
            itemCode: l.itemCode ?? l.itemCodeText,
            itemRevision: l.itemRevision,
            clientPoLineNo: l.clientPoLineNo,
            itemName: l.itemName ?? l.itemNameText ?? '',
            sentQty: sent,
            receivedSoFar: got,
            balance,
            receiveNow: String(balance),
            remarks: '',
            error: null,
          };
        })
        .filter((l): l is LineDraft => l !== null),
    );
  }, [dc]);

  const onNcChange = (id: string | null): void => {
    setNcId(id);
    setFormError(null);
    setSubmitError(null);
  };

  const vendorLabel = dc
    ? (dc.vendorName ?? dc.vendorCodeText)
    : ncRow
      ? (ncRow.vendorName ?? ncRow.vendorCodeText)
      : '';

  const patchLine = (idx: number, patch: Partial<LineDraft>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setSubmitError(null);
    if (!ncId) {
      setFormError('Pick an NC.');
      return;
    }
    if (!dc) {
      setFormError('The return challan for this NC is still loading — try again in a moment.');
      return;
    }
    if (!receiptDate) {
      setFormError('Receipt date is required.');
      return;
    }
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

    const input: CreateDeliveryChallanReceiptInput = {
      receiptDate,
      vendorInvoiceText: vendorInvoiceText.trim() === '' ? null : vendorInvoiceText.trim(),
      remarks: remarks.trim() === '' ? null : remarks.trim(),
      lines: toSend.map((l) => ({
        deliveryChallanLineId: l.deliveryChallanLineId,
        receivedQty: Number(l.receiveNow.trim()),
        ...(l.remarks.trim() ? { remarks: l.remarks.trim() } : {}),
      })),
    };

    setSubmitting(true);
    try {
      const res = await receive.mutateAsync({ dcId: dc.id, input });
      // The DC hook refreshes only DC caches; the GRN list must be refreshed
      // here. (No PO to refresh — an NC return challan has none.)
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      const grnId = res.autoGrn?.id ?? null;
      onLeave(() =>
        grnId
          ? void navigate({ to: '/goods-receipt-notes/$id', params: { id: grnId }, replace: true })
          : void navigate({ to: '/goods-receipt-notes', replace: true }),
      );
    } catch (err) {
      // 403 (no OSP DC entry right) and 409 (over-receive) arrive here verbatim.
      setSubmitError(err instanceof Error ? err.message : 'Failed to create GRN.');
    } finally {
      setSubmitting(false);
    }
  };

  const ncValueLabel = useMemo(() => {
    if (!ncId) return undefined;
    const o = ncOptions.find((x) => x.id === ncId);
    return o ? `${o.code} — ${o.name}` : undefined;
  }, [ncId, ncOptions]);

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      {/* Header row 1 — NC No. · Job Card · Return Challan · Vendor (all from the NC's challan). */}
      <div className="form-grid-4" style={{ marginBottom: 12 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="ncId">
            NC No.<span className="req">★</span>
          </label>
          <SearchableSelect
            id="ncId"
            value={ncId}
            onChange={onNcChange}
            options={ncOptions}
            onSearch={setNcSearch}
            loading={dcList.isFetching}
            placeholder="🔍 Type NC number, job card or vendor…"
            valueLabel={ncValueLabel}
            emptyText="No NC has a return challan awaiting receipt"
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ncJobCard">
            Job Card
          </label>
          <input
            id="ncJobCard"
            className="innovic-input"
            readOnly
            value={ncRow?.jobCardCode ?? ''}
            placeholder="— from the NC —"
            tabIndex={-1}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ncReturnChallan">
            Return Challan
          </label>
          <input
            id="ncReturnChallan"
            className="innovic-input"
            readOnly
            value={ncRow?.code ?? ''}
            placeholder="— from the NC —"
            tabIndex={-1}
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ncVendor">
            Vendor
          </label>
          <input
            id="ncVendor"
            className="innovic-input"
            readOnly
            value={vendorLabel}
            placeholder="— from the NC —"
            tabIndex={-1}
          />
        </div>
      </div>
      {ncRow?.reason ? (
        <div className="text3" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          Return reason: {ncRow.reason}
        </div>
      ) : null}

      {/* Header row 2 — Receipt Date · Vendor Invoice No. · Remarks (wide). */}
      <div className="form-grid-4" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="ncReceiptDate">
            Receipt Date<span className="req">★</span>
          </label>
          <input
            id="ncReceiptDate"
            type="date"
            className="innovic-input"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            required
          />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="ncVendorInvoice">
            Vendor Invoice No.
          </label>
          <input
            id="ncVendorInvoice"
            className="innovic-input"
            autoComplete="off"
            placeholder="optional"
            value={vendorInvoiceText}
            onChange={(e) => setVendorInvoiceText(e.target.value)}
          />
        </div>
        <div className="form-grp form-span-2">
          <label className="form-label" htmlFor="ncRemarks">
            Remarks
          </label>
          <input
            id="ncRemarks"
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
        Line items — still out on this return challan
      </div>

      <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table
          className="innovic-table"
          style={{ width: '100%', tableLayout: 'fixed', minWidth: 900 }}
        >
          <thead>
            <tr>
              <th style={{ width: '4%' }}>#</th>
              {/* POL = the CUSTOMER's own PO line number off the SO line behind
                  this challan line. Widths below still total 100. */}
              <th style={{ width: '5%', color: 'var(--purple)' }}>POL</th>
              <th style={{ width: '16%' }}>Item Code</th>
              <th style={{ width: '22%' }}>Item Name</th>
              <th style={{ width: '8%' }}>Sent Qty</th>
              <th style={{ width: '9%' }}>Received so far</th>
              <th style={{ width: '8%' }}>Balance</th>
              <th style={{ width: '11%' }}>
                Receive Now<span className="req">★</span>
              </th>
              <th style={{ width: '17%' }}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state" style={{ padding: 14 }}>
                  {!ncId
                    ? 'Pick an NC to load its return challan.'
                    : !dc
                      ? 'Loading return challan lines…'
                      : 'Every line on this return challan is already received — nothing left to book in.'}
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={l.deliveryChallanLineId}>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                    {idx + 1}
                  </td>
                  {/* POL — the customer's PO line number; '—' when this line has
                      no sales order behind it. */}
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
                    title={itemCodeWithRev(l.itemCode, l.itemRevision)}
                  >
                    {itemCodeWithRev(l.itemCode, l.itemRevision)}
                  </td>
                  <td
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={l.itemName}
                  >
                    {l.itemName || '—'}
                  </td>
                  <td className="mono">{l.sentQty}</td>
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
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--cyan)',
                        padding: '4px 4px',
                      }}
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
                      value={l.remarks}
                      onChange={(e) => patchLine(idx, { remarks: e.target.value })}
                      aria-label={`Remarks, line ${idx + 1}`}
                    />
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
          <button type="submit" className="btn btn-success" disabled={submitting}>
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}✓ Create GRN
          </button>
        </div>
      </div>
    </form>
  );
}
