// ADR-250 — Approval inbox on the home. Rendered only when the server sends
// `approvals` (the caller holds an Approve tick). Same rows as GET
// /approvals/inbox; ✓ / ✕ call the Approvals page's own mutations
// (use-approval-actions.ts). "Sent by me" lists the caller's documents waiting
// for someone else's approval.

import type { ApprovalInboxResponse, DashRow } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { ActionLink } from '@/components/shared/action-link';
import { fmtDate } from '@/lib/date';
import { ApprovalRejectDialog } from '@/modules/approvals/components/approval-reject-dialog';
import { type InboxItem, inboxKey, useApprovalActions } from '../use-approval-actions';
import { DashRowView, fmtAmount, fmtQty, ItemCell, RowHead, StatusPill } from './dash-row';
import { DocRef, linkProps } from './dash-text';
import { Empty, HomePanel, HomeTabs, ViewAll } from './home-panel';

type Tab = 'to' | 'sent';

function InboxRow({
  item,
  selected,
  busy,
  onSelect,
  onApprove,
  onReject,
}: {
  item: InboxItem;
  selected: boolean;
  busy: boolean;
  onSelect: (on: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
}): React.JSX.Element {
  const r = item.row;
  const sub = [r.vendorName, r.createdByName ? `from ${r.createdByName}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="dh-row dh-ap" aria-busy={busy}>
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Select ${r.docCode}`}
        onChange={(e) => onSelect(e.target.checked)}
      />
      <div className="dh-d">
        <span className="dh-code">
          <DocRef code={r.docCode} href={r.navPage} />
        </span>
        {sub ? <div className="dh-sub">{sub}</div> : null}
      </div>
      <ItemCell
        code={r.itemCode}
        name={r.itemName}
        extra={r.docAmount == null ? undefined : fmtAmount(r.docAmount)}
      />
      <div className="dh-q">{r.docQty == null ? '—' : fmtQty(r.docQty)}</div>
      <div className="dh-p">
        <StatusPill label={fmtDate(r.createdAt)} tone="none" />
      </div>
      <div className="dh-a">
        <button
          type="button"
          className="dh-ic k-approve"
          title={`Approve ${r.docCode}`}
          aria-label={`Approve ${r.docCode}`}
          aria-busy={busy}
          onClick={onApprove}
        >
          ✓
        </button>
        <button
          type="button"
          className="dh-ic k-reject"
          title={`Reject ${r.docCode}`}
          aria-label={`Reject ${r.docCode}`}
          aria-busy={busy}
          onClick={onReject}
        >
          ✕
        </button>
        <ActionLink
          {...linkProps(r.navPage)}
          check={r.navPage}
          className="dh-ic k-open"
          title={`Open ${r.docCode}`}
          aria-label={`Open ${r.docCode}`}
        >
          ↗
        </ActionLink>
      </div>
    </div>
  );
}

export function ApprovalInbox({
  approvals,
  sent,
}: {
  approvals: ApprovalInboxResponse;
  sent: DashRow[];
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('to');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<InboxItem | null>(null);

  const items = useMemo<InboxItem[]>(
    () => [
      ...approvals.pr.map((row) => ({ kind: 'pr' as const, row })),
      ...approvals.po.map((row) => ({ kind: 'po' as const, row })),
      ...approvals.logEntry.map((row) => ({ kind: 'logEntry' as const, row })),
    ],
    [approvals],
  );
  const keys = items.map(inboxKey);
  const actions = useApprovalActions(keys.join('|'));
  const total = approvals.counts.pr + approvals.counts.po + approvals.counts.logEntry;
  // A selection only ever holds rows still on screen.
  const selected = items.filter((i) => sel.has(inboxKey(i)));

  const toggle = (k: string, on: boolean): void =>
    setSel((prev) => {
      const next = new Set(prev);
      if (on) next.add(k);
      else next.delete(k);
      return next;
    });

  const approve = (list: InboxItem[]): void => {
    void actions
      .approve(list)
      .then(() =>
        setSel((prev) => new Set([...prev].filter((k) => !list.some((i) => inboxKey(i) === k)))),
      );
  };

  const body =
    tab === 'to' ? (
      items.length === 0 ? (
        <Empty text="Nothing to approve." />
      ) : (
        <>
          {selected.length > 0 ? (
            <div className="dh-selbar">
              {selected.length} selected
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => approve(selected)}
              >
                ✓ Approve {selected.length}
              </button>
            </div>
          ) : null}
          <RowHead head={['Document', 'Item', 'Qty', 'Raised On']} approve />
          {items.map((i) => {
            const k = inboxKey(i);
            return (
              <InboxRow
                key={k}
                item={i}
                selected={sel.has(k)}
                busy={actions.busy.has(k)}
                onSelect={(on) => toggle(k, on)}
                onApprove={() => approve([i])}
                onReject={() => setRejecting(i)}
              />
            );
          })}
          {total > items.length ? <ViewAll href="/approvals" total={total} /> : null}
        </>
      )
    ) : sent.length === 0 ? (
      <Empty text="Nothing sent by you is waiting." />
    ) : (
      <>
        <RowHead head={['Document', 'Item', 'Qty', 'Waiting']} />
        {sent.map((r) => (
          <DashRowView key={r.key} row={r} />
        ))}
      </>
    );

  return (
    <HomePanel
      title="Approval inbox"
      count={total}
      right={
        <HomeTabs
          tabs={[
            { key: 'to', label: `To approve (${total})` },
            { key: 'sent', label: `Sent by me (${sent.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {body}
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
    </HomePanel>
  );
}
