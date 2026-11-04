// GET /order-options — login only, deliberately no page right: the dropdown sits
// on many departments' pages (owner 2026-11-04; ADR-237).

import { orderOptionsQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function orderOptionsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/order-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listOrderOptions(orderOptionsQuerySchema.parse(req.query), req.user);
  });
}
