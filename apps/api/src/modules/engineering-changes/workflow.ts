// ADR-291 Step 4 — the ECR workflow after Draft:
//   submit        draft → submitted; impact list built; affected ops held
//   dispositions  per Job Card: keep old / move not-started / decide later
//   decide        one sign-off per role (Design, Quality, Production), L4+;
//                 third approval → approved; any reject → rejected, holds lifted
//   cancel        draft | submitted → cancelled, holds lifted
//   close         implemented → closed once no hold of this ECR is left
// Every status move is ONE conditional UPDATE on the expected status (§20.2);
// screen saves carry the updated_at they loaded (§20.4); the ECR row is locked
// FOR UPDATE first, so two people acting at once queue and the second is told.

import {
  ActivityAction,
  type AccessDeptKey,
  deptTier,
  type DecideEcrInput,
  ECR_APPROVER_ROLE_LABELS,
  ECR_APPROVER_ROLES,
  ECR_STATUS_LABELS,
  type Ecr,
  type EcrActionInput,
  type EcrApproverRole,
  REV_CHANGE_REASON_MIN,
  type SetEcrDispositionsInput,
  type SubmitEcrInput,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { hasFormAccess, requireAnyFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { placeOpHolds, releaseOpHolds } from '../../lib/jc-op-hold';
import { getMyAccess } from '../access-control/service';
import { lockFirstOp, readNotStartedQty } from '../production-orders/reduce-qty';
import { buildImpacts, unfinishedOpIds } from './impacts';
import { type EcrRow, readEcrDetail, readEcrRow, sameVersion } from './read';
import { assertSameVersion, logEcr, refuseChanged, requireCompany, stateText } from './service';

/** The department whose L4 / L5 gives each sign-off. */
export const ECR_ROLE_DEPT: Record<EcrApproverRole, AccessDeptKey> = {
  design: 'design',
  qc: 'qc',
  production: 'production',
};

/** The roles this user may sign (L4 / L5 in that department, Full Access, or
 *  Super Admin). Raiser exclusion is per ECR (assertNotRaiser). */
export async function decidableEcrRoles(user: AuthContext): Promise<EcrApproverRole[]> {
  if (user.role === 'admin') return [...ECR_APPROVER_ROLES];
  const eff = await getMyAccess(user);
  if (eff.fullAccess) return [...ECR_APPROVER_ROLES];
  return ECR_APPROVER_ROLES.filter((r) => {
    const t = deptTier(eff, ECR_ROLE_DEPT[r]);
    return t === 'L4' || t === 'L5';
  });
}

const isRaiser = (e: EcrRow, userId: string): boolean =>
  e.createdBy === userId || e.submittedBy === userId;

/** Raiser (creator / submitter) or someone with Edit on the ECR form. */
async function requireRaiserOrEdit(user: AuthContext, e: EcrRow, what: string): Promise<void> {
  if (isRaiser(e, user.id)) return;
  if (await hasFormAccess(user, 'ecr_create', 'edit')) return;
  throw new AuthorizationError(
    `Only the person who raised ${e.code} (or Edit right) may ${what} it.`,
  );
}

async function heldOpCount(tx: DbTransaction, ecrId: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM public.jc_ops
     WHERE hold_ecr_id = ${ecrId}::uuid AND deleted_at IS NULL`)) as unknown as Array<{
    n: number;
  }>;
  return Number(rows[0]?.n ?? 0);
}

// ─── B. Submit ─────────────────────────────────────────────────────────────

export async function submitEcr(
  id: string,
  input: SubmitEcrInput,
  user: AuthContext,
): Promise<Ecr> {
  await requireAnyFormAccess(user, [
    ['ecr_create', 'entry'],
    ['ecr_create', 'edit'],
  ]);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const e = await readEcrRow(tx, companyId, id, true);
    if (e.status !== 'draft') {
      throw new ConflictError(
        `Cannot submit ${e.code}: it ${await stateText(tx, e)}. Reload the page.`,
      );
    }
    await requireRaiserOrEdit(user, e, 'submit');
    await assertSameVersion(tx, e, input.expectedUpdatedAt);
    const done = (await tx.execute(sql`
      UPDATE public.engineering_changes
         SET status = 'submitted', submitted_at = now(), submitted_by = ${user.id}::uuid,
             updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${id}::uuid AND status = 'draft' AND ${sameVersion(e)}
      RETURNING id`)) as unknown as unknown[];
    if (done.length === 0) await refuseChanged(tx, companyId, id, 'submit');

    const jcIds = await buildImpacts(tx, companyId, e, user.id);
    let held = 0;
    if (input.holdAffectedWork && e.classification !== 'documentation_only' && jcIds.length > 0) {
      const rows = await placeOpHolds(tx, {
        companyId,
        jcOpIds: await unfinishedOpIds(tx, jcIds),
        kind: 'ecr',
        ecrId: id,
        reason: `ECR ${e.code}`,
        userId: user.id,
      });
      held = rows.length;
    }
    await logEcr(
      tx,
      user,
      companyId,
      e,
      ActivityAction.Submit,
      `${e.code} sent for approval — ${jcIds.length} open Job Card(s)${held > 0 ? `, ${held} operation(s) put on hold` : ''}`,
      { before: ECR_STATUS_LABELS.draft, after: ECR_STATUS_LABELS.submitted },
    );
    return readEcrDetail(tx, companyId, id);
  });
}

// ─── C. Dispositions ───────────────────────────────────────────────────────

export async function setEcrDispositions(
  id: string,
  input: SetEcrDispositionsInput,
  user: AuthContext,
): Promise<Ecr> {
  await requireAnyFormAccess(user, [
    ['ecr_create', 'entry'],
    ['ecr_create', 'edit'],
  ]);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const e = await readEcrRow(tx, companyId, id, true);
    if (e.status !== 'submitted') {
      throw new ConflictError(
        `${e.code} ${await stateText(tx, e)} — dispositions are set while it waits for approval.`,
      );
    }
    await assertSameVersion(tx, e, input.expectedUpdatedAt);
    const stored = (await tx.execute(sql`
      SELECT id, doc_type AS "docType", job_card_id AS "jobCardId", label
        FROM public.engineering_change_impacts
       WHERE ecr_id = ${id}::uuid AND deleted_at IS NULL`)) as unknown as Array<{
      id: string;
      docType: string;
      jobCardId: string | null;
      label: string;
    }>;
    const byId = new Map(stored.map((s) => [s.id, s]));
    for (const d of input.impacts) {
      const s = byId.get(d.id);
      if (!s) throw new NotFoundError('An impact row is not on this ECR. Reload the page.');
      if (s.docType !== 'job_card') {
        throw new ValidationError(`${s.label}: only a Job Card takes a disposition.`);
      }
      let moveQty = 0;
      let notStarted: number | null = null;
      if (d.disposition === 'move_new') {
        if (e.classification !== 'interchangeable') {
          throw new ValidationError(
            `${s.label}: pieces move to a new Rev only on an interchangeable change.`,
          );
        }
        if (!Number.isInteger(d.moveQty) || d.moveQty <= 0) {
          throw new ValidationError(`${s.label}: Qty to move must be a whole number above 0.`);
        }
        // §20.3 — "not started" re-read under the Job Card's first-op lock.
        await lockFirstOp(tx, s.jobCardId!);
        notStarted = (await readNotStartedQty(tx, s.jobCardId!)).notStarted;
        if (d.moveQty > notStarted) {
          throw new ValidationError(
            `${s.label}: only ${notStarted} piece(s) not started — cannot move ${d.moveQty}.`,
          );
        }
        moveQty = d.moveQty;
      }
      await tx.execute(sql`
        UPDATE public.engineering_change_impacts
           SET disposition = ${d.disposition}, move_qty = ${moveQty}, note = ${d.note},
               qty_not_started = COALESCE(${notStarted}::numeric, qty_not_started),
               updated_at = now(), updated_by = ${user.id}::uuid
         WHERE id = ${d.id}::uuid`);
    }
    const done = (await tx.execute(sql`
      UPDATE public.engineering_changes SET updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${id}::uuid AND status = 'submitted' AND ${sameVersion(e)}
      RETURNING id`)) as unknown as unknown[];
    if (done.length === 0) await refuseChanged(tx, companyId, id, 'change');
    await logEcr(tx, user, companyId, e, ActivityAction.Edit, `${e.code} dispositions set`);
    return readEcrDetail(tx, companyId, id);
  });
}

// ─── D. Decide ─────────────────────────────────────────────────────────────

export async function decideEcr(
  id: string,
  input: DecideEcrInput,
  user: AuthContext,
): Promise<Ecr> {
  const companyId = requireCompany(user);
  const roleLabel = ECR_APPROVER_ROLE_LABELS[input.role];
  const roles = await decidableEcrRoles(user);
  if (!roles.includes(input.role)) {
    throw new AuthorizationError(
      `A ${roleLabel} sign-off needs L4 Approver or higher in ${roleLabel}.`,
    );
  }
  const note = input.note?.trim() || null;
  if (input.decision === 'rejected' && (note?.length ?? 0) < REV_CHANGE_REASON_MIN) {
    throw new ValidationError(`Reason is required (at least ${REV_CHANGE_REASON_MIN} characters)`);
  }
  return withUserContext(user, async (tx) => {
    const e = await readEcrRow(tx, companyId, id, true);
    if (e.status !== 'submitted') {
      throw new ConflictError(
        `Cannot decide ${e.code}: it ${await stateText(tx, e)}. Reload the page.`,
      );
    }
    // No self-approval: the raiser never signs their own ECR.
    if (isRaiser(e, user.id)) {
      throw new AuthorizationError(`You raised ${e.code} — another person must decide it.`);
    }
    const already = async (): Promise<never> => {
      const [r] = (await tx.execute(sql`
        SELECT COALESCE(NULLIF(btrim(u.full_name), ''), split_part(u.email, '@', 1)) AS name
          FROM public.engineering_change_approvals a LEFT JOIN public.users u ON u.id = a.decided_by
         WHERE a.ecr_id = ${id}::uuid AND a.role = ${input.role} AND a.deleted_at IS NULL
         LIMIT 1`)) as unknown as Array<{ name: string | null }>;
      throw new ConflictError(
        `${roleLabel} already decided by ${r?.name ?? 'someone else'}. Reload the page.`,
      );
    };
    const pre = (await tx.execute(sql`
      SELECT 1 FROM public.engineering_change_approvals
       WHERE ecr_id = ${id}::uuid AND role = ${input.role} AND deleted_at IS NULL LIMIT 1`)) as unknown as unknown[];
    if (pre.length > 0) await already();
    // SOP: Engineering, Quality and Operations are three separate functions —
    // one person gives only ONE of the three sign-offs. Read under the ECR row
    // lock (readEcrRow FOR UPDATE), so two sign-offs by one person queue here.
    const [mine] = (await tx.execute(sql`
      SELECT role FROM public.engineering_change_approvals
       WHERE ecr_id = ${id}::uuid AND decided_by = ${user.id}::uuid AND deleted_at IS NULL
       LIMIT 1`)) as unknown as Array<{ role: keyof typeof ECR_APPROVER_ROLE_LABELS }>;
    if (mine) {
      throw new ConflictError(
        `${user.fullName || user.email} already signed this ECR as ${ECR_APPROVER_ROLE_LABELS[mine.role]}`,
      );
    }
    // The unique index (ecr_id, role) is the backstop: ON CONFLICT → 0 rows.
    const ins = (await tx.execute(sql`
      INSERT INTO public.engineering_change_approvals
        (company_id, ecr_id, role, decision, decided_by, note, created_by, updated_by)
      VALUES (${companyId}::uuid, ${id}::uuid, ${input.role}, ${input.decision}, ${user.id}::uuid,
              ${note}, ${user.id}::uuid, ${user.id}::uuid)
      ON CONFLICT (ecr_id, role) WHERE deleted_at IS NULL DO NOTHING
      RETURNING id`)) as unknown as unknown[];
    if (ins.length === 0) await already();

    if (input.decision === 'rejected') {
      const done = (await tx.execute(sql`
        UPDATE public.engineering_changes
           SET status = 'rejected', rejected_at = now(), rejected_by = ${user.id}::uuid,
               reject_reason = ${note}, updated_at = now(), updated_by = ${user.id}::uuid
         WHERE id = ${id}::uuid AND status = 'submitted'
        RETURNING id`)) as unknown as unknown[];
      if (done.length === 0) await refuseChanged(tx, companyId, id, 'reject');
      const released = await releaseOpHolds(tx, {
        companyId,
        ecrId: id,
        note: `ECR ${e.code} rejected`,
        userId: user.id,
      });
      await logEcr(
        tx,
        user,
        companyId,
        e,
        ActivityAction.Reject,
        `${e.code} rejected (${roleLabel}) by ${user.fullName || user.email}${released.length > 0 ? ` — ${released.length} hold(s) lifted` : ''}`,
        { reason: note, before: ECR_STATUS_LABELS.submitted, after: ECR_STATUS_LABELS.rejected },
      );
      return readEcrDetail(tx, companyId, id);
    }

    const cnt = (await tx.execute(sql`
      SELECT COUNT(DISTINCT role)::int AS n FROM public.engineering_change_approvals
       WHERE ecr_id = ${id}::uuid AND deleted_at IS NULL AND decision = 'approved'`)) as unknown as Array<{
      n: number;
    }>;
    const approvedRoles = Number(cnt[0]?.n ?? 0);
    if (approvedRoles >= ECR_APPROVER_ROLES.length) {
      const done = (await tx.execute(sql`
        UPDATE public.engineering_changes
           SET status = 'approved', approved_at = now(), updated_at = now(), updated_by = ${user.id}::uuid
         WHERE id = ${id}::uuid AND status = 'submitted'
        RETURNING id`)) as unknown as unknown[];
      if (done.length === 0) await refuseChanged(tx, companyId, id, 'approve');
      await logEcr(
        tx,
        user,
        companyId,
        e,
        ActivityAction.Approve,
        `${e.code} approved — ${roleLabel} sign-off by ${user.fullName || user.email} was the last of ${ECR_APPROVER_ROLES.length}`,
        { reason: note, before: ECR_STATUS_LABELS.submitted, after: ECR_STATUS_LABELS.approved },
      );
    } else {
      await tx.execute(sql`
        UPDATE public.engineering_changes SET updated_at = now(), updated_by = ${user.id}::uuid
         WHERE id = ${id}::uuid`);
      await logEcr(
        tx,
        user,
        companyId,
        e,
        ActivityAction.Approve,
        `${e.code} — ${roleLabel} approved by ${user.fullName || user.email} (${approvedRoles} of ${ECR_APPROVER_ROLES.length})`,
        { reason: note },
      );
    }
    return readEcrDetail(tx, companyId, id);
  });
}

// ─── H. Cancel / Close ─────────────────────────────────────────────────────

export async function cancelEcr(
  id: string,
  input: EcrActionInput,
  user: AuthContext,
): Promise<Ecr> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const e = await readEcrRow(tx, companyId, id, true);
    if (e.status !== 'draft' && e.status !== 'submitted') {
      throw new ConflictError(
        `Cannot cancel ${e.code}: it ${await stateText(tx, e)}. Reload the page.`,
      );
    }
    await requireRaiserOrEdit(user, e, 'cancel');
    await assertSameVersion(tx, e, input.expectedUpdatedAt);
    const note = input.note?.trim() || null;
    const done = (await tx.execute(sql`
      UPDATE public.engineering_changes
         SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${user.id}::uuid,
             updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${id}::uuid AND status = ${e.status} AND ${sameVersion(e)}
      RETURNING id`)) as unknown as unknown[];
    if (done.length === 0) await refuseChanged(tx, companyId, id, 'cancel');
    const released = await releaseOpHolds(tx, {
      companyId,
      ecrId: id,
      note: `ECR ${e.code} cancelled`,
      userId: user.id,
    });
    await logEcr(
      tx,
      user,
      companyId,
      e,
      ActivityAction.Cancel,
      `${e.code} cancelled${released.length > 0 ? ` — ${released.length} hold(s) lifted` : ''}`,
      { reason: note, before: ECR_STATUS_LABELS[e.status], after: ECR_STATUS_LABELS.cancelled },
    );
    return readEcrDetail(tx, companyId, id);
  });
}

/** implemented → closed, only when no hold of this ECR is left. Shared by the
 *  close endpoint and the implement's auto-close. Returns false when holds
 *  remain (nothing written). */
export async function closeEcrTx(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  e: EcrRow,
): Promise<boolean> {
  if ((await heldOpCount(tx, e.id)) > 0) return false;
  const done = (await tx.execute(sql`
    UPDATE public.engineering_changes
       SET status = 'closed', closed_at = now(), closed_by = ${user.id}::uuid,
           updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${e.id}::uuid AND status = 'implemented'
    RETURNING id`)) as unknown as unknown[];
  if (done.length === 0) await refuseChanged(tx, companyId, e.id, 'close');
  await logEcr(tx, user, companyId, e, ActivityAction.Close, `${e.code} closed — no hold left`, {
    before: ECR_STATUS_LABELS.implemented,
    after: ECR_STATUS_LABELS.closed,
  });
  return true;
}

export async function closeEcr(id: string, input: EcrActionInput, user: AuthContext): Promise<Ecr> {
  await requireAnyFormAccess(user, [
    ['ecr_create', 'entry'],
    ['ecr_create', 'edit'],
    ['ecr_create', 'advance'],
  ]);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const e = await readEcrRow(tx, companyId, id, true);
    if (e.status !== 'implemented') {
      throw new ConflictError(
        `Cannot close ${e.code}: it ${await stateText(tx, e)}. Reload the page.`,
      );
    }
    await assertSameVersion(tx, e, input.expectedUpdatedAt);
    const n = await heldOpCount(tx, id);
    if (n > 0) {
      throw new ConflictError(
        `${e.code} still holds ${n} operation(s) — release them first, then close.`,
      );
    }
    await closeEcrTx(tx, user, companyId, e);
    return readEcrDetail(tx, companyId, id);
  });
}
