// Level 2 of SO/JWSO Planning (PL-4b): one order, a compact header and ONE
// table with EVERY line. Split out of routes/workflow.tsx (ADR-199 table
// standard) so the file stays under the 400-line rule.
//
// ADR-199 level-2 conversion (2026-10-03): the hand-built fixed-layout sheet is
// gone — the lines now render on the shared FIT <DataTable>
// (TABLE_KEYS.planningLines), so every row is ONE line, the sheet always fits
// its width, and the columns that will not fit fold into the ▸ panel. The
// column set lives in planning-line-columns.tsx, the ▸ panel in
// planning-line-expand.tsx, every action in the row's ONE ⋯ menu
// (planning-line-menu.ts) and the modals in order-detail-modals.tsx.

import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { PlanningLine, PlanningPlanSummary } from '@innovic/shared';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { DataTable, renderRowMenuLink } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { useExecutePlan } from '@/modules/plans/api';
import { soTypeLabel } from '@/modules/sales-orders/lib/so-status-label';
import { usePlanningSoDetail } from '../api';
import { OrderDetailModals, type SavedPlanNote, type StockNote } from './order-detail-modals';
import { planningLineColumns } from './planning-line-columns';
import { PlanningLineExpand } from './planning-line-expand';
import { type PlanningLineMenuArgs, planChildMenu, planningLineMenu } from './planning-line-menu';
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
  // ADR-180 — the three numbers as they stood right after the last Allocate /
  // Release, read off that action's own response.
  const [stockNote, setStockNote] = useState<StockNote | null>(null);
  // Which lines have their ▸ panel open (the fit table's one expand control).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // A failed "Create JC / Raise PR" from the row's ⋯. The menu itself only
  // logs a rejection, so the failure is caught here and named on screen with
  // the plan it belongs to.
  const [execError, setExecError] = useState<{ code: string; message: string } | null>(null);
  // The plan just saved by "+ Plan" and its next step. A route-card plan's
  // only way on is a Production Order, so the page offers it right here
  // instead of the box just closing (the planner used to go to Production
  // Orders → New and find the plan again).
  const [savedPlan, setSavedPlan] = useState<SavedPlanNote | null>(null);
  const { data: eff } = useMyAccess();
  const canProductionOrder = effectiveFormPerms(eff, 'prodorder_create').entry;
  const canCreateRouteCard = effectiveFormPerms(eff, 'routecard_create').entry;
  const canMlPlan = effectiveFormPerms(eff, 'mlplan_create').entry;

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
  const toggleExpanded = (soLineId: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(soLineId)) next.delete(soLineId);
      else next.add(soLineId);
      return next;
    });
  };
  // Let a plan's work out. The PROMISE is returned to the ⋯ (RowMenu goes busy
  // and blocks a second click only while a promise is pending — a `void` return
  // would allow a double execute). The rejection is caught here, so the menu
  // never throws and the planner is told which plan failed; the mutation's own
  // onSuccess invalidates the planning queries, which refreshes these lines.
  const runExecutePlan = async (plan: PlanningPlanSummary): Promise<void> => {
    setExecError(null);
    try {
      await executePlan.mutateAsync(plan.id);
    } catch (err) {
      setExecError({
        code: plan.code,
        message:
          err instanceof Error ? err.message : 'Could not create the Job Card / PR. Try again.',
      });
    }
  };

  // ONE args object per line, shared by the line's ⋯ and its child rows' ⋯ —
  // a new gate added here reaches both menus.
  const menuArgs = (line: PlanningLine): PlanningLineMenuArgs => ({
    so,
    line,
    perms,
    canProductionOrder,
    canCreateRouteCard,
    canMlPlan,
    setModal,
    onExecutePlan: runExecutePlan,
  });

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
                {soNoWithInternal(so.soCode, so.soInternalNo)}
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

      {execError ? (
        <Banner
          tone="error"
          role="alert"
          title={
            <>
              Could not let out plan <span className="mono">{execError.code}</span>
            </>
          }
          onDismiss={() => setExecError(null)}
        >
          {execError.message}
        </Banner>
      ) : null}

      {/* ── Every line, one table (ADR-199 fit table) ── */}
      <div className="panel">
        <DataTable<PlanningLine>
          tableKey={TABLE_KEYS.planningLines}
          columns={planningLineColumns(so.source)}
          rows={so.lines}
          rowKey={(l) => l.soLineId}
          // The plan code must stay on screen however narrow the sheet is.
          defaultPinned={['plans']}
          renderExpanded={(l) =>
            expanded.has(l.soLineId) ? (
              <PlanningLineExpand
                line={l}
                renderLink={renderRowMenuLink}
                rowMenu={(plan, partShort) => planChildMenu(plan, partShort, menuArgs(l))}
              />
            ) : null
          }
          onToggleExpanded={(l) => toggleExpanded(l.soLineId)}
          renderLink={renderRowMenuLink}
          rowMenuLabel={(l) => `Actions for line ${l.lineNo}`}
          rowMenu={(line) => planningLineMenu(menuArgs(line))}
          empty="This order has no lines."
        />
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
