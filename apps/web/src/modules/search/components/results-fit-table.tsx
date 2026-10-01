// Global Search — the full-PAGE results on THE shared fit table (ADR-199, table
// standard 2026-10-01). One ruled sheet on <DataTable tableKey=
// {TABLE_KEYS.globalSearch}>: one row per hit across the seven columns
// Document Date · Document Type · Document No. · Customer / Vendor ·
// Particulars · Document Qty · Document Status (labels per docs/NAMING.md, the
// same the popup table has always used). The row's ▸ opens the detail — every
// Particulars line on its own line plus the "matched" snippet. A row click
// opens the matched document (openSearchResult, routed in by `onOpen`).
//
// The header search POPUP keeps its own compact table (results-table.tsx): it
// is a dropdown whose single scroller is wired through `.gs-overlay .tbl-wrap`
// in the shared theme, and the fit engine's extra wrappers (.dt-fit-root +
// toolbar) sit between that scroller and the flex column, so only this
// full-page table moved onto the shared layout.

import { useState } from 'react';
import { GLOBAL_SEARCH_KIND_META } from '@innovic/shared';
import type { GlobalSearchResult } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { statusText } from '@/lib/status-text';
import { DataTable, type DataTableColumn, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';

const rowKey = (r: GlobalSearchResult): string => `${r.kind}:${r.id}`;

/** Particulars collapsed to one line for the main row — the ▸ shows each line. */
function particularsLine(r: GlobalSearchResult): string {
  return r.lines.join(' · ');
}

const COLUMNS: DataTableColumn<GlobalSearchResult>[] = [
  {
    id: 'doc_date',
    header: 'Document Date',
    kind: 'date',
    className: 'mono',
    nowrap: true,
    render: (r) => fmtDate(r.date),
    filterValue: (r) => r.date,
  },
  {
    id: 'doc_type',
    header: 'Document Type',
    kind: 'text',
    align: 'left',
    className: 'text3',
    ellipsis: true,
    render: (r) => GLOBAL_SEARCH_KIND_META[r.kind].label,
    filterValue: (r) => GLOBAL_SEARCH_KIND_META[r.kind].label,
  },
  {
    id: 'doc_no',
    header: 'Document No.',
    kind: 'code',
    className: 'td-code',
    nowrap: true,
    render: (r) => (
      <span className="td-code" style={{ color: 'var(--text)', fontWeight: 700 }} title={r.docNo}>
        {r.docNo}
      </span>
    ),
    filterValue: (r) => r.docNo,
  },
  {
    id: 'party',
    header: 'Customer / Vendor',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    render: (r) => r.party ?? '—',
    title: (r) => r.party ?? '',
    filterValue: (r) => r.party ?? '',
  },
  {
    id: 'particulars',
    header: 'Particulars',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    render: (r) => particularsLine(r) || (r.hit ? `matched: ${r.hit}` : '—'),
    title: (r) => particularsLine(r),
    filterValue: (r) => `${particularsLine(r)} ${r.hit ?? ''}`.trim(),
  },
  {
    id: 'doc_qty',
    header: 'Document Qty',
    kind: 'num',
    align: 'right',
    className: 'mono',
    nowrap: true,
    render: (r) => r.qty ?? '—',
    filterValue: (r) => r.qty,
  },
  {
    id: 'doc_status',
    header: 'Document Status',
    kind: 'badge',
    render: (r) =>
      r.status ? <span className="badge b-grey">{statusText(r.status, r.kind)}</span> : '—',
    filterValue: (r) => (r.status ? statusText(r.status, r.kind) : ''),
  },
];

/** The ▸ detail: every Particulars line on its own line, then the matched snippet. */
function ParticularsDetail({ r }: { r: GlobalSearchResult }): React.JSX.Element {
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3)', fontSize: 13 }}>
      {r.lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
      {r.hit ? (
        <div className="text3" style={{ fontSize: 12 }}>
          matched: {r.hit}
        </div>
      ) : null}
      {r.lines.length === 0 && !r.hit ? <span className="text3">—</span> : null}
    </div>
  );
}

export function ResultsFitTable({
  items,
  loading,
  empty,
  onOpen,
}: {
  items: GlobalSearchResult[];
  /** True while a fetch is in flight — draws the table's own loading row. */
  loading: boolean;
  /** The empty-row message when the search returned nothing. */
  empty: React.ReactNode;
  onOpen: (r: GlobalSearchResult) => void;
}): React.JSX.Element {
  // Which rows have their ▸ detail open. Kept in sync with the fit engine's own
  // toggle via onToggleExpanded, so the ▸ opens both at once.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  return (
    <Panel bodyPadding="none">
      <DataTable<GlobalSearchResult>
        tableKey={TABLE_KEYS.globalSearch}
        columns={COLUMNS}
        rows={items}
        rowKey={rowKey}
        loading={loading}
        empty={empty}
        onRowClick={(r) => onOpen(r)}
        renderExpanded={(r) => (open.has(rowKey(r)) ? <ParticularsDetail r={r} /> : null)}
        onToggleExpanded={(r) =>
          setOpen((prev) => {
            const next = new Set(prev);
            const k = rowKey(r);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
          })
        }
      />
    </Panel>
  );
}
