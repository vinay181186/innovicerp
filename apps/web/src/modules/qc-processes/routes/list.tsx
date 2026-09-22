// QC Process Master list — Phase A item 3. Mirrors legacy renderQCProcessMaster (L23446).
//
// Laid out as the app's ruled sheet (`.innovic-table.tbl-grid`, the SO / WO
// List view look — see sales-orders/components/so-sheet-table.tsx): Sr No
// first, Action last, fixed `%` widths that add up to 100 so nothing scrolls
// sideways, every column centred by the class except the name, which reads
// from its left edge. Per-column sorting was dropped with the TanStack table
// (the SO standard has none; it only ever re-ordered the page on screen).

import type { ListQcProcessesQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Eye, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcProcessesList, useSoftDeleteQcProcess } from '../api';
import { ReportTypesPanel } from '@/modules/report-types/components/report-types-panel';

const PAGE_SIZE = 25;
/** Column count — the loading / error / empty rows' <td colSpan> must always
 *  match the <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 6;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  // Second tab: the Report / Document Master, folded in from the former
  // standalone /report-master screen.
  tab: z.enum(['reports']).optional(),
});

export const qcProcessesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes',
  validateSearch: listSearchSchema,
  component: QcProcessesListPage,
});

function QcProcessesListPage(): React.JSX.Element {
  const search = qcProcessesListRoute.useSearch();
  const navigate = qcProcessesListRoute.useNavigate();
  // Tier-driven, per department (QC). The old gate was admin/manager only —
  // narrower than every sibling QC screen, so a QC lead could not maintain the
  // master they run. Add is `entry`, Edit is `edit`, Del is the L5-and-above
  // pair below.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'qcprocess_create');
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve. L3
  // Editor has edit without approve; L4 Approver has approve without edit. The
  // owner decided L5 gets delete rights — admin-only was locking out the very
  // tier meant to run the department.
  const canDelete = perms.edit && perms.approve;

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  Final  Inspection " and "Final Inspection" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListQcProcessesQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.isActive, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useQcProcessesList(query);
  const softDelete = useSoftDeleteQcProcess();

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load. Sits after every hook so the early
  // return never trips rules-of-hooks.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;
  const tab = search.tab ?? 'processes';

  return (
    <div>
      {/* QC Processes | Report Types tabs (Report Types is the former standalone
          Report / Document Master screen). */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {(['processes', 'reports'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, tab: t === 'processes' ? undefined : 'reports' }),
                replace: true,
              })
            }
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--green)' : '2px solid transparent',
              color: tab === t ? 'var(--green)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'processes' ? '⚙ QC Processes' : '📄 Report Types'}
          </button>
        ))}
      </div>

      {tab === 'reports' ? (
        <ReportTypesPanel />
      ) : (
        <>
          {/* Sticky header band — the SO list's shape: `#content` is the app's
              scroll container, so `top:0` pins this band flush under the
              topbar while the rows scroll underneath. Opaque `--bg` so the
              sheet never shows through. */}
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
                  ⚙ QC Process Master
                </div>
                {/* Count is the list response's `total` — the only aggregate the
                    endpoint returns. */}
                <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
                  {total} process{total === 1 ? '' : 'es'}
                  {search.isActive !== undefined ? (
                    <>
                      {' '}
                      · <span className="text2">
                        {search.isActive ? 'Active' : 'Inactive'}
                      </span>{' '}
                      only
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
                  style={{ width: 130, fontSize: 12 }}
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
                {perms.entry ? (
                  <Link to="/qc-processes/new" className="btn btn-primary">
                    <Plus size={14} /> Add QC Process
                  </Link>
                ) : null}
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="panel-body" style={{ padding: '10px 14px' }}>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                💡 Define QC inspection processes here (e.g. Dimensional Check, Hardness Test, CMM
                Inspection). These can be added as <b>QC operations</b> in Route Cards and Job
                Cards, just like machining operations.
              </span>
            </div>
          </div>

          {/* Why a banner and not a toast: the delete is refused for a reason the
          user has to act on (retire it as Inactive instead), and that sentence
          names the documents holding it. It stays on screen until the next
          attempt. */}
          {softDelete.error ? (
            <div className="panel" style={{ marginBottom: 12 }}>
              <div
                className="panel-body"
                style={{
                  padding: '10px 14px',
                  background: 'var(--red3)',
                  color: 'var(--red)',
                  fontSize: 12,
                }}
                role="alert"
              >
                ⚠ {softDelete.error.message}
              </div>
            </div>
          ) : null}

          {/* The sheet: fixed widths summing to 100%, so no sideways scroll. */}
          <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
            <table className="innovic-table tbl-grid">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: '40%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Sr No</th>
                  <th style={{ textAlign: 'left' }}>QC Process Name</th>
                  <th>Description</th>
                  <th>Std Time (min)</th>
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
                    <td
                      colSpan={COLUMN_COUNT}
                      className="empty-state"
                      style={{ color: 'var(--red)' }}
                    >
                      {error instanceof Error ? error.message : 'Failed to load QC processes'}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMN_COUNT} className="empty-state">
                      No QC processes defined. Click + Add QC Process.
                    </td>
                  </tr>
                ) : (
                  rows.map((p, i) => (
                    <tr
                      key={p.id}
                      onClick={() =>
                        void navigate({ to: '/qc-processes/$id', params: { id: p.id } })
                      }
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="text3">{(currentPage - 1) * PAGE_SIZE + i + 1}</td>
                      <td
                        style={{
                          textAlign: 'left',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={p.code}
                      >
                        {/* The master code — strong, never the faint --text3. */}
                        <Link
                          to="/qc-processes/$id"
                          params={{ id: p.id }}
                          className="mono fw-700"
                          style={{ color: 'var(--text)', textDecoration: 'none' }}
                          title="Open this QC process"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.code}
                        </Link>
                      </td>
                      <td
                        className="text2"
                        style={{
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={p.description ?? ''}
                      >
                        {p.description ?? '—'}
                      </td>
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        {Number(p.defaultCycleTimeMin) > 0
                          ? Number(p.defaultCycleTimeMin).toFixed(2)
                          : '—'}
                      </td>
                      <td>
                        <span className={`badge ${p.isActive ? 'b-green' : 'b-amber'}`}>
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        {/* View is open to anyone who can see the list; Edit needs edit; Del needs edit +
                            approve. Icon buttons on one row, the action named on
                            hover; the row navigates, so the wrapper stops the click. */}
                        <div
                          style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            to="/qc-processes/$id"
                            params={{ id: p.id }}
                            className="btn btn-ghost btn-sm btn-icon"
                            title="View"
                            aria-label="View"
                          >
                            <Eye size={14} />
                          </Link>
                          {perms.edit ? (
                            <Link
                              to="/qc-processes/$id/edit"
                              params={{ id: p.id }}
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
                                if (confirm(`Delete QC process "${p.code}"?`)) {
                                  // The server refuses a process that job cards, plans or
                                  // route cards still name (qc-processes/service.ts). Reset
                                  // first so a second attempt clears the previous banner.
                                  softDelete.reset();
                                  softDelete.mutate(p.id);
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
                ? 'No QC processes'
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
        </>
      )}
    </div>
  );
}
