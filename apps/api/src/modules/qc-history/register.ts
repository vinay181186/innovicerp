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

import { type SQL, sql } from 'drizzle-orm';
import {
  type QcRegisterCompletedItem,
  type QcRegisterPendingItem,
  type QcRegisterResponse,
  type QcRegisterStage,
  type QcRegisterSummary,
  type qcRegisterQuerySchema,
  shortName,
} from '@innovic/shared';
import type { z } from 'zod';
import {
  type AuthContext,
  type DbTransaction as Tx,
  withUserContext,
} from '../../db/with-user-context';
import {
  INC_COMPLETED_SELECT,
  INC_DONE_AT,
  INC_PENDING_QTY,
  INC_PENDING_SELECT,
  incCompletedFrom,
  incPendingFrom,
  incSearchWhere,
  toIncCompletedRow,
  toIncPendingRow,
} from './register-incoming';
import {
  PGRN_COMPLETED_SELECT,
  PGRN_DONE_AT,
  PGRN_PENDING_QTY,
  PGRN_PENDING_SELECT,
  pgrnCompletedFrom,
  pgrnPendingFrom,
  pgrnSearchWhere,
  toPgrnRow,
} from './register-party';
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
    if (one) {
      incOn = input.grnLineId !== undefined;
      opOn = input.jcOpId !== undefined;
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
          NULL::date AS d_op, NULL::text AS c_op, NULL::int AS s_op
        ${incPendingFrom(companyId)} ${incSearchWhere(input.search, true)}
        ${input.grnLineId ? sql`AND l.id = ${input.grnLineId}::uuid` : sql``}`;
      const opPart = sql`
        SELECT 'op'::text AS kind, vos.jc_op_id AS id, 1 AS k0, NULL::date AS d_inc,
          NULL::text AS c_inc, jo.qc_call_date AS d_op, jc.code::text AS c_op, vos.op_seq::int AS s_op
        ${pendingFrom(companyId)} ${opSearchWhere(input.search)}
        ${opStageWhere(input.stage, PEND_IS_LAST)} ${mineWhere}
        ${input.jcOpId ? sql`AND vos.jc_op_id = ${input.jcOpId}::uuid` : sql``}`;
      const pgrnPart = sql`
        SELECT 'pgrn'::text AS kind, pgl.id AS id, 0 AS k0, pg.grn_date AS d_inc, pg.code AS c_inc,
          NULL::date AS d_op, NULL::text AS c_op, NULL::int AS s_op
        ${pgrnPendingFrom(companyId)} ${pgrnSearchWhere(input.search)}`;
      keys = unionOf([incOn ? incPart : null, pgrnOn ? pgrnPart : null, opOn ? opPart : null]);
      order = sql`k0, d_inc ASC, c_inc ASC, d_op DESC NULLS LAST, c_op, s_op, id`;
    } else {
      const incPart = sql`
        SELECT 'inc'::text AS kind, l.id AS id, ${INC_DONE_AT} AS at
        ${incCompletedFrom(companyId)} ${incSearchWhere(input.search, false)}`;
      const opPart = sql`
        SELECT 'op'::text AS kind, ol.id AS id, ol.created_at AS at
        ${logsFrom(companyId)} ${opSearchWhere(input.search)}
        ${opStageWhere(input.stage, LOG_IS_LAST)}`;
      const pgrnPart = sql`
        SELECT 'pgrn'::text AS kind, pgl.id AS id, ${PGRN_DONE_AT} AS at
        ${pgrnCompletedFrom(companyId)} ${pgrnSearchWhere(input.search)}`;
      keys = unionOf([incOn ? incPart : null, pgrnOn ? pgrnPart : null, opOn ? opPart : null]);
      order = sql`at DESC, kind, id`;
    }

    const page = rows(
      await tx.execute(
        sql`SELECT kind, id FROM (${keys}) k ORDER BY ${order} LIMIT ${input.limit} OFFSET ${input.offset}`,
      ),
    );
    const cnt = rows(await tx.execute(sql`SELECT COUNT(*)::int AS n FROM (${keys}) k`));
    const items = await hydrate(tx, companyId, input.view, page);
    const summary = await registerSummary(tx, companyId);
    return { items, total: Number(cnt[0]?.['n'] ?? 0), summary };
  });
}

/** UNION ALL of the parts taking part (an empty set when none does). */
function unionOf(parts: Array<SQL | null>): SQL {
  const on = parts.filter((p): p is SQL => p !== null);
  if (on.length > 0) return sql`SELECT * FROM (${sql.join(on, sql` UNION ALL `)}) u`;
  return sql`SELECT NULL::text AS kind, NULL::uuid AS id, 0 AS k0, NULL::date AS d_inc,
    NULL::text AS c_inc, NULL::date AS d_op, NULL::text AS c_op, NULL::int AS s_op,
    NULL::timestamptz AS at WHERE FALSE`;
}

/** Read the page's rows in full, in the page's order. */
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
  if (view === 'pending') {
    if (incIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${INC_PENDING_SELECT} ${incPendingFrom(companyId)} AND l.id IN (${idList(incIds)})`,
      );
      for (const x of rows(r))
        byId.set(`inc:${String(x['grnLineId'])}`, { kind: 'inc', row: toIncPendingRow(x) });
    }
    if (pgrnIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${PGRN_PENDING_SELECT} ${pgrnPendingFrom(companyId)} AND pgl.id IN (${idList(pgrnIds)})`,
      );
      for (const x of rows(r))
        byId.set(`pgrn:${String(x['partyGrnLineId'])}`, { kind: 'pgrn', row: toPgrnRow(x) });
    }
    if (opIds.length > 0) {
      const today = overdueToday();
      const r = await tx.execute(
        sql`SELECT ${PENDING_SELECT} ${pendingFrom(companyId)} AND vos.jc_op_id IN (${idList(opIds)})`,
      );
      for (const x of rows(r))
        byId.set(`op:${String(x['jcOpId'])}`, { kind: 'op', row: toPendingRow(x, today) });
    }
  } else {
    if (incIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${INC_COMPLETED_SELECT} ${incCompletedFrom(companyId)} AND l.id IN (${idList(incIds)})`,
      );
      for (const x of rows(r))
        byId.set(`inc:${String(x['grnLineId'])}`, { kind: 'inc', row: toIncCompletedRow(x) });
    }
    if (pgrnIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${PGRN_COMPLETED_SELECT} ${pgrnCompletedFrom(companyId)} AND pgl.id IN (${idList(pgrnIds)})`,
      );
      for (const x of rows(r))
        byId.set(`pgrn:${String(x['partyGrnLineId'])}`, { kind: 'pgrn', row: toPgrnRow(x) });
    }
    if (opIds.length > 0) {
      const r = await tx.execute(
        sql`SELECT ${LOGS_SELECT} ${logsFrom(companyId)} AND ol.id IN (${idList(opIds)})`,
      );
      for (const x of rows(r))
        byId.set(`op:${String(x['logId'])}`, { kind: 'op', row: toLogRow(x) });
    }
  }
  const out: Array<QcRegisterPendingItem | QcRegisterCompletedItem> = [];
  for (const k of page) {
    const it = byId.get(`${String(k['kind'])}:${String(k['id'])}`);
    if (it) out.push(it);
  }
  return out;
}

/** Whole-register figures — stage counts, pcs pending, completed entries. */
async function registerSummary(tx: Tx, companyId: string): Promise<QcRegisterSummary> {
  const op = rows(
    await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${PEND_IS_LAST})::int AS "finalN",
        COUNT(*) FILTER (WHERE NOT ${PEND_IS_LAST})::int AS "ipN",
        COALESCE(SUM(vos.qc_pending) FILTER (WHERE ${PEND_IS_LAST}), 0)::numeric AS "finalPcs",
        COALESCE(SUM(vos.qc_pending) FILTER (WHERE NOT ${PEND_IS_LAST}), 0)::numeric AS "ipPcs"
      ${pendingFrom(companyId)}`),
  )[0];
  const inc = rows(
    await tx.execute(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(${INC_PENDING_QTY}), 0)::numeric AS pcs
      ${incPendingFrom(companyId)}`),
  )[0];
  const opDone = rows(
    await tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE ${LOG_IS_LAST})::int AS "finalN",
        COUNT(*) FILTER (WHERE NOT ${LOG_IS_LAST})::int AS "ipN"
      ${logsFrom(companyId)}`),
  )[0];
  const incDone = rows(
    await tx.execute(sql`SELECT COUNT(*)::int AS n ${incCompletedFrom(companyId)}`),
  )[0];
  // ADR-203: Party GRN calls count under the Incoming stage.
  const pgrn = rows(
    await tx.execute(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(${PGRN_PENDING_QTY}), 0)::numeric AS pcs
      ${pgrnPendingFrom(companyId)}`),
  )[0];
  const pgrnDone = rows(
    await tx.execute(sql`SELECT COUNT(*)::int AS n ${pgrnCompletedFrom(companyId)}`),
  )[0];
  const n = (r: Raw | undefined, k: string): number => Number(r?.[k] ?? 0);
  const pcs = (v: number): number => Math.round(v * 1000) / 1000;
  const stages: QcRegisterSummary['stages'] = {
    incoming: {
      pendingCount: n(inc, 'n') + n(pgrn, 'n'),
      pcsPending: pcs(n(inc, 'pcs') + n(pgrn, 'pcs')),
      doneCount: n(incDone, 'n') + n(pgrnDone, 'n'),
    },
    inprocess: {
      pendingCount: n(op, 'ipN'),
      pcsPending: pcs(n(op, 'ipPcs')),
      doneCount: n(opDone, 'ipN'),
    },
    final: {
      pendingCount: n(op, 'finalN'),
      pcsPending: pcs(n(op, 'finalPcs')),
      doneCount: n(opDone, 'finalN'),
    },
  };
  const all = [stages.incoming, stages.inprocess, stages.final];
  return {
    stages,
    pendingCount: all.reduce((a, s) => a + s.pendingCount, 0),
    completeCount: all.reduce((a, s) => a + s.doneCount, 0),
    pcsPending: pcs(all.reduce((a, s) => a + s.pcsPending, 0)),
  };
}
