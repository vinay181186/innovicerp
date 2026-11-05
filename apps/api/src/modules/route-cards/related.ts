// Related Documents for one route card — GET /route-cards/:id/related.
// Read-only, every edge a real FK:
//   route_cards.item_id                 → the card's item (Item tab)
//   production_orders.route_card_id     → Production Orders built from this card

import type { DocumentTraceability } from '@innovic/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { productionOrders, routeCards } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { loadRelatedItems } from '../../lib/related-items';
import { buildTimeline, itemSection, section, toIsoDate } from '../../lib/traceability';

export async function getRouteCardRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  return withUserContext(user, async (tx) => {
    const found = await tx
      .select({ id: routeCards.id, code: routeCards.code, createdAt: routeCards.createdAt })
      .from(routeCards)
      .where(
        and(
          eq(routeCards.id, id),
          eq(routeCards.companyId, companyId),
          isNull(routeCards.deletedAt),
        ),
      )
      .limit(1);
    const card = found[0];
    if (!card) throw new NotFoundError('Route Card not found. It may have been moved to Trash.');

    // A production order has no date of its own: it is dated by when it was raised.
    const orderRows = await tx
      .select({
        id: productionOrders.id,
        code: productionOrders.code,
        status: productionOrders.status,
        date: productionOrders.createdAt,
      })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.routeCardId, id),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      )
      .orderBy(desc(productionOrders.createdAt));

    const cardItems = (await loadRelatedItems(tx, 'routeCard', [id])).get(id) ?? [];
    const upstream = [itemSection('item', 'Item', '\u{1F4E6}', cardItems)];
    const downstream = [
      section(
        'production-orders',
        'Production Orders',
        '\u{1F3ED}',
        'production-order',
        orderRows.map((r) => ({
          id: r.id,
          code: r.code,
          status: r.status,
          date: toIsoDate(r.date),
          linkId: null,
          label: null,
        })),
        {
          items: await loadRelatedItems(
            tx,
            'productionOrder',
            orderRows.map((r) => r.id),
          ),
        },
      ),
    ];
    return {
      self: { module: 'route-cards', code: card.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(card.createdAt),
          label: 'Route Card created',
          code: card.code,
          routeKind: 'route-card',
          linkId: id,
          items: cardItems,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}
