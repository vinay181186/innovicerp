// CAPA service (QC Wave 3). Mirrors legacy renderCAPA L22779 + _capaNew /
// _capaEdit (5-step). CRUD over capa_records (migration 0034).

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CapaCounters,
  CapaRecord,
  CreateCapaInput,
  ListCapaQuery,
  ListCapaResponse,
  UpdateCapaInput,
} from '@innovic/shared';
import { capaRecords } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { CAPA_NC_REFS_TEXT, CAPA_SF_COLUMNS } from './sf-columns';

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

/** The drawing revision and the customer's own PO line number for a CAPA. */
interface LineFacts {
  itemRevision: string | null;
  clientPoLineNo: string | null;
}

const NO_LINE_FACTS: LineFacts = { itemRevision: null, clientPoLineNo: null };

type Tx = Parameters<Parameters<typeof withUserContext>[1]>[0];

/**
 * Resolve the drawing revision + customer PO line number for a set of CAPAs.
 *
 * A CAPA hangs off the NC → job card chain, so the facts come from the same
 * place nc-register reads them (service.ts ~L431): the SO line the card was
 * raised against, falling back to the JW line for the revision only. POL is
 * SO-side only — a job-work line belongs to a job-work order, not to a
 * customer PO, so it correctly stays null there.
 *
 * capa_records stores `jc_no` as free TEXT with no foreign key, so the hop is
 * by code inside the company; job_cards_company_code_uniq makes that one row.
 * One extra round trip per request, never one per record.
 */
async function lineFactsByJcNo(
  tx: Tx,
  companyId: string,
  jcNos: string[],
): Promise<Map<string, LineFacts>> {
  const out = new Map<string, LineFacts>();
  if (jcNos.length === 0) return out;
  const result = await tx.execute(sql`
    SELECT
      jc.code AS "jcNo",
      -- Cast to text: the contract types this as a string, and the column is
      -- only text on a database that has had migration 0119.
      COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
      sol.client_po_line_no AS "clientPoLineNo"
    FROM public.job_cards jc
    LEFT JOIN public.sales_order_lines sol
      ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines rev_jwl
      ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
    WHERE jc.company_id = ${companyId}
      AND jc.deleted_at IS NULL
      AND jc.code IN (${sql.join(
        jcNos.map((c) => sql`${c}`),
        sql`, `,
      )})
  `);
  for (const r of result as unknown as Array<Record<string, unknown>>) {
    const key = r['jcNo'] == null ? null : String(r['jcNo']);
    if (key === null) continue;
    out.set(key, {
      itemRevision: r['itemRevision'] == null ? null : String(r['itemRevision']),
      clientPoLineNo: r['clientPoLineNo'] == null ? null : String(r['clientPoLineNo']),
    });
  }
  return out;
}

function toRecord(r: Row, facts: LineFacts = NO_LINE_FACTS): CapaRecord {
  const today = todayIso();
  const targetDate = dateLike(r.targetDate);
  const overdue =
    r.status !== 'Closed' && r.status !== 'Verified' && targetDate !== null && targetDate < today;
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
    itemRevision: facts.itemRevision,
    clientPoLineNo: facts.clientPoLineNo,
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

/** Every column the CAPA row shows (+ the ▸ facts), for the server search. */
function capaSearchSql(term: string | undefined) {
  const q = (term ?? '').trim().replace(/\s+/g, ' ');
  if (q === '') return sql``;
  const pat = `%${likeEscape(q)}%`;
  const fields = [
    sql`${capaRecords.code}`,
    sql`${capaRecords.type}`,
    CAPA_NC_REFS_TEXT,
    sql`${capaRecords.problem}`,
    sql`${capaRecords.responsible}`,
    sql`to_char(${capaRecords.targetDate}, 'DD-Mon-YYYY')`,
    sql`${capaRecords.status}`,
    sql`to_char(${capaRecords.capaDate}, 'DD-Mon-YYYY')`,
    sql`${capaRecords.rootCause}`,
    sql`${capaRecords.jcNo}`,
  ];
  return sql`AND (${sql.join(
    fields.map((f) => sql`${f} ILIKE ${pat} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

/**
 * CAPA list (ADR-201): search + Sort & Filter on the server, 25-row pages when
 * the screen passes `limit` (no `limit` → every CAPA, as before). `total` uses
 * the page's WHERE; the counter strip + overdue are over ALL CAPAs.
 */
export async function listCapa(
  user: AuthContext,
  input: ListCapaQuery = {},
): Promise<ListCapaResponse> {
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  const today = todayIso();
  return withUserContext(user, async (tx) => {
    const where = sql`${capaRecords.companyId} = ${companyId} AND ${capaRecords.deletedAt} IS NULL
      ${capaSearchSql(input.search)} ${sfWhere(CAPA_SF_COLUMNS, sf)}`;
    const order = sfOrderBy(
      CAPA_SF_COLUMNS,
      sf,
      sql`${capaRecords.capaDate} DESC, ${capaRecords.code} DESC, ${capaRecords.id} DESC`,
    );
    const base = tx.select().from(capaRecords).where(where).orderBy(order);
    const offset = input.offset ?? 0;
    const rows =
      input.limit !== undefined
        ? await base.limit(input.limit).offset(offset)
        : offset > 0
          ? await base.offset(offset)
          : await base;
    const [cnt] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(capaRecords)
      .where(where);
    const [sum] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        open: sql<number>`count(*) FILTER (WHERE ${capaRecords.status} = 'Open')::int`,
        inProgress: sql<number>`count(*) FILTER (WHERE ${capaRecords.status} = 'In Progress')::int`,
        verified: sql<number>`count(*) FILTER (WHERE ${capaRecords.status} = 'Verified')::int`,
        closed: sql<number>`count(*) FILTER (WHERE ${capaRecords.status} = 'Closed')::int`,
        closedEffective: sql<number>`count(*) FILTER (WHERE ${capaRecords.status} = 'Closed' AND ${capaRecords.effectiveness} = 'Effective')::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${capaRecords.status} NOT IN ('Closed', 'Verified') AND ${capaRecords.targetDate} < ${today}::date)::int`,
      })
      .from(capaRecords)
      .where(and(eq(capaRecords.companyId, companyId), isNull(capaRecords.deletedAt)));
    const facts = await lineFactsByJcNo(tx, companyId, [
      ...new Set(rows.map((r) => r.jcNo).filter((c): c is string => !!c)),
    ]);
    const items = rows.map((r) => toRecord(r, (r.jcNo && facts.get(r.jcNo)) || NO_LINE_FACTS));
    const closed = Number(sum?.closed ?? 0);
    const counters: CapaCounters = {
      total: Number(sum?.total ?? 0),
      open: Number(sum?.open ?? 0),
      inProgress: Number(sum?.inProgress ?? 0),
      verified: Number(sum?.verified ?? 0),
      closed,
      effectivenessPct:
        closed > 0 ? Math.round((Number(sum?.closedEffective ?? 0) / closed) * 100) : 0,
      overdue: Number(sum?.overdue ?? 0),
    };
    return { items, total: Number(cnt?.n ?? 0), counters };
  });
}

async function nextCapaNo(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  // ADR-227: queue behind any other save numbering this series.
  await lockDocSeries(tx, companyId, 'capa_records');
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

export async function getNextCapaCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextCapaNo(tx, companyId);
    return { code };
  });
}

export async function createCapa(input: CreateCapaInput, user: AuthContext): Promise<CapaRecord> {
  // ADR-035: until now this had no permission check at all — any logged-in user
  // could raise a CAPA. `capa_create` was a registered form key nothing ever
  // consulted; this is the first place it is enforced. Raising a CAPA is a
  // create, so `entry` (L2 Data Entry and above in QC). Admins bypass.
  await requireFormAccess(user, 'capa_create', 'entry');
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
    const created = inserted[0] as Row;
    const facts = await lineFactsByJcNo(tx, companyId, created.jcNo ? [created.jcNo] : []);
    return toRecord(created, (created.jcNo && facts.get(created.jcNo)) || NO_LINE_FACTS);
  });
}

export async function updateCapa(
  id: string,
  input: UpdateCapaInput,
  user: AuthContext,
): Promise<CapaRecord> {
  // Progressing a CAPA through the 5 steps (root cause → verification →
  // closure) rewrites a saved record, so it is `edit` (L3 and above), not
  // `entry` — an L2 hand may open a CAPA but not carry it to Closed.
  await requireFormAccess(user, 'capa_create', 'edit');
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
    if (existing.length === 0) throw new NotFoundError('CAPA not found. Refresh the page.');

    // Only set provided fields; '' clears a date.
    const patch: Partial<typeof capaRecords.$inferInsert> = {
      updatedBy: user.id,
      updatedAt: new Date(),
    };
    const set = <K extends keyof typeof patch>(k: K, v: (typeof patch)[K] | undefined): void => {
      if (v !== undefined) patch[k] = v;
    };
    set('problem', input.problem);
    set('rootCauseMethod', input.rootCauseMethod);
    set('rootCause', input.rootCause);
    set('correctiveAction', input.correctiveAction);
    set('responsible', input.responsible);
    if (input.targetDate !== undefined)
      patch.targetDate = input.targetDate === '' ? null : input.targetDate;
    set('verification', input.verification);
    set('verifiedBy', input.verifiedBy);
    if (input.verifiedDate !== undefined)
      patch.verifiedDate = input.verifiedDate === '' ? null : input.verifiedDate;
    set('preventiveAction', input.preventiveAction);
    set('effectiveness', input.effectiveness);
    if (input.reviewDate !== undefined)
      patch.reviewDate = input.reviewDate === '' ? null : input.reviewDate;
    set('status', input.status);

    const updated = await tx
      .update(capaRecords)
      .set(patch)
      .where(eq(capaRecords.id, id))
      .returning();
    const row = updated[0] as Row;
    const facts = await lineFactsByJcNo(tx, companyId, row.jcNo ? [row.jcNo] : []);
    return toRecord(row, (row.jcNo && facts.get(row.jcNo)) || NO_LINE_FACTS);
  });
}
