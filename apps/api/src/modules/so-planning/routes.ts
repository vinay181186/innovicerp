// SO Planning routes (PL-4b). Reads — plus the one write ADR-171 adds:
// raising a purchase request straight from a BUY line. Plan writes still go
// through plans/routes.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { raisePlanningPrInputSchema } from '@innovic/shared';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const uuidParam = z.object({ id: z.string().uuid() });
const lineParam = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });
const soLineParam = z.object({ soLineId: z.string().uuid() });

export async function soPlanningRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-planning', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getPlanningSoList(req.user);
  });

  // Must precede '/so-planning/:id' so 'lines' isn't captured as an :id param.
  app.post('/so-planning/lines/:soLineId/raise-pr', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { soLineId } = soLineParam.parse(req.params);
    const body = raisePlanningPrInputSchema.parse(req.body);
    const result = await service.raisePlanningPr(soLineId, body, req.user);
    reply.code(201);
    return result;
  });

  app.get('/so-planning/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = uuidParam.parse(req.params);
    return service.getPlanningSoDetail(id, req.user);
  });

  app.get('/so-planning/:id/bom/:lineId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { lineId } = lineParam.parse(req.params);
    return service.getPlanningBom(lineId, req.user);
  });
}
