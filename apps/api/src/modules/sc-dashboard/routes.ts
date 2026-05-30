import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function scDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sc-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getScDashboard(req.user);
  });
}
