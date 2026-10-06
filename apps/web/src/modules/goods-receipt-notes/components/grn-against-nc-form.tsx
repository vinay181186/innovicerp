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
// return challan is still `issued` with a Pending qty to receive.
//
// ADR-217 Phase 1 — the header now shows the rest of the chain, not just the
// NC end of it: the PO the rejected pieces were bought/job-worked on and the
// GRN they first came in on, both read straight off GET /nc-register/:id
// (resolveNcSource, already resolved server-side for the NC detail page). The
// "Sent on DC No." (the OSP challan the pieces first went OUT on) is NOT
// reachable from any existing endpoint for an NC that already has its return
// challan — see the report for ADR-217 Phase 1 — so it is not shown rather
// than shown wrong.
//
// No OK / Rejected split and no QC fields here: everything received lands on
// the auto-GRN as pending and the accept/reject decision is made at Incoming QC.

import type { CreateDeliveryChallanReceiptInput } from '@innovic/shared';
import { isWholeNumberUom, roundQty } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { todayIst } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import {
  useDeliveryChallan,
  useDeliveryChallansList,
  useReceiveDeliveryChallan,
} from '@/modules/delivery-challans/api';
import { computeReceivedByLine } from '@/modules/delivery-challans/lib/receipt-math';
import { useNcRegister } from '@/modules/nc-register/api';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterFact, ClusterGrid, FormField } from '@/ui/forms';
import { goodsReceiptNotesKeys } from '../api';
import { GRN_CREATE_FORM_ID, type GrnTypeFormShellProps } from './grn-create-contract';
import { GrnLinesTable, GrnReceiptAccount } from './grn-lines-table';
import { GrnVendorCluster } from './grn-vendor-cluster';
import { type GrnLineRow, grnReceivedError, grnReceiptTotals } from './grn-receipt-figures';

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
  pending: number;
  /** The challan line's unit — decides whole-number vs 3-decimal Received (S9). */
  uom: string;
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

export function GrnAgainstNcForm({
  onLeave,
  typeField,
  onStatusChange,
}: GrnAgainstNcFormProps): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // R2 — one idempotency key per open form, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const receive = useReceiveDeliveryChallan(saveKey);

  const [ncId, setNcId] = useState<string | null>(null);
  const [ncSearch, setNcSearch] = useState('');
  const [receiptDate, setReceiptDate] = useState(todayIst());
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
  // ADR-217 — the RETURN CHALLAN's own number is matched too, through
  // SearchableOption.searchText, so a store user holding only the challan can
  // get here. It is not added to the label: the label is the NC's.
  const ncOptions = useMemo(
    () =>
      ncRows
        .map((d) => ({
          id: d.ncId ?? d.id,
          code: d.ncCode ?? d.poCodeText,
          name: `${d.jobCardCode ?? '—'} · ${d.vendorName ?? d.vendorCodeText}`,
          searchText: d.code,
        }))
        .filter((o) =>
          matchesSearchTerm([o.code, o.name, o.searchText, `${o.code} — ${o.name}`], ncSearch),
        ),
    [ncRows, ncSearch],
  );

  // The picked NC's return challan row (from the list) — the source of the
  // job card, challan code and vendor shown in the header, and of `dcId`.
  const ncRow = useMemo(
    () => (ncId ? ncRows.find((d) => d.ncId === ncId) : undefined),
    [ncId, ncRows],
  );
  const dcId = ncRow?.id ?? null;

  // ADR-217 — the rest of the chain for the picked NC. GET /nc-register/:id
  // already resolves where the rejected material came from (resolveNcSource:
  // the GRN line's GRN, else the origin outsource op's PO), so the PO number
  // and the GRN number are one read with no new endpoint and no guessing here.
  // Guarded on the id exactly like `dc` below, so the PREVIOUS NC's answer —
  // still in the cache for one render — can never be shown against this one.
  const { data: ncDetailData } = useNcRegister(ncId ?? undefined);
  const ncDetail = ncId !== null && ncDetailData?.id === ncId ? ncDetailData : undefined;
  // The dash below states "this NC has no purchase order / GRN behind it — it was
  // raised at the machine", which is a real fact about the record. It must not
  // also be what a pending or failed fetch looks like, or the screen asserts an
  // absence it has not established. Until the answer is in hand the boxes stay
  // blank, exactly as they are before an NC is picked.
  const ncSourceKnown = ncDetail !== undefined;

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
          const pending = roundQty(sent - got);
          if (pending <= 0) return null;
          return {
            deliveryChallanLineId: l.id,
            lineNo: l.lineNo,
            itemCode: l.itemCode ?? l.itemCodeText,
            itemRevision: l.itemRevision,
            clientPoLineNo: l.clientPoLineNo,
            itemName: l.itemName ?? l.itemNameText ?? '',
            sentQty: sent,
            receivedSoFar: got,
            pending,
            uom: l.uom,
            receiveNow: String(pending),
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

  const vendorId = dc?.vendorId ?? ncRow?.vendorId ?? undefined;

  const patchLine = (idx: number, patch: Partial<LineDraft>): void => {
    setLinesTouched(true);
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setSubmitError(null);
    if (!ncId) {
      setFormError('NC No. is required.');
      return;
    }
    if (!dc) {
      setFormError('The return challan is still loading. Try again.');
      return;
    }
    if (!receiptDate) {
      setFormError('GRN Date is required.');
      return;
    }
    const checked = lines.map((l) => ({
      ...l,
      error: grnReceivedError(l.receiveNow, { uom: l.uom, cap: l.pending }),
    }));
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

  // ONE row list, read by the lines table AND by the header's account, so the
  // header figure and the table's totals row can never disagree.
  const rows: GrnLineRow[] = lines.map((l) => ({
    key: l.deliveryChallanLineId,
    clientPoLineNo: l.clientPoLineNo,
    itemCode: l.itemCode,
    itemRevision: l.itemRevision,
    itemName: l.itemName,
    uom: l.uom,
    qty: l.sentQty,
    receivedEarlier: l.receivedSoFar,
    pendingQty: l.pending,
    receiveNow: l.receiveNow,
    remarks: l.remarks,
    error: l.error,
  }));

  const ncValueLabel = useMemo(() => {
    if (!ncId) return undefined;
    const o = ncOptions.find((x) => x.id === ncId);
    return o ? `${o.code} — ${o.name}` : undefined;
  }, [ncId, ncOptions]);

  // The header's account, from the same rows and the same `accountOf` the table
  // foots — one rule, one rounding, one answer.
  const { account } = grnReceiptTotals(rows);

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

      {/* Same grid, same sequence as the other two types (rule 8), with ONE
          extra cluster this type genuinely has: the return chain, in the order
          it happened. Every row comes out full. */}
      <Panel title="Receipt">
        <ClusterGrid>
          <Cluster name="Against">
            {typeField}
            <FormField
              label="NC No."
              required
              htmlFor="ncId"
              className="cl-span-2"
              {...(ncRow?.reason ? { help: `Return reason: ${ncRow.reason}` } : {})}
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
                emptyText="No NC has a return challan awaiting receipt."
              />
            </FormField>
            <FormField label="GRN Date" required htmlFor="ncReceiptDate">
              <input
                id="ncReceiptDate"
                type="date"
                className="innovic-input"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                required
              />
            </FormField>
          </Cluster>

          {/* ADR-217 — where the rejected pieces came from and what they went
              back out on, all read off the NC. An NC raised at the machine
              genuinely has no source PO / source GRN, and a dash is the right
              way to say so — but ONLY once the answer is in hand. Until then
              (`ncSourceKnown` false: no NC picked yet, or its fetch still in
              flight) these two cells stay EMPTY, because a dash there would
              assert an absence the screen has not established. JC No. and
              DC No. come off the picked NC's own list row, which is already
              loaded, so they have no such wait. */}
          <Cluster name="Return chain">
            <ClusterFact
              label="JC No."
              num
              value={ncRow?.jobCardCode ?? '—'}
              empty={!ncRow?.jobCardCode}
            />
            <ClusterFact
              label="Source PO No."
              num
              value={ncSourceKnown ? (ncDetail.sourcePoCode ?? '—') : ''}
              empty={!ncDetail?.sourcePoCode}
              {...(ncDetail?.sourcePoCode ? { title: ncDetail.sourcePoCode } : {})}
            />
            <ClusterFact
              label="Source GRN No."
              num
              value={ncSourceKnown ? (ncDetail.sourceGrnCode ?? '—') : ''}
              empty={!ncDetail?.sourceGrnCode}
              {...(ncDetail?.sourceGrnCode ? { title: ncDetail.sourceGrnCode } : {})}
            />
            <ClusterFact label="DC No." num value={ncRow?.code ?? '—'} empty={!ncRow?.code} />
          </Cluster>

          <GrnVendorCluster
            vendorId={vendorId}
            vendorLabel={vendorLabel}
            vendorFrom={'— from the NC —'}
            codeFallback={(dc ?? ncRow)?.vendorCodeText ?? ''}
          />

          {/* No Vendor Challan No.: the return challan IS our paper, and the
              receive payload has no per-document vendor challan field. */}
          <Cluster name="Vendor paper">
            <FormField label="Vendor Invoice No." htmlFor="ncVendorInvoice">
              <input
                id="ncVendorInvoice"
                className="innovic-input"
                autoComplete="off"
                value={vendorInvoiceText}
                onChange={(e) => setVendorInvoiceText(e.target.value)}
              />
            </FormField>
            <FormField label="GRN Remarks" htmlFor="ncRemarks" className="cl-span-3">
              <input
                id="ncRemarks"
                className="innovic-input"
                autoComplete="off"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </FormField>
          </Cluster>

          {/* THE ACCOUNT — `Sent Qty — Received Earlier — Received = Pending`,
              recomputed from the live rows on every keystroke. On THIS screen
              the ordered figure is in hand: it is the return challan line's own
              sent qty, read off the picked challan. It is a SAVED NC GRN's read
              response that cannot state it — no challan quantity, and the PO
              line figures it does carry are knowingly wrong for a replacement
              receipt — which is why the edit and view surfaces suppress this
              row and this screen does not. */}
          {account ? <GrnReceiptAccount account={account} qtyLabel="Sent Qty" /> : null}
        </ClusterGrid>
      </Panel>

      <Panel title={`Line Items (${rows.length})`} bodyPadding="none">
        <GrnLinesTable
          rows={rows}
          qtyLabel="Sent Qty"
          showAccount
          decimal={lines.some((l) => !isWholeNumberUom(l.uom))}
          emptyText={
            !ncId
              ? 'Pick an NC to load its return challan.'
              : !dc
                ? 'Loading return challan lines…'
                : 'Every line on this return challan is already received.'
          }
          onReceiveNow={(idx, v) => {
            const l = lines[idx];
            if (l)
              patchLine(idx, {
                receiveNow: v,
                error: grnReceivedError(v, { uom: l.uom, cap: l.pending }),
              });
          }}
          onRemarks={(idx, v) => patchLine(idx, { remarks: v })}
        />
      </Panel>
    </form>
  );
}
