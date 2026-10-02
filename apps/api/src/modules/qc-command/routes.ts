import { qcAssignInputSchema, qcCommandQuerySchema, qcPickUpInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function qcCommandRoutes(app: FastifyInstance): Promise<void> {
  // Aggregate read: queue + FPY + rework + stats + inspector options.
  // ADR-201: `limit` + per-table offsets page each table; totals stay whole-set.
  app.get('/qc-command', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = qcCommandQuerySchema.parse(req.query);
    return service.getQcCommand(req.user, query);
  });

  // Pick Up — assign this op to the calling QC user.
  app.post('/qc-command/pickup', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = qcPickUpInputSchema.parse(req.body);
    return service.pickUpQc(input, req.user);
  });

  // Assign — admin allocates an op to any inspector.
  app.post('/qc-command/assign', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = qcAssignInputSchema.parse(req.body);
    return service.assignQc(input, req.user);
  });
}
