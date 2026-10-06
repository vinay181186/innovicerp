// GRN "Against JWPO / DC" — the 🏭 tab of <UnifiedGrnForm>.
//
// Chain: job-work / service PO → OSP delivery challan (IN-DC-…) sends our
// material to the vendor → this screen books it back. Pick the JWPO, then one
// of its challans still awaiting receipt — or pick the challan straight away
// and the JWPO box fills itself from it — and every line with a Pending qty is
// loaded from that challan. Saving posts to POST /delivery-challans/:id/receive
// — the SAME endpoint the standalone DC Receive page uses — so the server
// raises the GRN (linked to the DC), updates the PO line's received qty and
// status, flips the job-card operation, and marks the DC received when fully
// reconciled. The previous version of this tab posted to /jw-dc/inward, which
// never created a GRN and never touched the PO.
//
// ADR-217 Phase 1 — this tab also lists RETURN-TO-VENDOR challans (ADR-161:
// `ncId` set, no purchase order behind them). It used to drop every one of
// them, so a store user holding only the return challan number could not find
// it on either tab. They are marked "Return to Vendor" in the picker and are
// received by the SAME POST /delivery-challans/:id/receive call, with the same
// request body, that the Against NC type makes — this is routing, not a second
// save path, and nothing about what the server stores changes.
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
import { fmtDate, todayIst } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import {
  useDeliveryChallan,
  useDeliveryChallansList,
  useReceiveDeliveryChallan,
} from '@/modules/delivery-challans/api';
import { computeReceivedByLine } from '@/modules/delivery-challans/lib/receipt-math';
import { purchaseOrdersKeys } from '@/modules/purchase-orders/api';
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

/** How a return-to-vendor challan is marked in the challan picker, so it can
 *  never be mistaken for an ordinary job-work send. */
const RETURN_TAG = 'Return to Vendor';

export interface GrnAgainstDcFormProps extends GrnTypeFormShellProps {
  /** The parent screen's exit-guard `leave`: runs the post-save navigation
   *  without the "Are you sure you want to exit?" question. The guard itself
   *  lives in <UnifiedGrnForm>, which owns this tab — one screen, one guard. */
  onLeave: (go: () => void) => void;
}

export function GrnAgainstDcForm({
  onLeave,
  typeField,
  onStatusChange,
}: GrnAgainstDcFormProps): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // R2 — one idempotency key per open form, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const receive = useReceiveDeliveryChallan(saveKey);

  const [jwpoId, setJwpoId] = useState<string | null>(null);
  const [jwpoSearch, setJwpoSearch] = useState('');
  const [dcId, setDcId] = useState<string | null>(null);
  const [dcSearch, setDcSearch] = useState('');
  // Remount key for the DC picker. Bumped ONLY when the user changes the JWPO,
  // so the picker's own text resets then — and never when a DC pick auto-fills
  // the JWPO, which must not wipe the challan just picked.
  const [dcPickerKey, setDcPickerKey] = useState(0);
  const [receiptDate, setReceiptDate] = useState(todayIst());
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
  // ADR-217 — rows with `ncId` are return-to-vendor challans; they are KEPT.
  // They have no purchase order, so they never reach the JW PO list below and
  // only appear in the challan picker while no JW PO is picked. A row with
  // neither a PO nor an NC behind it is still dropped: nothing on this screen
  // could show what it belongs to.
  const dcList = useDeliveryChallansList({ status: 'issued', limit: 200, offset: 0 });
  const eligibleDcs = useMemo(
    () => (dcList.data?.items ?? []).filter((d) => d.purchaseOrderId !== null || d.ncId !== null),
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
        const vendor = d.vendorName ?? d.vendorCodeText;
        const short = `${fmtDate(d.dcDate)} · ${d.lineCount} line${d.lineCount === 1 ? '' : 's'}`;
        // ADR-217 — a return-to-vendor challan has no PO (its `poCodeText` is
        // the NC code), so its first segment names the NC instead and is
        // prefixed "Return to Vendor". A return never reaches the short label:
        // the pool above is narrowed by purchaseOrderId whenever a JW PO is
        // picked, and a return has none.
        const long =
          d.ncId !== null
            ? `${RETURN_TAG} · NC ${d.ncCode ?? d.poCodeText} · ${vendor} · ${fmtDate(d.dcDate)}`
            : `${d.poCode ?? d.poCodeText} · ${vendor} · ${fmtDate(d.dcDate)}`;
        return {
          id: d.id,
          code: d.code,
          name: jwpoId ? short : long,
          // The NC No. rides in the hidden search text as well, so a return is
          // found by the NC number, by its own challan number, or by the word
          // "return" — whichever number the user happens to be holding.
          searchText: `${d.code} — ${short} ${d.code} — ${long} ${d.ncCode ?? ''}`,
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

  // The picked challan's own LIST row. It already knows the vendor and whether
  // this is a return, which keeps both truthful for the render before the
  // detail arrives.
  const pickedRow = useMemo(
    () => (dcId ? eligibleDcs.find((d) => d.id === dcId) : undefined),
    [dcId, eligibleDcs],
  );
  const vendorLabel = dc
    ? (dc.vendorName ?? dc.vendorCodeText)
    : pickedRow
      ? (pickedRow.vendorName ?? pickedRow.vendorCodeText)
      : '';

  // ADR-217 — is the picked challan a return to vendor? Detail first, list row
  // while it loads. Nothing is a return until a challan is actually picked.
  const returnNcCode = dc
    ? (dc.ncCode ?? pickedRow?.poCodeText ?? null)
    : (pickedRow?.ncCode ?? pickedRow?.poCodeText ?? null);
  const isReturn = (dc ? dc.ncId : (pickedRow?.ncId ?? null)) !== null;

  const vendorId = dc?.vendorId ?? pickedRow?.vendorId ?? undefined;

  const patchLine = (idx: number, patch: Partial<LineDraft>): void => {
    setLinesTouched(true);
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    setSubmitError(null);
    // The challan is checked first (ADR-217): a return-to-vendor challan has no
    // purchase order behind it, so the JW PO can only be required once we know
    // which kind of challan this is.
    if (!dc) {
      setFormError(dcId ? 'The challan is still loading. Try again.' : 'DC No. is required.');
      return;
    }
    if (dc.ncId === null && !jwpoId) {
      setFormError('JW PO is required.');
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

  // The header's account, from the same rows and the same `accountOf` the table
  // foots — one rule, one rounding, one answer.
  const { account } = grnReceiptTotals(rows);

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

      {/* Same grid, same sequence as Against PO (rule 8): which paper am I
          receiving against → who delivered it → their paperwork → how much this
          receipt settles. Four rows of four, every row full. */}
      <Panel title="Receipt">
        <ClusterGrid>
          <Cluster name="Against">
            {typeField}
            {/* ADR-217 — a return-to-vendor challan carries no purchase order,
                so the JW PO cell has nothing to hold and the NC it came from
                takes its place rather than leaving a dead picker on the row. */}
            {isReturn ? (
              <ClusterFact
                label="NC No."
                num
                value={returnNcCode ?? '—'}
                empty={!returnNcCode}
                {...(returnNcCode ? { title: returnNcCode } : {})}
              />
            ) : (
              <FormField label="JW PO" required htmlFor="jwpoId">
                <SearchableSelect
                  id="jwpoId"
                  value={jwpoId}
                  onChange={onJwpoChange}
                  options={jwpoOptions}
                  onSearch={setJwpoSearch}
                  loading={dcList.isFetching}
                  placeholder="🔍 Type JW PO number or vendor…"
                  valueLabel={jwpoValueLabel}
                  emptyText="No JW PO has a challan awaiting receipt."
                />
              </FormField>
            )}
            <FormField label="DC No." required htmlFor="dcId">
              {/* Keyed on a counter bumped by a USER change of the JWPO, so the
                  picker's own text resets then — otherwise the old challan's
                  label would linger in the box. Not keyed on jwpoId itself: a DC
                  pick auto-fills the JWPO and must keep the challan just picked. */}
              <SearchableSelect
                key={dcPickerKey}
                id="dcId"
                value={dcId}
                onChange={onDcChange}
                options={dcOptions}
                onSearch={setDcSearch}
                loading={dcList.isFetching}
                placeholder={
                  jwpoId ? '🔍 Pick a DC…' : '🔍 Type a DC No. or NC No. (or pick a JW PO first)…'
                }
                valueLabel={dcValueLabel}
                emptyText={
                  jwpoId
                    ? 'No challan on this JW PO is awaiting receipt.'
                    : 'No challan is awaiting receipt.'
                }
              />
            </FormField>
            <FormField label="GRN Date" required htmlFor="receiptDate">
              <input
                id="receiptDate"
                type="date"
                className="innovic-input"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                required
              />
            </FormField>
          </Cluster>

          {/* All three come from the challan / the vendor master, so all three
              are one-line FACTS, never read-only boxes. */}
          <GrnVendorCluster
            vendorId={vendorId}
            vendorLabel={vendorLabel}
            vendorFrom={'— from the challan —'}
            codeFallback={(dc ?? pickedRow)?.vendorCodeText ?? ''}
          />

          {/* No Vendor Challan No. here: on this type OUR challan IS the paper,
              and the receive payload has no per-document vendor challan field,
              so a box would be typed and dropped. GRN Remarks takes the room. */}
          <Cluster name="Vendor paper">
            <FormField label="Vendor Invoice No." htmlFor="vendorInvoice">
              <input
                id="vendorInvoice"
                className="innovic-input"
                autoComplete="off"
                value={vendorInvoiceText}
                onChange={(e) => setVendorInvoiceText(e.target.value)}
              />
            </FormField>
            <FormField label="GRN Remarks" htmlFor="dcRemarks" className="cl-span-3">
              <input
                id="dcRemarks"
                className="innovic-input"
                autoComplete="off"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </FormField>
          </Cluster>

          {/* THE ACCOUNT — `Sent Qty — Received Earlier — Received = Pending`,
              recomputed from the live rows on every keystroke. On THIS screen
              the ordered figure is in hand: it is the challan line's own sent
              qty, which the form has just read off the picked challan. It is a
              saved DC / NC GRN's READ response that carries no challan
              quantity, which is why the edit and view surfaces suppress this
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
            !dcId
              ? 'Select a DC'
              : !dc
                ? 'Loading challan lines…'
                : 'Every line on this DC is already received.'
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
