import { submitIncomingQcInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const lineParam = z.object({ grnLineId: z.string().uuid() });

export async function incomingQcRoutes(app: FastifyInstance): Promise<void> {
  app.get('/incoming-qc', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getIncomingQc(req.user);
  });

  // Inline accept/reject for one GRN line (Incoming QC Call Register).
  app.post('/incoming-qc/:grnLineId/inspect', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { grnLineId } = lineParam.parse(req.params);
    const input = submitIncomingQcInputSchema.parse(req.body);
    return service.submitIncomingQc(grnLineId, input, req.user);
  });
}
