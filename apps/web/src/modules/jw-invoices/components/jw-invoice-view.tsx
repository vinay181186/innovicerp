// JW Invoice (Labour) view — bills the processing / labour charge for a Job Work
// Order line (qty x line rate + GST from the JWSO header). NO material value:
// the client owns the material. Extracted from the standalone jw-invoices list
// route so it can render inside the Invoices screen as a tab. Behavior, hooks,
// modals and price/money display are identical to the original screen.

import { type CreateJwInvoiceInput, type ListJwInvoicesQuery } from '@innovic/shared';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useCreateJwInvoice, useJwInvoicesList } from '../api';
import { PrintJwInvoiceButton } from './print-jw-invoice-button';

// The register scrolls; it has no Prev/Next. 500 is the endpoint's ceiling and
// exactly the cap this list already ran under, so nothing that was visible
// before disappears — what changed is that the SEARCH now runs on the server,
// over the whole book, instead of over the rows that happened to be downloaded.
const LIST_LIMIT = 500;

function money(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function JwInvoiceView(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [searchInput, setSearchInput] = useState('');
  const [term, setTerm] = useState('');
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-JI  26 " and "IN-JI 26" are one query, one cache entry, one fetch.
    const next = normalizeSearchTerm(searchInput);
    if (next === term) return;
    const id = window.setTimeout(() => setTerm(next), 300);
    return () => window.clearTimeout(id);
  }, [searchInput, term]);

  // The term goes to the SERVER now. It used to filter the downloaded rows in
  // the browser, which only ever searched the capped page the endpoint had
  // sent — past the cap the box quietly hid matching invoices. A new term is a
  // new query key, so it refetches, and the read always starts at the first
  // page (offset 0) rather than stranding the user mid-list.
  const query: ListJwInvoicesQuery = useMemo(
    () => ({ ...(term ? { search: term } : {}), limit: LIST_LIMIT, offset: 0 }),
    [term],
  );

  const { data, isLoading, isError, error } = useJwInvoicesList(query);
  const items = data?.items ?? [];

  // Money hidden for L1 Viewers: the API nulls the amounts, so the Rate /
  // Taxable / GST% / GST Amt / Total columns are dropped for them.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = data ? !data.priceVisible : false;

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-3">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search invoice, date, JWSO, client, part…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 260, fontSize: 12 }}
          />
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              <Plus size={14} /> New Invoice
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        ) : isError ? (
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load JW invoices'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Invoice No.</th>
                  <th>Date</th>
                  <th>JWSO</th>
                  <th>Client</th>
                  <th>Part</th>
                  <th>Qty</th>
                  {priceHidden ? null : (
                    <>
                      <th>Rate</th>
                      <th>Taxable</th>
                      <th>GST%</th>
                      <th>GST Amt</th>
                      <th style={{ color: 'var(--green)' }}>Total</th>
                    </>
                  )}
                  {/* Print. No new permission gate: anyone who can see the row
                      can print it, exactly as on the DC detail page. What a
                      viewer without price rights may not see is already gone
                      from the row AND from the printed sheet — the invoice
                      prints with the money suppressed, not blocked. */}
                  <th>Print</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={priceHidden ? 7 : 12} className="empty-state">
                      No JW invoices — click + New Invoice
                    </td>
                  </tr>
                ) : null}
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="td-code" style={{ color: 'var(--cyan)' }}>
                        {r.code}
                      </span>
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {r.invoiceDate}
                    </td>
                    <td
                      className="mono fw-700"
                      style={{ fontSize: 11, color: 'var(--purple)' }}
                    >
                      {r.jwCodeText ?? '—'}
                    </td>
                    <td className="fw-700">{r.clientName ?? '—'}</td>
                    <td className="text2" style={{ fontSize: 12 }}>
                      {r.partName ?? '—'}
                    </td>
                    <td className="mono">
                      {r.qty}
                    </td>
                    {priceHidden ? null : (
                      <>
                        <td className="mono">
                          {money(r.rate ?? 0)}
                        </td>
                        <td className="mono">
                          {money(r.taxableAmount ?? 0)}
                        </td>
                        <td className="mono text3" style={{ fontSize: 11 }}>
                          {r.gstPercent}%
                        </td>
                        <td className="mono">
                          {money(r.gstAmount ?? 0)}
                        </td>
                        <td
                          className="mono fw-700"
                          style={{ fontSize: 14, color: 'var(--green)' }}
                        >
                          {money(r.totalAmount ?? 0)}
                        </td>
                      </>
                    )}
                    <td>
                      <PrintJwInvoiceButton invoice={r} priceVisible={!priceHidden} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 6, padding: '0 4px' }}>
        💡 JW Invoice bills the labour / processing charge for a Job Work Order line (qty × line
        rate + GST). No material value — the client owns the material.
      </div>

      {showModal ? <NewJwInvoiceModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}

// ─── New JW Invoice modal ──────────────────────────────────────────────────

function NewJwInvoiceModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [rate, setRate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // ADR-104: NO status filter — see jw-returns. A JWSO closes at final QC, so
  // filtering to `open` hid every finished job from the one screen that bills
  // it. IN-JW-00004 sat complete with 0 invoices because of this.
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];

  // Lines + gstPercent come from the JWSO detail once a header is picked.
  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwLines = jwDetailQ.data?.lines ?? [];
  const gstPct = Number(jwDetailQ.data?.gstPercent ?? 0);

  const createMut = useCreateJwInvoice();

  const onPickLine = (id: string): void => {
    setLineId(id || null);
    const line = jwLines.find((l) => l.id === id);
    // Prefill the (editable) rate from the JW line's processing charge. Null
    // only when the picker can't see prices (they can't reach this create flow),
    // so fall back to blank.
    if (line) setRate(line.rate ?? '');
  };

  const qtyNum = Number(qty);
  const rateNum = Number(rate);
  const taxable = Number.isFinite(qtyNum) && Number.isFinite(rateNum) ? qtyNum * rateNum : 0;
  const gstAmount = Number.isFinite(gstPct) ? taxable * (gstPct / 100) : 0;
  const total = taxable + gstAmount;

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('Select a JWSO');
      return;
    }
    if (!lineId) {
      setErr('Select a JW line');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setErr('Qty must be ≥ 1');
      return;
    }
    const input: CreateJwInvoiceInput = {
      invoiceDate: date,
      jobWorkOrderLineId: lineId,
      qty: qtyNum,
    };
    if (Number.isFinite(rateNum) && rate.trim()) input.rate = rateNum;
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to create'),
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(720px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          🧾 New JW Invoice (Labour)
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JWSO No. ★">
              <SearchableSelect
                id="jwinv-jwso"
                value={jwId}
                onChange={(id) => {
                  setJwId(id);
                  setLineId(null);
                  setRate('');
                }}
                onSearch={setJwSearch}
                loading={jwQuery.isFetching}
                placeholder="🔍 Select JWSO — type number or customer…"
                options={jwHeaders.map((j) => ({
                  id: j.jwId,
                  code: j.code,
                  name: j.customerName ?? '',
                }))}
              />
            </Field>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JW Line ★">
              <select
                className="innovic-input"
                value={lineId ?? ''}
                disabled={!jwId || jwDetailQ.isFetching}
                onChange={(e) => onPickLine(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">
                  {!jwId
                    ? 'Select a JWSO first…'
                    : jwDetailQ.isFetching
                      ? 'Loading lines…'
                      : jwLines.length === 0
                        ? 'No lines on this JWSO'
                        : 'Select a line…'}
                </option>
                {jwLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    L{l.lineNo} · {l.partName} · rate {l.rate}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Date">
            <input
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Qty ★">
            <input
              type="number"
              min={1}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{ fontWeight: 700, color: 'var(--green)' }}
            />
          </Field>

          <Field label="Rate (per unit)">
            <input
              type="number"
              min={0}
              className="innovic-input"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label="Remarks">
            <input
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional note…"
            />
          </Field>
        </div>

        {/* Live preview — Taxable = qty × rate; GST from the JWSO header %. */}
        <div
          style={{
            marginTop: 16,
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)',
            padding: 12,
            background: 'var(--bg3)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
          }}
        >
          <PreviewCell label="Taxable" value={money(taxable)} />
          <PreviewCell label={`GST (${gstPct}%)`} value={money(gstAmount)} />
          <PreviewCell label="Total" value={money(total)} accent />
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="text3" style={{ fontSize: 10 }}>
              qty × rate = taxable · + GST from JWSO
            </div>
          </div>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: 'rgba(239,68,68,0.08)',
              color: 'var(--red)',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={onSave}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Invoice'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        className="mono fw-700"
        style={{ fontSize: 16, color: accent ? 'var(--green)' : 'var(--text)' }}
      >
        {value}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
