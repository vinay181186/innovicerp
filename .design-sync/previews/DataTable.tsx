import { DataTable, StatusBadge, type DataTableColumn, type RowMenuItem } from '@innovic/web';

interface SoLine {
  id: string;
  soNo: string;
  pol: string;
  itemCode: string;
  itemName: string;
  orderQty: number;
  status: string;
}

const rows: SoLine[] = [
  { id: '1', soNo: 'IN-SO-00123', pol: '10', itemCode: 'BRKT-101/A', itemName: 'Mounting Bracket, MS Plate 10 mm', orderQty: 100, status: 'open' },
  { id: '2', soNo: 'IN-SO-00123', pol: '20', itemCode: 'SHFT-204/C', itemName: 'Drive Shaft, EN8 Dia 40', orderQty: 25, status: 'open' },
  { id: '3', soNo: 'IN-SO-00118', pol: '10', itemCode: 'HSG-310/B', itemName: 'Gearbox Housing, CI FG260', orderQty: 12, status: 'draft' },
  { id: '4', soNo: 'IN-SO-00097', pol: '30', itemCode: 'FLNG-118', itemName: 'Weld Neck Flange, SS304', orderQty: 40, status: 'dispatched' },
  { id: '5', soNo: 'IN-SO-00089', pol: '10', itemCode: 'PIN-077/A', itemName: 'Locating Pin, EN24 Hardened', orderQty: 250, status: 'cancelled' },
];

const columns: DataTableColumn<SoLine>[] = [
  { id: 'sr_no', header: 'Sr No', width: '6%', className: 'mono', nowrap: true, render: (_r, i) => i + 1 },
  { id: 'so_no', header: 'SO No.', width: '14%', className: 'mono', nowrap: true, render: (r) => <span className="td-code">{r.soNo}</span> },
  { id: 'pol', header: 'POL', width: '6%', headColor: 'var(--purple)', className: 'mono fw-700', nowrap: true, render: (r) => <span style={{ color: 'var(--purple)' }}>{r.pol}</span> },
  { id: 'item_code', header: 'Item Code', width: '14%', className: 'mono fw-700', nowrap: true, render: (r) => <span style={{ color: 'var(--text)' }}>{r.itemCode}</span> },
  { id: 'item_name', header: 'Item Name', width: '30%', align: 'left', ellipsis: true, key: 'itemName' },
  { id: 'order_qty', header: 'Order Qty', width: '10%', align: 'right', className: 'mono', nowrap: true, render: (r) => r.orderQty },
  { id: 'so_status', header: 'SO Status', width: '14%', nowrap: true, render: (r) => <StatusBadge kind="so" status={r.status} /> },
];

const menu = (r: SoLine): RowMenuItem[] => [
  { key: 'view', label: 'View', icon: 'eye', to: `/sales-orders/${r.id}` },
  { key: 'edit', label: 'Edit', icon: 'pencil', onSelect: () => {} },
  { key: 'cancel', label: 'Cancel SO', group: 'danger', onSelect: () => {} },
];

export const SalesOrderList = () => (
  <DataTable<SoLine>
    sortFilter={false}
    columns={columns}
    rows={rows}
    rowMenu={menu}
    rowActionsWidth="6%"
    onRowClick={() => {}}
  />
);

export const SortedByQty = () => (
  <DataTable<SoLine>
    sortFilter={false}
    columns={columns.map((c) => (c.id === 'order_qty' ? { ...c, sortField: 'qty' } : c))}
    rows={[...rows].sort((a, b) => b.orderQty - a.orderQty)}
    sortBy="qty"
    sortDir="desc"
    onSort={() => {}}
    rowMenu={menu}
    rowActionsWidth="6%"
  />
);

export const Empty = () => (
  <DataTable<SoLine>
    sortFilter={false}
    columns={columns}
    rows={[]}
    rowMenu={menu}
    rowActionsWidth="6%"
    empty="No SOs yet."
  />
);

export const Loading = () => (
  <DataTable<SoLine>
    sortFilter={false}
    columns={columns}
    rows={[]}
    rowMenu={menu}
    rowActionsWidth="6%"
    loading
  />
);
