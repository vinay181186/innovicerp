// Multi-Level BOM list (ADR-225). Composed exactly like the BOM Master list
// (modules/bom-master/routes/list.tsx): ListHeader · Panel + DataTable (fit
// table, server Sort & Filter, 25 rows a page) · ListFooter · PageState.
// Row actions live in the ⋯ menu (Open, Edit, Make Default, Delete).

import type { MlBomListItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon } from '@/ui/core';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useDeleteMlBom, useMakeDefaultMlBom, useMlBomsList } from '../api';
import { downloadMlBomTemplate } from '../components/ml-bom-import-template';
import { mlBomListColumns } from '../components/ml-bom-list-columns';

// ADR-225 phase 2: the import dialog (and the Excel reader it pulls in) loads
// only when Import is pressed.
const MlBomImportDialog = lazy(() =>
  import('../components/ml-bom-import-dialog').then((m) => ({ default: m.MlBomImportDialog })),
);

const searchSchema = z.object({
  search: z.string().optional(),
  page: pageSearchParam,
});

export const mlBomsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-boms',
  validateSearch: searchSchema,
  component: MlBomsListPage,
});

function MlBomsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, page } = mlBomsListRoute.useSearch();

  // Search lives in the URL; the box mirrors it and a debounce writes it back
  // (the SO / BOM Master list shape).
  const [searchInput, setSearchInput] = useState(search ?? '');
  useEffect(() => {
    setSearchInput(search ?? '');
  }, [search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search) return;
    const id = window.setTimeout(() => {
      void navigate({
        to: '/ml-boms',
        search: (prev) => ({ ...prev, search: next, page: 1 }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, navigate]);

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ to: '/ml-boms', search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  const sf = useServerSortFilter(TABLE_KEYS.mlBomList, () => gotoPage(1));
  const offset = pageOffset(page);
  const { data, isLoading, isFetching, isError, error } = useMlBomsList({
    search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlbom_create');
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, gotoPage);

  const makeDefault = useMakeDefaultMlBom();
  const del = useDeleteMlBom();
  const [toDelete, setToDelete] = useState<MlBomListItem | null>(null);
  // ADR-197: a delete carries a reason — it is the Reason on the History row.
  const [deleteReason, setDeleteReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);

  const columns = useMemo(() => mlBomListColumns(offset), [offset]);

  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  const onMakeDefault = async (b: MlBomListItem): Promise<void> => {
    setActionError(null);
    try {
      await makeDefault.mutateAsync({ id: b.id, expectedUpdatedAt: b.updatedAt });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not make this BOM the Default.');
    }
  };

  const onDownloadTemplate = async (): Promise<void> => {
    setActionError(null);
    setTemplateBusy(true);
    try {
      await downloadMlBomTemplate();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not download the template.');
    } finally {
      setTemplateBusy(false);
    }
  };

  const onDelete = async (): Promise<void> => {
    if (!toDelete) return;
    const reason = deleteReason.trim();
    // Thrown, so ConfirmDialog shows it inside the dialog and stays open.
    if (!reason) throw new Error('Reason is required.');
    await del.mutateAsync({ id: toDelete.id, reason });
    setToDelete(null);
  };

  return (
    <div className="page-fill">
      <ListHeader
        title="Multi-Level BOM"
        count={total}
        noun="BOM"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search BOM no., item code, item name…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({ to: '/ml-boms', search: { page: 1 }, replace: true });
        }}
        filtersActive={searchInput.trim() !== '' || sf.filtering}
        tools={
          perms.entry ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                disabled={templateBusy}
                onClick={() => void onDownloadTemplate()}
              >
                {templateBusy ? 'Preparing…' : 'Template'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="upload" size={12} />}
                onClick={() => setImportOpen(true)}
              >
                Import
              </Button>
            </>
          ) : null
        }
        primary={
          perms.entry ? (
            <Link to="/ml-boms/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Multi-Level BOM
            </Link>
          ) : null
        }
      />

      {actionError ? (
        <Banner tone="error" role="alert" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load BOMs. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.mlBomList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={search || sf.filtering ? 'No BOMs match.' : 'No BOMs yet.'}
            onRowClick={(b) => void navigate({ to: '/ml-boms/$id', params: { id: b.id } })}
            renderLink={(p) => <Link {...p} />}
            rowMenu={(b) => [
              { key: 'open', label: 'Open', icon: 'eye', to: `/ml-boms/${b.id}` },
              {
                key: 'edit',
                label: 'Edit',
                icon: 'pencil',
                hidden: !perms.edit,
                to: `/ml-boms/${b.id}/edit`,
              },
              {
                key: 'default',
                label: 'Make Default',
                icon: 'check',
                group: 'workflow',
                hidden: !perms.edit || b.isDefault,
                onSelect: () => onMakeDefault(b),
              },
              {
                key: 'delete',
                label: 'Delete',
                icon: 'trash-2',
                group: 'danger',
                hidden: !(perms.edit && perms.approve),
                onSelect: () => {
                  setDeleteReason('');
                  setToDelete(b);
                },
              },
            ]}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="BOM"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {importOpen ? (
        <Suspense fallback={null}>
          <MlBomImportDialog onClose={() => setImportOpen(false)} />
        </Suspense>
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title={`Move BOM ${toDelete.code} to Trash?`}
          message={
            <>
              You can restore it from Trash.
              <span className="form-grp" style={{ display: 'block', marginTop: 10 }}>
                <label className="form-label" htmlFor="mlbom-delete-reason">
                  Reason <span className="req">★</span>
                </label>
                <textarea
                  id="mlbom-delete-reason"
                  className="innovic-input"
                  rows={3}
                  maxLength={500}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                />
              </span>
            </>
          }
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          onConfirm={onDelete}
          onCancel={() => setToDelete(null)}
        />
      ) : null}
    </div>
  );
}
