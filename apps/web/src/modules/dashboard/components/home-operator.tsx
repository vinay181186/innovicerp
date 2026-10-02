// Operator home — mirror of legacy _homeOperatorView (L2674). Currently
// running, today's output, ready-for-you table. The operator-strip My Work is
// rendered by the shell.

import type { HomeResponse, ReadyOpRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { useOperatorReady } from '../api';

function elapsedStr(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

// "Ready for You" columns for the ADR-199 fit sheet. JC No. is the pinned first
// column; Item Name is hidden by default and shows in the ▸ detail row. Numbers
// right-align; the ▶ Start action is the last column (rowActions).
const READY_DEFAULT_HIDDEN = ['item_name'];

function readyColumns(): DataTableColumn<ReadyOpRow>[] {
  return [
    {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code fw-700',
      render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.jcCode}</span>,
    },
    {
      id: 'op',
      kind: 'code',
      header: 'Op',
      className: 'mono',
      render: (r) => opSrNo(r.opSeq),
    },
    {
      id: 'planned_machine',
      kind: 'code',
      header: 'Planned Machine',
      render: (r) => <b>{r.machine ?? '—'}</b>,
    },
    {
      // The item code is how an operator finds the drawing, so it carries the
      // darkest text token and the bold weight (item-code rule). The part name
      // beside it stays muted — a quiet name next to a strong code is what makes
      // the code findable.
      id: 'item_code',
      kind: 'code',
      header: 'Item Code',
      className: 'td-code fw-700',
      render: (r) => (
        <span style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(r.itemCode, r.itemRevision, '')}
        </span>
      ),
    },
    {
      // Hidden by default → shows in the ▸ detail. A card with no SO line behind
      // it has no name and the cell stays blank rather than printing a dash.
      id: 'item_name',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (r) => r.itemName ?? '',
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'available',
      kind: 'num',
      header: 'Available',
      align: 'right',
      headColor: 'var(--sig-warn)',
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--sig-warn)' }}>{r.available}</span>,
    },
    {
      id: 'due_date',
      kind: 'date',
      header: 'Due Date',
      render: (r) => (
        <span
          style={{
            color: r.isOverdue ? 'var(--sig-critical)' : 'var(--text2)',
            fontWeight: r.isOverdue ? 700 : 400,
          }}
        >
          {fmtDate(r.dueDate)}
          {r.isOverdue ? ' ⚠' : ''}
        </span>
      ),
    },
  ];
}

export function HomeOperator({ home }: { home: HomeResponse }): React.JSX.Element {
  const o = home.operator!;
  // ADR-201: Ready for You pages at 25 on the server. Page 1 comes with the
  // home read; later pages from /dashboard/operator-ready. The count is the
  // server's figure over EVERY ready op (o.readyCount), never this page's rows.
  const [page, setPage] = useState(1);
  const more = useOperatorReady(pageOffset(page), page > 1);
  const readyRows = page > 1 ? (more.data?.items ?? []) : o.ready;
  const readyTotal = page > 1 ? (more.data?.total ?? o.readyCount) : o.readyCount;
  useClampPage(page, readyTotal, setPage);
  return (
    <div>
      {o.running.length > 0 ? (
        <div
          className="panel"
          style={{ padding: 0, marginBottom: 14, borderLeft: '4px solid var(--sig-warn)' }}
        >
          <div className="panel-hdr" style={{ background: 'var(--sig-warn-bg)' }}>
            <span className="panel-title" style={{ color: 'var(--sig-warn)' }}>
              ▶ Currently Running
            </span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            {o.running.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--cyan)' }}>
                    {r.jcCode} · Op {opSrNo(r.opSeq)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {r.operation} on <b>{r.machine ?? '—'}</b>
                  </div>
                  {/* WHAT is on the machine -- the JC number alone says which
                      JOB, not which part. This row is a flexWrap strip of
                      minWidth-200 blocks and a fifth sibling block wraps the
                      whole card on a phone-width panel, so the item goes INSIDE
                      the block that already carries the JC number: a third line,
                      no new flex child, card exactly as wide as before. A long
                      part name ellipsises on one line and carries its full text
                      in the title. No item at all renders nothing, not a dash. */}
                  {r.itemCode !== null || r.itemName !== null ? (
                    <div
                      title={[itemCodeWithRev(r.itemCode, r.itemRevision, ''), r.itemName ?? '']
                        .filter((t) => t !== '')
                        .join(' · ')}
                      style={{
                        fontSize: 11,
                        color: 'var(--text3)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {/* The code is the readable part of this line; the name
                          after it may stay muted. See the item-code rule. */}
                      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(r.itemCode, r.itemRevision, '')}
                      </span>
                      {r.itemCode !== null && r.itemName !== null ? ' · ' : ''}
                      {r.itemName ?? ''}
                    </div>
                  ) : null}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>ELAPSED</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {elapsedStr(r.elapsedMin)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>PROGRESS</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {r.completed}/{r.orderQty}
                  </div>
                </div>
                <Link to="/op-entry" className="btn btn-success btn-sm">
                  ✓ Log Completion
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* One strip, same as the admin and specialist homes (styling Rule 3). */}
      <StatStrip
        items={[
          {
            key: 'output',
            label: 'My Output Today',
            count: `${o.myOutputQty} pcs`,
            color: 'var(--sig-ok)',
            to: '/op-entry',
            sub: `Across ${o.myEntries} entries`,
          },
          {
            key: 'ready',
            label: 'Ready to Work',
            count: o.readyCount,
            color: 'var(--dept-production)',
            to: '/op-entry',
            sub: o.readyCount > 0 ? 'Pick an op below to start' : 'None ready',
          },
          {
            key: 'running',
            label: 'Running Now',
            count: o.allRunningCount,
            sub: 'Whole factory',
            color: 'var(--sig-warn)',
            to: '/production-dashboard',
          },
        ]}
      />

      <div className="panel" style={{ padding: 0 }}>
        <div className="panel-hdr">
          <span className="panel-title">Ready for You</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>
            {o.readyCount} {o.readyCount === 1 ? 'operation' : 'operations'}, soonest due first
          </span>
        </div>
        {/* THE shared fit sheet (ADR-199). JC No. is pinned; Item Name drops into
            the ▸ detail; the ▶ Start action is the last column. */}
        <DataTable<ReadyOpRow>
          tableKey={TABLE_KEYS.homeOperator}
          columns={readyColumns()}
          rows={readyRows}
          rowKey={(r, i) => `${r.jcCode}:${r.opSeq}:${i}`}
          loading={page > 1 && !more.data}
          defaultHidden={READY_DEFAULT_HIDDEN}
          maxHeight="50vh"
          empty="No operations ready. Check back soon or speak to your supervisor."
          rowActions={() => (
            <Link to="/op-entry" className="btn btn-success btn-sm" style={{ fontSize: 11 }}>
              ▶ Start Operation
            </Link>
          )}
        />
        <div style={{ padding: '0 14px 10px' }}>
          <ListFooter
            total={readyTotal}
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={setPage}
            noun="operation"
          />
        </div>
      </div>
    </div>
  );
}
