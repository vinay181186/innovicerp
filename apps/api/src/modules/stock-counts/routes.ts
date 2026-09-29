import {
  approveStockCountInputSchema,
  cancelStockCountInputSchema,
  createStockCountInputSchema,
  listStockCountsQuerySchema,
  replaceStockCountLinesInputSchema,
  resolveStockCountItemsInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function stockCountsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stock-counts', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listStockCounts(listStockCountsQuerySchema.parse(req.query), req.user);
  });

  app.post('/stock-counts/resolve-items', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.resolveStockCountItems(
      resolveStockCountItemsInputSchema.parse(req.body),
      req.user,
    );
  });

  app.get('/stock-counts/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getStockCount(idParam.parse(req.params).id, req.user);
  });

  app.post('/stock-counts', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const result = await service.createStockCount(
      createStockCountInputSchema.parse(req.body),
      req.user,
    );
    reply.code(201);
    return result;
  });

  app.put('/stock-counts/:id/lines', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.replaceStockCountLines(
      idParam.parse(req.params).id,
      replaceStockCountLinesInputSchema.parse(req.body),
      req.user,
    );
  });

  app.post('/stock-counts/:id/submit', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.submitStockCount(idParam.parse(req.params).id, req.user);
  });

  app.post('/stock-counts/:id/approve', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.approveStockCount(
      idParam.parse(req.params).id,
      approveStockCountInputSchema.parse(req.body ?? {}),
      req.user,
    );
  });

  app.post('/stock-counts/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.cancelStockCount(
      idParam.parse(req.params).id,
      cancelStockCountInputSchema.parse(req.body),
      req.user,
    );
  });
}
