// Columns for the Stock Ledger table (ADR-199, table standard 2026-10-01).
// Split out of stock-ledger.tsx so the component stays well under the 400-line
// ceiling and matches the reference list shape (bom-list-columns).
//
// Labels follow docs/NAMING.md: the movement date / direction / quantity are
// `Movement Date` / `Movement Type` / `Movement Qty` (never bare Date/Type/Qty).
// Columns, in order — Ref No. and the six ADR-261 lead columns first (SO No. ·
// Internal SO No. · POL · Created On · Item Code (CODE/REV) · Item Name), then
// Movement Date · Movement Type · Movement Qty · Source · Stock Before ·
// Stock After. SO No. / Internal SO No. / POL come from the movement's own
// document where it traces to an order line (api store-transactions/so-link.ts),
// else "—"; they are display-only (no server Sort & Filter). Created On is the
// movement's created_at.

import {
  STORE_TXN_SOURCE_TYPES,
  STORE_TXN_TYPES,
  type StoreTransactionListItem,
} from '@innovic/shared';

import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';

import { STORE_TXN_SOURCE_LABELS, STORE_TXN_TYPE_LABELS } from '../lib/txn-labels';
import { TxnTypeBadge } from './txn-type-badge';

/** Columns off by default (DataTable `defaultHidden`); the Columns menu shows them. */
export const STOCK_LEDGER_HIDDEN_COLUMNS = ['remarks'] as const;

// Sort & Filter tick lists (ADR-200): the stored code + the label shown.
const TXN_TYPE_OPTIONS = STORE_TXN_TYPES.map((value) => ({
  value,
  label: STORE_TXN_TYPE_LABELS[value],
}));
const SOURCE_OPTIONS = STORE_TXN_SOURCE_TYPES.map((value) => ({
  value,
  label: STORE_TXN_SOURCE_LABELS[value],
}));

/** Each `sortFilterField` is a field of the endpoint's column map
 *  (apps/api/src/modules/store-transactions/sf-columns.ts, ADR-200). */
export function stockLedgerColumns(): DataTableColumn<StoreTransactionListItem>[] {
  return [
    ...leadColumns<StoreTransactionListItem>({
      doc: {
        header: 'Ref No.',
        id: 'sourceRef',
        kind: 'code',
        sortFilterField: 'sourceRef',
        className: 'mono',
        nowrap: true,
        render: (r) => r.sourceRef,
      },
      soNo: (r) => r.soCode,
      internalSoNo: (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode ?? r.itemCodeText,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      header: 'Movement Date',
      id: 'txnDate',
      kind: 'date',
      sortFilterField: 'txnDate',
      nowrap: true,
      render: (r) => fmtDate(r.txnDate),
    },
    {
      header: 'Movement Type',
      id: 'txnType',
      kind: 'badge',
      sortFilterField: 'txnType',
      filterOptions: TXN_TYPE_OPTIONS,
      render: (r) => <TxnTypeBadge type={r.txnType} />,
    },
    {
      header: 'Movement Qty',
      id: 'qty',
      kind: 'num',
      align: 'right',
      sortFilterField: 'qty',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => {
        const t = r.txnType;
        return (
          <span
            style={
              t === 'in'
                ? { color: 'var(--green2)' }
                : t === 'out'
                  ? { color: 'var(--red2)' }
                  : undefined
            }
          >
            {t === 'in' ? '+' : t === 'out' ? '-' : ''}
            {r.qty}
          </span>
        );
      },
    },
    {
      header: 'Source',
      id: 'sourceType',
      kind: 'code',
      sortFilterField: 'sourceType',
      filterType: 'list',
      filterOptions: SOURCE_OPTIONS,
      nowrap: true,
      render: (r) => (
        <span style={{ color: 'var(--blue)', fontWeight: 600 }}>
          {STORE_TXN_SOURCE_LABELS[r.sourceType]}
        </span>
      ),
    },
    {
      header: 'Stock Before',
      id: 'stockBefore',
      kind: 'num',
      align: 'right',
      sortFilterField: 'stockBefore',
      className: 'mono',
      nowrap: true,
      render: (r) => r.stockBefore,
    },
    {
      header: 'Stock After',
      id: 'stockAfter',
      kind: 'num',
      align: 'right',
      sortFilterField: 'stockAfter',
      className: 'mono',
      nowrap: true,
      render: (r) => <b>{r.stockAfter}</b>,
    },
    {
      // Shipped hidden by default (defaultHidden in stock-ledger.tsx): remarks is
      // server-searchable, so it must be readable somewhere — it rides in the ▸.
      header: 'Remarks',
      id: 'remarks',
      sortFilterField: 'remarks',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (r) => r.remarks ?? '',
      title: (r) => r.remarks ?? '',
    },
  ];
}
