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
// false.
//
// The two tabs:
//   📦 Against PO      → <GrnAgainstPoForm>: pick an approved buying PO, its
//                        pending lines load, save via POST /goods-receipt-notes.
//   🏭 Against JWPO/DC → <GrnAgainstDcForm>: pick the job-work PO, then one of
//                        its OSP delivery challans still out at the vendor, and
//                        save via POST /delivery-challans/:id/receive — the same
//                        path the DC Receive page uses, so the GRN is auto-raised
//                        and linked to the DC and the PO's received qty moves.
//                        (It used to post to /jw-dc/inward, which never created
//                        a GRN and never touched the PO.)
// Neither tab carries QC fields; QC happens later at Incoming QC. The old
// <GoodsReceiptNoteForm> still serves /goods-receipt-notes/$id/edit only.

import { GRN_INWARD_TYPES, type CreateGoodsReceiptNoteInput, type GrnInwardType } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useState, type CSSProperties } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { useCreateGoodsReceiptNote } from '../api';
import { GrnAgainstDcForm } from './grn-against-dc-form';
import { GrnAgainstPoForm } from './grn-against-po-form';

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
  // ONE exit guard for the whole inward screen, both tabs. Where Cancel goes is
  // where ESC → Exit goes; every other way off the screen (Back link,
  // breadcrumb, browser Back) gets "Are you sure?". The Job Work Return tab
  // has no Cancel of its own and lives inside this component, so it is handed
  // `exit.leave` (as `onLeave`) for its save rather than a second guard.
  const goBack = useCallback(() => void navigate({ to: '/goods-receipt-notes' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  // Purchase branch — the existing create endpoint; the form is the new
  // PO-driven one (lines come from the PO, never typed by hand).
  const createPurchase = useCreateGoodsReceiptNote();
  const [purchaseErr, setPurchaseErr] = useState<string | null>(null);
  const onPurchaseSubmit = async (values: CreateGoodsReceiptNoteInput): Promise<void> => {
    setPurchaseErr(null);
    try {
      const created = await createPurchase.mutateAsync(values);
      exit.leave(
        () =>
          void navigate({ to: '/goods-receipt-notes/$id', params: { id: created.id }, replace: true }),
      );
    } catch (e) {
      setPurchaseErr(e instanceof Error ? e.message : 'Failed to create GRN');
    }
  };

  return (
    <div>
      {exit.dialog}
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
          {/* ▸ GRN TYPE — 2-button selector */}
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

          {/* Switching tabs unmounts the other form, so its picks and lines
              are dropped — no stale state crosses over. */}
          {inwardType === 'purchase' ? (
            <GrnAgainstPoForm
              {...(initialPurchaseOrderId ? { initialPurchaseOrderId } : {})}
              onSubmit={onPurchaseSubmit}
              submitError={purchaseErr}
              onCancel={() => exit.leave(goBack)}
            />
          ) : null}
          {inwardType === 'job_work_return' ? (
            <GrnAgainstDcForm onLeave={exit.leave} onCancel={() => exit.leave(goBack)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
