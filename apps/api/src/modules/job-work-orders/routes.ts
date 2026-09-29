import type { FastifyInstance } from 'fastify';
import { activityReasonSchema } from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createJobWorkOrderInputSchema,
  listJobWorkOrdersQuerySchema,
  shortCloseJobWorkOrderLineInputSchema,
  updateJobWorkOrderInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });
const lineIdParamSchema = z.object({ lineId: z.string().uuid() });
// ADR-197: Move to Trash says why. Module-local (packages/shared is frozen).
const deleteJobWorkOrderBodySchema = z.object({ reason: activityReasonSchema });

export async function jobWorkOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/job-work-orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJobWorkOrdersQuerySchema.parse(req.query);
    return service.listJobWorkOrders(query, req.user);
  });

  app.get('/job-work-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobWorkOrder(id, req.user);
  });

  app.get('/job-work-orders/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobWorkOrderRelated(id, req.user);
  });

  app.post('/job-work-orders', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createJobWorkOrderInputSchema.parse(req.body);
    const detail = await service.createJobWorkOrder(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/job-work-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateJobWorkOrderInputSchema.parse(req.body);
    return service.updateJobWorkOrder(id, body, req.user);
  });

  app.delete('/job-work-orders/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { reason } = deleteJobWorkOrderBodySchema.parse(req.body ?? {});
    await service.softDeleteJobWorkOrder(id, req.user, reason);
    reply.code(204);
    return null;
  });

  // R6 (ADR-194): short-close ONE JWSO line — close it with the balance unmet.
  app.post('/job-work-order-lines/:lineId/short-close', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { lineId } = lineIdParamSchema.parse(req.params);
    const body = shortCloseJobWorkOrderLineInputSchema.parse(req.body);
    return service.shortCloseJobWorkOrderLine(lineId, body, req.user);
  });
}
