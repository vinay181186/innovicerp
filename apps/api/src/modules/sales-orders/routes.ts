import { activityReasonSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  closeSalesOrderInputSchema,
  createSalesOrderInputSchema,
  listSalesOrdersQuerySchema,
  shortCloseSalesOrderLineInputSchema,
  updateSalesOrderInputSchema,
} from './schema';
import * as service from './service';
import * as shortClose from './short-close';

const idParamSchema = z.object({ id: z.string().uuid() });
const lineIdParamSchema = z.object({ lineId: z.string().uuid() });
// ADR-197 — the reason rides beside the shared SO payload (packages/shared is
// frozen): optional on a save (required by the service when it cancels the
// SO), required to move an SO to Trash.
const editReasonSchema = z.object({ reason: activityReasonSchema.optional() });
const deleteReasonSchema = z.object({ reason: activityReasonSchema });

export async function salesOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sales-orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listSalesOrdersQuerySchema.parse(req.query);
    return service.listSalesOrders(query, req.user);
  });

  app.get('/sales-orders/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextSoCode(req.user);
  });

  app.get('/sales-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getSalesOrder(id, req.user);
  });

  // Read-only downstream traceability (new-ERP enhancement): every document
  // generated from this SO. Separate from getById so the SO-detail load path
  // is untouched and cannot regress.
  app.get('/sales-orders/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getSalesOrderRelated(id, req.user);
  });

  // Read-only drawing trail: every file each line's drawing has pointed at,
  // newest first. Separate from getById for the same reason as /related — the
  // SO-detail load path stays untouched and cannot regress.
  app.get('/sales-orders/:id/drawing-history', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getSalesOrderDrawingHistory(id, req.user);
  });

  app.post('/sales-orders', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createSalesOrderInputSchema.parse(req.body);
    const detail = await service.createSalesOrder(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/sales-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateSalesOrderInputSchema.parse(req.body);
    const { reason } = editReasonSchema.parse(req.body ?? {});
    return service.updateSalesOrder(id, body, req.user, reason ?? null);
  });

  // ADR-196 — ERPNext "Close": the header closes short every line that still
  // has qty undelivered; the line route closes one line.
  app.post('/sales-orders/:id/close', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = closeSalesOrderInputSchema.parse(req.body);
    return shortClose.closeSalesOrder(id, body, req.user);
  });

  app.post('/sales-order-lines/:lineId/short-close', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { lineId } = lineIdParamSchema.parse(req.params);
    const body = shortCloseSalesOrderLineInputSchema.parse(req.body);
    return shortClose.shortCloseSalesOrderLine(lineId, body, req.user);
  });

  app.delete('/sales-orders/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { reason } = deleteReasonSchema.parse(req.body ?? {});
    await service.softDeleteSalesOrder(id, req.user, reason);
    reply.code(204);
    return null;
  });
}
