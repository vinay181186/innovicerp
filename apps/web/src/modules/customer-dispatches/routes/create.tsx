// New Customer Dispatch — pick an SO, then add dispatch lines (card-per-line,
// like the SO/PO line editor). The user types an item code; the item name and
// the order/ready/dispatched/available metrics auto-fetch from the SO's
// dispatchable lines. Dispatch is capped at each line's available qty.

import type { DispatchableLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateDispatch, useDispatchableSo, useFinanceSoOptions, useNextDispatchCode } from '../api';

export const customerDispatchNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'customer-dispatches/new',
  component: CustomerDispatchNewPage,
});

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LineCard {
  id: number;
  soLineId: string | null;
  qty: string;
}

// Grid template shared by the header row + every card so columns line up.
const GRID = '34px 1.4fr 1.8fr 70px 70px 90px 90px 110px 34px';

function CustomerDispatchNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: soOpts } = useFinanceSoOptions();
  const { data: next } = useNextDispatchCode();
  const create = useCreateDispatch();

  const [soId, setSoId] = useState('');
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

  async function submit(): Promise<void> {
    setErr(null);
    if (!soId) return setErr('Select an SO');
    if (cards.length === 0) return setErr('Add at least one line');

    // Resolve each card → SO line, clamp qty to available, merge duplicates.
    const byLine = new Map<string, number>();
    for (const c of cards) {
      const line = resolveLine(c.soLineId);
      if (!line) return setErr('Pick an item on every line (or remove the empty line).');
      const raw = Number(c.qty) || 0;
      const qty = Math.max(0, Math.min(line.availableQty, raw));
      if (qty <= 0) continue;
      byLine.set(line.salesOrderLineId, (byLine.get(line.salesOrderLineId) ?? 0) + qty);
    }
    const payloadLines = [...byLine.entries()].map(([salesOrderLineId, qty]) => ({
      salesOrderLineId,
      qty: Math.min(qty, lines.find((l) => l.salesOrderLineId === salesOrderLineId)?.availableQty ?? qty),
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

  return (
    <div>
      <Link to="/customer-dispatches" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Dispatch Register
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">🚚 New Customer Dispatch</span>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Sales Order ★</label>
              <select className="innovic-input" value={soId} onChange={(e) => setSoId(e.target.value)}>
                <option value="">-- Select SO --</option>
                {(soOpts?.options ?? []).map((o) => (
                  <option key={o.salesOrderId} value={o.salesOrderId}>
                    {o.soCode} — {o.customer ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Dispatch No.</label>
              <input
                className="innovic-input"
                readOnly
                value={next?.code ?? '(auto on save)'}
                style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Dispatch Date</label>
              <input type="date" className="innovic-input" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">Transport</label>
              <input className="innovic-input" value={transport} onChange={(e) => setTransport(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">Vehicle No.</label>
              <input className="innovic-input" value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <input className="innovic-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>

          {soId ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', marginBottom: 6 }}>
                ▸ READY TO DISPATCH (produced + QC-accepted)
              </div>
              <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
                Add a line, then type an item code — name and quantities auto-fill from this SO.
              </div>

              {cards.length > 0 ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: GRID,
                    gap: 8,
                    padding: '0 10px 4px',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    color: 'var(--text3)',
                    textTransform: 'uppercase',
                  }}
                >
                  <span>#</span>
                  <span>Item Code ★</span>
                  <span>Item Name</span>
                  <span style={{ textAlign: 'center' }}>Order</span>
                  <span style={{ textAlign: 'center', color: 'var(--green)' }}>Ready</span>
                  <span style={{ textAlign: 'center' }}>Dispatched</span>
                  <span style={{ textAlign: 'center', color: 'var(--amber)' }}>Available</span>
                  <span style={{ textAlign: 'center', color: 'var(--green)' }}>Dispatch Qty</span>
                  <span />
                </div>
              ) : null}

              {cards.map((card, idx) => {
                const line = resolveLine(card.soLineId);
                // Options = this SO's dispatchable lines, minus ones already
                // picked on other cards (can't dispatch the same line twice).
                const usedElsewhere = new Set(
                  cards.filter((c) => c.id !== card.id && c.soLineId).map((c) => c.soLineId),
                );
                const opts = lines
                  .filter((l) => !usedElsewhere.has(l.salesOrderLineId))
                  .map((l) => ({ id: l.salesOrderLineId, code: l.itemCode, name: l.itemName }));
                return (
                  <div
                    key={card.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID,
                      gap: 8,
                      alignItems: 'center',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      padding: 10,
                      marginBottom: 8,
                    }}
                  >
                    <span className="mono fw-700" style={{ textAlign: 'center', color: 'var(--text3)' }}>
                      {idx + 1}
                    </span>
                    <SearchableSelect
                      value={card.soLineId}
                      onChange={(id) => patchLine(card.id, { soLineId: id })}
                      onSearch={() => {}}
                      options={opts}
                      placeholder="🔍 code or name…"
                      emptyText="No ready items"
                      // Item Code field shows the code only; the adjacent Item
                      // Name field carries the name. The open dropdown still
                      // renders "CODE — Name" so you can search by either.
                      selectedLabel={(o) => o.code ?? o.name}
                      valueLabel={line ? (line.itemCode ?? line.itemName) : undefined}
                    />
                    <input
                      className="innovic-input"
                      readOnly
                      placeholder="auto-filled"
                      value={line?.itemName ?? ''}
                      style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
                    />
                    <span className="mono" style={{ textAlign: 'center' }}>{line ? line.orderQty : '—'}</span>
                    <span className="mono" style={{ textAlign: 'center', color: 'var(--green)' }}>
                      {line ? line.readyQty : '—'}
                    </span>
                    <span className="mono text3" style={{ textAlign: 'center' }}>
                      {line ? line.dispatchedQty : '—'}
                    </span>
                    <span className="mono fw-700" style={{ textAlign: 'center', color: 'var(--amber)' }}>
                      {line ? line.availableQty : '—'}
                    </span>
                    <input
                      type="number"
                      className="innovic-input"
                      min={0}
                      max={line?.availableQty ?? undefined}
                      value={card.qty}
                      disabled={!line || line.availableQty <= 0}
                      onChange={(e) => patchLine(card.id, { qty: e.target.value })}
                      onBlur={(e) => {
                        if (!line) return;
                        const clamped = Math.max(0, Math.min(line.availableQty, Number(e.target.value) || 0));
                        patchLine(card.id, { qty: e.target.value.trim() === '' ? '' : String(clamped) });
                      }}
                      style={{ textAlign: 'center' }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Remove line"
                      onClick={() => removeLine(card.id)}
                      style={{ color: 'var(--red)', padding: 4 }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}

              <button type="button" className="btn btn-ghost btn-sm" onClick={addLine} style={{ marginTop: 4 }}>
                <Plus size={14} /> Add Line
              </button>
            </div>
          ) : null}

          {err ? <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10 }}>{err}</div> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => void navigate({ to: '/customer-dispatches' })}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? 'Saving…' : 'Create Dispatch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
