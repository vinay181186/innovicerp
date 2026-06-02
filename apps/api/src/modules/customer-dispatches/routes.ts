import type { FastifyInstance } from 'fastify';
import { createCustomerDispatchInputSchema } from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function customerDispatchesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customer-dispatches', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listDispatches(req.user);
  });

  app.get('/customer-dispatches/so-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return { options: await service.listFinanceSoOptions(req.user) };
  });

  app.get('/customer-dispatches/dispatchable/:soId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = z.object({ soId: z.string().uuid() }).parse(req.params);
    return service.getDispatchableSo(soId, req.user);
  });

  app.get('/customer-dispatches/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getDispatch(id, req.user);
  });

  app.post('/customer-dispatches', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createCustomerDispatchInputSchema.parse(req.body);
    const result = await service.createDispatch(body, req.user);
    reply.code(201);
    return result;
  });

  app.post('/customer-dispatches/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.cancelDispatch(id, req.user);
  });
}
