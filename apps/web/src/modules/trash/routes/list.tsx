// Trash — admin-only soft-delete recovery.
//
// Mirror of legacy renderTrash (HTML L11309). Lists every soft-deleted
// row across the curated set of entities (one UNION ALL backend query).
// Restore (clears deleted_at) + Permanent Delete (hard) + Empty All.

import { createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Lock, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { fmtDateTime } from '@/lib/date';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useEmptyTrash,
  usePermDeleteTrash,
  useRestoreFromTrash,
  useTrash,
  type ListTrashQuery,
  type TrashEntityType,
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
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.type, search.page],
  );

  const { data, isLoading, isError, error } = useTrash(query);
  const restore = useRestoreFromTrash();
  const permDel = usePermDeleteTrash();
  const empty = useEmptyTrash();

  const [actionError, setActionError] = useState<string | null>(null);
  const [asking, setAsking] = useState<
    { kind: 'one'; it: { type: TrashEntityType; id: string; label: string } } | { kind: 'all' } | null
  >(null);

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

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // `total` is scoped to the active type filter; `byType` is always computed
  // server-side over every type, so its sum is the true trash-wide count.
  // Legacy gates Empty All on the UNFILTERED count (db.trash.length, L11335)
  // and states that same unfiltered count in its confirm (L2191).
  const grandTotal = Object.values(data?.byType ?? {}).reduce((a, b) => a + b, 0);

  // Restore is harmless and reversible — no confirm.
  async function onRestore(it: { type: TrashEntityType; id: string; label: string }): Promise<void> {
    setActionError(null);
    try {
      await restore.mutateAsync({ type: it.type, id: it.id });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not restore. Try again.');
    }
  }

  // Both run from the app ConfirmDialog (never window.confirm); a thrown error
  // is shown inside the dialog instead of closing it.
  async function onPermDelete(it: { type: TrashEntityType; id: string; label: string }): Promise<void> {
    setActionError(null);
    try {
      await permDel.mutateAsync({ type: it.type, id: it.id });
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Could not delete permanently. Try again.');
    }
    setAsking(null);
  }

  async function onEmptyAll(): Promise<void> {
    setActionError(null);
    try {
      await empty.mutateAsync();
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Could not empty Trash. Try again.');
    }
    setAsking(null);
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Trash
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="innovic-select"
            value={search.type ?? ''}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({ ...prev, type: e.target.value || undefined, page: 1 }),
                replace: true,
              })
            }
            style={{ width: 160 }}
          >
            <option value="">All Document Types</option>
            {TYPE_OPTIONS.map((t) => {
              const n = data?.byType[t] ?? 0;
              return (
                <option key={t} value={t} disabled={n === 0}>
                  {typeLabel(t)} ({n})
                </option>
              );
            })}
          </select>
          {grandTotal > 0 ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setAsking({ kind: 'all' })}
              disabled={empty.isPending}
            >
              {empty.isPending ? (
                <>
                  <Loader2 className="inline h-3 w-3 animate-spin" /> Emptying…
                </>
              ) : (
                'Empty All'
              )}
            </button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div style={{ marginBottom: 12 }}>
          <Banner tone="error" role="alert">
            {actionError}
          </Banner>
        </div>
      ) : null}

      {!isLoading && !isError && items.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 32 }}>
            {search.type ? 'No deleted records match.' : 'Trash is empty.'}
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="tbl-wrap">
            <table className="innovic-table">
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
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={restore.isPending}
                            onClick={() => void onRestore(it)}
                          >
                            <RotateCcw size={12} /> Restore
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={permDel.isPending}
                            onClick={() => setAsking({ kind: 'one', it })}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
            ? ''
            : `Showing ${(search.page - 1) * PAGE_SIZE + 1}–${Math.min(search.page * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={search.page <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, search.page - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {search.page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={search.page >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, search.page + 1) }),
                replace: true,
              })
            }
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {asking?.kind === 'one' ? (
        <ConfirmDialog
          title={`Delete ${typeLabel(asking.it.type)} ${asking.it.label} permanently?`}
          message="This cannot be undone."
          confirmLabel="Delete Permanently"
          pendingLabel="Deleting…"
          onConfirm={() => onPermDelete(asking.it)}
          onCancel={() => setAsking(null)}
          elevated={false}
        />
      ) : null}
      {asking?.kind === 'all' ? (
        <ConfirmDialog
          // grandTotal, not `total`: Empty All deletes every type, ignoring the filter.
          title={`Delete all ${grandTotal} items in Trash permanently?`}
          message="This cannot be undone."
          confirmLabel="Empty All"
          pendingLabel="Emptying…"
          requireTyped="DELETE"
          onConfirm={() => onEmptyAll()}
          onCancel={() => setAsking(null)}
          elevated={false}
        />
      ) : null}
    </div>
  );
}
