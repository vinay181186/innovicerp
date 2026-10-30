import type { FastifyInstance } from 'fastify';
import { listDailyTaskReportsQuerySchema } from '@innovic/shared';
import { z } from 'zod';
import { requireFormAccess } from '../../lib/access';
import { AuthenticationError, ValidationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function dailyTaskReportsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/daily-task-reports', async (req) => {
    if (!req.user) throw new AuthenticationError();
    // Owner 2026-10-30: the old Daily Task Report is Day Log's page ("Hide page").
    await requireFormAccess(req.user, 'daylog_view', 'view');
    const q = listDailyTaskReportsQuerySchema.parse(req.query);
    return service.listDailyReports(q, req.user);
  });

  app.get('/daily-task-reports/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    // Owner 2026-10-30: the old Daily Task Report is Day Log's page ("Hide page").
    await requireFormAccess(req.user, 'daylog_view', 'view');
    const { id } = idParamSchema.parse(req.params);
    return service.getDailyReport(id, req.user);
  });

  // Day Log (0222) replaced the typed-hours report: daily_reports now holds
  // one From–To day per user, written only by modules/day-logs. Saving here
  // would clash with that day, so the old writes are closed.
  const moved = (): never => {
    throw new ValidationError('Daily Task Reports moved to Task Board › My Day Log');
  };
  app.post('/daily-task-reports', moved);
  app.put('/daily-task-reports/:id', moved);
}
