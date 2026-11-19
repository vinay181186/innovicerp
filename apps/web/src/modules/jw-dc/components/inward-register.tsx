// Inward Register — processed material received back from a vendor, on the
// shared FIT DataTable (ADR-199, table standard 2026-10-01). Split out of
// routes/list.tsx.
//
// ONE ROW PER RECEIPT (ADR-303, GET /jw-dc/inward; /jw-dc/inward/lines stays
// for other readers); the ⋯ acts on the receipt as before.
//
// There is no inward detail page (only the outward DC has one, /jw-dc/$id), so
// an inward row is not clickable, and there is no under-row panel (ADR-294). A
// receipt that had rejections at Incoming QC is washed red (ROW_TINT); inward
// entries carry no return-status of their own.
//
// ADR-235 — Cancelled receipts stay on the register (includeCancelled), washed
// grey and marked Cancelled (the reason on the mark's hover); a live row's ⋯
// offers "Cancel Receipt" (the ONE standard Cancel dialog, docType 'jw_dc_inward').

import { Icon } from '@/ui/core';
import { type JwDcInwardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { OrderSfFilter } from '@/modules/order-options/components/order-sf-filter';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useJwDcInwardList } from '../api';
import { inwardColumns, isJwDcInwardCancelled } from './inward-columns';
import { jwInwardExportSpec, withInwardExportValues } from '../lib/export';

const TABLE_KEY = TABLE_KEYS.jwDcInward;

export function InwardView({
  tabs,
  initialSearch,
}: {
  /** The page's tab strip, drawn under this view's header. */
  tabs?: React.ReactNode;
  /** Seeded ONCE from the route's ?search (deep link); keystrokes stay local. */
  initialSearch?: string | undefined;
}): React.JSX.Element {
  // Same right the server checks (ADR-193): OSP Outward DC entry.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  const canWrite = perms.entry;
  // Cancel Receipt -> Edit OR Approve (ADR-235, the ONE standard Cancel): Edit
  // sends a Cancel Request, Approve decides it; the dialog's server preview
  // says which of the two this user may press.
  const canCancel = perms.edit || perms.approve;
  const [cancelRow, setCancelRow] = useState<JwDcInwardListItem | null>(null);
  // Seeded once from ?search (deep link); keystrokes stay local after that.
  const [search, setSearch] = useState(() => initialSearch ?? '');
  const [page, setPage] = useState(1);
  // The box is debounced into the server search; a new term goes to page 1.
  const [term, setTerm] = useState(() => (initialSearch ?? '').trim());
  useEffect(() => {
    const next = search.trim();
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term]);
  // Sort & Filter runs on the SERVER (ADR-200): the register is paged 25 at a
  // time, so filtering only the loaded page would miss rows. Every change goes
  // back to page 1.
  const sf = useServerSortFilter(TABLE_KEY, () => setPage(1));

  const { data, isLoading, isError, error } = useJwDcInwardList({
    search: term || undefined,
    sf: sf.param,
    // ADR-235 — Cancelled receipts stay on the register, washed and marked.
    includeCancelled: true,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  const columns = useMemo(
    () => withInwardExportValues(inwardColumns(pageOffset(page) + 1)),
    [page],
  );
  // ADR-310 — the shared Export: every receipt matching the search / Sort &
  // Filter (Cancelled included, as on screen), plus an Inward Lines sheet.
  const exportSpec = useMemo(
    () =>
      jwInwardExportSpec({
        columns,
        tableKey: TABLE_KEY,
        search: term || undefined,
        sfParam: sf.param,
        hideMoney: !perms.price,
      }),
    [columns, term, sf.param, perms.price],
  );
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · search ·
          + New Inward Entry. */}
      <ListHeader
        orderFilter={<OrderSfFilter sf={sf} field="soCode" />}
        title="Inward Register"
        icon="📥"
        count={data?.total}
        noun="receipt"
        exportSpec={exportSpec}
        search={search}
        onSearch={setSearch}
        filtersActive={sf.filtering || search !== ''}
        onClearFilters={() => {
          sf.clearFilters();
          setSearch('');
        }}
        searchPlaceholder="Search inward no, DC, vendor, vendor challan…"
        primary={
          canWrite ? (
            <Link to="/jw-dc/inward/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Inward Entry
            </Link>
          ) : null
        }
      >
        {tabs}
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load inward entries. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEY}
            sortFilterServer={sf}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(inv) => inv.id}
            loading={isLoading}
            empty={term || sf.filtering ? 'No inward entries match.' : 'No inward entries yet.'}
            // A receipt that had rejections at Incoming QC stands out red.
            rowClassName={(inv) =>
              isJwDcInwardCancelled(inv)
                ? ROW_TINT.cancelled
                : inv.totalRejectedQty > 0
                  ? ROW_TINT.late
                  : undefined
            }
            rowActionsWidth="1%"
            rowActions={(inv: JwDcInwardListItem) => (
              <RowActions
                items={[
                  {
                    key: 'cancel',
                    label: 'Cancel Receipt',
                    icon: 'x',
                    group: 'danger',
                    hidden: !canCancel || isJwDcInwardCancelled(inv),
                    onSelect: () => setCancelRow(inv),
                  },
                ]}
              />
            )}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={data.total}
          noun="receipt"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {cancelRow ? (
        <CancelDocDialog
          docType="jw_dc_inward"
          docId={cancelRow.id}
          docCode={cancelRow.code}
          onClose={() => setCancelRow(null)}
        />
      ) : null}
    </div>
  );
}
