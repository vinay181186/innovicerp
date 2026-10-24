// ADR-250 — approve / reject from the home's Approval inbox, through the SAME
// mutations the Approvals page uses (inbox-approval-tab.tsx,
// log-entry-approvals.tsx). The server checks every row; bulk approve is that
// one mutation looped per selected row, and each row's answer is reported.
// A refused row (409: already decided, over limit …) shows the server's words,
// then home and the inbox are refetched.

import type { ApprovalInboxRow } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { approvalsKeys } from '@/modules/approvals/api';
import { useDecideOpLogTimeChange } from '@/modules/op-entry/api';
import { useApprovePurchaseOrder, useRejectPurchaseOrder } from '@/modules/purchase-orders/api';
import { useApprovePr, useRejectPr } from '@/modules/purchase-requests/api';
import { useApproveRouteCard, useRejectRouteCard } from '@/modules/route-cards/api';
import { useToast } from '@/ui/feedback';
import { dashboardKeys } from './api';

export type InboxKind = 'pr' | 'po' | 'rc' | 'logEntry';
export interface InboxItem {
  kind: InboxKind;
  row: ApprovalInboxRow;
}
export const inboxKey = (i: InboxItem): string => `${i.kind}:${i.row.id}`;

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : 'Could not record the decision.';

/** `presentKeys`: the inbox rows on screen now — a locked row that is gone
 *  (decided and refetched) drops out of the locked set; a refused row is
 *  unlocked at once in the catch. */
export function useApprovalActions(presentKeys: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const approvePr = useApprovePr();
  const rejectPr = useRejectPr();
  const approvePo = useApprovePurchaseOrder();
  const rejectPo = useRejectPurchaseOrder();
  const decideLog = useDecideOpLogTimeChange();
  // ADR-253 — NEW Route Cards.
  const approveRc = useApproveRouteCard();
  const rejectRc = useRejectRouteCard();
  // Rows locked after a click until the refetch drops them — no double tick.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    const present = new Set(presentKeys.split('|'));
    setBusy((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((k) => present.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [presentKeys]);

  const lock = (keys: string[], on: boolean): void =>
    setBusy((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });

  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
    void qc.invalidateQueries({ queryKey: approvalsKeys.inbox() });
  };

  async function approveOne(i: InboxItem): Promise<void> {
    if (i.kind === 'pr') await approvePr.mutateAsync(i.row.id);
    else if (i.kind === 'po') await approvePo.mutateAsync({ id: i.row.id });
    else if (i.kind === 'rc') await approveRc.mutateAsync({ id: i.row.id });
    else await decideLog.mutateAsync({ id: i.row.id, decision: 'approve' });
  }

  async function rejectOne(i: InboxItem, reason: string): Promise<void> {
    if (i.kind === 'pr') await rejectPr.mutateAsync({ id: i.row.id, reason });
    else if (i.kind === 'po') await rejectPo.mutateAsync({ id: i.row.id, reason });
    else if (i.kind === 'rc') await rejectRc.mutateAsync({ id: i.row.id, reason });
    else await decideLog.mutateAsync({ id: i.row.id, decision: 'reject', decisionReason: reason });
  }

  /** Approve each item in turn; one toast with the per-row outcome. */
  async function approve(items: InboxItem[]): Promise<void> {
    const todo = items.filter((i) => !busy.has(inboxKey(i)));
    if (todo.length === 0) return;
    lock(todo.map(inboxKey), true);
    const failed: string[] = [];
    let ok = 0;
    for (const i of todo) {
      try {
        await approveOne(i);
        ok += 1;
      } catch (e) {
        failed.push(`${i.row.docCode}: ${errText(e)}`);
        lock([inboxKey(i)], false);
      }
    }
    if (ok > 0)
      toast.ok(
        ok === 1 && todo.length === 1 ? `✓ ${todo[0]!.row.docCode} approved` : `✓ ${ok} approved`,
      );
    for (const f of failed) toast.error(f);
    refresh();
  }

  async function reject(i: InboxItem, reason: string): Promise<void> {
    const k = inboxKey(i);
    if (busy.has(k)) return;
    lock([k], true);
    try {
      await rejectOne(i, reason);
      toast.ok(`✕ ${i.row.docCode} rejected`);
    } catch (e) {
      lock([k], false);
      toast.error(`${i.row.docCode}: ${errText(e)}`);
    }
    refresh();
  }

  return { busy, approve, reject };
}
