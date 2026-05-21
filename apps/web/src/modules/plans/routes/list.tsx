// Plans list (PL-4). All plans with status + type + search filters + pagination.

import type { ListPlansResponse, PlanStatus, PlanType } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePlansList } from '../api';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z
    .enum(['in_planning', 'planned', 'jc_created', 'pr_created', 'in_production', 'complete', 'cancelled'])
    .optional(),
  planType: z.enum(['manufacture', 'direct_purchase', 'full_outsource', 'assembly']).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const plansListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans',
  validateSearch: searchSchema,
  component: PlansListPage,
});

const STATUS_BADGE: Record<PlanStatus, { cls: string; label: string }> = {
  in_planning: { cls: 'b-grey', label: 'In Planning' },
  planned: { cls: 'b-blue', label: 'Planned' },
  jc_created: { cls: 'b-cyan', label: 'JC Created' },
  pr_created: { cls: 'b-cyan', label: 'PR Created' },
  in_production: { cls: 'b-amber', label: 'In Production' },
  complete: { cls: 'b-green', label: 'Complete' },
  cancelled: { cls: 'b-grey', label: 'Cancelled' },
};

const TYPE_ICON: Record<PlanType, string> = {
  manufacture: '🏭',
  direct_purchase: '🛒',
  full_outsource: '📦',
  assembly: '🔧',
};

const LIMIT = 50;

function PlansListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status, planType, offset } = plansListRoute.useSearch();
  const off = offset ?? 0;
  const { data, isLoading, isError, error } = usePlansList({
    search,
    status,
    planType,
    limit: LIMIT,
    offset: off,
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📋 Plans</div>
        <div className="flex items-center gap-2">
          <input
            className="innovic-input"
            style={{ width: 200 }}
            placeholder="Search code / item / SO…"
            value={search ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/plans',
                search: {
                  ...(status ? { status } : {}),
                  ...(planType ? { planType } : {}),
                  search: e.target.value || undefined,
                },
              })
            }
          />
          <select
            className="innovic-select"
            style={{ width: 140 }}
            value={status ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/plans',
                search: {
                  ...(search ? { search } : {}),
                  ...(planType ? { planType } : {}),
                  status: (e.target.value as PlanStatus | '') || undefined,
                },
              })
            }
          >
            <option value="">All statuses</option>
            {(Object.keys(STATUS_BADGE) as PlanStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_BADGE[s].label}
              </option>
            ))}
          </select>
          <select
            className="innovic-select"
            style={{ width: 140 }}
            value={planType ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/plans',
                search: {
                  ...(search ? { search } : {}),
                  ...(status ? { status } : {}),
                  planType: (e.target.value as PlanType | '') || undefined,
                },
              })
            }
          >
            <option value="">All types</option>
            <option value="manufacture">🏭 Manufacture</option>
            <option value="direct_purchase">🛒 Direct Purchase</option>
            <option value="full_outsource">📦 Full Outsource</option>
            <option value="assembly">🔧 Assembly</option>
          </select>
          <Link to="/plans/new" className="btn btn-primary btn-sm">
            <Plus size={13} /> New plan
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load plans'}
            </div>
          </div>
        </div>
      ) : data ? (
        <Table data={data} offset={off} />
      ) : null}
    </div>
  );
}

function Table({ data, offset }: { data: ListPlansResponse; offset: number }): React.JSX.Element {
  const navigate = useNavigate();
  if (data.items.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            No plans match the filter.
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Plan #</th>
                <th>Date</th>
                <th>Type</th>
                <th>Item</th>
                <th>SO</th>
                <th className="td-right">Order Qty</th>
                <th className="td-right">Plan Qty</th>
                <th className="td-ctr">Ops</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const status = STATUS_BADGE[row.planStatus];
                return (
                  <tr key={row.id}>
                    <td>
                      <Link
                        to="/plans/$id"
                        params={{ id: row.id }}
                        className="td-code"
                        style={{ color: 'var(--cyan)', fontWeight: 600 }}
                      >
                        {row.code}
                      </Link>
                    </td>
                    <td>
                      <span className="text3" style={{ fontSize: 12 }}>
                        {row.planDate}
                      </span>
                    </td>
                    <td>{TYPE_ICON[row.planType]}</td>
                    <td>
                      <div>{row.itemCode ?? row.itemCodeText ?? '—'}</div>
                      {row.itemName ?? row.itemNameText ? (
                        <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                          {row.itemName ?? row.itemNameText}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="text3" style={{ fontSize: 12 }}>
                        {row.soCodeText ?? '—'}
                        {row.lineNo ? ` · L#${row.lineNo}` : ''}
                      </span>
                    </td>
                    <td className="td-right">{row.orderQty}</td>
                    <td className="td-right">{row.planQty}</td>
                    <td className="td-ctr">{row.opsCount}</td>
                    <td>
                      <span className={`badge ${status.cls}`}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 10,
          fontSize: 12,
        }}
      >
        <span className="text3">
          {offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={offset === 0}
            onClick={() =>
              void navigate({
                to: '/plans',
                search: (prev) => ({ ...prev, offset: Math.max(0, offset - LIMIT) }),
              })
            }
          >
            Prev
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={offset + data.items.length >= data.total}
            onClick={() =>
              void navigate({
                to: '/plans',
                search: (prev) => ({ ...prev, offset: offset + LIMIT }),
              })
            }
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
