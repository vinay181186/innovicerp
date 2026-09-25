// Close Production Order (ADR-170): pick the Plan, the Production Order OR the
// Job Card — whichever the person happens to know — and the other two fill in.
//
// The three are ONE choice wearing three names: a closeable Production Order
// row already carries its plan and its job card (`planId` / `planCodeText` /
// `jobCardId` / `jcCodeText`), so all three pickers read that same list and any
// one of them can drive the other two. Clearing one clears all three, because a
// half-filled trio would let someone close an order they never identified.
// Close stays off until the server says the JC is complete (`canClose`); the
// reason it is blocked is shown in its place. On success the page goes to the
// PO detail, which shows the credited qty.

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

  // One selection, three names. The label beside each id is held separately so
  // the field still reads correctly once its row scrolls out of the search page
  // the dropdown last fetched.
  const [planId, setPlanId] = useState<string | null>(null);
  const [planLabel, setPlanLabel] = useState('');
  const [poId, setPoId] = useState<string | null>(null);
  const [poLabel, setPoLabel] = useState('');
  const [jcId, setJcId] = useState<string | null>(null);
  const [jcLabel, setJcLabel] = useState('');

  // PO picker — orders that still have something to close: open OR partially
  // closed (ADR-179). The list endpoint takes a single status, so we ask the
  // SERVER for each closeable status and merge — a client-side filter over one
  // unfiltered page would drop open/partial orders whenever the first 50 rows
  // were mostly closed ones.
  const [poSearch, setPoSearch] = useState('');
  const openPos = useProductionOrdersList({
    status: 'open',
    ...(poSearch.trim() ? { search: poSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const partialPos = useProductionOrdersList({
    status: 'partially_closed',
    ...(poSearch.trim() ? { search: poSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const poOptions = [...(openPos.data?.items ?? []), ...(partialPos.data?.items ?? [])];

  const detail = useProductionOrder(poId ?? undefined);
  const po = detail.data;

  /** How a Production Order reads once picked — used by all three pickers so
   *  the field says the same thing whichever one the person used. */
  const poRowLabel = (row: {
    code: string;
    clientPoLineNo: string | null;
    itemCodeText: string;
    itemRevision: string | null;
    planCodeText: string;
  }): string =>
    `${row.code} — ${row.clientPoLineNo ? `POL ${row.clientPoLineNo} · ` : ''}${itemCodeWithRev(row.itemCodeText, row.itemRevision)} · ${row.planCodeText}`;

  /** Nothing identified yet. Clearing any one of the three lands here, because
   *  the three are one choice and a half-filled trio identifies no order. */
  const clearAll = (): void => {
    setPlanId(null);
    setPlanLabel('');
    setPoId(null);
    setPoLabel('');
    setJcId(null);
    setJcLabel('');
  };

  /** The one place the trio is filled. Give it a closeable Production Order row
   *  and all three fields agree, whichever picker the row came from. */
  const applyPoRow = (row: (typeof poOptions)[number]): void => {
    setPoId(row.id);
    setPoLabel(poRowLabel(row));
    setPlanId(row.planId);
    setPlanLabel(row.planCodeText);
    setJcId(row.jobCardId);
    setJcLabel(row.jcCodeText);
  };

  const onPickPlan = (p: PlanPickerItem | null): void => {
    if (!p) {
      clearAll();
      return;
    }
    setPlanId(p.id);
    setPlanLabel(p.code);
    // Prefer the Production Order ROW — it carries the job card too. A plan
    // whose order is not on the currently loaded page still fills the PO from
    // the plan's own snapshot; the JC then arrives with the PO detail below.
    const row = poOptions.find((x) => x.id === p.productionOrderId);
    if (row) {
      applyPoRow(row);
      setPlanId(p.id);
      setPlanLabel(p.code);
      return;
    }
    setPoId(p.productionOrderId ?? null);
    setPoLabel(p.productionOrderCode ?? '');
    setJcId(null);
    setJcLabel(p.jcCode ?? '');
  };

  // The deep-linked plan lands once its row arrives, only while nothing has
  // been picked yet.
  useEffect(() => {
    if (preselected && !planId && !poId) onPickPlan(preselected);
    // onPickPlan is a plain setter bundle; the row is the trigger.
  }, [preselected]);

  const onPickPo = (next: string | null): void => {
    const row = poOptions.find((x) => x.id === next);
    if (!row) {
      clearAll();
      return;
    }
    applyPoRow(row);
  };

  const onPickJc = (next: string | null): void => {
    const row = poOptions.find((x) => x.jobCardId === next);
    if (!row) {
      clearAll();
      return;
    }
    applyPoRow(row);
  };

  // Whatever the PO detail says wins, once it arrives: it is the server's own
  // answer, where the pickers only had a list row. This also fills the plan and
  // the JC for a PO reached by deep link, whose row may not be on any page the
  // dropdowns have loaded.
  useEffect(() => {
    if (!po) return;
    setPlanId(po.planId);
    setPlanLabel((prev) => (prev === po.planCodeText ? prev : po.planCodeText));
    setJcId(po.jobCardId);
    setJcLabel(po.jcCodeText);
  }, [po?.id, po?.planId, po?.planCodeText, po?.jobCardId, po?.jcCodeText]);

  // The Job Card dropdown lists the cards that HAVE a closeable order — one
  // entry per card, so picking one can never dead-end on an order that cannot
  // be closed.
  const jcOptions = poOptions.filter(
    (row, i) => poOptions.findIndex((x) => x.jobCardId === row.jobCardId) === i,
  );

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
              value={planId}
              onChange={onPickPlan}
              fallbackLabel={planLabel || undefined}
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
                loading={openPos.isFetching || partialPos.isFetching}
                options={poOptions.map((p) => ({
                  id: p.id,
                  code: p.code,
                  // POL (the CUSTOMER's own PO line number) leads the label,
                  // ahead of the item code, and is searchable with it.
                  name: `${p.clientPoLineNo ? `POL ${p.clientPoLineNo} · ` : ''}${itemCodeWithRev(p.itemCodeText, p.itemRevision)} · ${p.planCodeText} · qty ${p.orderQty}`,
                  searchText: [p.jcCodeText, p.soCodeText, p.itemNameText, p.clientPoLineNo]
                    .filter(Boolean)
                    .join(' '),
                }))}
                placeholder="🔍 Type production order no, item or plan…"
                valueLabel={po ? poRowLabel(po) : poLabel || undefined}
                emptyText="No open Production Order matches"
              />
            </div>

            <div className="form-grp">
              <label className="form-label" htmlFor="close-jc">
                JC No.
              </label>
              {/* A picker like the other two, not a read-only box: the person on
                  the floor knows the job card number, and now that is enough to
                  identify the order. Same list, keyed on the job card. */}
              <SearchableSelect
                id="close-jc"
                value={jcId}
                onChange={onPickJc}
                onSearch={setPoSearch}
                loading={openPos.isFetching || partialPos.isFetching}
                options={jcOptions.map((row) => ({
                  id: row.jobCardId,
                  code: row.jcCodeText,
                  name: `${row.clientPoLineNo ? `POL ${row.clientPoLineNo} · ` : ''}${itemCodeWithRev(row.itemCodeText, row.itemRevision)} · ${row.code}`,
                  searchText: [row.code, row.planCodeText, row.soCodeText, row.itemNameText]
                    .filter(Boolean)
                    .join(' '),
                }))}
                placeholder="🔍 Type JC no, item or production order no…"
                valueLabel={po?.jcCodeText ?? (jcLabel || undefined)}
                emptyText="No Job Card with a closeable Production Order matches"
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
              {/* POL — the CUSTOMER's own PO line number, before the item
                  code. Absent when there is no sales order behind the PO. */}
              {po.clientPoLineNo ? (
                <span className="mono text3" style={{ fontSize: 11 }}>
                  · POL{' '}
                  <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                    {po.clientPoLineNo}
                  </span>
                </span>
              ) : null}
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
