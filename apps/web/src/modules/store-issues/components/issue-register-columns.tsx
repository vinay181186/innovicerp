// Item Issue Register columns (ADR-199 fit table), one row per issue LINE
// (ADR-261, GET /store-issues/lines). The slip's own Issue No. and the six
// lead columns come first (SO No. · Internal SO No. · POL · Created On · Item
// Code · Item Name), then Issue Date, Issue Against, Reference, Issued To, the line's
// Issue Qty, Purpose and Issued By. A cancelled slip washes the row
// (ROW_TINT.cancelled, set in the view). Sort & Filter runs on the SERVER
// (ADR-200): `sortFilterField` names the field in the endpoint's column map
// (api store-issues/sf-columns.ts STORE_ISSUE_LINE_SF_COLUMNS).

import { ISSUE_AGAINST_LABELS, type StoreIssueLineRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';

const ISSUE_AGAINST_OPTIONS = Object.entries(ISSUE_AGAINST_LABELS).map(([value, label]) => ({
  value,
  label,
}));

function reference(r: StoreIssueLineRow): string {
  if (r.issueAgainst === 'job_card') return r.jobCardCode ?? '—';
  if (r.issueAgainst === 'assembly_so') return r.salesOrderCode ?? '—';
  return r.department ?? r.legacyReference ?? '—';
}

export function issueRegisterColumns(): DataTableColumn<StoreIssueLineRow>[] {
  return [
    ...leadColumns<StoreIssueLineRow>({
      doc: {
        id: 'issue_no',
        sortFilterField: 'code',
        kind: 'code',
        header: 'Issue No.',
        className: 'td-code',
        nowrap: true,
        render: (r) => (
          <>
            <span style={{ color: 'var(--cyan)' }}>{r.docCode}</span>
            {r.reversedAt ? (
              <div
                style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)' }}
                title={`Cancelled ${fmtDate(r.reversedAt.slice(0, 10))} — ${r.reversalReason ?? ''}`}
              >
                Cancelled
              </div>
            ) : null}
          </>
        ),
      },
      docDate: {
        id: 'issue_date',
        sortFilterField: 'issueDate',
        kind: 'date',
        header: 'Issue Date',
        className: 'mono text2',
        nowrap: true,
        render: (r) => fmtDate(r.docDate),
      },
      soNo: (r) => r.soCode,
      internalSoNo: (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
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
      render: (r) => <span style={{ color: 'var(--purple)' }}>{reference(r)}</span>,
    },
    {
      id: 'issued_to',
      sortFilterField: 'issuedTo',
      kind: 'text',
      header: 'Issued To',
      render: (r) => r.issuedTo || '—',
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
          {r.qty}
          {r.uom ? <span className="text3"> {r.uom}</span> : null}
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
  ];
}
