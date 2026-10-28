// QC Call Register — the whole-register summary (ADR-201 / ADR-251): stage
// counts, pcs pending and completed entries over EVERY call, never narrowed by
// search / stage / Mine / Sort & Filter. Split out of register.ts unchanged.

import { sql } from 'drizzle-orm';
import { QC_GRN_TYPES, type QcGrnType, type QcRegisterSummary } from '@innovic/shared';
import type { DbTransaction as Tx } from '../../db/with-user-context';
import {
  GRN_TYPE_SQL,
  INC_PENDING_QTY,
  incCompletedFrom,
  incPendingFrom,
} from './register-incoming';
import { PGRN_PENDING_QTY, pgrnCompletedFrom, pgrnPendingFrom } from './register-party';
import { LOG_IS_LAST, PEND_IS_LAST, logsFrom, pendingFrom } from './sql';

type Raw = Record<string, unknown>;
const rows = (r: unknown): Raw[] => r as Raw[];

/** Whole-register figures — stage counts, pcs pending, completed entries. */
export async function registerSummary(tx: Tx, companyId: string): Promise<QcRegisterSummary> {
  const op = rows(
    await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${PEND_IS_LAST})::int AS "finalN",
        COUNT(*) FILTER (WHERE NOT ${PEND_IS_LAST})::int AS "ipN",
        COALESCE(SUM(vos.qc_pending) FILTER (WHERE ${PEND_IS_LAST}), 0)::numeric AS "finalPcs",
        COALESCE(SUM(vos.qc_pending) FILTER (WHERE NOT ${PEND_IS_LAST}), 0)::numeric AS "ipPcs"
      ${pendingFrom(companyId)}`),
  )[0];
  // ADR-251: the GRN half split by GRN Type (one row per type present).
  const incByType = rows(
    await tx.execute(sql`
      SELECT ${GRN_TYPE_SQL} AS t, COUNT(*)::int AS n,
        COALESCE(SUM(${INC_PENDING_QTY}), 0)::numeric AS pcs
      ${incPendingFrom(companyId)}
      GROUP BY 1`),
  );
  const opDone = rows(
    await tx.execute(sql`
      SELECT COUNT(*) FILTER (WHERE ${LOG_IS_LAST})::int AS "finalN",
        COUNT(*) FILTER (WHERE NOT ${LOG_IS_LAST})::int AS "ipN"
      ${logsFrom(companyId)}`),
  )[0];
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
  const n = (r: Raw | undefined, k: string): number => Number(r?.[k] ?? 0);
  const pcs = (v: number): number => Math.round(v * 1000) / 1000;
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
    grnTypes,
    pendingCount: all.reduce((a, s) => a + s.pendingCount, 0),
    completeCount: all.reduce((a, s) => a + s.doneCount, 0),
    pcsPending: pcs(all.reduce((a, s) => a + s.pcsPending, 0)),
  };
}
