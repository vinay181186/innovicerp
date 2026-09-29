// Saved Reports list — composed like every other house list (SO Master is the
// reference): ListHeader · Panel › DataTable · RowActions. It used to be a
// shadcn Card stack with its own look; the data, routes and delete call are
// unchanged. Row click runs the report (ERPNext list → open the record); Edit
// and Delete stay as row actions.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { ListHeader, PageState, RowActions } from '@/ui/layout';
import { useDeleteSavedReport, useSavedReportsList, useSourceCatalog } from '../api';

export const savedReportsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports',
  component: SavedReportsListPage,
});

function SavedReportsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useSavedReportsList();
  const { data: catalog } = useSourceCatalog();
  const deleteMutation = useDeleteSavedReport();
  const [term, setTerm] = useState('');

  // Source label ("Sales Orders"), never the raw source key.
  const sourceLabel = useMemo(
    () => new Map((catalog?.sources ?? []).map((s) => [s.sourceKey, s.label])),
    [catalog],
  );

  // Client-side search over the whole list (one fetch): name, description,
  // data source, owner.
  const rows = useMemo(
    () =>
      (data?.reports ?? []).filter((r) =>
        matchesSearchTerm(
          [r.name, r.description, sourceLabel.get(r.sourceKey) ?? r.sourceKey, r.ownerEmail],
          term,
        ),
      ),
    [data?.reports, sourceLabel, term],
  );

  const columns = useMemo<DataTableColumn<(typeof rows)[number]>[]>(
    () => [
      {
        header: 'Sr No',
        width: '5%',
        className: 'text3',
        render: (_r, i) => i + 1,
      },
      {
        header: 'Report Name',
        width: '30%',
        align: 'left',
        ellipsis: true,
        title: (r) => r.name,
        render: (r) => <span className="fw-700">{r.name}</span>,
      },
      {
        header: 'Description',
        width: '27%',
        align: 'left',
        ellipsis: true,
        className: 'text2',
        title: (r) => r.description ?? '',
        render: (r) => r.description || '—',
      },
      {
        header: 'Source',
        width: '14%',
        nowrap: true,
        render: (r) => sourceLabel.get(r.sourceKey) ?? '—',
      },
      {
        header: 'Shared',
        width: '9%',
        nowrap: true,
        render: (r) =>
          r.isShared ? (
            <span className="badge b-green">Shared</span>
          ) : (
            <span className="badge b-grey">Private</span>
          ),
      },
      {
        header: 'Owner',
        width: '15%',
        ellipsis: true,
        className: 'text3',
        title: (r) => r.ownerEmail ?? '',
        render: (r) => r.ownerEmail ?? '—',
      },
    ],
    [sourceLabel],
  );

  return (
    <div>
      <ListHeader
        title="Saved Reports"
        icon="✨"
        count={data ? rows.length : undefined}
        noun="saved report"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search report name, description, source, owner…"
        primary={
          <Link to="/saved-reports/new" className="btn btn-primary">
            <Icon name="plus" size={14} /> New Report
          </Link>
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load saved reports. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={isLoading}
            emptyText={term.trim() ? 'No Saved Reports match.' : 'No Saved Reports yet.'}
            onRowClick={(r) => void navigate({ to: '/saved-reports/$id', params: { id: r.id } })}
            rowActionsWidth="10%"
            rowActions={(r) => (
              <RowActions
                editTo={`/saved-reports/${r.id}/edit`}
                renderLink={(p) => <Link {...p} />}
                onDelete={() => deleteMutation.mutateAsync(r.id)}
                deleteDisabled={deleteMutation.isPending}
                deleteConfirm={{
                  title: `Delete saved report ${r.name}?`,
                  message: r.isShared ? 'It is removed for everyone it is shared with.' : undefined,
                  confirmLabel: 'Delete',
                  pendingLabel: 'Deleting…',
                }}
              />
            )}
          />
        </Panel>
      )}
    </div>
  );
}
