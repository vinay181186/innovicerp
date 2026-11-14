import {
  isRevWorkAllowed,
  itemRevLabel,
  opOnHoldMessage,
  REV_RELEASE_STATUS_LABELS,
  REV_WORK_ALLOWED,
  revNotReleasedMessage,
  type RevReleaseStatus,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { emitActivityLogBatch, type ActivityLogInput } from '../modules/activity-log/service';
import { jcOpRef } from '../modules/op-entry/audit';
import { ConflictError, ValidationError } from './errors';

// ADR-291 Step 4 — HOLD on a Job Card operation. The ONE writer of the
// jc_ops hold columns (hold_kind, hold_reason, held_at, held_by, hold_ecr_id —
// migration 0250), §20.1, and the ONE check every qty writer calls.
//
// Two different things stop work on an op:
//   1. A stored hold (kind 'ecr' — an Engineering Change is open on the part —
//      or 'manual'). Placed and released only through here.
//   2. The Job Card's Drawing Rev is not released (isRevWorkAllowed). That one
//      is NEVER stored: assertJcOpWorkable reads the Rev's live status, so the
//      moment Design releases the Rev the op is workable again with nothing to
//      clear. (A stored copy would go stale the second the Rev changed.)
//
// LOCK ORDER (ADR-220): jc_ops rows FOR UPDATE, ascending id, and NEVER
// job_cards first — Op Entry holds the jc_ops row and then updates job_cards
// (finishJc); locking job_cards first here is the opposite order and deadlocks
// (job-cards/service.ts updateJobCardTx head note, op-entry submitQcLog).

/** The hold kinds that are stored. 'rev_not_released' is read live, never stored. */
export type StoredHoldKind = 'ecr' | 'manual';

interface HoldRow {
  id: string;
  jobCardId: string;
  jcCode: string;
  opSeq: number;
  operation: string | null;
}

/** Lock the given live ops FOR UPDATE in id order (deadlock-safe). */
async function lockOps(
  tx: DbTransaction,
  companyId: string,
  where: ReturnType<typeof sql>,
): Promise<string[]> {
  const rows = (await tx.execute(sql`
    SELECT o.id FROM public.jc_ops o
     WHERE o.company_id = ${companyId}::uuid AND o.deleted_at IS NULL AND ${where}
     ORDER BY o.id
       FOR UPDATE
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** An AuthContext for the activity row when the caller hands only a user id. */
async function actorOf(tx: DbTransaction, companyId: string, userId: string): Promise<AuthContext> {
  const rows = (await tx.execute(sql`
    SELECT email, full_name AS "fullName" FROM public.users WHERE id = ${userId}::uuid LIMIT 1
  `)) as unknown as Array<{ email: string; fullName: string | null }>;
  return {
    id: userId,
    email: rows[0]?.email ?? '',
    fullName: rows[0]?.fullName ?? null,
    companyId,
    role: 'user' as AuthContext['role'],
    isActive: true,
  };
}

async function logHoldRows(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  rows: HoldRow[],
  action: string,
  verb: string,
  reason: string | null,
): Promise<void> {
  if (rows.length === 0) return;
  const inputs: ActivityLogInput[] = rows.map((r) => {
    const opRef = jcOpRef(r.opSeq, r.operation);
    return {
      action,
      entity: 'JobCard',
      entityId: r.jobCardId,
      refId: r.jcCode,
      opRef,
      detail: `${r.jcCode} · ${opRef} ${verb}${reason ? ` — ${reason}` : ''}`,
      reason,
    };
  });
  await emitActivityLogBatch(tx, inputs, companyId, await actorOf(tx, companyId, userId));
}

const RETURNING = sql`
  RETURNING o.id, o.job_card_id AS "jobCardId", o.op_seq AS "opSeq", o.operation,
    (SELECT j.code FROM public.job_cards j WHERE j.id = o.job_card_id) AS "jcCode"`;

/**
 * Put ops on hold. Only ops with NO hold get one (conditional, §20.2) — an op
 * already held keeps its first hold and reason. Returns the ops actually held.
 */
export async function placeOpHolds(
  tx: DbTransaction,
  args: {
    companyId: string;
    jcOpIds: readonly string[];
    kind: StoredHoldKind;
    ecrId: string | null;
    reason: string;
    userId: string;
  },
): Promise<HoldRow[]> {
  const { companyId, kind, ecrId, reason, userId } = args;
  if ((kind as string) === 'rev_not_released') {
    // Read live by assertJcOpWorkable — storing it would go stale.
    throw new ValidationError(
      'A "Rev not released" hold is not stored; it clears itself on release.',
    );
  }
  if (kind === 'ecr' && !ecrId)
    throw new ValidationError('An Engineering Change hold needs its ECR.');
  const ids = [...new Set(args.jcOpIds)];
  if (ids.length === 0) return [];
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const locked = await lockOps(tx, companyId, sql`o.id IN (${idList})`);
  if (locked.length === 0) return [];
  const lockedList = sql.join(
    locked.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await tx.execute(sql`
    UPDATE public.jc_ops o
       SET hold_kind = ${kind}, hold_reason = ${reason}, held_at = now(),
           held_by = ${userId}::uuid, hold_ecr_id = ${ecrId}::uuid
     WHERE o.id IN (${lockedList}) AND o.hold_kind IS NULL
    ${RETURNING}
  `)) as unknown as HoldRow[];
  await logHoldRows(tx, companyId, userId, rows, 'HOLD', 'put on hold', reason);
  return rows;
}

/**
 * Release holds — by op ids, or every op an ECR holds. Conditional: only ops
 * still held are cleared; returns the ops actually released (0 = someone
 * released them first — the caller says so).
 */
export async function releaseOpHolds(
  tx: DbTransaction,
  args: {
    companyId: string;
    jcOpIds?: readonly string[] | undefined;
    ecrId?: string | null | undefined;
    note: string;
    userId: string;
  },
): Promise<HoldRow[]> {
  const { companyId, note, userId } = args;
  let where;
  if (args.jcOpIds && args.jcOpIds.length > 0) {
    const idList = sql.join(
      [...new Set(args.jcOpIds)].map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    where = sql`o.id IN (${idList}) AND o.hold_kind IS NOT NULL`;
  } else if (args.ecrId) {
    where = sql`o.hold_ecr_id = ${args.ecrId}::uuid AND o.hold_kind IS NOT NULL`;
  } else {
    return [];
  }
  const locked = await lockOps(tx, companyId, where);
  if (locked.length === 0) return [];
  const lockedList = sql.join(
    locked.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await tx.execute(sql`
    UPDATE public.jc_ops o
       SET hold_kind = NULL, hold_reason = NULL, held_at = NULL, held_by = NULL, hold_ecr_id = NULL
     WHERE o.id IN (${lockedList}) AND o.hold_kind IS NOT NULL
    ${RETURNING}
  `)) as unknown as HoldRow[];
  await logHoldRows(tx, companyId, userId, rows, 'RELEASE_HOLD', 'hold released', note);
  return rows;
}

interface WorkableRow {
  jobCardId: string;
  jcCode: string;
  opSeq: number;
  operation: string | null;
  holdKind: string | null;
  holdReason: string | null;
  heldAt: Date | string | null;
  ecrCode: string | null;
  revStatus: RevReleaseStatus | null;
  rev: string | null;
  itemCode: string | null;
}

async function readWorkable(
  tx: DbTransaction,
  companyId: string,
  jcOpId: string,
): Promise<WorkableRow | null> {
  const rows = (await tx.execute(sql`
    SELECT o.job_card_id AS "jobCardId", j.code AS "jcCode", o.op_seq AS "opSeq", o.operation,
      o.hold_kind AS "holdKind", o.hold_reason AS "holdReason", o.held_at AS "heldAt",
      (SELECT e.code FROM public.engineering_changes e WHERE e.id = o.hold_ecr_id) AS "ecrCode",
      ir.release_status AS "revStatus", ir.rev,
      (SELECT i.code FROM public.items i WHERE i.id = ir.item_id) AS "itemCode"
    FROM public.jc_ops o
    JOIN public.job_cards j ON j.id = o.job_card_id
    LEFT JOIN public.item_revisions ir ON ir.id = j.item_revision_id
    WHERE o.id = ${jcOpId}::uuid AND o.company_id = ${companyId}::uuid
    LIMIT 1
  `)) as unknown as WorkableRow[];
  return rows[0] ?? null;
}

function holdText(r: WorkableRow): string | null {
  if (r.holdReason && r.ecrCode) return `${r.ecrCode}: ${r.holdReason}`;
  return r.holdReason ?? r.ecrCode;
}

/**
 * Refuse qty moving on an op that is on hold, or whose Job Card's Drawing Rev
 * is not released (read live). Call AFTER the caller's own jc_ops row lock, so
 * a hold placed a moment earlier is seen (placeOpHolds takes the same lock).
 * A Job Card with no Rev is allowed. Unknown op → no-op (the caller's own
 * not-found path answers).
 */
export async function assertJcOpWorkable(
  tx: DbTransaction,
  companyId: string,
  jcOpId: string,
  opts: {
    /** Stop of a running session: the pieces it made before the hold was
     *  placed may still be recorded. A session started AFTER held_at (or a
     *  fresh entry, no session) is refused as before. The Rev check stays. */
    sessionStartedAt?: Date | undefined;
  } = {},
): Promise<void> {
  const r = await readWorkable(tx, companyId, jcOpId);
  if (!r) return;
  const heldAt = r.heldAt ? new Date(r.heldAt) : null;
  const madeBeforeHold =
    !!opts.sessionStartedAt && !!heldAt && opts.sessionStartedAt.getTime() < heldAt.getTime();
  if (r.holdKind && !madeBeforeHold) {
    throw new ConflictError(opOnHoldMessage(r.jcCode, jcOpRef(r.opSeq, r.operation), holdText(r)));
  }
  if (r.revStatus && !isRevWorkAllowed(r.revStatus)) {
    throw new ValidationError(
      revNotReleasedMessage(itemRevLabel(r.itemCode ?? '', r.rev ?? ''), r.revStatus),
    );
  }
}

/**
 * For a writer that has no jc_ops lock of its own yet: lock the ops (id
 * order, ADR-220) and refuse when any is held / on a not-released Rev.
 */
export async function lockAndAssertJcOpsWorkable(
  tx: DbTransaction,
  companyId: string,
  jcOpIds: readonly (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(jcOpIds.filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return;
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const locked = await lockOps(tx, companyId, sql`o.id IN (${idList})`);
  for (const id of locked) await assertJcOpWorkable(tx, companyId, id);
}

/**
 * For writers that must NOT refuse (goods already physically back from a
 * vendor): the hold / Rev sentence to add to their activity note, or null when
 * the op is workable.
 */
export async function jcOpHoldNote(
  tx: DbTransaction,
  companyId: string,
  jcOpId: string,
): Promise<string | null> {
  try {
    await assertJcOpWorkable(tx, companyId, jcOpId);
    return null;
  } catch (e) {
    if (e instanceof ConflictError || e instanceof ValidationError) {
      return `Received while ${e.message.replace(/ — release the hold first\.$/, '')}`;
    }
    throw e;
  }
}

/**
 * Goods physically back from a vendor are never refused (they are already in
 * the building). When the op is on hold / its Rev is not released, the receipt
 * goes through and the Job Card's history says so. Returns the note, or null.
 */
export async function noteReceiptOnHeldOp(
  tx: DbTransaction,
  args: { companyId: string; jcOpId: string; userId: string; docRef: string },
): Promise<string | null> {
  const note = await jcOpHoldNote(tx, args.companyId, args.jcOpId);
  if (!note) return null;
  const r = await readWorkable(tx, args.companyId, args.jcOpId);
  if (!r) return note;
  const opRef = jcOpRef(r.opSeq, r.operation);
  await emitActivityLogBatch(
    tx,
    [
      {
        action: 'RECEIVE',
        entity: 'JobCard',
        entityId: r.jobCardId,
        refId: r.jcCode,
        opRef,
        detail: `${args.docRef} → ${r.jcCode} · ${opRef}: ${note}`,
      },
    ],
    args.companyId,
    await actorOf(tx, args.companyId, args.userId),
  );
  return note;
}

export interface OpHoldInfo {
  /** The sentence the screens show; null = workable. A stored hold's reason
   *  (prefixed with its ECR code), else "Drawing Rev X is Not released". */
  holdReason: string | null;
  heldAt: string | null;
  holdEcrCode: string | null;
  holdEcrId: string | null;
}

/** The status-label CASE, built from the shared map (one source of words). */
const REV_LABEL_CASE = sql.join(
  Object.entries(REV_RELEASE_STATUS_LABELS).map(([k, v]) => sql`WHEN ${k} THEN ${v}`),
  sql` `,
);
const REV_ALLOWED_LIST = sql.join(
  REV_WORK_ALLOWED.map((s) => sql`${s}`),
  sql`, `,
);

/**
 * The hold sentence for an op, as a SQL scalar for a list query (one query
 * for the whole page — the jc-ops board). `op` / `jc` are the aliases of
 * jc_ops and its job_cards row in the caller's FROM. Same rule as
 * assertJcOpWorkable: a stored hold first, else the live Rev status.
 */
export function opHoldReasonSql(op: string, jc: string): SQL<string | null> {
  const o = sql.raw(op);
  const j = sql.raw(jc);
  return sql<string | null>`(CASE
    WHEN ${o}.hold_kind IS NOT NULL THEN COALESCE(
      (SELECT e.code FROM public.engineering_changes e WHERE e.id = ${o}.hold_ecr_id)
        || COALESCE(': ' || ${o}.hold_reason, ''),
      ${o}.hold_reason, 'On hold')
    ELSE (SELECT 'Drawing Rev ' || ir.rev || ' is ' || CASE ir.release_status ${REV_LABEL_CASE} END
            FROM public.item_revisions ir
           WHERE ir.id = ${j}.item_revision_id
             AND ir.release_status NOT IN (${REV_ALLOWED_LIST}))
  END)`;
}

/**
 * Hold facts for screens, keyed by op id (only ops that are held or on a
 * not-released Rev are in the map). The Status page's opExtras reads this;
 * a read, no lock.
 */
export async function readOpHolds(
  tx: DbTransaction,
  companyId: string,
  jcOpIds: readonly string[],
): Promise<Map<string, OpHoldInfo>> {
  const out = new Map<string, OpHoldInfo>();
  if (jcOpIds.length === 0) return out;
  const idList = sql.join(
    [...new Set(jcOpIds)].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await tx.execute(sql`
    SELECT x.id, x."holdReason", x."heldAt", x."holdEcrCode", x."holdEcrId" FROM (
      SELECT o.id, ${opHoldReasonSql('o', 'j')} AS "holdReason",
        to_char(o.held_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "heldAt",
        (SELECT e.code FROM public.engineering_changes e WHERE e.id = o.hold_ecr_id) AS "holdEcrCode",
        o.hold_ecr_id AS "holdEcrId"
      FROM public.jc_ops o
      JOIN public.job_cards j ON j.id = o.job_card_id
      WHERE o.company_id = ${companyId}::uuid AND o.id IN (${idList})
    ) x WHERE x."holdReason" IS NOT NULL
  `)) as unknown as Array<OpHoldInfo & { id: string }>;
  for (const r of rows) {
    out.set(r.id, {
      holdReason: r.holdReason,
      heldAt: r.heldAt,
      holdEcrCode: r.holdEcrCode,
      holdEcrId: r.holdEcrId,
    });
  }
  return out;
}
