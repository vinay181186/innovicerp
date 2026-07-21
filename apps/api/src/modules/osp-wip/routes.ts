import { listOspWipQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function ospWipRoutes(app: FastifyInstance): Promise<void> {
  app.get('/osp-wip', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOspWipQuerySchema.parse(req.query);
    return service.listOspWip(query, req.user);
  });
}
