// THE "last stage" test in SQL: the op holds its job card's highest live
// op_seq. Same criterion as the stock credit (op-entry/qc-stock-cascade.ts) and
// the Last Stage Only report rule (0235). `op` = the alias the caller gave
// public.jc_ops — a column alias written in this codebase, never user input.

import { type SQL, sql } from 'drizzle-orm';

const ALIAS = /^[a-z_][a-z0-9_]*$/;

export function isLastLiveOpSql(op: string): SQL {
  if (!ALIAS.test(op)) throw new Error(`isLastLiveOpSql: bad alias "${op}"`);
  const a = sql.raw(op);
  return sql`(${a}.op_seq = (SELECT MAX(lo.op_seq) FROM public.jc_ops lo
    WHERE lo.job_card_id = ${a}.job_card_id AND lo.deleted_at IS NULL))`;
}
