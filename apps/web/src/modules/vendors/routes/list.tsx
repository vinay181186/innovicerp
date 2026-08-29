// Vendor Master list (UI-003-02; legacy parity pass 2026-07-15).
// Ports legacy renderVendors (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L27734) to Innovic chrome. Legacy columns, in order: Code | Name | Contact |
// Phone | Email | GST No. | Address | Rating | Status | PO/GRN | Actions.
//
// Two legacy columns/behaviours are DELTA (blocked on backend, not faked here):
//   * PO/GRN — legacy counts db.purchaseOrders/db.grn client-side because it
//     holds the whole DB in memory. Our Vendor payload carries no counts, and
//     deriving them here would mean fetching every PO+GRN to count in the
//     browser (Rule 1 / N+1). Needs an aggregate on the vendors list endpoint.
//   * Rating — legacy shows an auto-computed grade+score (_calcVendorRating,
//     L27784) and opens a scorecard modal (_showVendorScore, L27814). Our
//     `rating` is a manually-entered letter, so we render the badge only. The
//     legacy badge's cursor:pointer + title="Click for details" are deliberately
//     NOT copied — there is no scorecard to open.
//
// Styled to the shared list standard (see .claude/skills/styling + the SO Master
// reference apps/web/src/modules/sales-orders/routes/list.tsx), matching the
// Client Master: one frozen header band, counts in a <StatStrip> that doubles as
// the status filter (Rule 3), whole-row navigation with actions stopping
// propagation (Rule 2), and one scrolling fetch instead of Prev/Next (Rule 4 —
// status filter + counts are done client-side over the single fetch, which is
// why the server query drops isActive).

import type { ListVendorsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { SortTh, nextSort } from '@/components/shared/sortable-th';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateVendor, useSoftDeleteVendor, useVendorsList } from '../api';
import { downloadVendorTemplate, parseVendorImportFile } from '../lib/import-export';

// No pagination — Vendors is a master list, so it mirrors the SO/WO list: one
// fetch, everything in a single scrolling list (styling skill, Rule 4). The
// vendors list endpoint caps `limit` at 1000 (packages/shared vendor schema,
// raised from 200 to match the SO master); the count line flags a larger set.
const LIST_LIMIT = 1000;
// Legacy renders 11 columns; PO/GRN is DELTA (see header note), so 10 here.
const COL_COUNT = 10;

// Join a list of import warnings/failures for the status line, capping at 50 so
// a huge sheet can't produce an unbounded banner, but still showing far more
// than the old 3-item cap that hid most problems.
function fmtList(items: string[]): string {
  const shown = items.slice(0, 50).join('; ');
  return items.length > 50 ? `${shown} … (+${items.length - 50} more)` : shown;
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sortBy: z.enum(['code', 'name']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const vendorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors',
  validateSearch: listSearchSchema,
  component: VendorsListPage,
});

function ratingBadgeClass(rating: string | null): string {
  if (!rating) return 'b-grey';
  const g = rating.trim().toUpperCase()[0];
  if (g === 'A') return 'b-green';
  if (g === 'B') return 'b-blue';
  if (g === 'C') return 'b-amber';
  if (g === 'D') return 'b-red';
  return 'b-grey';
}

function VendorsListPage(): React.JSX.Element {
  const search = vendorsListRoute.useSearch();
  const navigate = vendorsListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // One fetch of every vendor matching the search (no isActive server filter):
  // the Active/Inactive split is derived + filtered client-side so the StatStrip
  // can show real counts for all three tiles.
  const query: ListVendorsQuery = useMemo(
    () => ({
      search: search.search,
      sortBy: search.sortBy,
      sortDir: search.sortDir,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search, search.sortBy, search.sortDir],
  );

  const { data, isLoading, isFetching, isError, error } = useVendorsList(query);
  // Tier-driven, per department (vendor_create sits in Purchase). Replaces the
  // old admin/manager flag, which collapsed all seven tiers into two.
  //   Add / Excel import -> entry  (L2 Data Entry and up)
  //   Edit               -> edit   (L3 Editor and up; L2 creates but cannot alter)
  //   Del                -> edit AND approve. Delete is not one of the four tier
  //     actions, so it is expressed as the pair only L5 Department Admin and
  //     above hold: L3 has edit without approve, L4 has approve without edit.
  //     Previously admin-only, which locked out the tier meant to run the dept.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'vendor_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const toggleSort = useCallback(
    (field: 'code' | 'name') => {
      const next = nextSort(field, { sortBy: search.sortBy, sortDir: search.sortDir });
      void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });
    },
    [navigate, search.sortBy, search.sortDir],
  );

  const setStatus = useCallback(
    (status: 'active' | 'inactive' | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, status }), replace: true });
    },
    [navigate],
  );

  const softDelete = useSoftDeleteVendor();

  // Excel import — parse the workbook, then create each vendor sequentially
  // (each success invalidates the list via the mutation hook).
  const createVendor = useCreateVendor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      const { payloads, errors } = await parseVendorImportFile(file);
      // Re-import guard: the template has no Code column, so the same file would
      // otherwise create duplicate vendors on every import. Skip any name that
      // already exists (case-insensitive) in the loaded list.
      const existingNames = new Set((data?.vendors ?? []).map((v) => v.name.trim().toLowerCase()));
      const warnings = [...errors];
      let ok = 0;
      let skipped = 0;
      const fails: string[] = [];
      for (const p of payloads) {
        const key = p.name.trim().toLowerCase();
        if (existingNames.has(key)) {
          skipped += 1;
          warnings.push(`"${p.name}" already exists — skipped`);
          continue;
        }
        existingNames.add(key);
        try {
          await createVendor.mutateAsync(p);
          ok += 1;
        } catch (e) {
          fails.push(`${p.name}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      setImportMsg(
        `Imported ${ok}/${payloads.length} vendor(s).` +
          (skipped ? ` ${skipped} duplicate(s) skipped.` : '') +
          (warnings.length ? ` ${warnings.length} row warning(s): ${fmtList(warnings)}` : '') +
          (fails.length ? ` Failures: ${fmtList(fails)}` : ''),
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // All rows matching the search; the Active/Inactive filter is client-side.
  const allRows = useMemo(() => data?.vendors ?? [], [data?.vendors]);
  const activeCount = useMemo(() => allRows.filter((v) => v.isActive).length, [allRows]);
  const inactiveCount = allRows.length - activeCount;
  const rows = useMemo(() => {
    if (search.status === 'active') return allRows.filter((v) => v.isActive);
    if (search.status === 'inactive') return allRows.filter((v) => !v.isActive);
    return allRows;
  }, [allRows, search.status]);

  const total = data?.total ?? 0;

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Frozen header band — title, toolbar and the StatStrip stay put while the
          rows scroll underneath (mirrors the SO Master list). Opaque `--bg`
          background so rows don't show through as they pass under it. */}
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
            alignItems: 'center',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            🏭 Vendor Master
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="🔍 Search vendor…"
              title="Search by vendor code or name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ minWidth: 220, fontSize: 13 }}
            />
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {canAdd ? (
              <Link to="/vendors/new" className="btn btn-primary">
                + Add Vendor
              </Link>
            ) : null}
          </div>
        </div>

        {/* Counts double as the status filter (Rule 3). Active state = coloured
            label + underline, handled inside <StatStrip>. */}
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'All Vendors',
              count: total,
              color: 'var(--cyan)',
              active: search.status === undefined,
              onClick: () => setStatus(undefined),
            },
            {
              key: 'active',
              label: 'Active',
              count: activeCount,
              color: 'var(--green)',
              active: search.status === 'active',
              onClick: () => setStatus('active'),
            },
            {
              key: 'inactive',
              label: 'Inactive',
              count: inactiveCount,
              color: 'var(--text3)',
              active: search.status === 'inactive',
              onClick: () => setStatus('inactive'),
            },
          ]}
        />
      </div>

      {importMsg ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body" style={{ padding: '10px 14px', fontSize: 12 }}>
            {importMsg}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8, fontSize: 10 }}
              onClick={() => setImportMsg(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>
                  <SortTh
                    label="Code"
                    field="code"
                    sortBy={search.sortBy}
                    sortDir={search.sortDir}
                    onSort={toggleSort}
                  />
                </th>
                <th>
                  <SortTh
                    label="Name"
                    field="name"
                    sortBy={search.sortBy}
                    sortDir={search.sortDir}
                    onSort={toggleSort}
                  />
                </th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Email</th>
                <th>GST No.</th>
                <th>Address</th>
                <th>Rating</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={COL_COUNT} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={COL_COUNT} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load vendors'}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={COL_COUNT} className="empty-state">
                    {search.status
                      ? `No ${search.status} vendors`
                      : 'No vendors. Add vendors to create Purchase Orders.'}
                  </td>
                </tr>
              ) : (
                // Whole row navigates to the vendor's detail page (Rule 2).
                rows.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => void navigate({ to: '/vendors/$id', params: { id: v.id } })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="td-code cyan">
                      <Link
                        to="/vendors/$id"
                        params={{ id: v.id }}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {v.code}
                      </Link>
                    </td>
                    <td className="fw-700">{v.name}</td>
                    <td style={{ fontSize: 12 }}>{v.contactPerson ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{v.phone ?? '—'}</td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {v.email ?? '—'}
                    </td>
                    <td style={{ fontSize: 11 }}>{v.gstNumber ?? '—'}</td>
                    <td
                      className="text3"
                      style={{
                        fontSize: 11,
                        maxWidth: 150,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={v.addressLine1 ?? undefined}
                    >
                      {v.addressLine1 ?? '—'}
                    </td>
                    <td className="td-ctr">
                      <span className={`badge ${ratingBadgeClass(v.rating)}`}>
                        ⭐{v.rating ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${v.isActive ? 'b-green' : 'b-red'}`}>
                        {v.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {/* Edit/Del go somewhere OTHER than the row's detail page, so
                        they stop the row-navigation click (Rule 2). */}
                    <td>
                      <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {canEdit ? (
                          <Link
                            to="/vendors/$id/edit"
                            params={{ id: v.id }}
                            className="btn btn-ghost btn-sm"
                          >
                            Edit
                          </Link>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={softDelete.isPending}
                            onClick={() => {
                              if (confirm(`Move vendor ${v.code} — ${v.name} to Trash?`)) {
                                softDelete.mutate(v.id);
                              }
                            }}
                          >
                            Del
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
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No vendors'
            : search.status
              ? `Showing ${rows.length} ${search.status} of ${total} vendor${total === 1 ? '' : 's'}`
              : total > LIST_LIMIT
                ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
                : `Showing all ${total} vendor${total === 1 ? '' : 's'}`}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 Click a row to open the vendor. Click a count above to filter by status.
      </div>

      {/* Legacy L27776-27779: Excel template + import sit below the table panel. */}
      {canAdd ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={() => downloadVendorTemplate()}
          >
            ⬇ Download Excel Template
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '📄'} Import from
            Excel
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
