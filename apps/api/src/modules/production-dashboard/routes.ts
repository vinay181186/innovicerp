import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function productionDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/production-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getProductionDashboard(req.user);
  });
}
