// Drawing Register (ADR-290, SOP INN-ERP-SOP-ENG-001 §4) — every Item +
// Drawing Rev ("ABC/1") with its release status. Design sends a Rev for
// review, the Drawing Register approver approves / rejects it, a person with
// the Drawing Release switch releases it; only then may Plan, PRO and Job
// Card use it. The row ⋯ offers only what this user may do and the status
// allows; the server checks every action again (409 when someone acted first).
//
// ADR-201: 25 rows a page from the server. Search (URL `search`, debounced,
// back to page 1), the Drawing Rev Status filter and the column ▾ Sort &
// Filter all run on the server and narrow together.

import {
  REV_RELEASE_STATUSES,
  REV_RELEASE_STATUS_LABELS,
  type DrawingRegisterRow,
  type RevReleaseStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useDrawingRegister } from '../api';
import { drawingRegisterExportSpec, withRegisterExportValues } from '../lib/export';
import {
  drawingRegisterColumns,
  drawingRegisterRowMenu,
  registerRowTarget,
} from '../components/drawing-register-columns';
import { NewDrawingRevDialog } from '../components/new-drawing-rev-dialog';
import { ReplaceDrawingDialog } from '../components/replace-drawing-dialog';
import {
  RevActionDialog,
  useRevActionRights,
  type RevActionChoice,
} from '../components/rev-status-actions';

export const drawingRegisterRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'drawing-register',
  validateSearch: z.object({
    page: pageSearchParam,
    search: z.string().optional().catch(undefined),
    status: z.enum(REV_RELEASE_STATUSES).optional().catch(undefined),
  }),
  component: DrawingRegisterPage,
});

function DrawingRegisterPage(): React.JSX.Element {
  const navigate = drawingRegisterRoute.useNavigate();
  const { page, search: term, status } = drawingRegisterRoute.useSearch();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'drawingreg_create');
  const rights = useRevActionRights();
  const [input, setInput] = useState(term ?? '');
  const [acting, setActing] = useState<{ row: DrawingRegisterRow; choice: RevActionChoice } | null>(
    null,
  );
  const [replacing, setReplacing] = useState<DrawingRegisterRow | null>(null);
  const [adding, setAdding] = useState(false);

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  // Back / refresh brings a different term: the box follows the URL.
  useEffect(() => {
    setInput(term ?? '');
  }, [term]);
  // Debounced box → URL; a new term goes back to page 1.
  useEffect(() => {
    const trimmed = normalizeSearchTerm(input);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === term) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [input, term, navigate]);
  const sf = useServerSortFilter(TABLE_KEYS.drawingRegister, () => gotoPage(1));

  const { data, isLoading, isFetching, isError, error } = useDrawingRegister({
    search: term,
    status,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, gotoPage);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const columns = withRegisterExportValues(drawingRegisterColumns(pageOffset(page) + 1));
  // ADR-310 — the shared Export: every Drawing Rev matching the search /
  // status / column filters (the same query as the list).
  const exportSpec = drawingRegisterExportSpec({
    columns,
    tableKey: TABLE_KEYS.drawingRegister,
    search: term,
    status,
    sfParam: sf.param,
  });
  const filtering = Boolean(term) || Boolean(status) || sf.filtering;

  // "Hide page": no View → the no-access panel. `eff` undefined only while
  // access loads — don't block then.
  if (eff && !perms.view) {
    return (
      <PageState
        as="page"
        state="noaccess"
        message="You do not have permission to view the Drawing Register. Ask an admin."
      />
    );
  }

  return (
    <div className="page-fill">
      <ListHeader
        title="Drawing Register"
        icon="📐"
        count={total}
        noun="Drawing Rev"
        filterNote={status ? REV_RELEASE_STATUS_LABELS[status] : undefined}
        search={input}
        onSearch={setInput}
        searchPlaceholder="Search item code, item name, customer part no., drawing no.…"
        updating={isFetching && !isLoading}
        exportSpec={exportSpec}
        filters={
          <Select
            aria-label="Drawing Rev Status"
            value={status ?? ''}
            onChange={(e) => {
              const v = e.target.value as RevReleaseStatus | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v || undefined, page: 1 }),
                replace: true,
              });
            }}
            options={[
              { value: '', label: 'All Drawing Rev Status' },
              ...REV_RELEASE_STATUSES.map((s) => ({
                value: s,
                label: REV_RELEASE_STATUS_LABELS[s],
              })),
            ]}
          />
        }
        onClearFilters={() => {
          setInput('');
          sf.clearFilters();
          void navigate({ search: { page: 1 }, replace: true });
        }}
        filtersActive={filtering}
        primary={
          perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              + New Drawing Rev
            </button>
          ) : undefined
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error
              ? error.message
              : 'Could not load the Drawing Register. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable<DrawingRegisterRow>
            tableKey={TABLE_KEYS.drawingRegister}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            empty={filtering ? 'No Drawing Revs match.' : 'No Drawing Revs yet.'}
            onRowClick={(r) =>
              void navigate({ to: '/drawings/$itemRevisionId', params: { itemRevisionId: r.id } })
            }
            rowMenu={(r) =>
              drawingRegisterRowMenu(r, {
                rights,
                onAction: (row, choice) => setActing({ row, choice }),
                onReplace: setReplacing,
              })
            }
            rowMenuLabel={(r) => `Actions for ${r.label}`}
            renderLink={(p) => <Link {...p} />}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="Drawing Rev"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {acting ? (
        <RevActionDialog
          target={registerRowTarget(acting.row)}
          action={acting.choice.action}
          onClose={() => setActing(null)}
        />
      ) : null}
      {adding ? (
        <NewDrawingRevDialog
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            void navigate({
              to: '/drawings/$itemRevisionId',
              params: { itemRevisionId: created.id },
            });
          }}
        />
      ) : null}
      {replacing ? (
        <ReplaceDrawingDialog
          revision={replacing}
          firstFile={!replacing.hasFile}
          onCancel={() => setReplacing(null)}
          onDone={() => setReplacing(null)}
        />
      ) : null}
    </div>
  );
}
