// Unified GRN (Inward) create shell — the create screen for BOTH
// /goods-receipt-notes/new and (port-only) /goods-receipt-notes/$id/edit.
//
// Canonical source: legacy `addGRN()` — legacy/InnovicERP_v82_12_3_DataLossFix
// _29-04-2026.html L26515, reached from the list's "+ New GRN" button (renderGRN
// L26481) and from createGRNfromPO() L26730. It builds its modal body as an
// INLINE literal (L26530-26565) — there is no shared GRN body builder — and
// passes it to showModalLg(title, body, onSave, 'Create GRN') at L26567.
// Legacy has NO editGRN/viewGRN: zero row-level edit affordance on any status.
//
// The ▸ GRN TYPE selector below mirrors legacy L26530-26536. Legacy offers THREE
// modes — 📦 Against PO / 🏭 Against JWPO / DC / ✍ Manual (_grnSetMode, L26627).
// Only the first two are ported: GRN_INWARD_TYPES (packages/shared) has no
// 'manual' member. See ISSUE-205 — legacy's Manual mode writes a plain GRN row
// with qcStatus 'Pending'/qcAcceptedQty 0 (L26577-26581) and therefore needs NO
// store-adjustment endpoint; the previously-stated reason for dropping it was
// false. The Purchase tab REUSES <GoodsReceiptNoteForm> verbatim; Job Work
// Return routes to POST /jw-dc/inward with NO backend change.

import { GRN_INWARD_TYPES, type CreateGoodsReceiptNoteInput, type GrnInwardType } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useCreateGoodsReceiptNote } from '../api';
import { GoodsReceiptNoteForm } from './goods-receipt-note-form';
import { JobWorkReturnSection } from './job-work-return-section';

// Button text + icons verbatim from legacy addGRN() L26533-26534.
const TYPE_META: Record<GrnInwardType, { label: string; icon: string }> = {
  purchase: { label: 'Against PO', icon: '📦' },
  job_work_return: { label: 'Against JWPO / DC', icon: '🏭' },
};

function typeBtnStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    padding: '12px',
    border: active ? '2px solid var(--cyan)' : '2px solid var(--border)',
    background: active ? 'rgba(34,211,238,0.08)' : 'var(--bg)',
    fontWeight: 700,
    cursor: 'pointer',
  };
}

export function UnifiedGrnForm({
  initialPurchaseOrderId,
}: {
  initialPurchaseOrderId?: string;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [inwardType, setInwardType] = useState<GrnInwardType>('purchase');

  // Purchase branch — reuses the existing create endpoint + form unchanged.
  const createPurchase = useCreateGoodsReceiptNote();
  const [purchaseErr, setPurchaseErr] = useState<string | null>(null);
  const onPurchaseSubmit = async (values: CreateGoodsReceiptNoteInput): Promise<void> => {
    setPurchaseErr(null);
    try {
      const created = await createPurchase.mutateAsync(values);
      await navigate({
        to: '/goods-receipt-notes/$id',
        params: { id: created.id },
        replace: true,
      });
    } catch (e) {
      setPurchaseErr(e instanceof Error ? e.message : 'Failed to create GRN');
    }
  };

  return (
    <div>
      <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to GRN list
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">📥 New GRN</div>
          </div>
        </div>
        <div className="panel-body">
          {/* ▸ GRN TYPE — 3-button selector */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--cyan)',
                fontFamily: 'var(--mono)',
                fontWeight: 700,
                letterSpacing: '.06em',
                marginBottom: 8,
              }}
            >
              ▸ GRN TYPE
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {GRN_INWARD_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="btn"
                  onClick={() => setInwardType(t)}
                  style={typeBtnStyle(inwardType === t)}
                >
                  {TYPE_META[t].icon} {TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          {inwardType === 'purchase' ? (
            <GoodsReceiptNoteForm
              mode="create"
              {...(initialPurchaseOrderId ? { initialPurchaseOrderId } : {})}
              onSubmit={onPurchaseSubmit}
              submitError={purchaseErr}
              onCancel={() => void navigate({ to: '/goods-receipt-notes' })}
            />
          ) : null}
          {inwardType === 'job_work_return' ? <JobWorkReturnSection /> : null}
        </div>
      </div>
    </div>
  );
}
