import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function shopFloorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/shop-floor', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getShopFloor(req.user);
  });

  app.post('/shop-floor/running/:id/stop', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.stopRunningOp(id, req.user);
  });
}
