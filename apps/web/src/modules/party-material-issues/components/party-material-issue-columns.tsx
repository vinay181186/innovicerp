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
import { leadColumns, type DataTableColumn } from '@/ui/data';

/** ADR-235 — a Cancelled issue (listed with includeCancelled). cancelledAt is
 *  the standard Cancel's stamp; deletedAt alone is an issue cancelled before it. */
export function isIssueCancelled(
  it: Pick<PartyMaterialIssueListItem, 'cancelledAt' | 'deletedAt'>,
): boolean {
  return Boolean(it.cancelledAt ?? it.deletedAt);
}

export function partyMaterialIssueColumns(): DataTableColumn<PartyMaterialIssueListItem>[] {
  return [
    // Owner rule 2026-10-31 — Issue No. then the lead columns first (JWSO-only
    // list: JWSO No., no Internal SO No.). Item Code / Item Name =
    // OUR produced part. The row carries no POL yet (needs API).
    ...leadColumns<PartyMaterialIssueListItem>({
      doc: {
        id: 'issue_code',
        sortFilterField: 'issueCode',
        header: 'Issue No.',
        kind: 'code',
        nowrap: true,
        render: (it) => (
          <>
            <span className="td-code" style={{ color: 'var(--cyan)' }}>
              {it.code}
            </span>
            {/* ADR-235: the register has no status column — a Cancelled issue
                says so beside its number. */}
            {isIssueCancelled(it) ? (
              <>
                {' '}
                <span className="badge b-red">Cancelled</span>
              </>
            ) : null}
          </>
        ),
      },
      docDate: {
        id: 'issue_date',
        sortFilterField: 'issueDate',
        header: 'Issue Date',
        kind: 'date',
        className: 'text2',
        nowrap: true,
        render: (it) => fmtDate(it.issueDate),
      },
      so: 'jwso',
      soNo: (it) => it.jwCodeText,
      pol: () => null,
      createdOn: (it) => it.createdAt,
      itemCode: (it) => it.jcItemCode,
      itemRev: (it) => it.jcItemRevision,
      itemName: (it) => it.jcItemName,
      overrides: {
        so_no: { sortFilterField: 'jwsoCode' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
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
    {
      // ADR-203: unused pieces put back from the Job Card into the register.
      // No sortFilterField: the API's sf-columns has no such field yet.
      id: 'returned_to_store_qty',
      header: 'Returned to Store',
      kind: 'num',
      align: 'right',
      nowrap: true,
      render: (it) =>
        it.returnedToStoreQty > 0 ? (
          <span className="mono fw-700">{it.returnedToStoreQty}</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
  ];
}
