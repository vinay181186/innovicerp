// NEW Route Cards waiting for THIS user's approval — the RC half of GET
// /approvals/inbox (ADR-253, modelled on purchase-requests/approval-inbox.ts).
// The rules are approveRouteCard's own: Approve on Route Card Master and the
// card Pending Approval. The creator's own cards are INCLUDED — self-approval
// is allowed (owner, 2026-10-24). A Route Card carries no qty, value or vendor.

import type { ApprovalInboxRow } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { timestampMs } from '../../lib/edit-conflict';

/** The caller's Access Control answer for the RC inbox. Read BEFORE opening
 *  the inbox transaction (each check opens its own). */
export interface RcInboxAccess {
  canApprove: boolean;
  /** No money on a Route Card — always false, kept for the shared inbox shape. */
  showMoney: boolean;
}

export async function loadRcInboxAccess(user: AuthContext): Promise<RcInboxAccess> {
  return { canApprove: await hasFormAccess(user, 'routecard_create', 'approve'), showMoney: false };
}

/** Where a waiting card opens. */
export const rcNavPage = (id: string): string => `/route-cards/${id}`;

/** THE "pending Route Card" filter, on a route_cards alias `rc` already in
 *  the query: this company, live, Pending Approval. One place — the approvals
 *  inbox (list + paged) and the per-person home's rc_pending row all use it. */
export function rcPendingWhereSql(companyId: string): SQL {
  return sql`rc.company_id = ${companyId}::uuid
      AND rc.deleted_at IS NULL
      AND rc.approval_status = 'pending'`;
}

/** A waiting card plus its `updatedAt` — the `expectedUpdatedAt` the approve /
 *  reject endpoints check (§20.4). ADR-265's waiting list sends it as `version`. */
export type RcWaitingRow = ApprovalInboxRow & { version: string };

interface RcRaw {
  id: string;
  doc_code: string;
  item_code: string | null;
  item_name: string | null;
  created_by_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

async function readRcRows(tx: DbTransaction, companyId: string): Promise<RcRaw[]> {
  // The same row set the paged inbox (approvals/inbox-list.ts) reads.
  return (await tx.execute(sql`
    SELECT t.id, t.doc_code, t.item_code, t.item_name, t.created_by_name, t.created_at,
      t.updated_at
    FROM (${rcInboxRowsSql(companyId)}) t
    ORDER BY t.created_at
  `)) as unknown as RcRaw[];
}

function toInboxRow(r: RcRaw): ApprovalInboxRow {
  return {
    id: String(r.id),
    docCode: String(r.doc_code),
    vendorName: null,
    itemCode: r.item_code ?? null,
    itemName: r.item_name ?? null,
    docQty: null,
    docAmount: null,
    createdByName: r.created_by_name || null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    navPage: rcNavPage(String(r.id)),
  };
}

/** NEW Route Cards waiting for the caller's approval (ADR-253), each with its
 *  `version` for the approve endpoint's expectedUpdatedAt (ADR-265). */
export async function listRcWaiting(
  tx: DbTransaction,
  companyId: string,
  access: RcInboxAccess,
): Promise<RcWaitingRow[]> {
  if (!access.canApprove) return [];
  return (await readRcRows(tx, companyId)).map((r) => ({
    ...toInboxRow(r),
    version: new Date(timestampMs(r.updated_at)).toISOString(),
  }));
}

/** The same rows as the `t` row set approvals/inbox-list.ts pages over. */
export function rcInboxRowsSql(companyId: string): SQL {
  return sql`
    SELECT rc.id, rc.code AS doc_code,
      NULL::text AS vendor_name,
      i.code AS item_code, i.name AS item_name,
      NULL::float AS doc_qty, NULL::float AS doc_amount,
      COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1)) AS created_by_name,
      rc.created_at, rc.updated_at
    FROM public.route_cards rc
    LEFT JOIN public.items i ON i.id = rc.item_id
    LEFT JOIN public.users u ON u.id = rc.created_by
    WHERE ${rcPendingWhereSql(companyId)}`;
}
