// Service PO create form. Mirror of legacy _spoCreateForm (L27513).
//
// Header (date / vendor / expense head / cost center / SO ref) + line
// items grid + tax + remarks + Save Draft / Save & Submit buttons.

import type { CreateServicePoInput, ServicePoLineInput } from '@innovic/shared';
import { SERVICE_PO_EXPENSE_HEADS } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import { useVendorsList } from '@/modules/vendors/api';
import { useCreateServicePo } from '../api';

export const servicePosNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'service-pos/new',
  component: ServicePosNewPage,
});

interface LineDraft {
  description: string;
  qty: number;
  rate: number;
}

function emptyLine(): LineDraft {
  return { description: '', qty: 1, rate: 0 };
}

function ServicePosNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data: me } = useSession();
  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const createMut = useCreateServicePo();
  const [vendorSearch, setVendorSearch] = useState('');
  const [soSearch, setSoSearch] = useState('');
  const vendorsQuery = useVendorsList(
    { search: vendorSearch || undefined, limit: 50, offset: 0 },
    { enabled: canEdit },
  );
  const salesOrdersQuery = useSalesOrdersList(
    { search: soSearch || undefined, limit: 50, offset: 0 },
    { enabled: canEdit },
  );

  const [spoNo, setSpoNo] = useState('');
  const [spoDate, setSpoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [vendorId, setVendorId] = useState('');
  const [expenseHead, setExpenseHead] = useState<string>('Other');
  const [costCenter, setCostCenter] = useState<'so' | 'general'>('so');
  const [soRefId, setSoRefId] = useState('');
  const [taxType, setTaxType] = useState<'sgst_cgst' | 'igst'>('sgst_cgst');
  const [gstPct, setGstPct] = useState(18);
  const [paymentTerms, setPaymentTerms] = useState('Immediate');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Manager / admin access required.
        </div>
      </div>
    );
  }

  function updateLine(i: number, patch: Partial<LineDraft>): void {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number): void {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addLine(): void {
    setLines((prev) => [...prev, emptyLine()]);
  }

  const subtotal = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const taxAmount = (subtotal * gstPct) / 100;
  const total = subtotal + taxAmount;

  async function save(status: 'draft' | 'pending'): Promise<void> {
    setSubmitError(null);
    const validLines = lines.filter((l) => l.description.trim());
    if (!spoNo.trim()) {
      setSubmitError('SPO No. is required');
      return;
    }
    if (!vendorId) {
      setSubmitError('Select a vendor');
      return;
    }
    if (validLines.length === 0) {
      setSubmitError('Add at least one service line with description');
      return;
    }
    const input: CreateServicePoInput = {
      spoNo: spoNo.trim(),
      spoDate,
      vendorId,
      expenseHead,
      costCenter,
      taxType,
      gstPct,
      paymentTerms,
      status,
      lines: validLines.map<ServicePoLineInput>((l) => ({
        description: l.description.trim(),
        qty: l.qty,
        rate: l.rate,
      })),
    };
    if (costCenter === 'so' && soRefId) input.soRefId = soRefId;
    if (remarks.trim()) input.remarks = remarks.trim();
    try {
      const saved = await createMut.mutateAsync(input);
      await navigate({ to: '/service-pos/$id', params: { id: saved.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div>
      <Link to="/service-pos" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back
      </Link>

      <div className="panel" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--green)', marginBottom: 14 }}>
          ➕ New Service PO
        </div>

        <div
          className="form-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}
        >
          <div className="form-grp">
            <label className="form-label">SPO No. <span className="req">★</span></label>
            <input
              className="innovic-input"
              value={spoNo}
              onChange={(e) => setSpoNo(e.target.value)}
              placeholder="SPO-00001"
            />
          </div>
          <div className="form-grp">
            <label className="form-label">Date</label>
            <input
              type="date"
              className="innovic-input"
              value={spoDate}
              onChange={(e) => setSpoDate(e.target.value)}
            />
          </div>
          <div className="form-grp">
            <label className="form-label">Vendor <span className="req">★</span></label>
            <SearchableSelect
              id="spo-vendor"
              value={vendorId || null}
              onChange={(id) => setVendorId(id ?? '')}
              onSearch={setVendorSearch}
              loading={vendorsQuery.isFetching}
              placeholder="🔍 Select vendor — type code or name…"
              options={(vendorsQuery.data?.vendors ?? []).map((v) => ({
                id: v.id,
                code: v.code,
                name: v.name,
              }))}
            />
          </div>
          <div className="form-grp">
            <label className="form-label">Expense Head</label>
            <select
              className="innovic-select"
              value={expenseHead}
              onChange={(e) => setExpenseHead(e.target.value)}
            >
              {SERVICE_PO_EXPENSE_HEADS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, margin: '12px 0', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="cc"
              checked={costCenter === 'so'}
              onChange={() => setCostCenter('so')}
            />
            <span style={{ fontSize: 12, fontWeight: 600 }}>Against SO</span>
          </label>
          <label style={{ display: 'flex', gap: 4, cursor: 'pointer' }}>
            <input
              type="radio"
              name="cc"
              checked={costCenter === 'general'}
              onChange={() => setCostCenter('general')}
            />
            <span style={{ fontSize: 12, fontWeight: 600 }}>General Expense</span>
          </label>
        </div>

        {costCenter === 'so' ? (
          <div className="form-grp" style={{ maxWidth: 400 }}>
            <label className="form-label">SO / JW No.</label>
            <SearchableSelect
              id="spo-so"
              value={soRefId || null}
              onChange={(id) => setSoRefId(id ?? '')}
              onSearch={setSoSearch}
              loading={salesOrdersQuery.isFetching}
              placeholder="🔍 Select SO — type code or customer…"
              options={(salesOrdersQuery.data?.items ?? []).map((s) => ({
                id: s.id,
                code: s.code,
                name: s.customerName ?? '',
              }))}
            />
          </div>
        ) : null}

        {/* Lines */}
        <div style={{ margin: '16px 0' }}>
          <div className="text2" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
            Service Lines
          </div>
          <table className="innovic-table" style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--bg4)' }}>
                <th style={{ width: 30, fontSize: 10 }}>#</th>
                <th style={{ fontSize: 10 }}>Description <span className="req">★</span></th>
                <th style={{ width: 80, fontSize: 10 }}>Qty</th>
                <th style={{ width: 110, fontSize: 10 }}>Rate (₹)</th>
                <th style={{ width: 110, fontSize: 10, textAlign: 'right' }}>Amount</th>
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'center', fontSize: 12 }}>{i + 1}</td>
                  <td>
                    <input
                      className="innovic-input"
                      value={l.description}
                      onChange={(e) => updateLine(i, { description: e.target.value })}
                      placeholder="Service description…"
                      style={{ width: '100%', fontSize: 12 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="innovic-input"
                      value={l.qty}
                      min={0}
                      step={0.01}
                      onChange={(e) => updateLine(i, { qty: Number(e.target.value) || 0 })}
                      style={{ width: 70, fontSize: 12, textAlign: 'right' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="innovic-input"
                      value={l.rate}
                      min={0}
                      step={0.01}
                      onChange={(e) => updateLine(i, { rate: Number(e.target.value) || 0 })}
                      style={{ width: 100, fontSize: 12, textAlign: 'right' }}
                    />
                  </td>
                  <td
                    className="mono fw-700"
                    style={{ textAlign: 'right', fontSize: 12 }}
                  >
                    ₹{(l.qty * l.rate).toFixed(2)}
                  </td>
                  <td>
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => removeLine(i)}
                      >
                        <Trash2 size={12} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={addLine}
            style={{ marginTop: 8 }}
          >
            <Plus size={12} /> Add Line
          </button>
        </div>

        {/* Tax + Total */}
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            maxWidth: 380,
            marginLeft: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="text3" style={{ fontSize: 12 }}>Subtotal</span>
            <span className="mono fw-700">₹{subtotal.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span className="text3" style={{ fontSize: 12 }}>GST</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setTaxType('sgst_cgst')}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                background: taxType === 'sgst_cgst' ? 'var(--cyan)' : 'var(--bg4)',
                color: taxType === 'sgst_cgst' ? '#fff' : 'inherit',
              }}
            >
              SGST+CGST
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setTaxType('igst')}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                background: taxType === 'igst' ? 'var(--cyan)' : 'var(--bg4)',
                color: taxType === 'igst' ? '#fff' : 'inherit',
              }}
            >
              IGST
            </button>
            <input
              type="number"
              className="innovic-input"
              value={gstPct}
              min={0}
              max={28}
              onChange={(e) => setGstPct(Number(e.target.value) || 0)}
              style={{ width: 50, fontSize: 11, textAlign: 'right' }}
            />
            <span>%</span>
            <span className="mono fw-700" style={{ marginLeft: 'auto' }}>
              ₹{taxAmount.toFixed(2)}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: '2px solid var(--cyan)',
              paddingTop: 6,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--cyan)' }}>Total</span>
            <span
              className="mono fw-700"
              style={{ fontSize: 16, color: 'var(--cyan)' }}
            >
              ₹{total.toFixed(2)}
            </span>
          </div>
        </div>

        <div
          className="form-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 12,
            marginTop: 12,
          }}
        >
          <div className="form-grp">
            <label className="form-label">Payment Terms</label>
            <select
              className="innovic-select"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            >
              <option>Immediate</option>
              <option>15 days</option>
              <option>30 days</option>
              <option>45 days</option>
              <option>60 days</option>
            </select>
          </div>
          <div className="form-grp">
            <label className="form-label">Remarks</label>
            <input
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Notes…"
            />
          </div>
        </div>

        {submitError ? (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              color: 'var(--red)',
              fontSize: 12,
            }}
          >
            {submitError}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ border: '1px solid var(--amber)', color: 'var(--amber)' }}
            disabled={createMut.isPending}
            onClick={() => void save('draft')}
          >
            💾 Save Draft
          </button>
          <button
            type="button"
            className="btn btn-success"
            style={{ flex: 1, fontSize: 14, padding: 10 }}
            disabled={createMut.isPending}
            onClick={() => void save('pending')}
          >
            {createMut.isPending ? (
              <>
                <Loader2 className="inline h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              '✔ Save & Submit for Approval'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
