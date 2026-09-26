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
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { todayLocal } from '@/lib/date';
import {
  useDeliveryChallan,
  useDeliveryChallansList,
  useReceiveDeliveryChallan,
} from '@/modules/delivery-challans/api';
import { computeReceivedByLine } from '@/modules/delivery-challans/lib/receipt-math';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { goodsReceiptNotesKeys } from '../api';
import { GRN_CREATE_FORM_ID, type GrnTypeFormShellProps } from './grn-create-contract';
import { GrnLinesTable } from './grn-lines-table';

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

export interface GrnAgainstNcFormProps extends GrnTypeFormShellProps {
  /** The parent screen's exit-guard `leave`: runs the post-save navigation
   *  without the "Are you sure you want to exit?" question. The guard itself
   *  lives in <UnifiedGrnForm>, which owns this form — one screen, one guard. */
  onLeave: (go: () => void) => void;
}

/** One line's Receive Now check. Null = fine. */
function lineQtyError(raw: string, balance: number): string | null {
  const t = raw.trim();
  if (t === '') return null; // blank = 0 = skipped on submit
  const n = Number(t);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 'Whole number only.';
  if (n < 0) return 'Min 0.';
  if (n > balance) return `Cannot receive more than Pending (${balance}).`;
  return null;
}

export function GrnAgainstNcForm({
  onLeave,
  typeField,
  onStatusChange,
}: GrnAgainstNcFormProps): React.JSX.Element {
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
  // Any hand edit to the loaded lines — only feeds the "Not saved" pill.
  const [linesTouched, setLinesTouched] = useState(false);

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
    setLinesTouched(true);
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
      setSubmitError(err instanceof Error ? err.message : 'Could not save GRN. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const ncValueLabel = useMemo(() => {
    if (!ncId) return undefined;
    const o = ncOptions.find((x) => x.id === ncId);
    return o ? `${o.code} — ${o.name}` : undefined;
  }, [ncId, ncOptions]);

  // Report to the shell so its header Save / "Not saved" pill stay truthful.
  const dirty = ncId !== null || vendorInvoiceText !== '' || remarks !== '' || linesTouched;
  useEffect(() => {
    onStatusChange({ submitting, blocked: false, dirty });
  }, [onStatusChange, submitting, dirty]);

  const errorText = formError ?? submitError;

  return (
    <form id={GRN_CREATE_FORM_ID} onSubmit={(e) => void handleSubmit(e)}>
      {/* Validation summary right under the header, where Save is. */}
      {errorText ? (
        <Banner tone="error" role="alert">
          {errorText}
        </Banner>
      ) : null}

      <Panel title="GRN Details">
        <FormGrid>
          {/* Row 1 — GRN Type · NC No. · GRN Date (3 + 6 + 3). */}
          {typeField}
          <FormField
            label="NC No."
            required
            size="lg"
            htmlFor="ncId"
            help={ncRow?.reason ? `Return reason: ${ncRow.reason}` : undefined}
          >
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
          </FormField>
          <FormField label="GRN Date" required size="sm" htmlFor="ncReceiptDate">
            <input
              id="ncReceiptDate"
              type="date"
              className="innovic-input"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
              required
            />
          </FormField>

          {/* Row 2 — JC No. · DC No. · Vendor (all from the NC's challan) ·
              Vendor Invoice No. (3 + 3 + 3 + 3). */}
          <FormField label="JC No." size="sm" htmlFor="ncJobCard">
            <input
              id="ncJobCard"
              className="innovic-input"
              readOnly
              value={ncRow?.jobCardCode ?? ''}
              placeholder="— from the NC —"
              tabIndex={-1}
            />
          </FormField>
          <FormField label="DC No." size="sm" htmlFor="ncReturnChallan">
            <input
              id="ncReturnChallan"
              className="innovic-input"
              readOnly
              value={ncRow?.code ?? ''}
              placeholder="— from the NC —"
              tabIndex={-1}
            />
          </FormField>
          <FormField label="Vendor" size="sm" htmlFor="ncVendor">
            <input
              id="ncVendor"
              className="innovic-input"
              readOnly
              value={vendorLabel}
              title={vendorLabel || undefined}
              placeholder="— from the NC —"
              tabIndex={-1}
            />
          </FormField>
          <FormField label="Vendor Invoice No." size="sm" htmlFor="ncVendorInvoice">
            <input
              id="ncVendorInvoice"
              className="innovic-input"
              autoComplete="off"
              placeholder="optional"
              value={vendorInvoiceText}
              onChange={(e) => setVendorInvoiceText(e.target.value)}
            />
          </FormField>

          {/* Row 3 — Remarks (full). */}
          <FormField label="Remarks" size="full" htmlFor="ncRemarks">
            <textarea
              id="ncRemarks"
              className="innovic-textarea"
              rows={2}
              placeholder="Notes"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Line Items — still out on this return challan" bodyPadding="none">
        <GrnLinesTable
          rows={lines.map((l) => ({
            key: l.deliveryChallanLineId,
            clientPoLineNo: l.clientPoLineNo,
            itemCode: l.itemCode,
            itemRevision: l.itemRevision,
            itemName: l.itemName,
            qty: l.sentQty,
            receivedSoFar: l.receivedSoFar,
            balance: l.balance,
            receiveNow: l.receiveNow,
            remarks: l.remarks,
            error: l.error,
          }))}
          qtyLabel="Sent Qty"
          emptyText={
            !ncId
              ? 'Pick an NC to load its return challan.'
              : !dc
                ? 'Loading return challan lines…'
                : 'Every line on this return challan is already received — nothing pending to receive.'
          }
          onReceiveNow={(idx, v) => {
            const l = lines[idx];
            if (l) patchLine(idx, { receiveNow: v, error: lineQtyError(v, l.balance) });
          }}
          onRemarks={(idx, v) => patchLine(idx, { remarks: v })}
        />
      </Panel>
    </form>
  );
}
