import { listTpiQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function tpiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tpi', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getTpi(req.user);
  });

  // Paged lists (ADR-201): search runs over every row; total comes with the page.
  app.get('/tpi/pending', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listTpiPending(listTpiQuerySchema.parse(req.query), req.user);
  });
  app.get('/tpi/completed', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listTpiCompleted(listTpiQuerySchema.parse(req.query), req.user);
  });
}
