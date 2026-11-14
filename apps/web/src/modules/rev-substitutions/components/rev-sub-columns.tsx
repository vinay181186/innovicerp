// Rev Substitutions list columns (ADR-292, ADR-199 fit table). Server Sort &
// Filter fields (the /rev-substitutions sf column map): itemCode, fromLabel,
// toLabel, scopeLabel, qtyAllowed, qtyUsed, reason, approvedByName, approvedAt.

import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import type { RevSubstitutionRow } from '../api';

/** "For": the SO line / JWSO line / Job Card the substitution is limited to. */
export function scopeText(r: RevSubstitutionRow): string {
  if (r.scopeLabel) return r.scopeLabel;
  return r.salesOrderLineId ? 'SO line' : r.jobWorkOrderLineId ? 'JWSO line' : 'Job Card';
}

export function revSubColumns(offset = 0): DataTableColumn<RevSubstitutionRow>[] {
  return [
    {
      id: 'sr_no',
      kind: 'num',
      header: 'Sr No',
      className: 'mono',
      nowrap: true,
      filterable: false,
      render: (_r, i) => offset + i + 1,
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }} title={r.itemName ?? ''}>
          {r.itemCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'from_rev',
      sortFilterField: 'fromLabel',
      kind: 'code',
      header: 'Stock Drawing Rev',
      className: 'mono',
      nowrap: true,
      render: (r) => r.fromLabel,
    },
    {
      id: 'to_rev',
      sortFilterField: 'toLabel',
      kind: 'code',
      header: 'Order Drawing Rev',
      className: 'mono',
      nowrap: true,
      render: (r) => r.toLabel,
    },
    {
      id: 'scope',
      sortFilterField: 'scopeLabel',
      kind: 'code',
      header: 'For',
      className: 'mono',
      nowrap: true,
      render: (r) => scopeText(r),
    },
    {
      id: 'qty_allowed',
      sortFilterField: 'qtyAllowed',
      kind: 'num',
      header: 'Qty Allowed',
      className: 'mono',
      render: (r) => r.qtyAllowed,
    },
    {
      id: 'qty_used',
      sortFilterField: 'qtyUsed',
      kind: 'num',
      header: 'Qty Used',
      className: 'mono',
      render: (r) => r.qtyUsed,
    },
    {
      id: 'reason',
      sortFilterField: 'reason',
      kind: 'text',
      header: 'Reason',
      ellipsis: true,
      render: (r) => r.reason,
      title: (r) => r.reason,
    },
    {
      id: 'approved_by',
      sortFilterField: 'approvedByName',
      kind: 'text',
      header: 'Approved By',
      ellipsis: true,
      render: (r) => r.approvedByName ?? '—',
    },
    {
      id: 'approved_on',
      sortFilterField: 'approvedAt',
      kind: 'date',
      header: 'Approved On',
      nowrap: true,
      render: (r) => fmtDate(r.approvedAt),
    },
  ];
}
