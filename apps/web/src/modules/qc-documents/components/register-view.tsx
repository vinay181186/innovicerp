// File Register view (original flat QC Documents list) — ADR-199 fit table
// (tableKey qcDocsRegister). Split out of routes/list.tsx. The server-side
// search + Category filter are preserved; the shared Sort & Filter menu
// (ADR-200) narrows the loaded rows on top. The entry/delete permission gates
// are unchanged.

import {
  QC_DOC_CATEGORIES,
  type ListQcDocumentsQuery,
  type QcDocCategory,
  type QcDocument,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { ConfirmDialog } from '@/ui/feedback';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { qcDocViewUrl, useDeleteQcDocument, useQcDocuments } from '../api';
import { qcDocumentsListRoute } from '../routes/list';
import { buildRegisterColumns, REGISTER_DETAIL_IDS } from './register-columns';
import { CATEGORY_LABEL } from './qc-doc-shared';
import { UploadModal } from './upload-modal';

export function RegisterView({ toggle }: { toggle: React.ReactNode }): React.JSX.Element {
  const search = qcDocumentsListRoute.useSearch();
  const navigate = qcDocumentsListRoute.useNavigate();
  // `me` is still needed for the company id the upload modal writes against.
  const { data: me } = useSession();
  // Tier-driven, per department (QC), replacing the old role list
  // (admin/manager/qc). 📎 Upload Document is `entry`; removing a registered
  // upload is the L5-and-above pair — see `canDelete` below.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'qcdocs_upload');
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve.
  const canDelete = perms.edit && perms.approve;
  const del = useDeleteQcDocument();
  const [uploadOpen, setUploadOpen] = useState(false);
  // The box mirrors the URL's ?search= (the server searches); typing writes
  // the normalised term back, while the box keeps exactly what was typed.
  const [term, setTerm] = useState(search.search ?? '');

  const query: ListQcDocumentsQuery = useMemo(
    () => ({
      ...(search.category ? { category: search.category } : {}),
      ...(search.search ? { search: search.search } : {}),
    }),
    [search.category, search.search],
  );
  const { data, isLoading, isFetching, isError, error } = useQcDocuments(query);
  const items = data?.items ?? [];
  const columns = useMemo(() => buildRegisterColumns(), []);

  async function openFile(d: QcDocument): Promise<void> {
    try {
      const url = await qcDocViewUrl(d.storagePath, d.soCodeText);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not open file. Try again.');
    }
  }
  const [pendingDelete, setPendingDelete] = useState<QcDocument | null>(null);

  return (
    <div>
      <ListHeader
        title="QC Documents"
        icon="🗃"
        count={data ? items.length : undefined}
        noun="document"
        filterNote={search.category ? CATEGORY_LABEL[search.category] : undefined}
        search={term}
        onSearch={(v) => {
          setTerm(v);
          // normalizeSearchTerm (shared) — trims and collapses inner spacing so
          // "  MTC  01 " and "MTC 01" are one query, one cache entry, one URL.
          const n = normalizeSearchTerm(v);
          void navigate({
            search: (prev) => ({ ...prev, search: n || undefined }),
            replace: true,
          });
        }}
        searchPlaceholder="Search doc type, file, JC, item, SO…"
        updating={isFetching && !isLoading}
        filters={
          <select
            className="innovic-select"
            aria-label="Category"
            title="Category"
            value={search.category ?? ''}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  category: (e.target.value || undefined) as QcDocCategory | undefined,
                }),
                replace: true,
              })
            }
          >
            <option value="">All Categories</option>
            {QC_DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        }
        onClearFilters={() => {
          setTerm('');
          void navigate({
            search: (prev) => ({ ...prev, category: undefined, search: undefined }),
            replace: true,
          });
        }}
        filtersActive={!!search.category || term.trim() !== ''}
        tools={toggle}
        primary={
          perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
              📎 Upload Document
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load QC Documents. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.qcDocsRegister}
            columns={columns}
            rows={items}
            loading={isLoading}
            emptyText={
              search.category || search.search ? 'No QC Documents match.' : 'No QC Documents yet.'
            }
            defaultHidden={REGISTER_DETAIL_IDS}
            onRowClick={(d) => void openFile(d)}
            rowActions={(d) => (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void openFile(d)}
                >
                  📎 Open
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={del.isPending}
                    onClick={() => setPendingDelete(d)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            )}
          />
        </Panel>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete ${pendingDelete.fileName}?`}
          message="The file is removed from QC Documents."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            await del.mutateAsync(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}

      {uploadOpen && me?.companyId ? (
        <UploadModal companyId={me.companyId} onClose={() => setUploadOpen(false)} />
      ) : null}
    </div>
  );
}
