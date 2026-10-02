import { soCycleTimeQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function soCycleTimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-cycle-time', async (req) => {
    if (!req.user) throw new AuthenticationError();
    // ADR-201: Show filter, search, Sort & Filter and the page on the server.
    return service.getSoCycleTime(req.user, soCycleTimeQuerySchema.parse(req.query));
  });
}
