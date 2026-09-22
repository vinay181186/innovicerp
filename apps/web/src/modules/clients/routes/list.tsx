// Client Master list (UI-003-02).
// Ports legacy renderClients (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L12969-12995) to Innovic chrome. Legacy columns, in order:
// Code | Client Name | Address | Contact | Email | <blank actions th> (L12991).
// Status is a port-only column: legacy clients have no status field, ours carry
// isActive and the API filters on it (see ISSUES.md logged delta).
//
// Styled to the shared list standard (see .claude/skills/styling + the SO Master
// reference apps/web/src/modules/sales-orders/routes/list.tsx):
//   • one frozen header band, so the title + StatStrip + toolbar stay put while
//     the rows scroll under them;
//   • counts sit in ONE <StatStrip> (All / Active / Inactive) — real numbers
//     computed from the loaded rows, doubling as the status filter (Rule 3);
//   • whole rows are clickable to the detail page, actions stop propagation
//     (Rule 2);
//   • one scrolling fetch, no Prev/Next — the master-list conversion Rule 4
//     names for Clients (status filter + counts are done client-side over the
//     single fetch, which is why the server query drops isActive);
//   • laid out as the app's ruled sheet (`.innovic-table.tbl-grid`, the SO
//     Master / Job Cards look, 2026-09-21): Sr No first, Action last (icon
//     buttons only, named on hover), fixed `%` widths that add up to 100 so
//     nothing scrolls sideways. The Code / Client Name header sort toggles went
//     with it — the SO master standard has none; rows come in the API's
//     default order.

import type { ListClientsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Eye, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useBulkCreateClients, useClientsList, useSoftDeleteClient } from '../api';
import { downloadClientTemplate, parseClientImportFile } from '../lib/import-export';

// No pagination — Clients is a master list, so it mirrors the SO/WO list: one
// fetch, everything in a single scrolling list (styling skill, Rule 4). The
// clients list endpoint caps `limit` at 1000 (packages/shared client schema,
// raised from 200 to match the SO master); the count line flags a larger set.
const LIST_LIMIT = 1000;

/** Column count — the loading / error / empty rows' <td colSpan> must always
 *  match the <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 8;

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
});

export const clientsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'clients',
  validateSearch: listSearchSchema,
  component: ClientsListPage,
});

function ClientsListPage(): React.JSX.Element {
  const search = clientsListRoute.useSearch();
  const navigate = clientsListRoute.useNavigate();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'client_create');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  ACME  Engg " and "ACME Engg" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // One fetch of every client matching the search (no isActive server filter):
  // the Active/Inactive split is derived + filtered client-side so the StatStrip
  // can show real counts for all three tiles.
  const query: ListClientsQuery = useMemo(
    () => ({
      search: search.search,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search],
  );

  const { data, isLoading, isFetching, isError, error } = useClientsList(query);
  const softDelete = useSoftDeleteClient();
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // Excel import — the WHOLE sheet goes in one request, and the list reloads
  // once at the end.
  //
  // It used to loop the single-create mutation over the rows: one round trip per
  // client, and because each success invalidated the list query, the browser
  // re-downloaded the entire client master after every row — so the import got
  // slower the longer it ran. Measured on the live system (the identical vendor
  // import) at ~1 row/second, which put a 500-row sheet at about nine minutes.
  //
  // The duplicate-NAME guard moved to the server with it — name is the key this
  // page has always de-duplicated on, because the template carries no Code
  // column. It used to compare against `data.clients`, i.e. the page of clients
  // currently loaded on screen, so anything past that page read as "new" and was
  // created a second time. The server now compares against the whole company.
  const bulkCreate = useBulkCreateClients();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      const { payloads, errors } = await parseClientImportFile(file);
      if (payloads.length === 0) {
        setImportMsg(
          errors.length
            ? `Nothing to import. ${errors.length} row issue(s): ${fmtList(errors)}`
            : 'Nothing to import — the sheet has no client rows.',
        );
        return;
      }
      const res = await bulkCreate.mutateAsync({ clients: payloads });
      const skips = res.skipped.map((s) => `Row ${s.index} "${s.name}": ${s.reason}`);
      setImportMsg(
        `Imported ${res.created}/${payloads.length} client(s).` +
          (skips.length ? ` ${skips.length} skipped: ${fmtList(skips)}` : '') +
          (errors.length ? ` ${errors.length} row warning(s): ${fmtList(errors)}` : ''),
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const setStatus = useCallback(
    (status: 'active' | 'inactive' | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, status }), replace: true });
    },
    [navigate],
  );

  // All rows matching the search; the Active/Inactive filter is client-side.
  const allRows = useMemo(() => data?.clients ?? [], [data?.clients]);
  const activeCount = useMemo(() => allRows.filter((c) => c.isActive).length, [allRows]);
  const inactiveCount = allRows.length - activeCount;
  const visibleRows = useMemo(() => {
    if (search.status === 'active') return allRows.filter((c) => c.isActive);
    if (search.status === 'inactive') return allRows.filter((c) => !c.isActive);
    return allRows;
  }, [allRows, search.status]);

  const total = data?.total ?? 0;

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
            alignItems: 'flex-start',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              Client Master
            </div>
            {/* Count comes from the list response's `total` — every client
                matching the search; the status split is the strip's job. */}
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} client{total === 1 ? '' : 's'}
              {search.status ? (
                <>
                  {' '}
                  · <span className="text2">{search.status}</span> only
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
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {canAdd ? (
              <Link to="/clients/new" className="btn btn-primary">
                <Plus size={14} /> New Client
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
              label: 'All Clients',
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
        {/* The sheet look (tbl-grid): bold blue column names, gridlines, cream /
            white rows, fixed widths that add up to 100% so nothing scrolls
            sideways. Every column is centred by the standard; only Client Name
            is left-aligned so the names share one edge. */}
        <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
          <table className="innovic-table tbl-grid">
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '19%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '11%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Sr No</th>
                <th>Code</th>
                <th style={{ textAlign: 'left' }}>Client Name</th>
                <th>Address</th>
                <th>Contact</th>
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
                  <td
                    colSpan={COLUMN_COUNT}
                    className="empty-state"
                    style={{ color: 'var(--red)' }}
                  >
                    {error instanceof Error ? error.message : 'Failed to load clients'}
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="empty-state">
                    {search.status
                      ? `No ${search.status} clients`
                      : 'No clients yet — click + New Client'}
                  </td>
                </tr>
              ) : (
                // Whole row navigates to the client's detail page (Rule 2).
                visibleRows.map((c, i) => (
                  <tr
                    key={c.id}
                    onClick={() => void navigate({ to: '/clients/$id', params: { id: c.id } })}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="text3">{i + 1}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link
                        to="/clients/$id"
                        params={{ id: c.id }}
                        className="td-code"
                        style={{ textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.code}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <div
                        className="fw-700"
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={c.name}
                      >
                        {c.name}
                      </div>
                    </td>
                    {/* Long free text — clip with ellipsis + full value on hover
                        (Rule 1), rather than letting it wrap the row taller. */}
                    <td
                      className="text2"
                      style={{
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={c.addressLine1 ?? ''}
                    >
                      {c.addressLine1 ?? '—'}
                    </td>
                    <td
                      className="text2"
                      style={{
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={c.contactPerson ?? ''}
                    >
                      {c.contactPerson ?? '—'}
                    </td>
                    <td
                      className="text2"
                      style={{
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={c.email ?? ''}
                    >
                      {c.email ?? '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`badge ${c.isActive ? 'b-green' : 'b-grey'}`}>
                        {c.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                    {/* Icon buttons only, one row, each named on hover: View
                        (the detail page — the row click goes there too, but the
                        user asked for the icon as well), Edit, Delete. One
                        stopPropagation on the wrapper covers all three (Rule 2). */}
                    <td>
                      <div
                        style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link
                          to="/clients/$id"
                          params={{ id: c.id }}
                          className="btn btn-ghost btn-sm btn-icon"
                          style={{ padding: '3px 6px' }}
                          title="View"
                          aria-label="View"
                        >
                          <Eye size={14} />
                        </Link>
                        {canEdit ? (
                          <Link
                            to="/clients/$id/edit"
                            params={{ id: c.id }}
                            className="btn btn-ghost btn-sm btn-icon"
                            style={{ padding: '3px 6px' }}
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
                            style={{ color: 'var(--red)', padding: '3px 6px' }}
                            title="Delete"
                            aria-label="Delete"
                            disabled={softDelete.isPending}
                            onClick={() => {
                              if (confirm(`Move client ${c.name} to Trash?`)) {
                                softDelete.mutate(c.id);
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
            ? 'No clients'
            : search.status
              ? `Showing ${visibleRows.length} ${search.status} of ${total} client${total === 1 ? '' : 's'}`
              : total > LIST_LIMIT
                ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
                : `Showing all ${total} client${total === 1 ? '' : 's'}`}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, padding: '0 4px' }}>
        💡 Click a row to open the client. Click a count above to filter by status.
      </div>

      {/* Excel template + import sit below the table panel (mirror of Vendor Master). */}
      {canAdd ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={() => downloadClientTemplate()}
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
