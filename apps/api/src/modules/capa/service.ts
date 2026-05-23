// CAPA service (QC Wave 3). Mirrors legacy renderCAPA L22779 + _capaNew /
// _capaEdit (5-step). CRUD over capa_records (migration 0034).

import { and, desc, eq, isNull } from 'drizzle-orm';
import type {
  CapaCounters,
  CapaRecord,
  CreateCapaInput,
  ListCapaResponse,
  UpdateCapaInput,
} from '@innovic/shared';
import { capaRecords } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateLike(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function tsLike(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

type Row = typeof capaRecords.$inferSelect;

function toRecord(r: Row): CapaRecord {
  const today = todayIso();
  const targetDate = dateLike(r.targetDate);
  const overdue =
    r.status !== 'Closed' &&
    r.status !== 'Verified' &&
    targetDate !== null &&
    targetDate < today;
  return {
    id: r.id,
    companyId: r.companyId,
    code: r.code,
    type: r.type as CapaRecord['type'],
    capaDate: dateLike(r.capaDate) ?? '',
    ncRefs: Array.isArray(r.ncRefs) ? (r.ncRefs as string[]) : [],
    jcNo: r.jcNo ?? null,
    soNo: r.soNo ?? null,
    itemCode: r.itemCode ?? null,
    operation: r.operation ?? null,
    problem: r.problem,
    rootCauseMethod: r.rootCauseMethod ?? null,
    rootCause: r.rootCause ?? null,
    correctiveAction: r.correctiveAction ?? null,
    responsible: r.responsible ?? null,
    targetDate,
    verification: r.verification ?? null,
    verifiedBy: r.verifiedBy ?? null,
    verifiedDate: dateLike(r.verifiedDate),
    preventiveAction: r.preventiveAction ?? null,
    effectiveness: r.effectiveness ?? null,
    reviewDate: dateLike(r.reviewDate),
    status: r.status as CapaRecord['status'],
    department: r.department ?? null,
    overdue,
    createdAt: tsLike(r.createdAt),
    updatedAt: tsLike(r.updatedAt),
  };
}

export async function listCapa(user: AuthContext): Promise<ListCapaResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(capaRecords)
      .where(and(eq(capaRecords.companyId, companyId), isNull(capaRecords.deletedAt)))
      .orderBy(desc(capaRecords.capaDate), desc(capaRecords.code));
    const items = rows.map(toRecord);
    const closed = items.filter((c) => c.status === 'Closed');
    const closedEffective = closed.filter((c) => c.effectiveness === 'Effective');
    const counters: CapaCounters = {
      total: items.length,
      open: items.filter((c) => c.status === 'Open').length,
      inProgress: items.filter((c) => c.status === 'In Progress').length,
      verified: items.filter((c) => c.status === 'Verified').length,
      closed: closed.length,
      effectivenessPct: closed.length > 0 ? Math.round((closedEffective.length / closed.length) * 100) : 0,
    };
    return { items, counters };
  });
}

async function nextCapaNo(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  const rows = await tx
    .select({ code: capaRecords.code })
    .from(capaRecords)
    .where(eq(capaRecords.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = /^CAPA-(\d+)$/.exec(r.code);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CAPA-${String(max + 1).padStart(4, '0')}`;
}

export async function createCapa(input: CreateCapaInput, user: AuthContext): Promise<CapaRecord> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextCapaNo(tx, companyId);
    const inserted = await tx
      .insert(capaRecords)
      .values({
        companyId,
        code,
        type: input.type,
        capaDate: input.capaDate ?? todayIso(),
        ncRefs: input.ncRefs,
        jcNo: input.jcNo ?? null,
        soNo: input.soNo ?? null,
        itemCode: input.itemCode ?? null,
        operation: input.operation ?? null,
        problem: input.problem,
        status: 'Open',
        department: input.department ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    return toRecord(inserted[0] as Row);
  });
}

export async function updateCapa(
  id: string,
  input: UpdateCapaInput,
  user: AuthContext,
): Promise<CapaRecord> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(capaRecords)
      .where(
        and(
          eq(capaRecords.id, id),
          eq(capaRecords.companyId, companyId),
          isNull(capaRecords.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`CAPA ${id} not found`);

    // Only set provided fields; '' clears a date.
    const patch: Partial<typeof capaRecords.$inferInsert> = { updatedBy: user.id, updatedAt: new Date() };
    const set = <K extends keyof typeof patch>(k: K, v: (typeof patch)[K] | undefined): void => {
      if (v !== undefined) patch[k] = v;
    };
    set('problem', input.problem);
    set('rootCauseMethod', input.rootCauseMethod);
    set('rootCause', input.rootCause);
    set('correctiveAction', input.correctiveAction);
    set('responsible', input.responsible);
    if (input.targetDate !== undefined) patch.targetDate = input.targetDate === '' ? null : input.targetDate;
    set('verification', input.verification);
    set('verifiedBy', input.verifiedBy);
    if (input.verifiedDate !== undefined)
      patch.verifiedDate = input.verifiedDate === '' ? null : input.verifiedDate;
    set('preventiveAction', input.preventiveAction);
    set('effectiveness', input.effectiveness);
    if (input.reviewDate !== undefined) patch.reviewDate = input.reviewDate === '' ? null : input.reviewDate;
    set('status', input.status);

    const updated = await tx
      .update(capaRecords)
      .set(patch)
      .where(eq(capaRecords.id, id))
      .returning();
    return toRecord(updated[0] as Row);
  });
}
