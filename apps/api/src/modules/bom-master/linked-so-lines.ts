// SO lines built from one BOM (ADR-189) — GET /bom-masters/:id/linked-so-lines.
// Read-only. The link is sales_order_lines.source_bom_master_id, the same FK
// getBomMasterRelated uses for its "Sales Orders" section; this is the line
// grain of that list (which line, what item, how many, is it still open).

import type { BomLinkedSoLinesResponse } from '@innovic/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { bomMasters, items, salesOrderLines, salesOrders } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

export async function listBomLinkedSoLines(
  id: string,
  user: AuthContext,
): Promise<BomLinkedSoLinesResponse> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  return withUserContext(user, async (tx) => {
    const bom = await tx
      .select({ id: bomMasters.id })
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, id),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1);
    if (!bom[0]) throw new NotFoundError('BOM not found. It may have been moved to Trash.');

    const rows = await tx
      .select({
        salesOrderId: salesOrders.id,
        soCode: salesOrders.code,
        soDate: salesOrders.soDate,
        soStatus: salesOrders.status,
        salesOrderLineId: salesOrderLines.id,
        lineNo: salesOrderLines.lineNo,
        clientPoLineNo: salesOrderLines.clientPoLineNo,
        itemCode: items.code,
        itemCodeText: salesOrderLines.itemCodeText,
        itemRevision: salesOrderLines.revision,
        itemName: items.name,
        partName: salesOrderLines.partName,
        orderQty: salesOrderLines.orderQty,
        lineStatus: salesOrderLines.status,
        dueDate: salesOrderLines.dueDate,
      })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .leftJoin(items, eq(items.id, salesOrderLines.itemId))
      .where(
        and(
          eq(salesOrderLines.sourceBomMasterId, id),
          eq(salesOrderLines.companyId, companyId),
          isNull(salesOrderLines.deletedAt),
          isNull(salesOrders.deletedAt),
        ),
      )
      .orderBy(desc(salesOrders.soDate), desc(salesOrders.code), asc(salesOrderLines.lineNo));

    return {
      lines: rows.map((r) => ({
        salesOrderId: r.salesOrderId,
        soCode: r.soCode,
        soDate: String(r.soDate),
        soStatus: String(r.soStatus),
        salesOrderLineId: r.salesOrderLineId,
        lineNo: r.lineNo,
        clientPoLineNo: r.clientPoLineNo ?? null,
        // Live master code; the line's snapshot only when the item is gone.
        itemCode: r.itemCode ?? r.itemCodeText ?? null,
        itemRevision: r.itemRevision ?? null,
        itemName: r.itemName ?? r.partName ?? null,
        orderQty: r.orderQty,
        lineStatus: String(r.lineStatus),
        dueDate: r.dueDate ? String(r.dueDate) : null,
      })),
    };
  });
}
