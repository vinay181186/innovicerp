// Customer Dispatch list columns (ADR-199 FIT table). One row per dispatch; the
// fit engine sizes columns to the screen and drops the rightmost unpinned ones
// into the ▸ detail row. First column (Dispatch No.) is pinned. Replaced the
// per-dispatch card (accent bar + metric strip + meta line); every field it
// showed is still here — Total Qty / Lines are columns, SO / Dispatched By are
// columns, and the item lines + Remarks moved into the ▸ expand.
// ADR-201: `sortFilterField` = the register's server column map (sf-columns.ts);
// Total Qty sorts / filters on ALL the dispatch's lines.

import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import type { DataTableColumn } from '@/ui/data';
import type { CustomerDispatchRow } from '@innovic/shared';
import type { DispatchGroup } from './dispatch-group';

/** ADR-190 — how far the dispatch is invoiced. Labels per docs/NAMING.md. */
const BILLED_BADGE: Record<
  NonNullable<CustomerDispatchRow['billedStatus']>,
  { label: string; className: string }
> = {
  none: { label: 'To Bill', className: 'badge b-amber' },
  partial: { label: 'Part Billed', className: 'badge b-blue' },
  full: { label: 'Billed', className: 'badge b-green' },
};

export function dispatchListColumns(
  billedOf: (dispatchId: string) => CustomerDispatchRow['billedStatus'],
): DataTableColumn<DispatchGroup>[] {
  return [
    {
      id: 'dispatch_code',
      sortFilterField: 'dispatchCode',
      header: 'Dispatch No.',
      nowrap: true,
      render: (g) => (
        <Link
          to="/customer-dispatches/$id"
          params={{ id: g.dispatchId }}
          className="td-code"
          style={{ color: 'var(--cyan)', fontWeight: 800 }}
          onClick={(e) => e.stopPropagation()}
        >
          {g.code}
        </Link>
      ),
    },
    {
      id: 'dispatch_date',
      sortFilterField: 'dispatchDate',
      kind: 'date',
      header: 'Dispatch Date',
      className: 'mono',
      nowrap: true,
      render: (g) => fmtDate(g.date),
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (g) => g.customer ?? '—',
      title: (g) => g.customer ?? '',
    },
    {
      id: 'so_code',
      sortFilterField: 'soCode',
      kind: 'code',
      header: 'SO No.',
      nowrap: true,
      render: (g) => (
        <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
          {g.soNo ? soNoWithInternal(g.soNo, g.soInternalNo) : '—'}
        </span>
      ),
    },
    {
      id: 'total_qty',
      sortFilterField: 'totalQty',
      kind: 'num',
      header: 'Total Qty',
      align: 'right',
      nowrap: true,
      render: (g) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {g.totalQty}
        </span>
      ),
    },
    {
      id: 'lines',
      kind: 'num',
      header: 'Lines',
      align: 'right',
      nowrap: true,
      render: (g) => <span className="mono">{g.lines.length}</span>,
    },
    {
      id: 'billed_status',
      kind: 'badge',
      header: 'Billed Status',
      nowrap: true,
      render: (g) => {
        if (g.status === 'cancelled') return <span className="badge b-grey">Cancelled</span>;
        const billed = billedOf(g.dispatchId);
        return billed ? (
          <span className={BILLED_BADGE[billed].className}>{BILLED_BADGE[billed].label}</span>
        ) : (
          <span className="text3">—</span>
        );
      },
    },
    {
      id: 'dispatched_by',
      sortFilterField: 'dispatchedBy',
      header: 'Dispatched By',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (g) => g.dispatchedBy ?? '—',
      title: (g) => g.dispatchedBy ?? '',
    },
  ];
}
