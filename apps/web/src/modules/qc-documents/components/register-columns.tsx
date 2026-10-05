// File Register columns (ADR-199 fit table, tableKey qcDocsRegister). The flat
// register of every uploaded QC file. Default-visible set per the brief:
// Document Type · File Name · JC No. · Item Code · Upload Date; the rest
// (Category, POL, Item Name, SO No., Uploaded By) ride in the ▸ expand by
// default but stay in the Columns menu. Upload Date keeps its qualifier (a bare
// "Date" is banned, NAMING §127). Moved out of routes/list.tsx.

import type { QcDocument } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { CATEGORY_LABEL } from './qc-doc-shared';

// Server Sort & Filter (ADR-200): the Category tick list (stored code + label).
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/** Ids hidden into the ▸ detail by default. */
export const REGISTER_DETAIL_IDS = [
  'category',
  'pol',
  'item_name',
  'so_code',
  'so_internal_no',
  'uploaded_by',
];

export function buildRegisterColumns(): DataTableColumn<QcDocument>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'doc_type',
      sortFilterField: 'docType',
      header: 'Document Type',
      nowrap: true,
      className: 'fw-700',
      render: (d) => <span style={{ color: 'var(--purple)', fontSize: 12 }}>{d.docType}</span>,
    },
    {
      id: 'file_name',
      sortFilterField: 'fileName',
      header: 'File Name',
      align: 'left',
      ellipsis: true,
      render: (d) => d.fileName,
      title: (d) => d.fileName,
    },
    {
      id: 'category',
      sortFilterField: 'category',
      filterType: 'list',
      filterOptions: CATEGORY_OPTIONS,
      header: 'Category',
      nowrap: true,
      render: (d) => (CATEGORY_LABEL as Record<string, string>)[d.category] ?? d.category,
    },
    {
      id: 'jc_code',
      sortFilterField: 'jcCode',
      header: 'JC No.',
      nowrap: true,
      render: (d) => (
        <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
          {d.jcCodeText ?? '—'}
        </span>
      ),
    },
    {
      id: 'pol',
      sortFilterField: 'clientPoLineNo',
      header: 'POL',
      nowrap: true,
      headColor: 'var(--purple)',
      render: (d) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {d.clientPoLineNo ?? '—'}
        </span>
      ),
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      nowrap: true,
      className: 'td-code mono fw-700',
      // `CODE/REV` via the one helper — the revision is the customer's drawing
      // revision off the SO line behind the card, never items.revision.
      render: (d) => itemCodeWithRev(d.itemCode, d.itemRevision),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (d) => d.itemName ?? '',
      title: (d) => d.itemName ?? '',
    },
    {
      id: 'so_code',
      sortFilterField: 'soCode',
      header: 'SO No.',
      nowrap: true,
      render: (d) => (
        <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
          {d.soCodeText || '—'}
        </span>
      ),
    },
    {
      // ADR-207 — the office's own Internal SO No., in its own column beside
      // the system SO No. so the two can be told apart. Older orders have none.
      id: 'so_internal_no',
      sortFilterField: 'soInternalNo',
      kind: 'code',
      header: 'Internal SO No.',
      className: 'mono fw-700',
      nowrap: true,
      render: (d) => <span style={{ color: 'var(--text)' }}>{d.soInternalNo?.trim() || '—'}</span>,
    },
    {
      id: 'uploaded_by',
      sortFilterField: 'uploadedBy',
      header: 'Uploaded By',
      align: 'left',
      ellipsis: true,
      render: (d) => d.uploadedByText ?? '—',
      title: (d) => d.uploadedByText ?? '',
    },
    {
      id: 'upload_date',
      sortFilterField: 'uploadDate',
      kind: 'date',
      header: 'Upload Date',
      className: 'mono',
      nowrap: true,
      render: (d) => fmtDate(d.createdAt),
    },
  ];
}
