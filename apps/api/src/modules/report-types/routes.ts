import { createReportTypeInputSchema, updateReportTypeInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function reportTypesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/report-types', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listReportTypes(req.user);
  });

  app.post('/report-types', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = createReportTypeInputSchema.parse(req.body);
    return service.createReportType(input, req.user);
  });

  app.patch('/report-types/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = req.params as { id: string };
    const input = updateReportTypeInputSchema.parse(req.body);
    return service.updateReportType(id, input, req.user);
  });

  app.delete('/report-types/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = req.params as { id: string };
    return service.deleteReportType(id, req.user);
  });
}
