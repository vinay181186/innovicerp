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
import { Lock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { SearchInput } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import {
  useRestoreFromTrash,
  useTrash,
  type ListTrashQuery,
  type TrashEntityType,
  type TrashListItem,
} from '../api';
import { trashColumns, TYPE_OPTIONS, typeLabel } from '../components/trash-columns';

const PAGE_SIZE = 50;

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
  const columns = useMemo(() => trashColumns(), []);

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
          You do not have permission to view Trash. Ask an admin.
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

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load Trash. Try again.'}
        />
      ) : (
        // THE shared FIT table (ADR-199). First column (Document) is pinned; a
        // trashed row has no detail page, so the row is not clickable. The one
        // per-row action — Restore — is the ⋯ rowMenu, gated and wired to the
        // same confirm + mutation as before.
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.trashList}
            columns={columns}
            rows={items}
            rowKey={(it) => `${it.type}:${it.id}`}
            loading={isLoading}
            emptyText={urlTerm || search.type ? 'No deleted documents match.' : 'Trash is empty.'}
            rowMenu={(it) => [
              {
                key: 'restore',
                label: 'Restore',
                icon: 'refresh-cw',
                // As before: no second Restore while one is saving.
                disabledReason: restore.isPending ? 'Restoring…' : undefined,
                onSelect: () => setRestoring(it),
              },
            ]}
          />
        </Panel>
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

      {restoring ? (
        <ConfirmDialog
          tone="primary"
          title={`Restore ${typeLabel(restoring.type)} ${restoring.label}?`}
          message=""
          confirmLabel="Restore"
          pendingLabel="Restoring…"
          onConfirm={onRestoreConfirmed}
          onCancel={() => setRestoring(null)}
        />
      ) : null}
    </div>
  );
}
