// ADR-217 phase 4 — the "waiting to go back to the vendor" notice on New Outward
// DC (split out of routes/outward-create.tsx). Same shape and same source as the
// OSP Delivery Challan's panel (ADR-211), so the store reads the identical notice
// on both outward screens.

import {
  RTV_CANDIDATE_STATE_LABELS,
  type RtvCandidateState,
  type RtvPendingConflictDetails,
} from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { itemCodeWithRev } from '@/lib/item-code';
import { useRtvCandidates } from '@/modules/delivery-challans/api';
import { rtvOpenQty } from '@/modules/delivery-challans/lib/rtv-open-qty';
import { Banner } from '@/ui/feedback';
import type { OutwardLineUi } from './outward-line-table';

/** One row of the notice — either from GET rtv-candidates or from the 409 the
 *  save answers with. */
interface RtvPanelRow {
  ncId: string;
  ncCode: string;
  itemCodeLabel: string;
  /** GROSS — what the deviation was raised for. Kept because the 409 payload
   *  carries only this, but NEVER shown: a partly recovered deviation would
   *  tell the store to ship more pieces than are left. */
  rejectedQty: string;
  /** ADR-219 — what is still to go back, net of anything already recovered or
   *  written off. This is the figure on screen, and it is what keeps this panel
   *  identical to the OSP Delivery Challan's. */
  openQty: string;
  state: RtvCandidateState;
  poLineId: string | null;
}

/** The 409 createJwDcOutward answers with when return-to-vendor pieces are
 *  waiting on a PO line of this challan. Identical test to the OSP path
 *  (delivery-challans/routes/create.tsx). */
function isRtvPendingConflict(e: unknown): e is ApiError & { details: RtvPendingConflictDetails } {
  return (
    e instanceof ApiError &&
    e.status === 409 &&
    typeof e.details === 'object' &&
    e.details !== null &&
    (e.details as { kind?: unknown }).kind === 'rtv_pending'
  );
}

/** ADR-217 phase 4 — everything the page needs about those pieces: the rows on
 *  the lines being sent, the tick, and whether Save must wait. */
export function useOutwardRtv(poId: string | null, lines: OutwardLineUi[]) {
  // NCs the server named in a 409, kept so the notice still shows when the check
  // below failed or ran before QC disposed the NC.
  const [conflictRows, setConflictRows] = useState<RtvPanelRow[]>([]);
  // The id set the store ticked against ("a,b,c", sorted). A tick holds only
  // for the exact set it was given on.
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  // Pieces from this PO waiting to go back to the vendor (an RTV NC disposed and
  // not yet sent, or one still awaiting QC's decision). This fetch is only the
  // early warning; the server is the guard (409 rtv_pending on Save). Skipped
  // until a PO is picked, so an unopened form asks nothing and Save is never held
  // by a check that is not running.
  const rtv = useRtvCandidates(poId ?? undefined, Boolean(poId));
  // The PO lines this challan sends — the SAME set the page's save builds the
  // payload from. Only NCs on these lines can hold the save.
  const sendingLines = useMemo(() => lines.filter((l) => l.checked && l.sendQty > 0), [lines]);
  // Notice rows: fetched candidates merged with any the server named in a 409
  // (by ncId, the 409 being fresher), narrowed to the lines being sent.
  const rows = useMemo<RtvPanelRow[]>(() => {
    const byId = new Map<string, RtvPanelRow>();
    for (const c of rtv.data?.items ?? []) {
      byId.set(c.ncId, {
        ncId: c.ncId,
        ncCode: c.ncCode,
        itemCodeLabel: itemCodeWithRev(c.itemCode ?? c.itemCodeText, c.itemRevision),
        rejectedQty: c.rejectedQty,
        openQty: c.openQty,
        state: c.state,
        poLineId: c.purchaseOrderLineId,
      });
    }
    for (const r of conflictRows) {
      const had = byId.get(r.ncId);
      byId.set(r.ncId, had ? { ...had, state: r.state, poLineId: r.poLineId } : r);
    }
    const sendingLineIds = new Set(sendingLines.map((l) => l.purchaseOrderLineId));
    return [...byId.values()].filter((r) => r.poLineId !== null && sendingLineIds.has(r.poLineId));
  }, [rtv.data, conflictRows, sendingLines]);
  const shownKey = useMemo(
    () =>
      rows
        .map((r) => r.ncId)
        .sort()
        .join(','),
    [rows],
  );
  const confirmed = rows.length > 0 && confirmedKey === shownKey;
  // The shown set changed after the tick (a new NC appeared, a row was
  // unticked or its Send Now cleared): the tick no longer covers what is on
  // screen — clear it.
  useEffect(() => {
    if (confirmedKey !== null && confirmedKey !== shownKey) setConfirmedKey(null);
  }, [confirmedKey, shownKey]);

  return {
    rows,
    confirmed,
    loading: rtv.isLoading,
    failed: rtv.isError,
    // Save waits while the check is genuinely in flight (isLoading is false once
    // it errors or while it is disabled, so this cannot hang); a failed check
    // does NOT block — the server still refuses with 409 rtv_pending.
    blocks: rtv.isLoading || (rows.length > 0 && !confirmed),
    setConfirmed: (checked: boolean): void => setConfirmedKey(checked ? shownKey : null),
    /** The waiting-deviation notice belongs to the PO it was raised for — drop
     *  it (and any tick) when the PO changes. */
    reset: (): void => {
      setConflictRows([]);
      setConfirmedKey(null);
    },
    /** QC disposed an NC on this PO between opening the form and Save (or the
     *  check above failed): show the NCs the server named, and make the store
     *  tick again. Any other error is left alone. */
    absorbConflict: (e: unknown): void => {
      if (!isRtvPendingConflict(e)) return;
      const named = e.details.ncs.map(
        (n): RtvPanelRow => ({
          ncId: n.ncId,
          ncCode: n.ncCode,
          itemCodeLabel: n.itemCode ?? '—',
          rejectedQty: n.rejectedQty,
          // The 409 payload has no netted figure, so the gross one stands in
          // until the candidate refetch replaces it. Overstates a partly
          // recovered deviation for a moment; never understates.
          openQty: n.rejectedQty,
          state: n.state,
          poLineId: n.poLineId,
        }),
      );
      setConflictRows((prev) => [
        ...prev.filter((p) => !named.some((x) => x.ncId === p.ncId)),
        ...named,
      ]);
      setConfirmedKey(null);
      void rtv.refetch();
    },
  };
}

export function OutwardRtvNotice({
  rows,
  confirmed,
  onConfirmedChange,
}: {
  rows: RtvPanelRow[];
  confirmed: boolean;
  onConfirmedChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <Banner
      tone="warn"
      role="alert"
      title="These pieces from this PO are waiting to go back to the vendor:"
    >
      <ul style={{ margin: 'var(--sp-1) 0 var(--sp-2)', paddingLeft: 18 }}>
        {rows.map((r) => (
          <li key={r.ncId}>
            <b className="mono fw-700">{r.ncCode}</b> —{' '}
            <b className="mono fw-700" style={{ color: 'var(--text)' }}>
              {r.itemCodeLabel}
            </b>{' '}
            — {rtvOpenQty(r)} pcs — {RTV_CANDIDATE_STATE_LABELS[r.state]}
          </li>
        ))}
      </ul>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
        />
        These are new pieces, not the ones waiting to go back
        <span className="req">★</span>
      </label>
    </Banner>
  );
}
