// CAPA list — the fit table's columns, row tint and ⋯ menu (ADR-199 table
// standard). Split out of capa-view.tsx so that file stays small and the sheet
// is defined in one place.
//
// One row per CAPA, every fact its own one-line column (the retired 10-column
// hand-rolled sheet is gone). The first column (CAPA No.) is always pinned and
// carries the fit table's ▸ — the row's one expand control, which reveals CAPA
// Date and Root Cause — so no chevron is drawn here. CAPA has no per-record
// route, so the CAPA No. is plain text, not a link; the row click opens the
// 5-step modal (read-only).

import type { CapaRecord } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { ROW_TINT } from '@/ui/data';

// App status colours: Open / Verified (waiting for the next step) = blue,
// In Progress = amber, Closed = green.
export function statusColor(s: string): string {
  if (s === 'Open') return 'var(--blue)';
  if (s === 'In Progress') return 'var(--amber)';
  if (s === 'Verified') return 'var(--blue)';
  if (s === 'Closed') return 'var(--green)';
  return 'var(--text3)';
}

/** Whole-row wash: a CAPA past its target date and still open (server-computed
 *  `overdue`) gets the late (red) tint. Everything else: no wash. */
export function capaRowTint(c: CapaRecord): string | undefined {
  return c.overdue ? ROW_TINT.late : undefined;
}

export function capaListColumns(): DataTableColumn<CapaRecord>[] {
  return [
    {
      id: 'capa_no',
      header: 'CAPA No.',
      nowrap: true,
      render: (c) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {c.code}
        </span>
      ),
    },
    {
      id: 'type',
      kind: 'badge',
      header: 'Type',
      nowrap: true,
      render: (c) => (
        <span className={`badge ${c.type === 'Corrective' ? 'b-red' : 'b-blue'}`}>{c.type}</span>
      ),
    },
    {
      id: 'nc_no',
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
      kind: 'text',
      header: 'Problem',
      align: 'left',
      ellipsis: true,
      render: (c) => c.problem,
      title: (c) => c.problem,
    },
    {
      id: 'responsible',
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
      kind: 'badge',
      header: 'CAPA Status',
      nowrap: true,
      render: (c) => (
        <span style={{ fontWeight: 700, color: statusColor(c.status) }}>{c.status}</span>
      ),
    },
  ];
}

/**
 * The CAPA's ⋯ menu — the retired row buttons, same gates. View is the row
 * click (not repeated here); Edit needs edit on a non-closed CAPA; Assign Task
 * is open to any user on a non-closed CAPA (ADR-176 — the server sets Assigned
 * By, so no edit gate here, matching the old inline button).
 */
export function capaRowMenu(
  c: CapaRecord,
  opts: {
    canEdit: boolean;
    onEdit: (c: CapaRecord) => void;
    onAssign: (c: CapaRecord) => void;
  },
): RowMenuItem[] {
  const { canEdit, onEdit, onAssign } = opts;
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
      hidden: c.status === 'Closed',
      onSelect: () => onAssign(c),
    },
  ];
}
