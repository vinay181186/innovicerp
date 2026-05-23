import { dailyReportQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function dailyReportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/daily-report', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = dailyReportQuerySchema.parse(req.query);
    return service.getDailyReport(query, req.user);
  });
}
