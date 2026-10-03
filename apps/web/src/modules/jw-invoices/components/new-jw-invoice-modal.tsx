// New JW Invoice (Labour) modal — bills the processing / labour charge for a Job
// Work Order line (qty × line rate + GST from the JWSO header). NO material
// value: the client owns the material. Split out of jw-invoice-view.tsx so both
// files clear the 400-line rule; behaviour, hooks, validation and money display
// are identical to the original screen.

import { type CreateJwInvoiceInput } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { useSaveKey } from '@/lib/use-save-key';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useCreateJwInvoice, useJwInvoiceableLines } from '../api';
import { Field, PreviewCell } from './jw-invoice-form-fields';

function money(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function NewJwInvoiceModal({
  onClose,
  initialJwId,
}: {
  onClose: () => void;
  /** JWSO pre-picked from `?jw=` (JWSO detail → "JW Invoice"). */
  initialJwId?: string | undefined;
}): React.JSX.Element {
  const [date, setDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(() => initialJwId ?? null);
  const [lineId, setLineId] = useState<string | null>(null);
  // Filled with the line's To Invoice when a line is picked.
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [remarks, setRemarks] = useState('');
  // '' = Auto: the server decides from the Place of Supply (the customer's
  // State vs ours; SEZ / Overseas → IGST — plan D2). A manual choice is only
  // accepted while the Place of Supply is unknown. Totals do not change.
  const [taxType, setTaxType] = useState<'' | 'sgst_cgst' | 'igst'>('');
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

  // To Invoice (Returned − Invoiced) per line — the limit the server checks.
  const billableQ = useJwInvoiceableLines(jwId ?? undefined);
  const toInvoiceById = useMemo(
    () => new Map((billableQ.data?.lines ?? []).map((b) => [b.jobWorkOrderLineId, b])),
    [billableQ.data],
  );
  const pickedBillable = lineId ? toInvoiceById.get(lineId) : undefined;

  const saveKey = useSaveKey();
  const createMut = useCreateJwInvoice(saveKey);

  const onPickLine = (id: string): void => {
    setLineId(id || null);
    const line = jwLines.find((l) => l.id === id);
    const billable = toInvoiceById.get(id);
    setQty(billable && billable.toInvoiceQty > 0 ? String(billable.toInvoiceQty) : '');
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
    if (!qty.trim() || !Number.isInteger(qtyNum) || qtyNum <= 0) {
      setErr('Invoice Qty: whole numbers only, 1 or more.');
      return;
    }
    if (pickedBillable && qtyNum > pickedBillable.toInvoiceQty) {
      setErr(
        `Invoice Qty (${qtyNum}) cannot be more than To Invoice (${pickedBillable.toInvoiceQty}).`,
      );
      return;
    }
    const input: CreateJwInvoiceInput = {
      invoiceDate: date,
      jobWorkOrderLineId: lineId,
      qty: qtyNum,
      ...(taxType ? { taxType } : {}),
    };
    if (Number.isFinite(rateNum) && rate.trim()) input.rate = rateNum;
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(
          e instanceof Error ? e.message : 'Could not save Invoice. Check the lines and try again.',
        ),
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
                  setQty('');
                }}
                onSearch={setJwSearch}
                loading={jwQuery.isFetching}
                // The pre-picked JWSO may sit outside the first 50 the picker
                // lists, so its label comes from the loaded detail.
                valueLabel={
                  jwId && jwDetailQ.data?.id === jwId
                    ? `${jwDetailQ.data.code} — ${jwDetailQ.data.customerName ?? ''}`
                    : undefined
                }
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
            <Field label="Ln ★">
              <select
                className="innovic-input"
                value={lineId ?? ''}
                disabled={!jwId || jwDetailQ.isFetching || billableQ.isFetching}
                onChange={(e) => onPickLine(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="">
                  {!jwId
                    ? 'Select a JWSO first…'
                    : jwDetailQ.isFetching || billableQ.isFetching
                      ? 'Loading lines…'
                      : jwLines.length === 0
                        ? 'No lines on this JWSO'
                        : 'Select a line…'}
                </option>
                {jwLines.map((l) => {
                  const b = toInvoiceById.get(l.id);
                  return (
                    <option key={l.id} value={l.id} disabled={b ? b.toInvoiceQty <= 0 : false}>
                      L{l.lineNo} · {l.partName} · rate {l.rate}
                      {b ? ` · To Invoice ${b.toInvoiceQty}` : ''}
                    </option>
                  );
                })}
              </select>
            </Field>
          </div>

          <Field label="Invoice Date">
            <input
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field
            label={
              pickedBillable
                ? `Invoice Qty ★ (To Invoice ${pickedBillable.toInvoiceQty})`
                : 'Invoice Qty ★'
            }
          >
            <input
              type="number"
              min={1}
              step={1}
              max={pickedBillable?.toInvoiceQty}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{ fontWeight: 700, color: 'var(--green2)' }}
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
          <Field label="Tax Type">
            <select
              className="innovic-input"
              value={taxType}
              onChange={(e) =>
                setTaxType(
                  e.target.value === 'igst'
                    ? 'igst'
                    : e.target.value === 'sgst_cgst'
                      ? 'sgst_cgst'
                      : '',
                )
              }
              style={{ width: '100%' }}
            >
              <option value="">Auto (from customer&apos;s State)</option>
              <option value="sgst_cgst">SGST + CGST</option>
              <option value="igst">IGST</option>
            </select>
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
            <div className="text3" style={{ fontSize: 11 }}>
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
              color: 'var(--red2)',
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
