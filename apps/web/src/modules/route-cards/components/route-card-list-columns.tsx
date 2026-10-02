// Route Card list columns (ADR-199 fit table). Moved out of routes/list.tsx
// to keep that file under 400 lines. `sortFilterField` = the field in the
// endpoint's Sort & Filter column map (apps/api/.../route-cards/sf-columns.ts).

import type { RouteCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

// The sheet's columns. The sheet lays out AUTO (2026-09-26 list standard):
// only Sr No keeps a width; codes, revs, counts and dates sit on one line
// and Item Name wraps into what is left. Centred by the standard; only Item
// Name is left-aligned, the op count sits right.
// Sr No counts on from the page's offset (25 rows a page, ADR-201).
export function routeCardListColumns(offset = 0): DataTableColumn<RouteCardListItem>[] {
  return [
    {
      id: 'sr_no',
      header: 'Sr No',
      width: '4%',
      className: 'text3',
      render: (_rc, i) => offset + i + 1,
    },
    {
      id: 'code',
      sortFilterField: 'code',
      header: 'RC No.',
      nowrap: true,
      // The op sequence opens from the fit table's ▸ (the row's ONE expand
      // control, ADR-199) — no chevron of its own, so hiding or dropping
      // this column can never take the op sequence away.
      render: (rc) => (
        <Link
          to="/route-cards/$id"
          params={{ id: rc.id }}
          className="td-code"
          title="Open this route card"
          // stopPropagation on the link, not the cell, so clicking the rest
          // of the cell still opens the row.
          onClick={(e) => e.stopPropagation()}
        >
          {rc.code}
        </Link>
      ),
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      // The item code is the main thing on this row: mono, bold, full --text.
      className: 'mono fw-700',
      nowrap: true,
      render: (rc) => rc.itemCode ?? '—',
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      className: 'fw-700',
      render: (rc) => rc.itemName ?? '— unknown item —',
      title: (rc) => rc.itemName ?? '',
    },
    {
      // Grade then size on one line — the stock this card is cut from, so the
      // master answers "what is it made of" without opening a card.
      id: 'raw_material',
      sortFilterField: 'rawMaterial',
      kind: 'text',
      header: 'RM Grade / RM Size',
      className: 'mono',
      title: (rc) => `${rc.rawMaterialGradeText ?? '—'} / ${rc.rawMaterialSizeText ?? '—'}`,
      render: (rc) => (
        <>
          <span className="fw-700">{rc.rawMaterialGradeText ?? '—'}</span>
          <span className="text3"> / {rc.rawMaterialSizeText ?? '—'}</span>
        </>
      ),
    },
    {
      id: 'op_count',
      sortFilterField: 'opCount',
      filterType: 'num',
      header: 'Ops',
      align: 'right',
      className: 'mono',
      nowrap: true,
      key: 'opCount',
    },
    {
      id: 'current_revision',
      sortFilterField: 'currentRevision',
      filterType: 'num',
      header: 'Route Card Rev',
      className: 'mono fw-700',
      nowrap: true,
      render: (rc) => <span style={{ color: 'var(--cyan)' }}>R{rc.currentRevision}</span>,
    },
    {
      id: 'updated_at',
      sortFilterField: 'updatedOn',
      filterType: 'date',
      kind: 'date',
      header: 'Last Updated',
      className: 'mono text2',
      nowrap: true,
      render: (rc) => fmtDate(rc.updatedAt),
    },
  ];
}
