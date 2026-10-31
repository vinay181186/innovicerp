// ADR-250 — Approval inbox on the home. Rendered only when the server sends
// `approvals` (the caller holds an Approve tick). Same rows as GET
// /approvals/inbox; ✓ / ✕ call the Approvals page's own mutations
// (use-approval-actions.ts). ADR-264: shown inside the home's Approvals view,
// in THE table (DataTable) with the Approvals page's own row ✓ / ✗ — the
// hand-built rows are gone (owner 31-Oct: "should be uniform").

import type { ApprovalInboxResponse, ApprovalInboxRow } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { ApprovalRejectDialog } from '@/modules/approvals/components/approval-reject-dialog';
import { ApprovalRowActions } from '@/modules/approvals/components/approval-tab';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { type InboxItem, inboxKey, useApprovalActions } from '../use-approval-actions';
import { fmtAmount, fmtQty } from './dash-row';
import { DocRef } from './dash-text';
import { ViewAll } from './home-panel';

const text = (v: string | null): string => v ?? '—';

function columns(showAmount: boolean): DataTableColumn<InboxItem>[] {
  const r = (i: InboxItem): ApprovalInboxRow => i.row;
  return [
    {
      id: 'doc',
      header: 'Document',
      kind: 'code',
      filterValue: (i) => r(i).docCode,
      render: (i) => (
        <span className="dh-doc">
          <DocRef code={r(i).docCode} href={r(i).navPage} />
        </span>
      ),
    },
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      filterValue: (i) => r(i).itemCode,
      render: (i) => (r(i).itemCode ? <span className="dh-code">{r(i).itemCode}</span> : '—'),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      ellipsis: true,
      className: 'text3',
      filterValue: (i) => r(i).itemName,
      title: (i) => r(i).itemName ?? '',
      render: (i) => text(r(i).itemName),
    },
    {
      id: 'qty',
      header: 'Qty',
      kind: 'num',
      align: 'right',
      filterValue: (i) => r(i).docQty,
      render: (i) => (r(i).docQty == null ? '—' : fmtQty(r(i).docQty as number)),
    },
    ...(showAmount
      ? [
          {
            id: 'amount',
            header: 'Subtotal',
            kind: 'num' as const,
            align: 'right' as const,
            filterValue: (i: InboxItem) => r(i).docAmount,
            render: (i: InboxItem) =>
              r(i).docAmount == null ? '—' : fmtAmount(r(i).docAmount as number),
          },
        ]
      : []),
    {
      id: 'raised_by',
      header: 'Raised By',
      kind: 'text',
      ellipsis: true,
      filterValue: (i) => r(i).createdByName,
      title: (i) => r(i).createdByName ?? '',
      render: (i) => text(r(i).createdByName),
    },
    {
      id: 'raised_on',
      header: 'Raised On',
      kind: 'date',
      filterValue: (i) => r(i).createdAt,
      render: (i) => fmtDate(r(i).createdAt),
    },
  ];
}

export function ApprovalInbox({
  approvals,
}: {
  approvals: ApprovalInboxResponse;
}): React.JSX.Element {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<InboxItem | null>(null);

  const items = useMemo<InboxItem[]>(
    () => [
      // PRs need no approval (owner rule 2026-10-31) — `approvals.pr` is ignored.
      ...approvals.po.map((row) => ({ kind: 'po' as const, row })),
      // ADR-253 — NEW Route Cards (older API answers carry no `rc`).
      ...(approvals.rc ?? []).map((row) => ({ kind: 'rc' as const, row })),
      ...approvals.logEntry.map((row) => ({ kind: 'logEntry' as const, row })),
    ],
    [approvals],
  );
  const keys = items.map(inboxKey);
  const actions = useApprovalActions(keys.join('|'));
  const total = approvals.counts.po + (approvals.counts.rc ?? 0) + approvals.counts.logEntry;
  // Subtotal only when the caller sees prices (the server sends null otherwise).
  const showAmount = items.some((i) => i.row.docAmount != null);
  // A selection only ever holds rows still on screen.
  const selectedKeys = new Set(keys.filter((k) => sel.has(k)));

  const approve = (list: InboxItem[]): void => {
    void actions
      .approve(list)
      .then(() =>
        setSel((prev) => new Set([...prev].filter((k) => !list.some((i) => inboxKey(i) === k)))),
      );
  };

  return (
    <section aria-label="Approval inbox">
      <DataTable
        tableKey={TABLE_KEYS.dashApproval}
        columns={columns(showAmount)}
        rows={items}
        rowKey={inboxKey}
        // At most a page of the inbox; full sort / filter is on the Approvals page.
        sortFilter={false}
        emptyText="Nothing to approve."
        selectable
        selectedKeys={selectedKeys}
        onToggleRow={(k, _row, next) =>
          setSel((prev) => {
            const out = new Set(prev);
            if (next) out.add(String(k));
            else out.delete(String(k));
            return out;
          })
        }
        onToggleAll={(next, all) => setSel(next ? new Set(all.map(String)) : new Set())}
        selectionActions={(rows) => (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(rows)}>
            ✓ Approve {rows.length}
          </button>
        )}
        rowActions={(i) => (
          <ApprovalRowActions
            busy={actions.busy.has(inboxKey(i))}
            onApprove={() => approve([i])}
            onReject={() => setRejecting(i)}
          />
        )}
      />
      {total > items.length ? <ViewAll href="/approvals" total={total} /> : null}
      {rejecting ? (
        <ApprovalRejectDialog
          title={`Reject — ${rejecting.row.docCode}`}
          prompt="Why is this rejected?"
          onCancel={() => setRejecting(null)}
          onReject={(reason) => {
            const i = rejecting;
            setRejecting(null);
            void actions.reject(i, reason);
          }}
        />
      ) : null}
    </section>
  );
}
