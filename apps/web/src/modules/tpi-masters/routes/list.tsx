// TPI Master list — the third-party inspectors the TPI screen's Inspector field
// now picks from. Mirrors the QC Process Master list (its sibling in the Quality
// → Master menu), with one deliberate difference: this is a master, so it
// scrolls in ONE fetch instead of paging (styling skill, rule 4). 200 is the
// cap listTpiMastersQuerySchema allows, and an inspector list is tens of rows.
//
// `code` holds the inspector's NAME, so the column reads "Inspector Name" — see
// packages/shared/src/schemas/tpi-master.ts.
//
// Laid out as the app's ruled sheet (`.innovic-table.tbl-grid`, the SO / WO
// List view look — see sales-orders/components/so-sheet-table.tsx): Sr No
// first, Action last, fixed `%` widths that add up to 100 so nothing scrolls
// sideways, every column centred by the class except the name, which reads
// from its left edge. Per-column sorting was dropped with the TanStack table
// (the SO standard has none; it only ever re-ordered the page on screen).

import type { ListTpiMastersQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Eye, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoftDeleteTpiMaster, useTpiMastersList } from '../api';

const LIST_LIMIT = 200;
/** Column count — the loading / error / empty rows' <td colSpan> must always
 *  match the <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 7;

const listSearchSchema = z.object({
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

export const tpiMastersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi-masters',
  validateSearch: listSearchSchema,
  component: TpiMastersListPage,
});

function TpiMastersListPage(): React.JSX.Element {
  const search = tpiMastersListRoute.useSearch();
  const navigate = tpiMastersListRoute.useNavigate();
  // Tier-driven, per department (QC) — same gate shape as QC Process Master.
  // Add is `entry`, Edit is `edit`, Del is the L5-and-above pair below.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'tpimaster_create');
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve.
  const canDelete = perms.edit && perms.approve;

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  Bureau  Veritas " and "Bureau Veritas" are one query, one cache entry,
    // one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListTpiMastersQuery = useMemo(
    () => ({
      search: search.search,
      isActive: search.isActive,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.isActive],
  );

  const { data, isLoading, isFetching, isError, error } = useTpiMastersList(query);
  const softDelete = useSoftDeleteTpiMaster();

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

  return (
    <div>
      {/* Sticky header band — the SO list's shape: `#content` is the app's
          scroll container, so `top:0` pins this band flush under the topbar
          while the rows scroll underneath. Opaque `--bg` so the sheet never
          shows through. */}
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
              🔍 TPI Master
            </div>
            {/* Count is the list response's `total` — the only aggregate the
                endpoint returns. */}
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} inspector{total === 1 ? '' : 's'}
              {search.isActive !== undefined ? (
                <>
                  {' '}
                  · <span className="text2">{search.isActive ? 'Active' : 'Inactive'}</span> only
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
                  search: (prev) => ({ ...prev, isActive: v === '' ? undefined : v === 'true' }),
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
              <Link to="/tpi-masters/new" className="btn btn-primary">
                <Plus size={14} /> Add Inspector
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            💡 Add third-party inspectors here. The <b>Inspector Name</b> field on the TPI screen
            picks from this list, and picking a name fills in their organization.
          </span>
        </div>
      </div>

      {/* Why a banner and not a toast: the delete may be refused for a reason
          the user has to act on (retire the inspector as Inactive instead). It
          stays on screen until the next attempt. */}
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
            <col style={{ width: '22%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th style={{ textAlign: 'left' }}>Inspector Name</th>
              <th>Organization</th>
              <th>Contact No.</th>
              <th>Email</th>
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
                  {error instanceof Error ? error.message : 'Failed to load TPI inspectors'}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  No inspectors defined. Click + Add Inspector.
                </td>
              </tr>
            ) : (
              rows.map((t, i) => (
                <tr
                  key={t.id}
                  onClick={() => void navigate({ to: '/tpi-masters/$id', params: { id: t.id } })}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="text3">{i + 1}</td>
                  <td
                    style={{
                      textAlign: 'left',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={t.code}
                  >
                    {/* The master code (the inspector's name) — strong, never
                        the faint --text3. */}
                    <Link
                      to="/tpi-masters/$id"
                      params={{ id: t.id }}
                      className="mono fw-700"
                      style={{ color: 'var(--text)', textDecoration: 'none' }}
                      title="Open this inspector"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.code}
                    </Link>
                  </td>
                  {/* Free text that runs long — clip with an ellipsis and keep
                      the whole value on hover. */}
                  <td
                    className="text2"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={t.organization ?? ''}
                  >
                    {t.organization ?? '—'}
                  </td>
                  <td className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {t.contactNo ?? '—'}
                  </td>
                  <td
                    className="text2"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={t.email ?? ''}
                  >
                    {t.email ?? '—'}
                  </td>
                  <td>
                    <span className={`badge ${t.isActive ? 'b-green' : 'b-amber'}`}>
                      {t.isActive ? 'Active' : 'Inactive'}
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
                        to="/tpi-masters/$id"
                        params={{ id: t.id }}
                        className="btn btn-ghost btn-sm btn-icon"
                        title="View"
                        aria-label="View"
                      >
                        <Eye size={14} />
                      </Link>
                      {perms.edit ? (
                        <Link
                          to="/tpi-masters/$id/edit"
                          params={{ id: t.id }}
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
                            if (confirm(`Delete inspector "${t.code}"?`)) {
                              // Reset first so a second attempt clears the previous banner.
                              softDelete.reset();
                              softDelete.mutate(t.id);
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

      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)' }}>
        {total === 0
          ? 'No inspectors'
          : total > LIST_LIMIT
            ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
            : `Showing all ${total} inspector${total === 1 ? '' : 's'}`}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>
        💡 Click a row to open it.
      </div>
    </div>
  );
}
