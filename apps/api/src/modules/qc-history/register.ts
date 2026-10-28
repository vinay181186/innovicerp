// QC Call Register (ADR-201) — GET /qc-history/register.
//
// Incoming (GRN line) and process (job-card op) QC calls paged TOGETHER on the
// server: a UNION of the two kinds' keys carries the register's order, the
// requested page of keys is cut with LIMIT / OFFSET, and only those rows are
// then read in full. Search, the stage and "Mine" narrow both halves in SQL,
// so the total and every page are over ALL matching calls. The summary (stage
// counts, pcs pending, completed count) is over the WHOLE register.
//
//   pending:   incoming first (oldest GRN first), then process calls (latest
//              QC call first) — the order the register has always shown.
//   completed: both kinds interleaved, newest inspection first.
//
// ADR-203: Party GRN lines (customer material against a JWSO line) are a third
// kind, 'pgrn'. They belong to the Incoming stage: they ride with the GRN half
// everywhere (on / off, sort keys, stage counts).
//
// ADR-251: `grnType` narrows to incoming calls of those GRN Types — the
// job-card half drops out, the GRN half keeps only its listed types
// (GRN_TYPE_SQL), the Party GRN half is on only for 'party_grn'. Incoming QC
// is this register with grnType = purchase,party_grn.
//
// Sort & Filter (ADR-200): every union part also SELECTs one sf_* column per
// field (register-sf.ts), and the page + count filter / sort on them. Each call
// carries its QcRegisterFacts — Client PO No. and the source step's Planned /
// Actual Machine (register-facts.ts). The summary lives in register-summary.ts.

import { type SQL, sql } from 'drizzle-orm';
import {
  type QcRegisterCompletedItem,
  type QcRegisterPendingItem,
  type QcRegisterResponse,
  type QcRegisterStage,
  type QcSourceStep,
  type qcRegisterQuerySchema,
  shortName,
} from '@innovic/shared';
import type { z } from 'zod';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import {
  type AuthContext,
  type DbTransaction as Tx,
  withUserContext,
} from '../../db/with-user-context';
import {
  GRN_TYPE_SQL,
  INC_COMPLETED_SELECT,
  INC_DONE_AT,
  INC_PENDING_SELECT,
  incCompletedFrom,
  incPendingFrom,
  type IncGrnType,
  incSearchWhere,
  toIncCompletedRow,
  toIncGrnType,
  toIncPendingRow,
} from './register-incoming';
import {
  PGRN_COMPLETED_SELECT,
  PGRN_DONE_AT,
  PGRN_PENDING_SELECT,
  pgrnCompletedFrom,
  pgrnPendingFrom,
  pgrnSearchWhere,
  toPgrnRow,
} from './register-party';
import { CLIENT_PO_NO_SQL, PGRN_CLIENT_PO_NO, loadSourceSteps } from './register-facts';
import {
  INC_COMPLETED_SF,
  INC_PENDING_SF,
  OP_COMPLETED_SF,
  OP_PENDING_SF,
  PGRN_COMPLETED_SF,
  PGRN_PENDING_SF,
  QC_REGISTER_COMPLETED_SF_COLUMNS,
  QC_REGISTER_PENDING_SF_COLUMNS,
  sfNulls,
} from './register-sf';
import { registerSummary } from './register-summary';
import { requireCompany } from './service';
import {
  LOGS_SELECT,
  LOG_IS_LAST,
  PENDING_SELECT,
  PEND_IS_LAST,
  logsFrom,
  opSearchWhere,
  overdueToday,
  pendingFrom,
  toLogRow,
  toPendingRow,
} from './sql';

type Input = z.output<typeof qcRegisterQuerySchema>;
type Raw = Record<string, unknown>;
const rows = (r: unknown): Raw[] => r as Raw[];

/** Process-QC stage narrowing on the last-op test. */
function opStageWhere(stage: QcRegisterStage | undefined, isLast: SQL): SQL {
  if (stage === 'final') return sql`AND ${isLast}`;
  if (stage === 'inprocess') return sql`AND NOT ${isLast}`;
  return sql``;
}

function idList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** ADR-251: `AND <type> IN (…)` for the GRN half — empty when not narrowed. */
function incTypeWhere(types: readonly IncGrnType[] | null): SQL {
  if (types === null) return sql``;
  return sql`AND ${GRN_TYPE_SQL} IN (${sql.join(
    types.map((t) => sql`${t}`),
    sql`, `,
  )})`;
}

/** The caller's full name + short form, lower-cased — "Mine" matches either. */
async function myNames(tx: Tx, userId: string): Promise<string[]> {
  const r = rows(
    await tx.execute(sql`SELECT full_name FROM public.users WHERE id = ${userId}::uuid`),
  );
  const full = String(r[0]?.['full_name'] ?? '').trim();
  return [...new Set([full.toLowerCase(), shortName(full).toLowerCase()].filter(Boolean))];
}

export async function listQcRegister(input: Input, user: AuthContext): Promise<QcRegisterResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const one = input.jcOpId !== undefined || input.grnLineId !== undefined;
    // Which halves take part: a stage other than Incoming drops the GRN half,
    // Incoming drops the process half; "Mine" (pending only) keeps only
    // process calls assigned to the caller — GRN calls carry no assignment.
    const mine = input.view === 'pending' && input.mine;
    let incOn = (input.stage === undefined || input.stage === 'incoming') && !mine;
    let opOn = input.stage !== 'incoming';
    // Party GRN calls: same stage + "Mine" rule as the GRN half; no deep link.
    let pgrnOn = incOn;
    // ADR-251 GRN Type: process calls drop out; each GRN half stays on only
    // when one of its types is asked for (on top of the stage / "Mine" rule).
    let incTypes: IncGrnType[] | null = null;
    if (input.grnType !== undefined) {
      incTypes = input.grnType.filter((t): t is IncGrnType => t !== 'party_grn');
      opOn = false;
      incOn = incOn && incTypes.length > 0;
      pgrnOn = pgrnOn && input.grnType.includes('party_grn');
    }
    if (one) {
      // The single-call read (?line= / ?op=) still honours the GRN Type.
      incOn = input.grnLineId !== undefined && (incTypes === null || incTypes.length > 0);
      opOn = input.jcOpId !== undefined && input.grnType === undefined;
      pgrnOn = false;
    }
    let mineWhere = sql``;
    if (mine) {
      const names = await myNames(tx, user.id);
      mineWhere =
        names.length > 0
          ? sql`AND lower(btrim(qa.inspector_name)) IN (${sql.join(
              names.map((n) => sql`${n}`),
              sql`, `,
            )})`
          : sql`AND FALSE`;
    }

    let keys: SQL;
    // Applied on the SAME select as LIMIT / OFFSET — an ORDER BY inside a
    // subquery is not guaranteed to survive, so pages could skip / repeat.
    let order: SQL;
    if (input.view === 'pending') {
      const incPart = sql`
        SELECT 'inc'::text AS kind, l.id AS id, 0 AS k0, h.grn_date AS d_inc, h.code AS c_inc,
          NULL::date AS d_op, NULL::text AS c_op, NULL::int AS s_op ${INC_PENDING_SF}
        ${incPendingFrom(companyId)} ${incSearchWhere(input.search, true)} ${incTypeWhere(incTypes)}
        ${input.grnLineId ? sql`AND l.id = ${input.grnLineId}::uuid` : sql``}`;
      const opPart = sql`
        SELECT 'op'::text AS kind, vos.jc_op_id AS id, 1 AS k0, NULL::date AS d_inc,
          NULL::text AS c_inc, jo.qc_call_date AS d_op, jc.code::text AS c_op, vos.op_seq::int AS s_op
          ${OP_PENDING_SF}
        ${pendingFrom(companyId)} ${opSearchWhere(input.search)}
        ${opStageWhere(input.stage, PEND_IS_LAST)} ${mineWhere}
        ${input.jcOpId ? sql`AND vos.jc_op_id = ${input.jcOpId}::uuid` : sql``}`;
      const pgrnPart = sql`
        SELECT 'pgrn'::text AS kind, pgl.id AS id, 0 AS k0, pg.grn_date AS d_inc, pg.code AS c_inc,
          NULL::date AS d_op, NULL::text AS c_op, NULL::int AS s_op ${PGRN_PENDING_SF}
        ${pgrnPendingFrom(companyId)} ${pgrnSearchWhere(input.search)}`;
      keys = unionOf(
        [incOn ? incPart : null, pgrnOn ? pgrnPart : null, opOn ? opPart : null],
        'pending',
      );
      order = sql`k0, d_inc ASC, c_inc ASC, d_op DESC NULLS LAST, c_op, s_op, id`;
    } else {
      const incPart = sql`
        SELECT 'inc'::text AS kind, l.id AS id, ${INC_DONE_AT} AS at ${INC_COMPLETED_SF}
        ${incCompletedFrom(companyId)} ${incSearchWhere(input.search, false)}
        ${incTypeWhere(incTypes)}`;
      const opPart = sql`
        SELECT 'op'::text AS kind, ol.id AS id, ol.created_at AS at ${OP_COMPLETED_SF}
        ${logsFrom(companyId)} ${opSearchWhere(input.search)}
        ${opStageWhere(input.stage, LOG_IS_LAST)}`;
      const pgrnPart = sql`
        SELECT 'pgrn'::text AS kind, pgl.id AS id, ${PGRN_DONE_AT} AS at ${PGRN_COMPLETED_SF}
        ${pgrnCompletedFrom(companyId)} ${pgrnSearchWhere(input.search)}`;
      keys = unionOf(
        [incOn ? incPart : null, pgrnOn ? pgrnPart : null, opOn ? opPart : null],
        'completed',
      );
      order = sql`at DESC, kind, id`;
    }

    // Sort & Filter (ADR-200) over the union's sf_* columns (register-sf.ts):
    // the same filter on the page AND the count; the chosen sort first, the
    // register's own order as the tie-breaker so pages stay stable.
    const sf = readSf(input.sf);
    const sfMap =
      input.view === 'pending' ? QC_REGISTER_PENDING_SF_COLUMNS : QC_REGISTER_COMPLETED_SF_COLUMNS;
    const sfFilter = sql`WHERE TRUE ${sfWhere(sfMap, sf)}`;
    const page = rows(
      await tx.execute(
        sql`SELECT kind, id FROM (${keys}) k ${sfFilter} ORDER BY ${sfOrderBy(sfMap, sf, order)} LIMIT ${input.limit} OFFSET ${input.offset}`,
      ),
    );
    const cnt = rows(await tx.execute(sql`SELECT COUNT(*)::int AS n FROM (${keys}) k ${sfFilter}`));
    const items = await hydrate(tx, companyId, input.view, page);
    const summary = await registerSummary(tx, companyId);
    return { items, total: Number(cnt[0]?.['n'] ?? 0), summary };
  });
}

/** UNION ALL of the parts taking part (an empty set when none does — with
 *  every column the outer query reads, the view's sf_* columns included). */
function unionOf(parts: Array<SQL | null>, view: Input['view']): SQL {
  const on = parts.filter((p): p is SQL => p !== null);
  if (on.length > 0) return sql`SELECT * FROM (${sql.join(on, sql` UNION ALL `)}) u`;
  return sql`SELECT NULL::text AS kind, NULL::uuid AS id, 0 AS k0, NULL::date AS d_inc,
    NULL::text AS c_inc, NULL::date AS d_op, NULL::text AS c_op, NULL::int AS s_op,
    NULL::timestamptz AS at ${sfNulls(view)} WHERE FALSE`;
}

/** The Client PO No. each row query adds beside its SELECT (register-facts.ts). */
const clientPoOf = (x: Raw): string | null => (x['clientPoNo'] as string | null) ?? null;

/** Read the page's rows in full, in the page's order — each with its
 *  QcRegisterFacts (Client PO No.; the source step on job-card calls, read for
 *  the whole page in one query). */
async function hydrate(
  tx: Tx,
  companyId: string,
  view: Input['view'],
  page: Raw[],
): Promise<Array<QcRegisterPendingItem | QcRegisterCompletedItem>> {
  const incIds = page.filter((k) => k['kind'] === 'inc').map((k) => String(k['id']));
  const opIds = page.filter((k) => k['kind'] === 'op').map((k) => String(k['id']));
  const pgrnIds = page.filter((k) => k['kind'] === 'pgrn').map((k) => String(k['id']));
  const byId = new Map<string, QcRegisterPendingItem | QcRegisterCompletedItem>();
  const steps =
    opIds.length > 0
      ? await loadSourceSteps(tx, companyId, view, idList(opIds))
      : new Map<string, QcSourceStep>();
  const stepOf = (id: string): QcSourceStep | null => steps.get(id) ?? null;
  if (view === 'pending') {
    if (incIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${INC_PENDING_SELECT}, ${CLIENT_PO_NO_SQL} AS "clientPoNo"
          ${incPendingFrom(companyId)} AND l.id IN (${idList(incIds)})`,
      );
      for (const x of rows(r))
        byId.set(`inc:${String(x['grnLineId'])}`, {
          kind: 'inc',
          row: toIncPendingRow(x),
          grnType: toIncGrnType(x['grnType']),
          clientPoNo: clientPoOf(x),
          sourceStep: null,
        });
    }
    if (pgrnIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${PGRN_PENDING_SELECT}, ${PGRN_CLIENT_PO_NO} AS "clientPoNo"
          ${pgrnPendingFrom(companyId)} AND pgl.id IN (${idList(pgrnIds)})`,
      );
      for (const x of rows(r))
        byId.set(`pgrn:${String(x['partyGrnLineId'])}`, {
          kind: 'pgrn',
          row: toPgrnRow(x),
          clientPoNo: clientPoOf(x),
          sourceStep: null,
        });
    }
    if (opIds.length > 0) {
      const today = overdueToday();
      const r = await tx.execute(
        sql`SELECT ${PENDING_SELECT}, ${CLIENT_PO_NO_SQL} AS "clientPoNo"
          ${pendingFrom(companyId)} AND vos.jc_op_id IN (${idList(opIds)})`,
      );
      for (const x of rows(r)) {
        const id = String(x['jcOpId']);
        byId.set(`op:${id}`, {
          kind: 'op',
          row: toPendingRow(x, today),
          clientPoNo: clientPoOf(x),
          sourceStep: stepOf(id),
        });
      }
    }
  } else {
    if (incIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${INC_COMPLETED_SELECT}, ${CLIENT_PO_NO_SQL} AS "clientPoNo"
          ${incCompletedFrom(companyId)} AND l.id IN (${idList(incIds)})`,
      );
      for (const x of rows(r))
        byId.set(`inc:${String(x['grnLineId'])}`, {
          kind: 'inc',
          row: toIncCompletedRow(x),
          grnType: toIncGrnType(x['grnType']),
          clientPoNo: clientPoOf(x),
          sourceStep: null,
        });
    }
    if (pgrnIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${PGRN_COMPLETED_SELECT}, ${PGRN_CLIENT_PO_NO} AS "clientPoNo"
          ${pgrnCompletedFrom(companyId)} AND pgl.id IN (${idList(pgrnIds)})`,
      );
      for (const x of rows(r))
        byId.set(`pgrn:${String(x['partyGrnLineId'])}`, {
          kind: 'pgrn',
          row: toPgrnRow(x),
          clientPoNo: clientPoOf(x),
          sourceStep: null,
        });
    }
    if (opIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${LOGS_SELECT}, ${CLIENT_PO_NO_SQL} AS "clientPoNo"
          ${logsFrom(companyId)} AND ol.id IN (${idList(opIds)})`,
      );
      for (const x of rows(r)) {
        const id = String(x['logId']);
        byId.set(`op:${id}`, {
          kind: 'op',
          row: toLogRow(x),
          clientPoNo: clientPoOf(x),
          sourceStep: stepOf(id),
        });
      }
    }
  }
  const out: Array<QcRegisterPendingItem | QcRegisterCompletedItem> = [];
  for (const k of page) {
    const it = byId.get(`${String(k['kind'])}:${String(k['id'])}`);
    if (it) out.push(it);
  }
  return out;
}
