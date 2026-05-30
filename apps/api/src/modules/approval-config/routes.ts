import type { FastifyInstance } from 'fastify';
import { saveApprovalConfigInputSchema } from '@innovic/shared';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function approvalConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get('/approval-config', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getApprovalConfig(req.user);
  });

  app.put('/approval-config', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = saveApprovalConfigInputSchema.parse(req.body);
    return service.saveApprovalConfig(body, req.user);
  });

  app.get('/approval-config/history', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getApprovalHistory(req.user);
  });
}
