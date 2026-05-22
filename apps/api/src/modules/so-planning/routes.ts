// SO Planning routes (PL-4b). Read-only — writes go through plans/routes.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const uuidParam = z.object({ id: z.string().uuid() });
const lineParam = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });

export async function soPlanningRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-planning', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getPlanningSoList(req.user);
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
