import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function soCycleTimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-cycle-time', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getSoCycleTime(req.user);
  });
}
