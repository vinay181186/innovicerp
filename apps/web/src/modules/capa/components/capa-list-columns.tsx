// CAPA list — the fit table's columns, row tint and ⋯ menu (ADR-199 table
// standard). Split out of capa-view.tsx so that file stays small and the sheet
// is defined in one place.
//
// One row per CAPA, every fact its own one-line column (the retired 10-column
// hand-rolled sheet is gone). The locked lead block come first (owner rule
// 2026-10-31), then CAPA No. The fit table's ▸ reveals CAPA Date and Root
// Cause — so no chevron is drawn here. CAPA has no per-record
// route, so the CAPA No. is plain text, not a link; the row click opens the
// 5-step modal (read-only).

import { CAPA_STATUSES, type CapaRecord } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { StatusBadge } from '@/ui/core';
import { createdByColumn, leadColumns, ROW_TINT } from '@/ui/data';

/** Whole-row wash: a CAPA past its target date and still open (server-computed
 *  `overdue`) gets the late (red) tint. Everything else: no wash. */
export function capaRowTint(c: CapaRecord): string | undefined {
  return c.overdue ? ROW_TINT.late : undefined;
}

/** CAPA counts per status, shown in the CAPA Status ▾ tick list as "Open (3)"
 *  (owner 2026-11-03: no tile row above a list). */
export type CapaStatusCounts = Partial<Record<string, number>>;

export function capaListColumns(
  firstRowNo: number,
  statusCounts?: CapaStatusCounts,
): DataTableColumn<CapaRecord>[] {
  return [
    // Owner rule 2026-10-31 — own number (CAPA No.) inside the lead block (after
    // Item Name). Internal SO No. / Item Name come off the CAPA's SO / item codes.
    ...leadColumns<CapaRecord>({
      firstRowNo,
      doc: {
        id: 'capa_no',
        sortFilterField: 'code',
        filterType: 'text',
        header: 'CAPA No.',
        nowrap: true,
        render: (c) => (
          <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
            {c.code}
          </span>
        ),
      },
      soNo: (c) => c.soNo,
      internalSoNo: (c) => c.soInternalNo,
      pol: (c) => c.clientPoLineNo,
      createdOn: (c) => c.createdAt,
      itemCode: (c) => c.itemCode,
      itemRev: (c) => c.itemRevision,
      itemName: (c) => c.itemName,
      overrides: {
        so_no: { sortFilterField: 'soNo', filterType: 'text' },
        so_internal_no: { sortFilterField: 'soInternalNo', filterType: 'text' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode', filterType: 'text' },
        item_name: { sortFilterField: 'itemName', filterType: 'text' },
      },
    }),
    {
      id: 'capa_date',
      sortFilterField: 'capaDate',
      kind: 'date',
      header: 'CAPA Date',
      className: 'mono',
      nowrap: true,
      render: (c) => fmtDate(c.capaDate ?? null),
      filterValue: (c) => c.capaDate ?? '',
    },
    {
      id: 'type',
      sortFilterField: 'type',
      filterOptions: [
        { value: 'Corrective', label: 'Corrective' },
        { value: 'Preventive', label: 'Preventive' },
      ],
      kind: 'badge',
      header: 'Type',
      nowrap: true,
      render: (c) => (
        <span className={`badge ${c.type === 'Corrective' ? 'b-red' : 'b-blue'}`}>{c.type}</span>
      ),
    },
    {
      id: 'nc_no',
      sortFilterField: 'ncRefs',
      filterType: 'text',
      header: 'NC No.',
      nowrap: true,
      render: (c) =>
        c.ncRefs.length > 0 ? (
          <span className="mono" style={{ color: 'var(--red2)' }}>
            {c.ncRefs.join(', ')}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'problem',
      sortFilterField: 'problem',
      kind: 'text',
      header: 'Problem',
      align: 'left',
      ellipsis: true,
      render: (c) => c.problem,
      title: (c) => c.problem,
    },
    {
      id: 'responsible',
      sortFilterField: 'responsible',
      kind: 'text',
      header: 'Responsible',
      align: 'left',
      className: 'fw-600',
      ellipsis: true,
      render: (c) => c.responsible ?? '—',
      title: (c) => c.responsible ?? '',
    },
    {
      id: 'target',
      sortFilterField: 'targetDate',
      kind: 'date',
      header: 'Target',
      className: 'mono',
      nowrap: true,
      render: (c) => {
        if (!c.targetDate) return <span className="text3">—</span>;
        return (
          <span
            style={{
              color: c.overdue ? 'var(--red)' : 'var(--text2)',
              fontWeight: c.overdue ? 700 : undefined,
            }}
          >
            {fmtDate(c.targetDate)}
            {c.overdue ? ' ⚠' : ''}
          </span>
        );
      },
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterOptions: CAPA_STATUSES.map((v) => {
        const n = statusCounts?.[v];
        return { value: v, label: n === undefined ? v : `${v} (${n})` };
      }),
      kind: 'badge',
      header: 'CAPA Status',
      nowrap: true,
      render: (c) => <StatusBadge kind="doc" status={c.status} label={c.status} />,
    },
    createdByColumn<CapaRecord>({
      createdByName: (c) => c.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}

/**
 * The CAPA's ⋯ menu — the retired row buttons, same gates. View is the row
 * click (not repeated here); Edit needs edit on a non-closed CAPA; Assign Task
 * needs the CAPA page's Advance right on a non-closed CAPA (ADR-232).
 */
export function capaRowMenu(
  c: CapaRecord,
  opts: {
    canEdit: boolean;
    canAssign: boolean;
    onEdit: (c: CapaRecord) => void;
    onAssign: (c: CapaRecord) => void;
  },
): RowMenuItem[] {
  const { canEdit, canAssign, onEdit, onAssign } = opts;
  return [
    {
      key: 'edit',
      label: 'Edit',
      icon: 'pencil',
      hidden: !canEdit || c.status === 'Closed',
      onSelect: () => onEdit(c),
    },
    {
      key: 'assign',
      label: 'Assign Task',
      icon: 'user-round',
      group: 'assign',
      hidden: !canAssign || c.status === 'Closed',
      onSelect: () => onAssign(c),
    },
  ];
}
