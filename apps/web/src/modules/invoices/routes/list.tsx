// Invoices list — Phase 4 migration onto the ui/ primitives.
//
// Canonical LIST composition (design-ref/README.md "Uniformity rule"):
//   TabStrip (SO ▸ JW view switch) → ListHeader(+StatStrip) → DataTable → ListFooter
//
// Behaviour is carried over unchanged from the legacy plain-table version
// (mirror of legacy renderInvoices, L21096): the same `useInvoiceList` fetch,
// the same `invoice_create` access gate, the same ?tab / ?search deep link, the
// same "money hidden for L1 viewers" column drop, the same row targets.

import type { ListInvoicesResponse } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { fmtDate } from '@/lib/date';
import { JwInvoiceView } from '@/modules/jw-invoices/components/jw-invoice-view';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatusBadge } from '@/ui/core';
import { DataTable, StatStrip, type DataTableColumn, type StatStripItem } from '@/ui/data';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useInvoiceList } from '../api';

/** Invoice status → the words the user reads; the stored codes are unchanged. */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  partial: 'Partly Paid',
  paid: 'Paid',
};

// Deep-link seed for Global Search: `?tab=jw&search=IN-JI-26-0001` opens the
// JW tab with its box pre-filled. Read ONCE into local state — tab clicks and
// typing stay local. The SO Invoices tab has no search box of its own, so
// `search` only reaches the JW view.
const searchSchema = z.object({
  tab: z.enum(['so', 'jw']).optional(),
  search: z.string().optional(),
});

export const invoiceListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'invoices',
  validateSearch: (search) => searchSchema.parse(search),
  component: InvoiceListPage,
});

type InvoiceListRow = ListInvoicesResponse['invoices'][number];

const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

const TABS = [
  { key: 'so', label: '🧾 SO Invoices' },
  { key: 'jw', label: '🔧 JW Invoices (Labour)' },
];

function InvoiceListPage(): React.JSX.Element {
  const routeSearch = invoiceListRoute.useSearch();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'so' | 'jw'>(() => routeSearch.tab ?? 'so');
  const { data, isLoading, isFetching, isError, error } = useInvoiceList();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'invoice_create');

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
        <JwInvoiceView key={routeSearch.search ?? ''} initialSearch={routeSearch.search} />
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
                label: 'Total Received',
                count: inr(s.totalReceived ?? 0),
                color: 'var(--cyan)',
              },
              {
                key: 'outstanding',
                label: 'Outstanding',
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
        { key: 'unpaid', label: 'Unpaid', count: s.unpaidCount, color: 'var(--red2)' },
        { key: 'partial', label: 'Partly Paid', count: s.partialCount, color: 'var(--amber2)' },
        { key: 'paid', label: 'Paid', count: s.paidCount, color: 'var(--green2)' },
      ]
    : [];

  const openInvoice = (id: string): void => {
    void navigate({ to: '/invoices/$id', params: { id } });
  };

  // Widths sum to 90 — DataTable's Action column takes the remaining 10.
  const moneyColumns: DataTableColumn<InvoiceListRow>[] = priceHidden
    ? []
    : [
        {
          header: 'Amount',
          width: '9%',
          align: 'right',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => (
            <span style={{ color: 'var(--green2)' }}>{inr(inv.grandTotal ?? 0)}</span>
          ),
        },
        {
          header: 'Paid',
          width: '8%',
          align: 'right',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => <span style={{ color: 'var(--cyan)' }}>{inr(inv.totalPaid ?? 0)}</span>,
        },
        {
          header: 'Outstanding Amount',
          width: '9%',
          align: 'right',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => (
            <span style={{ color: (inv.balance ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
              {inr(inv.balance ?? 0)}
            </span>
          ),
        },
      ];

  const columns: DataTableColumn<InvoiceListRow>[] = [
    {
      header: 'Sr No',
      width: '5%',
      className: 'text3',
      nowrap: true,
      render: (_inv, i) => i + 1,
    },
    {
      header: 'Invoice No.',
      width: priceHidden ? '15%' : '12%',
      className: 'td-code',
      nowrap: true,
      // Kept a real <Link> (not plain text): the code is how this list is
      // ctrl-clicked / middle-clicked open in a new tab today.
      render: (inv) => (
        <Link
          to="/invoices/$id"
          params={{ id: inv.id }}
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          {inv.code}
        </Link>
      ),
    },
    {
      header: 'Invoice Date',
      width: priceHidden ? '11%' : '8%',
      nowrap: true,
      render: (inv) => fmtDate(inv.invoiceDate),
    },
    {
      header: 'SO No.',
      width: priceHidden ? '12%' : '9%',
      className: 'td-code',
      nowrap: true,
      key: 'soCode',
    },
    {
      header: 'Customer',
      width: priceHidden ? '26%' : '12%',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      key: 'clientName',
    },
    ...moneyColumns,
    {
      header: 'Invoice Status',
      width: priceHidden ? '13%' : '11%',
      nowrap: true,
      render: (inv) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            whiteSpace: 'nowrap',
          }}
        >
          {/* kind="invoice", not "doc": the generic map paints unpaid amber and
              partial blue, which disagreed with the detail page's own colours
              for the SAME invoice. One status, one colour, both screens. */}
          <StatusBadge
            kind="invoice"
            status={inv.status}
            label={INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
          />
          {inv.overdue ? (
            <span className="fw-700" style={{ fontSize: 'var(--fs-xs)', color: 'var(--red2)' }}>
              ⚠ OVERDUE
            </span>
          ) : null}
        </span>
      ),
    },
    {
      header: 'Due Date',
      width: priceHidden ? '8%' : '7%',
      nowrap: true,
      render: (inv) => (
        <span style={{ color: inv.overdue ? 'var(--red)' : 'var(--text3)' }}>
          {fmtDate(inv.dueDate)}
        </span>
      ),
    },
  ];

  return (
    <div>
      {tabs}
      <ListHeader
        icon="📄"
        title="Invoices"
        count={data ? data.invoices.length : undefined}
        noun="invoice"
        updating={!isLoading && isFetching}
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
              columns={columns}
              rows={data?.invoices ?? []}
              loading={isLoading}
              rowKey={(inv) => inv.id}
              onRowClick={(inv) => openInvoice(inv.id)}
              empty="No invoices yet. Click + New Invoice."
              rowActions={(inv) => (
                <RowActions
                  // View is a ROUTE, so it stays a real link — ctrl-click /
                  // middle-click / "open in new tab" keep working, as they did
                  // on the legacy screen. An onView button silently lost that.
                  viewTo={`/invoices/${inv.id}`}
                  renderLink={(p) => <Link {...p} />}
                  extra={
                    perms.entry && inv.status !== 'paid' ? (
                      <Link
                        to="/invoices/$id"
                        params={{ id: inv.id }}
                        className="btn btn-ghost btn-sm"
                        title="Add payment"
                        style={{ color: 'var(--green2)' }}
                      >
                        💳 Pay
                      </Link>
                    ) : null
                  }
                />
              )}
            />
          </div>
          {data ? <ListFooter total={data.invoices.length} noun="invoice" /> : null}
        </>
      )}
    </div>
  );
}
