import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function stuckDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stuck-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getStuckDashboard(req.user);
  });
}
