import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParams = z.object({ id: z.string().uuid() });

export async function materialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/material/job-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    return service.getJcMaterial(id, req.user);
  });

  app.get('/material/sales-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    return service.getSoMaterial(id, req.user);
  });
}
