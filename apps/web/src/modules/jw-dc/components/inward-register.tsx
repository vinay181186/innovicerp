// Inward Register — processed material received back from a vendor, on the
// shared FIT DataTable (ADR-199, table standard 2026-10-01). Split out of
// routes/list.tsx.
//
// There is no inward detail page (only the outward DC has one, /jw-dc/$id), so
// an inward row is not clickable. The ▸ reveals Vendor Challan No., the GRN link
// and Vehicle / Remarks — everything the list row already carries, so no extra
// fetch. A receipt that had rejections at Incoming QC is washed red (ROW_TINT);
// inward entries carry no return-status of their own.

import { type JwDcInwardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useJwDcInwardList } from '../api';
import { inwardColumns } from './inward-columns';
import { NewInwardModal } from './new-inward-modal';

const PAGE_SIZE = 50;

export function InwardView({
  initialSearch,
}: {
  /** Seeded ONCE from the route's ?search (deep link); keystrokes stay local. */
  initialSearch?: string | undefined;
}): React.JSX.Element {
  // Same right the server checks (ADR-193): OSP Outward DC entry.
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'ospdc_create').entry;
  // Seeded once from ?search (deep link); keystrokes stay local after that.
  const [search, setSearch] = useState(() => initialSearch ?? '');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useJwDcInwardList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const columns = useMemo(() => inwardColumns(), []);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

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
        noun="inward entry"
        nounPlural="inward entries"
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
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
            tableKey={TABLE_KEYS.jwDcInward}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(inv) => inv.id}
            loading={isLoading}
            empty={search.trim() ? 'No inward entries match.' : 'No inward entries yet.'}
            // A receipt that had rejections at Incoming QC stands out red.
            rowClassName={(inv) => (inv.totalRejectedQty > 0 ? ROW_TINT.late : undefined)}
            renderExpanded={(inv) => (expanded.has(inv.id) ? <ExpandedInward inv={inv} /> : null)}
            onToggleExpanded={(inv) => toggleExpand(inv.id)}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={data.total}
          noun="inward entry"
          nounPlural="inward entries"
          page={page}
          pageSize={PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {showModal ? <NewInwardModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}

/** Vendor Challan No., the GRN this receipt raised, and Vehicle / Remarks —
 *  all already on the list row, so this reveal needs no extra fetch. */
function ExpandedInward({ inv }: { inv: JwDcInwardListItem }): React.JSX.Element {
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
    </div>
  );
}
