// Close Production Order (ADR-170): select Plan → PO → JC → Close.
//
// The user's own words for the flow, so the three pickers sit in that order.
// Picking a plan fills the PO; the PO can also be picked directly from the open
// orders. The JC is read-only — it is whatever the PO built. Close stays off
// until the server says the JC is complete (`canClose`); the reason it is
// blocked is shown in its place. On success the page goes to the PO detail,
// which shows the credited qty.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { JcStatusBadge } from '@/modules/job-cards/components/jc-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  type PlanPickerItem,
  planPickerLabel,
  usePreselectedPlan,
  useProductionOrder,
  useProductionOrdersList,
} from '../api';
import { PlanPicker } from '../components/plan-picker';
import { PoCloseForm } from '../components/po-close-form';
import { PoCloseLedger } from '../components/po-close-ledger';
import { PoStatusBadge } from '../components/po-status-badge';

// ?planId=&planCode= open the page on that plan's order — the Plans list's
// "+ Close Production Order" button arrives this way. Both optional.
const closeSearchSchema = z.object({
  planId: z.string().uuid().optional(),
  planCode: z.string().optional(),
});

export const productionOrderCloseRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/close',
  validateSearch: (search) => closeSearchSchema.parse(search),
  component: ProductionOrderClosePage,
});

function ProductionOrderClosePage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = productionOrderCloseRoute.useSearch();
  const preselected = usePreselectedPlan(search.planId, search.planCode, 'close');

  // Tier-driven (Production). Close is an EDIT on the order.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  const [plan, setPlan] = useState<PlanPickerItem | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [poLabel, setPoLabel] = useState('');

  // PO picker — orders that still have something to close: open OR partially
  // closed (ADR-179). A fully closed one has nothing left, so it is filtered
  // out client-side (the list endpoint takes a single status).
  const [poSearch, setPoSearch] = useState('');
  const openPos = useProductionOrdersList({
    ...(poSearch.trim() ? { search: poSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const poOptions = (openPos.data?.items ?? []).filter((p) => p.status !== 'closed');

  const detail = useProductionOrder(poId ?? undefined);
  const po = detail.data;

  const onPickPlan = (p: PlanPickerItem | null): void => {
    setPlan(p);
    if (p?.productionOrderId) {
      setPoId(p.productionOrderId);
      setPoLabel(p.productionOrderCode ?? '');
    } else {
      setPoId(null);
      setPoLabel('');
    }
  };

  // The deep-linked plan lands once its row arrives, only while nothing has
  // been picked yet.
  useEffect(() => {
    if (preselected && !plan && !poId) onPickPlan(preselected);
    // onPickPlan is a plain setter bundle; the row is the trigger.
  }, [preselected]);

  const onPickPo = (next: string | null): void => {
    const row = poOptions.find((x) => x.id === next);
    setPoId(next);
    setPoLabel(
      row
        ? `${row.code} — ${itemCodeWithRev(row.itemCodeText, row.itemRevision)} · ${row.planCodeText}`
        : '',
    );
    // A PO picked directly implies its plan; drop a plan that no longer matches.
    if (row && plan && plan.id !== row.planId) setPlan(null);
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading Production Orders…
      </div>
    );
  }

  if (!perms.edit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/production-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to Production Orders
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have edit access to Production Orders. Ask an admin for L3 Editor or above
            in Production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/production-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Production Orders
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">🔒 Close Production Order</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Plan → PO → JC → Close. Blocked until the Job Card is complete; on close stock is
              credited once with the Job Card&apos;s actually finished qty.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid form-grid-3">
            <PlanPicker
              id="close-plan"
              mode="close"
              value={plan?.id ?? null}
              onChange={onPickPlan}
              fallbackLabel={plan ? planPickerLabel(plan) : undefined}
            />

            <div className="form-grp">
              <label className="form-label" htmlFor="close-po">
                Production Order No<span className="req">★</span>
              </label>
              <SearchableSelect
                id="close-po"
                value={poId}
                onChange={onPickPo}
                onSearch={setPoSearch}
                loading={openPos.isFetching}
                options={poOptions.map((p) => ({
                  id: p.id,
                  code: p.code,
                  name: `${itemCodeWithRev(p.itemCodeText, p.itemRevision)} · ${p.planCodeText} · qty ${p.orderQty}`,
                  searchText: [p.jcCodeText, p.soCodeText, p.itemNameText]
                    .filter(Boolean)
                    .join(' '),
                }))}
                placeholder="🔍 Type production order no, item or plan…"
                valueLabel={
                  po
                    ? `${po.code} — ${itemCodeWithRev(po.itemCodeText, po.itemRevision)} · ${po.planCodeText}`
                    : poLabel || undefined
                }
                emptyText="No open Production Order matches"
              />
            </div>

            <div className="form-grp">
              <label className="form-label" htmlFor="close-jc">
                JC No
              </label>
              <input
                id="close-jc"
                className="innovic-input mono fw-700"
                value={po?.jcCodeText ?? ''}
                readOnly
                placeholder={poId ? (detail.isLoading ? 'Loading…' : '') : 'Pick a PO first'}
              />
            </div>
          </div>

          {detail.isError ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid var(--red)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              {detail.error instanceof Error ? detail.error.message : 'Failed to load the PO.'}
            </div>
          ) : null}

          {po ? (
            <div
              style={{
                marginTop: 14,
                padding: '10px 12px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              <span className="td-code" style={{ color: 'var(--text)', fontWeight: 700 }}>
                {po.code}
              </span>
              <PoStatusBadge status={po.status} />
              <span className="text3" style={{ fontSize: 11 }}>
                JC
              </span>
              <Link
                to="/job-cards/$id"
                params={{ id: po.jobCardId }}
                className="mono fw-700"
                style={{ color: 'var(--cyan)', textDecoration: 'none' }}
              >
                {po.jcCodeText}
              </Link>
              {po.jcComputedStatus ? (
                <JcStatusBadge status={po.jcComputedStatus} />
              ) : (
                <span className="badge b-grey">no job card</span>
              )}
              <span className="text2" style={{ fontSize: 12 }}>
                finished{' '}
                <b className="mono" style={{ color: 'var(--text)' }}>
                  {po.jcFinishedQty}
                </b>{' '}
                of{' '}
                <b className="mono" style={{ color: 'var(--text)' }}>
                  {po.orderQty}
                </b>
              </span>
              <span className="mono text3" style={{ fontSize: 11 }}>
                · {itemCodeWithRev(po.itemCodeText, po.itemRevision)}
              </span>
            </div>
          ) : null}

          {po && !po.canClose && po.closeBlockedReason ? (
            <div
              className="text3"
              style={{
                fontSize: 12,
                marginTop: 10,
                padding: '6px 10px',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              🔒 Cannot close yet — {po.closeBlockedReason}
            </div>
          ) : null}

          {/* The partial-close form: qty (capped at available), close-short and
              remarks. On success go to the PO detail, which shows the running
              credited total and the ledger. */}
          {po && po.canClose ? (
            <div style={{ marginTop: 16 }}>
              <PoCloseForm
                po={po}
                onClosed={(closed) =>
                  void navigate({ to: '/production-orders/$id', params: { id: closed.id } })
                }
              />
            </div>
          ) : null}

          {/* Already-closed pieces on this order, so a partial close shows its
              history before adding more. */}
          {po && po.closes.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <div className="form-label" style={{ marginBottom: 6 }}>
                Close ledger
              </div>
              <PoCloseLedger po={po} canReverse={perms.edit} />
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Link to="/production-orders" className="btn btn-ghost">
              Back to Production Orders
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
