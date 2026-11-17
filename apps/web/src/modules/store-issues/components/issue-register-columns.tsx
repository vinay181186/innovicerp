// Item Issue Register columns (ADR-199 fit table) — ONE ROW PER SLIP again
// (ADR-303, GET /store-issues). The locked lead block (Sr No · Issue No. ·
// Created On · SO No. · Internal SO No. — the order the slip traces to; no
// POL / Item Code / Item Name on a document list), then Issue Date, Issue
// Against, Reference, Issued To, Lines, Issue Qty (sum of the lines), Purpose,
// Issued By and Created By last. A cancelled slip washes the row
// (ROW_TINT.cancelled, set in the view). Sort & Filter runs on the SERVER
// (ADR-200): `sortFilterField` names the field in the endpoint's column map
// (api store-issues/sf-columns.ts STORE_ISSUE_SF_COLUMNS).

import { ISSUE_AGAINST_LABELS, type StoreIssueListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';

const ISSUE_AGAINST_OPTIONS = Object.entries(ISSUE_AGAINST_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function reference(r: StoreIssueListItem): string {
  if (r.issueAgainst === 'job_card') return r.jobCardCode ?? '—';
  if (r.issueAgainst === 'assembly_so') return r.salesOrderCode ?? '—';
  return r.department ?? r.legacyReference ?? '—';
}

export function issueRegisterColumns(firstRowNo: number): DataTableColumn<StoreIssueListItem>[] {
  return [
    ...leadColumns<StoreIssueListItem>({
      firstRowNo,
      doc: {
        id: 'issue_no',
        sortFilterField: 'code',
        kind: 'code',
        header: 'Issue No.',
        className: 'td-code',
        nowrap: true,
        render: (r) => (
          <>
            <span style={{ color: 'var(--cyan)' }}>{r.code}</span>
            {r.reversedAt ? (
              <div
                style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--red)' }}
                title={`Cancelled ${fmtDate(r.reversedAt.slice(0, 10))} — ${r.reversalReason ?? ''}`}
              >
                Cancelled
              </div>
            ) : null}
          </>
        ),
      },
      soNo: (r) => r.soCode,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: { sortFilterField: 'soCode' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'issue_date',
      sortFilterField: 'issueDate',
      kind: 'date',
      header: 'Issue Date',
      className: 'mono text2',
      nowrap: true,
      render: (r) => fmtDate(r.issueDate),
    },
    {
      id: 'issue_against',
      sortFilterField: 'issueAgainst',
      filterType: 'list',
      filterOptions: ISSUE_AGAINST_OPTIONS,
      kind: 'text',
      header: 'Issue Against',
      render: (r) => ISSUE_AGAINST_LABELS[r.issueAgainst],
    },
    {
      id: 'reference',
      sortFilterField: 'reference',
      filterType: 'text',
      kind: 'code',
      header: 'Reference',
      className: 'mono',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--blue)' }}>{reference(r)}</span>,
    },
    {
      id: 'issued_to',
      sortFilterField: 'issuedTo',
      kind: 'text',
      header: 'Issued To',
      render: (r) => r.issuedTo || '—',
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      kind: 'num',
      header: 'Lines',
      className: 'mono',
      nowrap: true,
      render: (r) => r.lineCount,
    },
    {
      id: 'issue_qty',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'Issue Qty',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => (
        <span style={{ textDecoration: r.reversedAt ? 'line-through' : undefined }}>
          {r.totalQty ?? 0}
        </span>
      ),
    },
    {
      id: 'purpose',
      sortFilterField: 'purpose',
      kind: 'text',
      header: 'Purpose',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (r) => r.purpose || '—',
      title: (r) => r.purpose ?? '',
    },
    {
      id: 'issued_by',
      sortFilterField: 'issuedBy',
      kind: 'text',
      header: 'Issued By',
      render: (r) => r.issuedByName || '—',
    },
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
