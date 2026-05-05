import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { listActivityLogQuerySchema } from './schema';
import * as service from './service';

export async function activityLogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/activity-log', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listActivityLogQuerySchema.parse(req.query);
    return service.listActivityLog(query, req.user);
  });
}
