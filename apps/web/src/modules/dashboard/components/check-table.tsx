// ADR-262 — the documents of one opened check, in THE table (DataTable, owner
// rule: no hand-built tables). Columns: Sr · head[0] · head[1] · Item · Qty ·
// head[2] · Status. No per-row expand and no row actions (owner). Document and
// reference codes render through <ActionLink fallback="text">: a link when the
// caller may open that page, plain text when not.

import type { DashCheck, DashCheckRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { DocRef, linkProps } from './dash-text';
import { ActionLink } from '@/components/shared/action-link';
import { fmtQty, StatusPill } from './dash-row';

function columns(check: DashCheck): DataTableColumn<DashCheckRow>[] {
  return [
    { id: 'sr', header: 'Sr', kind: 'num', align: 'right', render: (_r, i) => i + 1 },
    {
      id: 'doc',
      header: check.head[0],
      label: check.head[0],
      kind: 'code',
      filterValue: (r) => r.docCode,
      render: (r) => (
        <span className="dh-doc">
          <DocRef code={r.docCode} href={r.docHref} />
        </span>
      ),
    },
    {
      id: 'ref',
      header: check.head[1],
      label: check.head[1],
      kind: 'text',
      ellipsis: true,
      filterValue: (r) => [r.refCode, r.party].filter(Boolean).join(' '),
      title: (r) => [r.refCode, r.party].filter(Boolean).join(' · '),
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
      filterValue: (r) => [r.itemCode, r.itemName].filter(Boolean).join(' '),
      title: (r) => [r.itemCode, r.itemName].filter(Boolean).join(' '),
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
      render: (r) => (r.qty == null ? '—' : `${fmtQty(r.qty)}${r.uom ? ` ${r.uom}` : ''}`),
    },
    {
      id: 'date',
      header: check.head[2],
      label: check.head[2],
      kind: 'date',
      filterValue: (r) => r.checkDate,
      render: (r) => fmtDate(r.checkDate),
    },
    {
      id: 'status',
      header: 'Status',
      kind: 'badge',
      filterValue: (r) => r.statusLabel,
      render: (r) => <StatusPill label={r.statusLabel} tone={r.tone} />,
    },
  ];
}

export function CheckTable({ check }: { check: DashCheck }): React.JSX.Element {
  const more = check.count > check.rows.length;
  return (
    <div className="dh-check-body">
      <DataTable
        tableKey={TABLE_KEYS.dashCheck}
        columns={columns(check)}
        rows={check.rows}
        rowKey={(r) => r.key}
        sortFilter={false}
        emptyText="Nothing waiting."
      />
      {more ? (
        <div className="dh-morerow">
          <span>
            Showing {check.rows.length} of {check.count}
          </span>
          <ActionLink {...linkProps(check.href)} check={check.href} className="dh-link">
            View all {check.count}
          </ActionLink>
        </div>
      ) : null}
    </div>
  );
}
