import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { listAlertsQuerySchema, runAlertQuerySchema } from '@innovic/shared';
import { pageAlertRecords, pageAlerts } from './paging';
import { setAlertActiveInputSchema, setAlertSubscriptionInputSchema } from './schema';
import * as service from './service';
import * as subs from './subscriptions';

const codeParamSchema = z.object({ code: z.string().min(1) });

export async function alertsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/alerts', async (req) => {
    if (!req.user) throw new AuthenticationError();
    // ADR-201: search / "show zero" / page on the server; the counts strip is
    // worked out over every active alert.
    const q = listAlertsQuerySchema.parse(req.query);
    return pageAlerts(await service.runAllAlerts(req.user), q);
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

  app.get('/alerts/subscriptions', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return subs.listMySubscriptions(req.user);
  });

  app.put('/alerts/subscriptions/:code', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { code } = codeParamSchema.parse(req.params);
    const input = setAlertSubscriptionInputSchema.parse(req.body);
    const result = await subs.setMySubscription(
      input.channel
        ? { code, subscribed: input.subscribed, channel: input.channel }
        : { code, subscribed: input.subscribed },
      req.user,
    );
    if (result === null) {
      reply.code(204);
      return null;
    }
    return result;
  });

  app.get('/alerts/:code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { code } = codeParamSchema.parse(req.params);
    const q = runAlertQuerySchema.parse(req.query);
    return pageAlertRecords(await service.runAlert(code, req.user), q);
  });
}
