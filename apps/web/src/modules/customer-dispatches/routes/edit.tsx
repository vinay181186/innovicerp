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

import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isStagedResult } from '@/modules/document-edits/api';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, PageState, useSaveShortcut } from '@/ui/layout';
import { useDispatchDetail, useDispatchableSo, useUpdateCustomerDispatch } from '../api';
import {
  DispatchEditLineTable,
  editLineCap,
  type EditLineCard,
} from '../components/dispatch-edit-line-table';

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

  const dirty = useMemo(() => {
    if (!d) return false;
    if (dispatchDate !== d.dispatchDate) return true;
    if (transport !== (d.transport ?? '')) return true;
    if (vehicleNo !== (d.vehicleNo ?? '')) return true;
    if (remarks !== (d.remarks ?? '')) return true;
    return cards.some((c) => {
      const saved = savedById.get(c.id);
      return saved ? c.qty.trim() !== String(saved.qty) : false;
    });
  }, [d, dispatchDate, transport, vehicleNo, remarks, cards, savedById]);

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

    const payloadLines = cards.map((c) => ({
      id: c.id,
      qty: c.qty.trim() === '' ? 0 : Number(c.qty),
    }));
    if (!payloadLines.some((l) => l.qty > 0)) {
      return setErr('Enter a Dispatch Qty on at least one line.');
    }

    try {
      const saved = await update.mutateAsync({
        dispatchDate,
        transport: transport || undefined,
        vehicleNo: vehicleNo || undefined,
        remarks: remarks || undefined,
        lines: payloadLines,
      });
      if (isStagedResult(saved)) {
        // The gate is on and this dispatch is live: nothing changed — the edit is
        // waiting for approval. Say so, then return to the detail (pending chips).
        setStagedNotice(
          'Sent for approval — your changes will apply once an approver signs off.',
        );
        exit.leave(
          () =>
            void navigate({ to: '/customer-dispatches/$id', params: { id }, replace: true }),
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
