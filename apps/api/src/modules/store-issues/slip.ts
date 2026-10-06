// Item Issue — slip helpers: numbering, who received it, and the lock / line
// reads shared by Return and Reverse (ADR-193 phase 3b).

import { shortName, type CreateStoreIssueInput } from '@innovic/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { storeIssueLines, storeIssueReturns, storeIssues } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { roundQty } from '../../lib/stock-ledger';

export async function lockSlip(tx: DbTransaction, companyId: string, id: string) {
  const found = await tx
    .select()
    .from(storeIssues)
    .where(
      and(
        eq(storeIssues.id, id),
        eq(storeIssues.companyId, companyId),
        isNull(storeIssues.deletedAt),
      ),
    )
    .for('update')
    .limit(1);
  const iss = found[0];
  if (!iss) throw new NotFoundError('Item Issue not found.');
  return iss;
}

/** The slip's lines with what has already come back on each. */
export async function readSlipLines(tx: DbTransaction, issueId: string) {
  const lines = await tx
    .select()
    .from(storeIssueLines)
    .where(and(eq(storeIssueLines.issueId, issueId), isNull(storeIssueLines.deletedAt)))
    .orderBy(asc(storeIssueLines.lineNo));
  const returned = new Map<string, number>();
  if (lines.length > 0) {
    const rows = await tx
      .select({
        lineId: storeIssueReturns.issueLineId,
        qty: sql<string>`COALESCE(SUM(${storeIssueReturns.qty}), 0)`,
      })
      .from(storeIssueReturns)
      .where(
        and(
          inArray(
            storeIssueReturns.issueLineId,
            lines.map((l) => l.id),
          ),
          isNull(storeIssueReturns.deletedAt),
        ),
      )
      .groupBy(storeIssueReturns.issueLineId);
    for (const r of rows) returned.set(r.lineId, roundQty(Number(r.qty)));
  }
  return { lines, returned };
}

const CODE_PREFIX = 'ISS-';
const CODE_PAD = 5;

/** Today in IST (a Return at 01:00 IST belongs to today, not yesterday). */
export function today(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export async function nextStoreIssueCode(tx: DbTransaction, companyId: string): Promise<string> {
  // MAX of the trailing digits for this company, inside the same tx as the
  // insert (the unique index on (company_id, code) is the backstop).
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.store_issues
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${CODE_PREFIX}%`}
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

/** Who received it: a Production login's SHORT name snapshot, else the typed
 *  name. The chosen person is a login with a granted Production right (the
 *  /access-control/production-users list); the short name is stored into the
 *  issued_to text snapshot so every downstream read / print / activity-log line
 *  is unchanged (owner decision 4). */
export async function resolveIssuedTo(
  tx: DbTransaction,
  companyId: string,
  input: CreateStoreIssueInput,
): Promise<{ userId: string | null; issuedTo: string }> {
  if (input.issuedToUserId) {
    const rows = (await tx.execute(sql`
      SELECT id, full_name, email FROM public.users
      WHERE id = ${input.issuedToUserId}::uuid AND company_id = ${companyId}::uuid
        AND is_active = true AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string; full_name: string | null; email: string }>;
    const u = rows[0];
    if (!u) {
      throw new ValidationError('Pick an active Production person (the one chosen was not found).');
    }
    return { userId: u.id, issuedTo: shortName(u.full_name ?? u.email) };
  }
  const typed = input.issuedToText?.trim() ?? '';
  if (!typed) throw new ValidationError('Pick who received it (a Production person) or type a name');
  return { userId: null, issuedTo: typed };
}
