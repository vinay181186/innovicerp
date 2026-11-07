// LEAD COLUMNS — the owner's fixed standard (ADR-261, revised 2026-11-02).
// Every list that carries an SO / JWSO line starts with this LOCKED block:
//
//   Sr No · SO No. · Internal SO No. · POL · Item Code (CODE/REV) · Item Name · own No. · Created On · Created Time
//
// Sr No is the row counter (1, 2, 3 … continuing across server pages). The
// page's own number (PO No., JC No. …) and the entry date (Created On =
// <table>.created_at, set by the system at Save) close the block. The own
// document date (PO Date, JC Date …) is NOT locked — it is an ordinary column
// after the block. Created Time sits right after Created On (owner 2026-11-03),
// headings on two lines ("Created / On", "Created / Time") so both columns stay
// narrow; the time is the India-time 12-hour clock (02:35 PM), same size as the
// date, never a hover. Created By (`createdByColumn`) goes at the END, shown by
// default, movable / hideable.
//
// The table engine locks the block (`lead: true`): a user cannot move, hide or
// slip a column between them, a new column a developer adds lands after the
// block, and they never drop off the screen. The Drawing Rev is never its own
// column — it rides in the Item Code cell.
//
// One exception (ADR-286, reverses "always shown" of 2026-11-03): Created On and
// Created Time (`leadHideable: true`) are shown by default in their fixed place,
// but each user may hide them in Columns ▾ (saved per user; Reset to default
// brings them back). They still cannot be moved or pinned.
//
// JWSO-only lists: pass `so: 'jwso'` and no `internalSoNo` — the slot reads
// JWSO No. and the Internal SO No. column is left out (owner, 2026-10-31).
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

/** Stable layout ids of the built-in lead columns, in order (the own `doc`
 *  column keeps its own id and sits between item_name and created_on). */
export const LEAD_COLUMN_IDS = [
  'sr_no',
  'so_no',
  'so_internal_no',
  'client_po_line_no',
  'item_code',
  'item_name',
  'created_on',
  'created_time',
] as const;
export type LeadColumnId = (typeof LEAD_COLUMN_IDS)[number];

export interface LeadColumnSpec<T> {
  /** Sr No of this page's FIRST row (server offset + 1; 1 on an unpaged list),
   *  so the counter continues across pages. */
  firstRowNo: number;
  /** The page's OWN document number column (Plan No., JC No., GRN No. …),
   *  locked after Item Name, before Created On (owner 2026-11-02). Must carry an
   *  `id`. Leave out only where the row IS the SO / JWSO (SO list, SO Overview …)
   *  — there SO No. is the own number. The own DATE is an ordinary column. */
  doc?: DataTableColumn<T> | undefined;
  /** 'so' (default) → header "SO No."; 'jwso' → "JWSO No." (JWSO-only lists);
   *  'mixed' → "SO No. / JWSO No." (the row shows whichever order it has). */
  so?: 'so' | 'jwso' | 'mixed';
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

/** The locked lead block (Sr No · SO No. · [Internal SO No.] · [POL] · [Item Code] ·
 *  [Item Name] · [own No.] · Created On · Created Time). Spread it FIRST; spread
 *  `createdByColumn` LAST. */
export function leadColumns<T>(spec: LeadColumnSpec<T>): DataTableColumn<T>[] {
  const o = spec.overrides ?? {};
  const out: DataTableColumn<T>[] = [];
  const firstRowNo = spec.firstRowNo;
  out.push(
    col<T>(
      {
        id: 'sr_no',
        kind: 'num',
        header: 'Sr No',
        className: 'mono',
        nowrap: true,
        filterable: false,
        render: (_r, i) => firstRowNo + i,
      },
      o.sr_no,
    ),
  );
  out.push(
    col<T>(
      {
        id: 'so_no',
        kind: 'code',
        header:
          spec.so === 'mixed' ? 'SO No. / JWSO No.' : spec.so === 'jwso' ? 'JWSO No.' : 'SO No.',
        className: 'mono',
        nowrap: true,
        render: (r): ReactNode => (
          <span style={{ color: 'var(--blue)' }}>{dash(spec.soNo(r))}</span>
        ),
        filterValue: (r) => spec.soNo(r) ?? '',
      },
      o.so_no,
    ),
  );
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
  if (spec.doc) out.push({ ...spec.doc, lead: true });
  out.push(
    col<T>(
      {
        id: 'created_on',
        leadHideable: true,
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
        render: (r) => fmtDate(spec.createdOn(r) ?? null),
        filterValue: (r) => spec.createdOn(r) ?? '',
      },
      o.created_on,
    ),
  );
  // Created Time: fixed right after Created On (owner 2026-11-03), shown by
  // default, the user may hide it (ADR-286). Same created_at as Created On, as
  // the India-time 12-hour clock.
  // Sorted / filtered through Created On (same created_at) — no ▾ of its own.
  out.push(
    col<T>(
      {
        id: 'created_time',
        leadHideable: true,
        kind: 'code',
        header: (
          <>
            Created
            <br />
            Time
          </>
        ),
        label: 'Created Time',
        className: 'mono',
        nowrap: true,
        filterable: false,
        render: (r) => fmtTime12(spec.createdOn(r) ?? null, '—'),
      },
      o.created_time,
    ),
  );
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
