import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  adHocSpecSchema,
  createSavedReportInputSchema,
  updateSavedReportInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function savedReportsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/saved-reports/sources', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listSources();
  });

  app.get('/saved-reports', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listSavedReports(req.user);
  });

  app.post('/saved-reports', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createSavedReportInputSchema.parse(req.body);
    const created = await service.createSavedReport(input, req.user);
    return reply.code(201).send(created);
  });

  app.get('/saved-reports/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getSavedReport(id, req.user);
  });

  app.put('/saved-reports/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = updateSavedReportInputSchema.parse(req.body);
    return service.updateSavedReport(id, input, req.user);
  });

  app.delete('/saved-reports/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteSavedReport(id, req.user);
    return reply.code(204).send();
  });

  app.get('/saved-reports/:id/run', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.runSavedReport(id, req.user);
  });

  app.post('/saved-reports/preview', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const spec = adHocSpecSchema.parse(req.body);
    return service.previewAdHocSpec(spec, req.user);
  });
}
