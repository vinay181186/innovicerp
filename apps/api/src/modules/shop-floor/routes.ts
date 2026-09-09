import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function shopFloorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/shop-floor', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getShopFloor(req.user);
  });
}
