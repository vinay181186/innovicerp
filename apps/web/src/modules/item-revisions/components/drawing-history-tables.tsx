// Drawing page tables: the drawing's history (every file it has carried, who
// changed it and why) and the documents that name this Item + Drawing Rev.
// Both are short, per-record lists read whole with the record — no paging.

import type {
  ItemRevisionDrawingAction,
  ItemRevisionDrawingEvent,
  ItemRevisionLinkedDoc,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import { fmtDateTime } from '@/lib/date';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';

const ACTION_LABEL: Record<ItemRevisionDrawingAction, string> = {
  born: 'First drawing',
  adopted: 'Drawing added',
  copied: 'Carried from another Rev',
  replaced: 'Replaced',
  cleared: 'Removed',
};

const HISTORY_COLUMNS: DataTableColumn<ItemRevisionDrawingEvent>[] = [
  {
    id: 'action',
    header: 'Drawing Action',
    nowrap: true,
    render: (e) => (
      <span className={e.action === 'replaced' ? 'fw-700 amber' : 'fw-700'}>
        {ACTION_LABEL[e.action]}
      </span>
    ),
    filterValue: (e) => ACTION_LABEL[e.action],
  },
  {
    id: 'file',
    header: 'Drawing File',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (e) => (e.drawingFilePath ? fileNameFromPath(e.drawingFilePath) : ''),
    render: (e) => (e.drawingFilePath ? fileNameFromPath(e.drawingFilePath) : '—'),
  },
  {
    id: 'drawing_no',
    header: 'Drawing No.',
    className: 'mono',
    nowrap: true,
    render: (e) => e.drawingNo ?? '—',
  },
  {
    id: 'source',
    header: 'Named By',
    className: 'mono',
    nowrap: true,
    render: (e) => e.sourceRef ?? '—',
  },
  {
    id: 'reason',
    header: 'Replace Reason',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (e) => e.reason ?? '',
    render: (e) => e.reason ?? '—',
  },
  {
    id: 'by',
    header: 'Changed By',
    nowrap: true,
    render: (e) => e.createdByName ?? '—',
  },
  {
    id: 'at',
    header: 'Changed At',
    kind: 'date',
    className: 'mono text2',
    nowrap: true,
    render: (e) => fmtDateTime(e.createdAt),
    filterValue: (e) => e.createdAt,
  },
];

export function DrawingHistoryTable({
  rows,
}: {
  rows: ItemRevisionDrawingEvent[];
}): React.JSX.Element {
  return (
    <DataTable
      tableKey={TABLE_KEYS.itemRevisionHistory}
      columns={HISTORY_COLUMNS}
      rows={rows}
      empty="No drawing changes yet."
    />
  );
}

const DOC_TYPE_LABEL: Record<ItemRevisionLinkedDoc['docType'], string> = {
  so_line: 'Sales Order line',
  jw_line: 'Job Work Order line',
  route_card: 'Route Card',
  plan: 'Plan',
  production_order: 'Production Order',
  job_card: 'Job Card',
};

/** The document's own page. Lines open their order (docId = the order's id). */
function DocLink({ doc }: { doc: ItemRevisionLinkedDoc }): React.JSX.Element {
  const text = doc.lineNo != null ? `${doc.code} L${doc.lineNo}` : doc.code;
  const params = { id: doc.docId };
  const stop = (e: React.MouseEvent): void => e.stopPropagation();
  switch (doc.docType) {
    case 'so_line':
      return (
        <Link to="/sales-orders/$id" params={params} className="td-code" onClick={stop}>
          {text}
        </Link>
      );
    case 'jw_line':
      return (
        <Link to="/job-work-orders/$id" params={params} className="td-code" onClick={stop}>
          {text}
        </Link>
      );
    case 'route_card':
      return (
        <Link to="/route-cards/$id" params={params} className="td-code" onClick={stop}>
          {text}
        </Link>
      );
    case 'plan':
      return (
        <Link to="/plans/$id" params={params} className="td-code" onClick={stop}>
          {text}
        </Link>
      );
    case 'production_order':
      return (
        <Link to="/production-orders/$id" params={params} className="td-code" onClick={stop}>
          {text}
        </Link>
      );
    case 'job_card':
      return (
        <Link to="/job-cards/$id" params={params} className="td-code" onClick={stop}>
          {text}
        </Link>
      );
  }
}

const LINKED_COLUMNS: DataTableColumn<ItemRevisionLinkedDoc>[] = [
  {
    id: 'doc_type',
    header: 'Document Type',
    nowrap: true,
    render: (d) => DOC_TYPE_LABEL[d.docType],
    filterValue: (d) => DOC_TYPE_LABEL[d.docType],
  },
  {
    id: 'code',
    header: 'Document No.',
    nowrap: true,
    render: (d) => <DocLink doc={d} />,
    filterValue: (d) => d.code,
  },
  {
    id: 'status',
    header: 'Document Status',
    nowrap: true,
    render: (d) => d.status ?? '—',
  },
];

export function LinkedDocsTable({ rows }: { rows: ItemRevisionLinkedDoc[] }): React.JSX.Element {
  return (
    <DataTable
      tableKey={TABLE_KEYS.itemRevisionLinkedDocs}
      columns={LINKED_COLUMNS}
      rows={rows}
      rowKey={(d) => `${d.docType}:${d.docId}:${d.lineNo ?? ''}`}
      empty="No document names this Drawing Rev yet."
    />
  );
}
