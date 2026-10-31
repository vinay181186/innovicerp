// Inward Register — processed material received back from a vendor, on the
// shared FIT DataTable (ADR-199, table standard 2026-10-01). Split out of
// routes/list.tsx.
//
// ONE ROW PER RECEIPT LINE (ADR-261, GET /jw-dc/inward/lines); the ⋯ acts on
// the receipt (docId) as before.
//
// There is no inward detail page (only the outward DC has one, /jw-dc/$id), so
// an inward row is not clickable. The ▸ reveals Vendor Challan No., the GRN link
// and Vehicle / Remarks — everything the list row already carries, so no extra
// fetch. A receipt that had rejections at Incoming QC is washed red (ROW_TINT);
// inward entries carry no return-status of their own.
//
// ADR-235 — Cancelled receipts stay on the register (includeCancelled), washed
// grey and marked Cancelled, the reason in the ▸; a live row's ⋯ offers
// "Cancel Receipt" (the ONE standard Cancel dialog, docType 'jw_dc_inward').

import { type JwDcInwardLineRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDateTime } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useJwDcInwardLines } from '../api';
import { inwardColumns, isJwDcInwardCancelled } from './inward-columns';
import { NewInwardModal } from './new-inward-modal';

const TABLE_KEY = TABLE_KEYS.jwDcInward;

export function InwardView({
  initialSearch,
}: {
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
  const [cancelRow, setCancelRow] = useState<JwDcInwardLineRow | null>(null);
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
  const [showModal, setShowModal] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useJwDcInwardLines({
    search: term || undefined,
    sf: sf.param,
    // ADR-235 — Cancelled receipts stay on the register, washed and marked.
    includeCancelled: true,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  const columns = useMemo(() => inwardColumns(), []);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));

  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · search ·
          + New Inward Entry. */}
      <ListHeader
        title="Inward Register"
        icon="📥"
        count={data?.total}
        noun="inward line"
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
            <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> New Inward Entry
            </button>
          ) : null
        }
      />

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
            rowKey={(inv) => inv.lineId}
            loading={isLoading}
            empty={term || sf.filtering ? 'No inward lines match.' : 'No inward entries yet.'}
            // A receipt that had rejections at Incoming QC stands out red.
            rowClassName={(inv) =>
              isJwDcInwardCancelled(inv)
                ? ROW_TINT.cancelled
                : inv.rejectedQty > 0
                  ? ROW_TINT.late
                  : undefined
            }
            renderExpanded={(inv) =>
              expanded.has(inv.lineId) ? <ExpandedInward inv={inv} /> : null
            }
            onToggleExpanded={(inv) => toggleExpand(inv.lineId)}
            rowActionsWidth="1%"
            rowActions={(inv: JwDcInwardLineRow) => (
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
          noun="inward line"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {showModal && canWrite ? <NewInwardModal onClose={() => setShowModal(false)} /> : null}

      {cancelRow ? (
        <CancelDocDialog
          docType="jw_dc_inward"
          docId={cancelRow.docId}
          docCode={cancelRow.docCode}
          onClose={() => setCancelRow(null)}
        />
      ) : null}
    </div>
  );
}

/** Vendor Challan No., the GRN this receipt raised, and Vehicle / Remarks —
 *  all already on the list row, so this reveal needs no extra fetch. */
function ExpandedInward({ inv }: { inv: JwDcInwardLineRow }): React.JSX.Element {
  return (
    <div
      className="text3"
      style={{
        padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)',
        fontSize: 'var(--fs-xs)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--sp-4)',
      }}
    >
      <span>
        <b>Vendor Challan No.:</b> {inv.vendorChallanNo ?? '—'}
      </span>
      <span>
        <b>GRN No.:</b>{' '}
        {inv.goodsReceiptNoteId && inv.grnCode ? (
          <Link
            to="/goods-receipt-notes/$id"
            params={{ id: inv.goodsReceiptNoteId }}
            style={{ color: 'var(--blue)' }}
          >
            {inv.grnCode}
          </Link>
        ) : (
          '—'
        )}
      </span>
      <span>
        <b>Vehicle No.:</b> {inv.vehicleNo ?? '—'}
      </span>
      <span>
        <b>Remarks:</b> {inv.remarks ?? '—'}
      </span>
      {/* ADR-235 — why and when a Cancelled receipt was cancelled. */}
      {isJwDcInwardCancelled(inv) ? (
        <span style={{ color: 'var(--red2)' }}>
          <b>Reason:</b> {inv.cancelReason ?? '—'}
          {inv.cancelledAt ? ` · Cancelled ${fmtDateTime(inv.cancelledAt)}` : ''}
        </span>
      ) : null}
    </div>
  );
}
