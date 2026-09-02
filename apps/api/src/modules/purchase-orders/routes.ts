import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { createPurchaseOrderFromPrBatchInputSchema } from '@innovic/shared';
import {
  createPurchaseOrderFromPrInputSchema,
  createPurchaseOrderInputSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function purchaseOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/purchase-orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPurchaseOrdersQuerySchema.parse(req.query);
    return service.listPurchaseOrders(query, req.user);
  });

  app.get('/purchase-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getPurchaseOrder(id, req.user);
  });

  app.get('/purchase-orders/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getPurchaseOrderRelated(id, req.user);
  });

  // HISTORY: `POST /purchase-orders` was deliberately absent. A purchase order
  // is always raised against a Purchase Request (ADR-138 / ADR-139), and the
  // only way to record that link was the header's single `pr_id` — so the only
  // client doors were `/from-pr` (one PR) and `/from-pr-batch` (many PRs), and
  // `service.createPurchaseOrder` was kept as an internal / test fixture that
  // was not reachable over HTTP, so a PR-less PO could not be created.
  //
  // The invariant now holds at LINE level instead: each PO line carries its own
  // `sourcePrId` (migration 0103), and the shared create contract requires at
  // least one line to name a PR. One PO can therefore cover several PRs — pick
  // PR-1, add a line, pick PR-2, add another — and still never be PR-less. The
  // route is open again on that basis; the rule it protects is unchanged, only
  // the place it is enforced has moved.
  app.post('/purchase-orders', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createPurchaseOrderInputSchema.parse(req.body);
    const detail = await service.createPurchaseOrder(body, req.user);
    reply.code(201);
    return detail;
  });

  app.post('/purchase-orders/from-pr', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createPurchaseOrderFromPrInputSchema.parse(req.body);
    const detail = await service.createPurchaseOrderFromPr(body, req.user);
    reply.code(201);
    return detail;
  });

  app.post('/purchase-orders/from-pr-batch', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createPurchaseOrderFromPrBatchInputSchema.parse(req.body);
    const detail = await service.createPurchaseOrderFromPrBatch(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/purchase-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updatePurchaseOrderInputSchema.parse(req.body);
    return service.updatePurchaseOrder(id, body, req.user);
  });

  app.delete('/purchase-orders/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeletePurchaseOrder(id, req.user);
    reply.code(204);
    return null;
  });

  app.post('/purchase-orders/:id/approve', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = z.object({ remarks: z.string().max(500).optional() }).parse(req.body ?? {});
    return service.approvePurchaseOrder(id, body.remarks ?? null, req.user);
  });

  app.post('/purchase-orders/:id/reject', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);
    return service.rejectPurchaseOrder(id, body.reason, req.user);
  });
}
