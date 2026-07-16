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

import type { ListVendorsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { SortTh, nextSort } from '@/components/shared/sortable-th';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateVendor, useSoftDeleteVendor, useVendorsList } from '../api';
import { downloadVendorTemplate, parseVendorImportFile } from '../lib/import-export';

const PAGE_SIZE = 25;
// Legacy renders 11 columns; PO/GRN is DELTA (see header note), so 10 here.
const COL_COUNT = 10;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sortBy: z.enum(['code', 'name']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().positive().default(1),
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
  const { data: me } = useSession();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const isActiveFilter =
    search.status === 'active' ? true : search.status === 'inactive' ? false : undefined;

  const query: ListVendorsQuery = useMemo(
    () => ({
      search: search.search,
      isActive: isActiveFilter,
      sortBy: search.sortBy,
      sortDir: search.sortDir,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, isActiveFilter, search.sortBy, search.sortDir, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useVendorsList(query);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const toggleSort = useCallback(
    (field: 'code' | 'name') => {
      const next = nextSort(field, { sortBy: search.sortBy, sortDir: search.sortDir });
      void navigate({ search: (prev) => ({ ...prev, ...next, page: 1 }), replace: true });
    },
    [navigate, search.sortBy, search.sortDir],
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
      let ok = 0;
      const fails: string[] = [];
      for (const p of payloads) {
        try {
          await createVendor.mutateAsync(p);
          ok += 1;
        } catch (e) {
          fails.push(`${p.code}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      setImportMsg(
        `Imported ${ok}/${payloads.length} vendor(s).` +
          (errors.length ? ` ${errors.length} row warning(s): ${errors.slice(0, 3).join('; ')}` : '') +
          (fails.length ? ` Failures: ${fails.slice(0, 3).join('; ')}` : ''),
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const rows = data?.vendors ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🏭 Vendor Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="🔍 Search vendor…"
            title="Search by vendor code or name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ minWidth: 220, fontSize: 13 }}
          />
          <select
            className="innovic-select"
            value={search.status ?? ''}
            onChange={(e) => {
              const v = e.target.value as 'active' | 'inactive' | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
            style={{ width: 120, fontSize: 12 }}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/vendors/new" className="btn btn-primary">
              + Add Vendor
            </Link>
          ) : null}
        </div>
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
                    No vendors. Add vendors to create Purchase Orders.
                  </td>
                </tr>
              ) : (
                rows.map((v) => (
                  <tr key={v.id}>
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
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canWrite ? (
                          <Link
                            to="/vendors/$id/edit"
                            params={{ id: v.id }}
                            className="btn btn-ghost btn-sm"
                          >
                            Edit
                          </Link>
                        ) : null}
                        {canWrite ? (
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
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No vendors'
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

      {/* Legacy L27776-27779: Excel template + import sit below the table panel. */}
      {canWrite ? (
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
            accept=".xlsx,.xls"
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
