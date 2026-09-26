// GRN "Against JWPO / DC" — the 🏭 tab of <UnifiedGrnForm>.
//
// Chain: job-work / service PO → OSP delivery challan (IN-DC-…) sends our
// material to the vendor → this screen books it back. Pick the JWPO, then one
// of its challans still awaiting receipt — or pick the challan straight away
// and the JWPO box fills itself from it — and every line with a balance is
// loaded from that challan. Saving posts to POST /delivery-challans/:id/receive
// — the SAME endpoint the standalone DC Receive page uses — so the server
// raises the GRN (linked to the DC), updates the PO line's received qty and
// status, flips the job-card operation, and marks the DC received when fully
// reconciled. The previous version of this tab posted to /jw-dc/inward, which
// never created a GRN and never touched the PO.
//
// No OK / Rejected split and no QC fields here: everything received lands on
// the auto-GRN as pending and the accept/reject decision is made at Incoming QC.

import type { CreateDeliveryChallanReceiptInput } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { fmtDate, todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import {
  useDeliveryChallan,
  useDeliveryChallansList,
  useReceiveDeliveryChallan,
} from '@/modules/delivery-challans/api';
import { computeReceivedByLine } from '@/modules/delivery-challans/lib/receipt-math';
import { purchaseOrdersKeys } from '@/modules/purchase-orders/api';
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

export interface GrnAgainstDcFormProps extends GrnTypeFormShellProps {
  /** The parent screen's exit-guard `leave`: runs the post-save navigation
   *  without the "Are you sure you want to exit?" question. The guard itself
   *  lives in <UnifiedGrnForm>, which owns this tab — one screen, one guard. */
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

export function GrnAgainstDcForm({
  onLeave,
  typeField,
  onStatusChange,
}: GrnAgainstDcFormProps): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const receive = useReceiveDeliveryChallan();

  const [jwpoId, setJwpoId] = useState<string | null>(null);
  const [jwpoSearch, setJwpoSearch] = useState('');
  const [dcId, setDcId] = useState<string | null>(null);
  const [dcSearch, setDcSearch] = useState('');
  // Remount key for the DC picker. Bumped ONLY when the user changes the JWPO,
  // so the picker's own text resets then — and never when a DC pick auto-fills
  // the JWPO, which must not wipe the challan just picked.
  const [dcPickerKey, setDcPickerKey] = useState(0);
  const [receiptDate, setReceiptDate] = useState(todayLocal());
  const [vendorInvoiceText, setVendorInvoiceText] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Any hand edit to the loaded lines — only feeds the "Not saved" pill.
  const [linesTouched, setLinesTouched] = useState(false);

  // ONE query feeds both pickers: every challan still awaiting receipt. The
  // eligible JWPOs are simply the distinct POs behind those rows, so a PO with
  // nothing out at the vendor never appears. 200 is the API's max page and is
  // far above the number of issued-but-unreceived challans at any one time.
  // Rows with `ncId` are return-to-vendor challans (no PO) and are dropped.
  const dcList = useDeliveryChallansList({ status: 'issued', limit: 200, offset: 0 });
  const eligibleDcs = useMemo(
    () => (dcList.data?.items ?? []).filter((d) => d.ncId === null && d.purchaseOrderId !== null),
    [dcList.data],
  );

  const jwpoOptions = useMemo(() => {
    const byPo = new Map<string, { id: string; code: string; name: string }>();
    for (const d of eligibleDcs) {
      const id = d.purchaseOrderId;
      if (!id || byPo.has(id)) continue;
      byPo.set(id, {
        id,
        code: d.poCode ?? d.poCodeText,
        name: d.vendorName ?? d.vendorCodeText,
      });
    }
    // Search is client-side: the whole eligible set is already in the browser.
    // The composed "CODE — Vendor" label is matched too, because the picker
    // re-sends its own selected label as the term when reopened.
    return [...byPo.values()].filter((o) =>
      matchesSearchTerm([o.code, o.name, `${o.code} — ${o.name}`], jwpoSearch),
    );
  }, [eligibleDcs, jwpoSearch]);

  // DC options: with a JWPO picked, that JWPO's challans (short label, as
  // before); with none, EVERY eligible challan, labelled with its JWPO and
  // vendor so it can be told apart. Both label forms go into the hidden
  // `searchText` — after a DC-first pick the box holds the long label while
  // the options have switched to the short one, and reopening the picker
  // re-sends that text as the term; without this the row would not be found.
  const dcOptions = useMemo(() => {
    const pool = jwpoId ? eligibleDcs.filter((d) => d.purchaseOrderId === jwpoId) : eligibleDcs;
    return pool
      .map((d) => {
        const short = `${fmtDate(d.dcDate)} · ${d.lineCount} line${d.lineCount === 1 ? '' : 's'}`;
        const long = `${d.poCode ?? d.poCodeText} · ${d.vendorName ?? d.vendorCodeText} · ${fmtDate(d.dcDate)}`;
        return {
          id: d.id,
          code: d.code,
          name: jwpoId ? short : long,
          searchText: `${d.code} — ${short} ${d.code} — ${long}`,
        };
      })
      .filter((o) => matchesSearchTerm([o.code, o.name, o.searchText], dcSearch));
  }, [eligibleDcs, jwpoId, dcSearch]);

  const { data: dcData } = useDeliveryChallan(dcId ?? undefined);
  // Only trust the detail when it is the picked challan's (not the previous
  // one's, still cached, for the render before the new one loads). `dc` is
  // undefined otherwise, so every use below narrows on it directly.
  const dc = dcId !== null && dcData !== undefined && dcData.id === dcId ? dcData : undefined;

  // DEPENDENT-FIELD RULE (DC → lines): pick / change / clear the challan and
  // the lines are rebuilt from it or emptied. Vendor is derived below.
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

  // DEPENDENT-FIELD RULE (JWPO → DC): any change to the JWPO drops the picked
  // challan, which in turn drops vendor + lines + errors via the effect above.
  const onJwpoChange = (id: string | null): void => {
    setJwpoId(id);
    setDcId(null);
    setDcSearch('');
    setDcPickerKey((k) => k + 1);
    setFormError(null);
    setSubmitError(null);
  };

  // DC picked first (no JWPO yet) → the JWPO box fills from the challan's own
  // PO. With a JWPO already picked the options were already its challans, so
  // nothing else moves.
  const onDcChange = (id: string | null): void => {
    setDcId(id);
    if (id && !jwpoId) {
      const row = eligibleDcs.find((d) => d.id === id);
      if (row?.purchaseOrderId) setJwpoId(row.purchaseOrderId);
    }
  };

  const vendorLabel = dc
    ? (dc.vendorName ?? dc.vendorCodeText)
    : (() => {
        // While the detail loads, the list row already knows the vendor.
        const row = dcId ? eligibleDcs.find((d) => d.id === dcId) : undefined;
        return row ? (row.vendorName ?? row.vendorCodeText) : '';
      })();

  const patchLine = (idx: number, patch: Partial<LineDraft>): void => {
    setLinesTouched(true);
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setSubmitError(null);
    if (!jwpoId) {
      setFormError('Pick a JW PO.');
      return;
    }
    if (!dc) {
      setFormError('Pick a delivery challan.');
      return;
    }
    if (!receiptDate) {
      setFormError('GRN Date is required.');
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
      // The DC hook refreshes only DC caches; the GRN list and the PO (its
      // received qty and status just moved) must be refreshed here.
      void qc.invalidateQueries({ queryKey: goodsReceiptNotesKeys.lists() });
      void qc.invalidateQueries({ queryKey: purchaseOrdersKeys.all });
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

  const jwpoValueLabel = useMemo(() => {
    if (!jwpoId) return undefined;
    const row = eligibleDcs.find((d) => d.purchaseOrderId === jwpoId);
    return row
      ? `${row.poCode ?? row.poCodeText} — ${row.vendorName ?? row.vendorCodeText}`
      : undefined;
  }, [jwpoId, eligibleDcs]);

  const dcValueLabel = useMemo(() => {
    if (!dcId) return undefined;
    const o = dcOptions.find((x) => x.id === dcId);
    return o ? `${o.code} — ${o.name}` : undefined;
  }, [dcId, dcOptions]);

  // Report to the shell so its header Save / "Not saved" pill stay truthful.
  const dirty =
    jwpoId !== null || dcId !== null || vendorInvoiceText !== '' || remarks !== '' || linesTouched;
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
          {/* Row 1 — GRN Type · JW PO · GRN Date (3 + 6 + 3). */}
          {typeField}
          <FormField label="JW PO" required size="lg" htmlFor="jwpoId">
            <SearchableSelect
              id="jwpoId"
              value={jwpoId}
              onChange={onJwpoChange}
              options={jwpoOptions}
              onSearch={setJwpoSearch}
              loading={dcList.isFetching}
              placeholder="🔍 Type JW PO number or vendor…"
              valueLabel={jwpoValueLabel}
              emptyText="No job-work POs have a challan awaiting receipt"
            />
          </FormField>
          <FormField label="GRN Date" required size="sm" htmlFor="receiptDate">
            <input
              id="receiptDate"
              type="date"
              className="innovic-input"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
              required
            />
          </FormField>

          {/* Row 2 — DC No. · Vendor (from the DC) · Vendor Invoice No. (4 + 4 + 4). */}
          <FormField label="DC No." required size="md" htmlFor="dcId">
            {/* Keyed on a counter bumped by a USER change of the JWPO, so the
                picker's own text resets then — otherwise the old challan's label
                would linger in the box. Not keyed on jwpoId itself: a DC pick
                auto-fills the JWPO and must keep the challan just picked. */}
            <SearchableSelect
              key={dcPickerKey}
              id="dcId"
              value={dcId}
              onChange={onDcChange}
              options={dcOptions}
              onSearch={setDcSearch}
              loading={dcList.isFetching}
              placeholder={jwpoId ? '🔍 Pick a challan…' : '🔍 Pick a challan (or a JW PO first)…'}
              valueLabel={dcValueLabel}
              emptyText={
                jwpoId
                  ? 'No challan on this JW PO is awaiting receipt'
                  : 'No OSP challan is awaiting receipt'
              }
            />
          </FormField>
          <FormField label="Vendor" size="md" htmlFor="dcVendor">
            <input
              id="dcVendor"
              className="innovic-input"
              readOnly
              value={vendorLabel}
              placeholder="— from the challan —"
              tabIndex={-1}
            />
          </FormField>
          <FormField label="Vendor Invoice No." size="md" htmlFor="vendorInvoice">
            <input
              id="vendorInvoice"
              className="innovic-input"
              autoComplete="off"
              value={vendorInvoiceText}
              onChange={(e) => setVendorInvoiceText(e.target.value)}
            />
          </FormField>

          {/* Row 3 — Remarks (full). */}
          <FormField label="Remarks" size="full" htmlFor="dcRemarks">
            <textarea
              id="dcRemarks"
              className="innovic-textarea"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Line Items" bodyPadding="none">
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
            !jwpoId && !dcId
              ? 'Pick a delivery challan (or a JW PO, then one of its challans) to load the lines still out.'
              : !dcId
                ? 'Pick a delivery challan to load its lines.'
                : !dc
                  ? 'Loading challan lines…'
                  : 'Every line on this challan is already received — nothing pending to receive.'
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
