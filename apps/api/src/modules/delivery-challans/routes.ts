import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createDeliveryChallanInputSchema,
  createDeliveryChallanReceiptInputSchema,
  listDeliveryChallansQuerySchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function deliveryChallansRoutes(app: FastifyInstance): Promise<void> {
  app.get('/delivery-challans', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listDeliveryChallansQuerySchema.parse(req.query);
    return service.listDeliveryChallans(query, req.user);
  });

  app.get('/delivery-challans/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getDeliveryChallan(id, req.user);
  });

  app.post('/delivery-challans', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createDeliveryChallanInputSchema.parse(req.body);
    const detail = await service.createDeliveryChallan(input, req.user);
    reply.code(201);
    return detail;
  });

  app.post('/delivery-challans/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.cancelDeliveryChallan(id, req.user);
  });

  // T-059b — receive-back. Auto-generates receipt code, fires stock IN +
  // jc_op flip + auto-NC on reject + JC→SO cascade in one tx.
  app.post('/delivery-challans/:id/receive', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = createDeliveryChallanReceiptInputSchema.parse(req.body);
    const detail = await service.receiveAgainstDeliveryChallan(id, input, req.user);
    reply.code(201);
    return detail;
  });
}
