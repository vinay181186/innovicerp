// ADR-324 line undo (P1) — the Undo list of one JWSO line and its run-one-step
// action. Idempotency is global (ADR-172 plugin).

import type { FastifyInstance } from 'fastify';
import { runLineUndoStepInputSchema } from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const paramsSchema = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });

export async function lineUndoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/job-work-orders/:id/lines/:lineId/undo-list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id, lineId } = paramsSchema.parse(req.params);
    return service.getJwLineUndoList(id, lineId, req.user);
  });

  app.post('/job-work-orders/:id/lines/:lineId/undo-step', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id, lineId } = paramsSchema.parse(req.params);
    return service.runJwLineUndoStep(
      id,
      lineId,
      runLineUndoStepInputSchema.parse(req.body ?? {}),
      req.user,
    );
  });
}
