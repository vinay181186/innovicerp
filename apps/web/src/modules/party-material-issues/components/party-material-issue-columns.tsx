// Customer Material Issue register columns (ADR-199 fit table, table standard
// 2026-10-01). Split out of party-material-issue-view.tsx to keep every file
// under the 400-line rule.
//
// TWO different items sit on every row and must never be swapped (see the long
// note on partyMaterialIssueSchema in packages/shared):
//   · "Item Code" / "Item Name" = OUR produced part off the job card
//     (jcItemCode / REV / jcItemName).
//   · "Customer Material" = the CLIENT'S supplied stock this issue debits
//     (partyMaterialCodeText / partyMaterialName).
// Both are kept visible so no fact the old table showed is lost; the fit engine
// drops the rightmost into ▸ when the screen is narrow. Remarks lives in the ▸
// expand (party-material-issue-expand.tsx).

import type { PartyMaterialIssueListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';

export function partyMaterialIssueColumns(): DataTableColumn<PartyMaterialIssueListItem>[] {
  return [
    {
      id: 'issue_code',
      sortFilterField: 'issueCode',
      header: 'Issue No.',
      kind: 'code',
      nowrap: true,
      render: (it) => (
        <span className="td-code" style={{ color: 'var(--cyan)' }}>
          {it.code}
        </span>
      ),
    },
    {
      id: 'issue_date',
      sortFilterField: 'issueDate',
      header: 'Issue Date',
      kind: 'date',
      className: 'text2',
      nowrap: true,
      render: (it) => fmtDate(it.issueDate),
    },
    {
      id: 'jwso_code',
      sortFilterField: 'jwsoCode',
      header: 'JWSO No.',
      kind: 'code',
      nowrap: true,
      render: (it) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {it.jwCodeText ?? '—'}
        </span>
      ),
    },
    {
      id: 'jc_code',
      sortFilterField: 'jcCode',
      header: 'JC No.',
      kind: 'code',
      className: 'mono text2',
      nowrap: true,
      render: (it) => it.jcCodeText ?? '—',
    },
    {
      // OUR produced part (CODE/REV). Null renders an em dash.
      id: 'item_code',
      sortFilterField: 'itemCode',
      header: 'Item Code',
      kind: 'code',
      nowrap: true,
      render: (it) => (
        <span className="mono fw-700">
          {itemCodeWithRev(it.jcItemCode, it.jcItemRevision, '—')}
        </span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (it) => it.jcItemName ?? '—',
      title: (it) => it.jcItemName ?? '',
    },
    {
      // The CLIENT'S supplied material this issue debits — NOT the produced part.
      id: 'customer_material',
      sortFilterField: 'customerMaterial',
      header: 'Customer Material',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (it) => (
        <>
          <span style={{ color: 'var(--purple)' }}>{it.partyMaterialCodeText ?? '—'}</span>
          {it.partyMaterialName ? (
            <span className="text3" style={{ fontSize: 11 }}>
              {' '}
              — {it.partyMaterialName}
            </span>
          ) : null}
        </>
      ),
      title: (it) =>
        [it.partyMaterialCodeText, it.partyMaterialName].filter(Boolean).join(' — ') || '',
    },
    {
      id: 'issue_qty',
      sortFilterField: 'qty',
      header: 'Issue Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      nowrap: true,
      render: (it) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {it.qty}
        </span>
      ),
    },
  ];
}
