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

import { qtyUomProblem } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { isStagedResult } from '@/modules/document-edits/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, PageState, useSaveShortcut } from '@/ui/layout';
import { useDcSendable, useDeliveryChallan, useUpdateDeliveryChallan } from '../api';
import {
  DcEditLineTable,
  dcEditLineCap,
  type DcEditLineCard,
} from '../components/dc-edit-line-table';

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

  const dirty = useMemo(() => {
    if (!dc) return false;
    if (dcDate !== dc.dcDate) return true;
    if (transport !== (dc.transport ?? '')) return true;
    if (vehicleNo !== (dc.vehicleNo ?? '')) return true;
    return cards.some((c) => {
      const saved = savedById.get(c.id);
      if (!saved) return false;
      return (
        c.qty.trim() !== String(Number(saved.qty)) ||
        c.materialText !== (saved.materialText ?? '') ||
        c.dcRemarks !== (saved.dcRemarks ?? '')
      );
    });
  }, [dc, dcDate, transport, vehicleNo, cards, savedById]);

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

    const payloadLines = cards.map((c) => ({
      id: c.id,
      qty: Number(c.qty),
      materialText: c.materialText.trim() || undefined,
      dcRemarks: c.dcRemarks.trim() || undefined,
    }));

    try {
      const saved = await update.mutateAsync({
        dcDate,
        transport: transport.trim() || undefined,
        vehicleNo: vehicleNo.trim() || undefined,
        lines: payloadLines,
        expectedUpdatedAt: dc.updatedAt,
      });
      if (isStagedResult(saved)) {
        // The gate is on and this DC is live: nothing changed — the edit is
        // waiting for approval. Say so, then return to the detail (pending chips).
        setStagedNotice(
          'Sent for approval — your changes will apply once an approver signs off.',
        );
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
