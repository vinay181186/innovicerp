// Close Production Order (ADR-170): select Plan → PO → JC → Close.
//
// The user's own words for the flow, so the three pickers sit in that order.
// Picking a plan fills the PO; the PO can also be picked directly from the open
// orders. The JC is read-only — it is whatever the PO built. Close stays off
// until the server says the JC is complete (`canClose`); the reason it is
// blocked is shown in its place. On success the page goes to the PO detail,
// which shows the credited qty.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { JcStatusBadge } from '@/modules/job-cards/components/jc-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  type PlanPickerItem,
  useCloseProductionOrder,
  useProductionOrder,
  useProductionOrdersList,
} from '../api';
import { PlanPicker } from '../components/plan-picker';
import { PoStatusBadge } from '../components/po-status-badge';

export const productionOrderCloseRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/close',
  component: ProductionOrderClosePage,
});

function ProductionOrderClosePage(): React.JSX.Element {
  const navigate = useNavigate();
  const closeMut = useCloseProductionOrder();
  const [closeError, setCloseError] = useState<string | null>(null);

  // Tier-driven (Production). Close is an EDIT on the order.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  const [plan, setPlan] = useState<PlanPickerItem | null>(null);
  const [poId, setPoId] = useState<string | null>(null);
  const [poLabel, setPoLabel] = useState('');

  // PO picker — open orders only; a closed one has nothing left to close.
  const [poSearch, setPoSearch] = useState('');
  const openPos = useProductionOrdersList({
    status: 'open',
    ...(poSearch.trim() ? { search: poSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const poOptions = openPos.data?.items ?? [];

  const detail = useProductionOrder(poId ?? undefined);
  const po = detail.data;

  const onPickPlan = (p: PlanPickerItem | null): void => {
    setPlan(p);
    setCloseError(null);
    if (p?.productionOrderId) {
      setPoId(p.productionOrderId);
      setPoLabel(p.productionOrderCode ?? '');
    } else {
      setPoId(null);
      setPoLabel('');
    }
  };

  const onPickPo = (next: string | null): void => {
    setCloseError(null);
    const row = poOptions.find((x) => x.id === next);
    setPoId(next);
    setPoLabel(row ? `${row.code} — ${row.itemCodeText} · ${row.planCodeText}` : '');
    // A PO picked directly implies its plan; drop a plan that no longer matches.
    if (row && plan && plan.id !== row.planId) setPlan(null);
  };

  const onClose = (): void => {
    if (!po || !po.canClose) return;
    setCloseError(null);
    closeMut.mutate(
      { id: po.id },
      {
        onSuccess: (closed) =>
          void navigate({ to: '/production-orders/$id', params: { id: closed.id } }),
        onError: (e) => setCloseError(e instanceof Error ? e.message : 'Close failed.'),
      },
    );
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
                  name: `${p.itemCodeText} · ${p.planCodeText} · qty ${p.orderQty}`,
                  searchText: [p.jcCodeText, p.soCodeText, p.itemNameText]
                    .filter(Boolean)
                    .join(' '),
                }))}
                placeholder="🔍 Type production order no, item or plan…"
                valueLabel={
                  po ? `${po.code} — ${po.itemCodeText} · ${po.planCodeText}` : poLabel || undefined
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
                · {po.itemCodeText}
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

          {closeError ? (
            <div
              role="alert"
              style={{
                marginTop: 10,
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid var(--red)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              {closeError}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <Link to="/production-orders" className="btn btn-ghost">
              Cancel
            </Link>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!po || !po.canClose || closeMut.isPending}
              onClick={onClose}
              title={
                !po
                  ? 'Pick a Production Order first'
                  : po.canClose
                    ? `Credit stock with ${po.jcFinishedQty} of ${po.orderQty}`
                    : (po.closeBlockedReason ?? 'Blocked')
              }
            >
              {closeMut.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Lock size={14} />
              )}{' '}
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
