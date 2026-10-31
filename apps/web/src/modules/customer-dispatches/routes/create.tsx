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
import { useSaveKey } from '@/lib/use-save-key';
import { soNoWithInternal } from '@/lib/so-number';
import { authenticatedRoute } from '@/routes/_authenticated';
import { todayIst } from '@/lib/date';
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
import {
  buildDispatchPayloadLines,
  checkDispatchRows,
  pendingLineCards,
} from '../components/dispatch-rows';

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
  return todayIst();
}

function CustomerDispatchNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { so: preselectSo } = customerDispatchNewRoute.useSearch();
  const { data: soOpts } = useFinanceSoOptions();
  const { data: next } = useNextDispatchCode();
  const saveKey = useSaveKey();
  const create = useCreateDispatch(saveKey);
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

  // FLOW HELPER (frontend only): one card per pending SO line not already on a
  // card (one per Drawing Rev bucket) — see pendingLineCards.
  function addAllPendingLines(): void {
    setCards((cs) => [...cs, ...pendingLineCards(lines, cs, () => nextId.current++)]);
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

  // Live per-line validation (no silent clamp, ADR-180 pending cap) — see
  // checkDispatchRows. Save stays off until every row is within its cap.
  const { lineErrors, anyPositiveQty } = checkDispatchRows(cards, resolveLine);
  const canSave =
    Boolean(soId) &&
    cards.length > 0 &&
    lineErrors.size === 0 &&
    anyPositiveQty &&
    !create.isPending;

  async function submit(): Promise<void> {
    setErr(null);
    if (!soId) return setErr('SO No. is required.');
    if (cards.length === 0) return setErr('Add at least one line.');

    // Resolve each card → SO line and VALIDATE (no silent clamp); one payload
    // row per SO line + Drawing Rev bucket (Phase C).
    const built = buildDispatchPayloadLines(cards, resolveLine);
    if ('error' in built) return setErr(built.error);
    const payloadLines = built.lines;
    if (payloadLines.length === 0) return setErr('Enter a Dispatch Qty on at least one line.');

    try {
      const saved = await create.mutateAsync({
        salesOrderId: soId,
        dispatchDate,
        transport: transport || undefined,
        vehicleNo: vehicleNo || undefined,
        remarks: remarks || undefined,
        lines: payloadLines,
      });
      // Land on the new dispatch — Preview / Download PDF and Create Invoice are right there,
      // instead of hunting for the new DSP on the list.
      exit.leave(() => void navigate({ to: '/customer-dispatches/$id', params: { id: saved.id } }));
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
        code: soNoWithInternal(o.soCode, o.soInternalNo),
        name: o.customer ?? '',
      })),
    [soOpts],
  );
  // The picker shows a chosen SO only through valueLabel (e.g. arriving ?so=).
  const soValueLabel = useMemo(() => {
    const o = soOptions.find((x) => x.id === soId);
    return o ? `${o.code} — ${o.name}` : undefined;
  }, [soOptions, soId]);

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to create Dispatches. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        title="New Customer Dispatch"
        backLabel="Back to Customer Dispatch"
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
                  ? 'Fix the highlighted lines — Dispatch Qty cannot be more than Pending.'
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
          {/* Row 1 — SO No. · Dispatch Date · Dispatch No. (6 + 3 + 3). */}
          <FormField label="SO No." required size="lg" htmlFor="dispatchSo">
            <SearchableSelect
              id="dispatchSo"
              value={soId || null}
              // Null arrives on the first keystroke; only a real pick changes the
              // SO, or typing would clear the auto-filled lines.
              onChange={(id) => {
                if (id) setSoId(id);
              }}
              options={soOptions}
              valueLabel={soValueLabel}
              placeholder="🔍 Type SO number or customer…"
              emptyText="No SOs match."
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

          {/* Row 2 — Transporter · Vehicle No. (6 + 6). */}
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
