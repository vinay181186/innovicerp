import {
  markUnitAssembledInputSchema,
  markUnitDispatchedInputSchema,
  setReadinessOverrideInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const soParamsSchema = z.object({ soId: z.string().uuid() });
const unitParamsSchema = z.object({ unitId: z.string().uuid() });
const overrideParamsSchema = z.object({
  soId: z.string().uuid(),
  childCode: z.string().min(1),
});

export async function assemblyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/assemblies', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listAssemblies(req.user);
  });

  app.get('/assemblies/:soId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = soParamsSchema.parse(req.params);
    return service.getAssemblyTracker(soId, req.user);
  });

  // Read-only Related Documents (traceability). Anchor id is the SO id, matching
  // the SO-scoped detail route /assemblies/$soId. Panel fetches module="assembly".
  app.get('/assembly/:soId/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = soParamsSchema.parse(req.params);
    return service.getAssemblyRelated(soId, req.user);
  });

  app.post('/assemblies/:soId/units', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = soParamsSchema.parse(req.params);
    const input = markUnitAssembledInputSchema.parse(req.body ?? {});
    const result = await service.markUnitAssembled(soId, input, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/assemblies/units/:unitId/dispatch', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { unitId } = unitParamsSchema.parse(req.params);
    const input = markUnitDispatchedInputSchema.parse(req.body ?? {});
    return service.markUnitDispatched(unitId, input, req.user);
  });

  app.delete('/assemblies/:soId/units/last', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = soParamsSchema.parse(req.params);
    return service.undoLastUnit(soId, req.user);
  });

  app.put('/assemblies/:soId/overrides/:childCode', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId, childCode } = overrideParamsSchema.parse(req.params);
    const input = setReadinessOverrideInputSchema.parse(req.body);
    return service.setReadinessOverride(soId, childCode, input, req.user);
  });
}
