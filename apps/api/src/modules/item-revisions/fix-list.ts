// Phase D hand-fix lists for the Item + Drawing Rev register (read only):
//   • routeCards — live old Route Cards of MAKE items with no Drawing Rev;
//   • lines      — live SO / JWSO lines of MAKE items whose live lines carry
//                  more than one Rev ('conflict'), or a suspicious Rev "0";
//   • stock      — MAKE items with blank-Rev (old) stock on hand.
// Cancelled documents / lines are left out. Route Card Master View right.

import {
  type FixListLine,
  type FixListRouteCard,
  type FixListStock,
  type ItemRevisionFixListResponse,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { REV_KEY_BLANK } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';

/** Live, non-cancelled SO + JWSO lines of MAKE items, one shape. */
const LIVE_LINES = (companyId: string) => sql`
  SELECT 'SO' AS source, h.id AS doc_id, h.code AS doc_code, l.id AS line_id, l.line_no,
         l.status::text AS status, l.item_id, UPPER(TRIM(l.revision)) AS rev,
         (NULLIF(TRIM(l.drawing_file_path), '') IS NOT NULL) AS has_drawing,
         l.item_revision_id, l.created_at,
         h.internal_so_no AS so_internal_no, l.client_po_line_no
    FROM public.sales_order_lines l
    JOIN public.sales_orders h ON h.id = l.sales_order_id
    JOIN public.items i ON i.id = l.item_id AND i.procurement_type = 'make'
   WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND h.deleted_at IS NULL
     AND h.status <> 'cancelled' AND l.status <> 'cancelled' AND l.revision IS NOT NULL
  UNION ALL
  SELECT 'JWSO', h.id, h.code, l.id, l.line_no, l.status::text, l.item_id, UPPER(TRIM(l.revision)),
         (NULLIF(TRIM(l.drawing_file_path), '') IS NOT NULL), l.item_revision_id, l.created_at,
         NULL::text, l.client_po_line_no
    FROM public.job_work_order_lines l
    JOIN public.job_work_orders h ON h.id = l.job_work_order_id
    JOIN public.items i ON i.id = l.item_id AND i.procurement_type = 'make'
   WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND h.deleted_at IS NULL
     AND h.status <> 'cancelled' AND l.status <> 'cancelled' AND l.revision IS NOT NULL`;

export async function getItemRevisionFixList(
  user: AuthContext,
): Promise<ItemRevisionFixListResponse> {
  await requireFormAccess(user, 'routecard_create', 'view');
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  return withUserContext(user, async (tx) => {
    const rc = (await tx.execute(sql`
      WITH ll AS (${LIVE_LINES(companyId)})
      SELECT rc.id, rc.code, rc.item_id, i.code AS item_code, i.name AS item_name,
             rc.approval_status::text AS approval_status,
             COALESCE((SELECT array_agg(DISTINCT ll.rev ORDER BY ll.rev) FROM ll
                        WHERE ll.item_id = rc.item_id AND ll.rev <> ''), '{}') AS line_revs
        FROM public.route_cards rc
        JOIN public.items i ON i.id = rc.item_id AND i.procurement_type = 'make'
       WHERE rc.company_id = ${companyId}::uuid AND rc.deleted_at IS NULL
         AND rc.item_revision_id IS NULL
       ORDER BY i.code`)) as unknown as Array<Record<string, unknown>>;
    const routeCards: FixListRouteCard[] = rc.map((r) => ({
      routeCardId: r['id'] as string,
      routeCardCode: r['code'] as string,
      itemId: r['item_id'] as string,
      itemCode: r['item_code'] as string,
      itemName: (r['item_name'] as string | null) ?? null,
      approvalStatus: r['approval_status'] as string,
      lineRevs: (r['line_revs'] as string[] | null) ?? [],
    }));

    const ln = (await tx.execute(sql`
      WITH ll AS (${LIVE_LINES(companyId)}),
      multi AS (
        SELECT item_id FROM ll WHERE rev <> '' GROUP BY item_id HAVING COUNT(DISTINCT rev) > 1
      )
      SELECT ll.*, i.code AS item_code, i.name AS item_name,
             (ll.item_id IN (SELECT item_id FROM multi)) AS conflict,
             COALESCE(
               (SELECT r.code FROM public.route_cards r WHERE r.company_id = ${companyId}::uuid
                   AND r.deleted_at IS NULL AND r.item_revision_id = ll.item_revision_id LIMIT 1),
               (SELECT r.code FROM public.route_cards r WHERE r.company_id = ${companyId}::uuid
                   AND r.deleted_at IS NULL AND r.item_id = ll.item_id AND r.item_revision_id IS NULL LIMIT 1)
             ) AS route_card_code
        FROM ll JOIN public.items i ON i.id = ll.item_id
       WHERE ll.item_id IN (SELECT item_id FROM multi) OR ll.rev = '0'
       ORDER BY i.code, ll.rev, ll.doc_code, ll.line_no`)) as unknown as Array<
      Record<string, unknown>
    >;
    const lines: FixListLine[] = ln.map((r) => ({
      itemId: r['item_id'] as string,
      itemCode: r['item_code'] as string,
      itemName: (r['item_name'] as string | null) ?? null,
      source: r['source'] as FixListLine['source'],
      docId: r['doc_id'] as string,
      docCode: r['doc_code'] as string,
      lineId: r['line_id'] as string,
      lineNo: Number(r['line_no']),
      status: r['status'] as string,
      drawingRev: r['rev'] as string,
      hasDrawing: Boolean(r['has_drawing']),
      routeCardCode: (r['route_card_code'] as string | null) ?? null,
      createdAt:
        r['created_at'] instanceof Date ? r['created_at'].toISOString() : String(r['created_at']),
      reason: r['conflict'] ? 'conflict' : 'rev_zero',
      soInternalNo: (r['so_internal_no'] as string | null) ?? null,
      clientPoLineNo: (r['client_po_line_no'] as string | null) ?? null,
    }));

    const st = (await tx.execute(sql`
      SELECT b.item_id, i.code AS item_code, i.name AS item_name, b.on_hand_qty,
             COALESCE((SELECT json_agg(json_build_object('itemRevisionId', ir.id, 'drawingRev', ir.rev) ORDER BY ir.rev)
                         FROM public.item_revisions ir
                        WHERE ir.company_id = b.company_id AND ir.item_id = b.item_id
                          AND ir.deleted_at IS NULL), '[]'::json) AS known_revs
        FROM public.item_rev_stock_balances b
        JOIN public.items i ON i.id = b.item_id AND i.procurement_type = 'make'
       WHERE b.company_id = ${companyId}::uuid AND b.rev_key = ${REV_KEY_BLANK}::uuid
         AND b.on_hand_qty <> 0
       ORDER BY i.code`)) as unknown as Array<Record<string, unknown>>;
    const stock: FixListStock[] = st.map((r) => ({
      itemId: r['item_id'] as string,
      itemCode: r['item_code'] as string,
      itemName: (r['item_name'] as string | null) ?? null,
      onHandQty: Number(r['on_hand_qty']),
      knownRevs: (r['known_revs'] as FixListStock['knownRevs'] | null) ?? [],
    }));

    return { routeCards, lines, stock };
  });
}
