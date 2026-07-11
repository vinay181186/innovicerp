// Unified GRN (Inward) create shell — UI-only aggregator over existing backends.
//
// Canonical source: user-written Unified-Inward spec (option 3 — no legacy HTML
// reference available). Purchase + Job Work Return only (Miscellaneous deferred —
// no store-adjust endpoint; JWSO Inward lives on the dedicated Party Material GRN
// screen). The Purchase tab REUSES the existing <GoodsReceiptNoteForm> verbatim so
// current behaviour is unchanged; Job Work Return routes to /jw-dc/inward with NO
// backend change.

import { GRN_INWARD_TYPES, type CreateGoodsReceiptNoteInput, type GrnInwardType } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { useCreateGoodsReceiptNote } from '../api';
import { GoodsReceiptNoteForm } from './goods-receipt-note-form';
import { JobWorkReturnSection } from './job-work-return-section';

const TYPE_META: Record<GrnInwardType, { label: string; icon: string }> = {
  purchase: { label: 'Purchase', icon: '📦' },
  job_work_return: { label: 'Job Work Return', icon: '🏭' },
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
            <div className="panel-title">+ New Goods Receipt Note (Inward)</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              One inward screen for all incoming material — pick a type, then fill the matching form.
            </div>
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
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
              📌 Miscellaneous (manual) inward is not available yet — no store-adjustment endpoint exists.
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
