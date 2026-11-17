// Customer Dispatch list columns (ADR-199 FIT table).
// ADR-303 (owner 2026-11-16): ONE ROW PER DISPATCH again — the `docs` of
// GET /customer-dispatches/register (paged by dispatch). The locked lead block
// first (Sr No · Dispatch No. · Created On · SO No. · Internal SO No.; no POL /
// Item Code / Item Name — a dispatch has many lines), then Dispatch Date,
// Customer, Lines, Dispatch Qty (all its lines), Billed Status, Dispatched By
// and Created By. The ⋯ acts on the DISPATCH. `sortFilterField` = the server
// column map (sf-columns.ts). Excel / Print stay one row per LINE (register rows).

import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';
import type { CustomerDispatchRegisterDoc } from '@innovic/shared';

/** ADR-190 — how far the dispatch is invoiced. Labels per docs/NAMING.md. */
const BILLED_BADGE: Record<
  CustomerDispatchRegisterDoc['billedStatus'],
  { label: string; className: string }
> = {
  none: { label: 'To Bill', className: 'badge b-amber' },
  partial: { label: 'Part Billed', className: 'badge b-amber' }, // Partly … = amber (owner 2026-11-03)
  full: { label: 'Billed', className: 'badge b-green' },
};

/** Dispatch status values for the ▾ list filter (sf-columns `status`). */
const DISPATCH_STATUS_OPTIONS = [
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'cancelled', label: 'Cancelled' },
];

type Row = CustomerDispatchRegisterDoc;

export function dispatchListColumns(
  /** Sr No of the page's first row (offset + 1) — ADR-261 rev. */
  firstRowNo: number,
  /** ADR-202 — dispatch ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<Row>[] {
  return [
    ...leadColumns<Row>({
      firstRowNo,
      doc: {
        id: 'dispatch_code',
        sortFilterField: 'dispatchCode',
        header: 'Dispatch No.',
        nowrap: true,
        render: (r) => (
          <Link
            to="/customer-dispatches/$id"
            params={{ id: r.dispatchId }}
            className="td-code"
            style={{ color: 'var(--cyan)', fontWeight: 800 }}
            onClick={(e) => e.stopPropagation()}
          >
            {r.dispatchCode}
          </Link>
        ),
      },
      soNo: (r) => r.soNo,
      internalSoNo: (r) => r.soInternalNo,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          // ADR-303 — lines from more than one SO: the first SO No. + grey "+n".
          render: (r) => (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--blue)' }}>{r.soNo?.trim() || '—'}</span>
              {r.extraSoCount > 0 ? (
                <span className="text3" title="Lines from other SOs too">
                  {' '}
                  +{r.extraSoCount}
                </span>
              ) : null}
            </span>
          ),
        },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'dispatch_date',
      sortFilterField: 'dispatchDate',
      kind: 'date',
      header: 'Dispatch Date',
      className: 'mono',
      nowrap: true,
      render: (r) => fmtDate(r.date),
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (r) => r.customer ?? '—',
      title: (r) => r.customer ?? '',
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      kind: 'num',
      header: 'Lines',
      className: 'mono',
      nowrap: true,
      render: (r) => r.lineCount,
    },
    {
      id: 'dispatch_qty',
      sortFilterField: 'totalQty',
      filterType: 'num',
      kind: 'num',
      header: 'Dispatch Qty',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {r.totalQty}
        </span>
      ),
    },
    {
      id: 'billed_status',
      kind: 'badge',
      header: 'Billed Status',
      nowrap: true,
      // ADR-235 — the ▾ filters on the dispatch's own status, so Cancelled
      // dispatches can be picked out (or left out) of the register.
      sortFilterField: 'status',
      filterType: 'list',
      filterOptions: DISPATCH_STATUS_OPTIONS,
      render: (r) => {
        // ADR-202 — a pending edit overlays grey "Draft" in place of the status.
        if (draftIds?.has(r.dispatchId))
          return (
            <span className="badge b-grey" title="An edit to this document is waiting for approval">
              Draft
            </span>
          );
        if (r.status === 'cancelled') return <span className="badge b-red">Cancelled</span>;
        const billed = BILLED_BADGE[r.billedStatus];
        return <span className={billed.className}>{billed.label}</span>;
      },
    },
    {
      id: 'dispatched_by',
      sortFilterField: 'dispatchedBy',
      header: 'Dispatched By',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (r) => r.dispatchedBy ?? '—',
      title: (r) => r.dispatchedBy ?? '',
    },
    // ADR-261 rev — Created By, the last data column (the dispatch's creator).
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
