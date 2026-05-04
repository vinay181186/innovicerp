import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { listDeliveryChallansQuerySchema } from './schema';
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
}
