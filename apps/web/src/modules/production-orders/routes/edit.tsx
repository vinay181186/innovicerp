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
// flow, the opened-version conflict guard and the exit guard, and new.tsx for
// the form shell.

import type { ProductionOrderStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { isStagedResult } from '@/modules/document-edits/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { type UpdateProductionOrderInput, useProductionOrder, useUpdateProductionOrder } from '../api';

export const productionOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/$id/edit',
  component: ProductionOrderEditPage,
});

/** The only statuses whose header may still be edited — a closed or short-closed
 *  order is frozen (mirrors the detail page's Edit gate). */
const EDITABLE_STATUSES: readonly ProductionOrderStatus[] = ['open', 'partially_closed'];

function ProductionOrderEditPage(): React.JSX.Element {
  const { id } = productionOrderEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useProductionOrder(id);
  const saveKey = useSaveKey();
  const update = useUpdateProductionOrder(id, saveKey);

  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

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
    if (!detail || !canSubmit || update.isPending) return;
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
        setStagedNotice(
          'Sent for approval — your changes will apply once an approver signs off.',
        );
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
  useSaveShortcut(() => void save(), canSubmit && !update.isPending);

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

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      {exit.dialog}
      <PageHeader
        sticky
        title={`Edit Production Order — ${detail.code}`}
        backLabel="Back"
        onBack={() => exit.leave(goBack)}
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => exit.leave(goBack)}
              disabled={update.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canSubmit || update.isPending}
              title={!canSubmit ? 'PRO Target Date is required.' : undefined}
            >
              {update.isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Saving…
                </>
              ) : (
                <>Save Changes</>
              )}
            </button>
          </>
        }
      />

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

      <Panel title="Production Order Details">
        <div className="form-grid-12">
          <div className="form-grp f-sm">
            <label className="form-label" htmlFor="po-target-date">
              PRO Target Date<span className="req">★</span>
            </label>
            <input
              id="po-target-date"
              type="date"
              className="innovic-input"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              required
            />
          </div>

          {/* ADR-182 — what the store really had / really cut, beside the
              plan's master-picked Raw Material Size. Optional free text. */}
          <div className="form-grp f-sm">
            <label className="form-label" htmlFor="po-actual-size">
              Actual Size
            </label>
            <input
              id="po-actual-size"
              className="innovic-input"
              value={actualSize}
              maxLength={120}
              onChange={(e) => setActualSize(e.target.value)}
            />
          </div>

          {/* ADR-182 — the shop floor's confirmation that the material is on
              hand. */}
          <div className="form-grp f-full">
            <span className="form-label">Raw Material Available</span>
            <label
              htmlFor="po-rm-available"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              <input
                id="po-rm-available"
                type="checkbox"
                checked={rawMaterialAvailable}
                onChange={(e) => setRawMaterialAvailable(e.target.checked)}
              />
              The material for this order is in the store
            </label>
          </div>

          <div className="form-grp f-full">
            <label className="form-label" htmlFor="po-remarks">
              Remarks
            </label>
            <input
              id="po-remarks"
              className="innovic-input"
              value={remarks}
              maxLength={500}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
      </Panel>
    </form>
  );
}
