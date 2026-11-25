// ADR-320 / CLAUDE.md §26.8 — a Job Card raised against an SO line is never
// dated before that SO. One check for every JC create path (call it inside the
// create's transaction). No SO line: no check.
import { and, eq } from 'drizzle-orm';
import { salesOrderLines, salesOrders } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { assertNotBefore } from '../../lib/doc-date-order';
import { fmtDate } from '../../lib/format-date';

export async function assertJcDateNotBeforeSo(
  tx: DbTransaction,
  companyId: string,
  jcDate: string,
  sourceSoLineId: string | null | undefined,
): Promise<void> {
  if (!sourceSoLineId) return;
  const so = (
    await tx
      .select({ code: salesOrders.code, soDate: salesOrders.soDate })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .where(and(eq(salesOrderLines.id, sourceSoLineId), eq(salesOrders.companyId, companyId)))
      .limit(1)
  )[0];
  if (!so) return;
  assertNotBefore(
    jcDate,
    so.soDate,
    `Job Card date ${fmtDate(jcDate)} cannot be before SO ${so.code} date ${fmtDate(so.soDate)}.`,
  );
}
