// Invoices list — Phase 4 migration onto the ui/ primitives.
//
// Canonical LIST composition (design-ref/README.md "Uniformity rule"):
//   TabStrip (SO ▸ JW view switch) → ListHeader → DataTable → ListFooter
//   (owner 2026-11-03: no tile row above a list — the Unpaid / Partly Paid /
//   Paid counts ride in the Invoice Status ▾ tick list; the money totals went.)
//
// Behaviour is carried over unchanged from the legacy plain-table version
// (mirror of legacy renderInvoices, L21096): the same `useInvoiceList` fetch,
// the same `invoice_create` access gate, the same ?tab / ?search deep link, the
// same "money hidden for L1 viewers" column drop, the same row targets.
//
// ADR-261 (owner 2026-10-31): ONE ROW PER INVOICE LINE (GET /invoices/lines),
// locked lead block first. The status counts still count INVOICES; the row
// click and ⋯ act on the invoice.

import type { ListInvoicesQuery } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { JwInvoiceView } from '@/modules/jw-invoices/components/jw-invoice-view';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useInvoiceLineList } from '../api';
import { invoiceListColumns, type InvoiceStatusCounts } from '../components/invoice-list-columns';
import { useInvoicePrint } from '../components/use-invoice-print';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';

// Deep-link seed for Global Search: `?tab=jw&search=IN-JI-26-0001` opens the
// JW tab with its box pre-filled. Read ONCE into local state — tab clicks and
// typing stay local. `search` only reaches the JW view; the SO Invoices box
// is local and runs on the server (ADR-201).
const searchSchema = z.object({
  tab: z.enum(['so', 'jw']).optional(),
  search: z.string().optional(),
  // `?tab=jw&jw=<jwsoId>` — the JWSO detail's "JW Invoice" button: opens the
  // New JW Invoice form with that JWSO already picked.
  jw: z.string().optional(),
  // SO Invoices page (ADR-201: 25 rows a page, loaded from the server).
  page: pageSearchParam,
});

export const invoiceListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices',
  validateSearch: searchSchema,
  component: InvoiceListPage,
});

const TABS = [
  { key: 'so', label: 'SO Invoices' },
  { key: 'jw', label: 'JW Invoices (Labour)' },
];

function InvoiceListPage(): React.JSX.Element {
  const routeSearch = invoiceListRoute.useSearch();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'so' | 'jw'>(
    () => routeSearch.tab ?? (routeSearch.jw ? 'jw' : 'so'),
  );
  // ADR-201: one 25-row page from the server; search + Sort & Filter + the
  // status counts run there over EVERY invoice. Any change → page 1.
  const page = routeSearch.page;
  const gotoPage = useCallback(
    (p: number) =>
      void navigate({ to: '/invoices', search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  const [searchInput, setSearchInput] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const next = normalizeSearchTerm(searchInput);
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, term, gotoPage]);
  const sf = useServerSortFilter(TABLE_KEYS.invoicesList, () => gotoPage(1));
  const query: ListInvoicesQuery = useMemo(
    () => ({
      search: term || undefined,
      sf: sf.param,
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    }),
    [term, sf.param, page],
  );
  const { data, isLoading, isFetching, isError, error } = useInvoiceLineList(query);
  // Status counts for the Invoice Status ▾ tick list. While a status is ticked,
  // the counts come from the same list WITHOUT that filter (limit 1: only the
  // summary is read), so ticking "Unpaid" does not turn the others into "(0)".
  // With no status filter it is the very same query — no second request.
  const statusFiltered = 'status' in sf.value.filters;
  const countQuery: ListInvoicesQuery = useMemo(
    () =>
      statusFiltered
        ? { search: term || undefined, sf: sf.paramWithout('status'), limit: 1, offset: 0 }
        : query,
    [statusFiltered, term, sf, query],
  );
  const { data: countData } = useInvoiceLineList(countQuery);
  useClampPage(page, data?.total, gotoPage);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'invoice_create');
  const invoicePrint = useInvoicePrint();
  // ADR-235 — the ONE standard Cancel: Edit requests, Approve decides.
  const canCancel = perms.edit || perms.approve;
  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string } | null>(null);
  // ADR-232: Add Payment is the Entry tick on Invoices alone.

  if (eff && !perms.view) return <PageState as="page" state="noaccess" />;

  const tabs = (
    <TabStrip
      label="Invoice type"
      tabs={TABS}
      activeKey={tab}
      onChange={(k) => setTab(k === 'jw' ? 'jw' : 'so')}
    />
  );

  if (tab === 'jw') {
    return (
      <div>
        {tabs}
        {/* key: a new ?search landing while already on this page remounts the
            view so it re-seeds; nothing else changes the key. */}
        <JwInvoiceView
          key={`${routeSearch.search ?? ''}|${routeSearch.jw ?? ''}`}
          initialSearch={routeSearch.search}
          initialJwId={routeSearch.jw}
        />
      </div>
    );
  }

  // Money hidden for L1 Viewers: the API nulls the row amounts, so the
  // Amount column is dropped. Told by the server, not inferred from a null
  // money field: a null also means "no value yet", so probing it hid money
  // from users entitled to see it.
  const priceHidden = data ? !data.priceVisible : false;

  const cs = countData?.summary;
  const statusCounts: InvoiceStatusCounts | undefined = cs
    ? { unpaid: cs.unpaidCount, partial: cs.partialCount, paid: cs.paidCount }
    : undefined;

  const openInvoice = (id: string): void => {
    void navigate({ to: '/invoices/$id', params: { id } });
  };

  const columns = invoiceListColumns(pageOffset(page) + 1, priceHidden, statusCounts);

  return (
    // `page-fill` (ADR-202): the SO invoice tab fills the content area and the
    // TABLE is the only thing that scrolls, so the column header stays on
    // screen down to the last row.
    <div className="page-fill">
      {tabs}
      <ListHeader
        title="Invoices"
        count={data ? data.total : undefined}
        noun="line"
        updating={!isLoading && isFetching}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search invoice no., SO no., customer, item code, POL…"
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
        }}
        filtersActive={sf.filtering || searchInput !== ''}
        primary={
          perms.entry ? (
            <Link to="/invoices/new" className="btn btn-primary">
              + New Invoice
            </Link>
          ) : null
        }
      />

      {isError || (!isLoading && !data) ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load invoices. Try again.'}
        />
      ) : (
        <>
          {/* Was a hand-written `<div className="panel">`; it is the shared
              <Panel> now so the ADR-201 `fill` classes come from the one
              component instead of being hand-copied here. Same look: a flush,
              unpadded panel around the table. */}
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.invoicesList}
              columns={columns}
              rows={data?.rows ?? []}
              loading={isLoading}
              rowKey={(r) => r.lineId}
              onRowClick={(r) => openInvoice(r.invoiceId)}
              sortFilterServer={sf}
              empty={sf.filtering || term ? 'No Invoices match.' : 'No Invoices yet.'}
              // Row click opens the invoice (ERPNext list); the Invoice No.
              // stays a real link for ctrl-click / new tab. Add Payment opens
              // the same invoice, where the payment form lives.
              renderLink={(p) => <Link {...p} />}
              rowMenu={(r) => [
                {
                  key: 'preview',
                  label: 'Preview',
                  icon: 'eye',
                  onSelect: () => invoicePrint('preview', { id: r.invoiceId, code: r.invoiceCode }),
                },
                {
                  key: 'download',
                  label: 'Download PDF',
                  icon: 'download',
                  onSelect: () =>
                    invoicePrint('download', { id: r.invoiceId, code: r.invoiceCode }),
                },
                {
                  key: 'add-payment',
                  label: 'Add Payment',
                  to: `/invoices/${r.invoiceId}`,
                  hidden: !perms.entry,
                  disabledReason: r.invoiceStatus === 'paid' ? 'Already Paid' : undefined,
                },
                {
                  key: 'cancel',
                  label: 'Cancel Invoice',
                  icon: 'x',
                  group: 'danger',
                  hidden: !canCancel || r.invoiceStatus === 'cancelled',
                  onSelect: () => setCancelTarget({ id: r.invoiceId, code: r.invoiceCode }),
                },
              ]}
            />
          </Panel>
          {data ? (
            <ListFooter
              total={data.total}
              noun="line"
              page={page}
              pageSize={LIST_PAGE_SIZE}
              onPage={gotoPage}
            />
          ) : null}
        </>
      )}
      {cancelTarget ? (
        <CancelDocDialog
          docType="invoice"
          docId={cancelTarget.id}
          docCode={cancelTarget.code}
          onClose={() => setCancelTarget(null)}
        />
      ) : null}
    </div>
  );
}
