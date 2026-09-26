// New Invoice — pick an SO, then add invoice lines (card-per-line, like the
// dispatch editor). Type an item code to pick from the SO's invoiceable lines;
// Item Name + Order/Dispatched/Invoiced/Available auto-fill. Invoice up to the
// available (dispatched − invoiced) qty per line.
// `?dispatchId=` (Create Invoice button on the Dispatch Register) preselects the
// dispatch's SO and prefills the lines from that dispatch.

import type { InvoiceableLine } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { SearchableSelect as LineSearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { inrFormat } from '@/lib/print/doc-print';
import { todayLocal } from '@/lib/date';
import { useDispatchDetail } from '@/modules/customer-dispatches/api';
import { DEFAULT_TERMS_DAYS, GST_OPTIONS } from '@/modules/invoices/constants';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import {
  useCreateInvoice,
  useFinanceSoOptions,
  useInvoiceableSo,
  useNextInvoiceCode,
} from '../api';

export const invoiceNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices/new',
  validateSearch: z.object({ dispatchId: z.string().uuid().optional() }),
  component: InvoiceNewPage,
});

const todayStr = (): string => todayLocal();

interface LineCard {
  id: number;
  soLineId: string | null;
  qty: string;
  rate: string;
}

// Shared grid: # | POL | Item Code | Item Name | To Invoice | Invoice Qty |
// Rate | Amount | ▸ More | ×  — 8 data columns; Order / Dispatched / Invoiced
// open under the card with "▸ More". The 50px slot after '#' is POL — the
// CUSTOMER's own purchase-order line number, which sits immediately before the
// item code everywhere.
const GRID = '30px 50px 1.3fr 1.6fr 78px 84px 96px 110px 64px 30px';

function InvoiceNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { dispatchId } = invoiceNewRoute.useSearch();
  const { data: soOpts } = useFinanceSoOptions();
  const { data: next } = useNextInvoiceCode();
  const create = useCreateInvoice();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'invoice_create');
  // Where Cancel goes, and where ESC -> Exit goes. Every other way off the
  // screen (Back link, breadcrumb, browser Back) gets "Are you sure?".
  const goBack = useCallback(() => void navigate({ to: '/invoices' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const [soId, setSoId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [termsDays, setTermsDays] = useState(String(DEFAULT_TERMS_DAYS));
  const [gstPercent, setGstPercent] = useState('18');
  const [remarks, setRemarks] = useState('');
  const [cards, setCards] = useState<LineCard[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const nextId = useRef(1);
  const prefilled = useRef(false);

  const { data: inv } = useInvoiceableSo(soId || undefined);

  // ADR-188 — GST % starts from the SO, Payment Terms from the customer's
  // Payment Days (45 when the customer has none). Both stay editable. A value
  // the user typed after picking the SO is never overwritten; picking another
  // SO clears that and fills both again. Refs, not state, so the reset below
  // is seen by the fill effect in the same commit (effects run in order).
  const termsTouched = useRef(false);
  const gstTouched = useRef(false);
  const filledFor = useRef<string | null>(null);
  const [termsSource, setTermsSource] = useState<'customer' | 'default' | null>('default');
  const [gstSource, setGstSource] = useState<'so' | null>(null);
  useEffect(() => {
    termsTouched.current = false;
    gstTouched.current = false;
    filledFor.current = null;
  }, [soId]);
  useEffect(() => {
    if (!inv || inv.salesOrderId !== soId || filledFor.current === soId) return;
    filledFor.current = soId;
    if (!gstTouched.current) {
      setGstPercent(String(inv.gstPercent));
      setGstSource('so');
    }
    if (!termsTouched.current) {
      setTermsDays(String(inv.paymentDays ?? DEFAULT_TERMS_DAYS));
      setTermsSource(inv.paymentDays != null ? 'customer' : 'default');
    }
  }, [inv, soId]);

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
      exit.leave(() => void navigate({ to: '/invoices/$id', params: { id: created.id } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save Invoice. Try again.');
    }
  }

  // Ctrl+S runs the same Save as the header button, only while it is enabled.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const runSave = useCallback(() => void submitRef.current(), []);
  useSaveShortcut(runSave, !create.isPending);
  const dirty = cards.length > 0 || remarks !== '' || (soId !== '' && !dispatchId);

  // SO picker rows: "SO code — Customer", filtered client-side over the list
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
  const soValueLabel = useMemo(() => {
    const o = soOptions.find((x) => x.id === soId);
    return o ? `${o.code} — ${o.name}` : undefined;
  }, [soOptions, soId]);

  // ▸ More — the reference quantities (Order / Dispatched / Invoiced) per card.
  const [openMore, setOpenMore] = useState<ReadonlySet<number>>(new Set());
  const toggleMore = (id: number): void =>
    setOpenMore((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ You do not have create access to Invoices. Ask an admin for L2 Data Entry or above in
        Finance.
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        icon="📄"
        title="Create Invoice"
        backLabel="Back to Invoices"
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
              disabled={create.isPending}
              onClick={() => void submit()}
            >
              {create.isPending ? 'Saving…' : 'Save Invoice'}
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

      <Panel title="Invoice Details">
        {fromDispatch && fromDispatch.status !== 'cancelled' ? (
          <div
            style={{
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
              marginBottom: 12,
            }}
          >
            🚚 Invoicing dispatch <b style={{ color: 'var(--cyan)' }}>{fromDispatch.code}</b> — SO
            and line qtys prefilled from this dispatch (editable below).
          </div>
        ) : null}
        <FormGrid>
          {/* Row 1 — Select SO · Invoice No. · Invoice Date (6 + 3 + 3). */}
          <FormField label="Select SO" required size="lg" htmlFor="invoiceSo">
            <SearchableSelect
              id="invoiceSo"
              value={soId || null}
              // The picker reports null the moment the user starts typing. Only a
              // real pick may change the SO: clearing it wipes every line card.
              onChange={(id) => {
                if (id) onSoChange(id);
              }}
              options={soOptions}
              valueLabel={soValueLabel}
              placeholder="🔍 Type SO number or customer…"
              emptyText="No sales order matches"
            />
          </FormField>
          <FormField label="Invoice No." size="sm" htmlFor="invoiceNo">
            <input
              id="invoiceNo"
              className="innovic-input"
              readOnly
              value={next?.code ?? '(auto on save)'}
            />
          </FormField>
          <FormField label="Invoice Date" size="sm" htmlFor="invoiceDate">
            <input
              id="invoiceDate"
              type="date"
              className="innovic-input"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </FormField>

          {/* Row 2 — Payment Terms · GST % · Remarks (3 + 3 + 6). */}
          <FormField
            label="Payment Terms (days)"
            size="sm"
            htmlFor="termsDays"
            help={
              termsSource === 'customer'
                ? 'From customer'
                : termsSource === 'default'
                  ? `Default ${DEFAULT_TERMS_DAYS} days`
                  : undefined
            }
          >
            <input
              id="termsDays"
              type="number"
              className="innovic-input"
              min={0}
              style={{ textAlign: 'right' }}
              value={termsDays}
              onChange={(e) => {
                termsTouched.current = true;
                setTermsSource(null);
                setTermsDays(e.target.value);
              }}
            />
          </FormField>
          <FormField
            label="GST %"
            size="sm"
            htmlFor="gstPercent"
            help={gstSource === 'so' ? 'From SO' : undefined}
          >
            <select
              id="gstPercent"
              className="innovic-select"
              value={gstPercent}
              onChange={(e) => {
                gstTouched.current = true;
                setGstSource(null);
                setGstPercent(e.target.value);
              }}
            >
              {/* The SO may carry a rate outside the usual slabs — keep it
                  selectable rather than silently showing the first option. */}
              {(GST_OPTIONS.includes(gstPercent) ? GST_OPTIONS : [...GST_OPTIONS, gstPercent]).map(
                (g) => (
                  <option key={g} value={g}>
                    {g}%
                  </option>
                ),
              )}
            </select>
          </FormField>
          <FormField label="Remarks" size="lg" htmlFor="invoiceRemarks">
            <input
              id="invoiceRemarks"
              className="innovic-input"
              placeholder="Notes..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </FormField>
        </FormGrid>
      </Panel>

      {soId ? (
        <Panel
          title="Items Available to Invoice"
          actions={
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>
              <Plus size={14} /> Add Line
            </button>
          }
        >
          <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 8 }}>
            Add a line, then pick an item code — name and quantities auto-fill from this SO.
          </div>

          {cards.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                gap: 8,
                padding: '0 10px 4px',
                fontSize: 'var(--fs-xs)',
                fontWeight: 700,
                letterSpacing: 0.4,
                color: 'var(--text3)',
                textTransform: 'uppercase',
              }}
            >
              <span>Ln</span>
              <span style={{ textAlign: 'center', color: 'var(--purple)' }}>POL</span>
              <span>Item Code ★</span>
              <span>Item Name</span>
              <span style={{ textAlign: 'right', color: 'var(--amber2)' }}>To Invoice</span>
              <span style={{ textAlign: 'right', color: 'var(--green2)' }}>Invoice Qty</span>
              <span style={{ textAlign: 'right' }}>Rate</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
              <span />
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
              // The dropdown labels each option with the drawing revision —
              // "IN-IT-0007/B" — because two SO lines for the same part at
              // different revisions are otherwise indistinguishable here.
              // What the picker SUBMITS is still the SO line id, so this is
              // a label only; a line with no revision keeps the bare code.
              .map((l) => ({
                id: l.salesOrderLineId,
                code: itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
                name: l.itemName,
              }));
            // Same clamp the subtotal above uses — a preview only; the server
            // recomputes every amount.
            const lineAmount = line
              ? Math.max(0, Math.min(line.availableQty, Number(card.qty) || 0)) *
                (Number(card.rate) || 0)
              : 0;
            const moreOpen = openMore.has(card.id);
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
                <span
                  className="mono fw-700"
                  style={{ textAlign: 'center', color: 'var(--text3)' }}
                >
                  {idx + 1}
                </span>
                <span
                  className="mono fw-700"
                  style={{ textAlign: 'center', color: 'var(--purple)' }}
                >
                  {line?.clientPoLineNo ?? '—'}
                </span>
                <LineSearchableSelect
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
                  valueLabel={
                    line
                      ? itemCodeWithRev(line.itemCode, line.itemRevision, line.itemName)
                      : undefined
                  }
                />
                <input
                  className="innovic-input"
                  readOnly
                  placeholder="auto-filled"
                  value={line?.itemName ?? ''}
                  style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
                />
                <span className="mono fw-700 amber" style={{ textAlign: 'right' }}>
                  {line ? line.availableQty : '—'}
                </span>
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
                    const clamped = Math.max(
                      0,
                      Math.min(line.availableQty, Number(e.target.value) || 0),
                    );
                    patchLine(card.id, {
                      qty: e.target.value.trim() === '' ? '' : String(clamped),
                    });
                  }}
                  style={{ textAlign: 'right' }}
                />
                <input
                  type="number"
                  className="innovic-input"
                  min={0}
                  step="0.01"
                  value={card.rate}
                  disabled={!line}
                  // ADR-185 — an invoice bills at the SO rate (the server
                  // refuses any other); a price change is made on the SO.
                  // A line with no SO rate (0) is priced here.
                  readOnly={Number(line?.rate ?? 0) > 0}
                  title="The SO rate. To bill a different price, change it on the Sales Order."
                  onChange={(e) => patchLine(card.id, { rate: e.target.value })}
                  style={{ textAlign: 'right' }}
                />
                <span className="mono fw-700" style={{ textAlign: 'right' }}>
                  {line ? `₹${inrFormat(lineAmount)}` : '—'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={moreOpen}
                  title="Order, Dispatched and Invoiced qty for this line"
                  onClick={() => toggleMore(card.id)}
                >
                  {moreOpen ? '▾' : '▸ More'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Remove line"
                  onClick={() => removeLine(card.id)}
                  style={{ color: 'var(--red2)' }}
                >
                  <X size={14} />
                </button>
                {moreOpen ? (
                  <div
                    className="text3"
                    style={{
                      gridColumn: '1 / -1',
                      display: 'flex',
                      gap: 'var(--sp-4)',
                      justifyContent: 'flex-end',
                      fontSize: 'var(--fs-xs)',
                    }}
                  >
                    <span>
                      Order Qty <b className="mono text2">{line ? line.orderQty : '—'}</b>
                    </span>
                    <span>
                      Dispatched <b className="mono green">{line ? line.dispatchedQty : '—'}</b>
                    </span>
                    <span>
                      Invoiced <b className="mono text2">{line ? line.invoicedQty : '—'}</b>
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}

          {/* Totals — right-aligned under the Amount column, one per row. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 140px',
              justifyContent: 'end',
              columnGap: 'var(--sp-3)',
              rowGap: 'var(--sp-1)',
              marginTop: 12,
              textAlign: 'right',
            }}
          >
            <span className="text3">Subtotal</span>
            <b className="mono fw-700 text2">₹{inrFormat(subtotal)}</b>
            <span className="text3">GST</span>
            <b className="mono fw-700 amber">₹{inrFormat(gstAmt)}</b>
            <span className="text3">Total</span>
            <b className="mono fw-700 green">₹{inrFormat(grand)}</b>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
