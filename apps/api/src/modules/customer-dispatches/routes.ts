import type { FastifyInstance } from 'fastify';
import {
  activityReasonSchema,
  createCustomerDispatchInputSchema,
  customerDispatchRegisterQuerySchema,
  listCustomerDispatchesQuerySchema,
} from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { listDispatchRegister } from './register';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });
// ADR-197 — a cancel carries its reason (module-local: the shared contract is frozen).
const cancelDispatchBodySchema = z.object({ reason: activityReasonSchema });

export async function customerDispatchesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customer-dispatches', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listDispatches(listCustomerDispatchesQuerySchema.parse(req.query), req.user);
  });

  app.get('/customer-dispatches/register', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listDispatchRegister(customerDispatchRegisterQuerySchema.parse(req.query), req.user);
  });

  app.get('/customer-dispatches/so-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return { options: await service.listFinanceSoOptions(req.user) };
  });

  app.get('/customer-dispatches/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextDispatchCode(req.user);
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
    const { reason } = cancelDispatchBodySchema.parse(req.body ?? {});
    return service.cancelDispatch(id, reason, req.user);
  });
}
