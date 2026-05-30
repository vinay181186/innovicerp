// Trash — admin-only soft-delete recovery.
//
// Mirror of legacy renderTrash (HTML L11309). Lists every soft-deleted
// row across the curated set of entities (one UNION ALL backend query).
// Restore (clears deleted_at) + Permanent Delete (hard) + Empty All.

import { createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2, Lock, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
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

function fmtTs(ts: string): string {
  const dt = new Date(ts);
  return (
    dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' +
    dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  );
}

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

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          <Lock size={14} style={{ display: 'inline', marginRight: 6 }} />
          Admin access required for Trash.
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function onRestore(it: { type: TrashEntityType; id: string; label: string }): Promise<void> {
    setActionError(null);
    if (!window.confirm(`Restore ${it.type} "${it.label}"?`)) return;
    try {
      await restore.mutateAsync({ type: it.type, id: it.id });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Restore failed');
    }
  }

  async function onPermDelete(it: { type: TrashEntityType; id: string; label: string }): Promise<void> {
    setActionError(null);
    if (
      !window.confirm(
        `Permanently delete ${it.type} "${it.label}"?\n\nThis CANNOT be undone.`,
      )
    )
      return;
    try {
      await permDel.mutateAsync({ type: it.type, id: it.id });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Permanent delete failed');
    }
  }

  async function onEmptyAll(): Promise<void> {
    setActionError(null);
    const confirmText = window.prompt(
      `You are about to PERMANENTLY DELETE ${total} items.\n\nThis CANNOT be undone. Type DELETE to confirm:`,
    );
    if (confirmText !== 'DELETE') return;
    try {
      await empty.mutateAsync();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Empty trash failed');
    }
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
            🗑 Trash
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Soft-deleted records across every module. Restore to bring back, or permanently delete (cannot be undone).
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
            style={{ width: 180, fontSize: 12 }}
          >
            <option value="">All types ({total})</option>
            {TYPE_OPTIONS.map((t) => {
              const n = data?.byType[t] ?? 0;
              return (
                <option key={t} value={t} disabled={n === 0}>
                  {t} ({n})
                </option>
              );
            })}
          </select>
          <span className="text3" style={{ fontSize: 11 }}>
            {total} item{total !== 1 ? 's' : ''} in trash
          </span>
          {total > 0 ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => void onEmptyAll()}
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
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.06)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {actionError}
        </div>
      ) : null}

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Deleted At</th>
                <th>Type</th>
                <th>Item</th>
                <th>Deleted By</th>
                <th style={{ width: 180 }}>Actions</th>
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
                  <td colSpan={5} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load trash'}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    Trash is empty.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={`${it.type}:${it.id}`}>
                    <td className="text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {fmtTs(it.deletedAt)}
                    </td>
                    <td>
                      <span className="badge b-grey">{it.type}</span>
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
                          onClick={() => void onPermDelete(it)}
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
            ? 'Nothing in trash'
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

      <div className="text3" style={{ fontSize: 11, marginTop: 8, padding: '0 4px' }}>
        💡 Items can be restored to their original list. Only Admins can permanently delete or empty trash.
      </div>
    </div>
  );
}
