import type { FastifyInstance } from 'fastify';
import type { ScPendingQuery, ScTableQuery } from '@innovic/shared';
import { AuthenticationError } from '../../lib/errors';
import { listScPending, listScRecentGrn } from './pending';
import * as service from './service';
import { listScPoSummary, listScSos, listScVendors } from './summaries';

// GET /sc-dashboard = KPI strip + picklists; each table pages on its own
// endpoint (limit / offset / sf — ADR-201). The schemas parse in the services.
export async function scDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sc-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getScDashboard(req.user);
  });
  app.get('/sc-dashboard/pending', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listScPending(req.user, req.query as ScPendingQuery);
  });
  app.get('/sc-dashboard/vendors', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listScVendors(req.user, req.query as ScTableQuery);
  });
  app.get('/sc-dashboard/sos', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listScSos(req.user, req.query as ScTableQuery);
  });
  app.get('/sc-dashboard/po-summary', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listScPoSummary(req.user, req.query as ScTableQuery);
  });
  app.get('/sc-dashboard/recent-grn', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listScRecentGrn(req.user, req.query as ScTableQuery);
  });
}
