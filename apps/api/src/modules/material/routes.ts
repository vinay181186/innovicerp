import { releaseAssemblyPartsInputSchema, reserveAssemblyPartsInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { releaseAssemblyParts, reserveAssemblyParts } from './reserve';
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

  // ADR-193 3c — reserve / release parts for an assembly SO (Planning entry).
  app.post('/material/sales-orders/:id/reserve', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    const input = reserveAssemblyPartsInputSchema.parse(req.body);
    return reserveAssemblyParts(id, input, req.user);
  });

  app.post('/material/sales-orders/:id/release', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    const input = releaseAssemblyPartsInputSchema.parse(req.body);
    return releaseAssemblyParts(id, input, req.user);
  });
}
