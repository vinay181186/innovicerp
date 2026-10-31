// File Register columns (ADR-199 fit table, tableKey qcDocsRegister). The flat
// register of every uploaded QC file. ADR-261 (owner rule 2026-10-31): the six
// lead columns first — SO No. · Internal SO No. · POL · Created On · Item Code
// (CODE/REV) · Item Name — then Document Type · File Name · JC No.; Category
// and Uploaded By ride in the ▸ expand by default but stay in the Columns menu.
// Created On is the file's upload day (qc_documents.created_at), so the old
// separate "Upload Date" column is gone. Moved out of routes/list.tsx.

import type { QcDocument } from '@innovic/shared';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { CATEGORY_LABEL } from './qc-doc-shared';

// Server Sort & Filter (ADR-200): the Category tick list (stored code + label).
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/** Ids hidden into the ▸ detail by default (never a lead column). */
export const REGISTER_DETAIL_IDS = ['category', 'uploaded_by'];

export function buildRegisterColumns(): DataTableColumn<QcDocument>[] {
  return [
    ...leadColumns<QcDocument>({
      soNo: (d) => d.soCodeText,
      internalSoNo: (d) => d.soInternalNo,
      pol: (d) => d.clientPoLineNo,
      createdOn: (d) => d.createdAt,
      itemCode: (d) => d.itemCode,
      // The customer's drawing revision off the SO line behind the card, never
      // items.revision.
      itemRev: (d) => d.itemRevision,
      itemName: (d) => d.itemName,
      overrides: {
        so_no: { sortFilterField: 'soCode' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
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
      id: 'category',
      sortFilterField: 'category',
      filterType: 'list',
      filterOptions: CATEGORY_OPTIONS,
      header: 'Category',
      nowrap: true,
      render: (d) => (CATEGORY_LABEL as Record<string, string>)[d.category] ?? d.category,
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
  ];
}
