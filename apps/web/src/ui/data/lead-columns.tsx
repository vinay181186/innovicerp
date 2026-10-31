// LEAD COLUMNS — the owner's fixed standard (2026-10-31). Every list that
// carries an SO / JWSO line starts with these six columns, in this order:
//
//   SO No. · Internal SO No. · POL · Created On · Item Code (CODE/REV) · Item Name
//
// and every other column — the page's own number (JC No., PO No. …) included —
// comes AFTER Item Name. The table engine locks the block (`lead: true`): a
// user cannot move, hide or slip a column between them, a new column a
// developer adds lands after Item Name, and they never drop off the screen.
// The Drawing Rev is never its own column — it rides in the Item Code cell.
//
// JWSO-only lists: pass `so: 'jwso'` and no `internalSoNo` — the slot reads
// JWSO No. and the Internal SO No. column is left out (owner, 2026-10-31).
// Mixed SO + JWSO lists keep the label SO No. (NAMING.md) and show whichever
// order number the row has.
//
// Build every lead block through `leadColumns` — never hand-write one.

import type { ReactNode } from 'react';

import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';

import type { DataTableColumn } from './data-table-types';

type Text = string | null | undefined;

/** Stable layout ids of the six lead columns, in order. */
export const LEAD_COLUMN_IDS = [
  'so_no',
  'so_internal_no',
  'client_po_line_no',
  'created_on',
  'item_code',
  'item_name',
] as const;
export type LeadColumnId = (typeof LEAD_COLUMN_IDS)[number];

export interface LeadColumnSpec<T> {
  /** 'so' (default) → header "SO No."; 'jwso' → "JWSO No." (JWSO-only lists). */
  so?: 'so' | 'jwso';
  soNo: (row: T) => Text;
  /** Leave out on a JWSO-only list — that column is then not drawn. */
  internalSoNo?: ((row: T) => Text) | undefined;
  /** Leave out ONLY on a one-row-per-order summary (SO Overview, SO Costing…):
   *  an order has many POLs/items, so those columns are then not drawn. */
  pol?: ((row: T) => Text) | undefined;
  createdOn: (row: T) => Text;
  itemCode?: ((row: T) => Text) | undefined;
  itemRev?: ((row: T) => Text) | undefined;
  itemName?: ((row: T) => Text) | undefined;
  /** Per-column extras (sortFilterField, sortField, filterValue, title, render…). */
  overrides?: Partial<Record<LeadColumnId, Partial<DataTableColumn<T>>>>;
}

const dash = (v: Text): string => (v ?? '').trim() || '—';

function col<T>(
  base: DataTableColumn<T>,
  extra: Partial<DataTableColumn<T>> | undefined,
): DataTableColumn<T> {
  return { ...base, ...extra, lead: true };
}

/** The six (five on a JWSO-only list) locked lead columns. Spread them FIRST. */
export function leadColumns<T>(spec: LeadColumnSpec<T>): DataTableColumn<T>[] {
  const o = spec.overrides ?? {};
  const out: DataTableColumn<T>[] = [
    col<T>(
      {
        id: 'so_no',
        kind: 'code',
        header: spec.so === 'jwso' ? 'JWSO No.' : 'SO No.',
        className: 'mono',
        nowrap: true,
        render: (r): ReactNode => (
          <span style={{ color: 'var(--blue)' }}>{dash(spec.soNo(r))}</span>
        ),
        filterValue: (r) => spec.soNo(r) ?? '',
      },
      o.so_no,
    ),
  ];
  const internal = spec.internalSoNo;
  if (internal) {
    out.push(
      col<T>(
        {
          id: 'so_internal_no',
          kind: 'code',
          header: 'Internal SO No.',
          className: 'mono fw-700',
          nowrap: true,
          render: (r): ReactNode => (
            <span style={{ color: 'var(--text)' }}>{dash(internal(r))}</span>
          ),
          filterValue: (r) => internal(r) ?? '',
        },
        o.so_internal_no,
      ),
    );
  }
  const { pol, itemCode, itemName } = spec;
  if (pol) {
    out.push(
      col<T>(
        {
          id: 'client_po_line_no',
          kind: 'code',
          header: 'POL',
          headColor: 'var(--purple)',
          className: 'mono fw-700',
          nowrap: true,
          render: (r): ReactNode => <span style={{ color: 'var(--purple)' }}>{dash(pol(r))}</span>,
          filterValue: (r) => pol(r) ?? '',
        },
        o.client_po_line_no,
      ),
    );
  }
  out.push(
    col<T>(
      {
        id: 'created_on',
        kind: 'date',
        header: 'Created On',
        className: 'mono',
        nowrap: true,
        render: (r) => fmtDate(spec.createdOn(r) ?? null),
        filterValue: (r) => spec.createdOn(r) ?? '',
      },
      o.created_on,
    ),
  );
  if (itemCode) {
    out.push(
      col<T>(
        {
          id: 'item_code',
          kind: 'code',
          header: 'Item Code',
          className: 'td-code',
          nowrap: true,
          render: (r): ReactNode => (
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>
              {itemCodeWithRev(itemCode(r) ?? null, spec.itemRev?.(r) ?? null) || '—'}
            </span>
          ),
          filterValue: (r) => itemCode(r) ?? '',
        },
        o.item_code,
      ),
    );
  }
  if (itemName) {
    out.push(
      col<T>(
        {
          id: 'item_name',
          kind: 'text',
          header: 'Item Name',
          align: 'left',
          ellipsis: true,
          className: 'fw-700',
          render: (r) => itemName(r) ?? '',
          title: (r) => itemName(r) ?? '',
          filterValue: (r) => itemName(r) ?? '',
        },
        o.item_name,
      ),
    );
  }
  return out;
}

/** Ids of the locked block: the leading run of `lead` columns (else column 0). */
export function lockedLeadIds<T>(columns: DataTableColumn<T>[], ids: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (!columns[i]?.lead) break;
    const id = ids[i];
    if (id !== undefined) out.push(id);
  }
  if (out.length === 0 && ids[0] !== undefined) out.push(ids[0]);
  return out;
}
