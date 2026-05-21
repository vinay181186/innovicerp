import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const paramsSchema = z.object({
  soId: z.string().uuid(),
});

export async function soStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-status/:soId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = paramsSchema.parse(req.params);
    return service.getSoStatus(soId, req.user);
  });
}
