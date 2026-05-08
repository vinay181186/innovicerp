import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { setAlertActiveInputSchema } from './schema';
import * as service from './service';

const codeParamSchema = z.object({ code: z.string().min(1) });

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/alerts', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.runAllAlerts(req.user);
  });

  app.get('/alerts/config', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listAlertConfig(req.user);
  });

  app.put('/alerts/config/:code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { code } = codeParamSchema.parse(req.params);
    const input = setAlertActiveInputSchema.parse(req.body);
    return service.setAlertActive(code, input.active, req.user);
  });

  app.get('/alerts/:code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { code } = codeParamSchema.parse(req.params);
    return service.runAlert(code, req.user);
  });
}
