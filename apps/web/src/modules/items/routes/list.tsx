// Item Master list (UI-003-01).
// Ports legacy renderItems (legacy/InnovicERP_v82_12_3.html L11481) to
// the Innovic chrome (.panel + .innovic-table + .badge + .btn). Columns
// match legacy header order: Item Code | Name | Description | Drawing No.
// | Rev | Material | UOM | Drw | Actions.

import { type ItemType, ITEM_TYPES, type ListItemsQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItemsList } from '../api';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  itemType: z.enum(ITEM_TYPES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const itemsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items',
  validateSearch: listSearchSchema,
  component: ItemsListPage,
});

function ItemsListPage(): React.JSX.Element {
  const search = itemsListRoute.useSearch();
  const navigate = itemsListRoute.useNavigate();
  const { data: me } = useSession();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  // Debounce search input → URL search param
  useEffect(() => {
    const trimmed = searchInput.trim();
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListItemsQuery = useMemo(
    () => ({
      search: search.search,
      itemType: search.itemType,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.itemType, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useItemsList(query);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

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
          Item Master
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="innovic-input"
            placeholder="Search code, name, material…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            style={{ width: 240, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={search.itemType ?? ''}
            onChange={(e) => {
              const v = e.target.value as ItemType | '';
              void navigate({
                search: (prev) => ({
                  ...prev,
                  itemType: v === '' ? undefined : v,
                  page: 1,
                }),
                replace: true,
              });
            }}
            style={{ width: 140, fontSize: 12 }}
          >
            <option value="">All types</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          {canWrite ? (
            <Link to="/items/new" className="btn btn-primary">
              <Plus size={14} /> Add Item
            </Link>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            ★ Item Master is for defining items only. Stock / Inventory is managed in{' '}
            <b>Store → Stock Ledger</b>.
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Name</th>
                <th>Description</th>
                <th>Drawing No.</th>
                <th className="td-ctr">Rev</th>
                <th>Material</th>
                <th className="td-ctr">UOM</th>
                <th className="td-ctr">Drw</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={9} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load items'}
                  </td>
                </tr>
              ) : (data?.items.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No items
                  </td>
                </tr>
              ) : (
                data!.items.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <Link
                        to="/items/$id"
                        params={{ id: it.id }}
                        className="td-code"
                        style={{ color: 'var(--purple)', textDecoration: 'none' }}
                      >
                        {it.code}
                      </Link>
                    </td>
                    <td className="fw-700">{it.name}</td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {it.description ?? '—'}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {it.drawingNo ?? '—'}
                    </td>
                    <td className="td-ctr">{it.revision}</td>
                    <td>{it.material ?? '—'}</td>
                    <td className="td-ctr">
                      <span className="badge b-grey">{it.uom}</span>
                    </td>
                    <td className="td-ctr">
                      {it.drawingFilePath ? (
                        <span title="Drawing file attached" style={{ fontSize: 14 }}>
                          📎
                        </span>
                      ) : (
                        <span className="text3">—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <Link
                          to="/items/$id"
                          params={{ id: it.id }}
                          className="btn btn-ghost btn-sm"
                        >
                          View
                        </Link>
                        {canWrite ? (
                          <Link
                            to="/items/$id/edit"
                            params={{ id: it.id }}
                            className="btn btn-ghost btn-sm"
                          >
                            Edit
                          </Link>
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
            ? 'No items'
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
