import {
  productionScheduleQuerySchema,
  rescheduleJcOpInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function productionScheduleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/production-schedule', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = productionScheduleQuerySchema.parse(req.query);
    return service.getProductionSchedule(query, req.user);
  });

  app.patch('/production-schedule/ops/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = rescheduleJcOpInputSchema.parse(req.body);
    return service.rescheduleJcOp(id, input, req.user);
  });
}
