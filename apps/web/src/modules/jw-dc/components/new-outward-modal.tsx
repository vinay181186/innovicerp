// New Outward DC modal (split out of routes/list.tsx). Picks a job-work /
// service PO, loads its lines, and sends material out. A `?jw=` deep link from
// a JWSO pre-picks the PO that carries it.

import {
  type CreateJwDcOutwardLineInput,
  RTV_CANDIDATE_STATE_LABELS,
  type RtvCandidateState,
  type RtvPendingConflictDetails,
} from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { Banner } from '@/ui/feedback';
import { useRtvCandidates } from '../../delivery-challans/api';
import { useJobWorkOrder } from '../../job-work-orders/api';
import { usePurchaseOrdersList } from '../../purchase-orders/api';
import {
  type CreateJwDcOutwardBody,
  useCreateJwDcOutward,
  useJwDcPoLines,
  useNextOutwardCode,
} from '../api';
import { ErrorBox, ModalShell } from './modal-shell';
import { OutwardLineTable, type OutwardLineUi } from './outward-line-table';

/** PO statuses material may go out against: approved and still live. */
const SENDABLE_PO_STATUSES: ReadonlySet<string> = new Set(['open', 'partial', 'qc_pending']);

/** One row of the "waiting to go back to the vendor" notice — either from GET
 *  rtv-candidates or from the 409 the save answers with. Same shape and same
 *  source as the OSP Delivery Challan's panel (ADR-211), so the store reads the
 *  identical notice on both outward screens. */
interface RtvPanelRow {
  ncId: string;
  ncCode: string;
  itemCodeLabel: string;
  rejectedQty: string;
  state: RtvCandidateState;
  poLineId: string | null;
}

/** ADR-217 phase 4 — the 409 createJwDcOutward answers with when
 *  return-to-vendor pieces are waiting on a PO line of this challan. Identical
 *  test to the OSP path (delivery-challans/routes/create.tsx). */
function isRtvPendingConflict(e: unknown): e is ApiError & { details: RtvPendingConflictDetails } {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    typeof e.details === 'object' &&
    e.details !== null &&
    (e.details as { kind?: unknown }).kind === 'rtv_pending'
  );
}

export function NewOutwardModal({
  onClose,
  forJwId,
}: {
  onClose: () => void;
  /** `?jw=` deep link from a JWSO. An outward DC is keyed by the job-work PO,
   *  not the JWSO, so the PO list is asked for the POs whose lines trace to
   *  that JWSO (`jobWorkOrderId`, ADR-190 addendum): exactly one is pre-picked,
   *  several narrow the PO picker to them, none leaves the full picker. */
  forJwId?: string | undefined;
}): React.JSX.Element {
  const { data: forJw } = useJobWorkOrder(forJwId);
  const [date, setDate] = useState(todayLocal());
  const [poId, setPoId] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<OutwardLineUi[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // Anything the user typed, picked or ticked — arms the exit question.
  const [touched, setTouched] = useState(false);
  // ADR-217 phase 4 — NCs the server named in a 409, kept so the notice still
  // shows when the check below failed or ran before QC disposed the NC.
  const [rtvConflictRows, setRtvConflictRows] = useState<RtvPanelRow[]>([]);
  // The id set the store ticked against ("a,b,c", sorted). A tick holds only
  // for the exact set it was given on.
  const [rtvConfirmedKey, setRtvConfirmedKey] = useState<string | null>(null);

  const { data: next } = useNextOutwardCode();

  // POs that send material out, for the JWPO dropdown (bug 4.1 — was a free-text
  // picker). Two calls rather than one: the list query's `poType` filter takes a
  // single value, and dropping the filter to sort client-side would risk the
  // 200-row cap hiding job-work POs behind a wall of ordinary buys.
  const { data: poDataJw } = usePurchaseOrdersList({ poType: 'job_work', limit: 200, offset: 0 });
  const { data: poDataSvc } = usePurchaseOrdersList({ poType: 'service', limit: 200, offset: 0 });
  // `?jw=` — the job-work / service POs carrying this JWSO's work.
  const { data: poDataForJw } = usePurchaseOrdersList(
    { jobWorkOrderId: forJwId, limit: 200, offset: 0 },
    { enabled: Boolean(forJwId) },
  );
  const forJwPos = forJwId ? (poDataForJw?.items ?? null) : null;
  // Only an approved, live PO can send material out — the server refuses a
  // Draft, Closed or Cancelled one (same rule as the OSP DC), so they are not
  // offered here either.
  const poData = useMemo(() => {
    const all =
      forJwPos && forJwPos.length > 0
        ? forJwPos
        : [...(poDataJw?.items ?? []), ...(poDataSvc?.items ?? [])];
    return { items: all.filter((p) => SENDABLE_PO_STATUSES.has(p.status)) };
  }, [forJwPos, poDataJw, poDataSvc]);
  // Exactly one PO carries the JWSO → pick it (once; the user may change it).
  const [prePicked, setPrePicked] = useState(false);
  useEffect(() => {
    if (prePicked || !forJwPos) return;
    setPrePicked(true);
    const sendable = forJwPos.filter((p) => SENDABLE_PO_STATUSES.has(p.status));
    if (sendable.length === 1 && sendable[0]) setPoId(sendable[0].id);
  }, [forJwPos, prePicked]);
  const selectedPo = useMemo(() => poData.items.find((p) => p.id === poId) ?? null, [poData, poId]);

  const { data: poLines } = useJwDcPoLines(poId ?? undefined);
  // Sync lines from server response once
  useMemo(() => {
    if (poLines) {
      setLines(
        poLines.lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          itemCode: l.itemCode,
          itemRevision: l.itemRevision,
          clientPoLineNo: l.clientPoLineNo,
          itemName: l.itemName,
          processText: l.processText,
          uom: l.uom,
          poQty: l.poQty,
          alreadySent: l.alreadySent,
          available: l.available,
          sendQty: l.available,
          checked: l.available > 0,
        })),
      );
    } else {
      setLines([]);
    }
  }, [poLines]);

  // ADR-217 phase 4 — pieces from this PO waiting to go back to the vendor (an
  // RTV NC disposed and not yet sent, or one still awaiting QC's decision).
  // This fetch is only the early warning; the server is the guard (409
  // rtv_pending on Save). Skipped until a PO is picked, so an unopened form
  // asks nothing and Save is never held by a check that is not running.
  const rtv = useRtvCandidates(poId ?? undefined, Boolean(poId));
  // The PO lines this challan sends — the SAME set onSave builds the payload
  // from. Only NCs on these lines can hold the save.
  const sendingLines = useMemo(() => lines.filter((l) => l.checked && l.sendQty > 0), [lines]);
  // Notice rows: fetched candidates merged with any the server named in a 409
  // (by ncId, the 409 being fresher), narrowed to the lines being sent.
  const rtvRows = useMemo<RtvPanelRow[]>(() => {
    const byId = new Map<string, RtvPanelRow>();
    for (const c of rtv.data?.items ?? []) {
      byId.set(c.ncId, {
        ncId: c.ncId,
        ncCode: c.ncCode,
        itemCodeLabel: itemCodeWithRev(c.itemCode ?? c.itemCodeText, c.itemRevision),
        rejectedQty: c.rejectedQty,
        state: c.state,
        poLineId: c.purchaseOrderLineId,
      });
    }
    for (const r of rtvConflictRows) {
      const had = byId.get(r.ncId);
      byId.set(r.ncId, had ? { ...had, state: r.state, poLineId: r.poLineId } : r);
    }
    const sendingLineIds = new Set(sendingLines.map((l) => l.purchaseOrderLineId));
    return [...byId.values()].filter((r) => r.poLineId !== null && sendingLineIds.has(r.poLineId));
  }, [rtv.data, rtvConflictRows, sendingLines]);
  const rtvShownKey = useMemo(
    () =>
      rtvRows
        .map((r) => r.ncId)
        .sort()
        .join(','),
    [rtvRows],
  );
  const rtvConfirmed = rtvRows.length > 0 && rtvConfirmedKey === rtvShownKey;
  // The shown set changed after the tick (a new NC appeared, a row was
  // unticked or its Send Now cleared): the tick no longer covers what is on
  // screen — clear it.
  useEffect(() => {
    if (rtvConfirmedKey !== null && rtvConfirmedKey !== rtvShownKey) setRtvConfirmedKey(null);
  }, [rtvConfirmedKey, rtvShownKey]);
  // Save waits while the check is genuinely in flight (isLoading is false once
  // it errors or while it is disabled, so this cannot hang); a failed check
  // does NOT block — the server still refuses with 409 rtv_pending.
  const rtvBlocks = rtv.isLoading || (rtvRows.length > 0 && !rtvConfirmed);

  const createMut = useCreateJwDcOutward();

  const onSave = (): void => {
    setErr(null);
    if (!poId) {
      setErr('PO No. is required.');
      return;
    }
    const valid: CreateJwDcOutwardLineInput[] = lines
      .filter((l) => l.checked && l.sendQty > 0)
      .map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, sentQty: l.sendQty }));
    if (valid.length === 0) {
      setErr('Tick at least one line and enter Send Now.');
      return;
    }
    // ADR-217 phase 4 — the Save button is already disabled in this state; this
    // is the same check in words, for anyone who reaches here another way.
    if (rtvBlocks) {
      setErr(
        rtv.isLoading
          ? 'Still checking for pieces waiting to go back to the vendor. Try again in a moment.'
          : 'Tick "These are new pieces, not the ones waiting to go back" before saving.',
      );
      return;
    }
    const input: CreateJwDcOutwardBody = {
      dcDate: date,
      purchaseOrderId: poId,
      lines: valid,
    };
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();
    // The NCs the store saw when it ticked; sent only when ticked. An NC that
    // appears after the tick is not in this list, so the server refuses again.
    if (rtvConfirmed) input.rtvConfirmedNcIds = rtvRows.map((r) => r.ncId);

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => {
        // QC disposed an NC on this PO between opening the form and Save (or
        // the check above failed): show the NCs the server named, and make the
        // store tick again.
        if (isRtvPendingConflict(e)) {
          const named = e.details.ncs.map(
            (n): RtvPanelRow => ({
              ncId: n.ncId,
              ncCode: n.ncCode,
              itemCodeLabel: n.itemCode ?? '—',
              rejectedQty: n.rejectedQty,
              state: n.state,
              poLineId: n.poLineId,
            }),
          );
          setRtvConflictRows((prev) => [
            ...prev.filter((p) => !named.some((n) => n.ncId === p.ncId)),
            ...named,
          ]);
          setRtvConfirmedKey(null);
          void rtv.refetch();
        }
        setErr(
          e instanceof Error ? e.message : 'Could not save JW DC. Check the lines and try again.',
        );
      },
    });
  };

  const setLine = (i: number, patch: Partial<OutwardLineUi>): void => {
    setTouched(true);
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  return (
    <ModalShell
      onClose={onClose}
      title="New Outward DC"
      onSave={onSave}
      saving={createMut.isPending}
      saveLabel="Save Outward DC"
      saveDisabled={rtvBlocks}
      dirty={touched}
    >
      {forJw ? (
        <div
          className="text2"
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'var(--purple3)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          For JWSO <span className="td-code">{forJw.code}</span>
          {forJw.customerName ? <> · {forJw.customerName}</> : null}
        </div>
      ) : null}
      <div className="form-grid" style={{ marginBottom: 14 }}>
        <div className="form-grp">
          <label className="form-label">Outward DC No.</label>
          <input
            type="text"
            className="innovic-input"
            value={next?.code ?? '(auto on save)'}
            readOnly
          />
        </div>
        <div className="form-grp">
          <label className="form-label">DC Date</label>
          <input
            type="date"
            className="innovic-input"
            value={date}
            onChange={(e) => {
              setTouched(true);
              setDate(e.target.value);
            }}
          />
        </div>
        <div className="form-grp form-full">
          <label className="form-label">
            PO No.<span className="req">★</span>
          </label>
          <select
            className="innovic-select"
            value={poId ?? ''}
            onChange={(e) => {
              setTouched(true);
              // The waiting-deviation notice belongs to the PO it was raised
              // for — drop it (and any tick) when the PO changes.
              setRtvConflictRows([]);
              setRtvConfirmedKey(null);
              setPoId(e.target.value || null);
            }}
          >
            <option value="">-- Select PO --</option>
            {poData.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.vendorName ?? p.vendorCodeText ?? ''}
              </option>
            ))}
          </select>
        </div>
        {selectedPo ? (
          <div className="form-grp form-full">
            <div
              style={{
                padding: '8px 12px',
                background: 'var(--bg3)',
                borderRadius: 6,
                border: '1px solid var(--border)',
                fontSize: 12,
              }}
            >
              <b>Vendor:</b> {selectedPo.vendorName ?? selectedPo.vendorCodeText ?? '—'} |{' '}
              <b>PO:</b> {selectedPo.code} | <b>Lines:</b> {lines.length}
            </div>
          </div>
        ) : null}
      </div>

      {/* ADR-217 phase 4 — pieces waiting to go back to the vendor on a PO line
          this challan sends. Shown only when there are some; with none, the
          New Outward DC form is exactly as before. */}
      {poId && rtv.isError ? (
        <div className="text3" style={{ fontSize: 11, marginBottom: 12 }}>
          Could not check for pieces waiting to go back; the save will check.
        </div>
      ) : null}
      {rtvRows.length > 0 ? (
        <Banner
          tone="warn"
          role="alert"
          title="These pieces from this PO are waiting to go back to the vendor:"
        >
          <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
            {rtvRows.map((r) => (
              <li key={r.ncId}>
                <b className="mono fw-700">{r.ncCode}</b> —{' '}
                <b className="mono fw-700" style={{ color: 'var(--text)' }}>
                  {r.itemCodeLabel}
                </b>{' '}
                — {Number(r.rejectedQty)} pcs — {RTV_CANDIDATE_STATE_LABELS[r.state]}
              </li>
            ))}
          </ul>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={rtvConfirmed}
              onChange={(e) => {
                setTouched(true);
                setRtvConfirmedKey(e.target.checked ? rtvShownKey : null);
              }}
            />
            These are new pieces, not the ones waiting to go back
            <span className="req">★</span>
          </label>
        </Banner>
      ) : null}

      {lines.length > 0 ? <OutwardLineTable lines={lines} setLine={setLine} /> : null}

      <div className="form-grid" style={{ marginTop: 14 }}>
        <div className="form-grp">
          <label className="form-label">Vehicle No.</label>
          <input
            type="text"
            className="innovic-input"
            value={vehicleNo}
            onChange={(e) => {
              setTouched(true);
              setVehicleNo(e.target.value);
            }}
            placeholder="GJ-05-XX-1234"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Remarks</label>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => {
              setTouched(true);
              setRemarks(e.target.value);
            }}
          />
        </div>
      </div>

      {err ? <ErrorBox message={err} /> : null}
    </ModalShell>
  );
}
