import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { listOpLogQuerySchema } from './schema';
import * as service from './service';

export async function opLogViewerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/op-log', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listOpLogQuerySchema.parse(req.query);
    return service.listOpLog(query, req.user);
  });
}
