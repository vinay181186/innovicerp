// ADR-291 Step 4 — Engineering Change (ECR): list, detail, create (Draft),
// edit (Draft only). The workflow (submit / dispositions / decide / cancel /
// close) is in workflow.ts, implement in implement.ts.
// Contract: packages/shared/src/schemas/engineering-change.ts. Page /ecrs,
// form key ecr_create (Design). Code IN-ECR-##### stated by the server
// (ADR-227), numbered under lockDocSeries('engineering_changes').

import {
  ActivityAction,
  type CreateEcrInput,
  ECR_STATUS_LABELS,
  type Ecr,
  type EcrListRow,
  type ListEcrQuery,
  type ListEcrResponse,
  type UpdateEcrInput,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { hasFormAccess, requireAnyFormAccess, requireFormAccess } from '../../lib/access';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { assertUnchangedSinceOpened } from '../../lib/edit-conflict';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { fmtDateTime } from '../../lib/format-date';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { editConflicts, rowChangedByName } from '../../lib/row-changed-by';
import { newestFirst } from '../../lib/list-order';
import { emitActivityLog } from '../activity-log/service';
import {
  ECR_COLS,
  ECR_FROM,
  type EcrRow,
  headerOf,
  readEcrDetail,
  readEcrRow,
  sameVersion,
  toEcrRow,
} from './read';
import { ECR_SF_COLUMNS } from './sf-columns';

export const ECR_ENTITY = 'EngineeringChange';
const ECR_PREFIX = 'IN-ECR-';

export function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** "is Approved by Jinal at 14-11-2026 02:35 PM" — the state that refused an
 *  action, naming who put it there (§20.2). */
export async function stateText(tx: DbTransaction, e: EcrRow): Promise<string> {
  const who: Partial<Record<EcrRow['status'], [string | null, Date | null]>> = {
    submitted: [e.submittedBy, e.submittedAt],
    approved: [e.updatedBy, e.approvedAt],
    rejected: [e.rejectedBy, e.rejectedAt],
    implemented: [e.implementedBy, e.implementedAt],
    closed: [e.closedBy, e.closedAt],
    cancelled: [e.cancelledBy, e.cancelledAt],
  };
  const [by, at] = who[e.status] ?? [e.updatedBy, e.updatedAt];
  const name = await rowChangedByName(tx, by);
  return `is ${ECR_STATUS_LABELS[e.status]}${name ? ` by ${name}` : ''}${at ? ` at ${fmtDateTime(at)}` : ''}`;
}

/** §20.4 — refuse when the screen's copy is older than the row. */
export async function assertSameVersion(
  tx: DbTransaction,
  e: EcrRow,
  expected: string | undefined,
): Promise<void> {
  if (editConflicts(e.updatedAt, expected)) {
    assertUnchangedSinceOpened(e.updatedAt, expected, await rowChangedByName(tx, e.updatedBy));
  }
}

/** A 0-row conditional UPDATE: re-read and say what happened. */
export async function refuseChanged(
  tx: DbTransaction,
  companyId: string,
  id: string,
  verb: string,
): Promise<never> {
  const now = await readEcrRow(tx, companyId, id);
  throw new ConflictError(
    `Cannot ${verb} ${now.code}: it ${await stateText(tx, now)}. Reload the page.`,
  );
}

export async function logEcr(
  tx: DbTransaction,
  user: AuthContext,
  companyId: string,
  e: { id: string; code: string },
  action: string,
  detail: string,
  extra: { reason?: string | null; before?: string; after?: string } = {},
): Promise<void> {
  await emitActivityLog(
    tx,
    {
      action,
      entity: ECR_ENTITY,
      entityId: e.id,
      refId: e.code,
      detail,
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.before !== undefined && extra.after !== undefined
        ? {
            changes: [
              { field: 'status', label: 'ECR Status', before: extra.before, after: extra.after },
            ],
          }
        : {}),
    },
    companyId,
    user,
  );
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function listEcrs(q: ListEcrQuery, user: AuthContext): Promise<ListEcrResponse> {
  await requireFormAccess(user, 'ecr_create', 'view');
  const companyId = requireCompany(user);
  const sf = readSf(q.sf);
  return withUserContext(user, async (tx) => {
    const term = q.search ? `%${likeEscape(q.search.trim())}%` : null;
    const where = sql`
      WHERE e.company_id = ${companyId}::uuid AND e.deleted_at IS NULL
        ${q.status ? sql`AND e.status = ${q.status}` : sql``}
        ${
          term
            ? sql`AND (e.code ILIKE ${term} ESCAPE '\\' OR i.code ILIKE ${term} ESCAPE '\\'
                     OR i.name ILIKE ${term} ESCAPE '\\' OR e.description ILIKE ${term} ESCAPE '\\'
                     OR (i.code || '/' || fr.rev) ILIKE ${term} ESCAPE '\\'
                     OR (i.code || '/' || tr.rev) ILIKE ${term} ESCAPE '\\'
                     OR ri.code ILIKE ${term} ESCAPE '\\')`
            : sql``
        }
        ${sfWhere(ECR_SF_COLUMNS, sf)}`;
    const rows = (await tx.execute(sql`
      SELECT ${ECR_COLS},
        (SELECT COUNT(*) FROM public.engineering_change_impacts m
          WHERE m.ecr_id = e.id AND m.deleted_at IS NULL)::int AS "impactCount",
        (SELECT COUNT(*) FROM public.jc_ops o
          WHERE o.hold_ecr_id = e.id AND o.deleted_at IS NULL)::int AS "heldOps",
        (SELECT COUNT(*) FROM public.engineering_change_approvals a
          WHERE a.ecr_id = e.id AND a.deleted_at IS NULL AND a.decision = 'approved')::int AS "approvalsDone"
      ${ECR_FROM} ${where}
      ORDER BY ${sfOrderBy(ECR_SF_COLUMNS, sf, sql`${newestFirst('e')}`)}
      LIMIT ${q.limit} OFFSET ${q.offset}`)) as unknown as Array<Record<string, unknown>>;
    const total = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n ${ECR_FROM} ${where}`)) as unknown as Array<{ n: number }>;
    const items: EcrListRow[] = rows.map((r) => ({
      ...headerOf(toEcrRow(r)),
      impactCount: Number(r['impactCount'] ?? 0),
      heldOps: Number(r['heldOps'] ?? 0),
      approvalsDone: Number(r['approvalsDone'] ?? 0),
    }));
    return { items, total: Number(total[0]?.n ?? 0) };
  });
}

export async function getEcr(id: string, user: AuthContext): Promise<Ecr> {
  await requireFormAccess(user, 'ecr_create', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => readEcrDetail(tx, companyId, id));
}

// ─── Create / edit (Draft) ─────────────────────────────────────────────────

interface EcrShape {
  itemId: string;
  fromItemRevisionId: string;
  toItemRevisionId: string | null;
  replacementItemId: string | null;
  classification: CreateEcrInput['classification'];
  customerApproval: CreateEcrInput['customerApproval'];
}

/** The Rev / replacement rules (SOP §2). Throws a ValidationError naming the
 *  first broken one. */
export async function assertEcrShape(
  tx: DbTransaction,
  companyId: string,
  s: EcrShape,
): Promise<void> {
  const [item] = (await tx.execute(sql`
    SELECT code FROM public.items
     WHERE id = ${s.itemId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
     LIMIT 1`)) as unknown as Array<{ code: string }>;
  if (!item) throw new NotFoundError('Item not found');
  const revOf = async (id: string): Promise<{ itemId: string; rev: string } | undefined> =>
    (
      (await tx.execute(sql`
        SELECT item_id AS "itemId", rev FROM public.item_revisions
         WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
         LIMIT 1`)) as unknown as Array<{ itemId: string; rev: string }>
    )[0];
  const from = await revOf(s.fromItemRevisionId);
  if (!from || from.itemId !== s.itemId) {
    throw new ValidationError(`The old Drawing Rev is not a Rev of ${item.code}`);
  }
  if (s.classification === 'non_interchangeable') {
    if (!s.replacementItemId) {
      throw new ValidationError('Not interchangeable: pick the new item code that replaces it');
    }
    if (s.replacementItemId === s.itemId) {
      throw new ValidationError('The replacement item must be a different item code');
    }
    if (s.toItemRevisionId) {
      throw new ValidationError(
        'Not interchangeable: no new Rev of the same item — clear the new Rev',
      );
    }
    const [ri] = (await tx.execute(sql`
      SELECT 1 FROM public.items
       WHERE id = ${s.replacementItemId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
       LIMIT 1`)) as unknown as unknown[];
    if (!ri) throw new NotFoundError('Replacement item not found');
    return;
  }
  if (s.replacementItemId) {
    throw new ValidationError('A replacement item is only for a not-interchangeable change');
  }
  if (!s.toItemRevisionId) throw new ValidationError('Pick the new Drawing Rev');
  const to = await revOf(s.toItemRevisionId);
  if (!to || to.itemId !== s.itemId) {
    throw new ValidationError(`The new Drawing Rev is not a Rev of ${item.code}`);
  }
  if (s.toItemRevisionId === s.fromItemRevisionId) {
    throw new ValidationError('The new Drawing Rev must differ from the old one');
  }
}

async function nextEcrCode(tx: DbTransaction, companyId: string): Promise<string> {
  // ADR-227 — queue behind any other save numbering this series.
  await lockDocSeries(tx, companyId, 'engineering_changes');
  const rows = (await tx.execute(sql`
    SELECT COALESCE(MAX(substring(code FROM ${`^${ECR_PREFIX}(\\d+)$`})::int), 0) + 1 AS n
      FROM public.engineering_changes
     WHERE company_id = ${companyId}::uuid AND code ~ ${`^${ECR_PREFIX}\\d+$`}`)) as unknown as Array<{
    n: number;
  }>;
  return `${ECR_PREFIX}${String(Number(rows[0]?.n ?? 1)).padStart(5, '0')}`;
}

export async function createEcr(input: CreateEcrInput, user: AuthContext): Promise<Ecr> {
  await requireFormAccess(user, 'ecr_create', 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    await assertEcrShape(tx, companyId, input);
    const code = await nextEcrCode(tx, companyId);
    const [row] = (await tx.execute(sql`
      INSERT INTO public.engineering_changes
        (company_id, code, status, item_id, from_item_revision_id, to_item_revision_id,
         replacement_item_id, classification, description, customer_approval,
         customer_approval_ref, created_by, updated_by)
      VALUES (${companyId}::uuid, ${code}, 'draft', ${input.itemId}::uuid,
         ${input.fromItemRevisionId}::uuid, ${input.toItemRevisionId}::uuid,
         ${input.replacementItemId}::uuid, ${input.classification}, ${input.description},
         ${input.customerApproval}, ${input.customerApprovalRef}, ${user.id}::uuid, ${user.id}::uuid)
      RETURNING id`)) as unknown as Array<{ id: string }>;
    const id = row!.id;
    await logEcr(
      tx,
      user,
      companyId,
      { id, code },
      ActivityAction.Create,
      `${code} raised — Draft`,
    );
    return readEcrDetail(tx, companyId, id);
  });
}

/** PATCH — Draft only (§20.4: conditional on the updated_at the form loaded). */
export async function updateEcr(
  id: string,
  input: UpdateEcrInput,
  user: AuthContext,
): Promise<Ecr> {
  await requireAnyFormAccess(user, [
    ['ecr_create', 'entry'],
    ['ecr_create', 'edit'],
  ]);
  const companyId = requireCompany(user);
  const canEditAny = await hasFormAccess(user, 'ecr_create', 'edit');
  return withUserContext(user, async (tx) => {
    const e = await readEcrRow(tx, companyId, id, true);
    if (e.status !== 'draft') {
      throw new ConflictError(`${e.code} ${await stateText(tx, e)} — only a Draft can be changed.`);
    }
    if (!canEditAny && e.createdBy !== user.id) {
      throw new AuthorizationError(
        'Only the person who raised this ECR (or Edit right) may change it.',
      );
    }
    await assertSameVersion(tx, e, input.expectedUpdatedAt);
    const next: EcrShape & { description: string; customerApprovalRef: string | null } = {
      itemId: input.itemId ?? e.itemId,
      fromItemRevisionId: input.fromItemRevisionId ?? e.fromItemRevisionId,
      toItemRevisionId:
        input.toItemRevisionId !== undefined ? input.toItemRevisionId : e.toItemRevisionId,
      replacementItemId:
        input.replacementItemId !== undefined ? input.replacementItemId : e.replacementItemId,
      classification: input.classification ?? e.classification,
      customerApproval: input.customerApproval ?? e.customerApproval,
      description: input.description ?? e.description,
      customerApprovalRef:
        input.customerApprovalRef !== undefined ? input.customerApprovalRef : e.customerApprovalRef,
    };
    await assertEcrShape(tx, companyId, next);
    const done = (await tx.execute(sql`
      UPDATE public.engineering_changes
         SET item_id = ${next.itemId}::uuid, from_item_revision_id = ${next.fromItemRevisionId}::uuid,
             to_item_revision_id = ${next.toItemRevisionId}::uuid,
             replacement_item_id = ${next.replacementItemId}::uuid,
             classification = ${next.classification}, description = ${next.description},
             customer_approval = ${next.customerApproval},
             customer_approval_ref = ${next.customerApprovalRef},
             updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${id}::uuid AND status = 'draft' AND ${sameVersion(e)}
      RETURNING id`)) as unknown as unknown[];
    if (done.length === 0) await refuseChanged(tx, companyId, id, 'change');
    await logEcr(tx, user, companyId, e, ActivityAction.Edit, `${e.code} changed (Draft)`);
    return readEcrDetail(tx, companyId, id);
  });
}
