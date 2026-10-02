// Invoices list — Phase 4 migration onto the ui/ primitives.
//
// Canonical LIST composition (design-ref/README.md "Uniformity rule"):
//   TabStrip (SO ▸ JW view switch) → ListHeader(+StatStrip) → DataTable → ListFooter
//
// Behaviour is carried over unchanged from the legacy plain-table version
// (mirror of legacy renderInvoices, L21096): the same `useInvoiceList` fetch,
// the same `invoice_create` access gate, the same ?tab / ?search deep link, the
// same "money hidden for L1 viewers" column drop, the same row targets.

import type { ListInvoicesQuery } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { JwInvoiceView } from '@/modules/jw-invoices/components/jw-invoice-view';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, StatStrip, type StatStripItem } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useInvoiceList } from '../api';
import { invoiceListColumns } from '../components/invoice-list-columns';

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

const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

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
  // stat strip run there over EVERY invoice. Any change → page 1.
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
  const { data, isLoading, isFetching, isError, error } = useInvoiceList(query);
  useClampPage(page, data?.total, gotoPage);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'invoice_create');
  // The server takes a payment from role admin / manager only (on top of the
  // invoice_create entry right), so other roles see Add Payment greyed.
  const { data: me } = useSession();
  const isWriteRole = me?.role === 'admin' || me?.role === 'manager';

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

  const s = data?.summary;
  // Money hidden for L1 Viewers: the API nulls the summary + row amounts, so the
  // money stats and the Amount/Paid/Balance columns are dropped (counts stay).
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = data ? !data.priceVisible : false;

  // Legacy L21139-21145 rendered these as 7 separate .panel cards. Counts above
  // a list are ONE StatStrip (design-ref README, "Uniformity rule"); OVERDUE
  // keeps its "N inv" sub-line (server-supplied count — never computed here).
  // None of them filters the list today, so every cell is a plain total: no
  // `onClick`, so StatStrip renders a <div> and announces nothing clickable.
  const stats: StatStripItem[] = s
    ? [
        ...(priceHidden
          ? []
          : [
              {
                key: 'invoiced',
                label: 'Total Invoiced',
                count: inr(s.totalInvoiced ?? 0),
                color: 'var(--green2)',
              },
              {
                key: 'received',
                label: 'Paid Amount',
                count: inr(s.totalReceived ?? 0),
                color: 'var(--cyan)',
              },
              {
                key: 'outstanding',
                label: 'Outstanding Amount',
                count: inr(s.outstanding ?? 0),
                color: 'var(--amber2)',
              },
              {
                key: 'overdue',
                label: 'Overdue',
                count: inr(s.overdueAmount ?? 0),
                color: 'var(--red2)',
                sub: <span style={{ color: 'var(--red2)' }}>{s.overdueCount} inv</span>,
              },
            ]),
        { key: 'unpaid', label: 'Unpaid', count: s.unpaidCount, color: 'var(--red2)', sub: 'inv' },
        {
          key: 'partial',
          label: 'Partly Paid',
          count: s.partialCount,
          color: 'var(--amber2)',
          sub: 'inv',
        },
        { key: 'paid', label: 'Paid', count: s.paidCount, color: 'var(--green2)', sub: 'inv' },
      ]
    : [];

  const openInvoice = (id: string): void => {
    void navigate({ to: '/invoices/$id', params: { id } });
  };

  const columns = invoiceListColumns(priceHidden);

  return (
    <div>
      {tabs}
      <ListHeader
        title="Invoices"
        count={data ? data.total : undefined}
        noun="invoice"
        updating={!isLoading && isFetching}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search invoice no., SO no., customer…"
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
      >
        {stats.length > 0 ? <StatStrip items={stats} /> : null}
      </ListHeader>

      {isError || (!isLoading && !data) ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load invoices. Try again.'}
        />
      ) : (
        <>
          <div className="panel">
            <DataTable
              tableKey={TABLE_KEYS.invoicesList}
              columns={columns}
              rows={data?.invoices ?? []}
              loading={isLoading}
              rowKey={(inv) => inv.id}
              onRowClick={(inv) => openInvoice(inv.id)}
              sortFilterServer={sf}
              empty={sf.filtering || term ? 'No Invoices match.' : 'No Invoices yet.'}
              // Row click opens the invoice (ERPNext list); the Invoice No.
              // stays a real link for ctrl-click / new tab. Add Payment opens
              // the same invoice, where the payment form lives.
              renderLink={(p) => <Link {...p} />}
              rowMenu={(inv) => [
                {
                  key: 'add-payment',
                  label: 'Add Payment',
                  to: `/invoices/${inv.id}`,
                  hidden: !perms.entry,
                  disabledReason:
                    inv.status === 'paid'
                      ? 'Already Paid'
                      : !isWriteRole
                        ? 'Needs admin or manager role'
                        : undefined,
                },
              ]}
            />
          </div>
          {data ? (
            <ListFooter
              total={data.total}
              noun="invoice"
              page={page}
              pageSize={LIST_PAGE_SIZE}
              onPage={gotoPage}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
