import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/dashboard/kpis', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getDashboardKpis(req.user);
  });
}
