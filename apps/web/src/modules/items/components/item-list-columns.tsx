// Item Master list columns (ADR-199 fit table: one line per row, Item Code
// and Item Name split). Moved out of routes/list.tsx to keep it under 400 lines.

import {
  ITEM_PROCUREMENT_TYPES,
  ITEM_PROCUREMENT_TYPE_LABEL,
  type Item,
  UOMS,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ItemImageBox, THUMBNAIL_COL_WIDTH } from '@/components/shared/item-badge';
import { Badge, Tag } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';

// The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
// column (rowActionsWidth below): 4+8+22+24+15+7+9 = 89, + 11 = 100, so the
// table never scrolls sideways. Centred by the standard; only the item code ·
// name is left-aligned, so the code starts at the same x in every row.
// `offset` = the first row's position on this page (ADR-201 paging), so Sr No
// keeps counting across pages. `sortFilterField` = the field in the API's
// ITEM_SF_COLUMNS map (Sort & Filter runs on the server — ADR-200).
const UOM_OPTIONS = UOMS.map((u) => ({ value: u, label: u }));
const SOURCE_OPTIONS = ITEM_PROCUREMENT_TYPES.map((t) => ({
  value: t,
  label: ITEM_PROCUREMENT_TYPE_LABEL[t],
}));

export function itemListColumns(offset = 0): DataTableColumn<Item>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '4%',
      className: 'text3',
      render: (_it, i) => offset + i + 1,
    },
    {
      id: 'thumbnail',
      header: 'Thumbnail',
      filterable: false,
      width: THUMBNAIL_COL_WIDTH,
      // The picture fills its cell and has no width of its own to measure.
      minWidth: 64,
      // The picture fills the cell edge to edge, the gridlines being its
      // frame (user decision 2026-09-22). The negative margins cancel the
      // sheet's own cell padding (--sp-1 --sp-2) so the box reaches the
      // rules; `position: relative` is what `fill` pins itself to.
      // `stopRowClick` is NOT set: ItemImageBox already stops its own click,
      // and a dead cell around it should still open the row like any other.
      render: (it) => (
        <div
          style={{
            position: 'relative',
            // Exactly one row high (28px Comfortable / 22px Compact); the
            // fit table gives this cell no vertical padding, and the
            // negative side margins cancel its horizontal padding.
            height: 'calc(var(--tbl-row-h, 28px) - 1px)',
            margin: '0 calc(var(--tbl-pad-x, var(--sp-2)) * -1)',
          }}
        >
          <ItemImageBox imagePath={it.imagePath} size="row" alt={it.name} fill />
        </div>
      ),
    },
    // Item Code and Item Name are two one-line columns (table standard,
    // ADR-199: every row one line) — the code no longer stacks over the name.
    // No item-level revision, deliberately (see the header comment).
    {
      id: 'item_code',
      header: 'Item Code',
      width: '10%',
      sortFilterField: 'code',
      nowrap: true,
      render: (it) => (
        // A real link, so the code can be ctrl/middle-clicked into a new
        // tab. stopPropagation sits on the link so clicking the rest of
        // the cell still opens the row, exactly as before.
        <Link
          to="/items/$id"
          params={{ id: it.id }}
          className="td-code fw-700"
          style={{ color: 'var(--text)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {it.code}
        </Link>
      ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      sortFilterField: 'name',
      width: '12%',
      align: 'left',
      ellipsis: true,
      key: 'name',
    },
    // Description / Material are free text — clip at the column edge rather
    // than wrap, full value on hover (styling skill Rule 1's exception).
    {
      id: 'description',
      header: 'Description',
      sortFilterField: 'description',
      width: '24%',
      className: 'text2',
      ellipsis: true,
      render: (it) => it.description ?? '—',
      title: (it) => it.description ?? '',
    },
    {
      id: 'material',
      header: 'Material',
      sortFilterField: 'material',
      width: '15%',
      ellipsis: true,
      render: (it) => it.material ?? '—',
      title: (it) => it.material ?? '',
    },
    {
      id: 'uom',
      header: 'UOM',
      sortFilterField: 'uom',
      filterType: 'list',
      filterOptions: UOM_OPTIONS,
      width: '7%',
      nowrap: true,
      render: (it) => <Tag tone="neutral">{it.uom}</Tag>,
    },
    {
      id: 'procurement_type',
      kind: 'badge',
      header: 'Make / Buy',
      sortFilterField: 'procurementType',
      filterType: 'list',
      filterOptions: SOURCE_OPTIONS,
      width: '9%',
      nowrap: true,
      // ADR-171 — Buy stands out (blue), Make is the quiet default.
      render: (it) => (
        <Badge tone={it.procurementType === 'buy' ? 'blue' : 'grey'}>
          {ITEM_PROCUREMENT_TYPE_LABEL[it.procurementType]}
        </Badge>
      ),
    },
  ];
}
