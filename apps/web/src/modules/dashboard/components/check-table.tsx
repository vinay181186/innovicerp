// ADR-264 — the documents of one opened check, in THE table (DataTable, owner
// rule: no hand-built tables). Columns: Sr No · head[0] · head[1] · Item · Qty ·
// head[2] · Status. No per-row expand and no row actions (owner). Checks are
// shown by department tier, so the caller may not be able to open every page:
// document / reference codes and "View all N" render through
// <ActionLink fallback="text"> — a link when the caller may open that page,
// plain text when not.
//
// ADR-312 — the "View all N" page (/checks/<key>) draws the SAME table through
// <CheckRowsTable>: same columns, same cells, only the rows (one server page)
// and the Sr No start (page offset + 1) differ.

import { dashCheckPagePath, type DashCheck, type DashCheckRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { srNoColumn } from '@/ui/data/lead-columns';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { DocRef, linkProps } from './dash-text';
import { ActionLink } from '@/components/shared/action-link';
import { fmtQty, StatusPill } from './dash-row';

const refText = (r: DashCheckRow): string => [r.refCode, r.party].filter(Boolean).join(' · ');
const itemText = (r: DashCheckRow): string => [r.itemCode, r.itemName].filter(Boolean).join(' ');
const qtyText = (r: DashCheckRow): string =>
  r.qty == null ? '—' : `${fmtQty(r.qty)}${r.uom ? ` ${r.uom}` : ''}`;

/** The check table's columns. `head` = the check's [document, reference, date]
 *  names; `firstRowNo` = the Sr No of the first row (1 on the home, page
 *  offset + 1 on the View-all page). `exportValue`s give the Excel the same
 *  words the cells show. */
export function checkColumns(
  head: DashCheck['head'],
  firstRowNo = 1,
): DataTableColumn<DashCheckRow>[] {
  return [
    srNoColumn<DashCheckRow>(firstRowNo),
    {
      id: 'doc',
      header: head[0],
      label: head[0],
      kind: 'code',
      filterValue: (r) => r.docCode,
      exportValue: (r) => r.docCode,
      render: (r) => (
        <span className="dh-doc">
          <DocRef code={r.docCode} href={r.docHref} />
        </span>
      ),
    },
    {
      id: 'ref',
      header: head[1],
      label: head[1],
      kind: 'text',
      ellipsis: true,
      filterValue: (r) => [r.refCode, r.party].filter(Boolean).join(' '),
      exportValue: (r) => refText(r) || '—',
      title: refText,
      render: (r) => (
        <>
          {r.refCode ? (
            r.refHref ? (
              <span className="dh-doc">
                <DocRef code={r.refCode} href={r.refHref} />
              </span>
            ) : (
              <span className="dh-doc">{r.refCode}</span>
            )
          ) : null}
          {r.party ? <span className="dh-mut"> {r.party}</span> : null}
          {!r.refCode && !r.party ? '—' : null}
        </>
      ),
    },
    {
      id: 'item',
      header: 'Item',
      kind: 'text',
      ellipsis: true,
      filterValue: itemText,
      exportValue: (r) => itemText(r) || '—',
      title: itemText,
      render: (r) =>
        r.itemCode || r.itemName ? (
          <>
            {r.itemCode ? <span className="dh-code">{r.itemCode}</span> : null}
            {r.itemName ? <span className="dh-mut"> {r.itemName}</span> : null}
          </>
        ) : (
          '—'
        ),
    },
    {
      id: 'qty',
      header: 'Qty',
      kind: 'num',
      align: 'right',
      filterValue: (r) => r.qty,
      exportValue: (r) => r.qty,
      render: qtyText,
    },
    {
      id: 'date',
      header: head[2],
      label: head[2],
      kind: 'date',
      filterValue: (r) => r.checkDate,
      exportValue: (r) => fmtDate(r.checkDate),
      render: (r) => fmtDate(r.checkDate),
    },
    {
      id: 'status',
      header: 'Status',
      kind: 'badge',
      filterValue: (r) => r.statusLabel,
      exportValue: (r) => r.statusLabel,
      render: (r) => <StatusPill label={r.statusLabel} tone={r.tone} />,
    },
  ];
}

/** THE check table — the home check and the View-all page both draw it. */
export function CheckRowsTable({
  tableKey,
  columns,
  rows,
  loading,
  emptyText,
}: {
  tableKey: string;
  /** checkColumns(head, firstRowNo) — passed in so the page's Export uses
   *  the very same array. */
  columns: DataTableColumn<DashCheckRow>[];
  rows: DashCheckRow[];
  loading?: boolean | undefined;
  emptyText: string;
}): React.JSX.Element {
  return (
    <DataTable
      tableKey={tableKey}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      loading={loading}
      // No ▾ sort/filter: the home shows at most 8 rows of a server list and
      // every check shares one saved key, so a filter would cross-filter the
      // other checks; the View-all page has no server sort/filter (ADR-312
      // contract: search + page only), and a ▾ over 25 rows would hide rows.
      sortFilter={false}
      emptyText={emptyText}
    />
  );
}

export function CheckTable({ check }: { check: DashCheck }): React.JSX.Element {
  const more = check.count > check.rows.length;
  const pageHref = dashCheckPagePath(check.key);
  return (
    <div className="dh-check-body">
      <CheckRowsTable
        tableKey={TABLE_KEYS.dashCheck}
        // Unpaged — the check's first rows come whole, so Sr No starts at 1.
        columns={checkColumns(check.head, 1)}
        rows={check.rows}
        emptyText="No documents yet."
      />
      {more ? (
        <div className="dh-morerow">
          <span>
            Showing {check.rows.length} of {check.count}
          </span>
          <ActionLink {...linkProps(pageHref)} check={pageHref} fallback="text" className="dh-link">
            View all {check.count}
          </ActionLink>
        </div>
      ) : null}
    </div>
  );
}
