// ADR-250 — Approval inbox on the home. Rendered only when the server sends
// `approvals` (the caller holds an Approve tick). Same rows as GET
// /approvals/inbox; ✓ / ✕ call the Approvals page's own mutations
// (use-approval-actions.ts). ADR-264: shown inside the home's Approvals view;
// the "Sent by me" tab is gone (owner decision).

import type { ApprovalInboxResponse } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { ActionLink } from '@/components/shared/action-link';
import { fmtDate } from '@/lib/date';
import { ApprovalRejectDialog } from '@/modules/approvals/components/approval-reject-dialog';
import { type InboxItem, inboxKey, useApprovalActions } from '../use-approval-actions';
import { fmtAmount, fmtQty, ItemCell, RowHead, StatusPill } from './dash-row';
import { DocRef, linkProps } from './dash-text';
import { Empty, ViewAll } from './home-panel';

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
    );

  return (
    <section className="dh-panel" aria-label="Approval inbox">
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
    </section>
  );
}
