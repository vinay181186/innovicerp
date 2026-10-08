// Edit Customer Dispatch (ADR-202 Phase 3) — the EXISTING-dispatch sibling of
// create.tsx. A dispatch's SO and its set of items are fixed once saved, so this
// screen changes only the header travel details (Dispatch Date · Transporter ·
// Vehicle No. · Remarks) and each line's Dispatch Qty, capped the same way the
// create form caps a new line.
//
// Edit-approval: when the gate is on and this dispatch is live, the PATCH returns
// a DocumentEditStagedResult instead of the updated dispatch — nothing changed,
// the edit is waiting for approval. We show a neutral "Sent for approval" banner
// and return to the detail page, whose fields now carry the amber pending chips.

import type { CustomerDispatchDetail } from '@innovic/shared';
import { valuesEqual } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isStagedResult } from '@/modules/document-edits/api';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, PageState, useSaveShortcut } from '@/ui/layout';
import {
  useDispatchDetail,
  useDispatchableSo,
  useFetchDispatchDetail,
  useUpdateCustomerDispatch,
} from '../api';
import {
  DispatchEditLineTable,
  editLineCap,
  type EditLineCard,
} from '../components/dispatch-edit-line-table';

// ADR-225 — the fields THIS screen can edit, plus `lines` as one unit, and what
// the user calls each one (docs/NAMING.md, so the notice says "Vehicle No.",
// never `vehicleNo`).
//
// Everything else on a saved dispatch — the SO, the Dispatch No., the set of
// items — is a read-only fact, so none of it may be sent as an edit.
//
// `lines` IS in the list, as ONE value: the record the hook compares against
// carries `lines` as a digest string instead of the array, because the server's
// schema requires `lines` (min 1) on every dispatch edit — so there is no such
// thing as a header-only request — and because the most ordinary dispatch edit
// of all, a Dispatch Qty correction with no header change, would otherwise be
// refused as "nothing changed".
const DISPATCH_EDITABLE = ['dispatchDate', 'transport', 'vehicleNo', 'remarks', 'lines'] as const;

const DISPATCH_LABELS: Record<string, string> = {
  dispatchDate: 'Dispatch Date',
  transport: 'Transporter',
  vehicleNo: 'Vehicle No.',
  remarks: 'Remarks',
  lines: 'The Dispatch Qty',
};

/** A saved dispatch line, as much of it as the edit needs. */
interface DispatchSavedLine {
  id: string;
  qty: number;
  itemCode?: string | null;
  itemCodeText?: string | null;
}

/** The Dispatch Qty THIS user changed, per line, by the SHARED equality rule
 *  (`valuesEqual` in @innovic/shared — the same one the server's History diff
 *  uses). Qty is the only editable fact on a dispatch line. */
function dispatchQtyEdits(
  cards: readonly EditLineCard[],
  savedLines: readonly DispatchSavedLine[],
): Map<string, number> {
  const byId = new Map(savedLines.map((l) => [l.id, l]));
  const edits = new Map<string, number>();
  for (const c of cards) {
    const saved = byId.get(c.id);
    if (!saved) continue;
    const qty = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (!valuesEqual(saved.qty, qty)) edits.set(c.id, qty);
  }
  return edits;
}

/** The request's line array: every saved line by `id` (the set is fixed — the
 *  server refuses an added or removed line) with its qty.
 *
 *  `base` is the lines the payload is built ON. First attempt: the dispatch as
 *  this screen loaded it. After a 409: the dispatch as it is NOW — so another
 *  person's qty change on a line this user never touched survives, which is the
 *  whole point of §20.4. */
function dispatchPayloadLines(
  base: readonly DispatchSavedLine[],
  edits: Map<string, number>,
): { id: string; qty: number }[] {
  return base.map((l) => ({ id: l.id, qty: edits.get(l.id) ?? l.qty }));
}

/** The lines as one comparable, readable value — what the diff tests and what
 *  the 3-second notice prints. */
function dispatchLinesDigest(
  base: readonly DispatchSavedLine[],
  edits: Map<string, number>,
): string {
  const rows = base.map(
    (l) => `${edits.get(l.id) ?? l.qty} × ${l.itemCode ?? l.itemCodeText ?? '—'}`,
  );
  return `${rows.length} line${rows.length === 1 ? '' : 's'} · ${rows.join(' · ')}`;
}

export const customerDispatchEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches/$id/edit',
  component: CustomerDispatchEditPage,
});

function CustomerDispatchEditPage(): React.JSX.Element {
  const { id } = customerDispatchEditRoute.useParams();
  const navigate = useNavigate();
  const { data: d, isLoading, isError, error } = useDispatchDetail(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dispatch_create');
  const saveKey = useSaveKey();
  const update = useUpdateCustomerDispatch(id, saveKey);
  const fetchDispatch = useFetchDispatchDetail();
  // The dispatch as the conflict hook compares it: the same record with the line
  // ARRAY replaced by one digest string, plus `freshDispatch` — the dispatch as
  // it is NOW, filled only when a save was refused, so the retry's line array can
  // be built on the other person's version instead of on the photograph this
  // screen opened with.
  const freshDispatch = useRef<CustomerDispatchDetail | null>(null);
  const noQtyEdits = useMemo(() => new Map<string, number>(), []);
  const conflictRecord = useMemo(
    () => (d ? { ...d, lines: dispatchLinesDigest(d.lines, noQtyEdits) } : undefined),
    [d, noQtyEdits],
  );
  // ADR-225 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes to
  // this one dispatch, so the user is told the moment somebody else saves it
  // rather than after typing into a stale form.
  //
  // This screen sent NO version token at all before, so a save simply overwrote
  // whatever had changed since it opened — and a dispatch save renumbers the
  // document and re-books the goods out, so it is not just a lost field. It also
  // had a per-field `dirty` comparison written in this file; that is now the
  // shared rule instead of a second copy of it.
  const conflict = useEditConflict({
    table: 'customer_dispatches',
    id,
    record: conflictRecord,
    refetch: async () => {
      const latest = await fetchDispatch(id);
      freshDispatch.current = latest;
      return { ...latest, lines: dispatchLinesDigest(latest.lines, noQtyEdits) };
    },
    editableKeys: DISPATCH_EDITABLE,
    label: (f) => DISPATCH_LABELS[f] ?? f,
    noun: 'dispatch',
  });

  const goBack = useCallback(
    () => void navigate({ to: '/customer-dispatches/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  // Caps come from the SO's dispatchable lines (same source the create form uses).
  const { data: dispatchable } = useDispatchableSo(d?.salesOrderId);
  const dispLines = useMemo(() => dispatchable?.lines ?? [], [dispatchable]);

  const [dispatchDate, setDispatchDate] = useState('');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [cards, setCards] = useState<EditLineCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);

  // Seed the form from the loaded dispatch, once (id change reloads the page).
  const seeded = useRef(false);
  useEffect(() => {
    if (!d || seeded.current) return;
    seeded.current = true;
    setDispatchDate(d.dispatchDate);
    setTransport(d.transport ?? '');
    setVehicleNo(d.vehicleNo ?? '');
    setRemarks(d.remarks ?? '');
    setCards(d.lines.map((l) => ({ id: l.id, qty: String(l.qty) })));
  }, [d]);

  const savedById = useMemo(() => new Map((d?.lines ?? []).map((l) => [l.id, l])), [d]);
  const dlBySoLine = useMemo(
    () => new Map(dispLines.map((l) => [l.salesOrderLineId, l])),
    [dispLines],
  );

  // Live per-line validation — a qty over its cap is a hard block (no clamp),
  // mirroring create.tsx. The server re-checks regardless.
  const lineErrors = new Map<string, string>();
  let anyPositiveQty = false;
  for (const c of cards) {
    const saved = savedById.get(c.id);
    if (!saved) continue;
    const raw = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (Number.isNaN(raw) || raw < 0) {
      lineErrors.set(c.id, 'Enter a valid quantity.');
      continue;
    }
    const dl = saved.salesOrderLineId ? (dlBySoLine.get(saved.salesOrderLineId) ?? null) : null;
    const cap = editLineCap(saved.qty, dl);
    if (raw > cap) {
      lineErrors.set(c.id, `Dispatch Qty cannot be more than ${cap}.`);
      continue;
    }
    if (raw > 0) anyPositiveQty = true;
  }

  function patchLine(lineId: string, qty: string): void {
    setCards((cs) => cs.map((c) => (c.id === lineId ? { ...c, qty } : c)));
  }

  // The Dispatch Qty this user changed, per line. The array itself is built at
  // save time, on the dispatch as it is then — see the save below.
  const qtyEdits = useMemo(() => dispatchQtyEdits(cards, d?.lines ?? []), [cards, d]);

  // What this user changed, by the SHARED rule (`valuesEqual` / `changedKeys` in
  // @innovic/shared — the one the server's own History diff uses). The old
  // hand-rolled comparison in this file is gone: it compared `c.qty.trim()`
  // against `String(saved.qty)` and `''` against `null`, which is the same
  // question answered a second, slightly different way.
  const header = useMemo(
    () => ({
      dispatchDate,
      transport: transport.trim() || null,
      vehicleNo: vehicleNo.trim() || null,
      remarks: remarks.trim() || null,
    }),
    [dispatchDate, transport, vehicleNo, remarks],
  );
  const dirty = useMemo(() => {
    if (!d) return false;
    if (qtyEdits.size > 0) return true;
    return (
      !valuesEqual(d.dispatchDate, header.dispatchDate) ||
      !valuesEqual(d.transport, header.transport) ||
      !valuesEqual(d.vehicleNo, header.vehicleNo) ||
      !valuesEqual(d.remarks, header.remarks)
    );
    // `qtyEdits`, not a `linesChanged` flag: the map IS the per-line answer,
    // and its size is what this memo reads.
  }, [d, header, qtyEdits]);

  const canSave =
    Boolean(d) &&
    cards.length > 0 &&
    lineErrors.size === 0 &&
    anyPositiveQty &&
    dirty &&
    !update.isPending;

  async function submit(): Promise<void> {
    setErr(null);
    if (!d) return;
    if (lineErrors.size > 0) return setErr('Fix the highlighted lines before saving.');

    if (!dispatchPayloadLines(d.lines, qtyEdits).some((l) => l.qty > 0)) {
      return setErr('Enter a Dispatch Qty on at least one line.');
    }

    // `current` is what the form holds; the hook reduces it to the changed keys.
    // `lines` is the DIGEST, so a qty change with no header change is still a
    // change (the hook refuses an empty save).
    const current = { ...header, lines: dispatchLinesDigest(d.lines, qtyEdits) };
    freshDispatch.current = null; // only a conflict on THIS save may fill it
    try {
      const saved = await conflict.save(current, (payload, expectedUpdatedAt) => {
        // Only the header boxes this user changed. `payload.lines` is the digest,
        // never the array — it is not sent; the real array is rebuilt below.
        return update.mutateAsync({
          ...(payload.dispatchDate !== undefined ? { dispatchDate: payload.dispatchDate } : {}),
          ...(payload.transport !== undefined ? { transport: payload.transport } : {}),
          ...(payload.vehicleNo !== undefined ? { vehicleNo: payload.vehicleNo } : {}),
          ...(payload.remarks !== undefined ? { remarks: payload.remarks } : {}),
          // The lines are built fresh on each attempt: on the retry
          // `freshDispatch` holds the dispatch as it is NOW, so another person's
          // qty change on a line this user never touched survives.
          lines: dispatchPayloadLines((freshDispatch.current ?? d).lines, qtyEdits),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
      });
      // null = nothing actually changed; the user has been told and nothing was
      // written. Stay on the form.
      if (saved === null) return;
      if (isStagedResult(saved)) {
        // The gate is on and this dispatch is live: nothing changed — the edit is
        // waiting for approval. Say so, then return to the detail (pending chips).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(
          () => void navigate({ to: '/customer-dispatches/$id', params: { id }, replace: true }),
        );
        return;
      }
      exit.leave(
        () => void navigate({ to: '/customer-dispatches/$id', params: { id }, replace: true }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save changes. Try again.');
    }
  }

  const submitRef = useRef(submit);
  submitRef.current = submit;
  const runSave = useCallback(() => void submitRef.current(), []);
  useSaveShortcut(runSave, canSave);

  if (eff && !perms.view) return <PageState as="page" state="noaccess" />;
  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to edit Dispatches. Ask an admin.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !d) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load the dispatch. Try again.'}
      </div>
    );
  }

  // A cancelled dispatch is reversed and read-only — never editable.
  if (d.status === 'cancelled') {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        This dispatch is cancelled and cannot be edited.
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        title={`Edit Customer Dispatch — ${d.code}`}
        backLabel="Back to Dispatch"
        onBack={goBack}
        dirty={dirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSave}
              title={
                lineErrors.size > 0
                  ? 'Fix the highlighted lines — Dispatch Qty is over what the line allows.'
                  : undefined
              }
              onClick={() => void submit()}
            >
              {update.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      />

      {err ? (
        <Banner tone="error" role="alert">
          {err}
        </Banner>
      ) : null}
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}

      <Panel title="Dispatch Details">
        <FormGrid>
          {/* SO No. and Dispatch No. are fixed on an existing dispatch. */}
          <FormField label="SO No." size="lg" htmlFor="dispatchSo">
            <input id="dispatchSo" className="innovic-input" readOnly value={d.soCode ?? '—'} />
          </FormField>
          <FormField label="Dispatch Date" size="sm" htmlFor="dispatchDate">
            <input
              id="dispatchDate"
              type="date"
              className="innovic-input"
              value={dispatchDate}
              onChange={(e) => setDispatchDate(e.target.value)}
            />
          </FormField>
          <FormField label="Dispatch No." size="sm" htmlFor="dispatchNo">
            <input id="dispatchNo" className="innovic-input" readOnly value={d.code} />
          </FormField>

          <FormField label="Transporter" size="lg" htmlFor="transport">
            <input
              id="transport"
              className="innovic-input"
              autoComplete="off"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
            />
          </FormField>
          <FormField label="Vehicle No." size="lg" htmlFor="vehicleNo">
            <input
              id="vehicleNo"
              className="innovic-input"
              autoComplete="off"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
            />
          </FormField>

          <FormField label="Remarks" size="full" htmlFor="remarks">
            <input
              id="remarks"
              className="innovic-input"
              autoComplete="off"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Items">
        <DispatchEditLineTable
          cards={cards}
          savedLines={d.lines}
          dispatchable={dispLines}
          lineErrors={lineErrors}
          onPatch={patchLine}
        />
      </Panel>
    </div>
  );
}
