import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import type { ProductionDashboardPageQuery } from '@innovic/shared';
import { listOpenJobCards, listReadyOps } from './lists';
import * as service from './service';

export async function productionDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/production-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getProductionDashboard(req.user);
  });
  // ADR-201: the two lists page at 25 on their own endpoints.
  app.get('/production-dashboard/open-job-cards', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listOpenJobCards(req.user, req.query as ProductionDashboardPageQuery);
  });
  app.get('/production-dashboard/ready', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listReadyOps(req.user, req.query as ProductionDashboardPageQuery);
  });
}
