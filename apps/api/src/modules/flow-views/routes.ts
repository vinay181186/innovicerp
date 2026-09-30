// Flow views (requirement 3.5) — four READ-ONLY endpoints. See service.ts.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParams = z.object({ id: z.string().uuid() });

export async function flowViewsRoutes(app: FastifyInstance): Promise<void> {
  /** Op qty flow — one row per op of the Job Card. */
  app.get('/flow-views/job-cards/:id/op-flow', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    return service.getOpFlow(id, req.user);
  });

  /** Rework tree — the card's top parent and every rework / repair descendant. */
  app.get('/flow-views/job-cards/:id/rework-tree', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    return service.getReworkTree(id, req.user);
  });

  /** NC timeline — raised → disposed → sent / rework JC → received → re-inspected → closed. */
  app.get('/flow-views/nc/:id/timeline', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    return service.getNcTimeline(id, req.user);
  });

  /** Level matrix — every SO line through Plan → Production Order → Job Card → OSP docs. */
  app.get('/flow-views/sales-orders/:id/level-matrix', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    return service.getLevelMatrix(id, req.user);
  });
}
