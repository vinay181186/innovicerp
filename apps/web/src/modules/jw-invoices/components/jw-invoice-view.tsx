// JW Invoice (Labour) view — bills the processing / labour charge for a Job Work
// Order line (qty × line rate + GST from the JWSO header). NO material value:
// the client owns the material. Rendered inside the Invoices screen as a tab.
//
// Table standard 2026-10-01 (ADR-199): the register now draws on the shared FIT
// DataTable (tableKey = jwInvoices) — it always fits its width and drops the
// rightmost unpinned columns into a ▸ detail row instead of scrolling sideways.
// Columns, the ▸ expand and the New JW Invoice modal are split into sibling
// files so each clears the 400-line rule. The data, hooks, price gating,
// permissions and modals are unchanged.

import { type ListJwInvoicesQuery } from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Modal } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useJwInvoicesList } from '../api';
import { CancelJwInvoiceModal } from './cancel-jw-invoice-modal';
import { jwInvoiceColumns } from './jw-invoice-columns';
import { JwInvoiceExpand } from './jw-invoice-expand';
import { NewJwInvoiceModal } from './new-jw-invoice-modal';
import { usePrintJwInvoice } from './use-print-jw-invoice';

// ADR-201: 25 invoices a page with Prev / Next (the page lives in this tab's
// state — the tab has no route of its own). The search box and the column ▾
// Sort & Filter run on the server over the whole book; any change of them
// goes back to page 1.

// `initialSearch` — one-time seed from the host route's ?search param (Global
// Search deep link). It fills the box AND the debounced term, so the first fetch
// already carries it; typing afterwards is local and never touches the URL.
export function JwInvoiceView({
  initialSearch,
  initialJwId,
}: {
  initialSearch?: string | undefined;
  /** `?jw=<jwsoId>` from the JWSO detail "JW Invoice" button — opens the
   *  New JW Invoice form with that JWSO already picked. */
  initialJwId?: string | undefined;
}): React.JSX.Element {
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  // Raising a JW invoice needs the write role AND Finance invoice entry — the
  // same form key the SO invoice uses (the server checks both).
  // ADR-203: create and cancel use ONE key — invoice_create — on the server
  // (the write-role check was dropped there; form access is the rule).
  const invPerms = effectiveFormPerms(eff, 'invoice_create');
  const canWrite = !eff || invPerms.entry;
  const canCancel = invPerms.edit && invPerms.approve;
  const [searchInput, setSearchInput] = useState(() => initialSearch ?? '');
  const [term, setTerm] = useState(() => normalizeSearchTerm(initialSearch ?? ''));
  const [showModal, setShowModal] = useState(() => Boolean(initialJwId));
  const [page, setPage] = useState(1);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-JI  26 " and "IN-JI 26" are one query, one cache entry, one fetch.
    const next = normalizeSearchTerm(searchInput);
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, term]);
  const sf = useServerSortFilter(TABLE_KEYS.jwInvoices, () => setPage(1));

  // Search + ▾ go to the SERVER; only the page on screen is loaded.
  const query: ListJwInvoicesQuery = useMemo(
    () => ({
      ...(term ? { search: term } : {}),
      ...(sf.param ? { sf: sf.param } : {}),
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    }),
    [term, sf.param, page],
  );

  const { data, isLoading, isFetching, isError, error } = useJwInvoicesList(query);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const onPage = useCallback((p: number) => setPage(p), []);
  useClampPage(page, data?.total, onPage);

  // The invoice the Cancel dialog is asking about, or null when closed.
  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string } | null>(null);
  // ADR-197: the invoice whose History is open, or null. JW Invoice has no
  // detail page, so its History opens over the list.
  const [historyTarget, setHistoryTarget] = useState<{ id: string; code: string } | null>(null);

  // ▸ expand — caller-owned open set; the engine's ▸ toggles it.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Money hidden for L1 Viewers: the API nulls the amounts, so the Rate /
  // Taxable / GST% / GST Amt / Total columns are dropped for them.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = data ? !data.priceVisible : false;
  const columns = useMemo(() => jwInvoiceColumns(priceHidden), [priceHidden]);
  // Print: no permission gate — anyone who can see the row can print it, as on
  // the DC detail page. Money a viewer may not see is already gone from the row
  // AND the printed sheet.
  const printInvoice = usePrintJwInvoice(!priceHidden);

  return (
    <div>
      <ListHeader
        title="JW Invoices (Labour)"
        icon="🔧"
        count={total}
        noun="JW invoice"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search invoice no., date, JWSO, customer, part…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
        }}
        filtersActive={sf.filtering || searchInput !== ''}
        primary={
          canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> New Invoice
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load JW invoices. Try again.'
          }
        />
      ) : (
        // THE shared FIT table (ADR-199). First column (Invoice No.) is pinned.
        // There is no detail page for a JW invoice, so a row is not clickable;
        // the ▸ reveals Item Name / Rate / GST % / GST Amt. A cancelled invoice
        // is tinted and offers no Cancel again. The row actions — Print ·
        // History · Cancel Invoice — keep their existing permission gating.
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.jwInvoices}
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={term || sf.filtering ? 'No JW Invoices match.' : 'No JW Invoices yet.'}
            rowClassName={(r) => (r.status === 'cancelled' ? ROW_TINT.cancelled : undefined)}
            renderExpanded={(r) =>
              expanded.has(r.id) ? <JwInvoiceExpand r={r} priceHidden={priceHidden} /> : null
            }
            onToggleExpanded={(r) => toggleExpand(r.id)}
            rowMenu={(r) => [
              {
                key: 'print',
                label: 'Print',
                icon: 'printer',
                onSelect: () => printInvoice(r),
              },
              {
                key: 'history',
                label: 'History',
                icon: 'activity',
                onSelect: () => setHistoryTarget({ id: r.id, code: r.code }),
              },
              {
                // R5 (ADR-194): a cancelled invoice offers no Cancel.
                key: 'cancel',
                label: 'Cancel Invoice',
                icon: 'x',
                group: 'danger',
                hidden: !canCancel,
                disabledReason: r.status === 'cancelled' ? 'Already Cancelled' : undefined,
                onSelect: () => setCancelTarget({ id: r.id, code: r.code }),
              },
            ]}
          />
        </Panel>
      )}
      <ListFooter
        total={total}
        noun="JW invoice"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={onPage}
      />

      {showModal && canWrite ? (
        <NewJwInvoiceModal initialJwId={initialJwId} onClose={() => setShowModal(false)} />
      ) : null}
      {historyTarget ? (
        <Modal
          title={`History — ${historyTarget.code}`}
          onClose={() => setHistoryTarget(null)}
          size="lg"
        >
          <DocumentHistory
            entity="JwInvoice"
            entityId={historyTarget.id}
            refId={historyTarget.code}
          />
        </Modal>
      ) : null}
      {cancelTarget && canCancel ? (
        <CancelJwInvoiceModal
          id={cancelTarget.id}
          code={cancelTarget.code}
          onClose={() => setCancelTarget(null)}
        />
      ) : null}
    </div>
  );
}
