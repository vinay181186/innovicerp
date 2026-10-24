// ADR-250 — the caller's own blocks: To do (their tasks), Done (their
// activity today / yesterday), Sent for approval and Waiting (their documents
// whose next step is someone else's). Read-only.

import type {
  AccessAction,
  AccessFormKey,
  DashAction,
  DashDoneRow,
  DashRow,
  DashText,
  DashTodoRow,
  HomeResponse,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import { listUsersWithRight, type RightHolder } from '../../access-control/users-with-right';
import { loadApprovalContext } from '../../purchase-orders/service';
import {
  APPROVAL_DEFS,
  holdsRights,
  type ListCtx,
  type ListDef,
  listDef,
  type RowCtx,
  toDashRow,
} from './lists';
import { HOME_PAGE_SIZE, type RawRow, runList } from './list-query';
import { addDays, codePart, entityHref, num, str } from './util';

// ── Holders of a right — ONE memo per request, shared by every block ──
export interface Holders {
  /** Non-admin users holding `action` on `form` (listUsersWithRight). */
  of(form: AccessFormKey, action: AccessAction): Promise<RightHolder[]>;
  /** Who could approve a draft PO of this value: the approval inbox's own
   *  rule (loadApprovalContext) — Approve tick, on the PO approvers list,
   *  value within their ceiling. The raiser is dropped later (withText). */
  poApproversFor(value: number): Promise<RightHolder[]>;
}

export function makeHolders(tx: DbTransaction, cid: string): Holders {
  const memo = new Map<string, Promise<RightHolder[]>>();
  const ceilings = new Map<string, Promise<{ isApprover: boolean; approvalCeiling: number }>>();
  const of: Holders['of'] = (form, action) => {
    const k = `${form}.${action}`;
    let p = memo.get(k);
    if (!p) {
      p = listUsersWithRight(tx, cid, form, action);
      memo.set(k, p);
    }
    return p;
  };
  const ceiling = (h: RightHolder) => {
    let p = ceilings.get(h.id);
    if (!p) {
      p = loadApprovalContext(tx, cid, h.id, h.role);
      ceilings.set(h.id, p);
    }
    return p;
  };
  return {
    of,
    async poApproversFor(value) {
      const all = await of('po_create', 'approve');
      // Every approver's limit at once (memoised), not one after another.
      const ctx = await Promise.all(all.map(ceiling));
      return all.filter((_, i) => ctx[i]!.isApprover && value <= ctx[i]!.approvalCeiling);
    },
  };
}

/** "with Jinal R., Rakesh +2" — or "with an admin" when nobody else (not an
 *  admin, not the caller) qualifies. */
export function withText(holders: readonly RightHolder[], me: string): string {
  const names = holders.filter((h) => h.id !== me && !h.isAdmin).map((h) => h.name);
  if (names.length === 0) return 'with an admin';
  const shown = names.slice(0, 2).join(', ');
  return `with ${shown}${names.length > 2 ? ` +${names.length - 2}` : ''}`;
}

export function remindAction(
  holders: readonly RightHolder[],
  me: string,
  ref: { type: string; id: string; display: string; navPage: string },
): DashAction | null {
  const to = holders.find((h) => h.id !== me && !h.isAdmin);
  if (!to) return null;
  return {
    kind: 'remind',
    label: `Remind ${to.name}`,
    href: null,
    taskFor: {
      userId: to.id,
      linkedRefType: ref.type,
      linkedRefId: ref.id,
      linkedRefDisplay: ref.display.slice(0, 255),
      linkedRefNavPage: ref.navPage.length <= 64 ? ref.navPage : ref.navPage.split('?')[0]!,
    },
  };
}

export interface OwnRows {
  rows: DashRow[];
  /** Every matching document (rows stop at the first page). */
  total: number;
}

/** Rows of `d` raised by the caller, each saying who holds the next step. */
async function ownRows(
  tx: DbTransaction,
  d: ListDef,
  c: ListCtx,
  rc: RowCtx,
  whoFor: (r: RawRow) => Promise<RightHolder[]>,
  canRemind: boolean,
): Promise<OwnRows> {
  const { rows, total } = await runList(tx, d.query(c, { createdBy: rc.userId }), {
    limit: HOME_PAGE_SIZE,
  });
  const out: DashRow[] = [];
  for (const r of rows) {
    const who = await whoFor(r);
    const base = d.sub(r);
    const sub: DashText = [
      ...base,
      { text: `${base.length ? ' · ' : ''}${withText(who, rc.userId)}` },
    ];
    const remind = canRemind
      ? remindAction(who, rc.userId, {
          type: d.refType(r),
          id: r.id,
          display: r.code,
          navPage: d.docHref(r),
        })
      : null;
    out.push(toDashRow(d, r, rc, { withActions: false, extra: remind ? [remind] : [], sub }));
  }
  return { rows: out, total };
}

/** PRs (open), POs (draft) and new Route Cards (pending, ADR-253) the caller
 *  raised, waiting for an approver —
 *  named by the same eligibility the approval inbox applies. */
export async function sentForApproval(
  tx: DbTransaction,
  c: ListCtx,
  rc: RowCtx,
  holders: Holders,
  canRemind: boolean,
): Promise<DashRow[]> {
  const pr = await ownRows(
    tx,
    APPROVAL_DEFS.pr_pending,
    c,
    rc,
    () => holders.of('pr_create', 'approve'),
    canRemind,
  );
  const po = await ownRows(
    tx,
    APPROVAL_DEFS.po_draft,
    c,
    rc,
    (r) => holders.poApproversFor(r.amount ?? 0),
    canRemind,
  );
  // ADR-253 — new Route Cards the caller made, waiting for an approver.
  const rcRows = await ownRows(
    tx,
    APPROVAL_DEFS.rc_pending,
    c,
    rc,
    () => holders.of('routecard_create', 'approve'),
    canRemind,
  );
  return [...pr.rows, ...po.rows, ...rcRows.rows];
}

/** The hand-offs the Waiting block follows (approved PR → PO, JW PO → DC,
 *  GRN → QC, SO → plan, plan → PRO). */
export const WAITING_KEYS = [
  'pr_to_po',
  'po_to_dc',
  'grn_qc',
  'so_to_plan',
  'plan_to_pro',
] as const;

export async function waiting(
  tx: DbTransaction,
  c: ListCtx,
  rc: RowCtx,
  holders: Holders,
  canRemind: boolean,
): Promise<OwnRows> {
  const out: OwnRows = { rows: [], total: 0 };
  for (const key of WAITING_KEYS) {
    const d = listDef(key)!;
    if (holdsRights(rc.a, d)) continue; // the caller does this step themselves
    const [form, action] = d.rights[0]!;
    const got = await ownRows(tx, d, c, rc, () => holders.of(form, action), canRemind);
    out.rows.push(...got.rows);
    out.total += got.total;
  }
  return out;
}

// ── To do ──
export function taskBucket(due: string | null, today: string): 'late' | 'today' | 'planned' {
  if (!due) return 'planned';
  if (due < today) return 'late';
  return due === today ? 'today' : 'planned';
}

export async function todo(
  tx: DbTransaction,
  cid: string,
  userId: string,
  today: string,
): Promise<{ late: DashTodoRow[]; today: DashTodoRow[]; planned: DashTodoRow[] }> {
  const rows = (await tx.execute(sql`
    SELECT t.id, t.code, t.title, t.due_date::text AS due_date, t.viewed_at,
           t.linked_ref_display, t.linked_ref_nav_page
    FROM public.tasks t
    WHERE t.company_id = ${cid}::uuid AND t.assigned_to = ${userId}::uuid
      AND t.deleted_at IS NULL AND t.status IN ('todo', 'in_progress')
    ORDER BY t.due_date ASC NULLS LAST, t.code ASC
    LIMIT 200
  `)) as unknown as Array<Record<string, unknown>>;
  const out = {
    late: [] as DashTodoRow[],
    today: [] as DashTodoRow[],
    planned: [] as DashTodoRow[],
  };
  for (const r of rows) {
    const due = str(r['due_date']);
    const refCode = str(r['linked_ref_display']);
    const refHref = str(r['linked_ref_nav_page']);
    out[taskBucket(due, today)].push({
      taskId: String(r['id']),
      taskCode: String(r['code'] ?? ''),
      title: String(r['title'] ?? ''),
      ref: refCode && refHref ? { code: refCode, href: refHref } : null,
      dueDate: due,
      unread: r['viewed_at'] == null,
    });
  }
  return out;
}

// ── Done ──
/** The words of an activity row with its document number as a code part. */
export function doneText(detail: string, refId: string | null, href: string | null): DashText {
  if (!refId) return [{ text: detail }];
  const at = detail.indexOf(refId);
  if (at < 0) return [codePart(refId, href), ...(detail ? [{ text: ` — ${detail}` }] : [])];
  const before = detail.slice(0, at);
  const after = detail.slice(at + refId.length);
  return [
    ...(before ? [{ text: before }] : []),
    codePart(refId, href),
    ...(after ? [{ text: after }] : []),
  ];
}

const DONE_PER_DAY = 50;

export async function done(
  tx: DbTransaction,
  cid: string,
  userId: string,
  today: string,
): Promise<HomeResponse['done']> {
  const yesterday = addDays(today, -1);
  const rows = (await tx.execute(sql`
    SELECT z.ts, z.action, z.entity, z.entity_id, z.ref_id, z.detail, z.ist_day, z.day_total
    FROM (
      SELECT a.ts, a.action, a.entity, a.entity_id::text AS entity_id, a.ref_id, a.detail,
             (a.ts AT TIME ZONE 'Asia/Kolkata')::date::text AS ist_day,
             ROW_NUMBER() OVER (PARTITION BY (a.ts AT TIME ZONE 'Asia/Kolkata')::date
                                ORDER BY a.ts DESC) AS rn,
             COUNT(*) OVER (PARTITION BY (a.ts AT TIME ZONE 'Asia/Kolkata')::date)::int AS day_total
      FROM public.activity_log a
      WHERE a.company_id = ${cid}::uuid AND a.user_id = ${userId}::uuid
        AND a.ts >= ((${yesterday}::date)::timestamp AT TIME ZONE 'Asia/Kolkata')
        AND a.ts < ((${today}::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
    ) z
    WHERE z.rn <= ${DONE_PER_DAY}
    ORDER BY z.ts DESC
  `)) as unknown as Array<Record<string, unknown>>;
  const out: HomeResponse['done'] = { today: [], yesterday: [], todayTotal: 0, yesterdayTotal: 0 };
  for (const r of rows) {
    // day_total counts the WHOLE India-time day; the rows stop at DONE_PER_DAY.
    if (r['ist_day'] === today) out.todayTotal = num(r['day_total']);
    else out.yesterdayTotal = num(r['day_total']);
    const ts = r['ts'] instanceof Date ? r['ts'] : new Date(String(r['ts']));
    const refId = str(r['ref_id']);
    const row: DashDoneRow = {
      ts: ts.toISOString(),
      action: String(r['action'] ?? ''),
      text: doneText(
        String(r['detail'] ?? ''),
        refId,
        entityHref(String(r['entity'] ?? ''), str(r['entity_id']), refId),
      ),
    };
    (r['ist_day'] === today ? out.today : out.yesterday).push(row);
  }
  return out;
}
