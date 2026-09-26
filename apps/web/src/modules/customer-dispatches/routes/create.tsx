// New Customer Dispatch — pick an SO, then add dispatch lines. The user types an
// item code; the item name and the ordered / ready / dispatched / pending /
// reserved / available metrics auto-fetch from the SO's dispatchable lines.
// Dispatch is capped at each line's PENDING qty (ADR-180): a reservation no
// longer removes stock from the shelf, so the dispatch draws on this line's
// reservation first and then on free stock.
//
// Create-page pattern (ERPNext gap report 2026-09-26): sticky PageHeader with
// Cancel + Save top-right (Ctrl+S saves), the header on the 12-column grid, and
// the shared line-item table. Errors show right under the header, where Save
// is. "Add all pending lines" pre-fills one card per pending SO line (and runs
// once on arrival with ?so=). The payload and the mutation are unchanged; the qty cap moved
// from "available" to "pending" with ADR-180 (see the validation block below).

import type { DispatchableLine } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { authenticatedRoute } from '@/routes/_authenticated';
import { todayLocal } from '@/lib/date';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import {
  useCreateDispatch,
  useDispatchableSo,
  useFinanceSoOptions,
  useNextDispatchCode,
} from '../api';
import { DispatchLineTable, type LineCard } from '../components/dispatch-line-table';

// Optional ?so=<salesOrderId> preselects the SO (e.g. arriving from the
// Assembly Tracker's batch Dispatch button).
const newDispatchSearchSchema = z.object({ so: z.string().uuid().optional() });

export const customerDispatchNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches/new',
  validateSearch: newDispatchSearchSchema,
  component: CustomerDispatchNewPage,
});

function todayStr(): string {
  return todayLocal();
}

function CustomerDispatchNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { so: preselectSo } = customerDispatchNewRoute.useSearch();
  const { data: soOpts } = useFinanceSoOptions();
  const { data: next } = useNextDispatchCode();
  const create = useCreateDispatch();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dispatch_create');
  // Where Cancel goes, and where ESC -> Exit goes. Every other way off the
  // screen (Back link, breadcrumb, browser Back) gets "Are you sure?".
  const goBack = useCallback(() => void navigate({ to: '/customer-dispatches' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const [soId, setSoId] = useState(preselectSo ?? '');
  const [dispatchDate, setDispatchDate] = useState(todayStr());
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [cards, setCards] = useState<LineCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const nextId = useRef(1);

  const { data: dispatchable } = useDispatchableSo(soId || undefined);

  // Reset the line cards whenever the SO changes — dispatchable lines differ.
  useEffect(() => {
    setCards([]);
    setErr(null);
  }, [soId]);

  const lines: DispatchableLine[] = dispatchable?.lines ?? [];

  // Resolve a card's picked SO-line id to its dispatchable line.
  function resolveLine(soLineId: string | null): DispatchableLine | null {
    if (!soLineId) return null;
    return lines.find((l) => l.salesOrderLineId === soLineId) ?? null;
  }

  // FLOW HELPER (frontend only): one card per SO line that still has a
  // pending qty and is not already on a card, pre-filled with the most the
  // live check below allows (pending, capped at what can go now). Every card
  // stays editable; a line that can send nothing right now is added blank so
  // the user still sees it.
  function addAllPendingLines(): void {
    setCards((cs) => {
      const onCards = new Set(cs.map((c) => c.soLineId));
      const added: LineCard[] = lines
        .filter((l) => l.pendingQty > 0 && !onCards.has(l.salesOrderLineId))
        .map((l) => {
          const cap = Math.min(l.availableQty, l.pendingQty);
          return {
            id: nextId.current++,
            soLineId: l.salesOrderLineId,
            qty: cap > 0 ? String(cap) : '',
          };
        });
      return [...cs, ...added];
    });
  }

  // Arriving with ?so= (e.g. the Assembly Tracker's Dispatch button): add the
  // pending lines once, as soon as that SO's lines have loaded, if the user
  // has not started on the lines already.
  const autoFilled = useRef(false);
  useEffect(() => {
    if (autoFilled.current || !preselectSo || soId !== preselectSo) return;
    if (!dispatchable || cards.length > 0) return;
    autoFilled.current = true;
    addAllPendingLines();
  }, [dispatchable, soId, preselectSo]);

  function addLine(): void {
    setCards((cs) => [...cs, { id: nextId.current++, soLineId: null, qty: '' }]);
  }
  function removeLine(id: number): void {
    setCards((cs) => cs.filter((c) => c.id !== id));
  }
  function patchLine(id: number, patch: Partial<LineCard>): void {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Live per-line validation (no silent clamp): a qty over what the customer is
  // still owed is a hard block — the line shows a friendly message and Save is
  // disabled until every line is within its pending qty.
  //
  // ADR-180: the cap is PENDING (order − dispatched), not the old "ready +
  // reserved" figure. A reservation no longer removes stock from the shelf, so
  // a dispatch draws on this line's reservation first and then on free stock;
  // the API is the one that checks there are enough pieces to draw on.
  const lineErrors = new Map<number, string>();
  let anyPositiveQty = false;
  for (const c of cards) {
    const line = resolveLine(c.soLineId);
    if (!line) continue;
    const raw = c.qty.trim() === '' ? 0 : Number(c.qty);
    if (Number.isNaN(raw) || raw < 0) {
      lineErrors.set(c.id, 'Enter a valid quantity.');
      continue;
    }
    // Cap at the SAME number the server enforces (`availableQty`, itself
    // already capped at pending). Capping only at "pending" let the user type
    // a qty the stock cannot cover, kept Save enabled, and met the refusal at
    // submit instead of while typing.
    const cap = Math.min(line.availableQty, line.pendingQty);
    if (raw > cap) {
      lineErrors.set(
        c.id,
        cap === line.pendingQty
          ? `Only ${cap} still pending on this line — reduce the qty to ${cap} or less.`
          : `Only ${cap} can be dispatched now (this line's reserved stock plus free stock) — reduce the qty to ${cap} or less.`,
      );
      continue;
    }
    if (raw > 0) anyPositiveQty = true;
  }
  const canSave =
    Boolean(soId) &&
    cards.length > 0 &&
    lineErrors.size === 0 &&
    anyPositiveQty &&
    !create.isPending;

  async function submit(): Promise<void> {
    setErr(null);
    if (!soId) return setErr('Please select an SO');
    if (cards.length === 0) return setErr('Add at least one line');

    // Resolve each card → SO line and VALIDATE (no silent clamp): an over-qty is
    // a hard block so the user sees why, instead of us quietly reducing it.
    const byLine = new Map<string, number>();
    for (const c of cards) {
      const line = resolveLine(c.soLineId);
      if (!line) return setErr('Pick an item on every line (or remove the empty line).');
      const raw = c.qty.trim() === '' ? 0 : Number(c.qty);
      if (Number.isNaN(raw) || raw < 0) {
        return setErr(`${line.itemName}: enter a valid dispatch quantity.`);
      }
      const lineCap = Math.min(line.availableQty, line.pendingQty);
      if (raw > lineCap) {
        return setErr(
          `${line.itemName}: only ${lineCap} can be dispatched (you entered ${raw}). Reduce the qty to ${lineCap} or less.`,
        );
      }
      if (raw <= 0) continue;
      byLine.set(line.salesOrderLineId, (byLine.get(line.salesOrderLineId) ?? 0) + raw);
    }
    const payloadLines = [...byLine.entries()].map(([salesOrderLineId, qty]) => ({
      salesOrderLineId,
      qty,
    }));
    if (payloadLines.length === 0) return setErr('Enter a dispatch qty on at least one line');

    try {
      await create.mutateAsync({
        salesOrderId: soId,
        dispatchDate,
        transport: transport || undefined,
        vehicleNo: vehicleNo || undefined,
        remarks: remarks || undefined,
        lines: payloadLines,
      });
      exit.leave(goBack);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save Dispatch. Try again.');
    }
  }

  // Ctrl+S runs the same Save as the header button, only while it is enabled.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const runSave = useCallback(() => void submitRef.current(), []);
  useSaveShortcut(runSave, canSave);
  const dirty = cards.length > 0 || transport !== '' || vehicleNo !== '' || remarks !== '';

  // SO picker rows: "SO code — Customer". Filtered client-side over the list
  // already loaded (no server search on this endpoint).
  const soOptions = useMemo(
    () =>
      (soOpts?.options ?? []).map((o) => ({
        id: o.salesOrderId,
        code: o.soCode,
        name: o.customer ?? '',
      })),
    [soOpts],
  );

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You cannot create Dispatches. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        icon="🚚"
        title="New Customer Dispatch"
        backLabel="Back to Customer Dispatch"
        onBack={() => exit.leave(goBack)}
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
                  ? 'Fix the highlighted lines — dispatch qty cannot exceed the pending qty.'
                  : undefined
              }
              onClick={() => void submit()}
            >
              {create.isPending ? 'Saving…' : 'Save Dispatch'}
            </button>
          </>
        }
      />

      {/* Save error right under the header's Save. */}
      {err ? (
        <Banner tone="error" role="alert">
          {err}
        </Banner>
      ) : null}

      <Panel title="Dispatch Details">
        <FormGrid>
          {/* Row 1 — Sales Order · Dispatch Date · Dispatch No. (6 + 3 + 3). */}
          <FormField label="Sales Order" required size="lg" htmlFor="dispatchSo">
            <SearchableSelect
              id="dispatchSo"
              value={soId || null}
              onChange={(id) => setSoId(id ?? '')}
              options={soOptions}
              placeholder="🔍 Type SO number or customer…"
              emptyText="No sales order matches"
            />
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
            <input
              id="dispatchNo"
              className="innovic-input"
              readOnly
              value={next?.code ?? '(auto on save)'}
            />
          </FormField>

          {/* Row 2 — Transport · Vehicle No. (6 + 6). */}
          <FormField label="Transport" size="lg" htmlFor="transport">
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

          {/* Row 3 — Remarks (full). */}
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

      {soId ? (
        <Panel
          title="Items"
          actions={
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={addAllPendingLines}
                disabled={!dispatchable}
                title="Add every SO line that still has a pending qty"
              >
                Add all pending lines
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={addLine}>
                <Plus size={13} /> Add Line
              </button>
            </>
          }
        >
          <DispatchLineTable
            cards={cards}
            lines={lines}
            lineErrors={lineErrors}
            onPatch={patchLine}
            onRemove={removeLine}
          />
        </Panel>
      ) : null}
    </div>
  );
}
