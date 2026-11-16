// Outward Register — JW DC material sent out to a vendor, on the shared FIT
// DataTable (ADR-199, table standard 2026-10-01). Split out of routes/list.tsx.
//
// ONE ROW PER DC (ADR-303, GET /jw-dc/outward; /jw-dc/outward/lines stays for
// other readers). The DC No. opens the DC (/jw-dc/$id) and the ⋯ acts on it, as
// before; no under-row panel (ADR-294) — Vehicle / Remarks, a Cancelled DC's
// reason and the lines are on the DC's own page. The whole row is washed by its
// DC Status (ROW_TINT). RowActions carries View as a real link so ctrl-click
// still opens a new tab.

import { Icon } from '@/ui/core';
import { type JwDcOutwardListItem } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { OrderSfFilter } from '@/modules/order-options/components/order-sf-filter';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { useJwDcOutwardList } from '../api';
import { isJwDcCancelled, outwardColumns } from './outward-columns';
import { useJwDcPrint } from './use-jwdc-print';

const TABLE_KEY = TABLE_KEYS.jwDcOutward;

export function OutwardView({
  tabs,
  forJwId,
  initialSearch,
}: {
  /** The page's tab strip, drawn under this view's header. */
  tabs?: React.ReactNode;
  forJwId?: string | undefined;
  /** Seeded ONCE from the route's ?search (deep link); keystrokes stay local. */
  initialSearch?: string | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const jwDcPrint = useJwDcPrint();
  // Same right the server checks (ADR-193): OSP Outward DC entry.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  const canWrite = perms.entry;
  // Cancel JW DC -> Edit OR Approve (ADR-235, the ONE standard Cancel): Edit
  // sends a Cancel Request, Approve decides it; the dialog's server preview
  // says which buttons this user gets.
  const canCancel = perms.edit || perms.approve;
  const [cancelRow, setCancelRow] = useState<JwDcOutwardListItem | null>(null);
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
  // A `?jw=` landing forwards to the New Outward DC page (write access only, as
  // the + button is). replace: Back must not bounce through here again.
  useEffect(() => {
    if (forJwId && canWrite) {
      void navigate({ to: '/jw-dc/outward/new', search: { jw: forJwId }, replace: true });
    }
  }, [forJwId, canWrite, navigate]);

  const { data, isLoading, isError, error } = useJwDcOutwardList({
    search: term || undefined,
    sf: sf.param,
    // ADR-235 — Cancelled DCs stay on the register, washed and marked Cancelled.
    includeCancelled: true,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  const columns = useMemo(() => outwardColumns(pageOffset(page) + 1), [page]);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · search ·
          + New Outward DC. */}
      <ListHeader
        orderFilter={<OrderSfFilter sf={sf} field="soCode" />}
        title="Outward Register"
        icon="📤"
        count={data?.total}
        noun="DC"
        search={search}
        onSearch={setSearch}
        filtersActive={sf.filtering || search !== ''}
        onClearFilters={() => {
          sf.clearFilters();
          setSearch('');
        }}
        searchPlaceholder="Search DC, PO, vendor…"
        primary={
          canWrite ? (
            <Link to="/jw-dc/outward/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Outward DC
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
            error instanceof Error ? error.message : 'Could not load outward DCs. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEY}
            sortFilterServer={sf}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(dc) => dc.id}
            loading={isLoading}
            empty={term || sf.filtering ? 'No outward DCs match.' : 'No outward DCs yet.'}
            onRowClick={(dc) => void navigate({ to: '/jw-dc/$id', params: { id: dc.id } })}
            // Green when every unit is back, amber while a return is still
            // partial. A freshly-sent DC (nothing back yet) stays untinted.
            rowClassName={(dc) =>
              isJwDcCancelled(dc)
                ? ROW_TINT.cancelled
                : dc.returnStatus === 'fully_returned'
                  ? ROW_TINT.done
                  : dc.returnStatus === 'partial'
                    ? ROW_TINT.pending
                    : undefined
            }
            rowActionsWidth="1%"
            rowActions={(dc: JwDcOutwardListItem) => (
              <RowActions
                viewTo={`/jw-dc/${dc.id}`}
                renderLink={(p) => <Link {...p} />}
                items={[
                  {
                    key: 'preview',
                    label: 'Preview',
                    icon: 'eye',
                    onSelect: () =>
                      jwDcPrint('preview', {
                        id: dc.id,
                        code: dc.code,
                        vendorId: dc.vendorId,
                      }),
                  },
                  {
                    key: 'download',
                    label: 'Download PDF',
                    icon: 'download',
                    onSelect: () =>
                      jwDcPrint('download', {
                        id: dc.id,
                        code: dc.code,
                        vendorId: dc.vendorId,
                      }),
                  },
                  {
                    // A Cancelled DC's ⋯ offers only View / Preview / Download.
                    key: 'cancel',
                    label: 'Cancel JW DC',
                    icon: 'x',
                    group: 'danger',
                    hidden: !canCancel || isJwDcCancelled(dc),
                    onSelect: () => setCancelRow(dc),
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
          noun="DC"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {cancelRow ? (
        <CancelDocDialog
          docType="jw_dc_outward"
          docId={cancelRow.id}
          docCode={cancelRow.code}
          onClose={() => setCancelRow(null)}
        />
      ) : null}
    </div>
  );
}
