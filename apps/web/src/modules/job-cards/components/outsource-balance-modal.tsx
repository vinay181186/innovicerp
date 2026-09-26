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
import { opSrNo } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { itemCodeWithRev } from '@/lib/item-code';
import { useOutsourceOpBalance } from '@/modules/jc-ops/api';
import { useVendorsList } from '@/modules/vendors/api';
import { jobCardsKeys } from '../api';

export function OutsourceBalanceModal({
  jcId,
  jcCode,
  opId,
  opSeq,
  operation,
  itemCode,
  itemRevision,
  available,
  defaultVendorCode,
  onClose,
  onDone,
}: {
  jcId: string;
  jcCode: string;
  opId: string;
  opSeq: number;
  operation: string;
  itemCode: string;
  /** The customer's drawing revision from the SO line behind this card, so the
   *  item reads `CODE/REV`. Optional: the create/edit form has no revision to
   *  hand and `itemCodeWithRev` then leaves the bare code alone. */
  itemRevision?: string | null;
  available: number;
  defaultVendorCode: string;
  onClose: () => void;
  onDone: (qtyDone: number) => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const outsource = useOutsourceOpBalance();
  const [qty, setQty] = useState<number>(available);
  const [vendorCode, setVendorCode] = useState<string>(defaultVendorCode);
  // "CODE — Name" of the picked vendor, kept so the label survives the search
  // page moving on. Seeded with the bare default code until the master resolves it.
  const [vendorLabel, setVendorLabel] = useState<string>(defaultVendorCode);
  const [err, setErr] = useState<string | null>(null);

  // Vendor picker searches the SERVER: the list endpoint caps `limit` at 200 and
  // the vendor master runs past that, so a static first page could not reach
  // later vendors. The saved value is still the vendor CODE (see onSave).
  const [vendorSearch, setVendorSearch] = useState('');
  const { data: vendorsData, isFetching: vendorsFetching } = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    limit: 200,
    offset: 0,
  });
  const vendorOptions = (vendorsData?.vendors ?? [])
    .filter((v) => v.isActive)
    .map((v) => ({ id: v.id, code: v.code, name: v.name }));
  const pickedVendor = vendorCode ? vendorOptions.find((v) => v.code === vendorCode) : undefined;
  const pickedLabel = pickedVendor
    ? `${pickedVendor.code} — ${pickedVendor.name}`
    : vendorCode
      ? vendorLabel || vendorCode
      : undefined;

  const onSave = (): void => {
    setErr(null);
    if (qty <= 0) {
      setErr('Qty to Outsource is required.');
      return;
    }
    if (qty > available) {
      setErr(`Qty to Outsource cannot be more than Available (${available}).`);
      return;
    }
    if (!vendorCode.trim()) {
      setErr('Vendor is required.');
      return;
    }
    outsource.mutate(
      { id: opId, input: { qty, vendorCode: vendorCode.trim() } },
      {
        onSuccess: () => {
          if (jcId) void qc.invalidateQueries({ queryKey: jobCardsKeys.detail(jcId) });
          onDone(qty);
        },
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
          Outsource Available Qty — {jcCode} Op {opSrNo(opSeq)}
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
            Item: {itemCodeWithRev(itemCode, itemRevision)} · Available:{' '}
            <b style={{ color: 'var(--amber2)' }}>{available}</b> pcs. Raises an outsource PR.
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
              max={available}
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
              id="jcOutsourceBalanceVendor"
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
              background: 'var(--red3)',
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
