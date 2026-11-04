// New Outward DC — a full page (owner 2026-11-04: a create form with line items
// is a page). Picks a job-work / service PO, loads its lines, and sends material
// out. A `?jw=` deep link from a JWSO pre-picks the PO that carries it.

import { useSaveKey } from '@/lib/use-save-key';
import type { CreateJwDcOutwardLineInput } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner, useToast } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { FormActions, PageHeader, useSaveShortcut } from '@/ui/layout';
import { useJobWorkOrder } from '../../job-work-orders/api';
import { usePurchaseOrdersList } from '../../purchase-orders/api';
import {
  type CreateJwDcOutwardBody,
  useCreateJwDcOutward,
  useJwDcPoLines,
  useNextOutwardCode,
} from '../api';
import { OutwardLineTable, type OutwardLineUi } from '../components/outward-line-table';
import { OutwardRtvNotice, useOutwardRtv } from '../components/outward-rtv-notice';

/** PO statuses material may go out against: approved and still live. */
const SENDABLE_PO_STATUSES: ReadonlySet<string> = new Set(['open', 'partial', 'qc_pending']);

const searchSchema = z.object({
  // `?jw=` deep link from a JWSO. An outward DC is keyed by the job-work PO, not
  // the JWSO, so the PO list is asked for the POs whose lines trace to that JWSO
  // (`jobWorkOrderId`, ADR-190 addendum): exactly one is pre-picked, several
  // narrow the PO picker to them, none leaves the full picker. A malformed id is
  // ignored.
  jw: z.string().uuid().optional().catch(undefined),
});

export const jwDcOutwardNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jw-dc/outward/new',
  validateSearch: searchSchema,
  component: JwDcOutwardNewPage,
});

function JwDcOutwardNewPage(): React.JSX.Element {
  const { jw: forJwId } = jwDcOutwardNewRoute.useSearch();
  const navigate = useNavigate();
  const goBack = useCallback(() => void navigate({ to: '/jw-dc' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const { data: forJw } = useJobWorkOrder(forJwId);
  const [date, setDate] = useState(todayLocal());
  const [poId, setPoId] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<OutwardLineUi[]>([]);
  const [err, setErr] = useState<string | null>(null);

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
  // Seed the lines once per PO. A refetch of the SAME PO (window focus, a live
  // update, another DC against it) must not reset the Send Qty being typed
  // (ADR-230); picking another PO reloads them.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!poLines || !poId) {
      seededFor.current = null;
      setLines([]);
      return;
    }
    if (seededFor.current === poId) return;
    seededFor.current = poId;
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
  }, [poLines, poId]);

  const rtv = useOutwardRtv(poId, lines);

  const saveKey = useSaveKey();
  const createMut = useCreateJwDcOutward(saveKey);
  const toast = useToast();
  const rtvBlockedReason = rtv.loading
    ? 'Still checking for pieces waiting to go back to the vendor'
    : 'Tick "These are new pieces, not the ones waiting to go back" first';

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
    if (rtv.blocks) {
      setErr(
        rtv.loading
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
    if (rtv.confirmed) input.rtvConfirmedNcIds = rtv.rows.map((r) => r.ncId);

    createMut.mutate(input, {
      onSuccess: (saved) => {
        toast.ok(`Outward DC ${saved.code} saved`);
        exit.leave(goBack);
      },
      onError: (e) => {
        rtv.absorbConflict(e);
        setErr(
          e instanceof Error ? e.message : 'Could not save JW DC. Check the lines and try again.',
        );
      },
    });
  };
  useSaveShortcut(onSave, !createMut.isPending && !rtv.blocks);

  const setLine = (i: number, patch: Partial<OutwardLineUi>): void => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  // The `?jw=` pre-pick is not the user's edit.
  const dirty = (poId !== null && !forJwId) || vehicleNo !== '' || remarks !== '';

  return (
    <div>
      {exit.dialog}
      <PageHeader title="New Outward DC" backLabel="Back to JW DC" onBack={goBack} />

      <Panel>
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
        <FormGrid>
          <FormField label="Outward DC No." size="sm" htmlFor="jwdc-out-code">
            <input
              id="jwdc-out-code"
              type="text"
              className="innovic-input"
              value={next?.code ?? '(auto on save)'}
              readOnly
            />
          </FormField>
          <FormField label="DC Date" size="sm" htmlFor="jwdc-out-date">
            <input
              id="jwdc-out-date"
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="PO No." required size="lg" htmlFor="jwdc-out-po">
            <SearchableSelect
              id="jwdc-out-po"
              value={poId}
              onChange={(id) => {
                // The waiting-deviation notice belongs to the PO it was raised
                // for — drop it (and any tick) when the PO changes.
                rtv.reset();
                setPoId(id);
              }}
              options={poData.items.map((p) => ({
                id: p.id,
                code: p.code,
                name: p.vendorName ?? p.vendorCodeText ?? '',
              }))}
              // The `?jw=` deep link can pre-pick the PO without a click.
              valueLabel={
                selectedPo
                  ? `${selectedPo.code} — ${selectedPo.vendorName ?? selectedPo.vendorCodeText ?? ''}`
                  : undefined
              }
              placeholder="-- Select PO --"
            />
          </FormField>
          {selectedPo ? (
            <div className="f-full">
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
          <FormField label="Vehicle No." size="sm" htmlFor="jwdc-out-vehicle">
            <input
              id="jwdc-out-vehicle"
              type="text"
              className="innovic-input"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="GJ-05-XX-1234"
            />
          </FormField>
          <FormField label="Remarks" size="lg" htmlFor="jwdc-out-remarks">
            <input
              id="jwdc-out-remarks"
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      {/* ADR-217 phase 4 — pieces waiting to go back to the vendor on a PO line
          this challan sends. Shown only when there are some; with none, the
          New Outward DC form is exactly as before. */}
      {poId && rtv.loading ? (
        <div className="text3" style={{ fontSize: 11, marginBottom: 12 }}>
          Checking for pieces waiting to go back to the vendor…
        </div>
      ) : null}
      {poId && rtv.failed ? (
        <div className="text3" style={{ fontSize: 11, marginBottom: 12 }}>
          Could not check for pieces waiting to go back; the save will check.
        </div>
      ) : null}
      {rtv.rows.length > 0 ? (
        <OutwardRtvNotice
          rows={rtv.rows}
          confirmed={rtv.confirmed}
          onConfirmedChange={rtv.setConfirmed}
        />
      ) : null}

      {lines.length > 0 ? (
        <Panel title="PO Lines" bodyPadding="none">
          <OutwardLineTable lines={lines} setLine={setLine} />
        </Panel>
      ) : null}

      <FormActions
        dirty={dirty}
        note={
          err ? (
            <Banner tone="error" role="alert" flush>
              {err}
            </Banner>
          ) : undefined
        }
      >
        <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={createMut.isPending || rtv.blocks}
          title={rtv.blocks ? rtvBlockedReason : undefined}
          onClick={onSave}
        >
          {createMut.isPending ? (
            <>
              <Loader2 size={14} className="inline animate-spin" /> Saving…
            </>
          ) : (
            'Save Outward DC'
          )}
        </button>
      </FormActions>
    </div>
  );
}
