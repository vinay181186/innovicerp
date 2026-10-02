// Trash list columns (ADR-199 fit table: one line per row) + the on-screen
// type labels. Moved out of routes/list.tsx so the route file stays lean and
// the table joins the one shared DataTable standard.
//
// First column is the Document (its code / name), as the owner's table standard
// wants — doc no. first, pinned. The per-row Restore is drawn by DataTable's ⋯
// rowMenu, not a column here.

import { fmtDateTime } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import type { TrashEntityType, TrashListItem } from '../api';

export const TYPE_OPTIONS: readonly TrashEntityType[] = [
  'Sales Order',
  'Job Work Order',
  'Job Card',
  'Item',
  'Client',
  'Vendor',
  'Machine',
  'Operator',
  'Purchase Request',
  'Purchase Order',
  'Goods Receipt Note',
  'Delivery Challan',
  'NC Register',
  'BOM Master',
  'Route Card',
  'Cost Center',
  'QC Process',
  'Production Order',
];

// On-screen names for the type codes above. The codes themselves are what the
// API filters on and stay as they are; only the words the user reads change
// (Customer, never Client; Cost Centre spelling; JWSO's full name).
const TYPE_LABEL: Partial<Record<TrashEntityType, string>> = {
  'Job Work Order': 'Job Work Sales Order',
  Client: 'Customer',
  'Cost Center': 'Cost Centre',
};

export function typeLabel(t: TrashEntityType): string {
  return TYPE_LABEL[t] ?? t;
}

// Sort & Filter tick list (ADR-200): the stored type code + the word shown.
const TYPE_FILTER_OPTIONS = TYPE_OPTIONS.map((t) => ({ value: t, label: typeLabel(t) }));

export function trashColumns(): DataTableColumn<TrashListItem>[] {
  return [
    {
      id: 'document',
      sortFilterField: 'document',
      filterType: 'text',
      kind: 'code',
      header: 'Document',
      className: 'fw-700',
      render: (it) => it.label,
    },
    {
      id: 'type',
      sortFilterField: 'type',
      filterOptions: TYPE_FILTER_OPTIONS,
      kind: 'badge',
      header: 'Document Type',
      render: (it) => <span className="badge b-grey">{typeLabel(it.type)}</span>,
      filterValue: (it) => typeLabel(it.type),
    },
    {
      id: 'deleted_by',
      sortFilterField: 'deletedBy',
      kind: 'text',
      header: 'Deleted By',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (it) => it.deletedByName ?? '—',
      title: (it) => it.deletedByName ?? '',
    },
    {
      id: 'deleted_at',
      sortFilterField: 'deletedAt',
      kind: 'date',
      header: 'Deleted At',
      className: 'text3',
      render: (it) => fmtDateTime(it.deletedAt),
      filterValue: (it) => it.deletedAt,
    },
  ];
}
