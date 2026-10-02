// Item Issue Register columns (ADR-199 fit table: one line per row, always fits
// the screen). The first column (Issue No.) is pinned by the stylesheet. Text
// centres, long free text (Purpose) ellipsises. A reversed slip washes the whole
// row (ROW_TINT.cancelled, set in the view) and strikes its items through.
// Sort & Filter runs on the SERVER (ADR-200): `sortFilterField` names the
// field in the endpoint's column map (api store-issues/sf-columns.ts).

import { ISSUE_AGAINST_LABELS, type StoreIssueListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

const ISSUE_AGAINST_OPTIONS = Object.entries(ISSUE_AGAINST_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Columns off by default (DataTable `defaultHidden`); Columns ▾ shows them. */
export const ISSUE_REGISTER_HIDDEN_COLUMNS = ['created_on'] as const;

function reference(iss: StoreIssueListItem): string {
  if (iss.issueAgainst === 'job_card') return iss.jobCardCode ?? '—';
  if (iss.issueAgainst === 'assembly_so') return iss.salesOrderCode ?? '—';
  return iss.department ?? iss.legacyReference ?? '—';
}

export function issueRegisterColumns(): DataTableColumn<StoreIssueListItem>[] {
  return [
    {
      id: 'issue_no',
      sortFilterField: 'code',
      kind: 'code',
      header: 'Issue No.',
      className: 'td-code',
      nowrap: true,
      render: (iss) => (
        <>
          <span style={{ color: 'var(--cyan)' }}>{iss.code}</span>
          {iss.reversedAt ? (
            <div
              style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)' }}
              title={`Reversed ${fmtDate(iss.reversedAt.slice(0, 10))} — ${iss.reversalReason ?? ''}`}
            >
              Reversed
            </div>
          ) : null}
        </>
      ),
    },
    {
      id: 'issue_date',
      sortFilterField: 'issueDate',
      kind: 'date',
      header: 'Issue Date',
      className: 'mono text2',
      nowrap: true,
      render: (iss) => fmtDate(iss.issueDate),
    },
    {
      id: 'issue_against',
      sortFilterField: 'issueAgainst',
      filterType: 'list',
      filterOptions: ISSUE_AGAINST_OPTIONS,
      kind: 'text',
      header: 'Issue Against',
      render: (iss) => ISSUE_AGAINST_LABELS[iss.issueAgainst],
    },
    {
      id: 'reference',
      sortFilterField: 'reference',
      filterType: 'text',
      kind: 'code',
      header: 'Reference',
      className: 'mono',
      nowrap: true,
      render: (iss) => <span style={{ color: 'var(--purple)' }}>{reference(iss)}</span>,
    },
    {
      // Filters match an item on ANY line of the slip.
      id: 'items',
      sortFilterField: 'items',
      filterType: 'text',
      kind: 'code',
      header: 'Items',
      className: 'mono fw-700',
      render: (iss) => (
        <span
          style={{
            color: 'var(--text)',
            textDecoration: iss.reversedAt ? 'line-through' : undefined,
          }}
        >
          {iss.itemsSummary || '—'}
        </span>
      ),
    },
    {
      id: 'issued_to',
      sortFilterField: 'issuedTo',
      kind: 'text',
      header: 'Issued To',
      render: (iss) => iss.issuedTo || '—',
    },
    {
      id: 'purpose',
      sortFilterField: 'purpose',
      kind: 'text',
      header: 'Purpose',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (iss) => iss.purpose || '—',
      title: (iss) => iss.purpose ?? '',
    },
    {
      id: 'issued_by',
      sortFilterField: 'issuedBy',
      kind: 'text',
      header: 'Issued By',
      render: (iss) => iss.issuedByName || '—',
    },
    {
      // When the slip was entered (IST day). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono text2',
      nowrap: true,
      render: (iss) => fmtDate(iss.createdAt),
    },
  ];
}
