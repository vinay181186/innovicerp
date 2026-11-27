import { soJwsoStatusDayParamsSchema, soJwsoStatusDaysQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

// ADR-325 — SO / JWSO status by day.
export async function soJwsoStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-jwso-status/days', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = soJwsoStatusDaysQuerySchema.parse(req.query);
    return service.getDays(req.user, query);
  });

  app.get('/so-jwso-status/day/:date', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { date } = soJwsoStatusDayParamsSchema.parse(req.params);
    return service.getDay(req.user, date);
  });
}
