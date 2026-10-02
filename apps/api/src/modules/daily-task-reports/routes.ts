import type { FastifyInstance } from 'fastify';
import { listDailyTaskReportsQuerySchema, upsertDailyTaskReportInputSchema } from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function dailyTaskReportsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/daily-task-reports', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const q = listDailyTaskReportsQuerySchema.parse(req.query);
    return service.listDailyReports(q, req.user);
  });

  app.get('/daily-task-reports/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getDailyReport(id, req.user);
  });

  app.post('/daily-task-reports', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = upsertDailyTaskReportInputSchema.parse(req.body);
    const result = await service.createDailyReport(body, req.user);
    reply.code(201);
    return result;
  });

  app.put('/daily-task-reports/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = upsertDailyTaskReportInputSchema.parse(req.body);
    return service.updateDailyReport(id, body, req.user);
  });
}
