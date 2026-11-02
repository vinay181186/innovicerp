// ADR-265 — decide any waiting approval in place. ONE hook, used by the home
// Approvals view and Settings → Approvals (approvals-list.tsx). It owns no
// approval rules: each `kind` goes to the document's EXISTING decide mutation,
// and the server checks the caller's right on every call.
//
//   po       useApprove/RejectPurchaseOrder
//   rc       useApprove/RejectRouteCard    (expectedUpdatedAt = row.version, §20.4)
//   logEntry useDecideOpLogTimeChange
//   cancel   useDecideCancel
//   dayLog   useApprove/RejectDayLogEdit   (requestedAt = row.version)
//   edit     useDecideDocumentEdit         (per change; Review panel)
//
// A row locks the INSTANT it is clicked and stays locked until the refetch
// drops it (no double tick); a refused row unlocks at once and shows the
// server's words. Bulk "✓ Approve N" is one request per row, each reporting
// its own outcome.

import type { WaitingApprovalRow } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { cancelKeys, useDecideCancel } from '@/modules/cancel-requests/api';
import { dashboardKeys, notificationKeys } from '@/modules/dashboard/api';
import { dayLogKeys, useApproveDayLogEdit, useRejectDayLogEdit } from '@/modules/day-logs/api';
import { documentEditsKeys, useDecideDocumentEdit } from '@/modules/document-edits/api';
import { opEntryKeys, useDecideOpLogTimeChange } from '@/modules/op-entry/api';
import {
  purchaseOrdersKeys,
  useApprovePurchaseOrder,
  useRejectPurchaseOrder,
} from '@/modules/purchase-orders/api';
import { routeCardsKeys, useApproveRouteCard, useRejectRouteCard } from '@/modules/route-cards/api';
import { useToast } from '@/ui/feedback';
import { approvalsKeys } from './api';

export const approvalKey = (r: WaitingApprovalRow): string => `${r.kind}:${r.id}`;

export const decideErrText = (e: unknown): string =>
  e instanceof Error ? e.message : 'Could not record the decision.';

const MODULE_ROOT = {
  po: purchaseOrdersKeys.all,
  rc: routeCardsKeys.all,
  logEntry: opEntryKeys.all,
  cancel: cancelKeys.all,
  dayLog: dayLogKeys.all,
  edit: documentEditsKeys.all,
} as const;

/** `rows`: the waiting rows on screen now — a locked row that is gone
 *  (decided and refetched) drops out of the locked set. */
export function useDecideApproval(rows: readonly WaitingApprovalRow[]) {
  const qc = useQueryClient();
  const toast = useToast();
  const approvePo = useApprovePurchaseOrder();
  const rejectPo = useRejectPurchaseOrder();
  const approveRc = useApproveRouteCard();
  const rejectRc = useRejectRouteCard();
  const decideLog = useDecideOpLogTimeChange();
  const decideCancel = useDecideCancel();
  const approveDay = useApproveDayLogEdit();
  const rejectDay = useRejectDayLogEdit();
  const decideEdit = useDecideDocumentEdit();
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const presentKeys = rows.map(approvalKey).join('|');
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

  const refresh = (kinds: Iterable<WaitingApprovalRow['kind']>): void => {
    void qc.invalidateQueries({ queryKey: approvalsKeys.all });
    void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
    // The bell: a decision changes what people are notified about.
    void qc.invalidateQueries({ queryKey: notificationKeys.all });
    for (const k of new Set(kinds)) void qc.invalidateQueries({ queryKey: MODULE_ROOT[k] });
  };

  async function approveOne(r: WaitingApprovalRow): Promise<void> {
    const v = r.version ?? undefined;
    switch (r.kind) {
      case 'po':
        await approvePo.mutateAsync({ id: r.id });
        return;
      case 'rc':
        await approveRc.mutateAsync({ id: r.id, ...(v ? { expectedUpdatedAt: v } : {}) });
        return;
      case 'logEntry':
        await decideLog.mutateAsync({ id: r.id, decision: 'approve' });
        return;
      case 'cancel':
        await decideCancel.mutateAsync({ id: r.id, decision: 'approve' });
        return;
      case 'dayLog':
        await approveDay.mutateAsync({ id: r.id, requestedAt: v ?? '' });
        return;
      case 'edit':
        // Change requests are decided field by field in the Review panel only.
        throw new Error('Open Review to decide this change request.');
    }
  }

  async function rejectOne(r: WaitingApprovalRow, reason: string): Promise<void> {
    const v = r.version ?? undefined;
    switch (r.kind) {
      case 'po':
        await rejectPo.mutateAsync({ id: r.id, reason });
        return;
      case 'rc':
        await rejectRc.mutateAsync({ id: r.id, reason, ...(v ? { expectedUpdatedAt: v } : {}) });
        return;
      case 'logEntry':
        await decideLog.mutateAsync({ id: r.id, decision: 'reject', decisionReason: reason });
        return;
      case 'cancel':
        await decideCancel.mutateAsync({ id: r.id, decision: 'reject', note: reason });
        return;
      case 'dayLog':
        await rejectDay.mutateAsync({ id: r.id, requestedAt: v ?? '', reason });
        return;
      case 'edit':
        // Change requests are decided field by field in the Review panel only.
        throw new Error('Open Review to decide this change request.');
    }
  }

  /** Approve each row in turn; each refused row shows its own message and stays. */
  async function approve(list: WaitingApprovalRow[]): Promise<void> {
    const todo = list.filter((r) => !busy.has(approvalKey(r)));
    if (todo.length === 0) return;
    lock(todo.map(approvalKey), true);
    let ok = 0;
    for (const r of todo) {
      try {
        await approveOne(r);
        ok += 1;
      } catch (e) {
        lock([approvalKey(r)], false);
        toast.error(`${r.docCode}: ${decideErrText(e)}`);
      }
    }
    if (ok > 0)
      toast.ok(
        ok === 1 && todo.length === 1 ? `✓ ${todo[0]!.docCode} approved` : `✓ ${ok} approved`,
      );
    refresh(todo.map((r) => r.kind));
  }

  async function reject(r: WaitingApprovalRow, reason: string): Promise<void> {
    const k = approvalKey(r);
    if (busy.has(k)) return;
    lock([k], true);
    try {
      await rejectOne(r, reason);
      toast.ok(`✕ ${r.docCode} rejected`);
    } catch (e) {
      lock([k], false);
      toast.error(`${r.docCode}: ${decideErrText(e)}`);
    }
    refresh([r.kind]);
  }

  /** Review panel: decide some of an edit request's changes. Throws the
   *  server's error (409 …) so the panel can show it. */
  async function decideChanges(
    r: WaitingApprovalRow,
    changeIds: string[],
    decision: 'approve' | 'reject',
    reason?: string,
  ): Promise<void> {
    try {
      await decideEdit.mutateAsync({
        id: r.id,
        decisions: changeIds.map((changeId) =>
          decision === 'reject'
            ? { changeId, decision: 'reject' as const, reason: reason ?? '' }
            : { changeId, decision: 'approve' as const },
        ),
      });
    } finally {
      refresh(['edit']);
    }
  }

  return { busy, approve, reject, decideChanges };
}
