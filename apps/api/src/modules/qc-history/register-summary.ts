// QC Call Register — the whole-register summary (ADR-201 / ADR-251): stage
// counts, pcs pending and completed entries over EVERY call, never narrowed by
// search / stage / Mine / Sort & Filter. Split out of register.ts unchanged.
// ADR-284: the job-card calls by operation name, for the Operation filter.

import { sql } from 'drizzle-orm';
import { QC_GRN_TYPES, type QcGrnType, type QcRegisterSummary } from '@innovic/shared';
import type { DbTransaction as Tx } from '../../db/with-user-context';
import {
  GRN_TYPE_SQL,
  INC_PENDING_QTY,
  incCompletedFrom,
  incPendingFrom,
} from './register-incoming';
import { type OperationCount, type OperationMaster, operationStats } from './register-operations';
import { PGRN_PENDING_QTY, pgrnCompletedFrom, pgrnPendingFrom } from './register-party';
import { LOG_IS_LAST, OP_NAME_KEY, PEND_IS_LAST, logsFrom, pendingFrom } from './sql';

type Raw = Record<string, unknown>;
const rows = (r: unknown): Raw[] => r as Raw[];
const n = (r: Raw | undefined, k: string): number => Number(r?.[k] ?? 0);
const pcs = (v: number): number => Math.round(v * 1000) / 1000;

/** Whole-register figures — stage counts, pcs pending, completed entries. */
export async function registerSummary(tx: Tx, companyId: string): Promise<QcRegisterSummary> {
  // ADR-284: one read per job-card feed gives the stage figures AND the Operation
  // filter's counts (same rows the filter returns, grouped on OP_NAME_KEY).
  const opPending = rows(
    await tx.execute(sql`
      SELECT ${OP_NAME_KEY} AS "opKey", btrim(jo.operation) AS spelling, ${PEND_IS_LAST} AS "isLast",
        COUNT(*)::int AS n, COALESCE(SUM(vos.qc_pending), 0)::numeric AS pcs
      ${pendingFrom(companyId)}
      GROUP BY 1, 2, 3`),
  );
  // ADR-251: the GRN half split by GRN Type (one row per type present).
  const incByType = rows(
    await tx.execute(sql`
      SELECT ${GRN_TYPE_SQL} AS t, COUNT(*)::int AS n,
        COALESCE(SUM(${INC_PENDING_QTY}), 0)::numeric AS pcs
      ${incPendingFrom(companyId)}
      GROUP BY 1`),
  );
  const opLogged = rows(
    await tx.execute(sql`
      SELECT ${OP_NAME_KEY} AS "opKey", btrim(jo.operation) AS spelling, ${LOG_IS_LAST} AS "isLast",
        COUNT(*)::int AS n
      ${logsFrom(companyId)}
      GROUP BY 1, 2, 3`),
  );
  const incDoneByType = rows(
    await tx.execute(
      sql`SELECT ${GRN_TYPE_SQL} AS t, COUNT(*)::int AS n ${incCompletedFrom(companyId)} GROUP BY 1`,
    ),
  );
  // ADR-203: Party GRN calls count under the Incoming stage.
  const pgrn = rows(
    await tx.execute(sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(${PGRN_PENDING_QTY}), 0)::numeric AS pcs
      ${pgrnPendingFrom(companyId)}`),
  )[0];
  const pgrnDone = rows(
    await tx.execute(sql`SELECT COUNT(*)::int AS n ${pgrnCompletedFrom(companyId)}`),
  )[0];
  const masters = rows(
    await tx.execute(sql`
      SELECT lower(btrim(code)) AS "opKey", btrim(code) AS spelling
      FROM public.qc_processes
      WHERE company_id = ${companyId}::uuid AND is_active AND deleted_at IS NULL
        AND code ~ '\\S'
      ORDER BY 2`),
  );
  const sumOf = (rs: Raw[], last: boolean, k: string): number =>
    rs.filter((r) => Boolean(r['isLast']) === last).reduce((a, r) => a + n(r, k), 0);
  const counts = (rs: Raw[]): OperationCount[] =>
    rs.map((r) => ({
      opKey: (r['opKey'] as string | null) ?? null,
      spelling: (r['spelling'] as string | null) ?? null,
      n: n(r, 'n'),
    }));
  const ofType = (rs: Raw[], t: QcGrnType): Raw | undefined => rs.find((r) => r['t'] === t);
  const grnTypes = {} as QcRegisterSummary['grnTypes'];
  for (const t of QC_GRN_TYPES) {
    grnTypes[t] =
      t === 'party_grn'
        ? {
            pendingCount: n(pgrn, 'n'),
            pcsPending: pcs(n(pgrn, 'pcs')),
            doneCount: n(pgrnDone, 'n'),
          }
        : {
            pendingCount: n(ofType(incByType, t), 'n'),
            pcsPending: pcs(n(ofType(incByType, t), 'pcs')),
            doneCount: n(ofType(incDoneByType, t), 'n'),
          };
  }
  // The Incoming stage = the sum of its four GRN Types, so the two always agree.
  const types = QC_GRN_TYPES.map((t) => grnTypes[t]);
  const stages: QcRegisterSummary['stages'] = {
    incoming: {
      pendingCount: types.reduce((a, x) => a + x.pendingCount, 0),
      pcsPending: pcs(types.reduce((a, x) => a + x.pcsPending, 0)),
      doneCount: types.reduce((a, x) => a + x.doneCount, 0),
    },
    inprocess: {
      pendingCount: sumOf(opPending, false, 'n'),
      pcsPending: pcs(sumOf(opPending, false, 'pcs')),
      doneCount: sumOf(opLogged, false, 'n'),
    },
    final: {
      pendingCount: sumOf(opPending, true, 'n'),
      pcsPending: pcs(sumOf(opPending, true, 'pcs')),
      doneCount: sumOf(opLogged, true, 'n'),
    },
  };
  const all = [stages.incoming, stages.inprocess, stages.final];
  return {
    stages,
    grnTypes,
    operations: operationStats(
      counts(opPending),
      counts(opLogged),
      masters as unknown as OperationMaster[],
    ),
    pendingCount: all.reduce((a, s) => a + s.pendingCount, 0),
    completeCount: all.reduce((a, s) => a + s.doneCount, 0),
    pcsPending: pcs(all.reduce((a, s) => a + s.pcsPending, 0)),
  };
}
