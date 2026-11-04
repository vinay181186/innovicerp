import { sql, type SQL } from 'drizzle-orm';

// ADR-267 — the bare order No. of a row traced to a Job Card's source line: the
// SO's code, else the JWSO's (a card has one source, ADR-177). Never a /lineNo
// suffix. Callers pass the aliases their query already joins (`so`, `rev_jwl`);
// the JWSO header is a scalar, so no query needs a new join and no row can
// multiply, and a soft-deleted JWSO reads null (as CLIENT_PO_NO_SQL does).
//
// Use this, never a hand-written COALESCE: one place to change the rule.

const ALIAS = /^[a-z_][a-z0-9_]*$/;

export function soOrJwCodeSql(soAlias: string, jwlAlias: string): SQL {
  if (!ALIAS.test(soAlias) || !ALIAS.test(jwlAlias)) {
    throw new Error(`soOrJwCodeSql: bad alias "${soAlias}" / "${jwlAlias}"`);
  }
  return sql.raw(
    `COALESCE(${soAlias}.code, (SELECT ojw.code FROM public.job_work_orders ojw` +
      ` WHERE ojw.id = ${jwlAlias}.job_work_order_id AND ojw.deleted_at IS NULL))`,
  );
}
