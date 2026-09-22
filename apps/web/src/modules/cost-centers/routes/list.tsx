// Cost Center Master list — Phase A item 4.
// Ports legacy renderCostCenters (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L17165-17189) to Innovic chrome. Legacy columns, in order (L17186):
// Code | Name | Department | Type | Description | Status | Actions.
// Actions (L17176): ✏ edit + ✖ delete, both gated on write access.
//
// SHEET (2026-09-21): the list renders on the ruled sheet (`tbl-grid`) the SO
// Master List view uses — Sr No first, Action last, fixed % widths that add up
// to 100 so nothing scrolls sideways, a sticky toolbar band above it. The
// per-column sort (TanStack + SortableHead, itself a DELTA over legacy's plain
// <th>) is gone: the SO standard has none, and it only ever re-ordered the 25
// rows on screen.

import {
  COST_CENTER_DEPARTMENTS,
  COST_CENTER_TYPES,
  type ListCostCentersQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Eye, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCostCentersList, useSoftDeleteCostCenter } from '../api';

const PAGE_SIZE = 25;
// Sr No | Code | Name | Department | Type | Description | Status | Action.
const COLUMN_COUNT = 8;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  department: z.string().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const costCentersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'cost-centers',
  validateSearch: listSearchSchema,
  component: CostCentersListPage,
});

function CostCentersListPage(): React.JSX.Element {
  const search = costCentersListRoute.useSearch();
  const navigate = costCentersListRoute.useNavigate();
  // Tier-driven (cc_create sits in Finance). Add -> entry, Edit -> edit, Delete
  // -> edit AND approve (the pair only L5 Department Admin and above hold).
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'cc_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  MACHINE  SHOP " and "MACHINE SHOP" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListCostCentersQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      department: search.department,
      type: search.type,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.isActive, search.department, search.type, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useCostCentersList(query);
  const softDelete = useSoftDeleteCostCenter();

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed sees the no-access panel, not the page. `eff` is undefined
  // only while access is still loading — don't block then.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Sticky header band — the same shape as the SO Master list's: pinned
          to #content's top so the title, count, search, the three filters and
          + Add stay put while the sheet scrolls underneath. Opaque `--bg` so
          rows do not show through. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              🏢 Cost Center Master
            </div>
            {/* Count comes from the list response's `total` — the only
                aggregate GET /cost-centers returns. */}
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} cost center{total === 1 ? '' : 's'}
              {search.isActive !== undefined ? (
                <>
                  {' '}
                  · <span className="text2">{search.isActive ? 'active' : 'inactive'}</span> only
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="Search this list…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 220, fontSize: 12 }}
            />
            <select
              className="innovic-select"
              value={search.department ?? ''}
              onChange={(e) =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    department: e.target.value === '' ? undefined : e.target.value,
                    page: 1,
                  }),
                  replace: true,
                })
              }
              style={{ width: 130, fontSize: 12 }}
            >
              <option value="">All departments</option>
              {COST_CENTER_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              value={search.type ?? ''}
              onChange={(e) =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    type: e.target.value === '' ? undefined : e.target.value,
                    page: 1,
                  }),
                  replace: true,
                })
              }
              style={{ width: 140, fontSize: 12 }}
            >
              <option value="">All types</option>
              {COST_CENTER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              value={search.isActive === undefined ? '' : String(search.isActive)}
              onChange={(e) => {
                const v = e.target.value;
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    isActive: v === '' ? undefined : v === 'true',
                    page: 1,
                  }),
                  replace: true,
                });
              }}
              style={{ width: 110, fontSize: 12 }}
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {canAdd ? (
              <Link to="/cost-centers/new" className="btn btn-primary">
                <Plus size={14} /> Add Cost Center
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* The ruled sheet (tbl-grid): every column centred by the standard,
          Name left-aligned (a name reads from its left edge). Widths live only
          in the colgroup and sum to 100. */}
      <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
        <table className="innovic-table tbl-grid">
          <colgroup>
            <col style={{ width: '5%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th>Code</th>
              <th style={{ textAlign: 'left' }}>Name</th>
              <th>Department</th>
              <th>Type</th>
              <th>Description</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state" style={{ color: 'var(--red)' }}>
                  {error instanceof Error ? error.message : 'Failed to load cost centers'}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  No cost centers. Click + Add Cost Center.
                </td>
              </tr>
            ) : (
              rows.map((cc, i) => (
                <tr
                  key={cc.id}
                  onClick={() => void navigate({ to: '/cost-centers/$id', params: { id: cc.id } })}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="text3">{(currentPage - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link
                      to="/cost-centers/$id"
                      params={{ id: cc.id }}
                      className="td-code"
                      title="Open this cost center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {cc.code}
                    </Link>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div
                      className="fw-700"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={cc.name}
                    >
                      {cc.name}
                    </div>
                  </td>
                  <td>{cc.department ?? '—'}</td>
                  <td>{cc.type ?? '—'}</td>
                  {/* Long free text: one line, clipped with an ellipsis, the
                      full text on hover — never wrapped into a tall row. */}
                  <td className="text3" style={{ fontSize: 11 }}>
                    <div
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={cc.description ?? ''}
                    >
                      {cc.description ?? '—'}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${cc.isActive ? 'b-green' : 'b-grey'}`}>
                      {cc.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {/* Icon buttons only, one row, hover names the action.
                        View is open to everyone who can see the page; Edit
                        needs the edit right; Delete the edit+approve pair.
                        The row itself navigates, so the block stops the
                        click. */}
                    <div
                      style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        to="/cost-centers/$id"
                        params={{ id: cc.id }}
                        className="btn btn-ghost btn-sm btn-icon"
                        title="View"
                        aria-label="View"
                      >
                        <Eye size={14} />
                      </Link>
                      {canEdit ? (
                        <Link
                          to="/cost-centers/$id/edit"
                          params={{ id: cc.id }}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </Link>
                      ) : null}
                      {canDelete ? (
                        // The sheet paints every .btn-sm on paper (theme rule),
                        // which would leave btn-danger's white icon invisible —
                        // so the icon is told to be red here, tokens only.
                        <button
                          type="button"
                          className="btn btn-danger btn-sm btn-icon"
                          style={{ color: 'var(--red)' }}
                          title="Delete"
                          aria-label="Delete"
                          disabled={softDelete.isPending}
                          onClick={() => {
                            if (confirm('Delete this cost center?')) {
                              softDelete.mutate(cc.id);
                            }
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No cost centers'
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                replace: true,
              })
            }
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
