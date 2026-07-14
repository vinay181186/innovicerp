// Document-number check service (Phase 1: SO / PO / GRN).
//
// One generic endpoint backs the document-number override UI for every type:
// it returns whether a code already exists for the company AND the suggested
// next code (MAX+1 after the highest, mirroring nextSoCode). The per-type
// table/prefix/digits live in DOC_NUMBER_FORMATS (shared) + TABLE_NAME below —
// add a row to both to support a new type (Phase 2), no other change.
//
// Uniqueness is per-company and excludes soft-deleted rows, matching the
// `(company_id, code) WHERE deleted_at IS NULL` partial unique indexes.

import {
  type CheckDocNumberQuery,
  type CheckDocNumberResponse,
  DOC_NUMBER_FORMATS,
  type DocNumberType,
  docNumberPattern,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** Physical table per document type. Constant identifiers (never user input) —
 *  safe to splice via sql.identifier. */
const TABLE_NAME: Record<DocNumberType, string> = {
  sales_order: 'sales_orders',
  job_work_order: 'job_work_orders',
  purchase_order: 'purchase_orders',
  grn: 'goods_receipt_notes',
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** MAX+1 next code in the company series (mirrors nextSoCode). */
async function computeNext(
  tx: DbTransaction,
  type: DocNumberType,
  companyId: string,
): Promise<string> {
  const f = DOC_NUMBER_FORMATS[type];
  const rows = (await tx.execute(
    sql`SELECT code FROM ${sql.identifier(TABLE_NAME[type])} WHERE company_id = ${companyId}::uuid`,
  )) as unknown as Array<{ code: string | null }>;
  const re = new RegExp(`^${escapeRe(f.prefix)}(\\d+)\\s*$`, 'i');
  let max = 0;
  for (const r of rows) {
    const m = (r.code || '').match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${f.prefix}${String(max + 1).padStart(f.digits, '0')}`;
}

/** Is this code already taken by an active row for the company? */
async function checkExists(
  tx: DbTransaction,
  type: DocNumberType,
  companyId: string,
  code: string,
): Promise<boolean> {
  const rows = (await tx.execute(
    sql`SELECT 1 FROM ${sql.identifier(TABLE_NAME[type])}
        WHERE company_id = ${companyId}::uuid AND code = ${code} AND deleted_at IS NULL
        LIMIT 1`,
  )) as unknown as unknown[];
  return rows.length > 0;
}

export async function checkDocNumber(
  query: CheckDocNumberQuery,
  user: AuthContext,
): Promise<CheckDocNumberResponse> {
  const companyId = requireCompany(user);
  const { type } = query;
  return withUserContext(user, async (tx) => {
    const nextCode = await computeNext(tx, type, companyId);
    const code = query.code?.trim();
    if (!code) {
      return { exists: false, nextCode, formatValid: false };
    }
    const formatValid = docNumberPattern(type).test(code);
    const exists = await checkExists(tx, type, companyId, code);
    return { exists, nextCode, formatValid };
  });
}
