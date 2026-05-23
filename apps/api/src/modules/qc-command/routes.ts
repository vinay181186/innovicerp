import { qcAssignInputSchema, qcPickUpInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function qcCommandRoutes(app: FastifyInstance): Promise<void> {
  // Aggregate read: queue + FPY + rework + stats + inspector options.
  app.get('/qc-command', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getQcCommand(req.user);
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
