// Level 2 of SO/JWSO Planning (PL-4b): one order, a compact header and ONE
// table with EVERY line. Split out of routes/workflow.tsx (ADR-199 table
// standard) so the file stays under the 400-line rule. This surface is the
// plan-create cascade, not a plain list, so its fixed-layout line table (the
// "+ Plan" / Allocate / Release actions and the plan chips) is unchanged; the
// row itself lives in order-line-row.tsx and the modals in order-detail-modals.

import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { Banner } from '@/ui/feedback';
import { useExecutePlan } from '@/modules/plans/api';
import { soTypeLabel } from '@/modules/sales-orders/lib/so-status-label';
import { usePlanningSoDetail } from '../api';
import { LINE_COLS, OrderLineRow } from './order-line-row';
import { OrderDetailModals, type SavedPlanNote, type StockNote } from './order-detail-modals';
import { JwChip, type ModalState } from './planning-shared';

function HeaderField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="mono text3" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

export function OrderDetail({
  soId,
  perms,
  modal,
  setModal,
  onBack,
  onChanged,
}: {
  soId: string;
  perms: { view: boolean; entry: boolean; edit: boolean };
  modal: ModalState;
  setModal: (m: ModalState) => void;
  onBack: () => void;
  /** Invalidate every planning query (list + details) after a write. */
  onChanged: () => void;
}): JSX.Element {
  const detail = usePlanningSoDetail(soId);
  const executePlan = useExecutePlan();
  const navigate = useNavigate();
  // ADR-180 — the three numbers as they stood right after the last Allocate /
  // Release, read off that action's own response.
  const [stockNote, setStockNote] = useState<StockNote | null>(null);
  // The plan just saved by "+ Plan" and its next step. A route-card plan's
  // only way on is a Production Order, so the page offers it right here
  // instead of the box just closing (the planner used to go to Production
  // Orders → New and find the plan again).
  const [savedPlan, setSavedPlan] = useState<SavedPlanNote | null>(null);
  const { data: eff } = useMyAccess();
  const canProductionOrder = effectiveFormPerms(eff, 'prodorder_create').entry;

  const backBtn = (
    <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
      ← Back to list
    </button>
  );

  if (detail.isLoading) {
    return (
      <>
        <div style={{ marginBottom: 14 }}>{backBtn}</div>
        <div style={{ padding: 24 }}>
          <Loader2 className="inline-block animate-spin" /> Loading…
        </div>
      </>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <>
        <div style={{ marginBottom: 14 }}>{backBtn}</div>
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {detail.error instanceof Error
            ? detail.error.message
            : 'Could not load order. Try again.'}
        </div>
      </>
    );
  }

  const so = detail.data;
  const refresh = (): void => {
    onChanged();
    void detail.refetch();
  };

  return (
    <>
      {/* ── Compact order header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        {backBtn}
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          Planning
        </div>
      </div>
      <div
        className="panel"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 28px',
          padding: '10px 14px',
          marginBottom: 12,
        }}
      >
        <HeaderField label={so.source === 'jw' ? 'JWSO No.' : 'SO No.'}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {so.source === 'jw' ? <JwChip /> : null}
            {/* The order number opens the order itself — SO Master detail, or
                the JWSO detail for a JWSO. */}
            {so.source === 'jw' ? (
              <Link
                to="/job-work-orders/$id"
                params={{ id: soId }}
                className="td-code"
                title="Open the JWSO"
              >
                {so.soCode}
              </Link>
            ) : (
              <Link
                to="/sales-orders/$id"
                params={{ id: soId }}
                className="td-code"
                title="Open the SO"
              >
                {so.soCode}
              </Link>
            )}
          </span>
        </HeaderField>
        <HeaderField label="Customer">
          <span className="fw-700">{so.customerName ?? '—'}</span>
        </HeaderField>
        <HeaderField label={so.source === 'jw' ? 'JWSO Type' : 'SO Type'}>
          <span className="badge b-grey">{soTypeLabel(so.soType)}</span>
        </HeaderField>
        <HeaderField label="Due Date">
          <span className="mono">{fmtDate(so.dueDate)}</span>
        </HeaderField>
        <HeaderField label="Client PO No.">
          <span className="mono">{so.clientPoNo ?? '—'}</span>
        </HeaderField>
        <HeaderField label="Lines">
          <span className="mono">{so.lines.length}</span>
        </HeaderField>
      </div>

      {/* ADR-180 confirmation — the position straight after the last action. */}
      {stockNote ? (
        <div
          className="panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 14,
            padding: '8px 14px',
            marginBottom: 12,
            borderColor: 'var(--green)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green2)' }}>
            ✓ {stockNote.what}
          </span>
          <span className="text3" style={{ fontSize: 11 }}>
            Physical{' '}
            <b className="mono" style={{ color: 'var(--cyan)' }}>
              {stockNote.physicalQty}
            </b>{' '}
            · Reserved{' '}
            <b className="mono" style={{ color: 'var(--purple)' }}>
              {stockNote.reservedQty}
            </b>{' '}
            · Available{' '}
            <b className="mono" style={{ color: 'var(--green2)' }}>
              {stockNote.availableQty}
            </b>
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setStockNote(null)}
            style={{ marginLeft: 'auto' }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {savedPlan ? (
        <Banner
          tone="success"
          title={
            <>
              ✓ Plan <span className="mono">{savedPlan.code}</span> saved for {savedPlan.where}
            </>
          }
          onDismiss={() => setSavedPlan(null)}
        >
          {savedPlan.derivedStatus === 'route_card_pending' ? (
            <>
              Next:{' '}
              <Link
                to="/route-cards/new"
                search={
                  savedPlan.itemId
                    ? {
                        itemId: savedPlan.itemId,
                        itemCode: savedPlan.itemCode,
                        itemName: savedPlan.itemName,
                      }
                    : {}
                }
                className="fw-700"
                style={{ color: 'var(--blue)' }}
              >
                New Route Card →
              </Link>
            </>
          ) : canProductionOrder ? (
            <>
              Next:{' '}
              <Link
                to="/production-orders/new"
                search={{ planId: savedPlan.id, planCode: savedPlan.code }}
                className="btn btn-primary btn-sm"
                style={{ marginLeft: 6 }}
              >
                Create Production Order →
              </Link>
            </>
          ) : (
            'Next: a Production Order for this plan (you do not have access to raise one).'
          )}
        </Banner>
      ) : null}

      {/* ── Every line, one table ── */}
      <div className="panel">
        {so.lines.length === 0 ? (
          <div className="empty-state">This order has no lines.</div>
        ) : (
          // `tbl-wrap` so the sheet scrolls sideways on a narrow screen instead
          // of crushing every number into two lines. On a normal wide screen
          // the sheet still fills the panel exactly as before.
          <div className="tbl-wrap">
            <table
              className="innovic-table"
              style={{ tableLayout: 'fixed', width: '100%', minWidth: 1200, margin: 0 }}
            >
              <colgroup>
                {LINE_COLS.map((c) => (
                  <col key={c.key} style={{ width: `${c.width}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {LINE_COLS.map((c) => (
                    <th
                      key={c.key}
                      style={{ whiteSpace: 'normal', cursor: 'default' }}
                      title={c.title}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {so.lines.map((line) => (
                  <OrderLineRow
                    key={line.soLineId}
                    so={so}
                    line={line}
                    perms={perms}
                    setModal={setModal}
                    executePlan={executePlan}
                    onViewJc={(jcId) =>
                      void navigate({ to: '/job-cards/$id', params: { id: jcId } })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      <OrderDetailModals
        so={so}
        modal={modal}
        setModal={setModal}
        refresh={refresh}
        setSavedPlan={setSavedPlan}
        setStockNote={setStockNote}
      />
    </>
  );
}
