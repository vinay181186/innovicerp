// JC Operations — mirrors legacy renderJCOps (HTML L11349). The board is the
// ADR-199 fit table (DataTable + tableKey); its columns and row actions live
// in ../components/jc-ops-columns.tsx.

import { type JcOpsBoardRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { useDebounce } from '@/lib/use-debounce';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Select } from '@/ui/forms';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useJcOpsBoard } from '../api';
import {
  JC_OPS_DEFAULT_HIDDEN,
  JC_OPS_DEFAULT_PINNED,
  type JcOpsActionProps,
  jcOpsColumns,
  jcOpsRowMenu,
  renderJcOpsLink,
} from '../components/jc-ops-columns';
import { ChangeMachineModal, CreatePrModal } from '../components/jc-ops-machine-pr-modals';
import { OutsourceBalanceModal } from '../components/jc-ops-outsource-modal';
import '../jc-ops.css';

export const jcOpsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jc-ops',
  // 25 ops a page (ADR-201); the page lives in the URL.
  validateSearch: z.object({ page: pageSearchParam }),
  component: JcOpsPage,
});

function JcOpsPage(): React.JSX.Element {
  const { page } = jcOpsRoute.useSearch();
  const navigate = jcOpsRoute.useNavigate();
  const gotoPage = useCallback(
    (p: number) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  // Tier-driven, per department (jc_create sits in Production). Add Operation,
  // Change Machine and Outsource balance all rewrite a saved JC's routing → edit.
  // Create PR is a purchase action — it opens the PR create flow, so it uses the
  // SAME key as that page (pr_create entry), which the server also enforces.
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;
  const canCreatePr = effectiveFormPerms(eff, 'pr_create').entry;
  // ▶ Start / ✚ Log deep links into Op Entry — the same gate the Job Queue
  // uses for the same two links.
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const [jcCode, setJcCode] = useState('');
  // Server-side `?search=` (GET /jc-ops matches JC no., operation, item code
  // and POL). The box shows every keystroke; the query waits 300ms.
  const [searchInput, setSearchInput] = useState('');
  const searchTerm = useDebounce(searchInput.trim(), 300);
  // Any search / JC / Sort & Filter change goes back to page 1 (ADR-201).
  const lastFilters = useRef(`${jcCode}|${searchTerm}`);
  useEffect(() => {
    const key = `${jcCode}|${searchTerm}`;
    if (lastFilters.current === key) return;
    lastFilters.current = key;
    gotoPage(1);
  }, [jcCode, searchTerm, gotoPage]);
  // Sort & Filter runs on the SERVER (ADR-200): the board is paged, so a
  // filter over the loaded page alone would miss ops.
  const sf = useServerSortFilter(TABLE_KEYS.jcOpsBoard, () => gotoPage(1));
  const [editRow, setEditRow] = useState<JcOpsBoardRow | null>(null);
  const [prRow, setPrRow] = useState<JcOpsBoardRow | null>(null);
  const [outsourceRow, setOutsourceRow] = useState<JcOpsBoardRow | null>(null);
  const columns = useMemo(() => jcOpsColumns(), []);
  const actionProps: JcOpsActionProps = {
    canWrite,
    canCreatePr,
    canOpEntry,
    onEdit: setEditRow,
    onCreatePr: setPrRow,
    onOutsource: setOutsourceRow,
  };

  const { data, isLoading, isFetching, isError, error } = useJcOpsBoard({
    jcCode: jcCode || undefined,
    search: searchTerm || undefined,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, gotoPage);

  // Legacy L11400 "+ Add Operation" opened a modal to pick a JC, then added an
  // op to it. Ops are edited on the Job Card edit page, so we link there.
  // The button stays DISABLED until a JC is picked in the filter — an op
  // always belongs to one job card, so there is nothing to add it to before.
  const selectedJc = (data?.jcOptions ?? []).find((j) => j.jcCode === jcCode);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'jc_create').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view JC Operations. Ask an admin.
      </div>
    );
  }

  return (
    // `page-fill` (ADR-201): the page fills the content area and the TABLE is
    // the only thing that scrolls, so the column header can never ride off the
    // top of the screen at the last row.
    <div className="page-fill">
      <ListHeader
        title="JC Operations"
        icon="⨯"
        count={data?.total}
        noun="operation"
        filterNote={jcCode || undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search JC no., operation, item code, POL…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          setJcCode('');
          sf.clearFilters();
        }}
        filtersActive={searchInput.trim() !== '' || jcCode !== '' || sf.filtering}
        filters={
          <Select
            aria-label="Job Card"
            value={jcCode}
            onChange={(e) => setJcCode(e.target.value)}
            options={[
              { value: '', label: 'All Job Cards' },
              ...(data?.jcOptions ?? []).map((j) => ({ value: j.jcCode, label: j.jcCode })),
            ]}
          />
        }
        primary={
          canWrite ? (
            selectedJc ? (
              <Link
                to="/job-cards/$id/edit"
                params={{ id: selectedJc.jcId }}
                className="btn btn-primary"
              >
                + Add Operation
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled
                title="Pick a Job Card in the JC filter first"
              >
                + Add Operation
              </button>
            )
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load operations. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.jcOpsBoard}
            columns={columns}
            rows={data?.items ?? []}
            sortFilterServer={sf}
            rowKey={(o) => o.jcOpId}
            loading={isLoading}
            emptyText={
              sf.filtering || jcCode || searchTerm ? 'No operations match.' : 'No Operations yet.'
            }
            defaultPinned={JC_OPS_DEFAULT_PINNED}
            defaultHidden={JC_OPS_DEFAULT_HIDDEN}
            // An outsource op keeps its amber tint (jc-ops.css, solid token).
            rowClassName={(o) => (o.opType === 'outsource' ? 'jc-ops-osp-row' : undefined)}
            rowMenu={(o) => jcOpsRowMenu(o, actionProps)}
            renderLink={renderJcOpsLink}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="operation"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {editRow ? <ChangeMachineModal row={editRow} onClose={() => setEditRow(null)} /> : null}

      {prRow ? <CreatePrModal row={prRow} onClose={() => setPrRow(null)} /> : null}

      {outsourceRow ? (
        <OutsourceBalanceModal row={outsourceRow} onClose={() => setOutsourceRow(null)} />
      ) : null}
    </div>
  );
}
