// LEAD COLUMNS — the owner's fixed standard (ADR-261, revised 2026-11-15).
// Every list that carries an SO / JWSO line starts with this LOCKED block:
//
//   Sr No · own No. · Created On (time under it) · SO No. · POL · Item Code (CODE/REV) · Item Name
//
// Sr No is the row counter (1, 2, 3 … continuing across server pages). The
// page's own number (PO No., JC No. …) and the entry date (Created On =
// <table>.created_at, set by the system at Save) come right after it; a list
// whose row IS the order has no own No., so SO No. takes that slot. The own
// document date (PO Date, JC Date …) is NOT locked — it is an ordinary column
// after the block. There is no Created Time column any more (owner 2026-11-15):
// the India-time 12-hour clock (02:35 PM) sits under the date in small grey
// text, never a hover, and has no sort of its own. Created By
// (`createdByColumn`) goes at the END, shown by default, movable / hideable.
//
// The table engine locks the block (`lead: true`): a user cannot move, hide or
// slip a column between them, a new column a developer adds lands after the
// block, and they never drop off the screen. The Drawing Rev is never its own
// column — it rides in the Item Code cell.
//
// One exception (ADR-286): Created On (`leadHideable: true`) is shown by default
// in its fixed place, but each user may hide it in Columns ▾ (saved per user;
// Reset to default brings it back). It still cannot be moved or pinned.
//
// ONE SO number (ADR-306, owner 17-11-2026): the Internal SO No. column is gone;
// the office's own number IS the SO No. now.
// JWSO-only lists: pass `so: 'jwso'` — the slot reads JWSO No.
// Mixed SO + JWSO lists keep the label SO No. (NAMING.md) and show whichever
// order number the row has; a list the owner has renamed passes `so: 'mixed'`
// for the heading SO No. / JWSO No. (NC Register, ADR-276). Rows that ARE the
// order (SO list …) pass no `doc`.
//
// Build every lead block through `leadColumns` — never hand-write one.

import { shortName } from '@innovic/shared';
import type { ReactNode } from 'react';

import { fmtDate, fmtTime12 } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';

import type { DataTableColumn } from './data-table-types';

type Text = string | null | undefined;

/** Stable layout ids of the built-in lead columns, in order for a list whose
 *  row IS the order (no own No.). With an own `doc` column (its own id) the
 *  order is sr_no · doc · created_on · so_no · …: SO No. steps after Created On. */
export const LEAD_COLUMN_IDS = [
  'sr_no',
  'so_no',
  'created_on',
  'client_po_line_no',
  'item_code',
  'item_name',
] as const;
export type LeadColumnId = (typeof LEAD_COLUMN_IDS)[number];

export interface LeadColumnSpec<T> {
  /** Sr No of this page's FIRST row (server offset + 1; 1 on an unpaged list),
   *  so the counter continues across pages. */
  firstRowNo: number;
  /** The page's OWN document number column (Plan No., JC No., GRN No. …),
   *  locked right after Sr No, before Created On (owner 2026-11-15). Must carry
   *  an `id`. Leave out only where the row IS the SO / JWSO (SO list, SO
   *  Overview …) — there SO No. is the own number and takes this slot. The own
   *  DATE is an ordinary column. */
  doc?: DataTableColumn<T> | undefined;
  /** 'so' (default) → header "SO No."; 'jwso' → "JWSO No." (JWSO-only lists);
   *  'mixed' → "SO No. / JWSO No." (the row shows whichever order it has). */
  so?: 'so' | 'jwso' | 'mixed';
  soNo: (row: T) => Text;
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

/** Sr No — the row counter, always the FIRST column of every list (owner
 *  2026-11-15). `firstRowNo` = this page's first row (server offset + 1; 1 on
 *  an unpaged list), so the count continues across pages. Build it here —
 *  never hand-write one. */
export function srNoColumn<T>(
  firstRowNo: number,
  extra?: Partial<DataTableColumn<T>>,
): DataTableColumn<T> {
  return {
    id: 'sr_no',
    kind: 'num',
    header: 'Sr No',
    className: 'mono',
    nowrap: true,
    filterable: false,
    render: (_r, i) => firstRowNo + i,
    ...extra,
  };
}

/** The Created On cell: the date, and under it the India-time clock in small
 *  grey text (owner 2026-11-15). A bare calendar date shows the date alone. */
export function CreatedOnCell({ value }: { value: Text }): React.JSX.Element {
  const time = fmtTime12(value ?? null, '');
  return (
    <span style={{ display: 'inline-block', lineHeight: 1.2 }}>
      {fmtDate(value ?? null)}
      {time ? (
        <span style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
          {time}
        </span>
      ) : null}
    </span>
  );
}

/** Created On — the date with the time under it. Sorted / filtered on the date
 *  only; the time has no ▾ of its own. Build it here — never hand-write one. */
export function createdOnColumn<T>(
  createdOn: (row: T) => Text,
  extra?: Partial<DataTableColumn<T>>,
): DataTableColumn<T> {
  return {
    id: 'created_on',
    kind: 'date',
    // Two lines so the column is only as wide as "Created" (owner 2026-11-03).
    header: (
      <>
        Created
        <br />
        On
      </>
    ),
    label: 'Created On',
    className: 'mono',
    nowrap: true,
    // Called as a function (not <CreatedOnCell/>) so the cell's text children are
    // readable to the fit measure and Sort & Filter word reader.
    render: (r) => CreatedOnCell({ value: createdOn(r) }),
    filterValue: (r) => createdOn(r) ?? '',
    ...extra,
  };
}

/** The locked lead block (Sr No · [own No.] · Created On · SO No. · [POL] · [Item Code] · [Item Name]; with no own No., SO No. comes before
 *  Created On). Spread it FIRST; spread `createdByColumn` LAST. */
export function leadColumns<T>(spec: LeadColumnSpec<T>): DataTableColumn<T>[] {
  const o = spec.overrides ?? {};
  const out: DataTableColumn<T>[] = [];
  out.push(col<T>(srNoColumn<T>(spec.firstRowNo), o.sr_no));
  const soCol = col<T>(
    {
      id: 'so_no',
      kind: 'code',
      header:
        spec.so === 'mixed' ? 'SO No. / JWSO No.' : spec.so === 'jwso' ? 'JWSO No.' : 'SO No.',
      className: 'mono',
      nowrap: true,
      render: (r): ReactNode => <span style={{ color: 'var(--blue)' }}>{dash(spec.soNo(r))}</span>,
      filterValue: (r) => spec.soNo(r) ?? '',
    },
    o.so_no,
  );
  // The own number sits right after Sr No; where the row IS the order, SO No. does.
  out.push(spec.doc ? { ...spec.doc, lead: true } : soCol);
  out.push(col<T>(createdOnColumn<T>(spec.createdOn, { leadHideable: true }), o.created_on));
  if (spec.doc) out.push(soCol);
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

export interface CreatedByColumnSpec<T> {
  /** The created_by of the SAME record whose created_at feeds Created On
   *  (line, else header): the server's createdByName (full name, else email).
   *  Shown through the shared `shortName` rule ("Jinal R."). */
  createdByName: (row: T) => Text;
  overrides?: Partial<DataTableColumn<T>>;
}

/** Created By — spread LAST on every list that uses `leadColumns` (owner
 *  2026-11-02). An ordinary column: shown by default, movable, hideable. */
export function createdByColumn<T>(spec: CreatedByColumnSpec<T>): DataTableColumn<T> {
  return {
    id: 'created_by',
    kind: 'text',
    header: 'Created By',
    align: 'left',
    nowrap: true,
    render: (r) => dash(shortName(spec.createdByName(r) ?? '')),
    title: (r) => spec.createdByName(r) ?? '',
    filterValue: (r) => spec.createdByName(r) ?? '',
    ...spec.overrides,
  };
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
