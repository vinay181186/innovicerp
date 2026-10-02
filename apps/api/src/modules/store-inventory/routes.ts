import {
  adjustStockInputSchema,
  listReservationsQuerySchema,
  listStoreInventoryQuerySchema,
  reorderListQuerySchema,
  reorderPrInputSchema,
  setReorderInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as reorder from './reorder';
import * as service from './service';

export async function storeInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/store-inventory', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listStoreInventoryQuerySchema.parse(req.query);
    return service.listStoreInventory(query, req.user);
  });

  app.post('/store-inventory/adjust', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = adjustStockInputSchema.parse(req.body);
    return service.adjustStock(input, req.user);
  });

  // ADR-193 phase 5 — Reorder Level + Reorder Qty (replaces POST /set-min).
  // The item id in the URL wins over any itemId in the body.
  app.patch<{ Params: { id: string } }>('/store-inventory/items/:id/reorder', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const input = setReorderInputSchema.parse({ ...body, itemId: req.params.id });
    return reorder.setReorder(input, req.user);
  });

  app.get('/store-inventory/reorder-list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return reorder.getReorderList(reorderListQuerySchema.parse(req.query), req.user);
  });

  app.post('/store-inventory/reorder-pr', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = reorderPrInputSchema.parse(req.body);
    return reorder.raiseReorderPrs(input, req.user);
  });

  // ADR-180 stock-booking reads. They live in this module because they are the
  // Store screen's own numbers, and they carry its permission (item_create).
  app.get<{ Params: { itemId: string } }>('/stock-availability/:itemId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getStockAvailability(req.params.itemId, req.user);
  });

  app.get('/stock-reservations', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listReservationsQuerySchema.parse(req.query);
    return service.listReservations(query, req.user);
  });
}
