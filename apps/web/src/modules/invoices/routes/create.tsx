// New Invoice — pick an SO, then add invoice lines (card-per-line, like the
// dispatch editor). Type an item code to pick from the SO's invoiceable lines;
// Item Name + Order/Dispatched/Invoiced/Available auto-fill. Invoice up to the
// available (dispatched − invoiced) qty per line.
// `?dispatchId=` (Create Invoice button on the Dispatch Register) preselects the
// dispatch's SO and prefills the lines from that dispatch.

import type { InvoiceableLine } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { authenticatedRoute } from '@/routes/_authenticated';
import { inrFormat } from '@/lib/print/doc-print';
import { useDispatchDetail } from '@/modules/customer-dispatches/api';
import { useCreateInvoice, useFinanceSoOptions, useInvoiceableSo, useNextInvoiceCode } from '../api';

export const invoiceNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices/new',
  validateSearch: z.object({ dispatchId: z.string().uuid().optional() }),
  component: InvoiceNewPage,
});

const todayStr = (): string => new Date().toISOString().slice(0, 10);

interface LineCard {
  id: number;
  soLineId: string | null;
  qty: string;
  rate: string;
}

// Shared grid: # | Item Code | Item Name | Order | Dispatched | Invoiced |
// Available | Invoice Qty | Rate | ×
const GRID = '30px 1.3fr 1.6fr 60px 84px 70px 78px 92px 92px 30px';

function InvoiceNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { dispatchId } = invoiceNewRoute.useSearch();
  const { data: soOpts } = useFinanceSoOptions();
  const { data: next } = useNextInvoiceCode();
  const create = useCreateInvoice();

  const [soId, setSoId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [termsDays, setTermsDays] = useState('45');
  const [gstPercent, setGstPercent] = useState('18');
  const [remarks, setRemarks] = useState('');
  const [cards, setCards] = useState<LineCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const nextId = useRef(1);
  const prefilled = useRef(false);

  const { data: inv } = useInvoiceableSo(soId || undefined);

  // Invoicing a specific dispatch: preselect its SO + tag the remarks.
  const { data: fromDispatch } = useDispatchDetail(dispatchId);
  useEffect(() => {
    if (!fromDispatch || fromDispatch.status === 'cancelled') return;
    setSoId((prev) => prev || fromDispatch.salesOrderId);
    setRemarks((prev) => prev || `Against dispatch ${fromDispatch.code}`);
  }, [fromDispatch]);

  const lines: InvoiceableLine[] = inv?.lines ?? [];

  // One-time prefill of the line cards from the source dispatch (Create Invoice
  // from the Dispatch Register). Manual SO selection leaves cards empty.
  useEffect(() => {
    if (prefilled.current) return;
    if (!inv || !fromDispatch || fromDispatch.status === 'cancelled') return;
    if (fromDispatch.salesOrderId !== inv.salesOrderId) return;
    const dispatchQty = new Map<string, number>();
    for (const dl of fromDispatch.lines) {
      if (dl.salesOrderLineId) {
        dispatchQty.set(dl.salesOrderLineId, (dispatchQty.get(dl.salesOrderLineId) ?? 0) + dl.qty);
      }
    }
    const built: LineCard[] = [];
    for (const l of inv.lines) {
      const dq = dispatchQty.get(l.salesOrderLineId) ?? 0;
      if (dq > 0) {
        built.push({
          id: nextId.current++,
          soLineId: l.salesOrderLineId,
          qty: String(Math.min(dq, l.availableQty)),
          rate: String(l.rate),
        });
      }
    }
    if (built.length > 0) {
      setCards(built);
      prefilled.current = true;
    }
  }, [inv, fromDispatch]);

  function resolveLine(soLineId: string | null): InvoiceableLine | null {
    if (!soLineId) return null;
    return lines.find((l) => l.salesOrderLineId === soLineId) ?? null;
  }
  function addLine(): void {
    setCards((cs) => [...cs, { id: nextId.current++, soLineId: null, qty: '', rate: '' }]);
  }
  function removeLine(id: number): void {
    setCards((cs) => cs.filter((c) => c.id !== id));
  }
  function patchLine(id: number, patch: Partial<LineCard>): void {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function onSoChange(v: string): void {
    setSoId(v);
    setCards([]);
    setErr(null);
    prefilled.current = true; // manual pick: don't run the dispatch prefill
  }

  // Live totals from the current cards (pre-save preview; server recomputes).
  const subtotal = cards.reduce((s, c) => {
    const l = resolveLine(c.soLineId);
    if (!l) return s;
    const qty = Math.max(0, Math.min(l.availableQty, Number(c.qty) || 0));
    return s + qty * (Number(c.rate) || 0);
  }, 0);
  const gstAmt = Math.round(((subtotal * Number(gstPercent || 0)) / 100) * 100) / 100;
  const grand = subtotal + gstAmt;

  async function submit(): Promise<void> {
    setErr(null);
    if (!soId) return setErr('Select an SO');
    if (cards.length === 0) return setErr('Add at least one line');
    const byLine = new Map<string, { qty: number; rate: number }>();
    for (const c of cards) {
      const l = resolveLine(c.soLineId);
      if (!l) return setErr('Pick an item on every line (or remove the empty line).');
      const qty = Math.max(0, Math.min(l.availableQty, Number(c.qty) || 0));
      if (qty <= 0) continue;
      byLine.set(l.salesOrderLineId, { qty, rate: Number(c.rate) || 0 });
    }
    const payloadLines = [...byLine.entries()].map(([salesOrderLineId, v]) => ({
      salesOrderLineId,
      qty: v.qty,
      rate: v.rate,
    }));
    if (payloadLines.length === 0) return setErr('Enter an invoice qty on at least one line');
    try {
      const created = await create.mutateAsync({
        salesOrderId: soId,
        invoiceDate,
        paymentTermsDays: Number(termsDays) || 0,
        gstPercent: Number(gstPercent) || 0,
        remarks: remarks || undefined,
        lines: payloadLines,
      });
      void navigate({ to: '/invoices/$id', params: { id: created.id } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create invoice');
    }
  }

  return (
    <div>
      <Link to="/invoices" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Invoices
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">📄 Create Invoice</span>
        </div>
        <div className="panel-body">
          {fromDispatch && fromDispatch.status !== 'cancelled' ? (
            <div
              style={{
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              🚚 Invoicing dispatch <b style={{ color: 'var(--cyan)' }}>{fromDispatch.code}</b> — SO and
              line qtys prefilled from this dispatch (editable below).
            </div>
          ) : null}
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Invoice No.</label>
              <input className="innovic-input" readOnly value={next?.code ?? '(auto on save)'} />
            </div>
            <div className="form-grp">
              <label className="form-label">Invoice Date</label>
              <input type="date" className="innovic-input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">Select SO<span className="req">★</span></label>
              <select className="innovic-select" value={soId} onChange={(e) => onSoChange(e.target.value)}>
                <option value="">-- Select SO --</option>
                {(soOpts?.options ?? []).map((o) => (
                  <option key={o.salesOrderId} value={o.salesOrderId}>
                    {o.soCode} — {o.customer ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Payment Terms (days)</label>
              <input type="number" className="innovic-input" min={0} value={termsDays} onChange={(e) => setTermsDays(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">GST %</label>
              <select className="innovic-select" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)}>
                {['0', '5', '12', '18', '28'].map((g) => (
                  <option key={g} value={g}>{g}%</option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Remarks</label>
              <input className="innovic-input" placeholder="Notes..." value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </div>

          {soId ? (
            <div style={{ marginTop: 14 }}>
              <div className="cyan fw-700" style={{ fontSize: 11, marginBottom: 6 }}>
                ▸ ITEMS AVAILABLE TO INVOICE
              </div>
              <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
                Add a line, then pick an item code — name and quantities auto-fill from this SO.
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
                  <span style={{ textAlign: 'center', color: 'var(--green)' }}>Dispatched</span>
                  <span style={{ textAlign: 'center' }}>Invoiced</span>
                  <span style={{ textAlign: 'center', color: 'var(--amber)' }}>Available</span>
                  <span style={{ textAlign: 'center', color: 'var(--green)' }}>Invoice Qty</span>
                  <span style={{ textAlign: 'center' }}>Rate</span>
                  <span />
                </div>
              ) : null}

              {cards.map((card, idx) => {
                const line = resolveLine(card.soLineId);
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
                      onChange={(id) => {
                        const l = id ? lines.find((x) => x.salesOrderLineId === id) : null;
                        patchLine(card.id, { soLineId: id, ...(l ? { rate: String(l.rate) } : {}) });
                      }}
                      onSearch={() => {}}
                      options={opts}
                      placeholder="🔍 code or name…"
                      emptyText="No items to invoice"
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
                    <span className="mono green" style={{ textAlign: 'center' }}>{line ? line.dispatchedQty : '—'}</span>
                    <span className="mono text3" style={{ textAlign: 'center' }}>{line ? line.invoicedQty : '—'}</span>
                    <span className="mono fw-700 amber" style={{ textAlign: 'center' }}>{line ? line.availableQty : '—'}</span>
                    <input
                      type="number"
                      className="innovic-input fw-700 green"
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
                    <input
                      type="number"
                      className="innovic-input"
                      min={0}
                      step="0.01"
                      value={card.rate}
                      disabled={!line}
                      onChange={(e) => patchLine(card.id, { rate: e.target.value })}
                      style={{ textAlign: 'right' }}
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

              <div style={{ display: 'flex', gap: 20, justifyContent: 'flex-end', marginTop: 12, fontSize: 13 }}>
                <span className="text3">Subtotal: <b className="mono fw-700 text2">₹{inrFormat(subtotal)}</b></span>
                <span className="text3">GST: <b className="mono fw-700 amber">₹{inrFormat(gstAmt)}</b></span>
                <span className="text3">Total: <b className="mono fw-700 green">₹{inrFormat(grand)}</b></span>
              </div>
            </div>
          ) : null}

          {err ? <div className="form-error" style={{ marginTop: 10 }}>{err}</div> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => void navigate({ to: '/invoices' })}>Cancel</button>
            <button type="button" className="btn btn-success" disabled={create.isPending} onClick={() => void submit()}>
              {create.isPending ? 'Saving…' : '✓ Create Invoice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
