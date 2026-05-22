import { pendingSoValueQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function pendingSoValueRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pending-so-value', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { filter } = pendingSoValueQuerySchema.parse(req.query);
    return service.getPendingSoValue(filter, req.user);
  });
}
