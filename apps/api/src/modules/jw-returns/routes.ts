import { createJwReturnChallanInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function jwReturnsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jw-returns', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listJwReturnChallans(req.user);
  });

  app.post('/jw-returns', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createJwReturnChallanInputSchema.parse(req.body);
    const result = await service.createJwReturnChallan(input, req.user);
    reply.code(201);
    return result;
  });
}
