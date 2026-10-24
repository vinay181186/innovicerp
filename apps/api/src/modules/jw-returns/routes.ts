import {
  cancelJwReturnChallanInputSchema,
  createJwReturnChallanInputSchema,
  listJwReturnChallansQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { requestCancel } from '../cancel-requests/service';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function jwReturnsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jw-returns', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJwReturnChallansQuerySchema.parse(req.query);
    return service.listJwReturnChallans(query, req.user);
  });

  app.get('/jw-returns/returnable/:jobWorkOrderId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { jobWorkOrderId } = z.object({ jobWorkOrderId: z.string().uuid() }).parse(req.params);
    return service.getReturnableForJobWorkOrder(jobWorkOrderId, req.user);
  });

  app.get('/jw-returns/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return service.getJwReturnChallan(id, req.user);
  });

  app.post('/jw-returns', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createJwReturnChallanInputSchema.parse(req.body);
    const result = await service.createJwReturnChallan(input, req.user);
    reply.code(201);
    return result;
  });

  // ADR-235: no direct cancel any more — this sends a Cancel Request (the
  // Approve-tick holder approves it) and returns the CancelRequestResult.
  app.post('/jw-returns/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelJwReturnChallanInputSchema.parse(req.body);
    return requestCancel('jw_return', id, { reason, approveNow: false }, req.user);
  });
}
