// Edit OSP Delivery Challan (ADR-202 Phase 3) — the EXISTING-DC sibling of
// create.tsx. A saved DC's PO, vendor and set of items are fixed, so this screen
// changes only the header travel details (DC Date · Transporter · Vehicle No.)
// and, per existing line, the challan Qty / Material / DC Remarks, capped the
// same way the create form caps a new line (the `useDcSendable` "can send now"
// preview, plus the line's current qty).
//
// Edit-approval: when the gate is on and this DC is live, the PATCH returns a
// DocumentEditStagedResult instead of the updated DC — nothing changed, the edit
// is waiting for approval. We show a neutral "Sent for approval" banner and
// return to the detail page, whose fields then carry the amber pending chips.

import type { DeliveryChallanWithLines } from '@innovic/shared';
import { qtyUomProblem, valuesEqual } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { useSaveKey } from '@/lib/use-save-key';
import { isStagedResult } from '@/modules/document-edits/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, PageState, useSaveShortcut } from '@/ui/layout';
import {
  type UpdateDeliveryChallanInput,
  useDcSendable,
  useDeliveryChallan,
  useFetchDeliveryChallan,
  useUpdateDeliveryChallan,
} from '../api';
import {
  DcEditLineTable,
  dcEditLineCap,
  type DcEditLineCard,
} from '../components/dc-edit-line-table';

// ADR-226 — the fields THIS screen can edit, plus `lines` as one unit, and what
// the user calls each one (docs/NAMING.md, so the notice says "Vehicle No.",
// never `vehicleNo`).
//
// Everything else on a saved DC — the PO, the vendor, the DC No., the set of
// items — is a read-only fact, so none of it may be sent as an edit.
//
// `lines` IS in the list, as ONE value: the record the hook compares against
// carries `lines` as a digest string instead of the array, because the server's
// schema requires `lines` (min 1) on every DC edit — so there is no such thing
// as a header-only request — and because the most ordinary DC edit of all, a
// Challan Qty correction with no header change, would otherwise be refused as
// "nothing changed".
const DC_EDITABLE = ['dcDate', 'transport', 'vehicleNo', 'lines'] as const;

const DC_LABELS: Record<string, string> = {
  dcDate: 'DC Date',
  transport: 'Transporter',
  vehicleNo: 'Vehicle No.',
  lines: 'The challan lines',
};

/** A saved DC line, as much of it as the edit needs. `qty` arrives as a numeric
 *  STRING ("4.000") on the read shape; `valuesEqual` compares numerics
 *  numerically, so "4.000" and 4 are the same value. */
interface DcSavedLine {
  id: string;
  qty: string | number;
  materialText: string | null;
  dcRemarks: string | null;
  itemCode?: string | null;
  itemCodeText?: string | null;
}

/** What THIS user changed on a line — only the attributes they actually touched.
 *  An attribute that is absent here is left to whatever the line holds, which is
 *  what makes the retry below a real per-line merge rather than a photograph. */
interface DcLineEdit {
  qty?: number;
  materialText?: string | null;
  dcRemarks?: string | null;
}

/** The boxes this user changed, per line, by the SHARED equality rule
 *  (`valuesEqual` in @innovic/shared — the same one the server's History diff
 *  uses, so "changed" means one thing on both sides). */
function dcLineEdits(
  cards: readonly DcEditLineCard[],
  savedLines: readonly DcSavedLine[],
): Map<string, DcLineEdit> {
  const byId = new Map(savedLines.map((l) => [l.id, l]));
  const edits = new Map<string, DcLineEdit>();
  for (const c of cards) {
    const saved = byId.get(c.id);
    if (!saved) continue;
    const edit: DcLineEdit = {};
    const qty = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (!valuesEqual(saved.qty, qty)) edit.qty = qty;
    const material = c.materialText.trim();
    if (!valuesEqual(saved.materialText, material)) edit.materialText = material || null;
    const remarks = c.dcRemarks.trim();
    if (!valuesEqual(saved.dcRemarks, remarks)) edit.dcRemarks = remarks || null;
    if (Object.keys(edit).length > 0) edits.set(c.id, edit);
  }
  return edits;
}

/** The request's line array: every saved line by `id` (the set is fixed — the
 *  server refuses an added or removed line), `qty` on every entry because the
 *  server's schema requires it there, and the two text attributes ONLY where this
 *  user changed them. `null` clears one.
 *
 *  `base` is the lines the payload is built ON. First attempt: the DC as this
 *  screen loaded it. After a 409: the DC as it is NOW — so another person's
 *  change to a line this user never touched survives, which is the whole point
 *  of §20.4. */
function dcPayloadLines(
  base: readonly DcSavedLine[],
  edits: Map<string, DcLineEdit>,
): UpdateDeliveryChallanInput['lines'] {
  return base.map((l) => {
    const e = edits.get(l.id);
    return {
      id: l.id,
      qty: e?.qty ?? Number(l.qty),
      ...(e && 'materialText' in e ? { materialText: e.materialText } : {}),
      ...(e && 'dcRemarks' in e ? { dcRemarks: e.dcRemarks } : {}),
    };
  });
}

/** The lines as one comparable, readable value — what the diff tests and what
 *  the 3-second notice prints. It must move whenever anything the screen can
 *  edit moves, or an edit would be dropped as "nothing changed", so it carries
 *  the qty, the Material and the DC Remarks of every line in order. */
function dcLinesDigest(base: readonly DcSavedLine[], edits: Map<string, DcLineEdit>): string {
  const rows = base.map((l) => {
    const e = edits.get(l.id);
    const qty = e?.qty ?? Number(l.qty);
    const material = (e && 'materialText' in e ? e.materialText : l.materialText) ?? '';
    const remarks = (e && 'dcRemarks' in e ? e.dcRemarks : l.dcRemarks) ?? '';
    const item = l.itemCode ?? l.itemCodeText ?? '—';
    const parts = [`${qty} × ${item}`];
    if (material.trim()) parts.push(`(${material.trim()})`);
    if (remarks.trim()) parts.push(remarks.trim());
    return parts.join(' ');
  });
  return `${rows.length} line${rows.length === 1 ? '' : 's'} · ${rows.join(' · ')}`;
}

export const deliveryChallanEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'delivery-challans/$id/edit',
  component: DeliveryChallanEditPage,
});

function DeliveryChallanEditPage(): React.JSX.Element {
  const { id } = deliveryChallanEditRoute.useParams();
  const navigate = useNavigate();
  const { data: dc, isLoading, isError, error } = useDeliveryChallan(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  const saveKey = useSaveKey();
  const update = useUpdateDeliveryChallan(id, saveKey);
  const fetchDc = useFetchDeliveryChallan();
  // The DC as the conflict hook compares it: the same record with the line ARRAY
  // replaced by one digest string, plus `freshDc` — the DC as it is NOW, filled
  // only when a save was refused, so the retry's line array can be built on the
  // other person's version instead of on the photograph this screen opened with.
  const freshDc = useRef<DeliveryChallanWithLines | null>(null);
  const noEdits = useMemo(() => new Map<string, DcLineEdit>(), []);
  const conflictRecord = useMemo(
    () => (dc ? { ...dc, lines: dcLinesDigest(dc.lines, noEdits) } : undefined),
    [dc, noEdits],
  );
  // ADR-226 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes to
  // this one DC, so the user is told the moment somebody else saves it rather
  // than after typing into a stale form.
  //
  // It REPLACES two things this screen used to do by hand: `expectedUpdatedAt:
  // dc.updatedAt`, read at SAVE time — which is the version the query holds NOW,
  // so a background refetch (window focus, an invalidation) pulled in the other
  // person's newer stamp and silently defeated the check, exactly as the comment
  // in lib/use-opened-version.ts warns — and a per-field `dirty` comparison
  // written in this file, now computed by the shared rule instead.
  const conflict = useEditConflict({
    table: 'delivery_challans',
    id,
    record: conflictRecord,
    refetch: async () => {
      const latest = await fetchDc(id);
      freshDc.current = latest;
      return { ...latest, lines: dcLinesDigest(latest.lines, noEdits) };
    },
    editableKeys: DC_EDITABLE,
    label: (f) => DC_LABELS[f] ?? f,
    noun: 'DC',
  });

  const goBack = useCallback(
    () => void navigate({ to: '/delivery-challans/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  // Caps come from the PO's sendable lines (same source the create form uses).
  // An NC return challan has no PO, so this stays empty and caps fall back to the
  // line's current qty.
  const { data: sendablePreview } = useDcSendable(dc?.purchaseOrderId ?? undefined);
  const sendable = useMemo(() => sendablePreview?.lines ?? [], [sendablePreview]);

  const [dcDate, setDcDate] = useState('');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [cards, setCards] = useState<DcEditLineCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);

  // Seed the form from the loaded DC, once (an id change reloads the page).
  const seeded = useRef(false);
  useEffect(() => {
    if (!dc || seeded.current) return;
    seeded.current = true;
    setDcDate(dc.dcDate);
    setTransport(dc.transport ?? '');
    setVehicleNo(dc.vehicleNo ?? '');
    setCards(
      dc.lines.map((l) => ({
        id: l.id,
        qty: String(Number(l.qty)),
        materialText: l.materialText ?? '',
        dcRemarks: l.dcRemarks ?? '',
      })),
    );
  }, [dc]);

  const savedById = useMemo(() => new Map((dc?.lines ?? []).map((l) => [l.id, l])), [dc]);
  const slByPoLine = useMemo(
    () => new Map(sendable.map((l) => [l.purchaseOrderLineId, l])),
    [sendable],
  );

  // Live per-line validation — a qty over its cap, below 1, or with the wrong
  // number of decimals for its unit is a hard block (no clamp), mirroring
  // create.tsx. The server re-checks regardless.
  const lineErrors = new Map<string, string>();
  for (const c of cards) {
    const saved = savedById.get(c.id);
    if (!saved) continue;
    const raw = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (Number.isNaN(raw) || raw <= 0) {
      lineErrors.set(c.id, 'Enter a quantity of 1 or more.');
      continue;
    }
    const uomProblem = qtyUomProblem(raw, saved.uom, 'Challan Qty');
    if (uomProblem) {
      lineErrors.set(c.id, uomProblem);
      continue;
    }
    const sl = saved.purchaseOrderLineId ? slByPoLine.get(saved.purchaseOrderLineId) : undefined;
    const cap = dcEditLineCap(Number(saved.qty), sl);
    if (raw > cap) {
      lineErrors.set(c.id, `Challan Qty cannot be more than ${cap}.`);
    }
  }

  function patchLine(lineId: string, patch: Partial<Omit<DcEditLineCard, 'id'>>): void {
    setCards((cs) => cs.map((c) => (c.id === lineId ? { ...c, ...patch } : c)));
  }

  // What this user changed, by the SHARED rule (`valuesEqual` / `changedKeys` in
  // @innovic/shared — the one the server's own History diff uses). The old
  // hand-rolled comparison in this file is gone: it compared `c.qty.trim()`
  // against `String(Number(saved.qty))` and `''` against `null`, which is the
  // same question answered a second, slightly different way.
  const header = useMemo(
    () => ({
      dcDate,
      transport: transport.trim() || null,
      vehicleNo: vehicleNo.trim() || null,
    }),
    [dcDate, transport, vehicleNo],
  );
  const lineEdits = useMemo(() => dcLineEdits(cards, dc?.lines ?? []), [cards, dc]);
  const dirty = useMemo(() => {
    if (!dc) return false;
    if (lineEdits.size > 0) return true;
    return (
      !valuesEqual(dc.dcDate, header.dcDate) ||
      !valuesEqual(dc.transport, header.transport) ||
      !valuesEqual(dc.vehicleNo, header.vehicleNo)
    );
  }, [dc, header, lineEdits]);

  const canSave =
    Boolean(dc) &&
    Boolean(dcDate) &&
    cards.length > 0 &&
    lineErrors.size === 0 &&
    dirty &&
    !update.isPending;

  async function submit(): Promise<void> {
    setErr(null);
    if (!dc) return;
    if (!dcDate) return setErr('Enter a DC Date.');
    if (lineErrors.size > 0) return setErr('Fix the highlighted lines before saving.');

    // `current` is what the form holds; the hook reduces it to the changed keys.
    // `lines` is the DIGEST, so a qty / Material / DC Remarks change with no
    // header change is still a change (the hook refuses an empty save).
    const current = { ...header, lines: dcLinesDigest(dc.lines, lineEdits) };
    freshDc.current = null; // only a conflict on THIS save may fill it
    try {
      const saved = await conflict.save(current, (payload, expectedUpdatedAt) => {
        // Only the header boxes this user changed. `payload.lines` is the digest,
        // never the array — it is not sent; the real array is rebuilt below.
        return update.mutateAsync({
          ...(payload.dcDate !== undefined ? { dcDate: payload.dcDate } : {}),
          ...(payload.transport !== undefined ? { transport: payload.transport } : {}),
          ...(payload.vehicleNo !== undefined ? { vehicleNo: payload.vehicleNo } : {}),
          // The lines are built fresh on each attempt: on the retry `freshDc`
          // holds the DC as it is NOW, so the other person's line change
          // survives and only the boxes THIS user changed are written over it.
          lines: dcPayloadLines((freshDc.current ?? dc).lines, lineEdits),
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
      });
      // null = nothing actually changed; the user has been told and nothing was
      // written. Stay on the form.
      if (saved === null) return;
      if (isStagedResult(saved)) {
        // The gate is on and this DC is live: nothing changed — the edit is
        // waiting for approval. Say so, then return to the detail (pending chips).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(
          () => void navigate({ to: '/delivery-challans/$id', params: { id }, replace: true }),
        );
        return;
      }
      exit.leave(
        () => void navigate({ to: '/delivery-challans/$id', params: { id }, replace: true }),
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
        You do not have permission to edit DCs. Ask an admin.
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
  if (isError || !dc) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red2)' }}>
        {error instanceof Error ? error.message : 'Could not load the DC. Try again.'}
      </div>
    );
  }

  // Only an issued DC with nothing received yet is editable — same guard the
  // detail page's Edit link applies (and the server re-checks).
  if (dc.status !== 'issued') {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        This DC is {dc.status} and cannot be edited.
      </div>
    );
  }
  if (dc.receipts.length > 0) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        This DC has receipts recorded against it and can no longer be edited.
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        title={`Edit Delivery Challan — ${dc.code}`}
        backLabel="Back to Delivery Challan"
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
                  ? 'Fix the highlighted lines — Challan Qty is over what the line allows.'
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

      <Panel title="DC Details">
        <FormGrid>
          {/* PO No. / Vendor / DC No. are fixed on an existing DC. */}
          <FormField label={dc.ncId ? 'NC No.' : 'PO No.'} size="md" htmlFor="dcPo">
            <input
              id="dcPo"
              className="innovic-input"
              readOnly
              value={dc.poCode ?? dc.poCodeText ?? '—'}
            />
          </FormField>
          <FormField label="DC No." size="sm" htmlFor="dcNo">
            <input id="dcNo" className="innovic-input" readOnly value={dc.code} />
          </FormField>
          <FormField label="DC Date" size="sm" htmlFor="dcDate">
            <input
              id="dcDate"
              type="date"
              className="innovic-input"
              value={dcDate}
              onChange={(e) => setDcDate(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Vendor" size="md" htmlFor="dcVendor">
            <input
              id="dcVendor"
              className="innovic-input"
              readOnly
              value={dc.vendorName ?? dc.vendorCodeText ?? '—'}
            />
          </FormField>
          <FormField label="Transporter" size="md" htmlFor="dcTransport">
            <input
              id="dcTransport"
              className="innovic-input"
              autoComplete="off"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="Transporter name"
            />
          </FormField>
          <FormField label="Vehicle No." size="sm" htmlFor="dcVehicleNo">
            <input
              id="dcVehicleNo"
              className="innovic-input"
              autoComplete="off"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="GJ-01-AB-1234"
            />
          </FormField>
        </FormGrid>
      </Panel>

      <Panel title="Items">
        <DcEditLineTable
          cards={cards}
          savedLines={dc.lines}
          sendable={sendable}
          lineErrors={lineErrors}
          onPatch={patchLine}
        />
      </Panel>
    </div>
  );
}
