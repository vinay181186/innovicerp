// Item Issue — slip helpers shared by Return and Reverse (ADR-193 phase 3b).

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { storeIssueLines, storeIssueReturns, storeIssues } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
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
