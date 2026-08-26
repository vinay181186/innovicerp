// New Customer Dispatch — pick an SO, then add dispatch lines. The user types an
// item code; the item name and the order/ready/dispatched/available metrics
// auto-fetch from the SO's dispatchable lines. Dispatch is capped at each line's
// available qty.
//
// Styled to SO Master (sales-orders/components/sales-order-form.tsx): top action
// bar carrying Back + title + crumb + Cancel/Save, a 4-up header grid, and the
// shared line-item table. Errors stay at the bottom, next to the fields that
// caused them. No validation, payload or mutation behaviour changed.

import type { DispatchableLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { todayLocal } from '@/lib/date';
import { useCreateDispatch, useDispatchableSo, useFinanceSoOptions, useNextDispatchCode } from '../api';
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

  function addLine(): void {
    setCards((cs) => [...cs, { id: nextId.current++, soLineId: null, qty: '' }]);
  }
  function removeLine(id: number): void {
    setCards((cs) => cs.filter((c) => c.id !== id));
  }
  function patchLine(id: number, patch: Partial<LineCard>): void {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Live per-line validation (no silent clamp): a qty over the available amount
  // is a hard block — the line shows a friendly message and Save is disabled
  // until every line is within its available qty.
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
    if (raw > line.availableQty) {
      lineErrors.set(
        c.id,
        `Only ${line.availableQty} available to dispatch — reduce the qty to ${line.availableQty} or less.`,
      );
      continue;
    }
    if (raw > 0) anyPositiveQty = true;
  }
  const canSave =
    Boolean(soId) && cards.length > 0 && lineErrors.size === 0 && anyPositiveQty && !create.isPending;

  async function submit(): Promise<void> {
    setErr(null);
    if (!soId) return setErr('Select an SO');
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
      if (raw > line.availableQty) {
        return setErr(
          `${line.itemName}: only ${line.availableQty} available to dispatch (you entered ${raw}). Reduce the qty to ${line.availableQty} or less.`,
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
      void navigate({ to: '/customer-dispatches' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create dispatch');
    }
  }

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ You do not have create access to Customer Dispatch. Ask an admin for L2 Data Entry or
        above in Sales.
      </div>
    );
  }

  return (
    <div>
      <div className="panel">
        <div className="panel-body">
          {/* Top action bar — SO Master keeps Save/Cancel here, not in a sticky
              footer, so they stay visible with the header fields. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              paddingBottom: 10,
              marginBottom: 12,
              borderBottom: '1px solid var(--border)',
            }}
          >
            <Link to="/customer-dispatches" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
            <div className="panel-title" style={{ fontSize: 16 }}>🚚 New Customer Dispatch</div>
            <div className="text3" style={{ fontSize: 11 }}>Sales &amp; CRM › Customer Dispatch › New</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void navigate({ to: '/customer-dispatches' })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success btn-sm"
                disabled={!canSave}
                title={
                  lineErrors.size > 0
                    ? 'Fix the highlighted lines — dispatch qty cannot exceed the available qty.'
                    : undefined
                }
                onClick={() => void submit()}
              >
                {create.isPending ? 'Saving…' : 'Create Dispatch'}
              </button>
            </div>
          </div>

          <div className="form-grid-4" style={{ marginBottom: 10 }}>
            <div className="form-grp form-span-2">
              <label className="form-label" htmlFor="dispatchSo">
                Sales Order<span className="req">★</span>
              </label>
              <select
                id="dispatchSo"
                className="innovic-select"
                value={soId}
                onChange={(e) => setSoId(e.target.value)}
              >
                <option value="">-- Select SO --</option>
                {(soOpts?.options ?? []).map((o) => (
                  <option key={o.salesOrderId} value={o.salesOrderId}>
                    {o.soCode} — {o.customer ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="dispatchNo">Dispatch No.</label>
              <input
                id="dispatchNo"
                className="innovic-input"
                readOnly
                value={next?.code ?? '(auto on save)'}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="dispatchDate">Dispatch Date</label>
              <input
                id="dispatchDate"
                type="date"
                className="innovic-input"
                value={dispatchDate}
                onChange={(e) => setDispatchDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="transport">Transport</label>
              <input
                id="transport"
                className="innovic-input"
                autoComplete="off"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="vehicleNo">Vehicle No.</label>
              <input
                id="vehicleNo"
                className="innovic-input"
                autoComplete="off"
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="remarks">Remarks</label>
              <input
                id="remarks"
                className="innovic-input"
                autoComplete="off"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {soId ? (
            <>
              <div
                style={{
                  margin: '4px 0 8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--cyan)',
                      fontFamily: 'var(--mono)',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                    }}
                  >
                    READY TO DISPATCH (produced + QC-accepted)
                  </span>
                  <span className="text3" style={{ fontSize: 11 }}>
                    Add a line, then type an item code — name and quantities auto-fill from this SO.
                  </span>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={addLine}>
                  <Plus size={13} /> Add Line
                </button>
              </div>

              <DispatchLineTable
                cards={cards}
                lines={lines}
                lineErrors={lineErrors}
                onPatch={patchLine}
                onRemove={removeLine}
              />
            </>
          ) : null}

          {err ? (
            <div style={{ marginTop: 16 }}>
              {/* SO Master's error box, with the border taken from --red rather
                  than the hex it hard-codes — this module keeps zero literal
                  colours. */}
              <div
                style={{
                  color: 'var(--red)',
                  background: 'var(--red3)',
                  border: '1px solid var(--red)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 12,
                }}
              >
                {err}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
