import { qcDashboardQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function qcDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/qc-dashboard', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = qcDashboardQuerySchema.parse(req.query);
    return service.getQcDashboard(req.user, query);
  });
}
