// JC Operations board — the Outsource Available dialog. Moved verbatim out of
// routes/list.tsx (which was past the 400-line rule) when the board went to
// 25-row server pages (ADR-201).

import { type JcOpsBoardRow, type OutsourceOpBalanceInput, opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { itemCodeWithRev } from '@/lib/item-code';
import { useVendorsList } from '@/modules/vendors/api';
import { useOutsourceOpBalance } from '../api';

// Outsource the remaining qty of an in-house PROCESS op (ADR-081 dual-lane).
// Prefills qty to the op's `available` (also the max) and resolves the vendor
// against the vendors master. Submitting POSTs to /jc-ops/:id/outsource-balance
// which validates qty ≤ available, stamps the op's outsource vendor, and raises
// a jw_osp PR; the existing OSP PR→PO→DC→GRN→QC flow reconciles the balance.
export function OutsourceBalanceModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const outsource = useOutsourceOpBalance();
  const [qty, setQty] = useState<number>(row.available);
  const [vendorCode, setVendorCode] = useState<string>(row.outsourceVendorCode ?? '');
  // "CODE — Name" of the picked vendor, kept so the label survives the search
  // page moving on. Seeded with the op's current vendor code.
  const [vendorLabel, setVendorLabel] = useState<string>(row.outsourceVendorCode ?? '');
  // The vendor box searches the SERVER (?search=) — a fixed first page of 200
  // left every vendor after it unpickable. The saved value is still the CODE.
  const [vendorSearch, setVendorSearch] = useState('');
  // Active vendors only (A10): a disabled vendor is not offered for a NEW pick.
  // The op's current vendor still reads right via vendorLabel / its code.
  const { data: vendorsData, isFetching: vendorsFetching } = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const vendorOptions = (vendorsData?.vendors ?? []).map((v) => ({
    id: v.id,
    code: v.code,
    name: v.name,
  }));
  const pickedVendor = vendorCode ? vendorOptions.find((v) => v.code === vendorCode) : undefined;
  const pickedLabel = pickedVendor
    ? `${pickedVendor.code} — ${pickedVendor.name}`
    : vendorCode
      ? vendorLabel || vendorCode
      : undefined;
  const [err, setErr] = useState<string | null>(null);

  const onSave = (): void => {
    setErr(null);
    if (qty <= 0 || qty > row.available) {
      setErr(`Qty must be between 1 and Available (${row.available}).`);
      return;
    }
    if (!vendorCode.trim()) {
      setErr('Vendor is required.');
      return;
    }
    const input: OutsourceOpBalanceInput = { qty, vendorCode: vendorCode.trim() };
    outsource.mutate(
      { id: row.jcOpId, input },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(
            e instanceof Error ? e.message : 'Could not outsource the pending qty. Try again.',
          ),
      },
    );
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
          width: 'min(480px, 96vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          Outsource Available Qty — {row.jcCode} Op {opSrNo(row.opSeq)}
        </div>
        <div
          style={{
            background: 'var(--bg3)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Operation: <b>{row.operation}</b> · Planned machine:{' '}
            <b className="mono">{row.machineCode ?? '—'}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {/* POL — the CUSTOMER's own PO line number, ahead of the item code. */}
            {row.clientPoLineNo ? (
              <>
                POL{' '}
                <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                  {row.clientPoLineNo}
                </span>{' '}
                ·{' '}
              </>
            ) : null}
            Item:{' '}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCodeWithRev(row.jcItemCode, row.itemRevision)}
            </span>{' '}
            · Available: <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs. Sends this
            qty to a vendor as an OSP purchase request.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px' }}>
            <div
              className="text3"
              style={{
                fontSize: 11,
                marginBottom: 4,
                color: 'var(--amber2)',
              }}
            >
              Qty to Outsource <span className="req">★</span>
            </div>
            <input
              type="number"
              min={1}
              max={row.available}
              className="innovic-select"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
              Vendor <span className="req">★</span>
            </div>
            <SearchableSelect
              id="outsource-balance-vendor"
              value={pickedVendor?.id ?? null}
              onChange={(id) => {
                const v = id ? vendorOptions.find((x) => x.id === id) : undefined;
                setVendorCode(v?.code ?? '');
                setVendorLabel(v ? `${v.code} — ${v.name}` : '');
              }}
              onSearch={setVendorSearch}
              loading={vendorsFetching}
              options={vendorOptions}
              placeholder="🔍 Vendor code or name"
              valueLabel={pickedLabel}
              selectedLabel={(v) => (v.code ? `${v.code} — ${v.name}` : v.name)}
            />
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
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={outsource.isPending}
          >
            {outsource.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Outsourcing…
              </>
            ) : (
              'Outsource Available'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
