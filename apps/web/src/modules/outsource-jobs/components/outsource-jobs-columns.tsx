// Outsource Jobs tab — columns, ▸ expand, status tint and the per-row action,
// for the ADR-199 fit table (DataTable + tableKey). Moved out of
// outsource-jobs-view.tsx when the hand-built table was retired, so the view
// stays well under the file ceiling (CLAUDE.md §12).
//
// What used to stack inside one cell is now a column of its own:
//   JC No. · Op              (the JC code carried "· Op N" after it)
//   PR Qty · Pending         (the "N of M pending" line lived in the Status cell)
// and PO No. / Vendor Code / the short-close note moved into the ▸ detail row.
//
// Row tint by PR status (real enum only, ADR-199 ROW_TINT): po_created → done
// (green, buying placed), cancelled → cancelled (grey). Open / approved stay
// plain so the table is not a wall of colour.

import { opSrNo, type PurchaseRequestListItem } from '@innovic/shared';

import { fmtDate } from '@/lib/date';
import { prBalanceClosedText, prOrderBalance } from '@/modules/purchase-requests/lib/pr-balance';
import { PR_STATUS_LABELS } from '@/modules/purchase-requests/lib/pr-labels';
import {
  createdByColumn,
  type DataTableColumn,
  leadColumns,
  renderRowMenuLink,
  ROW_TINT,
} from '@/ui/data';
import { StatusBadge } from '@/ui/core';
import { RowActions } from '@/ui/layout';

import { ospCanOrder } from '../lib/osp-band';

const dash = <span className="text3">—</span>;

// Sort & Filter (server mode, ADR-201): the tab is paged, so a ▾ runs on the
// server over every OSP request. Fields are the Purchase Request list's own
// (purchase-requests/sf-columns.ts); JC No. / Op / Process / Est. Rate have
// no field there, so they carry no ▾ (JC No. has its own filter box).
const PR_STATUS_OPTIONS = Object.entries(PR_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Row background tint keyed to the REAL PR status enum (not the band): the
 *  buying is placed → green, the request was cancelled → grey. */
export function ospRowTint(pr: PurchaseRequestListItem): string | undefined {
  if (pr.status === 'cancelled') return ROW_TINT.cancelled;
  if (pr.status === 'po_created') return ROW_TINT.done;
  return undefined;
}

export function outsourceJobsColumns(
  firstRowNo: number,
): DataTableColumn<PurchaseRequestListItem>[] {
  return [
    // ADR-261 rev 2026-11-02 — PR No. inside the lead block
    // (after Item Name), all locked; JC No., Op and every other fact follow Item Name.
    ...leadColumns<PurchaseRequestListItem>({
      firstRowNo,
      doc: {
        // The OSP PR number (IN-JWPR-…).
        id: 'pr_no',
        sortFilterField: 'prCode',
        kind: 'code',
        header: 'PR No.',
        className: 'mono fw-700',
        render: (pr) => <span style={{ color: 'var(--blue)' }}>{pr.code}</span>,
      },
      soNo: (pr) => pr.soCode,
      internalSoNo: (pr) => pr.soInternalNo,
      pol: (pr) => pr.clientPoLineNo,
      createdOn: (pr) => pr.createdAt,
      // CODE/REV — the drawing revision off the SO line behind this request;
      // the bare code when the request has no SO behind it.
      itemCode: (pr) => pr.itemCode ?? pr.itemCodeText,
      itemRev: (pr) => pr.itemRevision,
      itemName: (pr) => pr.itemName,
      overrides: {
        so_internal_no: { sortFilterField: 'soInternalNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'pr_date',
      sortFilterField: 'prDate',
      kind: 'date',
      header: 'PR Date',
      className: 'mono',
      nowrap: true,
      render: (pr) => fmtDate(pr.prDate ?? null),
      filterValue: (pr) => pr.prDate ?? '',
    },
    {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'mono',
      render: (pr) =>
        pr.sourceJcCode ? <span style={{ color: 'var(--cyan)' }}>{pr.sourceJcCode}</span> : dash,
    },
    {
      id: 'op',
      kind: 'code',
      header: 'Op',
      className: 'mono',
      render: (pr) => (pr.sourceJcOpSeq ? opSrNo(pr.sourceJcOpSeq) : '—'),
    },
    {
      id: 'process',
      kind: 'text',
      header: 'Process',
      headColor: 'var(--purple)',
      align: 'left',
      ellipsis: true,
      render: (pr) => (
        <span style={{ color: 'var(--purple)', fontWeight: 600 }}>{pr.operation ?? '—'}</span>
      ),
      title: (pr) => pr.operation ?? '',
    },
    {
      id: 'qty',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'PR Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (pr) => pr.qty,
    },
    {
      id: 'pending',
      sortFilterField: 'balanceQty',
      kind: 'num',
      header: 'Pending',
      align: 'right',
      headColor: 'var(--amber2)',
      className: 'mono fw-700',
      render: (pr) => {
        const bal = prOrderBalance(pr);
        return <span style={{ color: 'var(--amber2)' }}>{bal.balance}</span>;
      },
    },
    {
      id: 'vendor',
      sortFilterField: 'vendorName',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      render: (pr) => pr.vendorName ?? <span className="text3">—</span>,
      title: (pr) => pr.vendorName ?? '',
    },
    {
      id: 'est_rate',
      kind: 'num',
      header: 'Est. Rate',
      headColor: 'var(--green2)',
      align: 'right',
      className: 'mono',
      // Existing price display preserved exactly — a rate only when one is set.
      render: (pr) => (
        <span style={{ color: 'var(--green2)' }}>
          {Number(pr.estCost) > 0 ? `₹${Number(pr.estCost).toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      id: 'due',
      sortFilterField: 'requiredDate',
      kind: 'date',
      header: 'Due Date',
      render: (pr) => fmtDate(pr.requiredDate),
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterOptions: PR_STATUS_OPTIONS,
      kind: 'badge',
      header: 'PR Status',
      render: (pr) => {
        const bal = prOrderBalance(pr);
        return (
          <span style={{ whiteSpace: 'nowrap' }}>
            <StatusBadge kind="pr" status={pr.status} label={PR_STATUS_LABELS[pr.status]} />
            {bal.closed ? (
              <span className="badge b-grey" style={{ marginLeft: 'var(--sp-1)' }}>
                Short Closed
              </span>
            ) : null}
          </span>
        );
      },
    },
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}

/** The ▸ detail row: the facts that do not earn a column of their own — the PO
 *  this request has been (partly) bought on, the vendor's code, and the
 *  short-close note when the balance was abandoned. */
export function OutsourceJobExpand({ pr }: { pr: PurchaseRequestListItem }): React.JSX.Element {
  const bal = prOrderBalance(pr);
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--sp-5)',
        flexWrap: 'wrap',
        padding: '8px 14px',
        fontSize: 'var(--fs-sm)',
      }}
    >
      <span>
        <span className="text3">PO No.: </span>
        {pr.poCode ? (
          <span className="mono" style={{ color: 'var(--cyan)' }}>
            {pr.poCode}
          </span>
        ) : (
          dash
        )}
      </span>
      <span>
        <span className="text3">Vendor Code: </span>
        {pr.vendorCodeText ? <span className="mono">{pr.vendorCodeText}</span> : dash}
      </span>
      {bal.closed ? (
        <span style={{ color: 'var(--text3)' }}>
          🚫 {prBalanceClosedText(bal)}
          {bal.closedReason ? ` — ${bal.closedReason}` : ''}
        </span>
      ) : null}
    </div>
  );
}

/** The row's ⋯ menu — a single Create PO item, shown only when this request
 *  still has quantity to buy and the user may raise a PO (po_create entry, the
 *  server's rule). Reuses the same /purchase-orders/from-pr destination as the
 *  bulk action, with just this one request's id (renderRowMenuLink turns the
 *  `?prId=` into the route's search param). */
export function OutsourceJobRowActions({
  pr,
  canCreatePo,
}: {
  pr: PurchaseRequestListItem;
  canCreatePo: boolean;
}): React.JSX.Element | null {
  if (!canCreatePo || !ospCanOrder(pr)) return null;
  return (
    <RowActions
      renderLink={renderRowMenuLink}
      items={[
        {
          key: 'create-po',
          label: 'Create PO',
          icon: 'plus',
          group: 'workflow',
          to: `/purchase-orders/from-pr?prId=${encodeURIComponent(pr.id)}`,
        },
      ]}
    />
  );
}
