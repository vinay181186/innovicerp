// ADR-081 dual-lane — outsource the REMAINING qty of a STARTED in-house process
// op straight from the JC edit surface. Prefills qty to the op's `available`
// (also the max) and resolves the vendor against the vendors master. Submitting
// POSTs to /jc-ops/:id/outsource-balance which validates qty ≤ available, stamps
// the op's outsource vendor, and raises a jw_osp PR; the existing OSP
// PR→PO→DC→GRN→QC flow reconciles the balance. Mirrors the jc-ops board modal.
//
// Extracted verbatim from JobCardForm so the create/edit form AND the
// mode-switched JC Status edit branch share ONE modal (no copy-paste of the
// production outsource-balance flow).
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useOutsourceOpBalance } from '@/modules/jc-ops/api';
import { jobCardsKeys } from '../api';

export function OutsourceBalanceModal({
  jcId,
  jcCode,
  opId,
  opSeq,
  operation,
  itemCode,
  available,
  defaultVendorCode,
  vendors,
  onClose,
  onDone,
}: {
  jcId: string;
  jcCode: string;
  opId: string;
  opSeq: number;
  operation: string;
  itemCode: string;
  available: number;
  defaultVendorCode: string;
  vendors: { id: string; code: string; name: string }[];
  onClose: () => void;
  onDone: (qtyDone: number) => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const outsource = useOutsourceOpBalance();
  const [qty, setQty] = useState<number>(available);
  const [vendorCode, setVendorCode] = useState<string>(defaultVendorCode);
  const [err, setErr] = useState<string | null>(null);

  const onSave = (): void => {
    setErr(null);
    if (qty <= 0 || qty > available) {
      setErr(`Qty must be between 1 and ${available}`);
      return;
    }
    if (!vendorCode.trim()) {
      setErr('Vendor is required');
      return;
    }
    outsource.mutate(
      { id: opId, input: { qty, vendorCode: vendorCode.trim() } },
      {
        onSuccess: () => {
          if (jcId) void qc.invalidateQueries({ queryKey: jobCardsKeys.detail(jcId) });
          onDone(qty);
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to outsource balance'),
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
          Outsource Balance — {jcCode} Op{opSeq}
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
            Operation: <b>{operation}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            Item: {itemCode || '—'} · Available:{' '}
            <b style={{ color: 'var(--amber)' }}>{available}</b> pcs. Sends the balance to a vendor
            as a JW OSP purchase request.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px' }}>
            <div
              className="text3"
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                marginBottom: 4,
                color: 'var(--amber)',
              }}
            >
              Qty to outsource ★
            </div>
            <input
              type="number"
              min={1}
              max={available}
              className="innovic-select"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <div
              className="text3"
              style={{ fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}
            >
              Vendor ★
            </div>
            <input
              className="innovic-select"
              list="dlJcOutsourceBalanceVendor"
              value={vendorCode}
              onChange={(e) => setVendorCode(e.target.value)}
              placeholder="Vendor code"
              style={{ width: '100%', fontSize: 12 }}
            />
            <datalist id="dlJcOutsourceBalanceVendor">
              {vendors.map((v) => (
                <option key={v.id} value={v.code}>
                  {v.code} — {v.name}
                </option>
              ))}
            </datalist>
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
              'Outsource balance'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
