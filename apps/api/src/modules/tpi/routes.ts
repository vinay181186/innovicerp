import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function tpiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tpi', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getTpi(req.user);
  });
}
