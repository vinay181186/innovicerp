// Edit Production Order (ADR-202 Phase 3) — HEADER-level edit with approval.
//
// Only four header fields are editable here: Remarks, PRO Target Date
// (`targetDate`), Actual Size (`actualSize`) and Raw Material Available
// (`rawMaterialAvailable`). Order Qty and the identity fields (plan, route
// card, item) are NOT editable in this phase — they drive the Job Card and the
// plan's Covered / Pending maths, which this edit must not disturb.
//
// When the edit-approval gate is ON and the order is live, the PATCH does not
// change the order — it STAGES the edit for approval (DocumentEditStagedResult)
// and the detail page then shows the amber pending-change chips. Until the
// backend gate lands the PATCH applies normally, which is safe.
//
// Mirrors sales-orders/routes/edit.tsx (the enrolled reference) for the staged
// flow, the opened-version conflict guard and the exit guard.
//
// Layout (pro-routecard-create-edit-mockup.html frame 2, approved 2026-10-06):
// the DETAIL page with the four editable cells turned into inputs — same
// identity line, same clusters in the same place, same Close Ledger | History
// tab panel — and nothing else on the page can be typed into. The page fits
// one 1440×810 screen with no page scroll; the tab panel scrolls inside.
//
// A pending edit (ADR-202) shows as the orange "→ after" chip in its field's
// cell, and Save is off while it waits: the server keeps ONE open edit per
// document and refuses a second with "This document already has an edit
// waiting for approval." — the one-line note in the header says so first.

import type { ProductionOrderStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { useDocumentHistory } from '@/modules/activity-log/api';
import { isStagedResult, usePendingEditForDoc } from '@/modules/document-edits/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { EmptyState, Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Cluster, ClusterGrid } from '@/ui/forms';
import { DetailHeader, useSaveShortcut } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import {
  type UpdateProductionOrderInput,
  useProductionOrder,
  useUpdateProductionOrder,
} from '../api';
import { PoCloseLedger } from '../components/po-close-ledger';
import { PoEditCell } from '../components/po-facts-edit-cell';
import { pendingFor } from '../components/po-facts-pending';
import {
  PoIdentLine,
  PoMaterialCluster,
  PoOrderCluster,
  PoQuantityClusters,
  PoScheduleCluster,
} from '../components/po-facts-readonly';
import { PoStatusBadge } from '../components/po-status-badge';
import '../components/po-detail.css';
import '../components/po-edit.css';

export const productionOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/$id/edit',
  component: ProductionOrderEditPage,
});

/** The only statuses whose header may still be edited — a closed or short-closed
 *  order is frozen (mirrors the detail page's Edit gate). */
const EDITABLE_STATUSES: readonly ProductionOrderStatus[] = ['open', 'partially_closed'];

/** The server's own words when a second edit is sent while one waits
 *  (document-edits/service.ts) — Save's hover text while it is off for that. */
const PENDING_EDIT_MESSAGE = 'This document already has an edit waiting for approval.';

type TabKey = 'ledger' | 'history';

function ProductionOrderEditPage(): React.JSX.Element {
  const { id } = productionOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useProductionOrder(id);
  const saveKey = useSaveKey();
  const update = useUpdateProductionOrder(id, saveKey);

  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  // ADR-202 Phase 3 — an edit already waiting for approval on this order. Its
  // per-field changes drive the orange chips in the input cells, and while it
  // waits Save is off (one open edit per document; the server refuses a
  // second). Same query as the detail page's, so it comes from cache.
  const pendingEdit = usePendingEditForDoc('ProductionOrder', id);
  const pendingRows = pendingEdit.data?.rows ?? [];
  const pendingChanges = pendingRows.flatMap((r) => r.changes);
  const hasPendingEdit = pendingRows.length > 0;
  // Until the check answers Save stays off too, so a second edit can't slip
  // through in that moment (the note and chips wait for real rows).
  const saveBlocked = hasPendingEdit || pendingEdit.isLoading;
  const pendingCount = pendingChanges.length || pendingRows.length;

  // The History tab's count — same arguments as <DocumentHistory> below, so it
  // is one request, not two.
  const history = useDocumentHistory({
    entity: 'ProductionOrder',
    entityId: detail?.id,
    refId: detail?.code,
  });
  // History opens first while an edit waits — it holds the request. Once the
  // user picks a tab, that choice stays.
  const [pickedTab, setPickedTab] = useState<TabKey | null>(null);
  const tab: TabKey = pickedTab ?? (hasPendingEdit ? 'history' : 'ledger');

  // R5 — the version the form opened with; a save over someone else's newer
  // edit is refused (409 edit_conflict) and its message shows in the banner.
  const opened = useOpenedVersion(detail?.updatedAt);

  const [remarks, setRemarks] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [actualSize, setActualSize] = useState('');
  const [rawMaterialAvailable, setRawMaterialAvailable] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE order is staged for approval instead
  // of applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);

  // Seed the form ONCE from the loaded order — a background refetch must not
  // wipe what the user is typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !detail) return;
    seeded.current = true;
    setRemarks(detail.remarks ?? '');
    setTargetDate(detail.targetDate);
    setActualSize(detail.actualSize ?? '');
    setRawMaterialAvailable(detail.rawMaterialAvailable);
  }, [detail]);

  const goBack = useCallback(
    () => void navigate({ to: '/production-orders/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const canSubmit = /^\d{4}-\d{2}-\d{2}$/.test(targetDate);

  const save = useCallback(async (): Promise<void> => {
    if (!detail || !canSubmit || update.isPending || saveBlocked) return;
    setSubmitError(null);
    // All fields are sent as strings (the contract types them `string |
    // undefined`); an empty string clears a cleared text field, and the
    // checkbox rides as "true" / "false". `expectedUpdatedAt` is omitted (not
    // set to undefined explicitly) only when the order never carried one.
    const input: UpdateProductionOrderInput = {
      remarks: remarks.trim(),
      targetDate,
      actualSize: actualSize.trim(),
      rawMaterialAvailable,
      ...(opened.expected() ? { expectedUpdatedAt: opened.expected() } : {}),
    };
    try {
      const saved = await update.mutateAsync(input);
      if (isStagedResult(saved)) {
        // The gate is on and this order is live: nothing changed on the order —
        // the edit is now waiting for approval. Say so, then return to the
        // detail (its fields now carry the pending-change chip).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        exit.leave(
          () => void navigate({ to: '/production-orders/$id', params: { id }, replace: true }),
        );
        return;
      }
      opened.saved(saved.updatedAt);
      exit.leave(
        () => void navigate({ to: '/production-orders/$id', params: { id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save changes. Try again.');
    }
  }, [
    detail,
    canSubmit,
    saveBlocked,
    update,
    remarks,
    targetDate,
    actualSize,
    rawMaterialAvailable,
    opened,
    exit,
    navigate,
    id,
  ]);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await save();
  };
  // Ctrl+S runs the same Save as the header button (off while it is disabled).
  useSaveShortcut(() => void save(), canSubmit && !update.isPending && !saveBlocked);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading Production Order…
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/production-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Production Order not found.'}
          </div>
        </div>
      </div>
    );
  }

  // Access matrix: edit access to Production Orders is required (also enforced
  // server-side).
  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to edit Production Orders. Ask an admin.
      </div>
    );
  }

  // A closed / short-closed order is frozen — no header edit (mirrors the
  // detail page's Edit gate; the server refuses it too).
  if (!EDITABLE_STATUSES.includes(detail.status)) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/production-orders/$id" params={{ id }} className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to Production Order
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            This Production Order can no longer be edited — it is {detail.status.replace('_', ' ')}.
          </div>
        </div>
      </div>
    );
  }

  const credited = detail.creditedQty ?? 0;
  const pTarget = pendingFor(pendingChanges, 'targetDate');
  const pSize = pendingFor(pendingChanges, 'actualSize');
  const pRmAvail = pendingFor(pendingChanges, 'rawMaterialAvailable');
  const pRemarks = pendingFor(pendingChanges, 'remarks');
  // Why Save is off, first reason first: an edit already waiting, then the
  // one required field.
  const saveBlockedTitle = hasPendingEdit
    ? PENDING_EDIT_MESSAGE
    : !canSubmit
      ? 'PRO Target Date is required.'
      : undefined;
  const pendingNote = `${pendingCount} change${
    pendingCount === 1 ? '' : 's'
  } waiting for approval · Save is off until it is decided`;

  return (
    <form className="page-fill po-detail po-edit" onSubmit={(e) => void onSubmit(e)}>
      {exit.dialog}
      <DetailHeader
        backLabel="Back"
        onBack={() => exit.leave(goBack)}
        code={detail.code}
        // One header line, as on the detail page: code · page name · status.
        badges={
          <>
            <span className="panel-title">Edit Production Order</span>
            <PoStatusBadge status={detail.status} />
          </>
        }
        actions={
          <>
            {hasPendingEdit ? (
              <span className="po-edit-pend" role="status" title={PENDING_EDIT_MESSAGE}>
                {pendingNote}
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => exit.leave(goBack)}
              disabled={update.isPending}
            >
              Cancel
            </button>
            {/* The wrapper carries the hover text: a disabled button gets none. */}
            <span title={saveBlockedTitle}>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!canSubmit || update.isPending || saveBlocked}
                title={saveBlockedTitle}
              >
                {update.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>Save Changes</>
                )}
              </button>
            </span>
          </>
        }
      >
        <PoIdentLine po={detail} />

        <ClusterGrid>
          <PoOrderCluster po={detail} />
          <PoQuantityClusters po={detail} />
          <PoScheduleCluster
            po={detail}
            target={
              <PoEditCell
                label="PRO Target Date"
                required
                htmlFor="po-target-date"
                ctlClassName="po-in-date"
                after={pTarget?.chip}
                title={pTarget?.title}
              >
                <input
                  id="po-target-date"
                  type="date"
                  className="innovic-input"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  required
                />
              </PoEditCell>
            }
          />
          <PoMaterialCluster po={detail} />
          <Cluster name={null}>
            {/* ADR-182 — what the store really had / really cut, beside the
                plan's master-picked RM Size. Optional free text. */}
            <PoEditCell
              label="Actual Size"
              htmlFor="po-actual-size"
              after={pSize?.chip}
              title={pSize?.title}
            >
              <input
                id="po-actual-size"
                className="innovic-input"
                value={actualSize}
                maxLength={120}
                onChange={(e) => setActualSize(e.target.value)}
              />
            </PoEditCell>
            {/* ADR-182 — the shop floor's confirmation that the material is on
                hand. No ★ on Edit: only Create requires it ticked. */}
            <PoEditCell
              label="Raw Material Available"
              ctlClassName="po-in-check"
              after={pRmAvail?.chip}
              title={pRmAvail?.title}
            >
              <label htmlFor="po-rm-available" title="The material for this order is in the store">
                <input
                  id="po-rm-available"
                  type="checkbox"
                  checked={rawMaterialAvailable}
                  onChange={(e) => setRawMaterialAvailable(e.target.checked)}
                />
                In store
              </label>
            </PoEditCell>
            <PoEditCell
              label="Remarks"
              htmlFor="po-remarks"
              span={2}
              after={pRemarks?.chip}
              title={pRemarks?.title}
            >
              <input
                id="po-remarks"
                className="innovic-input"
                value={remarks}
                maxLength={500}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional"
              />
            </PoEditCell>
          </Cluster>
        </ClusterGrid>
      </DetailHeader>

      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}

      {/* The same tab panel as the detail page, read-only here: the close
          history stays in view while you edit. No Reverse close on Edit — this
          page changes four header fields and nothing else. */}
      <div className="po-tabs">
        <TabStrip
          label="Production Order lists"
          activeKey={tab}
          onChange={(k) => setPickedTab(k === 'history' ? 'history' : 'ledger')}
          tabs={[
            { key: 'ledger', label: 'Close Ledger', count: detail.closes.length },
            { key: 'history', label: 'History', count: history.data?.rows.length ?? null },
          ]}
        />
        <span className="po-tabs-meta">
          <b>
            {credited} / {detail.orderQty}
          </b>{' '}
          credited
        </span>
      </div>
      <Panel fill bodyPadding="none">
        {tab === 'ledger' ? (
          detail.closes.length === 0 ? (
            <EmptyState>No closes yet.</EmptyState>
          ) : (
            <PoCloseLedger po={detail} canReverse={false} fill />
          )
        ) : (
          <DocumentHistory entity="ProductionOrder" entityId={detail.id} refId={detail.code} />
        )}
      </Panel>
    </form>
  );
}
