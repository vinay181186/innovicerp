import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function machineLoadingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/machine-loading', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getMachineLoading(req.user);
  });
}
