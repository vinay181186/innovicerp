// Trash — admin-only soft-delete recovery.
//
// Mirror of legacy renderTrash (HTML L11309). Lists every soft-deleted
// row across the curated set of entities (one UNION ALL backend query).
// Restore (clears deleted_at) only. There is no permanent delete inside the
// app (CLAUDE.md rule 8 — hard deletes only via documented admin scripts after
// a backup), so the legacy per-row Delete and Empty All are gone. The search
// box is answered by the server (GET /trash?search=), so total and paging
// count only the matching documents.

import { createRoute } from '@tanstack/react-router';
import { Loader2, Lock, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDateTime } from '@/lib/date';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ConfirmDialog } from '@/ui/feedback';
import { SearchInput } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import {
  useRestoreFromTrash,
  useTrash,
  type ListTrashQuery,
  type TrashEntityType,
  type TrashListItem,
} from '../api';

const PAGE_SIZE = 50;

const TYPE_OPTIONS: readonly TrashEntityType[] = [
  'Sales Order',
  'Job Work Order',
  'Job Card',
  'Item',
  'Client',
  'Vendor',
  'Machine',
  'Operator',
  'Purchase Request',
  'Purchase Order',
  'Goods Receipt Note',
  'Delivery Challan',
  'NC Register',
  'BOM Master',
  'Route Card',
  'Cost Center',
  'QC Process',
];

// On-screen names for the type codes above. The codes themselves are what the
// API filters on and stay as they are; only the words the user reads change
// (Customer, never Client; Cost Centre spelling; JWSO's full name).
const TYPE_LABEL: Partial<Record<TrashEntityType, string>> = {
  'Job Work Order': 'Job Work Sales Order',
  Client: 'Customer',
  'Cost Center': 'Cost Centre',
};
function typeLabel(t: TrashEntityType): string {
  return TYPE_LABEL[t] ?? t;
}

const listSearchSchema = z.object({
  type: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const trashListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'trash',
  validateSearch: listSearchSchema,
  component: TrashListPage,
});

function TrashListPage(): React.JSX.Element {
  const search = trashListRoute.useSearch();
  const navigate = trashListRoute.useNavigate();
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';

  const query: ListTrashQuery = useMemo(
    () => ({
      type: search.type as TrashEntityType | undefined,
      search: search.search,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.type, search.search, search.page],
  );

  const { data, isLoading, isError, error } = useTrash(query);
  const restore = useRestoreFromTrash();

  // The row whose Restore is being confirmed (ConfirmDialog, not window.confirm).
  const [restoring, setRestoring] = useState<TrashListItem | null>(null);

  const items = data?.items ?? [];

  // The box keeps what the user typed (a trailing space included); only the
  // normalised term goes to the URL, and a new term goes back to page 1.
  const urlTerm = search.search;
  const urlTermRef = useRef(urlTerm);
  urlTermRef.current = urlTerm;
  const [searchInput, setSearchInput] = useState(urlTerm ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link).
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (urlTerm ?? '') ? prev : (urlTerm ?? ''),
    );
  }, [urlTerm]);
  useEffect(() => {
    // Runs only when the box changes (not when the URL does), so a Back to
    // another term is adopted above instead of being written over here.
    const next = normalizeSearchTerm(searchInput) || undefined;
    if (next === urlTermRef.current) return;
    void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
  }, [searchInput, navigate]);

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          <Lock size={14} style={{ display: 'inline', marginRight: 6 }} />
          Admin access required for Trash.
        </div>
      </div>
    );
  }

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // `total` is scoped to the active type filter; `byType` is always computed
  // server-side over every type, so its sum is the true trash-wide count.
  const grandTotal = Object.values(data?.byType ?? {}).reduce((a, b) => a + b, 0);

  async function onRestoreConfirmed(): Promise<void> {
    if (!restoring) return;
    // A rejection is shown inside the dialog (ConfirmDialog catches it).
    await restore.mutateAsync({ type: restoring.type, id: restoring.id });
    setRestoring(null);
  }

  return (
    <div>
      <ListHeader
        title="Trash"
        icon="🗑"
        count={data ? total : undefined}
        noun="deleted document"
        filterNote={search.type ? typeLabel(search.type as TrashEntityType) : undefined}
        // Own box: the shared SearchInput with its 300ms debounce, as before.
        searchSlot={
          <SearchInput
            value={searchInput}
            debounceMs={300}
            placeholder="Search document type, document, deleted by…"
            onChange={setSearchInput}
          />
        }
        filters={
          <select
            className="innovic-select"
            aria-label="Document type"
            title="Document type"
            value={search.type ?? ''}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({ ...prev, type: e.target.value || undefined, page: 1 }),
                replace: true,
              })
            }
          >
            <option value="">All Document Types ({grandTotal})</option>
            {TYPE_OPTIONS.map((t) => {
              const n = data?.byType[t] ?? 0;
              return (
                <option key={t} value={t} disabled={n === 0}>
                  {typeLabel(t)} ({n})
                </option>
              );
            })}
          </select>
        }
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, type: undefined, search: undefined, page: 1 }),
            replace: true,
          });
        }}
        filtersActive={!!search.type || searchInput.trim() !== ''}
      />

      {!isLoading && !isError && items.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 32 }}>
            {urlTerm ? 'No deleted documents match your search.' : 'Trash is empty'}
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="innovic-table tbl-grid">
              <thead>
                <tr>
                  <th>Deleted At</th>
                  <th>Document Type</th>
                  <th>Document</th>
                  <th>Deleted By</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      Loading…
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={5} className="empty-state" style={{ color: 'var(--red2)' }}>
                      {error instanceof Error ? error.message : 'Could not load Trash. Try again.'}
                    </td>
                  </tr>
                ) : (
                  items.map((it) => (
                    <tr key={`${it.type}:${it.id}`}>
                      <td className="text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {fmtDateTime(it.deletedAt)}
                      </td>
                      <td>
                        <span className="badge b-grey">{typeLabel(it.type)}</span>
                      </td>
                      <td className="fw-700">{it.label}</td>
                      <td className="text3" style={{ fontSize: 11 }}>
                        {it.deletedByName ?? '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={restore.isPending}
                          onClick={() => setRestoring(it)}
                        >
                          <RotateCcw size={12} /> Restore
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ListFooter
        total={total}
        noun="deleted document"
        page={search.page}
        pageSize={PAGE_SIZE}
        onPage={(p) =>
          void navigate({
            search: (prev) => ({ ...prev, page: Math.min(totalPages, Math.max(1, p)) }),
            replace: true,
          })
        }
      />

      <div className="text3" style={{ fontSize: 11, marginTop: 8, padding: '0 4px' }}>
        Only admins can open Trash. Restore puts a document back where it was; nothing is
        permanently deleted from here.
      </div>

      {restoring ? (
        <ConfirmDialog
          tone="primary"
          title={`Restore ${typeLabel(restoring.type)} ${restoring.label}?`}
          message="It goes back to its list exactly as it was before it was deleted."
          confirmLabel="Restore"
          pendingLabel="Restoring…"
          onConfirm={onRestoreConfirmed}
          onCancel={() => setRestoring(null)}
        />
      ) : null}
    </div>
  );
}
