import {
  activityReasonSchema,
  createPartyMaterialInputSchema,
  listPartyMaterialsQuerySchema,
  returnPartyMaterialInputSchema,
  updatePartyMaterialInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });
// ADR-197: a delete says why. Module-local (packages/shared is frozen).
const deletePartyMaterialBodySchema = z.object({ reason: activityReasonSchema });

export async function partyMaterialsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/party-materials', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPartyMaterialsQuerySchema.parse(req.query);
    return service.listPartyMaterials(query, req.user);
  });

  app.get('/party-materials/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextPartyMaterialCode(req.user);
  });

  app.get('/party-materials/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getPartyMaterial(id, req.user);
  });

  app.post('/party-materials', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPartyMaterialInputSchema.parse(req.body);
    const result = await service.createPartyMaterial(input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/party-materials/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = updatePartyMaterialInputSchema.parse(req.body);
    return service.updatePartyMaterial(id, input, req.user);
  });

  app.delete('/party-materials/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const { reason } = deletePartyMaterialBodySchema.parse(req.body ?? {});
    await service.softDeletePartyMaterial(id, req.user, reason);
    reply.code(204);
    return null;
  });

  // R7 (ADR-194): return spare customer material to the customer.
  app.post('/party-materials/:id/return', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = returnPartyMaterialInputSchema.parse(req.body);
    return service.returnPartyMaterial(id, input, req.user);
  });
}
