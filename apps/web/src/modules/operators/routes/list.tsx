// Operator Master list (UI-003-02).
// Ports legacy renderOperators (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L13699-13725) to Innovic chrome. Legacy columns, in order (L13721):
// Operator ID | Name | Department | Skills / Machines | Status | Actions.
//
// PHASE 4 — migrated onto apps/web/src/ui/ with the Client Master list
// (modules/clients/routes/list.tsx) as the reference. The composition is the
// canonical one and nothing else:
//
//   <ListHeader>            title · count · SearchInput · status filter · primary
//   <Banner>                import result (dismissible)
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · Prev / Next · Excel template / import
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the status <select>, the <table>/<colgroup>/<thead>, the loading / error /
// empty rows, the badge, the row-action buttons, the count line, the pager, the
// import notice, `confirm()` — now comes from ui/. What is left here is the
// DATA and the RULES: the query, the permission gates, the delete and the
// Excel import.
//
// What did NOT change: the route and its search params (search, status, page),
// the 300ms debounce on the URL write, normalizeSearchTerm, the 25-row server
// page, the status -> isActive mapping, perms -> canAdd/canEdit/canDelete, the
// one-request bulk import, row click -> detail, Code cell -> detail.
//
// THE ONE BEHAVIOUR THAT DID CHANGE, deliberately: Delete no longer runs on a
// browser `confirm()`. It raises the shared ConfirmDialog through RowActions,
// which owns the wait — both buttons go dead, the button reads "Moving to
// Trash…", and it closes only once the operator really is in the Trash.

import type { ListOperatorsQuery, Operator } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateOperators, useOperatorsList, useSoftDeleteOperator } from '../api';
import { downloadOperatorTemplate, parseOperatorImportFile } from '../lib/import-export';

const PAGE_SIZE = 25;

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
  page: z.coerce.number().int().positive().default(1),
});

export const operatorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators',
  validateSearch: listSearchSchema,
  component: OperatorsListPage,
});

function OperatorsListPage(): React.JSX.Element {
  const search = operatorsListRoute.useSearch();
  const navigate = operatorsListRoute.useNavigate();
  // Tier-driven, per department (operator_create sits in Production). Add/Import
  // = entry; Edit = edit; Del = the edit+approve pair only L5+ hold.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'operator_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  Ramesh   Patel " and "Ramesh Patel" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const isActiveFilter =
    search.status === 'active' ? true : search.status === 'inactive' ? false : undefined;

  const query: ListOperatorsQuery = useMemo(
    () => ({
      search: search.search,
      isActive: isActiveFilter,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, isActiveFilter, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useOperatorsList(query);
  const softDelete = useSoftDeleteOperator();

  // Excel import — the WHOLE sheet goes in one request, and the list reloads
  // once at the end.
  //
  // It used to loop the single-create mutation over the rows: one round trip per
  // operator, and because each success invalidated the list query, the browser
  // re-downloaded the entire operator master after every row — so the import got
  // slower the longer it ran. Measured on the live vendors import (same code
  // shape) at ~1 row/second, which put a 500-row sheet at about nine minutes.
  //
  // The duplicate-NAME guard moved to the server with it — name is the only key
  // the operator template gives us (it has no Code column). It used to compare
  // against `data.operators`, i.e. the page of operators currently loaded on
  // screen, so anything past that page read as "new" and was created a second
  // time.
  const bulkCreate = useBulkCreateOperators();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      const { payloads, errors } = await parseOperatorImportFile(file);
      if (payloads.length === 0) {
        setImportMsg(
          errors.length
            ? `Nothing to import. ${errors.length} row issue(s): ${fmtList(errors)}`
            : 'Nothing to import — the sheet has no operator rows.',
        );
        return;
      }
      const res = await bulkCreate.mutateAsync({ operators: payloads });
      const skips = res.skipped.map((s) => `Row ${s.index} "${s.name}": ${s.reason}`);
      setImportMsg(
        `Imported ${res.created}/${payloads.length} operator(s).` +
          (skips.length ? ` ${skips.length} skipped: ${fmtList(skips)}` : '') +
          (errors.length ? ` ${errors.length} row warning(s): ${fmtList(errors)}` : ''),
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Could not import the file. Try again.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const rows = data?.operators ?? [];
  const total = data?.total ?? 0;
  const currentPage = search.page;

  // The sheet's columns. The sheet lays out AUTO (2026-09-26 list standard):
  // only Sr No keeps a width; codes, qty and badges sit on one line and size
  // their own column, and the name columns wrap into whatever is left, so
  // nothing spills over a gridline and the Action column (1% = shrink to its
  // buttons) is never pushed off the screen. Centred by the standard; names
  // read from their left edge, numbers sit right.
  const columns = useMemo<DataTableColumn<Operator>[]>(
    () => [
      {
        header: 'Sr No',
        width: '5%',
        className: 'text3',
        // Server-paged list: the serial number continues across pages.
        render: (_op, i) => (currentPage - 1) * PAGE_SIZE + i + 1,
      },
      {
        header: 'Code',
        nowrap: true,
        // A real link, so the code can be ctrl/middle-clicked into a new tab.
        // stopPropagation sits on the link (not the cell) so clicking the rest
        // of the cell still opens the row, exactly as before.
        render: (op) => (
          <Link
            to="/operators/$id"
            params={{ id: op.id }}
            className="td-code"
            title="Open this operator"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {op.code}
          </Link>
        ),
      },
      {
        header: 'Name',
        align: 'left',
        className: 'fw-700',
        key: 'name',
      },
      {
        header: 'Department',
        className: 'text2',
        render: (op) => op.department ?? '—',
      },
      {
        header: 'Skills / Machines',
        align: 'left',
        className: 'text2',
        render: (op) => op.skills ?? '—',
        title: (op) => op.skills ?? '',
      },
      {
        header: 'Active',
        nowrap: true,
        // kind="active" — the same chip the operator DETAIL page draws, so the
        // two cannot disagree, and the same one the Client Master reference
        // list uses for a master's Active flag. The hand-written chip this
        // replaces was green / grey.
        render: (op) => <StatusBadge kind="active" status={String(op.isActive)} />,
      },
    ],
    [currentPage],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, search, the status filter and
          the primary action stay put while the rows scroll underneath. */}
      <ListHeader
        title="Operator Master"
        icon="👷"
        // Count comes from the list response's `total` — the only aggregate
        // GET /operators returns.
        count={total}
        noun="operator"
        filterNote={search.status}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search code, name, department, skills…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, search: undefined, status: undefined, page: 1 }),
            replace: true,
          });
        }}
        filtersActive={searchInput.trim() !== '' || search.status != null}
        filters={
          <Select
            aria-label="Active"
            value={search.status ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            onChange={(e) => {
              const v = e.target.value as 'active' | 'inactive' | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
          />
        }
        primary={
          canAdd ? (
            <Link to="/operators/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> Add Operator
            </Link>
          ) : null
        }
      />

      {importMsg ? (
        <Banner tone="info" onDismiss={() => setImportMsg(null)}>
          {importMsg}
        </Banner>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load operators. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            empty={
              <>
                No operators — click <strong>+ Add Operator</strong> to begin
              </>
            }
            onRowClick={(op) => void navigate({ to: '/operators/$id', params: { id: op.id } })}
            rowActionsWidth="1%"
            rowActions={(op) => (
              <RowActions
                // View and Edit are ROUTES, so they stay real links —
                // ctrl-click / middle-click still open a new tab.
                viewTo={`/operators/${op.id}`}
                editTo={canEdit ? `/operators/${op.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // The PROMISE is handed back, not swallowed: the confirm dialog
                // then owns the wait and closes only once the operator really
                // is in the Trash. An `if (softDelete.isPending) return;` here
                // would close the dialog and delete NOTHING.
                onDelete={
                  canDelete ? (): Promise<void> => softDelete.mutateAsync(op.id) : undefined
                }
                // And every OTHER row's Delete greys out while one is in
                // flight, exactly as `disabled={softDelete.isPending}` did.
                deleteDisabled={softDelete.isPending}
                deleteConfirm={{
                  title: `Move operator "${op.name}" to Trash?`,
                  message: `${op.code} — ${op.name} stops appearing in the Operator Master and in every operator picker.`,
                  confirmLabel: 'Move to Trash',
                  pendingLabel: 'Moving to Trash…',
                }}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="operator"
        // Server-paged register: `page` switches the footer to the Prev/Next
        // pager, the same one this screen drew by hand.
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })}
        // Excel template + import sit below the pager (mirror of Vendors).
        // Import creates operators, so it follows the create (entry) right.
        // The file input is hidden and only opened by the button.
        actions={
          canAdd ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                onClick={() => downloadOperatorTemplate()}
              >
                Download Excel Template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="upload" size={12} />}
                loading={importing}
                onClick={() => fileRef.current?.click()}
              >
                Import from Excel
              </Button>
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
            </>
          ) : null
        }
      />
    </div>
  );
}
